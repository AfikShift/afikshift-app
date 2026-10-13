"""Milestone 3c: payment-decision clashes across devices, HTTP hardening, public pages,
web account deletion and encrypted backup / restore."""
import os
import subprocess
import sys
from pathlib import Path

import pytest
import requests
from conftest import API, read_code_for_user

from test_m3b_safeguards import _drop_user, _make_user, _sync
from test_payments_m3a import _change, _payment, _shift, _uid

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))


@pytest.fixture(scope="module")
def officer(mongo_db):
    uid, headers = _make_user(requests.Session(), mongo_db, "M3c Tester")
    yield uid, headers
    _drop_user(mongo_db, uid)


@pytest.fixture
def h(officer, mongo_db):
    mongo_db.pp_shifts.delete_many({"user_id": officer[0]})
    return officer[1]


def _decision(origin, keep, rejected, supersedes=()):
    return {"id": _uid(), "origin_id": origin, "keep_id": keep, "rejected": list(rejected), "supersedes": list(supersedes)}


def _clash_shift(api_client, h):
    """Create a shift whose £100 payment was edited to £150 (A) and £120 (B) on two devices."""
    p1 = _payment(amount=100)
    pa = {**_payment(amount=150), "origin_id": p1["id"]}
    pb = {**_payment(amount=120), "origin_id": p1["id"]}
    pays = [{**p1, "deleted": True}, pa, pb]
    ch = _change(data=_shift(payments=pays))
    srv = _sync(api_client, h, [ch])["results"][0]["server"]
    assert srv["payment_clash"] is True and srv["amount_received"] == 120.0
    return ch["id"], p1, pa, pb, pays


# ---------------------------------------------------------------- payment decisions (two devices)
class TestPaymentDecisions:
    def test_single_decision_resolves_without_deleting_history(self, api_client, h):
        sid, p1, pa, pb, pays = _clash_shift(api_client, h)
        d = _decision(p1["id"], pa["id"], [pb["id"], p1["id"]])
        srv = _sync(api_client, h, [_change(id_=sid, base_version=1, data=_shift(payments=pays, payment_decisions=[d]))])["results"][0]["server"]
        assert srv["payment_clash"] is False and srv["amount_received"] == 150.0
        by_id = {p["id"]: p for p in srv["payments"]}
        assert by_id[pb["id"]]["deleted"] is False, "the rejected version stays in history"
        assert len(srv["payments"]) == 3

    def test_simultaneous_different_decisions_stay_provisional(self, api_client, h):
        sid, p1, pa, pb, pays = _clash_shift(api_client, h)
        da = _decision(p1["id"], pa["id"], [pb["id"]])  # phone A keeps £150
        db_ = _decision(p1["id"], pb["id"], [pa["id"]])  # phone B (offline, same base) keeps £120
        _sync(api_client, h, [_change(id_=sid, base_version=1, data=_shift(payments=pays, payment_decisions=[da]))])
        res = _sync(api_client, h, [_change(id_=sid, base_version=1, data=_shift(payments=pays, payment_decisions=[db_]))])
        srv = res["results"][0]["server"]
        assert {d["id"] for d in srv["payment_decisions"]} == {da["id"], db_["id"]}, "both choices preserved"
        assert srv["payment_clash"] is True, "not silently settled by the most recent choice"
        assert srv["amount_received"] == 120.0, "lower amount counted once, never 270"
        assert all(not p["deleted"] for p in srv["payments"] if p["id"] in (pa["id"], pb["id"]))

    def test_new_choice_supersedes_both_and_syncs(self, api_client, h):
        sid, p1, pa, pb, pays = _clash_shift(api_client, h)
        da = _decision(p1["id"], pa["id"], [pb["id"]])
        db_ = _decision(p1["id"], pb["id"], [pa["id"]])
        _sync(api_client, h, [_change(id_=sid, base_version=1, data=_shift(payments=pays, payment_decisions=[da]))])
        v = _sync(api_client, h, [_change(id_=sid, base_version=1, data=_shift(payments=pays, payment_decisions=[db_]))])["results"][0]["server"]["version"]
        dc = _decision(p1["id"], pa["id"], [pb["id"]], [da["id"], db_["id"]])
        srv = _sync(api_client, h, [_change(id_=sid, base_version=v, data=_shift(payments=pays, payment_decisions=[da, db_, dc]))])["results"][0]["server"]
        assert srv["payment_clash"] is False and srv["amount_received"] == 150.0
        # The other device pulls the same settled result.
        pulled = [s for s in _sync(api_client, h)["shifts"] if s["id"] == sid][0]
        assert pulled["payment_clash"] is False and pulled["amount_received"] == 150.0
        assert len(pulled["payment_decisions"]) == 3

    def test_same_choice_on_two_devices_is_not_a_clash(self, api_client, h):
        sid, p1, pa, pb, pays = _clash_shift(api_client, h)
        d1 = _decision(p1["id"], pa["id"], [pb["id"]])
        d2 = _decision(p1["id"], pa["id"], [pb["id"]])
        _sync(api_client, h, [_change(id_=sid, base_version=1, data=_shift(payments=pays, payment_decisions=[d1]))])
        srv = _sync(api_client, h, [_change(id_=sid, base_version=1, data=_shift(payments=pays, payment_decisions=[d2]))])["results"][0]["server"]
        assert srv["payment_clash"] is False and srv["amount_received"] == 150.0

    def test_stale_device_without_decisions_cannot_drop_them(self, api_client, h):
        sid, p1, pa, pb, pays = _clash_shift(api_client, h)
        d = _decision(p1["id"], pa["id"], [pb["id"]])
        v = _sync(api_client, h, [_change(id_=sid, base_version=1, data=_shift(payments=pays, payment_decisions=[d]))])["results"][0]["server"]["version"]
        srv = _sync(api_client, h, [_change(id_=sid, base_version=v, data=_shift(payments=pays, payment_decisions=[]))])["results"][0]["server"]
        assert [x["id"] for x in srv["payment_decisions"]] == [d["id"]]
        assert srv["payment_clash"] is False

    def test_invalid_decision_rejected(self, api_client, h):
        bad = {"id": "nope!", "origin_id": _uid(), "keep_id": _uid(), "rejected": [], "supersedes": []}
        r = api_client.post(f"{API}/shifts/sync", headers=h, json={"changes": [_change(data=_shift(payment_decisions=[bad]))]})
        assert r.status_code == 422


