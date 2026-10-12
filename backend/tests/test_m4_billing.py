"""Milestone 4 Stage A: Free/Pro entitlements and Google Play subscriptions (mocked Google API).
These are automated MOCK tests; real Google Play sandbox purchases need Stage B (signed build)."""
import base64
import json
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests
from conftest import API

from test_m3b_safeguards import _drop_user, _make_user, _sync
from test_payments_m3a import _change, _payment, _shift, _uid

MONTHLY, ANNUAL = "dutyconnect_pro_monthly", "dutyconnect_pro_annual"


def _env(k):
    from dotenv import dotenv_values
    return dotenv_values("/app/backend/.env")[k]


def _iso(days):
    return (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


@pytest.fixture
def officer(mongo_db):
    s = requests.Session()
    uid, h = _make_user(s, mongo_db, "Billing Tester")
    ref = s.get(f"{API}/billing/entitlement", headers=h).json()["account_ref"]
    yield uid, h, ref
    _drop_user(mongo_db, uid)
    mongo_db.subscriptions.delete_many({"user_id": uid})


def google(mongo_db, token, ref, state="SUBSCRIPTION_STATE_ACTIVE", days=30, product=MONTHLY, ack="ACKNOWLEDGEMENT_STATE_PENDING",
           linked=None, renew=True):
    """Set what the (mock) Google Play Developer API returns for a purchase token."""
    resp = {"subscriptionState": state, "acknowledgementState": ack, "latestOrderId": f"GPA.{token[-6:]}",
            "externalAccountIdentifiers": {"obfuscatedExternalAccountId": ref},
            "lineItems": [{"productId": product, "expiryTime": _iso(days), "autoRenewingPlan": {"autoRenewEnabled": renew}}]}
    if linked:
        resp["linkedPurchaseToken"] = linked
    mongo_db.mock_play.update_one({"token": token}, {"$set": {"response": resp}}, upsert=True)


def verify(h, token, product=MONTHLY):
    return requests.post(f"{API}/billing/verify", headers=h, json={"product_id": product, "purchase_token": token})


def rtdn(token, mid=None, kind="subscriptionNotification", secret=None):
    data = {"packageName": _env("ANDROID_PACKAGE"), kind: {"notificationType": 2, "purchaseToken": token}}
    body = {"message": {"messageId": mid or _uid(), "data": base64.b64encode(json.dumps(data).encode()).decode()}}
    return requests.post(f"{API}/billing/rtdn?secret={secret or _env('RTDN_SHARED_SECRET')}", json=body)


def plan(h):
    return requests.get(f"{API}/me", headers=h).json()["plan"]


class TestEntitlements:
    def test_new_user_is_free_with_limited_features(self, officer):
        _, h, _ = officer
        me = requests.get(f"{API}/me", headers=h).json()
        # Phase B (approved): Free = 7-day history, CSV and PDF are Pro-only, 3 active shifts, 1 template.
        assert me["plan"] == "free" and me["features"]["history_days"] == 7
        assert me["features"]["reports_csv"] is False and me["features"]["reports_pdf"] is False
        assert me["features"]["max_active_shifts"] == 3 and me["features"]["custom_templates"] == 1

    def test_successful_purchase_grants_pro_and_acknowledges_once(self, officer, mongo_db):
        _, h, ref = officer
        tok = "tok-" + _uid()
        google(mongo_db, tok, ref)
        r = verify(h, tok)
        assert r.status_code == 200 and r.json()["plan"] == "pro" and r.json()["will_renew"] is True
        verify(h, tok)  # client retry
        assert mongo_db.mock_play.find_one({"token": tok})["ack_count"] == 1
        assert requests.get(f"{API}/me", headers=h).json()["features"]["multi_device"] is True

    def test_failed_or_unknown_purchase_stays_free(self, officer, mongo_db):
        _, h, ref = officer
        assert verify(h, "tok-unknown-" + _uid()).status_code == 400
        tok = "tok-" + _uid()
        google(mongo_db, tok, ref, state="SUBSCRIPTION_STATE_PENDING")
        assert verify(h, tok).json()["plan"] == "free"
        assert plan(h) == "free"

    def test_wrong_product_rejected(self, officer, mongo_db):
        _, h, ref = officer
        tok = "tok-" + _uid()
        google(mongo_db, tok, ref, product="some_other_app_sku")
        assert verify(h, tok).status_code == 400

    def test_token_cannot_be_used_by_another_account(self, officer, mongo_db):
        _, h, ref = officer
        tok = "tok-" + _uid()
        google(mongo_db, tok, ref)
        assert verify(h, tok).status_code == 200
        uid2, h2 = _make_user(requests.Session(), mongo_db, "Thief")
        try:
            assert verify(h2, tok).status_code == 409
            assert plan(h2) == "free"
        finally:
            _drop_user(mongo_db, uid2)

    def test_purchase_bound_to_other_account_ref_rejected(self, officer, mongo_db):
        _, h, _ = officer
        tok = "tok-" + _uid()
        google(mongo_db, tok, "someone-elses-ref")
        assert verify(h, tok).status_code == 409

    def test_client_cannot_set_plan(self, officer):
        _, h, _ = officer
        r = requests.patch(f"{API}/me", headers=h, json={"plan": "pro", "features": {"reports_pdf": True}})
        assert r.status_code == 200 and r.json()["plan"] == "free"
        r = requests.post(f"{API}/billing/verify", headers=h, json={"product_id": "free_pro_hack", "purchase_token": "x" * 20})
        assert r.status_code == 422

    def test_tokens_stored_encrypted(self, officer, mongo_db):
        uid, h, ref = officer
        tok = "tok-secret-" + _uid()
        google(mongo_db, tok, ref)
        verify(h, tok)
        doc = mongo_db.subscriptions.find_one({"user_id": uid})
        assert tok not in json.dumps(doc, default=str)


class TestLifecycle:
    def _pro(self, officer, mongo_db, **kw):
        _, h, ref = officer
        tok = "tok-" + _uid()
        google(mongo_db, tok, ref, **kw)
        assert verify(h, tok, kw.get("product", MONTHLY)).json()["plan"] == "pro"
        return tok

    def test_renewal_via_notification_extends_expiry(self, officer, mongo_db):
        _, h, ref = officer
        tok = self._pro(officer, mongo_db, days=2)
        google(mongo_db, tok, ref, days=32, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
        assert rtdn(tok).status_code == 200
        exp = requests.get(f"{API}/billing/entitlement", headers=h).json()["expires_at"]
        assert datetime.fromisoformat(exp) > datetime.now(timezone.utc) + timedelta(days=30)

    def test_annual_plan(self, officer, mongo_db):
        _, h, _ = officer
        self._pro(officer, mongo_db, product=ANNUAL, days=365)
        e = requests.get(f"{API}/billing/entitlement", headers=h).json()
        assert e["product_id"] == ANNUAL and e["plan"] == "pro"

    def test_cancel_keeps_pro_until_paid_period_ends_then_free(self, officer, mongo_db):
        _, h, ref = officer
        tok = self._pro(officer, mongo_db)
        google(mongo_db, tok, ref, state="SUBSCRIPTION_STATE_CANCELED", days=10, renew=False, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
        rtdn(tok)
        e = requests.get(f"{API}/billing/entitlement", headers=h).json()
        assert e["plan"] == "pro" and e["will_renew"] is False
        google(mongo_db, tok, ref, state="SUBSCRIPTION_STATE_EXPIRED", days=-1, renew=False, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
        rtdn(tok)
        assert plan(h) == "free"

    def test_missed_notification_reconciled_on_entitlement_check(self, officer, mongo_db):
        uid, h, ref = officer
        tok = self._pro(officer, mongo_db)
        google(mongo_db, tok, ref, state="SUBSCRIPTION_STATE_EXPIRED", days=-1, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
        mongo_db.subscriptions.update_one({"user_id": uid}, {"$set": {"expiry": datetime.now(timezone.utc) - timedelta(hours=1)}})
        assert requests.get(f"{API}/billing/entitlement", headers=h).json()["plan"] == "free"

    @pytest.mark.parametrize("state", ["SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_PAUSED", "SUBSCRIPTION_STATE_EXPIRED"])
    def test_payment_failure_hold_and_expiry_return_to_free(self, officer, mongo_db, state):
        _, h, ref = officer
        tok = self._pro(officer, mongo_db)
        google(mongo_db, tok, ref, state=state, days=-1, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
        rtdn(tok)
        assert plan(h) == "free"

    def test_grace_period_keeps_pro(self, officer, mongo_db):
        _, h, ref = officer
        tok = self._pro(officer, mongo_db)
        google(mongo_db, tok, ref, state="SUBSCRIPTION_STATE_IN_GRACE_PERIOD", days=3, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
        rtdn(tok)
        assert plan(h) == "pro"

    def test_refund_revokes(self, officer, mongo_db):
        _, h, ref = officer
        tok = self._pro(officer, mongo_db)
        google(mongo_db, tok, ref, state="SUBSCRIPTION_STATE_EXPIRED", days=-1, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
        rtdn(tok, kind="voidedPurchaseNotification")
        assert plan(h) == "free"

    def test_duplicate_notification_ignored_and_bad_secret_rejected(self, officer, mongo_db):
        tok = self._pro(officer, mongo_db)
        mid = _uid()
        assert rtdn(tok, mid).json().get("duplicate") is None
        assert rtdn(tok, mid).json()["duplicate"] is True
        assert rtdn(tok, secret="wrong").status_code == 403

    def test_plan_change_linked_token_gives_single_entitlement(self, officer, mongo_db):
        uid, h, ref = officer
        old = self._pro(officer, mongo_db)
        new = "tok-" + _uid()
        google(mongo_db, new, ref, product=ANNUAL, days=365, linked=old)
        assert verify(h, new, ANNUAL).json()["product_id"] == ANNUAL
        subs = list(mongo_db.subscriptions.find({"user_id": uid}))
        assert len([s for s in subs if not s.get("replaced_by")]) == 1

    def test_restore_after_reinstall_or_new_device(self, officer, mongo_db):
        _, h, ref = officer
        tok = "tok-" + _uid()
        google(mongo_db, tok, ref)
        r = requests.post(f"{API}/billing/restore", headers=h, json={"purchases": [{"product_id": MONTHLY, "purchase_token": tok}]})
        assert r.json()["plan"] == "pro" and r.json()["results"] == ["ok"]


class TestOfflinePassAndData:
    def test_signed_pass_never_exceeds_7_days_or_paid_period(self, officer, mongo_db):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        from dotenv import dotenv_values
        _, h, ref = officer
        tok = "tok-" + _uid()
        google(mongo_db, tok, ref, days=3)
        e = verify(h, tok).json()
        body, sig = e["pass"].split(".")
        pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(dotenv_values("/app/frontend/.env")["EXPO_PUBLIC_ENTITLEMENT_PUBLIC_KEY"]))
        pad = lambda s: s + "=" * (-len(s) % 4)  # noqa: E731
        pub.verify(base64.urlsafe_b64decode(pad(sig)), body.encode())  # raises if forged
        claims = json.loads(base64.urlsafe_b64decode(pad(body)))
        assert claims["plan"] == "pro" and claims["exp"] <= (datetime.now(timezone.utc) + timedelta(days=3, minutes=1)).timestamp()
        google(mongo_db, tok, ref, days=60, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
        rtdn(tok)
        claims = json.loads(base64.urlsafe_b64decode(pad(requests.get(f"{API}/billing/entitlement", headers=h).json()["pass"].split(".")[0])))
        assert claims["exp"] <= (datetime.now(timezone.utc) + timedelta(days=7, minutes=1)).timestamp()

    def test_free_single_sync_phone_and_switch(self, officer):
        _, h, _ = officer
        a, b = {**h, "X-Device-Id": "phone-a"}, {**h, "X-Device-Id": "phone-b"}
        _sync(requests.Session(), a, [_change()])
        r = requests.post(f"{API}/shifts/sync", headers=b, json={"changes": []})
        assert r.status_code == 403 and r.json()["detail"] == "pro_required_multi_device"
        assert requests.post(f"{API}/devices/primary", headers=b).status_code == 200
        assert len(_sync(requests.Session(), b)["shifts"]) == 1, "records available on the new sync phone"

    def test_pro_multi_device_and_downgrade_keeps_all_records(self, officer, mongo_db):
        uid, h, ref = officer
        tok = "tok-" + _uid()
        google(mongo_db, tok, ref)
        verify(h, tok)
        a, b = {**h, "X-Device-Id": "phone-a"}, {**h, "X-Device-Id": "phone-b"}
        old = _shift(date=(datetime.now() - timedelta(days=200)).strftime("%Y-%m-%d"), payments=[_payment(amount=10), _payment(amount=20)])
        _sync(requests.Session(), a, [_change(data=old), _change()])
        assert len(_sync(requests.Session(), b)["shifts"]) == 2, "second phone syncs on Pro"
        google(mongo_db, tok, ref, state="SUBSCRIPTION_STATE_EXPIRED", days=-1, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED")
        rtdn(tok)
        assert plan(h) == "free"
        mongo_db.users.update_one({"id": uid}, {"$set": {"sync_device": "phone-b"}})
        shifts = _sync(requests.Session(), b)["shifts"]
        assert len(shifts) == 2, "nothing deleted or hidden after downgrade (incl. 200-day-old shift)"
        assert any(s["amount_received"] == 30.0 for s in shifts), "multiple payments still stored and counted"
