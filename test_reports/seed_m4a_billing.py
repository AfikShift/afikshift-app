"""Helper to drive the M4-Stage-A frontend billing E2E (Free / Pro / downgrade).

Modes:
  seed_free_shift   - make sure the user is Free, create a completed shift 60 days ago, print account_ref
  go_pro            - insert a mock Google record for 'tok-ui-1' and POST /billing/verify
  downgrade         - mark the mock record EXPIRED and POST /billing/restore
  reset_to_free     - delete the subscription(s) + mock_play docs, set plan=free, unset sync_device
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import requests
from motor.motor_asyncio import AsyncIOMotorClient

from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
sys.path.insert(0, "/app/backend")  # noqa: E402

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"] if "EXPO_PUBLIC_BACKEND_URL" in os.environ else "https://dutyconnect-beta.preview.emergentagent.com"
EMAIL = "delivered+t1@resend.dev"
PASSWORD = os.environ.get("TEST_MAIN_PASSWORD", "REPLACE_WITH_TEST_MAIN_PASSWORD")
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"
TOKEN = "tok-ui-1-aaaa"
PRODUCT = "dutyconnect_pro_annual"


def login() -> dict:
    r = requests.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    r.raise_for_status()
    token = r.json()["access_token"]
    import base64 as _b64, json as _json
    payload = token.split(".")[1]
    payload += "=" * ((4 - len(payload) % 4) % 4)
    sub = _json.loads(_b64.urlsafe_b64decode(payload))["sub"]
    return {"token": token, "user_id": sub}


def get_entitlement(token: str) -> dict:
    r = requests.get(f"{BASE}/api/billing/entitlement", headers={"Authorization": f"Bearer {token}"}, timeout=20)
    r.raise_for_status()
    return r.json()


async def _db():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


async def seed_free_shift():
    sess = login()
    db = await _db()
    # Make sure Free
    await db.subscriptions.delete_many({"user_id": sess["user_id"]})
    await db.mock_play.delete_many({"token": TOKEN})
    await db.users.update_one({"id": sess["user_id"]}, {"$set": {"plan": "free"}, "$unset": {"sync_device": ""}})
    await db.pp_shifts.delete_many({"user_id": sess["user_id"], "location": {"$in": ["Old Hospital", "Recent Hospital"]}})

    today = datetime.now(timezone.utc).date()
    sixty = today - timedelta(days=60)
    now_iso = datetime.now(timezone.utc)
    sid = str(uuid.uuid4())
    recent_sid = str(uuid.uuid4())
    pay_id = str(uuid.uuid4())

    def _shift(sid, date_str, location, payments):
        hours = 4.0
        rate = 20.0
        return {
            "id": sid, "user_id": sess["user_id"], "officer_name": "Test Officer",
            "duty_type": "constant_watch", "shift_period": "day", "date": date_str,
            "start_time": "09:00", "end_time": "13:00", "break_minutes": 0,
            "location": location, "status": "completed", "hourly_rate": rate,
            "payable_hours": hours, "estimated_earnings": round(hours * rate, 2),
            "payments": payments, "payment_decisions": [],
            "base_version": 1, "updated_at": now_iso, "created_at": now_iso,
            "deleted": False, "deleted_at": None,
        }

    old = _shift(sid, sixty.isoformat(), "Old Hospital", [])
    recent = _shift(recent_sid, (today - timedelta(days=5)).isoformat(), "Recent Hospital", [{
        "id": pay_id, "amount": 60.0, "date": (today - timedelta(days=4)).isoformat(),
        "note": "", "replaces": None, "origin_id": pay_id, "deleted": False,
    }])
    await db.pp_shifts.insert_many([old, recent])
    # Clear sync_device so the browser session becomes the sync phone on first push.
    await db.users.update_one({"id": sess["user_id"]}, {"$unset": {"sync_device": ""}})
    ent = get_entitlement(sess["token"])
    print({"account_ref": ent["account_ref"], "shift_id": sid, "recent_shift_id": recent_sid, "plan": ent["plan"], "sixty_days_ago": sixty.isoformat()})


async def go_pro():
    sess = login()
    db = await _db()
    ent = get_entitlement(sess["token"])
    ref = ent["account_ref"]
    expiry = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat().replace("+00:00", "Z")
    await db.mock_play.update_one(
        {"token": TOKEN},
        {"$set": {"token": TOKEN, "response": {
            "subscriptionState": "SUBSCRIPTION_STATE_ACTIVE",
            "acknowledgementState": "ACKNOWLEDGEMENT_STATE_PENDING",
            "externalAccountIdentifiers": {"obfuscatedExternalAccountId": ref},
            "lineItems": [{
                "productId": PRODUCT,
                "expiryTime": expiry,
                "autoRenewingPlan": {"autoRenewEnabled": True},
            }],
            "latestOrderId": "order-ui-1",
        }}},
        upsert=True,
    )
    r = requests.post(
        f"{BASE}/api/billing/verify",
        json={"product_id": PRODUCT, "purchase_token": TOKEN},
        headers={"Authorization": f"Bearer {sess['token']}"},
        timeout=20,
    )
    print({"status": r.status_code, "body": r.json()})


async def downgrade():
    sess = login()
    db = await _db()
    past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat().replace("+00:00", "Z")
    await db.mock_play.update_one(
        {"token": TOKEN},
        {"$set": {
            "response.subscriptionState": "SUBSCRIPTION_STATE_EXPIRED",
            "response.lineItems.0.expiryTime": past,
            "response.lineItems.0.autoRenewingPlan.autoRenewEnabled": False,
        }},
    )
    r = requests.post(
        f"{BASE}/api/billing/restore",
        json={"purchases": [{"product_id": PRODUCT, "purchase_token": TOKEN}]},
        headers={"Authorization": f"Bearer {sess['token']}"},
        timeout=20,
    )
    print({"status": r.status_code, "body": r.json()})


async def reset_to_free():
    sess = login()
    db = await _db()
    await db.subscriptions.delete_many({"user_id": sess["user_id"]})
    await db.mock_play.delete_many({"token": TOKEN})
    await db.users.update_one({"id": sess["user_id"]}, {"$set": {"plan": "free"}, "$unset": {"sync_device": ""}})
    # Delete the 60-day-old test shift if still present
    await db.pp_shifts.delete_many({"user_id": sess["user_id"], "location": {"$in": ["Old Hospital", "Recent Hospital"]}})
    ent = get_entitlement(sess["token"])
    print({"plan": ent["plan"], "state": ent.get("state"), "reset": True})


MODES = {
    "seed_free_shift": seed_free_shift,
    "go_pro": go_pro,
    "downgrade": downgrade,
    "reset_to_free": reset_to_free,
}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "seed_free_shift"
    asyncio.run(MODES[mode]())
