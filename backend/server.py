"""DutyConnect API — Milestone 1: accounts & foundations."""
import os
import uuid
import hashlib
import secrets
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, Literal

import bcrypt
import jwt
from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field, field_validator
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from email_service import send_verification_code, send_reset_code  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("dutyconnect")

client = AsyncIOMotorClient(os.environ["MONGO_URL"], tz_aware=True)
db = client[os.environ["DB_NAME"]]

JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ISSUER, JWT_AUDIENCE = "dutyconnect-api", "dutyconnect-app"
ACCESS_MINUTES = 15
REFRESH_DAYS = 30
CODE_MINUTES = 15
CODE_MAX_ATTEMPTS = 5
LOGIN_MAX_FAILS = 5
DEV_LOG_CODES = os.environ.get("DEV_LOG_CODES", "false").lower() == "true"

# Feature flags per plan. Subscriptions (Phase 4) only change the user's `plan`;
# the app reads `features` from /api/me so no rebuild is needed.
PLAN_FEATURES = {
    "free": {
        "pp_shifts": True, "calendar": True, "earnings": True, "payments": True,
        "reports_csv": True, "reports_pdf": True, "calendar_reminders": False,
        "sms_forwarding": False, "multi_destinations": False, "priority_support": False,
    },
}

PROFESSIONAL_CATEGORIES = ["Prison Officer", "Operational Support Grade", "Custodial Manager",
                           "Security Officer", "Other"]
CURRENCIES = ["GBP", "EUR", "USD"]

app = FastAPI(title="DutyConnect API")
api = APIRouter(prefix="/api")
bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------- helpers
def now() -> datetime:
    return datetime.now(timezone.utc)


def digest(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except ValueError:
        return False


_DUMMY_HASH = hash_password(secrets.token_hex(8))


def make_access(user_id: str) -> str:
    t = now()
    return jwt.encode({"sub": user_id, "typ": "access", "iss": JWT_ISSUER, "aud": JWT_AUDIENCE,
                       "iat": t, "exp": t + timedelta(minutes=ACCESS_MINUTES)}, JWT_SECRET, algorithm="HS256")


async def issue_tokens(user_id: str) -> dict:
    raw = secrets.token_urlsafe(32)
    await db.sessions.insert_one({"id": str(uuid.uuid4()), "hash": digest(raw), "user_id": user_id,
                                  "created_at": now(), "expires_at": now() + timedelta(days=REFRESH_DAYS),
                                  "revoked": False})
    return {"access_token": make_access(user_id), "refresh_token": raw, "token_type": "bearer"}


def validate_password_strength(p: str) -> str:
    if len(p) < 10 or len(p) > 128:
        raise ValueError("Password must be 10–128 characters")
    if not any(c.isalpha() for c in p) or not any(c.isdigit() for c in p):
        raise ValueError("Password must include letters and numbers")
    return p


async def create_code(user_id: str, kind: str) -> str:
    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.action_codes.delete_many({"user_id": user_id, "kind": kind})
    await db.action_codes.insert_one({"user_id": user_id, "kind": kind, "hash": digest(code),
                                      "attempts": 0, "created_at": now(),
                                      "expires_at": now() + timedelta(minutes=CODE_MINUTES)})
    if DEV_LOG_CODES:
        logger.info(f"[DEV] {kind} code for user {user_id}: {code}")
    return code


async def consume_code(user_id: str, kind: str, code: str) -> bool:
    rec = await db.action_codes.find_one({"user_id": user_id, "kind": kind})
    if not rec or rec["expires_at"] < now() or rec["attempts"] >= CODE_MAX_ATTEMPTS:
        return False
    if not secrets.compare_digest(rec["hash"], digest(code.strip())):
        await db.action_codes.update_one({"_id": rec["_id"]}, {"$inc": {"attempts": 1}})
        return False
    await db.action_codes.delete_one({"_id": rec["_id"]})
    return True


async def recently_sent(user_id: str, kind: str) -> bool:
    rec = await db.action_codes.find_one({"user_id": user_id, "kind": kind})
    return bool(rec and rec["created_at"] > now() - timedelta(seconds=45))


# ---------------------------------------------------------------- models
class NotificationPrefs(BaseModel):
    shift_reminders: bool = True
    payment_reminders: bool = True
    product_updates: bool = False


class UserOut(BaseModel):
    id: str
    email: str
    full_name: str
    professional_category: str
    currency: str
    hourly_rate: Optional[float]
    notification_prefs: NotificationPrefs
    plan: str
    features: dict
    email_verified: bool
    created_at: datetime

    @classmethod
    def from_doc(cls, d: dict) -> "UserOut":
        return cls(id=d["id"], email=d["email"], full_name=d["full_name"],
                   professional_category=d.get("professional_category", "Prison Officer"),
                   currency=d.get("currency", "GBP"), hourly_rate=d.get("hourly_rate"),
                   notification_prefs=NotificationPrefs(**d.get("notification_prefs", {})),
                   plan=d.get("plan", "free"), features=PLAN_FEATURES[d.get("plan", "free")],
                   email_verified=d.get("email_verified", False), created_at=d["created_at"])


class RegisterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    password: str
    _pw = field_validator("password")(lambda cls, v: validate_password_strength(v))


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class EmailIn(BaseModel):
    email: EmailStr


class VerifyIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)


class ResetIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)
    new_password: str
    _pw = field_validator("new_password")(lambda cls, v: validate_password_strength(v))


class TokenIn(BaseModel):
    refresh_token: str = Field(min_length=10, max_length=200)


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=80)
    professional_category: Optional[str] = None
    currency: Optional[Literal["GBP", "EUR", "USD"]] = None
    hourly_rate: Optional[float] = Field(default=None, gt=0, le=500)
    clear_hourly_rate: bool = False
    notification_prefs: Optional[NotificationPrefs] = None

    @field_validator("professional_category")
    @classmethod
    def _cat(cls, v):
        if v is not None and v not in PROFESSIONAL_CATEGORIES:
            raise ValueError("Invalid professional category")
        return v


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str
    _pw = field_validator("new_password")(lambda cls, v: validate_password_strength(v))


class DeleteAccountIn(BaseModel):
    password: str = Field(min_length=1, max_length=128)


async def deliver(send, *args):
    """Send an auth email without leaking delivery failures to the caller (prevents enumeration)."""
    try:
        await send(*args)
    except Exception as e:
        logger.warning(f"Auth email not delivered: {getattr(e, 'detail', e)}")


GENERIC_SENT = {"message": "If the details are valid, a code has been sent to the email address."}


# ---------------------------------------------------------------- auth dependency
async def current_user(creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer)) -> dict:
    if not creds:
        raise HTTPException(401, "Not authenticated")
    try:
        p = jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"], issuer=JWT_ISSUER, audience=JWT_AUDIENCE)
        if p.get("typ") != "access":
            raise ValueError
    except Exception:
        raise HTTPException(401, "Invalid or expired token")
    user = await db.users.find_one({"id": p["sub"], "email_verified": True}, {"_id": 0})
    if not user:
        raise HTTPException(401, "Invalid or expired token")
    return user


# ---------------------------------------------------------------- auth routes
@api.get("/")
async def root():
    return {"service": "DutyConnect API", "status": "ok"}


@api.get("/config")
async def config():
    return {"professional_categories": PROFESSIONAL_CATEGORIES, "currencies": CURRENCIES,
            "plans": list(PLAN_FEATURES.keys())}


@api.post("/auth/register", status_code=202)
async def register(body: RegisterIn):
    email = body.email.lower()
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        # Avoid account enumeration: same response. Resend code only if still unverified.
        if not existing.get("email_verified") and not await recently_sent(existing["id"], "verify"):
            code = await create_code(existing["id"], "verify")
            await deliver(send_verification_code, email, existing["full_name"], code)
        return GENERIC_SENT
    uid = str(uuid.uuid4())
    await db.users.insert_one({
        "id": uid, "email": email, "full_name": body.full_name.strip(), "password_hash": hash_password(body.password),
        "professional_category": "Prison Officer", "currency": "GBP", "hourly_rate": None,
        "notification_prefs": NotificationPrefs().model_dump(), "plan": "free",
        "email_verified": False, "created_at": now(), "updated_at": now(),
    })
    code = await create_code(uid, "verify")
    await deliver(send_verification_code, email, body.full_name.strip(), code)
    return GENERIC_SENT


@api.post("/auth/resend-verification", status_code=202)
async def resend_verification(body: EmailIn):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if user and not user.get("email_verified") and not await recently_sent(user["id"], "verify"):
        code = await create_code(user["id"], "verify")
        await deliver(send_verification_code, user["email"], user["full_name"], code)
    return GENERIC_SENT


@api.post("/auth/verify-email")
async def verify_email(body: VerifyIn):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or user.get("email_verified") or not await consume_code(user["id"], "verify", body.code):
        raise HTTPException(400, "Invalid or expired code")
    await db.users.update_one({"id": user["id"]}, {"$set": {"email_verified": True, "updated_at": now()}})
    return await issue_tokens(user["id"])


