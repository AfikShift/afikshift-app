"""Security hardening tests: per-account throttle, anti-enumeration, CORS, prisoner-data guard."""
import time
import uuid
import pytest
import requests

from conftest import API, MAIN_EMAIL, MAIN_PASSWORD


# ------------------------------------------------------------- helpers
def _clear_attempts(mongo_db):
    mongo_db.login_attempts.delete_many({})


def _post(path: str, json: dict, origin: str | None = None, xff: str | None = None):
    h = {"Content-Type": "application/json"}
    if origin:
        h["Origin"] = origin
    if xff:
        h["X-Forwarded-For"] = xff
    return requests.post(f"{API}{path}", json=json, headers=h, timeout=15)


# ============================================================= 1. per-account throttle
class TestAccountThrottle:
    def test_account_limit_across_different_ips(self, mongo_db):
        """10 wrong attempts across different IPs -> 11th returns 429 even with a brand-new IP."""
        _clear_attempts(mongo_db)
        for i in range(10):
            r = _post("/auth/login",
                     {"email": MAIN_EMAIL, "password": f"wrong-{i}"},
                     xff=f"10.0.{i}.{i}")
            assert r.status_code == 401, f"attempt {i}: {r.status_code} {r.text}"
        # 11th from a fresh IP: account-wide throttle must kick in
        r = _post("/auth/login",
                 {"email": MAIN_EMAIL, "password": "wrong-11"},
                 xff="203.0.113.99")
        assert r.status_code == 429, f"Expected account throttle 429, got {r.status_code} {r.text}"
        _clear_attempts(mongo_db)

    def test_ip_limit_same_xff(self, mongo_db):
        """5 wrong from the same IP -> 6th returns 429 (secondary IP limit)."""
        _clear_attempts(mongo_db)
        xff = "198.51.100.5"
        for i in range(5):
            r = _post("/auth/login",
                     {"email": MAIN_EMAIL, "password": f"wrong-{i}"},
                     xff=xff)
            assert r.status_code == 401
        r = _post("/auth/login",
                 {"email": MAIN_EMAIL, "password": "wrong-6"},
                 xff=xff)
        assert r.status_code == 429
        _clear_attempts(mongo_db)

    def test_unknown_email_same_401_and_throttled(self, mongo_db):
        """Unknown email returns identical 401 message and is throttled the same way."""
        _clear_attempts(mongo_db)
        unknown = f"delivered+nouser{uuid.uuid4().hex[:6]}@resend.dev"
        last = None
        for i in range(10):
            r = _post("/auth/login",
                     {"email": unknown, "password": f"wrong-{i}"},
                     xff=f"10.1.{i}.{i}")
            assert r.status_code == 401
            last = r.json()
        assert "Incorrect email or password" in last.get("detail", ""), last
        # 11th different IP should be 429 due to account throttle (per-email even if no user)
        r = _post("/auth/login",
                 {"email": unknown, "password": "wrong-11"},
                 xff="203.0.113.200")
        assert r.status_code == 429
        _clear_attempts(mongo_db)

    def test_password_reset_clears_account_throttle(self, api_client, mongo_db, code_reader):
        """After a successful password reset, the account throttle is cleared and login works."""
        _clear_attempts(mongo_db)
        # Trigger account throttle
        for i in range(10):
            _post("/auth/login",
                  {"email": MAIN_EMAIL, "password": f"wrong-{i}"},
                  xff=f"10.2.{i}.{i}")
        r = _post("/auth/login",
                 {"email": MAIN_EMAIL, "password": MAIN_PASSWORD},
                 xff="203.0.113.50")
        assert r.status_code == 429, "Precondition: account should be throttled"

        # Initiate reset and seed deterministic code
        r = _post("/auth/forgot-password", {"email": MAIN_EMAIL})
        assert r.status_code == 202
        # user id lookup
        u = mongo_db.users.find_one({"email": MAIN_EMAIL})
        code = code_reader(u["id"], kind="reset")
        assert code, "Could not seed reset code"

        # Reset to the SAME password (test credentials policy says: don't leave changed)
        r = _post("/auth/reset-password",
                 {"email": MAIN_EMAIL, "code": code, "new_password": MAIN_PASSWORD})
        assert r.status_code == 200, r.text

        # Account throttle cleared -> login works immediately from a fresh IP
        r = _post("/auth/login",
                 {"email": MAIN_EMAIL, "password": MAIN_PASSWORD},
                 xff="203.0.113.77")
        assert r.status_code == 200, f"Login after reset failed: {r.status_code} {r.text}"
        _clear_attempts(mongo_db)


