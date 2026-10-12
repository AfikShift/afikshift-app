"""Backend tests for DutyConnect Milestone 3a — payments on shifts (F1 + F3 merge).

Covers acceptance criteria from the user conditions:
  - amount <= 0 or > 10000 => 422
  - future date (> today+1) => 422
  - note > 40 chars => 422
  - note contains prisoner no / 'prisoner' / 'cell 12' => 422
  - active payments on status 'cancelled' => 422
  - server derives amount_received, outstanding (pence accurate, negative when overpaid),
    payment_status ('pending' | 'partially_paid' | 'paid'); client payment_status is ignored
  - legacy doc inserted directly in Mongo with payment_status='paid' and no payments
    => pulled as pending with payments=[]
  - F3 merge: A/B both base N -> both preserved on server; stale delete still sticky;
    two-device edit (both tombstone p1, each adds a new payment) -> p1 deleted,
    both p2 & p3 active; duplicate change_id -> 'duplicate', no doubling;
    editing shift hours/rate leaves payments unchanged, outstanding recalculated.
"""
import uuid
from datetime import date, timedelta
import pytest
from conftest import API, MAIN_EMAIL


def _uid() -> str:
    return str(uuid.uuid4())


# ---------- helpers to build shift / change payloads ----------
def _shift(**over) -> dict:
    """Day shift 08:00-20:00, 0 break, rate 30 => 12h * 30 = £360 estimated."""
    base = {
        "officer_name": "T1 Tester",
        "duty_type": "bed_watch",
        "shift_period": "day",
        "date": "2026-02-15",
        "start_time": "08:00",
        "end_time": "20:00",
        "break_minutes": 0,
        "location": "HMP Example",
        "status": "completed",
        "hourly_rate": 30,
        "payments": [],
    }
    base.update(over)
    return base


def _change(id_=None, change_id=None, base_version=0, deleted=False, data=None) -> dict:
    return {
        "id": id_ or _uid(),
        "change_id": change_id or _uid(),
        "base_version": base_version,
        "deleted": deleted,
        "data": data if data is not None else _shift(),
    }


def _payment(amount=100, note="October payslip", d=None, deleted=False, pid=None) -> dict:
    return {
        "id": pid or _uid(),
        "amount": amount,
        "date": d or date.today().isoformat(),
        "note": note,
        "deleted": deleted,
    }


@pytest.fixture
def clean_shifts(mongo_db):
    user = mongo_db.users.find_one({"email": MAIN_EMAIL})
    uid = user["id"] if user else None
    if uid:
        mongo_db.pp_shifts.delete_many({"user_id": uid})
    yield uid
    if uid:
        mongo_db.pp_shifts.delete_many({"user_id": uid})


