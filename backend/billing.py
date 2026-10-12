"""Google Play subscriptions: server-side verification, acknowledgement, real-time notifications and
entitlements. Pro is granted ONLY from Google's own subscription record (subscriptionsv2), never from
anything the app claims. BILLING_MODE=mock uses a test double (collection `mock_play`) so the full flow
can be built and tested before Play Console exists; the production path uses a service account.
"""
import asyncio
import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from typing import List, Literal

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

MODE = os.environ.get("BILLING_MODE", "mock")
PACKAGE = os.environ.get("ANDROID_PACKAGE", "")
PRODUCTS = {"dutyconnect_pro_monthly", "dutyconnect_pro_annual"}
PASS_DAYS = 7  # offline Pro pass never outlives the paid period or 7 days
PRO_STATES = {"SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"}
_SIGNING = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(os.environ["ENTITLEMENT_SIGNING_KEY"]))
_AES = AESGCM(bytes.fromhex(os.environ["BILLING_TOKEN_KEY"]))
_REF_KEY = os.environ["JWT_SECRET"].encode()


def now():
    return datetime.now(timezone.utc)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def account_ref(user_id: str) -> str:
    """Opaque id passed to Google at purchase (obfuscatedAccountIdAndroid) to bind a purchase to an account."""
    return hmac.new(_REF_KEY, user_id.encode(), hashlib.sha256).hexdigest()[:64]


def seal(token: str) -> str:
    nonce = os.urandom(12)
    return (nonce + _AES.encrypt(nonce, token.encode(), None)).hex()


def unseal(blob: str) -> str:
    raw = bytes.fromhex(blob)
    return _AES.decrypt(raw[:12], raw[12:], None).decode()


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def sign_pass(user_id: str, plan: str, until: datetime) -> str:
    body = b64(json.dumps({"sub": user_id, "plan": plan, "exp": int(until.timestamp()), "iat": int(now().timestamp())},
                          separators=(",", ":")).encode())
    return f"{body}.{b64(_SIGNING.sign(body.encode()))}"


def parse_time(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


# ---------------------------------------------------------------- Google Play API (real or mock)
class Google:
    def __init__(self, db):
        self.db = db
        self._session = None

    def _authed(self):
        if self._session is None:
            from google.oauth2 import service_account
            from google.auth.transport.requests import AuthorizedSession
            creds = service_account.Credentials.from_service_account_file(
                os.environ["GOOGLE_SERVICE_ACCOUNT_FILE"], scopes=["https://www.googleapis.com/auth/androidpublisher"])
            self._session = AuthorizedSession(creds)
        return self._session

    async def get(self, token: str):
        if MODE == "mock":
            doc = await self.db.mock_play.find_one({"token": token}, {"_id": 0})
            return doc["response"] if doc else None
        url = (f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}"
               f"/purchases/subscriptionsv2/tokens/{token}")
        r = await asyncio.to_thread(self._authed().get, url, timeout=20)
        if r.status_code in (400, 404, 410):
            return None
        r.raise_for_status()
        return r.json()

    async def acknowledge(self, product: str, token: str):
        if MODE == "mock":
            await self.db.mock_play.update_one({"token": token}, {"$set": {
                "response.acknowledgementState": "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"}, "$inc": {"ack_count": 1}})
            return
        url = (f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}"
               f"/purchases/subscriptions/{product}/tokens/{token}:acknowledge")
        r = await asyncio.to_thread(self._authed().post, url, json={}, timeout=20)
        r.raise_for_status()


class PurchaseIn(BaseModel):
    product_id: Literal["dutyconnect_pro_monthly", "dutyconnect_pro_annual"]
    purchase_token: str = Field(min_length=10, max_length=4096)


class RestoreIn(BaseModel):
    purchases: List[PurchaseIn] = Field(default_factory=list, max_length=20)


