"""Phase C — referrals and ambassadors (MVP).

Rules (approved):
- Each account has a personal code. A new account can add one code within APPLY_WINDOW_DAYS of joining and
  before it has ever subscribed. No own code, one referrer per account.
- A referral qualifies only after the friend's first verified Google Play payment has run for a full paid
  month plus the 48-hour refund window, and the payment was not refunded / voided.
- Qualified referrals wait for admin approval. Approval gives the friend 1 free month of Pro and the referrer
  1 free month of Pro, unless the referrer has reached their monthly reward cap (then "capped").
- Free months never touch payment details: a paying subscriber's renewal is deferred by Google; otherwise Pro
  is granted on the account until a date (billing.grant_free_month).
"""
import asyncio
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from admin import get_programmes, log_action
from billing import aware

QUALIFY_DAYS = 30
REFUND_HOURS = 48
APPLY_WINDOW_DAYS = int(os.environ.get("REFERRAL_APPLY_WINDOW_DAYS", "14"))
DEFAULT_CAP = int(os.environ.get("REFERRAL_MONTHLY_CAP", "3"))
AMBASSADOR_CAP = int(os.environ.get("AMBASSADOR_MONTHLY_CAP", "10"))
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I
ERRORS = {
    "invalid_code": "That referral code isn't valid.",
    "own_code": "You can't use your own referral code.",
    "already_referred": "A referral code has already been added to this account.",
    "already_subscribed": "Referral codes can only be added before your first subscription.",
    "programme_off": "The referral programme is paused at the moment.",
    "too_late": f"Referral codes can only be added within {APPLY_WINDOW_DAYS} days of creating your account.",
}


def now():
    return datetime.now(timezone.utc)


def email_key(email: str) -> str:
    """name.surname+tag99@x.com -> namesurname@x.com: catches look-alike accounts."""
    local, _, domain = email.lower().partition("@")
    return local.split("+")[0].replace(".", "").rstrip("0123456789") + "@" + domain


BURST_LIMIT = 5  # more than this many sign-ups on one code within 24 hours is flagged
FLAG_TEXT = {"burst": "Many sign-ups on this code within 24 hours", "similar_email": "Friend's email looks like the referrer's",
             "quick_refund": "Friend refunded soon after paying"}


class CodeIn(BaseModel):
    code: str = Field(min_length=4, max_length=16)


class CancelIn(BaseModel):
    reason: str = Field(default="", max_length=120)


class FreeProIn(BaseModel):
    days: Optional[int] = Field(default=None, ge=1, le=3650)
    revoke: bool = False


class AmbassadorIn(BaseModel):
    ambassador: Optional[bool] = None
    referral_cap: Optional[int] = Field(default=None, ge=0, le=100)
    clear_cap: bool = False