# ---------------------------------------------------------------- Validation 422
class TestPaymentValidation:
    def test_amount_zero_rejected(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(payments=[_payment(amount=0)]))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r.status_code == 422

    def test_amount_negative_rejected(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(payments=[_payment(amount=-5)]))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r.status_code == 422

    def test_amount_over_10000_rejected(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(payments=[_payment(amount=10000.01)]))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r.status_code == 422

    def test_amount_at_boundary_10000_accepted(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(hourly_rate=500, start_time="08:00", end_time="20:00",
                                 payments=[_payment(amount=10000)]))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r.status_code == 200, r.text

    def test_future_date_rejected(self, api_client, auth_headers, clean_shifts):
        far = (date.today() + timedelta(days=5)).isoformat()
        ch = _change(data=_shift(payments=[_payment(d=far)]))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r.status_code == 422

    def test_tomorrow_date_accepted(self, api_client, auth_headers, clean_shifts):
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        ch = _change(data=_shift(payments=[_payment(d=tomorrow)]))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r.status_code == 200, r.text

    def test_note_over_40_chars_rejected(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(payments=[_payment(note="x" * 41)]))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r.status_code == 422

    @pytest.mark.parametrize("note", ["Ref A1234BC", "prisoner smith", "cell 12 payment"])
    def test_sensitive_notes_rejected(self, api_client, auth_headers, clean_shifts, note):
        ch = _change(data=_shift(payments=[_payment(note=note)]))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r.status_code == 422, f"note '{note}' should be rejected"

    def test_cancelled_shift_with_active_payments_rejected(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(status="cancelled", payments=[_payment()]))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r.status_code == 422

    def test_cancelled_shift_with_only_tombstoned_payments_allowed(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(status="cancelled",
                                 payments=[_payment(deleted=True)]))
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------- Server-derived status
class TestDerivedStatus:
    def test_no_payments_is_pending_and_full_outstanding(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift())
        srv = api_client.post(f"{API}/shifts/sync", headers=auth_headers,
                              json={"changes": [ch]}).json()["results"][0]["server"]
        assert srv["payment_status"] == "pending"
        assert srv["amount_received"] == 0
        assert srv["outstanding"] == 360.0  # 12h * 30

    def test_partial_payment(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(payments=[_payment(amount=100)]))
        srv = api_client.post(f"{API}/shifts/sync", headers=auth_headers,
                              json={"changes": [ch]}).json()["results"][0]["server"]
        assert srv["payment_status"] == "partially_paid"
        assert srv["amount_received"] == 100.0
        assert srv["outstanding"] == 260.0

    def test_full_payment_marks_paid(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(payments=[_payment(amount=100), _payment(amount=260)]))
        srv = api_client.post(f"{API}/shifts/sync", headers=auth_headers,
                              json={"changes": [ch]}).json()["results"][0]["server"]
        assert srv["payment_status"] == "paid"
        assert srv["amount_received"] == 360.0
        assert srv["outstanding"] == 0.0

    def test_overpaid_is_paid_and_outstanding_negative(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(payments=[_payment(amount=400)]))
        srv = api_client.post(f"{API}/shifts/sync", headers=auth_headers,
                              json={"changes": [ch]}).json()["results"][0]["server"]
        assert srv["payment_status"] == "paid"
        assert srv["outstanding"] == -40.0

    def test_pence_accurate_outstanding(self, api_client, auth_headers, clean_shifts):
        # 0.1 + 0.2 is classically lossy in IEEE-754; server must do pence arithmetic.
        ch = _change(data=_shift(payments=[_payment(amount=0.1), _payment(amount=0.2)]))
        srv = api_client.post(f"{API}/shifts/sync", headers=auth_headers,
                              json={"changes": [ch]}).json()["results"][0]["server"]
        assert srv["amount_received"] == 0.30, srv["amount_received"]
        assert srv["outstanding"] == 359.70  # 360.00 - 0.30, exact

    def test_deleted_payments_excluded_from_totals(self, api_client, auth_headers, clean_shifts):
        pid = _uid()
        ch = _change(data=_shift(payments=[_payment(pid=pid, amount=200, deleted=True),
                                            _payment(amount=100)]))
        srv = api_client.post(f"{API}/shifts/sync", headers=auth_headers,
                              json={"changes": [ch]}).json()["results"][0]["server"]
        assert srv["amount_received"] == 100.0
        assert srv["outstanding"] == 260.0
        assert srv["payment_status"] == "partially_paid"

    def test_no_rate_outstanding_is_null(self, api_client, auth_headers, clean_shifts):
        ch = _change(data=_shift(hourly_rate=None, payments=[_payment(amount=50)]))
        srv = api_client.post(f"{API}/shifts/sync", headers=auth_headers,
                              json={"changes": [ch]}).json()["results"][0]["server"]
        assert srv["outstanding"] is None
        assert srv["amount_received"] == 50.0
        # with no estimated earnings and some payment received, status is partial (not paid)
        assert srv["payment_status"] == "partially_paid"


