"""DutyConnect API — Milestone 1: accounts & foundations."""
import os
import hmac
import uuid
import asyncio
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

from email_service import send_verification_code, send_reset_code, send_deletion_code, send_deletion_confirmation  # noqa: E402
from public_pages import router as public_router  # noqa: E402
from security import install_security  # noqa: E402
from billing import make_router as make_billing_router  # noqa: E402

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
LOGIN_MAX_FAILS = 5  # per account + IP
ACCOUNT_MAX_FAILS = 10  # per account, any IP/device
DEV_LOG_CODES = os.environ.get("DEV_LOG_CODES", "false").lower() == "true"
TRUSTED_PROXY_HOPS = int(os.environ.get("TRUSTED_PROXY_HOPS", "0"))
# SHA-256 of signing secrets known from development; production refuses to start with them.
KNOWN_DEV_SECRET_HASHES = {"f6e5a38b840f06c7c7f6e96fecd263e0c50f63e2d6f0c52ea280a875279affdb"}

# Feature flags per plan. Subscriptions (Phase 4) only change the user's `plan`;
# the app reads `features` from /api/me so no rebuild is needed.
PLAN_FEATURES = {
    "free": {
        "pp_shifts": True, "calendar": True, "earnings": True, "payments": True,
        "reports_csv": True, "reports_pdf": False, "earnings_dashboard": False, "multi_payments": False,
        "multi_device": False, "history_days": 30, "calendar_reminders": False,
        "sms_forwarding": False, "multi_destinations": False, "priority_support": False,
    },
    "pro": {
        "pp_shifts": True, "calendar": True, "earnings": True, "payments": True,
        "reports_csv": True, "reports_pdf": True, "earnings_dashboard": True, "multi_payments": True,
        "multi_device": True, "history_days": None, "calendar_reminders": False,
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


_bg_tasks: set = set()


def send_later(send, *args):
    """Deliver auth email in the background so response time doesn't reveal whether an account exists."""
    t = asyncio.create_task(deliver(send, *args))
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)


def account_hash(email: str) -> str:
    return hmac.new(JWT_SECRET.encode(), email.strip().lower().encode(), hashlib.sha256).hexdigest()


def client_ip(request: Request) -> str:
    # Behind N trusted proxies (TRUSTED_PROXY_HOPS, set in production) the real client is the N-th
    # address from the right of X-Forwarded-For; earlier entries can be forged by the client. With 0
    # (preview default) the first entry is used, so the per-account limit remains the real control.
    xff = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    hops = TRUSTED_PROXY_HOPS
    if hops > 0:
        return xff[-hops] if len(xff) >= hops else (request.client.host if request.client else "unknown")
    return xff[0] if xff else (request.client.host if request.client else "unknown")


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
        # Avoid account enumeration: same response and similar timing. Resend code only if still unverified.
        hash_password(body.password)
        if not existing.get("email_verified") and not await recently_sent(existing["id"], "verify"):
            code = await create_code(existing["id"], "verify")
            send_later(send_verification_code, email, existing["full_name"], code)
        return GENERIC_SENT
    uid = str(uuid.uuid4())
    await db.users.insert_one({
        "id": uid, "email": email, "full_name": body.full_name.strip(), "password_hash": hash_password(body.password),
        "professional_category": "Prison Officer", "currency": "GBP", "hourly_rate": None,
        "notification_prefs": NotificationPrefs().model_dump(), "plan": "free",
        "email_verified": False, "created_at": now(), "updated_at": now(),
    })
    code = await create_code(uid, "verify")
    send_later(send_verification_code, email, body.full_name.strip(), code)
    return GENERIC_SENT


@api.post("/auth/resend-verification", status_code=202)
async def resend_verification(body: EmailIn):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if user and not user.get("email_verified") and not await recently_sent(user["id"], "verify"):
        code = await create_code(user["id"], "verify")
        send_later(send_verification_code, user["email"], user["full_name"], code)
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
    # Primary control: per-account counter (independent of IP/device, applied to unknown emails too).
    # Secondary: per account+IP counter. The account lock is temporary (15 min) and cleared by a
    # successful password reset, so an attacker cannot lock a real officer out permanently.
    acct_key = "acct:" + account_hash(email)
    ip_key = "ip:" + digest(f"{email}:{client_ip(request)}")
    for key, limit in ((acct_key, ACCOUNT_MAX_FAILS), (ip_key, LOGIN_MAX_FAILS)):
        attempt = await db.login_attempts.find_one({"key": key})
        if attempt and attempt["count"] >= limit and attempt["expires_at"] > now():
            raise HTTPException(429, "Too many attempts. Please try again later or reset your password.")
    user = await db.users.find_one({"email": email}, {"_id": 0})
    ok = verify_password(body.password, user["password_hash"] if user else _DUMMY_HASH)
    if not user or not ok:
        for key in (acct_key, ip_key):
            await db.login_attempts.update_one(
                {"key": key}, {"$inc": {"count": 1}, "$setOnInsert": {"expires_at": now() + timedelta(minutes=15)}},
                upsert=True)
        raise HTTPException(401, "Incorrect email or password")
    await db.login_attempts.delete_many({"key": {"$in": [acct_key, ip_key]}})
    if not user.get("email_verified"):
        # Only reachable with the correct password, so it reveals nothing to someone guessing emails.
        if not await recently_sent(user["id"], "verify"):
            code = await create_code(user["id"], "verify")
            send_later(send_verification_code, email, user["full_name"], code)
        raise HTTPException(403, "email_not_verified")
    return await issue_tokens(user["id"])


@api.post("/auth/refresh")
async def refresh(body: TokenIn):
    raw = secrets.token_urlsafe(32)
    s = await db.sessions.find_one_and_update(
        {"hash": digest(body.refresh_token), "revoked": False, "expires_at": {"$gt": now()}},
        {"$set": {"hash": digest(raw), "expires_at": now() + timedelta(days=REFRESH_DAYS)}})
    if not s:
        gone = await db.sessions.find_one({"hash": digest(body.refresh_token), "account_deleted": True})
        if gone:
            raise HTTPException(410, "account_deleted")  # tells the device to wipe its local copy
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
        send_later(send_reset_code, user["email"], user["full_name"], code)
    return GENERIC_SENT


@api.post("/auth/reset-password")
async def reset_password(body: ResetIn):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or not await consume_code(user["id"], "reset", body.code):
        raise HTTPException(400, "Invalid or expired code")
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "password_hash": hash_password(body.new_password), "email_verified": True, "updated_at": now()}})
    await db.sessions.update_many({"user_id": user["id"]}, {"$set": {"revoked": True}})
    await db.login_attempts.delete_one({"key": "acct:" + account_hash(user["email"])})
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
    await delete_user_data(user, via="app")
    return {"ok": True}


