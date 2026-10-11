# DutyConnect — PRD

## Original problem statement (summary)
Cross-platform (Android + iOS) app "DutyConnect — Stay Connected. Stay Organised." for UK prison officers.
Modules: (A) Android-only SMS-to-Email forwarding (Phase 3, NOT approved yet), (B) Payment Plus (PP) Shift Manager
(shifts, earnings, payments, calendar, reports). Subscriptions (Phase 4) and admin dashboard later. Privacy-by-design, UK GDPR,
no prisoner/operational data. Milestone-based delivery with credit budget approval per stage.

## User decisions
- Phase 2 approved in milestones (M1 Accounts → M2 PP Shift Manager + offline sync + calendar → M3 Earnings/Payments/Reports/export/self-hosting docs)
- Email/password auth + verification + reset; Emergent-managed Resend (configurable to own Resend via EMAIL_PROVIDER/RESEND_API_KEY/EMAIL_FROM_ADDRESS)
- Offline-first (M2), GBP default, rate blank until set, rate snapshot per shift
- Design approved: navy/teal/white/grey, Plus Jakarta Sans, 4 tabs (Home/Shifts/Earnings/Account), Messages from Home
- Do NOT publish, activate paid hosting, SMS, subscriptions or payments without explicit approval

## Architecture
- Expo SDK 57 (expo-router), FastAPI, MongoDB (motor). JWT access 15m + rotating hashed refresh tokens (30d), bcrypt, 6-digit hashed codes (15 min, 5 attempts), login lockout (5 fails / 15 min), anti-enumeration generic responses
- Feature flags per plan returned in /api/me (PLAN_FEATURES in server.py) → subscriptions later without rebuild
- Tokens + cached profile in secure storage (Keychain / EncryptedSharedPreferences)

## Implemented
### M1 — Accounts & Foundations (2026-10-11) ✅ tested (24/24 backend, frontend flows pass)
- Welcome, register (consent), verify-email code, login, forgot/reset password
- Home dashboard (next shift empty state, quick actions, monthly summary placeholder, set-rate banner, Messages card)
- Messages screen (iOS: not available explanation; Android: coming soon)
- Account: profile (name, category, currency, hourly rate, notification prefs), security (biometric lock, change password, delete account), sign out
- Shifts / Earnings tabs = placeholders for M2/M3
- Light/dark theme

### M2 — PP Shift Manager (2026-10-11) ✅ tested (39/39 backend incl. 15 sync tests; frontend flows pass)
- Shift form (duty, Day/Night presets, date, start/finish, break chips/custom, location w/ prisoner-number block, rate snapshot, status, payment), live payable hours & estimate, overnight note, overlap warning
- Actions sheet: complete, edit, duplicate (next day), cancel/restore, delete (confirm), payment status
- Month/week calendar with duty-colour dots + night moon, legend, day/week lists, FAB
- Offline-first: encrypted local store (XChaCha20-Poly1305, key in Keychain/Keystore), POST /api/shifts/sync with client UUID + change_id idempotency + version conflicts, conflict resolution UI, auto-sync (NetInfo, web online event, foreground, 60s)
- Real sync badge: Saved on device / Syncing / Synced / Sync failed · Retry / Needs review
- Home live: Next Shift, monthly completed/hours/estimated/not-yet-paid, booked/projected
- DEV_LOG_CODES=false; logs verified free of codes/passwords/tokens

## Backlog
- P0 M2: PP shifts CRUD/duplicate/cancel/complete, overnight calc, overlap warnings, rate snapshot, offline-first queue + sync + conflict UI, month/week calendar, real sync badge
- P0 M3: earnings dashboard (month/quarter/year), payments, outstanding, CSV/PDF export with filters, data export, DB backup/restore script, self-hosting README
- P1: calendar reminders, personal calendar sync
- Phase 3 (needs approval): Android native SMS module; Phase 4: RevenueCat subscriptions, admin dashboard
- Before launch: confirm Emergent email limits/charges; set DEV_LOG_CODES=false in production
