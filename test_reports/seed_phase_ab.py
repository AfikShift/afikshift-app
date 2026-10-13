"""Helper for the Phase A+B frontend E2E (DutyConnect)."""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://dutyconnect-beta.preview.emergentagent.com")
EMAIL = "delivered+t1@resend.dev"
PASSWORD = os.environ.get("TEST_MAIN_PASSWORD", "REPLACE_WITH_TEST_MAIN_PASSWORD")
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"


def login() -> dict:
    r = requests.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=20)
    r.raise_for_status()
    token = r.json()["access_token"]
    import base64 as _b64, json as _json
    payload = token.split(".")[1]
    payload += "=" * ((4 - len(payload) % 4) % 4)
    sub = _json.loads(_b64.urlsafe_b64decode(payload))["sub"]
    return {"token": token, "user_id": sub}


async def _db():
    client = AsyncIOMotorClient(MONGO_URL)
    return client[DB_NAME]


def _mk_shift(user_id, date_str, status, location):
    now_iso = datetime.now(timezone.utc)
    sid = str(uuid.uuid4())
    return {
        "id": sid, "user_id": user_id, "officer_name": "Test Officer",
        "duty_type": "standard", "shift_period": "day", "date": date_str,
        "start_time": "09:00", "end_time": "13:00", "break_minutes": 0,
        "location": location, "status": status, "hourly_rate": 20.0,
        "payable_hours": 4.0, "estimated_earnings": 80.0,
        "payments": [], "payment_decisions": [],
        "base_version": 1, "updated_at": now_iso, "created_at": now_iso,
        "deleted": False, "deleted_at": None,
    }


async def prep():
    """Delete future booked shifts; add 3 booked future shifts + 1 old completed + 1 recent completed."""
    sess = login()
    db = await _db()
    uid = sess["user_id"]
    today = datetime.now(timezone.utc).date()
    today_iso = today.isoformat()
    # Clean prior test seeds and all booked future shifts
    await db.pp_shifts.delete_many({
        "user_id": uid,
        "$or": [
            {"location": {"$in": ["AB Future1", "AB Future2", "AB Future3", "AB Old20d", "AB Recent3d"]}},
            {"status": "booked", "date": {"$gte": today_iso}, "deleted": False},
        ],
    })
    # Clean sync_device, data download timestamp, templates
    await db.users.update_one({"id": uid}, {
        "$set": {"plan": "free", "shift_templates": []},
        "$unset": {"sync_device": "", "last_data_download_at": ""},
    })
    docs = [
        _mk_shift(uid, (today + timedelta(days=d)).isoformat(), "booked", f"AB Future{d}")
        for d in (1, 2, 3)
    ]
    docs.append(_mk_shift(uid, (today - timedelta(days=20)).isoformat(), "completed", "AB Old20d"))
    docs.append(_mk_shift(uid, (today - timedelta(days=3)).isoformat(), "completed", "AB Recent3d"))
    await db.pp_shifts.insert_many(docs)
    print({"ok": True, "user_id": uid, "future": 3, "history_old_days": 20, "history_recent_days": 3})


async def cleanup():
    sess = login()
    db = await _db()
    uid = sess["user_id"]
    await db.pp_shifts.delete_many({
        "user_id": uid,
        "location": {"$in": ["AB Future1", "AB Future2", "AB Future3", "AB Old20d", "AB Recent3d"]},
    })
    await db.users.update_one({"id": uid}, {
        "$set": {"shift_templates": []},
        "$unset": {"sync_device": "", "last_data_download_at": ""},
    })
    print({"ok": True, "cleaned": True})


MODES = {"prep": prep, "cleanup": cleanup}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "prep"
    asyncio.run(MODES[mode]())
