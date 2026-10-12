# DutyConnect – Running on your own hosting

DutyConnect has three parts. None of them depend on Emergent once the email setting is changed.

| Part | Technology | Where it runs |
|---|---|---|
| Mobile app | Expo / React Native | Officers' phones (built once, published to Google Play) |
| API | Python 3.11, FastAPI (`backend/`) | Any Linux server or container host |
| Database | MongoDB 7 | Managed MongoDB (e.g. MongoDB Atlas, UK/EU region) or your own server |

## 1. Configuration (no code changes needed)
Copy `backend/.env.example` to `backend/.env` and fill in every value marked **REPLACE**. The API refuses to start
with `ENVIRONMENT=production` if development settings or placeholders remain (see `production_config_problems()` in `server.py`).

Placeholders to replace before launch:
| Setting | Placeholder | What to put |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://YOUR-DOMAIN.example` | Your website address (hosts privacy, terms, deletion pages) |
| `SUPPORT_EMAIL` | `support@YOUR-DOMAIN.example` | Support mailbox shown to officers |
| `DATA_CONTROLLER_NAME` | `[YOUR ORGANISATION NAME]` | Legal name of the organisation running DutyConnect |
| `POLICY_LAST_UPDATED` | `[DATE]` | Date the privacy policy was approved |
| `EMAIL_FROM_ADDRESS` | (unset) | e.g. `no-reply@your-domain` |
| `CORS_ORIGINS` | preview URL | Your website origin(s) only |
| `JWT_SECRET` | dev value | New value: `openssl rand -hex 32` |
| Frontend `EXPO_PUBLIC_BACKEND_URL` | preview URL | `https://api.your-domain` |
Also replace the "[Replace with the named providers …]" and "[state period …]" notes in `backend/public_pages.py` text.

## 2. Email
Today emails go through the Emergent-managed email service. To switch to your own Resend account
(or any provider later), set:
```
EMAIL_PROVIDER=resend
RESEND_API_KEY=<from resend.com – keep secret>
EMAIL_FROM_ADDRESS=no-reply@your-domain
EMAIL_FROM_NAME=DutyConnect
```
In Resend, add your domain and create the DNS records it shows (SPF, DKIM, and a DMARC record such as
`v=DMARC1; p=quarantine`). Emails sent: verification codes, password reset, account-deletion code and deletion confirmation.

## 3. Run the API with Docker
```bash
cp backend/.env.example backend/.env   # then edit it
docker compose -f deploy/docker-compose.yml up -d --build
```
Put an HTTPS reverse proxy in front (Caddy, Nginx or your cloud load balancer) that forwards
`https://api.your-domain/api/*` to port 8001 and sets `X-Forwarded-For`. Example Caddyfile:
```
api.your-domain {
    reverse_proxy localhost:8001
}
```
Caddy obtains HTTPS certificates automatically. Set `TRUSTED_PROXY_HOPS` in `backend/.env` to the number of proxies
in front of the API (usually `1`) so rate limits use the real client address and cannot be dodged with a forged
`X-Forwarded-For` header. Add a request-rate limit at the proxy as well – the built-in limiter counts per server process.

## 4. Public pages
Privacy policy, terms and the account deletion page are served by the API at
`/api/public/privacy`, `/api/public/terms`, `/api/public/delete-account`. Point your website links (and Google Play) at
`https://api.your-domain/api/public/...`, or redirect `https://your-domain/privacy` there.

## 5. The mobile app
The app only needs `EXPO_PUBLIC_BACKEND_URL` changed to your API address before building. Builds can be produced by the
Emergent Publish button or, independently, with Expo's EAS build service using your own Expo account
(`npx eas build -p android`). You own the source code and can do either.

## 6. Backups
Follow `docs/BACKUPS.md` before going live.

## 7. Ongoing costs (estimates, to confirm with providers)
- Small API server / container: roughly £5–£20 per month
- Managed MongoDB (shared tier to small dedicated): £0–£50 per month
- Domain: about £10–£20 per year; email service: free tier up to a few thousand emails per month
- Google Play developer account: US$25 one-off