def make_router(db, current_user, billing, logger) -> APIRouter:
    r = APIRouter(prefix="/api")

    async def ensure_code(user: dict) -> str:
        if user.get("referral_code"):
            return user["referral_code"]
        while True:
            code = "".join(secrets.choice(ALPHABET) for _ in range(8))
            if not await db.users.find_one({"referral_code": code}):
                break
        await db.users.update_one({"id": user["id"], "referral_code": {"$exists": False}}, {"$set": {"referral_code": code}})
        return (await db.users.find_one({"id": user["id"]}, {"referral_code": 1}))["referral_code"]

    async def apply_code(friend: dict, code: str) -> Optional[str]:
        """Link a new account to a referrer. Returns an error key, or None when linked."""
        code = code.strip().upper()
        if not (await get_programmes(db))["referrals"]:
            return "programme_off"
        if friend.get("referred_by"):
            return "already_referred"
        if await db.subscriptions.find_one({"user_id": friend["id"]}):
            return "already_subscribed"
        if aware(friend["created_at"]) < now() - timedelta(days=APPLY_WINDOW_DAYS):
            return "too_late"
        ref = await db.users.find_one({"referral_code": code, "email_verified": True}, {"_id": 0, "id": 1, "email": 1})
        if not ref:
            return "invalid_code"
        if ref["id"] == friend["id"]:
            return "own_code"
        res = await db.users.update_one({"id": friend["id"], "referred_by": {"$exists": False}}, {"$set": {"referred_by": ref["id"]}})
        if not res.modified_count:
            return "already_referred"
        flags = []
        if await db.referrals.count_documents({"referrer_id": ref["id"], "created_at": {"$gte": now() - timedelta(hours=24)}}) >= BURST_LIMIT:
            flags.append("burst")
        if email_key(friend["email"]) == email_key(ref["email"]):
            flags.append("similar_email")
        await db.referrals.insert_one({"id": str(uuid.uuid4()), "referrer_id": ref["id"], "friend_id": friend["id"],
                                       "code": code, "status": "signed_up", "created_at": now(), "flags": flags})
        return None

    async def on_paid(uid: str):
        """First verified paying subscription for a referred friend starts the qualifying period."""
        t = now()
        await db.referrals.update_one({"friend_id": uid, "status": "signed_up"}, {"$set": {
            "status": "paid", "first_paid_at": t, "qualifies_at": t + timedelta(days=QUALIFY_DAYS, hours=REFUND_HOURS)}})

    async def process_due():
        """Move referrals whose qualifying period has ended to awaiting approval, or cancel them if the payment
        was refunded / the paid month didn't run."""
        for rec in await db.referrals.find({"status": "paid", "qualifies_at": {"$lte": now()}}).to_list(500):
            needed = aware(rec["first_paid_at"]) + timedelta(days=QUALIFY_DAYS)
            subs = await db.subscriptions.find({"user_id": rec["friend_id"]}).to_list(20)
            ok = any(not s.get("voided") and s.get("expiry") and aware(s["expiry"]) >= needed for s in subs)
            flags = list(rec.get("flags") or [])
            if any(s.get("voided") for s in subs) and "quick_refund" not in flags:
                flags.append("quick_refund")
            # Suspicious referrals are held until an admin has reviewed them.
            update = ({"status": "held" if flags else "awaiting_approval"} if ok
                      else {"status": "cancelled", "reason": "Payment refunded or paid month not completed"})
            update["flags"] = flags
            await db.referrals.update_one({"id": rec["id"], "status": "paid"}, {"$set": {**update, "checked_at": now()}})

    def cap_of(user: dict, ambassadors_on: bool = True) -> int:
        if user.get("referral_cap") is not None:
            return user["referral_cap"]
        return AMBASSADOR_CAP if user.get("ambassador") and ambassadors_on else DEFAULT_CAP

    async def admin_user(user: dict = Depends(current_user)) -> dict:
        if not user.get("is_admin"):
            raise HTTPException(403, "Admins only")
        return user

    # ------------------------------------------------------------ member endpoints
    @r.get("/referrals/me")
    async def my_referrals(user: dict = Depends(current_user)):
        await process_due()
        code = await ensure_code(user)
        recs = await db.referrals.find({"referrer_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
        month_start = now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        def totals(rows):
            return {"signed_up": len(rows), "qualifying": sum(x["status"] == "paid" for x in rows),
                    "qualified": sum(x["status"] in ("awaiting_approval", "held", "approving", "rewarded") for x in rows),
                    "rewarded": sum(x["status"] == "rewarded" for x in rows)}
        used = sum(x.get("referrer_reward") in ("deferred", "bonus") and x.get("decided_at") and aware(x["decided_at"]) >= month_start for x in recs)
        mine = await db.referrals.find_one({"friend_id": user["id"]}, {"_id": 0, "status": 1, "friend_reward": 1})
        progs = await get_programmes(db)
        can_apply = (progs["referrals"] and not user.get("referred_by") and not await db.subscriptions.find_one({"user_id": user["id"]})
                     and aware(user["created_at"]) >= now() - timedelta(days=APPLY_WINDOW_DAYS))
        return {
            "enabled": progs["referrals"], "code": code, "download_url": os.environ.get("APTOIDE_URL", "https://afikshift.en.aptoide.com"), "monthly_cap": cap_of(user, progs["ambassadors"]),
            "ambassador": bool(user.get("ambassador")) and progs["ambassadors"],
            "this_month": totals([x for x in recs if aware(x["created_at"]) >= month_start]), "all_time": totals(recs),
            "rewards_left_this_month": max(0, cap_of(user, progs["ambassadors"]) - used),
            "can_apply_code": can_apply, "apply_window_days": APPLY_WINDOW_DAYS,
            "my_referral_status": mine and mine["status"],
            # Friends are never identified to the referrer (privacy): only status and dates.
            "referrals": [{"id": x["id"], "status": "awaiting_approval" if x["status"] == "held" else x["status"], "created_at": x["created_at"].isoformat(),
                           "qualifies_at": x["qualifies_at"].isoformat() if x.get("qualifies_at") else None,
                           "referrer_reward": x.get("referrer_reward")} for x in recs],
        }

    @r.post("/referrals/apply")
    async def apply(body: CodeIn, user: dict = Depends(current_user)):
        err = await apply_code(user, body.code)
        if err:
            raise HTTPException(400, ERRORS[err])
        return {"ok": True}

    # ------------------------------------------------------------ admin endpoints
    @r.get("/admin/referrals")
    async def admin_list(status: Optional[str] = None, _: dict = Depends(admin_user)):
        await process_due()
        q = {"status": status} if status else {}
        recs = await db.referrals.find(q, {"_id": 0}).sort("created_at", -1).to_list(300)
        ids = {x["referrer_id"] for x in recs} | {x["friend_id"] for x in recs}
        emails = {u["id"]: u["email"] async for u in db.users.find({"id": {"$in": list(ids)}}, {"_id": 0, "id": 1, "email": 1})}
        out = []
        for x in recs:
            out.append({**{k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in x.items()},
                        "warnings": [FLAG_TEXT[f] for f in x.get("flags") or []],
                        "referrer_email": emails.get(x["referrer_id"], "(deleted)"), "friend_email": emails.get(x["friend_id"], "(deleted)")})
        return {"referrals": out}

    @r.post("/admin/referrals/{rid}/approve")
    async def approve(rid: str, admin: dict = Depends(admin_user)):
        # Claim atomically so a double tap / two admins can never grant twice.
        rec = await db.referrals.find_one_and_update({"id": rid, "status": {"$in": ["awaiting_approval", "held"]}}, {"$set": {"status": "approving"}})
        if not rec:
            raise HTTPException(409, "Only referrals awaiting approval can be approved")
        try:
            friend_reward = await billing.grant_free_month(rec["friend_id"])
            referrer = await db.users.find_one({"id": rec["referrer_id"]}, {"_id": 0})
            month_start = now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            used = await db.referrals.count_documents({"referrer_id": rec["referrer_id"], "referrer_reward": {"$in": ["deferred", "bonus"]},
                                                       "decided_at": {"$gte": month_start}})
            amb_on = (await get_programmes(db))["ambassadors"]
            referrer_reward = "capped" if not referrer or used >= cap_of(referrer, amb_on) else await billing.grant_free_month(rec["referrer_id"])
        except Exception:
            await db.referrals.update_one({"id": rid}, {"$set": {"status": rec["status"]}})
            logger.exception("Referral reward failed")
            raise HTTPException(502, "Reward could not be applied. Nothing was granted; try again.")
        await db.referrals.update_one({"id": rid}, {"$set": {"status": "rewarded", "friend_reward": friend_reward,
                                                             "referrer_reward": referrer_reward, "decided_at": now(), "decided_by": admin["id"]}})
        await log_action(db, admin, "referral_approved", f"friend {friend_reward}, referrer {referrer_reward}")
        return {"ok": True, "friend_reward": friend_reward, "referrer_reward": referrer_reward}

    @r.post("/admin/referrals/{rid}/cancel")
    async def cancel(rid: str, body: CancelIn, admin: dict = Depends(admin_user)):
        res = await db.referrals.update_one({"id": rid, "status": {"$in": ["signed_up", "paid", "awaiting_approval", "held"]}}, {"$set": {
            "status": "cancelled", "reason": body.reason.strip() or "Cancelled by admin", "decided_at": now(), "decided_by": admin["id"]}})
        if not res.modified_count:
            raise HTTPException(409, "This referral can no longer be cancelled")
        await log_action(db, admin, "referral_cancelled", body.reason.strip() or "Cancelled by admin")
        return {"ok": True}

    @r.get("/admin/members")
    async def lookup(email: str, _: dict = Depends(admin_user)):
        u = await db.users.find_one({"email": email.strip().lower()}, {"_id": 0})
        if not u:
            raise HTTPException(404, "No account with that email")
        bonus = aware(u.get("bonus_pro_until"))
        return {"id": u["id"], "email": u["email"], "ambassador": bool(u.get("ambassador")), "referral_cap": u.get("referral_cap"),
                "plan": u.get("plan", "free"), "free_pro_until": bonus.isoformat() if bonus and bonus > now() else None,
                "monthly_cap": cap_of(u), "referral_code": await ensure_code(u)}

    @r.patch("/admin/members/{uid}")
    async def set_member(uid: str, body: AmbassadorIn, admin: dict = Depends(admin_user)):
        upd, unset = {}, {}
        if body.ambassador is not None:
            upd["ambassador"] = body.ambassador
        if body.clear_cap:
            unset["referral_cap"] = ""
        elif body.referral_cap is not None:
            upd["referral_cap"] = body.referral_cap
        ops = {**({"$set": upd} if upd else {}), **({"$unset": unset} if unset else {})}
        if not ops or not (await db.users.update_one({"id": uid}, ops)).matched_count:
            raise HTTPException(404, "No change made")
        u = await db.users.find_one({"id": uid}, {"_id": 0})
        await log_action(db, admin, "member_updated", f"{u['email']}: ambassador={bool(u.get('ambassador'))}, cap={u.get('referral_cap')}")
        return {"ambassador": bool(u.get("ambassador")), "referral_cap": u.get("referral_cap"), "monthly_cap": cap_of(u)}

    @r.post("/admin/members/{uid}/free-pro")
    async def free_pro(uid: str, body: FreeProIn, admin: dict = Depends(admin_user)):
        """Owner tool: give (or take back) free Pro for a number of days. Stacks on any free time left."""
        u = await db.users.find_one({"id": uid}, {"_id": 0})
        if not u:
            raise HTTPException(404, "No account with that id")
        if body.revoke:
            await db.users.update_one({"id": uid}, {"$unset": {"bonus_pro_until": ""}})
            await log_action(db, admin, "free_pro_removed", u["email"])
        elif body.days:
            await billing.grant_free_month(uid, days=body.days, account_only=True)
            await log_action(db, admin, "free_pro_granted", f"{u['email']}: {body.days} days")
        else:
            raise HTTPException(400, "Choose a duration")
        res = await billing.refresh_plan(uid)
        return {"plan": res["plan"], "free_pro_until": res["bonus"].isoformat() if res["bonus"] else None}

    async def loop():
        while True:
            await asyncio.sleep(3600)
            try:
                await process_due()
            except Exception:
                logger.exception("Referral check failed")

    billing.hooks["paid"] = on_paid
    r.apply_code = apply_code
    r.process_due = process_due
    r.loop = loop
    return r
