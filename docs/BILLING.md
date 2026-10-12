# DutyConnect – Google Play Billing configuration (Stage B guide)

Stage A (done) built and tested everything against a mock of Google's API (`BILLING_MODE=mock`).
Nothing below has been done yet; each step needs your approval.

## 1. Products to create (Play Console → Monetise → Products → Subscriptions)
| Product ID (must match exactly) | Base plan | Price | Renewal | Trial |
|---|---|---|---|---|
| `dutyconnect_pro_monthly` | `monthly` (auto-renewing, 1 month) | £3.99 | Monthly | None |
| `dutyconnect_pro_annual` | `annual` (auto-renewing, 1 year) | £34.99 | Yearly | None |

**Founding-member offer** (add to each base plan → *Add offer*): offer ID **`founding`**, eligibility
**Developer determined**, phase **Discounted recurring payment** – monthly plan: £2.99 for **12** billing periods;
annual plan: £24.99 for **1** billing period. After that Google automatically charges the standard price and shows the
required wording at checkout. The server only lets the app request this offer for accounts that have never subscribed,
while fewer than 200 accounts have used it (`FOUNDING_MEMBER_LIMIT`). ⚠️ Confirm in Play Console that a 12-period
discounted recurring phase is accepted for the monthly plan before launch; if not, use the longest allowed and update
the in-app wording (it is taken from Google's returned offer, so no code change is needed for prices).
Recommended settings: grace period **7 days**, account hold **enabled** (up to 30 days), resubscribe **allowed**,
no introductory offers. Let Play convert prices for other countries.
Products can only be created after a build with the billing permission has been uploaded to a testing track
(expo-iap adds `com.android.vending.BILLING` automatically). That build must use your **permanent package ID**.

## 2. Server access to Google (free)
1. Google Cloud Console → create a project → enable **Google Play Android Developer API**.
2. Create a **service account**; create a JSON key; store it on the server only (e.g. `/etc/dutyconnect/play.json`, `chmod 600`).
3. Play Console → Users and permissions → invite the service account email → app permissions: *View financial data* and *Manage orders and subscriptions*.
4. `backend/.env`:
   ```
   BILLING_MODE=google
   ANDROID_PACKAGE=<your permanent package id>
   GOOGLE_SERVICE_ACCOUNT_FILE=/etc/dutyconnect/play.json
   ```
   (The server refuses to start in production while `BILLING_MODE=mock`.)

## 3. Real-time developer notifications (Pub/Sub free tier)
1. Cloud Console → Pub/Sub → create topic `play-rtdn`; grant `google-play-developer-notifications@system.gserviceaccount.com` the *Pub/Sub Publisher* role.
2. Create a **push** subscription to `https://api.YOUR-DOMAIN.example/api/billing/rtdn?secret=<RTDN_SHARED_SECRET>`.
   Enable authentication on the push subscription (OIDC) – verifying that Google-signed token in the endpoint is
   a Stage B task (the shared secret is the Stage A protection).
3. Play Console → Monetisation setup → Real-time developer notifications → topic `projects/<project>/topics/play-rtdn` → *Send test notification*.

## 4. Secrets (server only, never in the app)
`ENTITLEMENT_SIGNING_KEY` (Ed25519 private key – signs the 7-day offline Pro pass; the app holds only
`EXPO_PUBLIC_ENTITLEMENT_PUBLIC_KEY`), `BILLING_TOKEN_KEY` (AES-256-GCM key encrypting stored purchase tokens),
`RTDN_SHARED_SECRET`. Generate new production values: `openssl rand -hex 32` (and a new Ed25519 pair – see `docs/HOSTING.md`).

## 5. Sandbox testing
Play Console → Settings → **Licence testing** → add testers' Google accounts. Install the app from the internal-testing
link. Test cards include "always approves", "always declines" and "slow"; test renewals happen every few minutes
(monthly ≈ 5 min, annual ≈ 30 min).

## 6. How entitlements work
- Pro = Google state ACTIVE or IN_GRACE_PERIOD, or CANCELED while the paid period lasts. Everything else = Free.
- Purchases are bound to the account (`obfuscatedAccountIdAndroid`) and a token can belong to one account only.
- Upgrades/plan changes (`linkedPurchaseToken`) replace the old purchase; only one entitlement remains.
- Notifications are de-duplicated and are only a trigger: the server always re-reads Google.
- An expired record is re-checked with Google whenever the app asks for its status (covers missed notifications).
- Downgrade never deletes, hides on the server, or rejects records.
