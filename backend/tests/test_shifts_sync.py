"""Backend tests for DutyConnect Milestone 2 — PP shift sync endpoint.

Covers:
  - Auth required (401)
  - Create via sync (applied, payable_hours & estimated_earnings computed)
  - Idempotency: resend same change_id -> duplicate, no second record
  - Update with matching base_version -> applied, version+1
  - Stale base_version -> conflict with server copy
  - Delete (tombstone) excluded from initial pull (since=null), present on incremental pull
  - Cross-user id -> rejected
  - Validation 422: finish==start, break>=duration, invalid time '25:00', location 'A1234BC'
  - Overnight calc 22:00-06:00 br30 -> 7.5h; Day 08:00-20:00 br0 -> 12h
"""
import uuid
import time
import pytest
from conftest import API, MAIN_EMAIL, MAIN_PASSWORD


def _uid() -> str:
    return str(uuid.uuid4())


def _shift(**over) -> dict:
    base = {
        "officer_name": "T1 Tester",
        "duty_type": "bed_watch",
        "shift_period": "night",
        "date": "2026-02-15",
        "start_time": "20:00",
        "end_time": "08:00",
        "break_minutes": 60,
        "location": "HMP Example",
        "status": "booked",
        "payment_status": "pending",
        "hourly_rate": 30,
    }
    base.update(over)
    return base


def _change(id_=None, change_id=None, base_version=0, deleted=False, data=None) -> dict:
    return {
        "id": id_ or _uid(),
        "change_id": change_id or _uid(),
        "base_version": base_version,
        "deleted": deleted,
        "data": data if data is not None else _shift(),
    }


@pytest.fixture
def clean_shifts(mongo_db):
    """Clean this test user's shifts before and after each test."""
    user = mongo_db.users.find_one({"email": MAIN_EMAIL})
    uid = user["id"] if user else None
    if uid:
        mongo_db.pp_shifts.delete_many({"user_id": uid})
    yield uid
    if uid:
        mongo_db.pp_shifts.delete_many({"user_id": uid})


# ---------------------------------------------------------------- Auth
class TestShiftAuth:
    def test_sync_requires_auth(self, api_client):
        r = api_client.post(f"{API}/shifts/sync", json={"changes": []})
        assert r.status_code == 401


# ---------------------------------------------------------------- Create & compute
class TestCreateAndCompute:
    def test_create_night_shift_computes_hours_and_earnings(self, api_client, auth_headers, clean_shifts):
        ch = _change()
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers,
                            json={"changes": [ch]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["results"]) == 1
        res = body["results"][0]
        assert res["status"] == "applied"
        srv = res["server"]
        # 20:00 -> 08:00 = 12h, minus 60min break = 11.0h; * 30 = 330.0
        assert srv["payable_hours"] == 11.0
        assert srv["estimated_earnings"] == 330.0
        assert srv["version"] == 1
        assert srv["deleted"] is False
        # pulled list should contain this shift
        assert any(s["id"] == ch["id"] for s in body["shifts"])

    def test_overnight_22_to_06_break_30(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(start_time="22:00", end_time="06:00", break_minutes=30, hourly_rate=20))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        srv = r.json()["results"][0]["server"]
        assert srv["payable_hours"] == 7.5
        assert srv["estimated_earnings"] == 150.0

    def test_day_08_to_20_zero_break(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(shift_period="day", start_time="08:00", end_time="20:00",
                                 break_minutes=0, hourly_rate=25))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        srv = r.json()["results"][0]["server"]
        assert srv["payable_hours"] == 12.0
        assert srv["estimated_earnings"] == 300.0

    def test_no_hourly_rate_estimated_is_null(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(hourly_rate=None))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        srv = r.json()["results"][0]["server"]
        assert srv["payable_hours"] == 11.0
        assert srv["estimated_earnings"] is None


# ---------------------------------------------------------------- Idempotency
class TestIdempotency:
    def test_resend_same_change_id_is_duplicate(self, api_client, auth_headers, mongo_db, clean_shifts):
        ch = _change()
        r1 = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r1.json()["results"][0]["status"] == "applied"
        r2 = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r2.status_code == 200
        res = r2.json()["results"][0]
        assert res["status"] == "duplicate"
        # Mongo must still contain exactly one record for that id
        assert mongo_db.pp_shifts.count_documents({"id": ch["id"]}) == 1
        # version did not increment
        assert res["server"]["version"] == 1


# ---------------------------------------------------------------- Update & conflict
class TestUpdateConflict:
    def _create(self, api_client, auth_headers):
        ch = _change()
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r.json()["results"][0]["status"] == "applied"
        return ch

    def test_update_with_matching_base_version_increments(self, api_client, auth_headers, clean_shifts):
        ch = self._create(api_client, auth_headers)
        upd = _change(id_=ch["id"], base_version=1, data=_shift(location="HMP Updated"))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [upd]})
        res = r.json()["results"][0]
        assert res["status"] == "applied"
        assert res["server"]["version"] == 2
        assert res["server"]["location"] == "HMP Updated"

    def test_stale_base_version_returns_conflict_with_server_copy(self, api_client, auth_headers, clean_shifts):
        ch = self._create(api_client, auth_headers)
        # First bump to v2
        api_client.post(f"{API}/shifts/sync", headers=auth_headers,
                        json={"changes": [_change(id_=ch["id"], base_version=1,
                                                  data=_shift(location="HMP V2"))]})
        # Stale edit from base_version=1
        stale = _change(id_=ch["id"], base_version=1, data=_shift(location="HMP STALE"))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [stale]})
        res = r.json()["results"][0]
        assert res["status"] == "conflict"
        assert res["server"] is not None
        assert res["server"]["version"] == 2
        assert res["server"]["location"] == "HMP V2"


