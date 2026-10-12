"""M3b safeguards: S1 payment edit clashes (no duplicate inflation), S2 Recently Deleted (90 days),
and data isolation for reports (sync only ever returns the authenticated officer's records)."""
import uuid
from datetime import date, datetime, timedelta, timezone

import bcrypt
import pytest
from conftest import API

from test_payments_m3a import _change, _payment, _shift, _uid


def _sync(api_client, headers, changes=None, since=None):
    body = {"changes": changes or []}
    if since:
        body["since"] = since
    r = api_client.post(f"{API}/shifts/sync", headers=headers, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _make_user(api_client, mongo_db, name):
    uid = str(uuid.uuid4())
    email = f"m3b_{uid[:8]}@example.com"
    pw = "M3bTestPass123"
    mongo_db.users.insert_one({
        "id": uid, "email": email, "full_name": name,
        "password_hash": bcrypt.hashpw(pw.encode(), bcrypt.gensalt(4)).decode(),
        "professional_category": "Prison Officer", "currency": "GBP", "hourly_rate": None,
        "notification_prefs": {}, "plan": "free", "email_verified": True,
        "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)})
    tok = api_client.post(f"{API}/auth/login", json={"email": email, "password": pw}).json()["access_token"]
    return uid, {"Authorization": f"Bearer {tok}"}


def _drop_user(mongo_db, uid):
    for coll in ("pp_shifts", "sessions"):
        mongo_db[coll].delete_many({"user_id": uid})
    mongo_db.users.delete_one({"id": uid})


@pytest.fixture(scope="module")
def own_user(mongo_db):
    """Dedicated officer for this module so parallel test workers never share its shifts."""
    import requests
    uid, headers = _make_user(requests.Session(), mongo_db, "M3b Tester")
    yield uid, headers
    _drop_user(mongo_db, uid)


@pytest.fixture
def auth_headers(own_user):
    return own_user[1]


@pytest.fixture
def clean(mongo_db, own_user):
    mongo_db.pp_shifts.delete_many({"user_id": own_user[0]})
    yield own_user[0]
    mongo_db.pp_shifts.delete_many({"user_id": own_user[0]})


# ---------------------------------------------------------------- S1 payment clashes
class TestPaymentClash:
    def test_two_device_edit_counts_once_and_flags_clash(self, api_client, auth_headers, clean):
        p1 = _payment(amount=100)
        ch = _change(data=_shift(payments=[p1]))
        sid = ch["id"]
        _sync(api_client, auth_headers, [ch])
        # Device A edits p1 -> £150; device B (same base) edits p1 -> £120.
        pa = {**_payment(amount=150), "origin_id": p1["id"]}
        pb = {**_payment(amount=120), "origin_id": p1["id"]}
        _sync(api_client, auth_headers, [_change(id_=sid, base_version=1, data=_shift(payments=[{**p1, "deleted": True}, pa]))])
        res = _sync(api_client, auth_headers, [_change(id_=sid, base_version=1, data=_shift(payments=[{**p1, "deleted": True}, pb]))])
        srv = res["results"][0]["server"]
        assert srv["payment_clash"] is True
        assert srv["amount_received"] == 120.0, "only the lower clashing version counts (no inflation to 270)"
        assert srv["payment_status"] == "partially_paid"

    def test_chained_edit_clash_detected(self, api_client, auth_headers, clean):
        p1 = _payment(amount=100)
        ch = _change(data=_shift(payments=[p1]))
        sid = ch["id"]
        _sync(api_client, auth_headers, [ch])
        pa = {**_payment(amount=110), "origin_id": p1["id"]}
        pa2 = {**_payment(amount=115), "origin_id": p1["id"]}  # A edits again (lineage kept)
        pb = {**_payment(amount=130), "origin_id": p1["id"]}
        _sync(api_client, auth_headers, [_change(id_=sid, base_version=1, data=_shift(payments=[{**p1, "deleted": True}, {**pa, "deleted": True}, pa2]))])
        srv = _sync(api_client, auth_headers, [_change(id_=sid, base_version=1, data=_shift(payments=[{**p1, "deleted": True}, pb]))])["results"][0]["server"]
        assert srv["payment_clash"] is True
        assert srv["amount_received"] == 115.0

    def test_resolving_clash_clears_flag(self, api_client, auth_headers, clean):
        p1 = _payment(amount=100)
        pa = {**_payment(amount=150), "origin_id": p1["id"]}
        pb = {**_payment(amount=120), "origin_id": p1["id"]}
        ch = _change(data=_shift(payments=[{**p1, "deleted": True}, pa, pb]))
        srv = _sync(api_client, auth_headers, [ch])["results"][0]["server"]
        assert srv["payment_clash"] is True
        srv = _sync(api_client, auth_headers, [_change(id_=ch["id"], base_version=1, data=_shift(payments=[{**p1, "deleted": True}, pa, {**pb, "deleted": True}]))])["results"][0]["server"]
        assert srv["payment_clash"] is False
        assert srv["amount_received"] == 150.0

    def test_separate_payments_not_treated_as_clash(self, api_client, auth_headers, clean):
        srv = _sync(api_client, auth_headers, [_change(data=_shift(payments=[_payment(amount=100), _payment(amount=100)]))])["results"][0]["server"]
        assert srv["payment_clash"] is False
        assert srv["amount_received"] == 200.0

    def test_retry_of_same_change_does_not_duplicate(self, api_client, auth_headers, clean):
        ch = _change(data=_shift(payments=[_payment(amount=100)]))
        _sync(api_client, auth_headers, [ch])
        res = _sync(api_client, auth_headers, [ch])
        assert res["results"][0]["status"] == "duplicate"
        assert res["results"][0]["server"]["amount_received"] == 100.0
        assert len(res["results"][0]["server"]["payments"]) == 1

    def test_invalid_origin_id_rejected(self, api_client, auth_headers, clean):
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers,
                            json={"changes": [_change(data=_shift(payments=[{**_payment(), "origin_id": "bad id!"}]))]})
        assert r.status_code == 422


# ---------------------------------------------------------------- S2 Recently Deleted
class TestRecentlyDeleted:
    def _create_paid(self, api_client, headers):
        ch = _change(data=_shift(payments=[_payment(amount=200)]))
        _sync(api_client, headers, [ch])
        return ch

    def test_delete_keeps_payments_and_sets_deleted_at(self, api_client, auth_headers, clean):
        ch = self._create_paid(api_client, auth_headers)
        srv = _sync(api_client, auth_headers, [{"id": ch["id"], "change_id": _uid(), "base_version": 1, "deleted": True}])["results"][0]["server"]
        assert srv["deleted"] is True and srv["deleted_at"]
        assert len(srv["payments"]) == 1 and srv["amount_received"] == 200.0

    def test_full_pull_includes_recently_deleted(self, api_client, auth_headers, clean):
        ch = self._create_paid(api_client, auth_headers)
        _sync(api_client, auth_headers, [{"id": ch["id"], "change_id": _uid(), "base_version": 1, "deleted": True}])
        found = [s for s in _sync(api_client, auth_headers)["shifts"] if s["id"] == ch["id"]]
        assert found and found[0]["deleted"] is True

    def test_restore_brings_back_shift_and_payments(self, api_client, auth_headers, clean):
        ch = self._create_paid(api_client, auth_headers)
        _sync(api_client, auth_headers, [{"id": ch["id"], "change_id": _uid(), "base_version": 1, "deleted": True}])
        srv = _sync(api_client, auth_headers, [_change(id_=ch["id"], base_version=2, data=ch["data"])])["results"][0]
        assert srv["status"] == "applied"
        assert srv["server"]["deleted"] is False and srv["server"]["deleted_at"] is None
        assert srv["server"]["amount_received"] == 200.0

    def test_purge_after_90_days(self, api_client, auth_headers, clean, mongo_db):
        ch = self._create_paid(api_client, auth_headers)
        _sync(api_client, auth_headers, [{"id": ch["id"], "change_id": _uid(), "base_version": 1, "deleted": True}])
        mongo_db.pp_shifts.update_one({"id": ch["id"]}, {"$set": {"deleted_at": datetime.now(timezone.utc) - timedelta(days=91)}})
        _sync(api_client, auth_headers)
        assert mongo_db.pp_shifts.find_one({"id": ch["id"]}) is None

    def test_not_purged_at_89_days(self, api_client, auth_headers, clean, mongo_db):
        ch = self._create_paid(api_client, auth_headers)
        _sync(api_client, auth_headers, [{"id": ch["id"], "change_id": _uid(), "base_version": 1, "deleted": True}])
        mongo_db.pp_shifts.update_one({"id": ch["id"]}, {"$set": {"deleted_at": datetime.now(timezone.utc) - timedelta(days=89)}})
        res = _sync(api_client, auth_headers)
        assert any(s["id"] == ch["id"] for s in res["shifts"])

    def test_repeat_delete_keeps_original_deleted_at(self, api_client, auth_headers, clean, mongo_db):
        ch = self._create_paid(api_client, auth_headers)
        first = _sync(api_client, auth_headers, [{"id": ch["id"], "change_id": _uid(), "base_version": 1, "deleted": True}])["results"][0]["server"]
        again = _sync(api_client, auth_headers, [{"id": ch["id"], "change_id": _uid(), "base_version": 2, "deleted": True}])["results"][0]["server"]
        assert again["deleted_at"] == first["deleted_at"]


# ---------------------------------------------------------------- report data isolation
class TestIsolation:
    def test_sync_never_returns_another_officers_records(self, api_client, auth_headers, clean, mongo_db):
        other_uid, other_headers = _make_user(api_client, mongo_db, "Other Officer")
        try:
            other = _change(data=_shift(officer_name="Other Officer"))
            _sync(api_client, other_headers, [other])
            mine = _change()
            res = _sync(api_client, auth_headers, [mine])
            ids = {s["id"] for s in res["shifts"]}
            assert mine["id"] in ids and other["id"] not in ids
            # Cannot overwrite or delete another officer's shift either.
            r = _sync(api_client, auth_headers, [{"id": other["id"], "change_id": _uid(), "base_version": 1, "deleted": True}])
            assert r["results"][0]["status"] == "rejected"
            assert mongo_db.pp_shifts.find_one({"id": other["id"]})["deleted"] is False
        finally:
            _drop_user(mongo_db, other_uid)

    def test_unauthenticated_sync_rejected(self, api_client):
        assert api_client.post(f"{API}/shifts/sync", json={"changes": []}).status_code == 401