@api.post("/auth/login")
async def login(body: LoginIn, request: Request):
    email = body.email.lower()
    ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "unknown").split(",")[0]
    key = digest(f"{email}:{ip}")
    attempt = await db.login_attempts.find_one({"key": key})
    if attempt and attempt["count"] >= LOGIN_MAX_FAILS and attempt["expires_at"] > now():
        raise HTTPException(429, "Too many attempts. Please try again in 15 minutes.")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    ok = verify_password(body.password, user["password_hash"] if user else _DUMMY_HASH)
    if not user or not ok:
        await db.login_attempts.update_one(
            {"key": key}, {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": now() + timedelta(minutes=15)}},
            upsert=True)
        raise HTTPException(401, "Incorrect email or password")
    await db.login_attempts.delete_one({"key": key})
    if not user.get("email_verified"):
        if not await recently_sent(user["id"], "verify"):
            code = await create_code(user["id"], "verify")
            await deliver(send_verification_code, email, user["full_name"], code)
        raise HTTPException(403, "email_not_verified")
    return await issue_tokens(user["id"])


@api.post("/auth/refresh")
async def refresh(body: TokenIn):
    raw = secrets.token_urlsafe(32)
    s = await db.sessions.find_one_and_update(
        {"hash": digest(body.refresh_token), "revoked": False, "expires_at": {"$gt": now()}},
        {"$set": {"hash": digest(raw), "expires_at": now() + timedelta(days=REFRESH_DAYS)}})
    if not s:
        raise HTTPException(401, "Invalid refresh token")
    return {"access_token": make_access(s["user_id"]), "refresh_token": raw, "token_type": "bearer"}


@api.post("/auth/logout")
async def logout(body: TokenIn):
    await db.sessions.update_one({"hash": digest(body.refresh_token)}, {"$set": {"revoked": True}})
    return {"ok": True}


@api.post("/auth/forgot-password", status_code=202)
async def forgot_password(body: EmailIn):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if user and not await recently_sent(user["id"], "reset"):
        code = await create_code(user["id"], "reset")
        await deliver(send_reset_code, user["email"], user["full_name"], code)
    return GENERIC_SENT


@api.post("/auth/reset-password")
async def reset_password(body: ResetIn):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or not await consume_code(user["id"], "reset", body.code):
        raise HTTPException(400, "Invalid or expired code")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "password_hash": hash_password(body.new_password), "email_verified": True, "updated_at": now()}})
    await db.sessions.update_many({"user_id": user["id"]}, {"$set": {"revoked": True}})
    return {"ok": True}


# ---------------------------------------------------------------- profile routes
@api.get("/me", response_model=UserOut)
async def get_me(user: dict = Depends(current_user)):
    return UserOut.from_doc(user)


@api.patch("/me", response_model=UserOut)
async def update_me(body: ProfileUpdate, user: dict = Depends(current_user)):
    updates = body.model_dump(exclude_none=True, exclude={"clear_hourly_rate"})
    if body.clear_hourly_rate:
        updates["hourly_rate"] = None
    if "full_name" in updates:
        updates["full_name"] = updates["full_name"].strip()
    if "hourly_rate" in updates and updates["hourly_rate"] is not None:
        updates["hourly_rate"] = round(updates["hourly_rate"], 2)
    updates["updated_at"] = now()
    await db.users.update_one({"id": user["id"]}, {"$set": updates})
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    return UserOut.from_doc(fresh)


@api.post("/me/change-password")
async def change_password(body: ChangePasswordIn, user: dict = Depends(current_user)):
    if not verify_password(body.current_password, user["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "password_hash": hash_password(body.new_password), "updated_at": now()}})
    await db.sessions.update_many({"user_id": user["id"]}, {"$set": {"revoked": True}})
    return await issue_tokens(user["id"])


@api.delete("/me")
async def delete_me(body: DeleteAccountIn, user: dict = Depends(current_user)):
    if not verify_password(body.password, user["password_hash"]):
        raise HTTPException(400, "Password is incorrect")
    uid = user["id"]
    # Permanently remove all personal data for this user.
    for coll in ("sessions", "action_codes", "pp_shifts", "payments"):
        await db[coll].delete_many({"user_id": uid})
    await db.users.delete_one({"id": uid})
    logger.info(f"Account deleted: {uid}")
    return {"ok": True}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.sessions.create_index("hash", unique=True)
    await db.sessions.create_index("user_id")
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.action_codes.create_index("expires_at", expireAfterSeconds=0)
    await db.action_codes.create_index([("user_id", 1), ("kind", 1)])
    await db.login_attempts.create_index("key", unique=True)
    await db.login_attempts.create_index("expires_at", expireAfterSeconds=0)


@app.on_event("shutdown")
async def shutdown():
    client.close()
