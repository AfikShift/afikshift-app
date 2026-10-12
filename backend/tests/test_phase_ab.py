"""Phases A + B: neutral shift types/templates, Free limits (3 active shifts, templates), free JSON
data download. Records are never discarded by plan limits."""
from datetime import date, timedelta

import pytest
import requests
from conftest import API

from test_m3b_safeguards import _drop_user, _make_user, _sync
from test_m4_billing import MONTHLY, google, rtdn, verify
from test_payments_m3a import _change, _payment, _shift, _uid


def _future(days=5):
    return (date.today() + timedelta(days=days)).isoformat()


@pytest.fixture
def free_user(mongo_db):
    s = requests.Session()
    uid, h = _make_user(s, mongo_db, "Phase B Tester")
    ref = s.get(f"{API}/billing/entitlement", headers=h).json()["account_ref"]
    yield uid, h, ref
    _drop_user(mongo_db, uid)
    mongo_db.subscriptions.delete_many({"user_id": uid})


def _booked(days=5, **kw):
    return _shift(date=_future(days), status="booked", **kw)


class TestActiveShiftLimit:
    def test_fourth_active_shift_is_held_not_discarded(self, free_user, mongo_db):
        uid, h, _ = free_user
        res = _sync(requests.Session(), h, [_change(data=_booked(d)) for d in (1, 2, 3, 4)])
        statuses = [r["status"] for r in res["results"]]
        assert statuses == ["applied", "applied", "applied", "limit"]
        assert mongo_db.pp_shifts.count_documents({"user_id": uid}) == 3

    def test_completed_and_past_shifts_do_not_count(self, free_user):
        _, h, _ = free_user
        past = [_change(data=_shift(date=(date.today() - timedelta(days=d)).isoformat(), status="completed")) for d in (1, 2, 3, 4)]
        res = _sync(requests.Session(), h, past + [_change(data=_booked(d)) for d in (1, 2, 3)])
        assert all(r["status"] == "applied" for r in res["results"])

    def test_edit_existing_active_allowed_but_reactivating_blocked(self, free_user):
        _, h, _ = free_user
        chs = [_change(data=_booked(d)) for d in (1, 2, 3)]
        old = _change(data=_shift(date=(date.today() - timedelta(days=2)).isoformat(), status="completed"))
        _sync(requests.Session(), h, chs + [old])
        edit = _sync(requests.Session(), h, [_change(id_=chs[0]["id"], base_version=1, data=_booked(9, location="Moved"))])
        assert edit["results"][0]["status"] == "applied"
        bypass = _sync(requests.Session(), h, [_change(id_=old["id"], base_version=1, data=_booked(10))])
        assert bypass["results"][0]["status"] == "limit", "editing a past shift into a new booking can't bypass"

    def test_completing_frees_a_slot_and_held_shift_then_syncs(self, free_user):
        _, h, _ = free_user
        chs = [_change(data=_booked(d)) for d in (1, 2, 3)]
        held = _change(data=_booked(4))
        _sync(requests.Session(), h, chs)
        assert _sync(requests.Session(), h, [held])["results"][0]["status"] == "limit"
        _sync(requests.Session(), h, [_change(id_=chs[0]["id"], base_version=1, data=_shift(date=_future(1), status="cancelled"))])
        assert _sync(requests.Session(), h, [held])["results"][0]["status"] == "applied"

    def test_restore_from_recently_deleted_respects_limit(self, free_user):
        _, h, _ = free_user
        chs = [_change(data=_booked(d)) for d in (1, 2, 3)]
        _sync(requests.Session(), h, chs)
        _sync(requests.Session(), h, [{"id": chs[0]["id"], "change_id": _uid(), "base_version": 1, "deleted": True}])
        _sync(requests.Session(), h, [_change(data=_booked(7))])
        r = _sync(requests.Session(), h, [_change(id_=chs[0]["id"], base_version=2, data=chs[0]["data"])])
        assert r["results"][0]["status"] == "limit"

    def test_pro_unlimited_and_downgrade_keeps_everything(self, free_user, mongo_db):
        uid, h, ref = free_user
        tok = "tok-" + _uid()
        google(mongo_db, tok, ref)
        verify(h, tok)
        res = _sync(requests.Session(), h, [_change(data=_booked(d, payments=[_payment(10), _payment(5)])) for d in range(1, 7)])
        assert all(r["status"] == "applied" for r in res["results"])
        google(mongo_db, tok, ref, state="SUBSCRIPTION_STATE_EXPIRED", days=-1, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
        rtdn(tok)
        shifts = _sync(requests.Session(), h)["shifts"]
        assert len(shifts) == 6 and all(s["amount_received"] == 15.0 for s in shifts), "nothing deleted after downgrade"
        assert _sync(requests.Session(), h, [_change(data=_booked(20))])["results"][0]["status"] == "limit"


class TestShiftTypesAndTemplates:
    def test_neutral_builtin_custom_and_legacy_types_accepted(self, free_user):
        _, h, _ = free_user
        res = _sync(requests.Session(), h, [_change(data=_shift(duty_type=t)) for t in ("standard", "overtime", "t_abc123", "bed_watch")])
        assert all(r["status"] == "applied" for r in res["results"])

    def test_invalid_type_rejected(self, free_user):
        _, h, _ = free_user
        r = requests.post(f"{API}/shifts/sync", headers=h, json={"changes": [_change(data=_shift(duty_type="Bad Type!"))]})
        assert r.status_code == 422

    def test_free_one_template_pro_unlimited(self, free_user, mongo_db):
        _, h, ref = free_user
        t = lambda i: {"id": f"t_{i}", "label": f"Template {i}", "start_time": "08:00", "end_time": "16:00"}  # noqa: E731
        assert requests.patch(f"{API}/me", headers=h, json={"shift_templates": [t(1)]}).status_code == 200
        r = requests.patch(f"{API}/me", headers=h, json={"shift_templates": [t(1), t(2)]})
        assert r.status_code == 403 and r.json()["detail"] == "pro_required_templates"
        tok = "tok-" + _uid()
        google(mongo_db, tok, ref)
        verify(h, tok)
        assert requests.patch(f"{API}/me", headers=h, json={"shift_templates": [t(1), t(2), t(3)]}).status_code == 200
        google(mongo_db, tok, ref, state="SUBSCRIPTION_STATE_EXPIRED", days=-1, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
        rtdn(tok)
        me = requests.get(f"{API}/me", headers=h).json()
        assert len(me["shift_templates"]) == 3, "templates kept after downgrade"
        assert requests.patch(f"{API}/me", headers=h, json={"shift_templates": [t(1), t(2)]}).status_code == 200, "removing allowed"
        assert requests.patch(f"{API}/me", headers=h, json={"shift_templates": [t(1), t(2), t(4)]}).status_code == 403

    def test_template_sensitive_label_rejected(self, free_user):
        _, h, _ = free_user
        r = requests.patch(f"{API}/me", headers=h, json={"shift_templates": [{"id": "t_x", "label": "A1234BC watch"}]})
        assert r.status_code in (400, 422)

    def test_neutral_categories(self):
        cats = requests.get(f"{API}/config").json()["professional_categories"]
        assert "Healthcare" in cats and "Security" in cats


class TestDataDownload:
    def test_free_user_gets_all_own_records_once_per_week(self, free_user, mongo_db):
        uid, h, _ = free_user
        old = _shift(date=(date.today() - timedelta(days=200)).isoformat(), status="completed", payments=[_payment(12)])
        _sync(requests.Session(), h, [_change(data=old), _change(data=_booked(2))])
        other_uid, oh = _make_user(requests.Session(), mongo_db, "Other User")
        try:
            _sync(requests.Session(), oh, [_change(data=_shift(location="Other place"))])
            r = requests.get(f"{API}/me/data-download", headers=h)
            assert r.status_code == 200
            d = r.json()
            assert d["profile"]["full_name"] == "Phase B Tester" and len(d["shifts"]) == 2
            assert "password_hash" not in str(d) and "Other place" not in str(d) and other_uid not in str(d)
            assert any(s["payments"] for s in d["shifts"]), "older history and payments included"
            again = requests.get(f"{API}/me/data-download", headers=h)
            assert again.status_code == 429 and "free" in again.json()["detail"].lower()
        finally:
            _drop_user(mongo_db, other_uid)

    def test_requires_login(self):
        assert requests.get(f"{API}/me/data-download").status_code == 401
