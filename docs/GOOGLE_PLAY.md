# DutyConnect – Google Play submission guide and Data Safety evidence

Nothing has been submitted. This is the prepared material for your review.

## A. Data Safety form – proposed answers with code evidence

### Collection overview
| Play data type | Collected? | Shared? | Optional? | Purpose | Evidence |
|---|---|---|---|---|---|
| Personal info → Name | Yes | No | Required | Account management, app functionality | `RegisterIn.full_name`, `users.full_name` (server.py) |
| Personal info → Email address | Yes | No* | Required | Account management, security (codes) | `RegisterIn.email`; `email_service.py` |
| Personal info → Other (professional category) | Yes | No | Optional | App functionality | `ProfileUpdate.professional_category` |
| Financial info → Other financial info (hourly rate, PP payments received, earnings estimates) | Yes | No | Optional | App functionality | `ShiftData.hourly_rate`, `PaymentIn` |
| App activity → Other user-generated content (shift records: duty type, dates, times, location, notes) | Yes | No | Optional | App functionality | `ShiftData`, `PaymentIn.note` |
| App info & performance → Diagnostics / crash logs | **No** (no crash or analytics SDK) | No | – | – | `frontend/package.json` has no analytics/crash SDK |
| Device or other IDs | **No** | No | – | – | No advertising ID / device ID read anywhere |
| Location (precise/approximate) | **No** | – | – | "Location" field is free text typed by the user, not GPS | `ShiftData.location` (string); no location permission in app.json |
| Biometrics | **No** – Face/fingerprint handled by Android; app receives only "success/fail" | – | – | – | `expo-local-authentication`; `lock-screen.tsx` |
| Passwords | Stored only as bcrypt hash; Play has no separate type – covered under account management | No | Required | Security | `hash_password()` (bcrypt, 12 rounds) |

\* Email address, name and message content are passed to the email delivery provider to send codes. Under Google's
definitions, transfer to a **service provider processing on your behalf** is *not* "sharing", so answer **No** for sharing,
provided a data-processing agreement exists with the provider (see gaps below).

### Security practices
| Question | Proposed answer | Evidence / verification |
|---|---|---|
| Is data encrypted in transit? | **Yes** | All API calls use `https://` (`EXPO_PUBLIC_BACKEND_URL`); HSTS header set (`security.py`). Verify production proxy enforces HTTPS. |
| Encrypted at rest – on device | Yes (XChaCha20-Poly1305, key in Android Keystore) | `src/shifts/local-store.ts`, `expo-secure-store` |
| Encrypted at rest – server database | **Depends on host** – MongoDB Atlas encrypts storage by default; a self-run server needs disk encryption | Not provable from code – **confirm with chosen host** |
| Encrypted at rest – backups | Yes (AES-256) | `ops/backup.py`; test `TestBackupRestore` |
| Can users request deletion? | **Yes** – in app (Account → Security → Delete account) and on the web without login | `DELETE /api/me`; `/api/public/delete-account`; tests `TestAccountDeletion` |
| Deletion URL for Play | `https://YOUR-DOMAIN.example/...` → currently `<API>/api/public/delete-account` | `public_pages.py` |
| Committed to Play Families policy? | Not applicable (not for children) | – |
| Independent security review? | **No** (internal automated review only) | – |

### What is deleted and what is retained
- Deleted immediately: profile, all shifts (incl. Recently Deleted), payments and payment choices, one-time codes, failed-login counter.
- Retained: revoked session hashes flagged `account_deleted` until they expire (≤ 30 days; contain no personal data), a deletion-log entry
  (user id, keyed hash, date) for 65 days, encrypted backups up to 35 days, server logs (IP addresses) for the host's log period.

## B. Third-party personal data safeguards and limitations
- Server and app block reference-number patterns (e.g. `A1234BC`) and a list of sensitive words
  in the name, location and payment note (`check_sensitive()` in server.py; `isSensitive()` in calc.ts). Tests: `TestValidation`.
- Fields are short (location ≤ 60, note ≤ 40 characters) and there are no free-text "notes" on shifts.
- **Limitation:** pattern checks cannot recognise other people's names or reworded descriptions. The privacy policy and in-app
  privacy notice tell users not to enter them. Declare this honestly if Google asks.

## C. Gaps and uncertainties for your review (not assumed)
1. **Package name** is `uk.dutyconnect.app` (app.json, permanent – shared with the Aptoide and direct APK builds; never change it, and always sign with the same key).
2. **Hosting & email providers**: name them in the privacy policy and sign their data-processing terms (UK GDPR Art. 28). If the Emergent email service remains in use, confirm its processing terms with Emergent.
3. **Database encryption at rest** must be confirmed for the chosen host.
4. **Server log retention** (IP addresses) must be set and stated.
5. **Legal review**: privacy policy and terms need review by a qualified adviser; confirm no statutory retention applies.
6. **Employer policy**: users' employers may restrict personal apps for work records – consider a statement in the store listing.
7. NetInfo (connectivity detection) uses Android system APIs; no third-party request is made by the app for analytics.

## D. Other Play Console steps (when you approve publication)
1. Create a Google Play developer account (US$25 one-off; organisation accounts need a D-U-N-S number).
2. App content: privacy policy URL, Data Safety (above), ads = **No**, target audience 18+, content rating questionnaire
   (utility/productivity, no user-to-user content), government app = **No** (DutyConnect is independent and not endorsed by any employer or government body – say so in the listing).
3. Permissions declared: `USE_BIOMETRIC`, `USE_FINGERPRINT` (+ INTERNET added by Expo). No SMS permission in this version.
4. Target API level: the Expo SDK 57 build targets the current Play requirement; confirm in the build report.
5. Testing track: new personal developer accounts must run a **closed test with at least 12 testers for 14 days** before production.
6. Store listing: short and full description, 512×512 icon, 1024×500 feature graphic, at least 2 phone screenshots.