# ---------------------------------------------------------------- Legacy / backwards compat
class TestLegacyDoc:
    def test_legacy_paid_without_payments_pulls_as_pending(self, api_client, auth_headers, mongo_db, clean_shifts):
        uid = clean_shifts
        sid = _uid()
        # Simulate pre-M3a doc: payment_status='paid' set manually, no payments array
        mongo_db.pp_shifts.insert_one({
            "id": sid, "user_id": uid, "version": 1,
            "officer_name": "Legacy", "duty_type": "bed_watch", "shift_period": "day",
            "date": "2026-01-10", "start_time": "08:00", "end_time": "20:00",
            "break_minutes": 0, "location": "HMP Legacy", "status": "completed",
            "payment_status": "paid",  # legacy manual value — must be ignored
            "hourly_rate": 30,
            "payable_hours": 12.0, "estimated_earnings": 360.0,
            "deleted": False, "last_change_id": _uid(),
        })
        r = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": []})
        body = r.json()
        pulled = next(s for s in body["shifts"] if s["id"] == sid)
        assert pulled["payment_status"] == "pending"
        assert pulled["payments"] == []
        assert pulled["amount_received"] == 0
        assert pulled["outstanding"] == 360.0


# ---------------------------------------------------------------- Client cannot force status
class TestClientStatusIgnored:
    def test_client_payment_status_is_ignored(self, api_client, auth_headers, clean_shifts):
        # inject payment_status='paid' at the shift level even though no payments recorded
        bad_shift = _shift()
        bad_shift["payment_status"] = "paid"  # extra field — pydantic ignores it
        ch = _change(data=bad_shift)
        srv = api_client.post(f"{API}/shifts/sync", headers=auth_headers,
                              json={"changes": [ch]}).json()["results"][0]["server"]
        assert srv["payment_status"] == "pending"


