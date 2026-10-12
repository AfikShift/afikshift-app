"""Corrective update: Bed Watch / Constant Watch as optional built-in specialist presets.
Original ids kept, records untouched, setting persisted on the profile, not a custom template,
shifts still count towards the Free 3-active limit, create/edit/sync across two devices."""
from datetime import date, timedelta

import pytest
import requests
from conftest import API

from test_m3b_safeguards import _drop_user, _make_user, _sync
from test_m4_billing import google, verify
from test_payments_m3a import _change, _payment, _shift, _uid

PRESETS = ("bed_watch", "constant_watch")


def _future(days):
    return (date.today() + timedelta(days=days)).isoformat()


@pytest.fixture
def user(mongo_db):
    s = requests.Session()
    uid, h = _make_user(s, mongo_db, "Preset Tester")
    yield uid, h, s
    _drop_user(mongo_db, uid)
    mongo_db.subscriptions.delete_many({"user_id": uid})


def _me(s, h):
    r = s.get(f"{API}/me", headers=h)
    assert r.status_code == 200
    return r.json()


class TestSetting:
    def test_hidden_by_default_and_persists(self, user):
        _, h, s = user
        assert _me(s, h)["specialist_presets"] is False
        r = s.patch(f"{API}/me", headers=h, json={"specialist_presets": True})
        assert r.status_code == 200 and r.json()["specialist_presets"] is True
        assert _me(s, h)["specialist_presets"] is True, "kept for next app start / other devices"
        assert s.patch(f"{API}/me", headers=h, json={"full_name": "Renamed Tester"}).json()["specialist_presets"] is True

    def test_presets_do_not_use_free_template_allowance(self, user):
        _, h, s = user
        s.patch(f"{API}/me", headers=h, json={"specialist_presets": True})
        r = s.patch(f"{API}/me", headers=h, json={"shift_templates": [{"id": "t_one", "label": "Weekend"}]})
        assert r.status_code == 200, "Free user can still add their one custom template"
        assert len(r.json()["shift_templates"]) == 1
        r2 = s.patch(f"{API}/me", headers=h, json={"shift_templates": [{"id": "t_one", "label": "Weekend"}, {"id": "t_two", "label": "Late"}]})
        assert r2.status_code == 403 and r2.json()["detail"] == "pro_required_templates"

    def test_toggling_off_never_changes_shifts(self, user, mongo_db):
        uid, h, s = user
        s.patch(f"{API}/me", headers=h, json={"specialist_presets": True})
        chs = [_change(data=_shift(duty_type=d, date=(date.today() - timedelta(days=2)).isoformat())) for d in PRESETS]
        _sync(s, h, chs)
        before = {d["id"]: d for d in mongo_db.pp_shifts.find({"user_id": uid}, {"_id": 0})}
        s.patch(f"{API}/me", headers=h, json={"specialist_presets": False})
        after = {d["id"]: d for d in mongo_db.pp_shifts.find({"user_id": uid}, {"_id": 0})}
        assert before == after
        pulled = {x["id"]: x for x in _sync(s, h)["shifts"]}
        assert {pulled[c["id"]]["duty_type"] for c in chs} == set(PRESETS)


class TestShifts:
    def test_create_edit_keeps_ids_rate_and_payments(self, user):
        _, h, s = user
        past = (date.today() - timedelta(days=1)).isoformat()
        for d in PRESETS:
            c = _change(data=_shift(duty_type=d, date=past, hourly_rate=30, payments=[_payment(100)]))
            assert _sync(s, h, [c])["results"][0]["status"] == "applied"
            edit = _shift(duty_type=d, date=past, end_time="18:00", hourly_rate=30, location="Ward 2", payments=c["data"]["payments"])
            r = _sync(s, h, [_change(id_=c["id"], base_version=1, data=edit)])
            assert r["results"][0]["status"] == "applied"
            got = next(x for x in _sync(s, h)["shifts"] if x["id"] == c["id"])
            assert got["duty_type"] == d and got["end_time"] == "18:00" and got["hourly_rate"] == 30
            assert [p["amount"] for p in got["payments"] if not p["deleted"]] == [100]
            assert got["estimated_earnings"] == 300 and got["payment_status"] == "partially_paid"  # 10h x £30, £100 received

    def test_presets_count_towards_free_three_active_limit(self, user, mongo_db):
        uid, h, s = user
        chs = [_change(data=_shift(duty_type=d, date=_future(i + 1), status="booked"))
               for i, d in enumerate(("bed_watch", "constant_watch", "standard", "bed_watch"))]
        assert [r["status"] for r in _sync(s, h, chs)["results"]] == ["applied", "applied", "applied", "limit"]
        assert mongo_db.pp_shifts.count_documents({"user_id": uid}) == 3

    def test_two_devices_sync_both_presets(self, user, mongo_db):
        uid, h, s = user
        ref = s.get(f"{API}/billing/entitlement", headers=h).json()["account_ref"]
        tok = "tok-" + _uid()
        google(mongo_db, tok, ref)
        verify(h, tok)  # multi-device sync is a Pro feature
        a, b = {**h, "X-Device-Id": "phone-a"}, {**h, "X-Device-Id": "phone-b"}
        c = _change(data=_shift(duty_type="bed_watch", date=_future(3), status="booked"))
        assert _sync(s, a, [c])["results"][0]["status"] == "applied"
        on_b = next(x for x in _sync(s, b)["shifts"] if x["id"] == c["id"])
        assert on_b["duty_type"] == "bed_watch"
        r = _sync(s, b, [_change(id_=c["id"], base_version=on_b["version"], data={**c["data"], "duty_type": "constant_watch"})])
        assert r["results"][0]["status"] == "applied"
        on_a = next(x for x in _sync(s, a)["shifts"] if x["id"] == c["id"])
        assert on_a["duty_type"] == "constant_watch" and on_a["version"] == on_b["version"] + 1

    def test_data_download_includes_setting(self, user):
        _, h, s = user
        s.patch(f"{API}/me", headers=h, json={"specialist_presets": True})
        r = s.get(f"{API}/me/data-download", headers=h)
        assert r.status_code == 200 and r.json()["profile"]["specialist_presets"] is True