async def delete_user_data(user: dict, via: str):
    """Permanently remove an officer's personal data (profile, shifts incl. Recently Deleted, payments,
    codes). Sessions are kept only as revoked hashes flagged account_deleted, so the officer's other
    devices learn to wipe their local copy; they expire with the refresh token. A deletion-log entry
    (keyed hash + date, no email) lets restore_backup re-apply the deletion after a backup restore."""
    uid = user["id"]
    for coll in ("action_codes", "pp_shifts", "payments", "subscriptions"):
        await db[coll].delete_many({"user_id": uid})
    await db.sessions.update_many({"user_id": uid}, {"$set": {"revoked": True, "account_deleted": True}})
    await db.login_attempts.delete_one({"key": "acct:" + account_hash(user["email"])})
    await db.deletion_log.insert_one({"user_id": uid, "account_hash": account_hash(user["email"]),
                                      "deleted_at": now(), "via": via})
    await db.users.delete_one({"id": uid})
    send_later(send_deletion_confirmation, user["email"], user["full_name"])
    logger.info(f"Account deleted: {uid} via {via}")


# ---------------------------------------------------------------- public account deletion (no login)
class DeletionConfirmIn(BaseModel):
    email: EmailStr
    code: str = Field(min_length=6, max_length=6)
    confirm: Literal[True]


@api.post("/public/account-deletion/request", status_code=202)
async def deletion_request(body: EmailIn):
    """Send a single-use, 15-minute code. Same response whether or not the account exists."""
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if user and not await recently_sent(user["id"], "delete"):
        code = await create_code(user["id"], "delete")
        send_later(send_deletion_code, user["email"], user["full_name"], code)
    return GENERIC_SENT


@api.post("/public/account-deletion/confirm")
async def deletion_confirm(body: DeletionConfirmIn):
    user = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not user or not await consume_code(user["id"], "delete", body.code):
        raise HTTPException(400, "Invalid or expired code")
    await delete_user_data(user, via="web")
    return {"ok": True}