# ---------------------------------------------------------------- HTTP hardening
class TestHardening:
    def test_security_headers(self, api_client):
        r = api_client.get(f"{API}/")
        for k in ("x-content-type-options", "x-frame-options", "referrer-policy", "strict-transport-security"):
            assert k in r.headers
        assert "no-store" in r.headers["cache-control"]

    def test_oversized_body_rejected(self):
        r = requests.post("http://localhost:8001/api/auth/login", data=b"x" * (2 * 1024 * 1024 + 10),
                          headers={"Content-Type": "application/json"})
        assert r.status_code == 413

    def test_chunked_oversized_body_rejected(self):
        def gen():
            for _ in range(3):
                yield b"x" * (1024 * 1024)
        r = requests.post("http://localhost:8001/api/shifts/sync", data=gen(), headers={"Content-Type": "application/json"})
        assert r.status_code == 413

    def test_trusted_proxy_hops(self, monkeypatch):
        import server
        from types import SimpleNamespace
        req = SimpleNamespace(headers={"x-forwarded-for": "6.6.6.6, 203.0.113.9"}, client=SimpleNamespace(host="10.0.0.1"))
        monkeypatch.setattr(server, "TRUSTED_PROXY_HOPS", 1)
        assert server.client_ip(req) == "203.0.113.9", "forged first entry ignored"
        monkeypatch.setattr(server, "TRUSTED_PROXY_HOPS", 0)
        assert server.client_ip(req) == "6.6.6.6"

    def test_production_guard_rejects_dev_secret(self):
        import server
        assert any("JWT_SECRET" in p for p in server.production_config_problems())

    def test_rate_limiter_window(self):
        from security import RateLimiter
        rl = RateLimiter(3, window=60)
        assert [rl.allow("ip", now=t) for t in (0, 1, 2, 3)] == [True, True, True, False]
        assert rl.allow("other", now=3) is True
        assert rl.allow("ip", now=61) is True

    def test_production_config_guard(self, monkeypatch):
        import server
        monkeypatch.setenv("CORS_ORIGINS", "*")
        monkeypatch.setenv("PUBLIC_BASE_URL", "https://YOUR-DOMAIN.example")
        problems = " ".join(server.production_config_problems())
        assert "CORS_ORIGINS" in problems and "PUBLIC_BASE_URL" in problems


