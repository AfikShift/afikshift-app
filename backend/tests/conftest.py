"""Shared fixtures for DutyConnect backend tests."""
import os
import re
import time
import subprocess
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://dutyconnect-beta.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
MAIN_EMAIL = "delivered+t1@resend.dev"
MAIN_PASSWORD = "Testpass123"
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
    """Pull latest '[DEV] <kind> code for user <uid>: 123456' from backend logs."""
    pat = re.compile(rf"\[DEV\] {re.escape(kind)} code for user {re.escape(user_id)}: (\d{{6}})")
    for _ in range(retries):
        text = _tail_log(600)
        matches = pat.findall(text)
        if matches:
            return matches[-1]
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
