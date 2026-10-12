#!/usr/bin/env python3
"""Restore an encrypted DutyConnect backup, then re-apply account deletions.

    # Rehearsal into a separate database (safe, recommended monthly):
    python ops/restore.py BACKUP_FILE --into dutyconnect_restore_test
    # Disaster recovery into the live database (needs --i-understand):
    python ops/restore.py BACKUP_FILE --into $DB_NAME --i-understand

Steps: verify the SHA-256 checksum -> decrypt with BACKUP_KEY_FILE (streamed, never written
unencrypted) -> mongorestore into --into (dropping existing collections there) -> re-apply every
deletion in the deletion log (taken from the LIVE database before restoring, merged with the backup's)
so accounts deleted after the backup was taken stay deleted. See docs/BACKUPS.md.
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backup import key_file, sha256  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")

USER_COLLECTIONS = ("pp_shifts", "payments", "action_codes", "sessions")


def reapply_deletions(db, ledger: list) -> int:
    """Remove data for every user in the deletion log. Returns the number of users purged."""
    purged = 0
    for entry in ledger:
        uid = entry["user_id"]
        for coll in USER_COLLECTIONS:
            db[coll].delete_many({"user_id": uid})
        purged += db.users.delete_one({"id": uid}).deleted_count
        db.deletion_log.update_one({"user_id": uid}, {"$setOnInsert": {k: v for k, v in entry.items() if k != "_id"}}, upsert=True)
    return purged


def restore(backup_file: Path, source_db: str, into: str) -> dict:
    sums = backup_file.with_name(backup_file.name + ".sha256")
    if not sums.is_file() or sums.read_text().split()[0] != sha256(backup_file):
        sys.exit("Checksum missing or does not match – backup may be corrupt or tampered with")
    client = MongoClient(os.environ["MONGO_URL"])
    live_ledger = list(client[os.environ["DB_NAME"]].deletion_log.find({}, {"_id": 0}))
    dec = subprocess.Popen(["openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000",
                            "-pass", f"file:{key_file()}", "-in", str(backup_file)], stdout=subprocess.PIPE)
    res = subprocess.run(["mongorestore", f"--uri={os.environ['MONGO_URL']}", "--archive", "--gzip", "--drop", "--quiet",
                          f"--nsFrom={source_db}.*", f"--nsTo={into}.*"], stdin=dec.stdout)
    dec.stdout.close()
    if dec.wait() != 0 or res.returncode != 0:
        sys.exit("Restore failed (wrong key or damaged file?)")
    db = client[into]
    purged = reapply_deletions(db, live_ledger + list(db.deletion_log.find({}, {"_id": 0})))
    return {"database": into, "users": db.users.count_documents({}), "shifts": db.pp_shifts.count_documents({}),
            "deletions_reapplied": purged}


def source_db_of(backup_file: Path) -> str:
    # dutyconnect-<db>-<stamp>.archive.gz.enc
    return backup_file.name[len("dutyconnect-"):].rsplit("-", 1)[0]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("backup_file", type=Path)
    ap.add_argument("--into", required=True)
    ap.add_argument("--i-understand", action="store_true", help="required when restoring into the live database")
    a = ap.parse_args()
    if a.into == os.environ.get("DB_NAME") and not a.i_understand:
        sys.exit("Restoring into the live database replaces current data. Re-run with --i-understand.")
    print(restore(a.backup_file, source_db_of(a.backup_file), a.into))
