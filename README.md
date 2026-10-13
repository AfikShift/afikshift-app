# AfikShift – Independent Shift & Earnings Tracker

Offline-first mobile app for shift workers to manage shifts, track overtime and reconcile earnings.
Android package: `uk.afikshift.app` · Subscriptions: `afikshift_pro_monthly`, `afikshift_pro_6month`.

This repository contains everything needed to run and rebuild the app **without Emergent**.
No secrets are committed: copy the `.env.example` templates and fill in your own values.

## Repository structure

| Path | Contents |
|------|----------|
| `frontend/` | Expo (React Native, SDK 57) app – Expo Router screens in `app/`, logic in `src/` |
| `backend/` | FastAPI API (`server.py`, `billing.py`, `referrals.py`, `admin.py`, `public_pages.py`, `security.py`, `email_service.py`) + pytest suite in `tests/` |
| `deploy/` | `Dockerfile` and example `docker-compose.yml` for self-hosting the API |
| `ops/` | Encrypted MongoDB backup / restore scripts |
| `docs/` | `HOSTING.md`, `BILLING.md`, `GOOGLE_PLAY.md`, `BACKUPS.md` |

## Prerequisites

- Node.js 20+ and Yarn 1.22 (`corepack enable`)
- Python 3.11
- MongoDB 7 (local or managed, e.g. MongoDB Atlas)
- For Android builds: Android Studio (SDK + JDK 17) **or** an Expo/EAS account

## 1. Backend (FastAPI)

```bash
cd backend
cp .env.example .env          # fill in every REPLACE value
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001
```

Generate fresh keys (never reuse preview keys):

```bash
python -c "import secrets;print(secrets.token_hex(32))"              # BILLING_TOKEN_KEY / JWT_SECRET
python - <<'PY'                                                       # ENTITLEMENT_SIGNING_KEY + public key
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization as s
k = Ed25519PrivateKey.generate()
print("private:", k.private_bytes(s.Encoding.Raw, s.PrivateFormat.Raw, s.NoEncryption()).hex())
print("public :", k.public_key().public_bytes(s.Encoding.Raw, s.PublicFormat.Raw).hex())
PY
```

All API routes are served under `/api`. Health check: `GET /api/`.
Docker alternative: `docker compose -f deploy/docker-compose.yml up -d --build` (see `docs/HOSTING.md`).

### Tests

```bash
# backend/.env must contain TEST_MAIN_PASSWORD for the pre-verified test user,
# and EXPO_PUBLIC_BACKEND_URL must point at a running non-production API.
EXPO_PUBLIC_BACKEND_URL=http://localhost:8001 python -m pytest -q tests
```

## 2. Mobile app (Expo)

```bash
cd frontend
cp .env.example .env          # EXPO_PUBLIC_BACKEND_URL, EXPO_PUBLIC_ENTITLEMENT_PUBLIC_KEY, EXPO_PUBLIC_STORE
yarn install
yarn start                    # dev server; press "a" for Android emulator
```

Note: in-app billing (`expo-iap`) and biometrics need a native build (not Expo Go).

## 3. Building the Android app (APK / AAB)

**Option A – EAS (cloud build)**

```bash
npm i -g eas-cli && eas login
cd frontend && eas build:configure
eas build -p android --profile preview      # APK (Aptoide / direct install)
eas build -p android --profile production   # AAB (Google Play)
```

**Option B – Local Gradle build**

```bash
cd frontend
npx expo prebuild -p android                 # generates android/ (not committed)
cd android
./gradlew assembleRelease                    # APK -> app/build/outputs/apk/release/
./gradlew bundleRelease                      # AAB -> app/build/outputs/bundle/release/
```

**Signing:** create your own upload keystore (`keytool -genkeypair -v -keystore afikshift-upload.jks -alias afikshift -keyalg RSA -keysize 2048 -validity 10000`)
and configure it via `~/.gradle/gradle.properties` or EAS credentials. **Never commit keystores** – `*.jks`/`*.keystore` are git-ignored.
Back the keystore and its passwords up securely; losing it prevents future updates to the same listing.

Set `EXPO_PUBLIC_STORE=aptoide` for Aptoide builds, or leave unset/`play` for Google Play. Bump `version` in `frontend/app.json` for each release.

## 4. Billing, stores and hosting

- Subscriptions & server verification: `docs/BILLING.md`
- Google Play release checklist: `docs/GOOGLE_PLAY.md`
- Self-hosting, email (Resend), public pages: `docs/HOSTING.md`
- Backups & restore: `docs/BACKUPS.md`

## Security

- `.env` files, keystores, service-account JSON and test credentials are excluded by `.gitignore`.
- Only `.env.example` templates (placeholders) are committed.
- Rotate any key that is ever exposed.