# ---------------------------------------------------------------- Delete / tombstone / pull
class TestDeleteAndPull:
    def test_delete_tombstone_excluded_from_initial_pull_included_in_incremental(
            self, api_client, auth_headers, clean_shifts):
        # Create
        ch = _change()
        r1 = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        server_time_before_delete = r1.json()["server_time"]

        # Delete (tombstone)
        del_ch = {"id": ch["id"], "change_id": _uid(), "base_version": 1, "deleted": True}
        r2 = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [del_ch]})
        assert r2.json()["results"][0]["status"] == "applied"
        assert r2.json()["results"][0]["server"]["deleted"] is True

        # Initial pull (since=null) -> tombstone excluded
        r3 = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": []})
        ids = [s["id"] for s in r3.json()["shifts"]]
        assert ch["id"] not in ids

        # Incremental pull (since=before delete) -> tombstone present
        r4 = api_client.post(f"{API}/shifts/sync", headers=auth_headers,
                             json={"changes": [], "since": server_time_before_delete})
        ids4 = [s["id"] for s in r4.json()["shifts"]]
        assert ch["id"] in ids4


# ---------------------------------------------------------------- Cross-user rejection
class TestCrossUserRejection:
    def test_other_users_id_rejected(self, api_client, auth_headers, mongo_db, clean_shifts):
        # Insert a shift owned by another synthetic user directly in Mongo
        other_id = _uid()
        other_uid = _uid()
        mongo_db.pp_shifts.insert_one({
            "id": other_id, "user_id": other_uid, "version": 1,
            "officer_name": "Other", "duty_type": "other", "shift_period": "day",
            "date": "2026-03-01", "start_time": "08:00", "end_time": "16:00",
            "break_minutes": 0, "location": "", "status": "booked",
            "payment_status": "pending", "hourly_rate": None,
            "payable_hours": 8.0, "estimated_earnings": None,
            "deleted": False, "last_change_id": _uid(),
        })
        try:
            ch = _change(id_=other_id, base_version=1, data=_shift(location="HIJACK"))
            r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
            res = r.json()["results"][0]
            assert res["status"] == "rejected"
            # Still owned by other user, unchanged
            doc = mongo_db.pp_shifts.find_one({"id": other_id})
            assert doc["user_id"] == other_uid
            assert doc["location"] == ""
        finally:
            mongo_db.pp_shifts.delete_one({"id": other_id})


# ---------------------------------------------------------------- Validation 422
class TestValidation:
    def test_finish_equals_start_rejected(self, api_client, auth_headers, clean_shifts):
        bad = _change(data=_shift(start_time="08:00", end_time="08:00"))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [bad]})
        assert r.status_code == 422

    def test_break_ge_duration_rejected(self, api_client, auth_headers, clean_shifts):
        # 08:00-10:00 = 120min; break 120 -> invalid
        bad = _change(data=_shift(shift_period="day", start_time="08:00", end_time="10:00",
                                  break_minutes=120))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [bad]})
        assert r.status_code == 422

    def test_invalid_time_25_00_rejected(self, api_client, auth_headers, clean_shifts):
        bad = _change(data=_shift(start_time="25:00"))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [bad]})
        assert r.status_code == 422

    def test_prisoner_number_in_location_rejected(self, api_client, auth_headers, clean_shifts):
        bad = _change(data=_shift(location="A1234BC"))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [bad]})
        assert r.status_code == 422


# ---------------------------------------------------------------- Security: no secrets in logs
class TestLogHygiene:
    def test_logs_do_not_contain_codes_passwords_or_tokens(self, api_client, mongo_db):
        """Trigger register + forgot and ensure no [DEV] codes / password / tokens appear in logs."""
        import subprocess
        tag = uuid.uuid4().hex[:6]
        email = f"delivered+t1_log_{tag}@resend.dev"
        pw = "LogSniffPw123"
        api_client.post(f"{API}/auth/register",
                        json={"full_name": "LogCheck", "email": email, "password": pw})
        time.sleep(2)
        api_client.post(f"{API}/auth/forgot-password", json={"email": email})
        time.sleep(1)
        logs = subprocess.check_output(["tail", "-n", "500", "/var/log/supervisor/backend.err.log"],
                                        text=True) + \
            subprocess.check_output(["tail", "-n", "500", "/var/log/supervisor/backend.out.log"],
                                     text=True)
        assert "[DEV]" not in logs, "DEV_LOG_CODES must be false — codes leaked"
        assert pw not in logs, "Password leaked in logs"
        # Cleanup
        u = mongo_db.users.find_one({"email": email})
        if u:
            mongo_db.action_codes.delete_many({"user_id": u["id"]})
            mongo_db.users.delete_one({"email": email})
