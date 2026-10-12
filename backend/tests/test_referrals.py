"""Phase C: referral codes, attribution, qualification (paid month + 48h, not refunded), admin approval,
rewards (Google deferral for subscribers / free Pro months otherwise), monthly caps and ambassadors."""
from datetime import datetime, timedelta, timezone

import pytest
import requests
from conftest import API

from test_m3b_safeguards import _drop_user, _make_user
from test_m4_billing import google, plan, rtdn, verify
from test_payments_m3a import _uid


@pytest.fixture
def people(mongo_db):
    made = []

    def make(name="Ref Tester", admin=False):
        uid, h = _make_user(requests.Session(), mongo_db, name)
        if admin:
            mongo_db.users.update_one({"id": uid}, {"$set": {"is_admin": True}})
        made.append(uid)
        return uid, h

    yield make
    for uid in made:
        _drop_user(mongo_db, uid)
        mongo_db.subscriptions.delete_many({"user_id": uid})
        mongo_db.referrals.delete_many({"$or": [{"referrer_id": uid}, {"friend_id": uid}]})


def me(h):
    r = requests.get(f"{API}/referrals/me", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def apply(h, code):
    return requests.post(f"{API}/referrals/apply", headers=h, json={"code": code})


def subscribe(mongo_db, uid, h, renew=True):
    ref = requests.get(f"{API}/billing/entitlement", headers=h).json()["account_ref"]
    tok = "tok-" + _uid()
    google(mongo_db, tok, ref, renew=renew)
    assert verify(h, tok).status_code == 200
    return tok


def fast_forward(mongo_db, friend_id):
    """Pretend the first paid month and the 48-hour refund window have passed."""
    past = datetime.now(timezone.utc) - timedelta(days=31)
    mongo_db.referrals.update_one({"friend_id": friend_id}, {"$set": {"first_paid_at": past, "qualifies_at": past + timedelta(days=30, hours=48) - timedelta(days=5)}})


def admin_list(h, status=None):
    r = requests.get(f"{API}/admin/referrals", headers=h, params={"status": status} if status else None)
    assert r.status_code == 200, r.text
    return r.json()["referrals"]


def linked_pair(people, mongo_db):
    ref_id, ref_h = people("Referrer")
    friend_id, friend_h = people("Friend")
    assert apply(friend_h, me(ref_h)["code"]).status_code == 200
    return ref_id, ref_h, friend_id, friend_h


class TestCodes:
    def test_code_is_stable_and_unique(self, people):
        _, a = people()
        _, b = people()
        ca = me(a)["code"]
        assert len(ca) == 8 and me(a)["code"] == ca and me(b)["code"] != ca

    def test_apply_rules(self, people, mongo_db):
        ref_id, ref_h = people()
        friend_id, friend_h = people()
        code = me(ref_h)["code"]
        assert apply(ref_h, code).status_code == 400, "own code"
        assert apply(friend_h, "NOPE1234").status_code == 400
        assert apply(friend_h, code.lower()).status_code == 200, "case-insensitive"
        assert apply(friend_h, code).json()["detail"].startswith("A referral code has already")
        assert me(friend_h)["can_apply_code"] is False and me(friend_h)["my_referral_status"] == "signed_up"
        rec = me(ref_h)["referrals"]
        assert len(rec) == 1 and rec[0]["status"] == "signed_up" and "friend_id" not in rec[0], "friend never identified"

    def test_cannot_apply_after_subscribing_or_window(self, people, mongo_db):
        _, ref_h = people()
        uid, h = people()
        subscribe(mongo_db, uid, h)
        assert "before your first subscription" in apply(h, me(ref_h)["code"]).json()["detail"]
        uid2, h2 = people()
        mongo_db.users.update_one({"id": uid2}, {"$set": {"created_at": datetime.now(timezone.utc) - timedelta(days=15)}})
        assert "within 14 days" in apply(h2, me(ref_h)["code"]).json()["detail"]

    def test_code_at_registration(self, people, mongo_db):
        _, ref_h = people()
        code = me(ref_h)["code"]
        email = f"refreg_{_uid()[:8]}@example.com"
        r = requests.post(f"{API}/auth/register", json={"full_name": "New Friend", "email": email, "password": "RefTestPass123", "referral_code": code})
        assert r.status_code == 202
        u = mongo_db.users.find_one({"email": email})
        try:
            assert u["referred_by"] and mongo_db.referrals.find_one({"friend_id": u["id"]})["status"] == "signed_up"
        finally:
            mongo_db.referrals.delete_many({"friend_id": u["id"]})
            mongo_db.users.delete_one({"id": u["id"]})
        bad = requests.post(f"{API}/auth/register", json={"full_name": "X Friend", "email": f"refbad_{_uid()[:8]}@example.com",
                                                          "password": "RefTestPass123", "referral_code": "BADCODE1"})
        assert bad.status_code == 202, "invalid code never blocks or reveals anything at sign-up"
        mongo_db.users.delete_many({"email": {"$regex": "^refbad_"}})


class TestQualification:
    def test_payment_starts_qualifying_then_awaits_approval(self, people, mongo_db):
        _, ref_h, fid, fh = linked_pair(people, mongo_db)
        _, admin_h = people("Admin", admin=True)
        subscribe(mongo_db, fid, fh)
        rec = mongo_db.referrals.find_one({"friend_id": fid})
        assert rec["status"] == "paid"
        assert rec["qualifies_at"] - rec["first_paid_at"] == timedelta(days=30, hours=48)
        admin_list(admin_h)
        assert mongo_db.referrals.find_one({"friend_id": fid})["status"] == "paid", "not before the month + 48h"
        fast_forward(mongo_db, fid)
        assert [x["status"] for x in admin_list(admin_h) if x["friend_id"] == fid] == ["awaiting_approval"]

    def test_refunded_payment_is_cancelled(self, people, mongo_db):
        _, _, fid, fh = linked_pair(people, mongo_db)
        _, admin_h = people("Admin", admin=True)
        tok = subscribe(mongo_db, fid, fh)
        assert rtdn(tok, kind="voidedPurchaseNotification").status_code == 200
        fast_forward(mongo_db, fid)
        rec = next(x for x in admin_list(admin_h) if x["friend_id"] == fid)
        assert rec["status"] == "cancelled" and "refunded" in rec["reason"]


class TestRewards:
    def test_approve_rewards_both_once(self, people, mongo_db):
        rid_user, ref_h, fid, fh = linked_pair(people, mongo_db)
        _, admin_h = people("Admin", admin=True)
        tok = subscribe(mongo_db, fid, fh)
        before = mongo_db.subscriptions.find_one({"user_id": fid})["expiry"]
        fast_forward(mongo_db, fid)
        rec = next(x for x in admin_list(admin_h) if x["friend_id"] == fid)
        r = requests.post(f"{API}/admin/referrals/{rec['id']}/approve", headers=admin_h)
        assert r.status_code == 200 and r.json() == {"ok": True, "friend_reward": "deferred", "referrer_reward": "bonus"}
        after = mongo_db.subscriptions.find_one({"user_id": fid})["expiry"]
        assert timedelta(days=29) < after - before <= timedelta(days=30, seconds=5), "friend's renewal deferred by a month"
        assert plan(ref_h) == "pro", "free referrer gets a free Pro month"
        ent = requests.get(f"{API}/billing/entitlement", headers=ref_h).json()
        assert ent["plan"] == "pro" and ent["bonus_pro_until"] and ent["pass"]
        assert requests.post(f"{API}/admin/referrals/{rec['id']}/approve", headers=admin_h).status_code == 409, "never twice"
        assert me(ref_h)["referrals"][0]["referrer_reward"] == "bonus"
        assert tok

    def test_bonus_expires_back_to_free(self, people, mongo_db):
        uid, h = people()
        mongo_db.users.update_one({"id": uid}, {"$set": {"bonus_pro_until": datetime.now(timezone.utc) - timedelta(minutes=1)}})
        assert requests.get(f"{API}/billing/entitlement", headers=h).json()["plan"] == "free"

    def test_monthly_cap_and_ambassador(self, people, mongo_db):
        ref_id, ref_h = people("Capped Referrer")
        _, admin_h = people("Admin", admin=True)
        code = me(ref_h)["code"]
        assert requests.patch(f"{API}/admin/members/{ref_id}", headers=admin_h, json={"referral_cap": 1}).json()["monthly_cap"] == 1
        rewards = []
        for i in range(2):
            fid, fh = people(f"Friend {i}")
            assert apply(fh, code).status_code == 200
            subscribe(mongo_db, fid, fh)
            fast_forward(mongo_db, fid)
            rec = next(x for x in admin_list(admin_h, "awaiting_approval") if x["friend_id"] == fid)
            rewards.append(requests.post(f"{API}/admin/referrals/{rec['id']}/approve", headers=admin_h).json()["referrer_reward"])
        assert rewards == ["bonus", "capped"], "friend still rewarded; referrer capped"
        m = requests.get(f"{API}/admin/members", headers=admin_h, params={"email": mongo_db.users.find_one({"id": ref_id})["email"]}).json()
        assert m["monthly_cap"] == 1
        r = requests.patch(f"{API}/admin/members/{ref_id}", headers=admin_h, json={"ambassador": True, "clear_cap": True}).json()
        assert r["ambassador"] is True and r["referral_cap"] is None and r["monthly_cap"] == 10

    def test_cancel(self, people, mongo_db):
        _, _, fid, _ = linked_pair(people, mongo_db)
        _, admin_h = people("Admin", admin=True)
        rec = next(x for x in admin_list(admin_h) if x["friend_id"] == fid)
        assert requests.post(f"{API}/admin/referrals/{rec['id']}/cancel", headers=admin_h, json={"reason": "Duplicate account"}).status_code == 200
        assert requests.post(f"{API}/admin/referrals/{rec['id']}/approve", headers=admin_h).status_code == 409


class TestAdminAccess:
    def test_non_admin_blocked(self, people):
        uid, h = people()
        assert requests.get(f"{API}/admin/referrals", headers=h).status_code == 403
        assert requests.post(f"{API}/admin/referrals/x/approve", headers=h).status_code == 403
        assert requests.patch(f"{API}/admin/members/{uid}", headers=h, json={"referral_cap": 50}).status_code == 403
        assert requests.get(f"{API}/me", headers=h).json()["is_admin"] is False
