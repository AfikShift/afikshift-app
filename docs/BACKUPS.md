# DutyConnect – Backups and recovery

This guide is written for non-specialists. Commands are run on the server that hosts the database.

## What the backup does
- `ops/backup.py` copies the whole DutyConnect database (`mongodump`) and **encrypts it while it is being written**
  (AES-256, key stretched with PBKDF2, 200,000 rounds). An unencrypted copy never touches the disk.
- Each backup file gets a SHA-256 checksum file, so damage or tampering is detected before restoring.
- Files are created readable only by the backup user (`chmod 600`, folder `chmod 700`).
- On every run, backups older than `BACKUP_RETENTION_DAYS` (default **35 days**) are deleted.

## One-time setup
1. Create the encryption key **on a different machine or password manager as well** (if you lose it, backups cannot be opened):
   ```bash
   sudo mkdir -p /etc/dutyconnect && sudo chmod 700 /etc/dutyconnect
   openssl rand -hex 32 | sudo tee /etc/dutyconnect/backup.key > /dev/null
   sudo chmod 600 /etc/dutyconnect/backup.key
   ```
2. Add to `backend/.env`:
   ```
   BACKUP_KEY_FILE=/etc/dutyconnect/backup.key
   BACKUP_DIR=/var/backups/dutyconnect
   BACKUP_RETENTION_DAYS=35
   ```
3. Run a daily backup at 02:30 with cron (`sudo crontab -e`):
   ```
   30 2 * * * cd /opt/dutyconnect && /usr/bin/python3 ops/backup.py >> /var/log/dutyconnect-backup.log 2>&1
   ```
4. **Copy backups off the server** (for example to an encrypted cloud bucket in the UK/EU with access limited to
   named administrators, multi-factor sign-in, and its own 35-day deletion rule). Never store the key in the same place.

## Who can access backups
- Only the server's backup user and named administrators. The key file refuses to work if other users can read it.
- Keep a written list of who holds the key; change the key (and re-run a backup) when someone leaves.

## Test a restore (do this monthly)
Restoring into a **separate** database never affects officers:
```bash
python3 ops/restore.py /var/backups/dutyconnect/dutyconnect-<db>-<date>.archive.gz.enc --into dutyconnect_restore_test
```
It prints the number of users and shifts restored. Compare with the live app, then delete the test database:
`mongosh --eval 'db.getSiblingDB("dutyconnect_restore_test").dropDatabase()'`.
The automated test `backend/tests/test_m3c.py::TestBackupRestore` does exactly this (and checks a wrong key or a
tampered file is refused).

## Disaster recovery (live database)
1. Put the app into maintenance (stop the backend service).
2. `python3 ops/restore.py <file> --into <DB_NAME> --i-understand`
3. Start the backend. Officers' phones keep their own encrypted copies and re-sync any changes made since the backup.

## Account deletion and backups
- Backups are **not edited** when someone deletes their account (editing encrypted backups is unsafe and unreliable).
- Instead, every deletion is written to a `deletion_log` holding only the internal user id, a one-way keyed hash and the date
  (no email address or records). The log is kept for retention + 30 days (65 days by default).
- `restore.py` reads the deletion log from the live database **before** restoring and removes those accounts again
  straight after, so a deleted account is never brought back.
- Deleted accounts disappear from all backups automatically once the last backup containing them expires (≤ 35 days).
  This is stated in the Privacy Policy.