# ---------------------------------------------------------------- PP shifts (offline-first sync)
import re  # noqa: E402
from typing import List  # noqa: E402
from pydantic import model_validator  # noqa: E402
from pymongo.errors import DuplicateKeyError  # noqa: E402

TIME_RE = r"^([01]\d|2[0-3]):[0-5]\d$"
DATE_RE = r"^\d{4}-\d{2}-\d{2}$"
UUID_RE = r"^[0-9a-fA-F-]{8,64}$"
# UK prisoner number format (e.g. A1234BC) — blocked to avoid collecting prisoner data.
PRISONER_NO_RE = re.compile(r"\b[A-Za-z]\d{4}[A-Za-z]{2}\b")
SENSITIVE_WORDS_RE = re.compile(r"\b(prisoner|inmate|nomis|pnc|cell\s*\d+|wing\s*[a-z]?\d+)\b", re.I)


def shift_minutes(start: str, end: str) -> int:
    s = int(start[:2]) * 60 + int(start[3:])
    e = int(end[:2]) * 60 + int(end[3:])
    return e - s if e > s else e + 1440 - s  # crosses midnight when finish <= start


def check_sensitive(v: str, what: str = "text"):
    if PRISONER_NO_RE.search(v) or SENSITIVE_WORDS_RE.search(v):
        raise ValueError("Do not enter prisoner details, cell/wing numbers or operational records")


class PaymentIn(BaseModel):
    """A payment received for one shift. Immutable once created: an edit = tombstone old + add new,
    so concurrent changes on different devices can always be merged by id without losing records."""
    id: str = Field(pattern=UUID_RE)
    amount: float = Field(gt=0, le=10000)
    date: str = Field(pattern=DATE_RE)
    note: str = Field(default="", max_length=40)
    deleted: bool = False
    # Id of the original payment this one (directly or indirectly) replaces. Two active payments
    # sharing an origin = the same payment edited differently on two devices (an edit clash).
    origin_id: Optional[str] = Field(default=None, pattern=UUID_RE)

    @model_validator(mode="after")
    def _check(self):
        d = datetime.strptime(self.date, "%Y-%m-%d").date()
        if d > (now() + timedelta(days=1)).date():
            raise ValueError("Payment date cannot be in the future")
        check_sensitive(self.note)
        self.amount = round(self.amount, 2)
        self.note = self.note.strip()
        return self


class DecisionIn(BaseModel):
    """The officer's explicit choice in a payment edit clash. Immutable and merged by id, so a choice
    never deletes payment history; a later choice lists the choices it `supersedes`. Two live choices
    keeping different versions (made on two devices) stay a visible clash until chosen again."""
    id: str = Field(pattern=UUID_RE)
    origin_id: str = Field(pattern=UUID_RE)
    keep_id: str = Field(pattern=UUID_RE)
    rejected: List[str] = Field(default_factory=list, max_length=20)
    supersedes: List[str] = Field(default_factory=list, max_length=50)

    @field_validator("rejected", "supersedes")
    @classmethod
    def _ids(cls, v):
        if any(not re.match(UUID_RE, x) for x in v):
            raise ValueError("Invalid id")
        return v


class ShiftData(BaseModel):
    officer_name: str = Field(min_length=1, max_length=80)
    duty_type: Literal["bed_watch", "constant_watch", "other"]
    shift_period: Literal["day", "night"]
    date: str = Field(pattern=DATE_RE)
    start_time: str = Field(pattern=TIME_RE)
    end_time: str = Field(pattern=TIME_RE)
    break_minutes: int = Field(ge=0, le=720)
    location: str = Field(default="", max_length=60)
    status: Literal["booked", "completed", "cancelled"] = "booked"
    hourly_rate: Optional[float] = Field(default=None, ge=0, le=500)
    payments: List[PaymentIn] = Field(default_factory=list, max_length=200)
    payment_decisions: List[DecisionIn] = Field(default_factory=list, max_length=200)
    # payment_status is always derived from payments; any client value is ignored.

    @model_validator(mode="after")
    def _check(self):
        datetime.strptime(self.date, "%Y-%m-%d")
        if self.start_time == self.end_time:
            raise ValueError("Finish time cannot equal start time")
        if self.break_minutes >= shift_minutes(self.start_time, self.end_time):
            raise ValueError("Unpaid break must be shorter than the shift")
        for v in (self.location, self.officer_name):
            check_sensitive(v)
        if self.status == "cancelled" and any(not p.deleted for p in self.payments):
            raise ValueError("Remove recorded payments before cancelling this shift")
        self.location = self.location.strip()
        return self


