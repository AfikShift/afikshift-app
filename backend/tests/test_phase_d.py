"""Phase D: ambassador totals, fraud flags (burst / look-alike email / quick refund) that hold referrals for
admin review, and the user's tax rate for after-tax display."""
import requests
from conftest import API

from test_m4_billing import rtdn
from test_referrals import admin_list, apply, fast_forward, me, people, subscribe  # noqa: F401


def test_totals_and_rewards_left(people, mongo_db):
    _, ref_h = people("Referrer")
    _, admin_h = people("Admin", admin=True)
    code = me(ref_h)["code"]
    fid, fh = people("Friend A")
    apply(fh, code)
    subscribe(mongo_db, fid, fh)
    fast_forward(mongo_db, fid)
    rec = next(x for x in admin_list(admin_h) if x["friend_id"] == fid)
    requests.post(f"{API}/admin/referrals/{rec['id']}/approve", headers=admin_h)
    _, gh = people("Friend B")
    apply(gh, code)
    d = me(ref_h)
    assert d["all_time"] == {"signed_up": 2, "qualifying": 0, "qualified": 1, "rewarded": 1}
    assert d["this_month"]["signed_up"] == 2
    assert d["rewards_left_this_month"] == 2


def test_burst_flag_holds_referral(people, mongo_db):
    _, ref_h = people("Busy Referrer")
    _, admin_h = people("Admin", admin=True)
    code = me(ref_h)["code"]
    friends = []
    for i in range(6):
        fid, fh = people(f"Burst {i}")
        assert apply(fh, code).status_code == 200
        friends.append((fid, fh))
    flags = [mongo_db.referrals.find_one({"friend_id": f})["flags"] for f, _ in friends]
    assert flags[:5] == [[]] * 5 and flags[5] == ["burst"]
    fid, fh = friends[5]
    subscribe(mongo_db, fid, fh)
    fast_forward(mongo_db, fid)
    rec = next(x for x in admin_list(admin_h, "held") if x["friend_id"] == fid)
    assert rec["warnings"] == ["Many sign-ups on this code within 24 hours"]
    assert requests.get(f"{API}/admin/overview", headers=admin_h).json()["referrals_held"] >= 1
    # the member only sees "being checked"; the admin reviews and approves
    assert next(x for x in me(ref_h)["referrals"] if x["id"] == rec["id"])["status"] == "awaiting_approval"
    assert requests.post(f"{API}/admin/referrals/{rec['id']}/approve", headers=admin_h).status_code == 200


def test_similar_email_flag(people, mongo_db):
    ref_id, ref_h = people("Referrer")
    fid, fh = people("Friend")
    ref_email = mongo_db.users.find_one({"id": ref_id})["email"]
    local, domain = ref_email.split("@")
    mongo_db.users.update_one({"id": fid}, {"$set": {"email": f"{local}+alt7@{domain}"}})
    assert apply(fh, me(ref_h)["code"]).status_code == 200
    assert mongo_db.referrals.find_one({"friend_id": fid})["flags"] == ["similar_email"]


def test_quick_refund_flagged_and_cancelled(people, mongo_db):
    _, ref_h = people()
    _, admin_h = people("Admin", admin=True)
    fid, fh = people()
    apply(fh, me(ref_h)["code"])
    tok = subscribe(mongo_db, fid, fh)
    rtdn(tok, kind="voidedPurchaseNotification")
    fast_forward(mongo_db, fid)
    rec = next(x for x in admin_list(admin_h) if x["friend_id"] == fid)
    assert rec["status"] == "cancelled" and "Friend refunded soon after paying" in rec["warnings"]


def test_tax_rate(people):
    _, h = people()
    assert requests.get(f"{API}/me", headers=h).json()["tax_rate"] is None
    assert requests.patch(f"{API}/me", headers=h, json={"tax_rate": 20}).json()["tax_rate"] == 20
    assert requests.patch(f"{API}/me", headers=h, json={"tax_rate": 75}).status_code == 422
    assert requests.patch(f"{API}/me", headers=h, json={"clear_tax_rate": True}).json()["tax_rate"] is None
