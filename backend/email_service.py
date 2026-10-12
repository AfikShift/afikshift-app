"""Email delivery for DutyConnect.

All outbound email goes through this module. During development it uses the
Emergent-managed email proxy (EMERGENT_EMAIL_KEY). To migrate to your own
Resend account later, set EMAIL_PROVIDER=resend, RESEND_API_KEY and
EMAIL_FROM_ADDRESS in .env — no application code changes are needed.
"""
import os
import re
import ipaddress
import logging
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException

load_dotenv()
logger = logging.getLogger(__name__)

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_PROVIDER = os.environ.get("EMAIL_PROVIDER", "emergent")  # "emergent" | "resend"
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")

_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv",
             "send us your password", "enter your password below", "confirm your card number",
             "your full card number", "seed phrase", "recovery phrase", "verify your card",
             "social security number", "confirm your bank details")
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags, self.urls, self.anchors = set(), [], []
        self._href, self._text = None, []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]
        if tag.lower() == "a":
            self._href = dict((k.lower(), v) for k, v in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in email (G2)")
    body = f"{subject}\n{html}".lower()
    for p in _CRED_ASK:
        if p in body:
            raise ValueError(f"Email asks the recipient for credentials: {p!r} (G2)")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Email links/assets must be absolute https: {url!r} (G3)")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Shortened, numeric-host or credential-bearing URL: {url!r} (G3)")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for m in _HOSTISH.finditer(text):
            if not _same_site(m.group(1).lower(), real):
                raise ValueError(f"Anchor text {m.group(1)!r} != real link host {real!r} (G3)")


async def _post(url: str, headers: dict, payload: dict) -> str | None:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=headers, json=payload)
    resp.raise_for_status()
    return resp.json().get("id")


async def send_email(*, to: str, subject: str, html: str) -> str | None:
    _assert_safe_email(subject, html)
    try:
        if EMAIL_PROVIDER == "resend":
            payload = {"from": f"{EMAIL_FROM_NAME} <{os.environ['EMAIL_FROM_ADDRESS']}>",
                       "to": [to], "subject": subject, "html": html}
            if EMAIL_REPLY_TO:
                payload["reply_to"] = EMAIL_REPLY_TO
            return await _post("https://api.resend.com/emails",
                                {"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}"}, payload)
        payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
        if EMAIL_REPLY_TO:
            payload["contact_email"] = EMAIL_REPLY_TO
        return await _post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                           {"X-Email-Key": os.environ["EMERGENT_EMAIL_KEY"]}, payload)
    except httpx.HTTPStatusError as e:
        try:
            code = e.response.json().get("code", "")
        except ValueError:
            code = ""
        if code in ("insufficient_credits", "integration_disabled", "daily_limit_reached", "rate_limited"):
            logger.warning(f"Email paused: {code} ({e.response.status_code})")
            raise HTTPException(status_code=503, detail="Email is temporarily unavailable")
        logger.error(f"Email send failed: HTTP {e.response.status_code} {code}".strip())
        raise HTTPException(status_code=502, detail="Failed to send email")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Email send error: {e}")
        raise HTTPException(status_code=500, detail="Failed to send email")


def _code_template(title: str, intro: str, code: str, name: str, where: str = "in the DutyConnect app") -> str:
    return (
        '<table role="presentation" width="100%" style="background:#F4F5F7"><tr><td style="padding:24px">'
        '<table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#FFFFFF;'
        'border-radius:12px"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#111827">'
        f'<p style="font-size:18px;font-weight:bold;color:#0A192F;margin:0 0 4px">{escape(EMAIL_FROM_NAME)}</p>'
        '<p style="font-size:12px;color:#6B7280;margin:0 0 20px">Stay Connected. Stay Organised.</p>'
        f'<p style="font-size:16px;font-weight:bold;margin:0 0 8px">{escape(title)}</p>'
        f'<p style="font-size:14px;margin:0 0 16px">Hi {escape(name)}, {escape(intro)}</p>'
        f'<p style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#008080;margin:0 0 16px">{escape(code)}</p>'
        f'<p style="font-size:13px;color:#4B5563;margin:0 0 16px">Enter this code {escape(where)}. '
        'It expires in 15 minutes. If you did not request it, you can ignore this email.</p>'
        f'<p style="font-size:12px;color:#6B7280;margin:0">Sent by {escape(EMAIL_FROM_NAME)}. '
        'We will never ask you to share this code or your password with anyone.</p>'
        '</td></tr></table></td></tr></table>'
    )


async def send_verification_code(to: str, name: str, code: str):
    await send_email(to=to, subject=f"Your {EMAIL_FROM_NAME} verification code",
                     html=_code_template("Verify your email", "use this code to verify your email address:", code, name))


async def send_reset_code(to: str, name: str, code: str):
    await send_email(to=to, subject=f"Your {EMAIL_FROM_NAME} password reset code",
                     html=_code_template("Reset your password", "use this code to reset your password:", code, name))


async def send_deletion_code(to: str, name: str, code: str):
    await send_email(to=to, subject=f"Your {EMAIL_FROM_NAME} account deletion code",
                     html=_code_template("Confirm account deletion",
                                         "use this code to confirm that you want to permanently delete your account:",
                                         code, name, "on the account deletion page"))


async def send_deletion_confirmation(to: str, name: str):
    html = (
        '<table role="presentation" width="100%" style="background:#F4F5F7"><tr><td style="padding:24px">'
        '<table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#FFFFFF;'
        'border-radius:12px"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#111827">'
        f'<p style="font-size:18px;font-weight:bold;color:#0A192F;margin:0 0 16px">{escape(EMAIL_FROM_NAME)}</p>'
        '<p style="font-size:16px;font-weight:bold;margin:0 0 8px">Your account has been deleted</p>'
        f'<p style="font-size:14px;margin:0 0 12px">Hi {escape(name)}, your account, shifts and payment records have been '
        'permanently deleted. Encrypted backups expire automatically and are not restored for deleted accounts.</p>'
        '<p style="font-size:13px;color:#4B5563;margin:0">If you did not ask for this, contact support straight away.</p>'
        '</td></tr></table></td></tr></table>'
    )
    await send_email(to=to, subject=f"Your {EMAIL_FROM_NAME} account has been deleted", html=html)