# ---------------------------------------------------------------- public pages
class TestPublicPages:
    @pytest.mark.parametrize("page,text", [("privacy", "Privacy Policy"), ("terms", "Terms of Use"),
                                           ("delete-account", "Delete your AfikShift account")])
    def test_public_without_login(self, page, text):
        r = requests.get(f"{API}/public/{page}")
        assert r.status_code == 200 and text in r.text
        assert 'name="viewport"' in r.text
        assert "nonce-" in r.headers["content-security-policy"] and "frame-ancestors 'none'" in r.headers["content-security-policy"]

    def test_privacy_mentions_retention_and_rights(self):
        t = requests.get(f"{API}/public/privacy").text
        for s in ("90 days", "35 days", "ICO", "biometric", "other people"):  # Phase A: neutral wording
            assert s.lower() in t.lower()


# ---------------------------------------------------------------- web account deletion
def _ip():
    """Each test acts as a separate client so the public 10/min per-IP limit doesn't couple tests."""
    return {"X-Forwarded-For": f"10.{os.getpid() % 250}.{int(_uid()[:2], 16)}.{int(_uid()[:2], 16)}"}


class TestAccountDeletion:
    def test_unknown_email_same_response(self):
        r = requests.post(f"{API}/public/account-deletion/request", headers=_ip(), json={"email": f"nobody_{_uid()[:8]}@example.com"})
        assert r.status_code == 202 and "If the details are valid" in r.json()["message"]

    def test_full_flow_deletes_everything_and_signals_devices(self, mongo_db):
        s = requests.Session()
        uid, headers = _make_user(s, mongo_db, "Delete Me")
        s.headers.update(_ip())
        email = mongo_db.users.find_one({"id": uid})["email"]
        refresh = s.post(f"{API}/auth/login", json={"email": email, "password": "M3bTestPass123"}).json()["refresh_token"]
        _sync(s, headers, [_change(data=_shift(payments=[_payment(amount=50)]))])
        try:
            assert s.post(f"{API}/public/account-deletion/request", json={"email": email}).status_code == 202
            code = read_code_for_user(uid, "delete")
            assert code
            bad = s.post(f"{API}/public/account-deletion/confirm", json={"email": email, "code": "000000", "confirm": True})
            assert bad.status_code == 400
            no_confirm = s.post(f"{API}/public/account-deletion/confirm", json={"email": email, "code": code, "confirm": False})
            assert no_confirm.status_code == 422, "explicit final confirmation required"
            ok = s.post(f"{API}/public/account-deletion/confirm", json={"email": email, "code": code, "confirm": True})
            assert ok.status_code == 200
            assert mongo_db.users.find_one({"id": uid}) is None
            assert mongo_db.pp_shifts.count_documents({"user_id": uid}) == 0
            log = mongo_db.deletion_log.find_one({"user_id": uid})
            assert log and "email" not in log and log["via"] == "web"
            assert s.post(f"{API}/auth/refresh", json={"refresh_token": refresh}).status_code == 410
            reuse = s.post(f"{API}/public/account-deletion/confirm", json={"email": email, "code": code, "confirm": True})
            assert reuse.status_code == 400, "codes are single-use"
        finally:
            _drop_user(mongo_db, uid)
            mongo_db.deletion_log.delete_many({"user_id": uid})

    def test_code_locked_after_5_wrong_attempts(self, mongo_db):
        s = requests.Session()
        uid, _ = _make_user(s, mongo_db, "Lock Test")
        s.headers.update(_ip())
        email = mongo_db.users.find_one({"id": uid})["email"]
        try:
            s.post(f"{API}/public/account-deletion/request", json={"email": email})
            code = read_code_for_user(uid, "delete")
            for _ in range(5):
                s.post(f"{API}/public/account-deletion/confirm", json={"email": email, "code": "999999", "confirm": True})
            r = s.post(f"{API}/public/account-deletion/confirm", json={"email": email, "code": code, "confirm": True})
            assert r.status_code in (400, 429)
            assert mongo_db.users.find_one({"id": uid}) is not None
        finally:
            _drop_user(mongo_db, uid)

    def test_codes_not_in_logs(self):
        log = subprocess.run(["tail", "-n", "2000", "/var/log/supervisor/backend.err.log"], capture_output=True, text=True).stdout
        assert "code for user" not in log and "246810" not in log