class ShiftChange(BaseModel):
    id: str = Field(pattern=UUID_RE)
    change_id: str = Field(pattern=UUID_RE)
    base_version: int = Field(ge=0)
    deleted: bool = False
    data: Optional[ShiftData] = None

    @model_validator(mode="after")
    def _need_data(self):
        if not self.deleted and self.data is None:
            raise ValueError("Shift data required")
        return self


class SyncIn(BaseModel):
    changes: List[ShiftChange] = Field(default_factory=list, max_length=500)
    since: Optional[datetime] = None


def merge_payments(server: list, incoming: list) -> list:
    """Union by payment id. Deletion is sticky (tombstone wins), so no device can resurrect or drop
    another device's payment."""
    out = {p["id"]: dict(p) for p in server}
    for p in incoming:
        if p["id"] in out:
            out[p["id"]]["deleted"] = out[p["id"]].get("deleted", False) or p.get("deleted", False)
        else:
            out[p["id"]] = dict(p)
    return sorted(out.values(), key=lambda p: (p["date"], p["id"]))


def merge_decisions(server: list, incoming: list) -> list:
    """Union by id; decisions are immutable so nothing recorded on any device is lost."""
    out = {d["id"]: dict(d) for d in incoming}
    out.update({d["id"]: dict(d) for d in server})
    return sorted(out.values(), key=lambda d: d["id"])


def group_candidates(active: list, decisions: list) -> tuple:
    """Versions of one original payment that may count, and whether the figure is provisional.
    - no live decision: every active version is a candidate (2+ = edit clash)
    - one kept version across live decisions: the rejected versions stop counting (kept in history)
    - live decisions keeping different versions (two devices): decision clash, both stay candidates."""
    superseded = {s for d in decisions for s in d.get("supersedes", [])}
    live = [d for d in decisions if d["id"] not in superseded]
    keeps = {d["keep_id"] for d in live}
    if len(keeps) > 1:
        cands = [p for p in active if p["id"] in keeps] or active
        return cands, True
    rejected = {r for d in live for r in d.get("rejected", [])}
    cands = [p for p in active if p["id"] not in rejected]
    return cands, len(cands) > 1


def counted_payments(payments: list, decisions: Optional[list] = None) -> tuple:
    """Payments that count towards totals. A payment edited on two devices is never counted twice:
    while unresolved only the lowest candidate counts and the figures are flagged provisional.
    Mirrors countedPayments() in the app."""
    groups: dict = {}
    for p in payments:
        if not p.get("deleted"):
            groups.setdefault(p.get("origin_id") or p["id"], []).append(p)
    counted, clash = [], False
    for origin, g in groups.items():
        cands, provisional = group_candidates(g, [d for d in decisions or [] if d["origin_id"] == origin])
        clash = clash or provisional
        if cands:
            counted.append(min(cands, key=lambda p: (round(p["amount"] * 100), p["id"])))
    return counted, clash


def payment_fields(estimated: Optional[float], payments: list, decisions: Optional[list] = None) -> dict:
    counted, clash = counted_payments(payments, decisions)
    pence = sum(round(p["amount"] * 100) for p in counted)
    received = pence / 100
    outstanding = None if estimated is None else (round(estimated * 100) - pence) / 100
    if pence == 0:
        status = "pending"
    elif estimated is not None and pence >= round(estimated * 100):
        status = "paid"
    else:
        status = "partially_paid"
    return {"amount_received": received, "outstanding": outstanding, "payment_status": status, "payment_clash": clash}


def computed(d: dict) -> dict:
    hours = round((shift_minutes(d["start_time"], d["end_time"]) - d["break_minutes"]) / 60, 2)
    rate = d.get("hourly_rate")
    est = round(hours * rate, 2) if rate is not None else None
    return {"payable_hours": hours, "estimated_earnings": est,
            **payment_fields(est, d.get("payments", []), d.get("payment_decisions", []))}


