"""Admin dashboard: overview totals, programme switches (with their effects) and the activity log."""
import pytest
import requests
from conftest import API

from test_referrals import apply, me, people  # noqa: F401  (fixture re-used)


@pytest.fixture(autouse=True)
def restore_programmes(mongo_db):
    yield
    mongo_db.settings.delete_one({"_id": "programmes"})


def switch(h, **kw):
    r = requests.patch(f"{API}/admin/programmes", headers=h, json=kw)
    assert r.status_code == 200, r.text
    return r.json()


def test_overview_totals_only(people):
    _, admin_h = people("Admin", admin=True)
    o = requests.get(f"{API}/admin/overview", headers=admin_h).json()
    for k in ("members", "pro", "free", "new_this_week", "referrals_waiting", "rewards_this_month", "programmes"):
        assert k in o
    assert o["members"] == o["pro"] + o["free"] and "@" not in str(o), "no personal details"


def test_non_admin_blocked(people):
    _, h = people()
    for path in ("/admin/overview", "/admin/activity"):
        assert requests.get(f"{API}{path}", headers=h).status_code == 403
    assert requests.patch(f"{API}/admin/programmes", headers=h, json={"referrals": False}).status_code == 403


def test_referrals_off_stops_new_codes_and_is_logged(people):
    _, admin_h = people("Admin", admin=True)
    _, ref_h = people("Referrer")
    _, friend_h = people("Friend")
    assert requests.get(f"{API}/programmes").json() == {"referrals": True, "ambassadors": True}
    assert switch(admin_h, referrals=False)["referrals"] is False
    assert requests.get(f"{API}/programmes").json()["referrals"] is False
    r = apply(friend_h, me(ref_h)["code"])
    assert r.status_code == 400 and "paused" in r.json()["detail"]
    assert me(friend_h)["enabled"] is False and me(friend_h)["can_apply_code"] is False
    log = requests.get(f"{API}/admin/activity", headers=admin_h).json()["activity"]
    assert log[0]["action"] == "programme_off" and log[0]["detail"] == "referrals"
    switch(admin_h, referrals=True)
    assert apply(friend_h, me(ref_h)["code"]).status_code == 200


def test_ambassadors_off(people, mongo_db):
    _, admin_h = people("Admin", admin=True)
    uid, h = people()
    mongo_db.users.update_one({"id": uid}, {"$set": {"ambassador": True}})
    assert me(h)["monthly_cap"] == 10
    switch(admin_h, ambassadors=False)
    assert me(h)["monthly_cap"] == 3 and me(h)["ambassador"] is False


def test_owner_grants_and_removes_free_pro(people, mongo_db):
    _, admin_h = people("Admin", admin=True)
    uid, h = people("Customer")
    assert requests.post(f"{API}/admin/members/{uid}/free-pro", headers=h, json={"days": 30}).status_code == 403
    r = requests.post(f"{API}/admin/members/{uid}/free-pro", headers=admin_h, json={"days": 90})
    assert r.status_code == 200 and r.json()["plan"] == "pro" and r.json()["free_pro_until"]
    assert requests.get(f"{API}/billing/entitlement", headers=h).json()["plan"] == "pro"
    email = mongo_db.users.find_one({"id": uid})["email"]
    assert requests.get(f"{API}/admin/members", headers=admin_h, params={"email": email}).json()["free_pro_until"]
    assert requests.post(f"{API}/admin/members/{uid}/free-pro", headers=admin_h, json={"days": 0}).status_code == 422
    r = requests.post(f"{API}/admin/members/{uid}/free-pro", headers=admin_h, json={"revoke": True})
    assert r.json() == {"plan": "free", "free_pro_until": None}
    log = requests.get(f"{API}/admin/activity", headers=admin_h).json()["activity"]
    assert [x["action"] for x in log[:2]] == ["free_pro_removed", "free_pro_granted"]
