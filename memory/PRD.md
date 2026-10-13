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

### Security hardening (2026-10-11) ✅ tested (58/58 backend incl. 19 new security tests)
- Per-account login limit (10 fails/15 min, any IP) + secondary per account+IP (5); temporary, cleared by password reset
- Auth emails sent in background (consistent timing); identical 202/401 responses for known/unknown/unverified
- CORS restricted via CORS_ORIGINS env (native apps unaffected — no Origin header)
- Prisoner/operational data guard: prisoner numbers, prisoner/inmate/NOMIS/PNC, cell/wing numbers blocked (client + server)

### M3a — Payments per shift, Upcoming/History, sync testing (2026-10-12) ✅ tested (84/84 backend; UI E2E offline + both conflict options pass)
- Payments embedded in shift (immutable, id-merged union, sticky tombstones); edit = tombstone + new; server merges payments even on conflict
- Payment status always derived (pending/partially_paid/paid), pence arithmetic, overpaid shown; manual status chips removed; legacy statuses → pending
- Payment note ≤40 chars with sensitive-data blocking (client + server); PrivacyNotice on shift form + payment form
- Shifts tab "List" view: Upcoming (soonest first) / History (newest first) + All/Completed/Cancelled/Unpaid chips + summary (FlatList)
- Cancel blocked while active payments exist

## Pre-launch checklist
- Rotate JWT_SECRET and email key; keep DEV_LOG_CODES=false; set CORS_ORIGINS for production web origin (if any)
- Real-device tests: biometrics, date/time pickers, airplane-mode offline sync
- Confirm Emergent email limits/charges

## Backlog
- P0 M2: PP shifts CRUD/duplicate/cancel/complete, overnight calc, overlap warnings, rate snapshot, offline-first queue + sync + conflict UI, month/week calendar, real sync badge
- P0 M3: earnings dashboard (month/quarter/year), payments, outstanding, CSV/PDF export with filters, data export, DB backup/restore script, self-hosting README
- P1: calendar reminders, personal calendar sync
- Phase 3 (needs approval): Android native SMS module; Phase 4: RevenueCat subscriptions, admin dashboard
- Before launch: confirm Emergent email limits/charges; set DEV_LOG_CODES=false in production

## Milestone 3b — DONE (June 2026)
- S1: payments carry `origin_id` (lineage). Two active payments with same origin = edit clash → counted once (lowest amount), `payment_clash` flag, "Provisional" warnings on Home/Earnings/shift card/report; officer resolves via "Keep this" in Payments panel.
- S2: delete → Recently Deleted for 90 days (`deleted_at`), payments kept, excluded from totals; restore offline-capable via normal sync; server purges >90 days on sync. Screen: /recently-deleted (Account).
- F4: Earnings tab — week/month/year, prev/next, estimated/received/outstanding/hours/booked, by duty type.
- F5: CSV/PDF export (expo-print, expo-sharing, expo-file-system) from Earnings period or Account (all records); privacy warning before sharing; CSV formula-injection guard; temp files deleted after sharing.
- Single calculation module `src/shifts/stats.ts summarise()` used by Home, Earnings, History, reports.
- Tests: 98/98 backend (84 existing + 14 in tests/test_m3b_safeguards.py), run serially `pytest -n 0`. Frontend E2E iteration_5 pass.
## Next (needs approval): Milestone 3c export/backup; Phase 3 SMS forwarding; Phase 4 billing/admin.

## Milestone 3c — DONE (dev/preview only; nothing published)
- Payment decisions: immutable `payment_decisions` (keep_id, rejected, supersedes) merged by id; two-device different choices stay a visible "decision clash" (provisional, lower counted once); explicit confirm step; local choice "waiting to sync" until server confirms.
- Security: security.py (headers, streaming 2MB body cap, per-IP rate limit 600/min, deletion endpoints 10/min), TRUSTED_PROXY_HOPS, production config guard (refuses dev secret/placeholders), email log scrub. Audit: SEC-001/002/005 fixed; SEC-003 (per-account lockout DoS) & SEC-004 (web build storage) documented.
- Public pages (no login): /api/public/privacy, /terms, /delete-account (email code, single-use, 15 min, 5 attempts, explicit checkbox, confirmation email). Deleted account → refresh returns 410 → device wipes local copy. deletion_log (no email) for backup re-application.
- Backups: ops/backup.py & ops/restore.py (AES-256 PBKDF2, chmod 600/700, SHA-256 checksum, 35-day retention, deletion re-apply).
- Docs: docs/BACKUPS.md, docs/HOSTING.md, docs/GOOGLE_PLAY.md (Data Safety evidence table + gaps), backend/.env.example, deploy/Dockerfile, deploy/docker-compose.yml.
- Tests: 122/122 backend serial (98 + 24 in tests/test_m3c.py); frontend E2E iteration_6 pass.
- Placeholders to replace: PUBLIC_BASE_URL, SUPPORT_EMAIL, DATA_CONTROLLER_NAME, POLICY_LAST_UPDATED, EMAIL_FROM_ADDRESS, provider names/log period in public_pages.py, Android package id.

