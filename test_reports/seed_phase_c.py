"""Seed/cleanup helpers for Phase C referral & ambassador UI tests."""
import asyncio
import os
import secrets
import sys
import uuid
from datetime import datetime, timedelta, timezone

from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
ADMIN_EMAIL = "delivered+t1@resend.dev"
FRIEND_EMAIL_A = "delivered+phasec_frienda@resend.dev"
FRIEND_EMAIL_B = "delivered+phasec_friendb@resend.dev"
TAG = "PHASEC"

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def now():
    return datetime.now(timezone.utc)


async def prep():
    db = AsyncIOMotorClient(MONGO_URL)[DB_NAME]
    admin = await db.users.find_one({"email": ADMIN_EMAIL})
    assert admin, f"missing {ADMIN_EMAIL}"
    # unset sync_device + reset login attempts
    await db.users.update_one({"id": admin["id"]}, {"$unset": {"sync_device": "", "referred_by": ""}})
    await db.login_attempts.delete_many({})
    # ensure a known 8-char referral code so we can see it stable
    code = admin.get("referral_code")
    if not code or len(code) != 8:
        code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(8))
        await db.users.update_one({"id": admin["id"]}, {"$set": {"referral_code": code}})
    # make sure admin flag is set
    await db.users.update_one({"id": admin["id"]}, {"$set": {"is_admin": True, "email_verified": True}})

    # create two verified "friend" accounts
    friends = []
    for em in (FRIEND_EMAIL_A, FRIEND_EMAIL_B):
        fr = await db.users.find_one({"email": em})
        if not fr:
            fr = {
                "id": str(uuid.uuid4()),
                "email": em,
                "full_name": f"PhaseC Friend {em.split('+')[1].split('@')[0]}",
                "password_hash": pwd.hash(os.environ.get("TEST_MAIN_PASSWORD", "REPLACE_WITH_TEST_MAIN_PASSWORD")),
                "email_verified": True,
                "created_at": now(),
                "currency": "GBP",
                "professional_category": "Custodial & justice",
            }
            await db.users.insert_one(fr)
        else:
            await db.users.update_one({"id": fr["id"]}, {"$set": {"email_verified": True}})
        friends.append(fr)

    # Remove any pre-existing referrals from this admin to these friends
    await db.referrals.delete_many({"referrer_id": admin["id"], "friend_id": {"$in": [f["id"] for f in friends]}})
    for f in friends:
        await db.users.update_one({"id": f["id"]}, {"$set": {"referred_by": admin["id"]}})

    # insert two referral docs, both awaiting_approval
    for f in friends:
        rid = str(uuid.uuid4())
        t = now()
        await db.referrals.insert_one({
            "id": rid,
            "referrer_id": admin["id"],
            "friend_id": f["id"],
            "code": code,
            "status": "awaiting_approval",
            "created_at": t - timedelta(days=35),
            "first_paid_at": t - timedelta(days=33),
            "qualifies_at": t - timedelta(days=1),
            "_tag": TAG,
        })
        # minimal subscription doc so if approve re-checks, it finds a valid one
        await db.subscriptions.delete_many({"user_id": f["id"], "_tag": TAG})
        await db.subscriptions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": f["id"],
            "product_id": "pro_monthly",
            "purchase_token": f"tok_{f['id']}",
            "token_hash": uuid.uuid4().hex,
            "start": t - timedelta(days=33),
            "expiry": t + timedelta(days=1),
            "voided": False,
            "_tag": TAG,
        })

    print("SEED_OK", code, [f["email"] for f in friends])


async def cleanup():
    db = AsyncIOMotorClient(MONGO_URL)[DB_NAME]
    admin = await db.users.find_one({"email": ADMIN_EMAIL})
    friends = await db.users.find({"email": {"$in": [FRIEND_EMAIL_A, FRIEND_EMAIL_B]}}).to_list(10)
    friend_ids = [f["id"] for f in friends]
    await db.referrals.delete_many({"$or": [{"_tag": TAG}, {"friend_id": {"$in": friend_ids}}]})
    await db.subscriptions.delete_many({"$or": [{"_tag": TAG}, {"user_id": {"$in": friend_ids}}]})
    await db.users.delete_many({"email": {"$in": [FRIEND_EMAIL_A, FRIEND_EMAIL_B]}})
    if admin:
        await db.users.update_one({"id": admin["id"]}, {"$unset": {"sync_device": "", "ambassador": "", "referral_cap": "", "referred_by": ""}})
    await db.login_attempts.delete_many({})
    print("CLEANUP_OK")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "prep"
    asyncio.run(prep() if mode == "prep" else cleanup())
