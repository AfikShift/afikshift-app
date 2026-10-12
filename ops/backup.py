#!/usr/bin/env python3
"""Encrypted, access-controlled MongoDB backup for DutyConnect.

    python ops/backup.py                      # back up DB_NAME to BACKUP_DIR
    python ops/backup.py --db other --out /x  # explicit

- mongodump (gzip archive) is piped straight into OpenSSL AES-256-CBC + PBKDF2 (200k iterations);
  no unencrypted copy is ever written to disk.
- The key is read from BACKUP_KEY_FILE (create it once: `openssl rand -hex 32 > key && chmod 600 key`)
  and must be stored separately from the backups.
- Backup files are chmod 600 inside a chmod 700 folder, with a SHA-256 checksum file.
- Backups older than BACKUP_RETENTION_DAYS (default 35) are deleted on each run.
See docs/BACKUPS.md.
"""
import argparse
import hashlib
import os
import stat
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")


def key_file() -> str:
    path = os.environ.get("BACKUP_KEY_FILE", "")
    if not path or not Path(path).is_file():
        sys.exit("BACKUP_KEY_FILE must point to an existing key file (see docs/BACKUPS.md)")
    if Path(path).stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        sys.exit(f"Key file {path} is readable by other users; run: chmod 600 {path}")
    return path


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def prune(out: Path, days: int) -> list:
    cutoff = time.time() - days * 86400
    removed = []
    for f in out.glob("dutyconnect-*.archive.gz.enc*"):
        if f.stat().st_mtime < cutoff:
            f.unlink()
            removed.append(f.name)
    return removed


def backup(db: str, out: Path, retention_days: int) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    os.chmod(out, 0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = out / f"dutyconnect-{db}-{stamp}.archive.gz.enc"
    old_umask = os.umask(0o077)
    try:
        dump = subprocess.Popen(["mongodump", f"--uri={os.environ['MONGO_URL']}", f"--db={db}", "--archive", "--gzip", "--quiet"],
                                stdout=subprocess.PIPE)
        enc = subprocess.run(["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt",
                              "-pass", f"file:{key_file()}", "-out", str(target)], stdin=dump.stdout)
        dump.stdout.close()
        if dump.wait() != 0 or enc.returncode != 0:
            target.unlink(missing_ok=True)
            sys.exit("Backup failed")
    finally:
        os.umask(old_umask)
    os.chmod(target, 0o600)
    (out / (target.name + ".sha256")).write_text(f"{sha256(target)}  {target.name}\n")
    os.chmod(out / (target.name + ".sha256"), 0o600)
    prune(out, retention_days)
    return target


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=os.environ.get("DB_NAME"))
    ap.add_argument("--out", default=os.environ.get("BACKUP_DIR", "/var/backups/dutyconnect"))
    ap.add_argument("--retention-days", type=int, default=int(os.environ.get("BACKUP_RETENTION_DAYS", "35")))
    a = ap.parse_args()
    print(backup(a.db, Path(a.out), a.retention_days))