def shift_out(doc: dict) -> dict:
    out = {k: v for k, v in doc.items() if k not in ("_id", "user_id", "last_change_id")}
    out.setdefault("payments", [])
    out.setdefault("payment_decisions", [])
    # Always derive payment status from recorded payments (legacy manual statuses become Pending).
    out.update(payment_fields(out.get("estimated_earnings"), out["payments"], out["payment_decisions"]))
    out.setdefault("deleted_at", None)
    for k in ("created_at", "updated_at", "deleted_at"):
        if isinstance(out.get(k), datetime):
            out[k] = out[k].isoformat()
    return out


async def apply_change(uid: str, ch: ShiftChange) -> dict:
    cur = await db.pp_shifts.find_one({"id": ch.id}, {"_id": 0})
    if cur and cur["user_id"] != uid:
        return {"id": ch.id, "status": "rejected", "server": None}
    if cur and cur.get("last_change_id") == ch.change_id:
        return {"id": ch.id, "status": "duplicate", "server": shift_out(cur)}  # retry of an applied change
    incoming = ch.data.model_dump() if ch.data else None
    fields = {"deleted": ch.deleted, "last_change_id": ch.change_id, "updated_at": now()}
    # Deleted shifts keep all their details and payments for DELETED_RETENTION_DAYS (Recently
    # Deleted); a change with deleted=false restores them.
    if ch.deleted:
        fields["deleted_at"] = cur["deleted_at"] if cur and cur.get("deleted") and cur.get("deleted_at") else now()
    else:
        fields["deleted_at"] = None
    if incoming:
        if cur:
            incoming["payments"] = merge_payments(cur.get("payments", []), incoming["payments"])
            incoming["payment_decisions"] = merge_decisions(cur.get("payment_decisions", []), incoming["payment_decisions"])
        fields.update(incoming, **computed(incoming))
    if not cur:
        if ch.base_version != 0:
            return {"id": ch.id, "status": "conflict", "server": None}  # edited a record the server no longer has
        doc = {"id": ch.id, "user_id": uid, "version": 1, "created_at": now(), **fields}
        try:
            await db.pp_shifts.insert_one(doc)
        except DuplicateKeyError:
            return await apply_change(uid, ch)
        return {"id": ch.id, "status": "applied", "server": shift_out(doc)}
    if ch.base_version != cur["version"]:
        # Shift details conflict and need the officer's choice, but payments are merged immediately
        # so nothing recorded on either device is lost.
        if incoming and not cur.get("deleted") and (
                incoming["payments"] != cur.get("payments", [])
                or incoming["payment_decisions"] != cur.get("payment_decisions", [])):
            merged = {**cur, "payments": incoming["payments"], "payment_decisions": incoming["payment_decisions"]}
            upd = {"payments": incoming["payments"], "payment_decisions": incoming["payment_decisions"],
                   **computed(merged), "updated_at": now()}
            res = await db.pp_shifts.find_one_and_update(
                {"id": ch.id, "user_id": uid, "version": cur["version"]},
                {"$set": upd, "$inc": {"version": 1}}, projection={"_id": 0}, return_document=True)
            cur = res or await db.pp_shifts.find_one({"id": ch.id}, {"_id": 0})
        return {"id": ch.id, "status": "conflict", "server": shift_out(cur)}
    res = await db.pp_shifts.find_one_and_update(
        {"id": ch.id, "user_id": uid, "version": cur["version"]},
        {"$set": fields, "$inc": {"version": 1}}, projection={"_id": 0}, return_document=True)
    if not res:
        return await apply_change(uid, ch)  # lost a race; re-evaluate against the latest version
    return {"id": ch.id, "status": "applied", "server": shift_out(res)}


DELETED_RETENTION_DAYS = 90


async def purge_expired_deleted(uid: str):
    """Permanently remove shifts (and their payments) deleted more than 90 days ago."""
    cutoff = now() - timedelta(days=DELETED_RETENTION_DAYS)
    await db.pp_shifts.delete_many({"user_id": uid, "deleted": True, "$or": [
        {"deleted_at": {"$lt": cutoff}}, {"deleted_at": None, "updated_at": {"$lt": cutoff}}]})