# ---------------------------------------------------------------- backup & restore
OPS = BACKEND.parent / "ops"


class TestBackupRestore:
    def _run(self, *args, env):
        return subprocess.run([sys.executable, *args], capture_output=True, text=True, env=env, timeout=120)

    def test_encrypted_backup_restores_accurately_and_reapplies_deletions(self, tmp_path, mongo_db):
        key = tmp_path / "key"
        key.write_text(os.urandom(32).hex())
        key.chmod(0o600)
        out = tmp_path / "backups"
        env = {**os.environ, "BACKUP_KEY_FILE": str(key)}
        uid, _ = _make_user(requests.Session(), mongo_db, "Backup Tester")
        mongo_db.pp_shifts.insert_one({"id": _uid(), "user_id": uid, "deleted": False, "date": "2026-01-01"})
        try:
            r = self._run(str(OPS / "backup.py"), "--out", str(out), env=env)
            assert r.returncode == 0, r.stderr
            backup = Path(r.stdout.strip())
            assert backup.stat().st_mode & 0o077 == 0 and out.stat().st_mode & 0o077 == 0
            raw = backup.read_bytes()
            assert raw.startswith(b"Salted__") and b"Backup Tester" not in raw, "file is encrypted"

            # Account deleted after the backup was taken.
            mongo_db.deletion_log.insert_one({"user_id": uid, "account_hash": "x", "via": "test"})
            expected_users = mongo_db.users.count_documents({"id": {"$ne": uid}})
            mongo_db.users.delete_one({"id": uid})

            target = "dutyconnect_restore_test"
            r = self._run(str(OPS / "restore.py"), str(backup), "--into", target, env=env)
            assert r.returncode == 0, r.stderr
            rdb = mongo_db.client[target]
            assert rdb.users.find_one({"id": uid}) is None, "deleted account not resurrected"
            assert rdb.pp_shifts.count_documents({"user_id": uid}) == 0
            assert rdb.users.count_documents({}) == expected_users
            sample = mongo_db.users.find_one({"id": {"$ne": uid}}, {"_id": 0})
            assert rdb.users.find_one({"id": sample["id"]}, {"_id": 0}) == sample, "restored record identical"

            # Wrong key and tampered file are refused.
            key.write_text(os.urandom(32).hex())
            assert self._run(str(OPS / "restore.py"), str(backup), "--into", target, env=env).returncode != 0
            backup.write_bytes(raw[:-10] + b"0123456789")
            r = self._run(str(OPS / "restore.py"), str(backup), "--into", target, env=env)
            assert r.returncode != 0 and "Checksum" in r.stderr
        finally:
            mongo_db.client.drop_database("dutyconnect_restore_test")
            mongo_db.deletion_log.delete_many({"user_id": uid})
            _drop_user(mongo_db, uid)

    def test_refuses_world_readable_key(self, tmp_path):
        key = tmp_path / "key"
        key.write_text("abc")
        key.chmod(0o644)
        r = self._run(str(OPS / "backup.py"), "--out", str(tmp_path / "b"), env={**os.environ, "BACKUP_KEY_FILE": str(key)})
        assert r.returncode != 0 and "chmod 600" in r.stderr


def test_public_deletion_rate_limited():
    h = _ip()
    codes = [requests.post(f"{API}/public/account-deletion/request", headers=h,
                           json={"email": f"x{i}@example.com"}).status_code for i in range(12)]
    assert codes[0] == 202 and 429 in codes