# ---------------------------------------------------------------- Multi-device merge (F3)
class TestMultiDeviceMerge:
    def _create_base(self, api_client, auth_headers):
        ch = _change()
        api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        return ch["id"]

    def test_two_devices_both_payments_preserved_on_stale_conflict(self, api_client, auth_headers,
                                                                   mongo_db, clean_shifts):
        sid = self._create_base(api_client, auth_headers)
        pA = _payment(amount=100, note="A")
        pB = _payment(amount=50, note="B")
        # Device A: base=1 adds pA -> applied, version becomes 2
        chA = _change(id_=sid, base_version=1, data=_shift(payments=[pA]))
        rA = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [chA]})
        assert rA.json()["results"][0]["status"] == "applied"
        # Device B: still has base=1 (stale), adds pB -> conflict BUT server merges payments
        chB = _change(id_=sid, base_version=1, data=_shift(payments=[pB]))
        rB = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [chB]})
        res = rB.json()["results"][0]
        assert res["status"] == "conflict"
        srv_ids = {p["id"] for p in res["server"]["payments"] if not p["deleted"]}
        assert pA["id"] in srv_ids and pB["id"] in srv_ids, "both devices' payments must be preserved"
        # Server received should be 150
        assert res["server"]["amount_received"] == 150.0

    def test_delete_is_sticky_even_against_resurrect(self, api_client, auth_headers, mongo_db, clean_shifts):
        sid = self._create_base(api_client, auth_headers)
        pA = _payment(amount=100, note="A")
        # A adds pA (base=1)
        chA = _change(id_=sid, base_version=1, data=_shift(payments=[pA]))
        rA = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [chA]})
        v_after_A = rA.json()["results"][0]["server"]["version"]
        # B deletes pA with correct base
        chB = _change(id_=sid, base_version=v_after_A,
                      data=_shift(payments=[{**pA, "deleted": True}]))
        rB = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [chB]})
        assert rB.json()["results"][0]["status"] == "applied"
        # Stale change from A listing pA deleted:false must NOT resurrect pA
        chA2 = _change(id_=sid, base_version=v_after_A, data=_shift(payments=[pA]))  # stale now
        rA2 = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [chA2]})
        srv = rA2.json()["results"][0]["server"]
        found = next(p for p in srv["payments"] if p["id"] == pA["id"])
        assert found["deleted"] is True, "deletion is sticky — tombstone wins"
        assert srv["amount_received"] == 0

    def test_edit_on_two_devices_tombstone_and_both_new_preserved(self, api_client, auth_headers,
                                                                  mongo_db, clean_shifts):
        sid = self._create_base(api_client, auth_headers)
        p1 = _payment(amount=100, note="orig")
        # Setup: p1 recorded on both devices
        chSetup = _change(id_=sid, base_version=1, data=_shift(payments=[p1]))
        rSetup = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [chSetup]})
        v = rSetup.json()["results"][0]["server"]["version"]
        # Both devices start with base_version=v. Both edit p1 (tombstone + add new)
        p2 = _payment(amount=120, note="dev A edit")
        p3 = _payment(amount=140, note="dev B edit")
        chA = _change(id_=sid, base_version=v,
                      data=_shift(payments=[{**p1, "deleted": True}, p2]))
        rA = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [chA]})
        assert rA.json()["results"][0]["status"] == "applied"
        chB = _change(id_=sid, base_version=v,  # stale now
                      data=_shift(payments=[{**p1, "deleted": True}, p3]))
        rB = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [chB]})
        res = rB.json()["results"][0]
        assert res["status"] == "conflict"
        # Server should have p1 deleted, p2 active, p3 active (both edits preserved)
        payments_by_id = {p["id"]: p for p in res["server"]["payments"]}
        assert payments_by_id[p1["id"]]["deleted"] is True
        assert payments_by_id[p2["id"]]["deleted"] is False
        assert payments_by_id[p3["id"]]["deleted"] is False
        assert res["server"]["amount_received"] == 260.0  # 120 + 140

    def test_duplicate_change_id_retry_does_not_double(self, api_client, auth_headers, mongo_db, clean_shifts):
        sid = self._create_base(api_client, auth_headers)
        pA = _payment(amount=100)
        ch = _change(id_=sid, base_version=1, data=_shift(payments=[pA]))
        r1 = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        assert r1.json()["results"][0]["status"] == "applied"
        # Replay exact same change
        r2 = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch]})
        res = r2.json()["results"][0]
        assert res["status"] == "duplicate"
        assert res["server"]["amount_received"] == 100.0  # not doubled
        # Mongo contains exactly one active payment entry
        doc = mongo_db.pp_shifts.find_one({"id": sid})
        active = [p for p in doc["payments"] if not p.get("deleted")]
        assert len(active) == 1

    def test_editing_rate_leaves_payments_unchanged_outstanding_recomputed(self, api_client, auth_headers,
                                                                           mongo_db, clean_shifts):
        sid = self._create_base(api_client, auth_headers)
        pA = _payment(amount=100)
        ch1 = _change(id_=sid, base_version=1, data=_shift(payments=[pA]))
        r1 = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch1]})
        v = r1.json()["results"][0]["server"]["version"]
        # Now the client bumps rate from 30 to 40 but DOES NOT list pA (simulates older in-flight edit).
        # Server-side merge_payments must still keep pA from the stored doc.
        ch2 = _change(id_=sid, base_version=v, data=_shift(hourly_rate=40, payments=[]))
        r2 = api_client.post(f"{API}/shifts/sync", headers=auth_headers, json={"changes": [ch2]})
        srv = r2.json()["results"][0]["server"]
        # 12h * 40 = 480; 480 - 100 = 380
        assert srv["estimated_earnings"] == 480.0
        assert srv["amount_received"] == 100.0  # pA preserved by merge
        assert srv["outstanding"] == 380.0
        assert srv["payment_status"] == "partially_paid"