# ============================================================= 2. anti-enumeration
class TestAntiEnumeration:
    def test_register_identical_response_three_cases(self, mongo_db):
        """Register for existing-verified / existing-unverified / brand-new all return identical 202 body."""
        _clear_attempts(mongo_db)
        # existing verified
        r1 = _post("/auth/register",
                  {"full_name": "Test A", "email": MAIN_EMAIL, "password": "Testpass123"})
        # existing unverified: create one
        unv_email = f"delivered+unv{uuid.uuid4().hex[:6]}@resend.dev"
        r_create = _post("/auth/register",
                         {"full_name": "Unv User", "email": unv_email, "password": "Testpass123"})
        assert r_create.status_code == 202
        r2 = _post("/auth/register",
                  {"full_name": "Unv User", "email": unv_email, "password": "Testpass123"})
        # brand new
        new_email = f"delivered+new{uuid.uuid4().hex[:6]}@resend.dev"
        r3 = _post("/auth/register",
                  {"full_name": "New User", "email": new_email, "password": "Testpass123"})

        for r in (r1, r2, r3):
            assert r.status_code == 202, (r.status_code, r.text)
        assert r1.json() == r2.json() == r3.json(), (r1.json(), r2.json(), r3.json())

        # cleanup created users
        mongo_db.users.delete_one({"email": unv_email})
        mongo_db.users.delete_one({"email": new_email})
        mongo_db.action_codes.delete_many({})

    def test_forgot_and_resend_identical_for_known_and_unknown(self):
        """forgot-password & resend-verification return identical 202 bodies for known/unknown emails."""
        unknown = f"delivered+ghost{uuid.uuid4().hex[:6]}@resend.dev"
        for path in ("/auth/forgot-password", "/auth/resend-verification"):
            r_known = _post(path, {"email": MAIN_EMAIL})
            r_unknown = _post(path, {"email": unknown})
            assert r_known.status_code == 202 == r_unknown.status_code, (path, r_known.text, r_unknown.text)
            assert r_known.json() == r_unknown.json(), (path, r_known.json(), r_unknown.json())

    def test_forgot_password_response_time_similar(self):
        """Background email send should keep response times roughly similar for known/unknown."""
        unknown = f"delivered+ghost{uuid.uuid4().hex[:6]}@resend.dev"
        t1 = time.perf_counter(); _post("/auth/forgot-password", {"email": MAIN_EMAIL}); dk = time.perf_counter() - t1
        t2 = time.perf_counter(); _post("/auth/forgot-password", {"email": unknown}); du = time.perf_counter() - t2
        # Allow generous margin (network jitter in preview). Known must not take dramatically longer.
        assert abs(dk - du) < 2.5, f"Timing side-channel too large: known={dk:.3f}s unknown={du:.3f}s"

    def test_login_unknown_vs_wrong_password_identical_401(self, mongo_db):
        _clear_attempts(mongo_db)
        r_unknown = _post("/auth/login",
                         {"email": f"delivered+nouser{uuid.uuid4().hex[:6]}@resend.dev", "password": "whatever123"},
                         xff="10.9.0.1")
        r_wrong = _post("/auth/login",
                        {"email": MAIN_EMAIL, "password": "WrongPass999"},
                        xff="10.9.0.2")
        assert r_unknown.status_code == r_wrong.status_code == 401
        assert r_unknown.json() == r_wrong.json(), (r_unknown.json(), r_wrong.json())
        _clear_attempts(mongo_db)

    def test_403_only_with_correct_password_for_unverified(self, mongo_db):
        """403 email_not_verified MUST only occur with the correct password (by design)."""
        _clear_attempts(mongo_db)
        email = f"delivered+unvcheck{uuid.uuid4().hex[:6]}@resend.dev"
        pw = "Testpass123"
        r = _post("/auth/register", {"full_name": "Unv Check", "email": email, "password": pw})
        assert r.status_code == 202

        # wrong password -> plain 401
        r_wrong = _post("/auth/login", {"email": email, "password": "BadPass999"}, xff="10.4.0.1")
        assert r_wrong.status_code == 401
        assert "Incorrect email or password" in r_wrong.json()["detail"]

        # correct password on unverified account -> 403 email_not_verified
        r_right = _post("/auth/login", {"email": email, "password": pw}, xff="10.4.0.2")
        assert r_right.status_code == 403
        assert "email_not_verified" in r_right.json()["detail"]

        # cleanup
        mongo_db.users.delete_one({"email": email})
        mongo_db.action_codes.delete_many({})
        _clear_attempts(mongo_db)