## Milestone 4 Stage A — DONE (mocked Google Play; Stage B not authorised)
- Plans: free/pro in PLAN_FEATURES (server). billing.py: /api/billing/verify, /restore, /entitlement, /rtdn (shared secret, dedupe by messageId); Google subscriptionsv2 + acknowledge (BILLING_MODE=mock uses db.mock_play). Tokens AES-GCM encrypted + sha256 index; purchases bound via obfuscatedAccountIdAndroid (account_ref); linkedPurchaseToken replaces old; stale expiry reconciled on entitlement check.
- Offline Pro pass: Ed25519-signed (server key ENTITLEMENT_SIGNING_KEY; app verifies with EXPO_PUBLIC_ENTITLEMENT_PUBLIC_KEY), exp = min(paid period, 7 days).
- Free limits: 30-day history in app (older stored; prompt -> CSV/upgrade), 1 payment per shift (client), no dashboard nav/by-duty, CSV only (no PDF), sync from one phone (server 403 pro_required_multi_device; POST /api/devices/primary switches phone).
- App: expo-iap (dev build only), app/upgrade.tsx, src/billing/{entitlement.tsx,play.ts}, ProPrompt, Account subscription rows (status, manage, restore).
- Tests: 145/145 backend serial (122 + 23 tests/test_m4_billing.py); frontend iteration_7 pass. Docs: docs/BILLING.md.
- Stage B (needs approval): Play Console, products, service account, Pub/Sub RTDN + OIDC verification, permanent package id, signed build, sandbox purchases.

## Phases A + B — DONE (preview only; Phase C referrals NOT started)
- A: neutral branding (tagline "Know your shifts. Track your earnings. Stay in control."), no prison/HMPPS/PP wording in UI, emails, reports, legal pages, docs; built-in shift types standard/overtime/extra/other; legacy bed_watch/constant_watch still valid (records unchanged); custom templates (users.shift_templates, app/templates.tsx); legacy categories migrated at startup.
- B: Free = 3 active/future shifts (server "limit" status, app keeps `_held` record, auto-retries), 7-day visible history (provider filter; allShifts for downloads), 1 payment/shift, current-week earnings, 1 template, CSV+PDF Pro-only, free JSON GET /api/me/data-download (1 per 7 days; support fallback). Pro £3.99/£34.99 configured in Play (no hard-coded prices); founding offer id "founding" for first 200 new subscribers (server founding_eligible).
- Tests: 160/160 backend serial (145 + 15 tests/test_phase_ab.py); frontend iterations 8–9 pass.

## Corrective update — Specialist presets (A+B correction, preview only)
- Bed Watch / Constant Watch / PP (user-approved) restored as optional built-in presets (ids bed_watch / constant_watch / pp; shift-type chips wrap, colours and calculations unchanged). Hidden by default; toggle in Account → Shift templates (`users.specialist_presets`, synced via /api/me, in data download). Not counted as custom templates; shifts still count towards Free 3-active limit. Existing records always selectable/editable even when off.
- PP (Payment Plus) = original name of shift/payments section; all payment features retained; not a duty type.
- Tests: 167/167 backend serial (160 + 7 tests/test_specialist_presets.py). Targeted UI check pass.

