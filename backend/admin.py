"""Admin dashboard: overview totals, programme switches and an activity log.
Admins are named in ADMIN_EMAILS only. The overview shows totals only (no personal details)."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

PROGRAMMES = {"referrals": True, "founding": True, "ambassadors": True}  # defaults: everything on


def now():
    return datetime.now(timezone.utc)


async def get_programmes(db) -> dict:
    doc = await db.settings.find_one({"_id": "programmes"}) or {}
    return {k: bool(doc.get(k, v)) for k, v in PROGRAMMES.items()}


async def log_action(db, admin: dict, action: str, detail: str = ""):
    await db.admin_log.insert_one({"at": now(), "admin_email": admin["email"], "action": action, "detail": detail[:200]})


class ProgrammesIn(BaseModel):
    referrals: bool | None = None
    founding: bool | None = None
    ambassadors: bool | None = None


def make_router(db, current_user) -> APIRouter:
    r = APIRouter(prefix="/api")

    async def admin_user(user: dict = Depends(current_user)) -> dict:
        if not user.get("is_admin"):
            raise HTTPException(403, "Admins only")
        return user

    @r.get("/programmes")
    async def programmes():
        """Which optional programmes are switched on (public: the app hides switched-off features)."""
        return await get_programmes(db)

    @r.get("/admin/overview")
    async def overview(_: dict = Depends(admin_user)):
        week = now() - timedelta(days=7)
        month = now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        members = await db.users.count_documents({"email_verified": True})
        pro = await db.users.count_documents({"email_verified": True, "plan": "pro"})
        return {
            "members": members, "pro": pro, "free": members - pro,
            "new_this_week": await db.users.count_documents({"email_verified": True, "created_at": {"$gte": week}}),
            "ambassadors": await db.users.count_documents({"ambassador": True}),
            "founding_members": len(await db.subscriptions.distinct("user_id", {"founding": True})),
            "referrals_waiting": await db.referrals.count_documents({"status": "awaiting_approval"}),
            "referrals_qualifying": await db.referrals.count_documents({"status": "paid"}),
            "rewards_this_month": await db.referrals.count_documents({"status": "rewarded", "decided_at": {"$gte": month}}),
            "programmes": await get_programmes(db),
        }

    @r.patch("/admin/programmes")
    async def set_programmes(body: ProgrammesIn, admin: dict = Depends(admin_user)):
        changes = body.model_dump(exclude_none=True)
        if not changes:
            raise HTTPException(400, "No change made")
        await db.settings.update_one({"_id": "programmes"}, {"$set": changes}, upsert=True)
        for k, v in changes.items():
            await log_action(db, admin, "programme_on" if v else "programme_off", k)
        return await get_programmes(db)

    @r.get("/admin/activity")
    async def activity(_: dict = Depends(admin_user)):
        rows = await db.admin_log.find({}, {"_id": 0}).sort("at", -1).to_list(100)
        return {"activity": [{**x, "at": x["at"].isoformat()} for x in rows]}

    return r
