"""Shared fixtures for DutyConnect backend tests."""
import os
import re
import time
import uuid
import subprocess
import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://dutyconnect-beta.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MAIN_EMAIL = "delivered+t1@resend.dev"
# Test passwords come from the environment (backend/.env, git-ignored) - never hardcode them.
MAIN_PASSWORD = os.environ.get("TEST_MAIN_PASSWORD", "REPLACE_WITH_TEST_MAIN_PASSWORD")
# Throwaway accounts created by tests; a random per-run value is used if unset.
TEST_PASSWORD = os.environ.get("TEST_USER_PASSWORD") or f"Tp{uuid.uuid4().hex[:12]}1"
TEST_PASSWORD_ALT = f"Alt{uuid.uuid4().hex[:12]}2"
LOG_FILE = "/var/log/supervisor/backend.err.log"


@pytest.fixture(scope="session")
def api_url():
    return API


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def mongo_db():
    c = MongoClient("mongodb://localhost:27017")
    yield c["test_database"]
    c.close()


def _tail_log(lines: int = 400) -> str:
    try:
        return subprocess.check_output(["tail", "-n", str(lines), LOG_FILE], text=True)
    except Exception:
        return ""


def read_code_for_user(user_id: str, kind: str = "verify", retries: int = 10, delay: float = 0.5) -> str | None:
    """Codes are never logged (DEV_LOG_CODES=false). Tests replace the stored hash with a known code."""
    import hashlib
    import os
    from pymongo import MongoClient
    from dotenv import load_dotenv
    load_dotenv("/app/backend/.env")
    db = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    code = "246810"
    for _ in range(retries):
        r = db.action_codes.update_one({"user_id": user_id, "kind": kind},
                                       {"$set": {"hash": hashlib.sha256(code.encode()).hexdigest(), "attempts": 0}})
        if r.matched_count:
            return code
        time.sleep(delay)
    return None


def read_code_by_db(mongo_db, user_id: str, kind: str) -> str | None:
    """Fallback: cannot read code from DB (hashed). Only via logs."""
    return None


@pytest.fixture(scope="session")
def code_reader():
    return read_code_for_user


@pytest.fixture
def main_user_tokens(api_client, mongo_db):
    """Login the seeded verified test user, clearing lockout state first."""
    mongo_db.login_attempts.delete_many({})
    r = api_client.post(f"{API}/auth/login", json={"email": MAIN_EMAIL, "password": MAIN_PASSWORD})
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture
def auth_headers(main_user_tokens):
    return {"Authorization": f"Bearer {main_user_tokens['access_token']}"}