def make_router(db, current_user, logger) -> APIRouter:
    google = Google(db)
    r = APIRouter(prefix="/api/billing")

    async def apply_google_state(token: str, user_id: str | None):
        """Fetch Google's record and store it. Returns (subscription doc or None, error)."""
        g = await google.get(token)
        th = token_hash(token)
        existing = await db.subscriptions.find_one({"token_hash": th})
        if not g:
            return None, "not_found"
        items = [i for i in g.get("lineItems", []) if i.get("productId") in PRODUCTS]
        if not items:
            return None, "wrong_product"
        ref = (g.get("externalAccountIdentifiers") or {}).get("obfuscatedExternalAccountId")
        owner = existing["user_id"] if existing else user_id
        if not owner:
            return None, "unknown_owner"
        if (existing and user_id and existing["user_id"] != user_id) or (ref and ref != account_ref(owner)):
            return None, "other_account"
        item = max(items, key=lambda i: i.get("expiryTime", ""))
        doc = {"token_hash": th, "token_enc": seal(token), "user_id": owner, "product_id": item["productId"],
               "state": g.get("subscriptionState"), "expiry": parse_time(item.get("expiryTime")),
               "auto_renew": bool((item.get("autoRenewingPlan") or {}).get("autoRenewEnabled")),
               "order_id": g.get("latestOrderId"), "updated_at": now()}
        await db.subscriptions.update_one({"token_hash": th}, {"$set": doc, "$setOnInsert": {"created_at": now()}}, upsert=True)
        linked = g.get("linkedPurchaseToken")
        if linked:  # upgrade / resubscribe replaces the old purchase: never two entitlements
            await db.subscriptions.update_one({"token_hash": token_hash(linked)}, {"$set": {"replaced_by": th, "state": "REPLACED"}})
        if g.get("acknowledgementState") == "ACKNOWLEDGEMENT_STATE_PENDING" and doc["state"] in PRO_STATES:
            await google.acknowledge(item["productId"], token)
        await refresh_plan(owner)
        return doc, None

    def grants_pro(s: dict) -> bool:
        exp = s.get("expiry")
        if exp and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if s.get("replaced_by"):
            return False
        if s.get("state") in PRO_STATES:
            return True
        return s.get("state") == "SUBSCRIPTION_STATE_CANCELED" and bool(exp and exp > now())  # paid period continues

    async def refresh_plan(uid: str) -> dict:
        subs = await db.subscriptions.find({"user_id": uid}, {"_id": 0, "token_enc": 0}).to_list(50)
        active = [s for s in subs if grants_pro(s)]
        best = max(active or subs, key=lambda s: s.get("expiry") or now(), default=None)
        plan = "pro" if active else "free"
        await db.users.update_one({"id": uid}, {"$set": {"plan": plan}})
        return {"plan": plan, "sub": best}

    async def summary(uid: str) -> dict:
        res = await refresh_plan(uid)
        s = res["sub"]
        exp = s.get("expiry") if s else None
        if exp and exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        until = min(exp, now() + timedelta(days=PASS_DAYS)) if res["plan"] == "pro" and exp else now()
        return {"plan": res["plan"], "product_id": s and s["product_id"], "state": s and s["state"],
                "expires_at": exp.isoformat() if exp else None, "will_renew": bool(s and s.get("auto_renew") and res["plan"] == "pro"),
                "pass": sign_pass(uid, res["plan"], until), "pass_expires_at": until.isoformat(),
                "account_ref": account_ref(uid), "mode": MODE}

    @r.get("/entitlement")
    async def entitlement(user: dict = Depends(current_user)):
        # Reconcile anything whose paid period has passed (covers a missed notification).
        stale = await db.subscriptions.find({"user_id": user["id"], "replaced_by": None, "expiry": {"$lt": now()},
                                             "state": {"$in": list(PRO_STATES) + ["SUBSCRIPTION_STATE_CANCELED"]}}).to_list(10)
        for s in stale:
            await apply_google_state(unseal(s["token_enc"]), user["id"])
        return await summary(user["id"])

    @r.post("/verify")
    async def verify(body: PurchaseIn, user: dict = Depends(current_user)):
        doc, err = await apply_google_state(body.purchase_token, user["id"])
        if err == "other_account":
            raise HTTPException(409, "This purchase belongs to a different DutyConnect account")
        if err:
            raise HTTPException(400, "Purchase could not be verified with Google Play")
        return await summary(user["id"])

    @r.post("/restore")
    async def restore(body: RestoreIn, user: dict = Depends(current_user)):
        results = []
        for p in body.purchases:
            _, err = await apply_google_state(p.purchase_token, user["id"])
            results.append(err or "ok")
        return {**await summary(user["id"]), "results": results}

    @r.post("/rtdn")
    async def rtdn(request: Request):
        """Pub/Sub push endpoint. Production: also verify the Google-signed OIDC JWT (docs/BILLING.md)."""
        if not hmac.compare_digest(request.query_params.get("secret", ""), os.environ["RTDN_SHARED_SECRET"]):
            raise HTTPException(403, "Forbidden")
        env = await request.json()
        msg = env.get("message") or {}
        mid = msg.get("messageId") or msg.get("message_id")
        if not mid:
            raise HTTPException(400, "Bad message")
        if await db.rtdn_events.find_one({"message_id": mid}):
            return {"ok": True, "duplicate": True}
        try:
            event = json.loads(base64.b64decode(msg.get("data", "")))
        except ValueError:
            raise HTTPException(400, "Bad message")
        await db.rtdn_events.insert_one({"message_id": mid, "at": now()})
        n = event.get("subscriptionNotification") or event.get("voidedPurchaseNotification")
        if n and n.get("purchaseToken") and event.get("packageName") == PACKAGE:
            # The notification is only a hint: state is always re-read from Google.
            _, err = await apply_google_state(n["purchaseToken"], None)
            if err and err != "unknown_owner":
                logger.warning(f"RTDN not applied: {err}")
        return {"ok": True}

    r.refresh_plan = refresh_plan  # used by account deletion / tests
    return r
