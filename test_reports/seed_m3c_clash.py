"""Seed a M3c payment clash (edit) and a decision clash for the main test user.
Returns JSON with the shift id and payment ids used so the Playwright script can target them."""
import json
import os
import sys
import time
import uuid
from datetime import date

import requests

BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://dutyconnect-beta.preview.emergentagent.com").rstrip("/")
EMAIL = "delivered+t1@resend.dev"
PASSWORD = os.environ.get("TEST_MAIN_PASSWORD", "REPLACE_WITH_TEST_MAIN_PASSWORD")

ACTION = sys.argv[1] if len(sys.argv) > 1 else "edit"  # edit | decision | cleanup


def _uid():
    return str(uuid.uuid4())


def _login():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
    r.raise_for_status()
    return r.json()["access_token"]


def _sync(h, changes=None, since=None):
    body = {"changes": changes or [], "last_sync": since}
    r = requests.post(f"{BASE}/api/shifts/sync", headers=h, json=body, timeout=20)
    r.raise_for_status()
    return r.json()


def _payment(amount, pid=None, origin=None, deleted=False):
    p = {"id": pid or _uid(), "amount": amount, "date": date.today().isoformat(), "note": "", "deleted": deleted}
    if origin:
        p["origin_id"] = origin
    return p


def _shift(payments, decisions=None):
    s = {
        "officer_name": "T1 Tester",
        "duty_type": "bed_watch",
        "shift_period": "day",
        "date": date.today().isoformat(),
        "start_time": "08:00",
        "end_time": "20:00",
        "break_minutes": 0,
        "location": "HMP Example",
        "status": "completed",
        "hourly_rate": 30,
        "payments": payments,
    }
    if decisions is not None:
        s["payment_decisions"] = decisions
    return s


def _change(id_=None, change_id=None, base_version=0, data=None, deleted=False):
    return {
        "id": id_ or _uid(),
        "change_id": change_id or _uid(),
        "base_version": base_version,
        "deleted": deleted,
        "data": data,
    }


def _me(h):
    return _sync(h, [])


def cleanup(h):
    data = _me(h)
    killed = 0
    for s in data.get("shifts", []):
        if s.get("officer_name") == "T1 Tester" and s.get("duty_type") == "bed_watch" and s.get("location") == "HMP Example":
            ch = _change(id_=s["id"], base_version=s.get("version", 0), deleted=True, data=s)
            _sync(h, [ch])
            killed += 1
    return killed


def seed_edit(h):
    p1 = _payment(100)
    pa = _payment(150, origin=p1["id"])
    pb = _payment(120, origin=p1["id"])
    pays = [{**p1, "deleted": True}, pa, pb]
    ch = _change(data=_shift(pays))
    srv = _sync(h, [ch])["results"][0]["server"]
    return {"shift_id": ch["id"], "version": srv["version"], "payments": pays, "p1": p1, "pa": pa, "pb": pb, "amount_received": srv.get("amount_received"), "payment_clash": srv.get("payment_clash")}


def seed_decision(h):
    """Build an edit clash then push two different decisions at the same base_version => decision clash."""
    info = seed_edit(h)
    sid = info["shift_id"]
    v = info["version"]
    pays = info["payments"]
    p1, pa, pb = info["p1"], info["pa"], info["pb"]
    da = {"id": _uid(), "origin_id": p1["id"], "keep_id": pa["id"], "rejected": [pb["id"]], "supersedes": []}
    _sync(h, [_change(id_=sid, base_version=v, data=_shift(pays, decisions=[da]))])
    db = {"id": _uid(), "origin_id": p1["id"], "keep_id": pb["id"], "rejected": [pa["id"]], "supersedes": []}
    res = _sync(h, [_change(id_=sid, base_version=v, data=_shift(pays, decisions=[db]))])["results"][0]["server"]
    info["version"] = res["version"]
    info["payment_clash"] = res.get("payment_clash")
    info["amount_received"] = res.get("amount_received")
    info["decisions"] = [da, db]
    return info


def main():
    h = {"Authorization": f"Bearer {_login()}", "Content-Type": "application/json"}
    if ACTION == "cleanup":
        n = cleanup(h)
        print(json.dumps({"cleaned": n}))
        return
    cleanup(h)
    if ACTION == "edit":
        print(json.dumps(seed_edit(h)))
    elif ACTION == "decision":
        print(json.dumps(seed_decision(h)))
    else:
        print(json.dumps({"error": f"unknown action {ACTION}"}))


if __name__ == "__main__":
    main()