@api.post("/shifts/sync")
async def sync_shifts(body: SyncIn, request: Request, user: dict = Depends(current_user)):
    # Free: cloud sync from one phone. Another phone gets 403 (its records stay safely on that
    # phone) until the officer upgrades or makes that phone the sync phone.
    device = (request.headers.get("x-device-id") or "unknown")[:64]
    if user.get("plan", "free") != "pro":
        if not user.get("sync_device"):
            await db.users.update_one({"id": user["id"], "sync_device": None}, {"$set": {"sync_device": device}})
        elif user["sync_device"] != device:
            raise HTTPException(403, "pro_required_multi_device")
    server_time = now()
    results = [await apply_change(user["id"], ch) for ch in body.changes]
    await purge_expired_deleted(user["id"])
    q = {"user_id": user["id"]}
    if body.since:
        q["updated_at"] = {"$gt": body.since - timedelta(seconds=2)}  # small overlap; merging is idempotent
    else:
        # Full pull: active shifts plus Recently Deleted ones still within the retention window.
        q["$or"] = [{"deleted": False}, {"deleted_at": {"$gt": now() - timedelta(days=DELETED_RETENTION_DAYS)}}]
    docs = await db.pp_shifts.find(q, {"_id": 0}).to_list(5000)
    return {"results": results, "shifts": [shift_out(d) for d in docs], "server_time": server_time.isoformat()}


app.include_router(api)
app.include_router(public_router)
app.include_router(make_billing_router(db, current_user, logger))
install_security(app, client_ip)


@app.post("/api/devices/primary")
async def make_sync_phone(request: Request, user: dict = Depends(current_user)):
    """Free plan: make this phone the one that syncs (the previous phone stops syncing; nothing is deleted)."""
    device = (request.headers.get("x-device-id") or "unknown")[:64]
    await db.users.update_one({"id": user["id"]}, {"$set": {"sync_device": device}})
    return {"ok": True}

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    # Native iOS/Android apps don't send an Origin header, so CORS only affects browsers.
    allow_origins=[o.strip() for o in os.environ["CORS_ORIGINS"].split(",") if o.strip()],
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
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
    await db.pp_shifts.create_index("id", unique=True)
    await db.pp_shifts.create_index([("user_id", 1), ("updated_at", 1)])
    await db.login_attempts.create_index("key", unique=True)
    await db.login_attempts.create_index("expires_at", expireAfterSeconds=0)
    await db.subscriptions.create_index("token_hash", unique=True)
    await db.subscriptions.create_index("user_id")
    await db.rtdn_events.create_index("message_id", unique=True)
    await db.rtdn_events.create_index("at", expireAfterSeconds=90 * 86400)
    # Deletion log outlives the longest backup so restores can re-apply deletions.
    await db.deletion_log.create_index("deleted_at", expireAfterSeconds=DELETION_LOG_DAYS * 86400)
    if os.environ.get("ENVIRONMENT", "development") == "production":
        problems = production_config_problems()
        if problems:
            raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))


DELETION_LOG_DAYS = int(os.environ.get("BACKUP_RETENTION_DAYS", "35")) + 30


def production_config_problems() -> list:
    """Refuse to start in production with development settings or placeholders."""
    p = []
    if DEV_LOG_CODES:
        p.append("DEV_LOG_CODES must be false")
    if len(JWT_SECRET) < 32 or digest(JWT_SECRET) in KNOWN_DEV_SECRET_HASHES or "REPLACE" in JWT_SECRET:
        p.append("JWT_SECRET must be a new random value of at least 32 characters (not the development one)")
    if TRUSTED_PROXY_HOPS < 1:
        p.append("TRUSTED_PROXY_HOPS must be set to the number of reverse proxies in front of the API")
    if os.environ.get("EMAIL_PROVIDER", "emergent") == "resend":
        if "REPLACE" in os.environ.get("RESEND_API_KEY", "REPLACE"):
            p.append("RESEND_API_KEY is not set")
        if "YOUR-DOMAIN" in os.environ.get("EMAIL_FROM_ADDRESS", "YOUR-DOMAIN"):
            p.append("EMAIL_FROM_ADDRESS still has a placeholder")
    origins = os.environ.get("CORS_ORIGINS", "")
    if "*" in origins or "localhost" in origins or "preview.emergentagent.com" in origins:
        p.append("CORS_ORIGINS must list only production origins")
    if os.environ.get("BILLING_MODE", "mock") != "google":
        p.append("BILLING_MODE must be 'google' (mock billing is for development only)")
    for k in ("PUBLIC_BASE_URL", "SUPPORT_EMAIL", "DATA_CONTROLLER_NAME"):
        v = os.environ.get(k, "")
        if not v or "YOUR-DOMAIN" in v or "[" in v:
            p.append(f"{k} still has a placeholder")
    return p


@app.on_event("shutdown")
async def shutdown():
    client.close()