# ============================================================= 3. CORS
class TestCORS:
    def test_evil_origin_blocked(self):
        r = requests.options(
            f"{API}/auth/login",
            headers={"Origin": "https://evil.example",
                     "Access-Control-Request-Method": "POST",
                     "Access-Control-Request-Headers": "content-type"},
            timeout=10)
        acao = r.headers.get("access-control-allow-origin", "")
        assert acao != "https://evil.example" and acao != "*", f"Evil origin leaked ACAO: {acao}"

    def test_approved_origin_allowed(self):
        allowed = "https://dutyconnect-beta.preview.emergentagent.com"
        r = requests.options(
            f"{API}/auth/login",
            headers={"Origin": allowed,
                     "Access-Control-Request-Method": "POST",
                     "Access-Control-Request-Headers": "content-type"},
            timeout=10)
        assert r.headers.get("access-control-allow-origin") == allowed, dict(r.headers)

    def test_no_origin_header_works(self, mongo_db):
        """Native apps don't send Origin -- POST without Origin must still work."""
        _clear_attempts(mongo_db)
        # Use requests directly without any Origin header
        r = requests.post(f"{API}/auth/login",
                          json={"email": MAIN_EMAIL, "password": MAIN_PASSWORD},
                          headers={"Content-Type": "application/json"},
                          timeout=15)
        assert r.status_code == 200, f"Native (no-Origin) login failed: {r.status_code} {r.text}"
        _clear_attempts(mongo_db)


# ============================================================= 4. prisoner data guard on shifts
class TestPrisonerDataGuard:
    @pytest.fixture
    def auth(self, api_client, mongo_db):
        _clear_attempts(mongo_db)
        r = api_client.post(f"{API}/auth/login",
                            json={"email": MAIN_EMAIL, "password": MAIN_PASSWORD})
        assert r.status_code == 200
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    @pytest.mark.parametrize("bad_location", [
        "A1234BC",
        "prisoner smith",
        "inmate bay 3",
        "NOMIS office",
        "cell 12",
        "wing B2",
    ])
    def test_blocked_locations(self, auth, mongo_db, bad_location):
        sid = str(uuid.uuid4())
        payload = {
            "changes": [{
                "id": sid, "change_id": str(uuid.uuid4()), "base_version": 0, "deleted": False,
                "data": {
                    "officer_name": "Test Officer", "duty_type": "bed_watch", "shift_period": "day",
                    "date": "2026-05-20", "start_time": "08:00", "end_time": "16:00",
                    "break_minutes": 30, "location": bad_location,
                },
            }], "since": None,
        }
        r = requests.post(f"{API}/shifts/sync", json=payload, headers=auth, timeout=15)
        assert r.status_code == 422, f"Expected 422 for '{bad_location}', got {r.status_code} {r.text}"
        # ensure nothing was inserted
        assert mongo_db.pp_shifts.find_one({"id": sid}) is None

    def test_accepts_benign_location(self, auth, mongo_db):
        sid = str(uuid.uuid4())
        payload = {
            "changes": [{
                "id": sid, "change_id": str(uuid.uuid4()), "base_version": 0, "deleted": False,
                "data": {
                    "officer_name": "Test Officer", "duty_type": "bed_watch", "shift_period": "day",
                    "date": "2026-05-21", "start_time": "08:00", "end_time": "16:00",
                    "break_minutes": 30, "location": "Local hospital",
                },
            }], "since": None,
        }
        r = requests.post(f"{API}/shifts/sync", json=payload, headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        results = r.json()["results"]
        assert results and results[0]["status"] == "applied"
        # cleanup
        mongo_db.pp_shifts.delete_one({"id": sid})