## Phase C — Referrals & ambassadors MVP (preview only, mocked Google Play)
- backend/referrals.py: personal 8-char codes; apply at registration (optional field, invalid ignored) or /api/referrals/apply within 14 days & before first subscription; no own code, one referrer.
- Qualify: first verified paid subscription → `paid`, qualifies_at = +30d +48h; then awaiting_approval if sub not voided and paid month ran, else cancelled. Checked on admin list, /referrals/me and hourly loop.
- Admin (ADMIN_EMAILS env → users.is_admin): /api/admin/referrals (filter), approve (atomic, friend + referrer 1 free month; referrer subject to monthly cap → "capped"), cancel; /api/admin/members lookup + PATCH ambassador/referral_cap. Default cap 3, ambassador 10 (env).
- Rewards (billing.grant_free_month): active auto-renewing subscriber → Google subscriptions:defer 30 days; else users.bonus_pro_until (stacking). refresh_plan treats bonus as Pro; voided RTDN marks sub voided.
- App: Account → Refer a friend (app/referrals.tsx: code, share, add code, statuses, rules); Referral admin (app/admin-referrals.tsx) for admins; register referral field. Upgrade page shows UK reference prices when Play unavailable.
- Tests: 178/178 backend serial (167 + 11 tests/test_referrals.py).

## Admin dashboard (Phase C add-on)
- backend/admin.py: GET /api/programmes (public flags), GET /api/admin/overview (totals only), PATCH /api/admin/programmes (referrals/founding/ambassadors; settings._id=programmes), GET /api/admin/activity (admin_log, 1-year TTL). Referral approve/cancel/member edits logged.
- Off effects: referrals → hidden in app (Account row, register field), new codes rejected, earned rewards still approvable; founding → founding_eligible false; ambassadors → standard cap.
- App: app/admin.tsx (Account → Admin dashboard) links to Referral admin. Personal details row no longer shows category.
- Tests: 182 backend (178 + 4 tests/test_admin_dashboard.py). Note: approving a referral in UI tests can give delivered+t1 bonus_pro_until → reset plan free before pytest.

## Phase D — ambassador tools + tax display
- /referrals/me: this_month/all_time totals (signed_up, qualifying, qualified, rewarded) + rewards_left_this_month; shown as table on Refer a friend (Ambassador dashboard title for ambassadors).
- Fraud flags on referrals: burst (>5 sign-ups on one code in 24h), similar_email (email_key: +tag, dots, trailing digits stripped), quick_refund (voided). Flagged referrals become status "held" on qualifying (members see "being checked"); admin Held filter with warnings; approve allowed from held. Overview: referrals_held, referrals_flagged.
- users.tax_rate (0–60, clear_tax_rate): Personal details field; payments panel + Earnings hero show after-tax estimate/outstanding (display only).
- Tests: tests/test_phase_d.py (5).

- Founding offer changed: monthly £2.99 for first 6 months (was 12); annual £24.99 for first year (Play cannot do 6 months on a yearly plan). Prices unchanged.

- PRICING CHANGE: plans are Monthly £3.99 and Six-month £19.99 (dutyconnect_pro_6month, ≈£3.33/mo, saves 17%). Annual plan and founding-member offer removed (backend, admin switch, app, docs).

- Earnings tab reworked for monthly-paid users: hero = EXPECTED PAY · END OF <MONTH> (completed + booked shifts, before tax, plus after-tax line); received/not-yet-paid removed from Earnings (per-shift Payments panel unchanged). Free still current week only.

- Owner free Pro: POST /api/admin/members/{uid}/free-pro {days 1–3650 | revoke} (bonus_pro_until, stacks, logged). UI in Members & referrals (admin-free-pro-30/91/182/365, admin-free-pro-remove).

- Fresh shift form fix (remount per params + nonce n from all callers), Clear / Undo changes button on shift form, header refresh button on Home/Shifts/Earnings. Verified by testing agent iterations 11–12; refresh toast confirmed on all tabs (earlier report was a hidden-tab duplicate testID artefact).

- Upgrade page redesigned: selectable plan cards (Monthly £3.99; Six-month £3.33/mo, £19.99 every 6 months, BEST VALUE · SAVE 16% badge), Subscription terms box (renewal, cancel, failed payment grace, data kept, refunds), Terms/Privacy links, independence disclaimer. testIDs upgrade-plan-monthly/sixmonth, upgrade-terms, upgrade-disclaimer.

- Aptoide prep (links only): APTOIDE_URL env (placeholder https://dutyconnect.en.aptoide.com) → "Get it on Aptoide" + disclaimer footer on all public pages; download_url in /referrals/me and share message. Frontend src/billing/store.ts (EXPO_PUBLIC_STORE=play|aptoide) drives store name in upgrade terms; Aptoide build never loads Google Play Billing; Aptoide payments pending step B.
