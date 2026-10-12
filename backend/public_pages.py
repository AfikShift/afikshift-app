"""Public web pages (no login): Privacy Policy, Terms and Account Deletion.

All organisation / domain / contact details come from environment variables so placeholders can be
replaced at launch without code changes. Pages are plain, mobile-friendly HTML served by the API.
"""
import os
import secrets
from html import escape

from fastapi import APIRouter
from fastapi.responses import HTMLResponse


def cfg() -> dict:
    return {
        "org": os.environ.get("DATA_CONTROLLER_NAME", "[YOUR ORGANISATION NAME]"),
        "email": os.environ.get("SUPPORT_EMAIL", "support@YOUR-DOMAIN.example"),
        "site": os.environ.get("PUBLIC_BASE_URL", "https://YOUR-DOMAIN.example"),
        "updated": os.environ.get("POLICY_LAST_UPDATED", "[DATE]"),
        "backup_days": os.environ.get("BACKUP_RETENTION_DAYS", "35"),
    }


CSS = """
body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;background:#F4F5F7;line-height:1.55}
header{background:#0A192F;color:#fff;padding:20px 16px}header b{font-size:20px}header span{display:block;color:#9FB3C8;font-size:13px}
main{max-width:760px;margin:0 auto;padding:16px}section{background:#fff;border-radius:12px;padding:16px 18px;margin-bottom:12px}
h1{font-size:22px;margin:8px 0 4px;color:#0A192F}h2{font-size:17px;margin:0 0 8px;color:#0A192F}
p,li{font-size:15px}table{width:100%;border-collapse:collapse;font-size:14px}td,th{border-bottom:1px solid #E5E7EB;padding:6px;text-align:left;vertical-align:top}
label{display:block;font-weight:600;margin:12px 0 4px}input[type=email],input[type=text]{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1.5px solid #D1D5DB;border-radius:10px}
button{margin-top:14px;width:100%;min-height:48px;border:0;border-radius:10px;background:#0A192F;color:#fff;font-size:16px;font-weight:600}
button.danger{background:#DC2626}.note{color:#6B7280;font-size:13px}.warn{background:#FEF3E2;color:#7C2D12;border-radius:10px;padding:12px}
.ok{background:#E3F7EF;color:#065F46;border-radius:10px;padding:12px}.err{color:#DC2626;font-weight:600}.hidden{display:none}
.check{display:flex;gap:10px;align-items:flex-start;margin-top:12px}.check input{width:22px;height:22px;flex:none}.check label{margin:0;font-weight:400}
button.secondary{background:#F4F5F7;color:#111827}a{color:#007070}
"""


def page(title: str, body: str, script: str = "") -> HTMLResponse:
    nonce = secrets.token_urlsafe(16)
    html = f"""<!doctype html><html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{escape(title)} · DutyConnect</title>
<meta name="robots" content="noindex"><style nonce="{nonce}">{CSS}</style></head><body>
<header><b>DutyConnect</b><span>Know your shifts. Track your earnings. Stay in control.</span></header><main>{body}</main>
{f'<script nonce="{nonce}">{script}</script>' if script else ''}</body></html>"""
    csp = (f"default-src 'none'; style-src 'nonce-{nonce}'; script-src 'nonce-{nonce}'; "
           "connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'")
    return HTMLResponse(html, headers={"Content-Security-Policy": csp, "Cache-Control": "no-store"})


def privacy_html() -> HTMLResponse:
    c = {k: escape(v) for k, v in cfg().items()}
    body = f"""
<h1>Privacy Policy</h1><p class="note">Last updated: {c['updated']}</p>
<section><h2>Who we are</h2><p>DutyConnect is provided by {c['org']} (the "data controller"). Contact: <a href="mailto:{c['email']}">{c['email']}</a>.
DutyConnect is an independent shift planner, overtime tracker and earnings manager for shift workers. It is not owned, operated or endorsed by any employer or government organisation, and it is not a payroll system.</p></section>
<section><h2>What we collect</h2><table>
<tr><th>Data</th><th>Why</th></tr>
<tr><td>Name, email address, professional category, currency, default hourly rate, notification preferences</td><td>Your account and earnings estimates</td></tr>
<tr><td>Password (stored only as a one-way bcrypt hash)</td><td>Signing in</td></tr>
<tr><td>Shift records: your name, shift type, custom shift templates, date, day/night, times, unpaid break, location, status, hourly rate</td><td>The shift manager, calendar and earnings</td></tr>
<tr><td>Payment records: amount, date, optional note, and your choices when resolving payment clashes</td><td>Payment tracking</td></tr>
<tr><td>Security data: sign-in session tokens (stored hashed), one-time codes (stored hashed, 15 minutes), failed sign-in counters (hashed, 15 minutes)</td><td>Protecting your account</td></tr>
<tr><td>Technical data: IP address and request details in server logs</td><td>Security and fault-finding</td></tr></table>
<p>We do <b>not</b> use advertising, analytics or tracking tools, and we do not sell or share your data for marketing.</p></section>
<section><h2>Other people's information</h2><p>Do not enter other people's names or ID numbers (for example patients, clients or members of the public), or confidential workplace or operational records.
The app blocks some common patterns (for example reference numbers such as A1234BC), but this check cannot catch everything, so please take care with free-text fields such as location and payment notes.</p></section>
<section><h2>Where your data is stored and how it is protected</h2><ul>
<li>On your phone, shift and payment records are encrypted (XChaCha20-Poly1305). The key is held in the phone's secure Keychain / Keystore.</li>
<li>Data travels between the app and our servers over HTTPS (TLS).</li>
<li>On our servers, data is held in a database run by our hosting provider. Backups are encrypted (AES-256) and access-restricted.</li>
<li>Face ID / fingerprint unlock is handled entirely by your phone. We never receive biometric data.</li></ul></section>
<section><h2>Service providers</h2><p>We use a hosting provider to run the API and database, and an email delivery provider to send verification, password-reset and account-deletion emails (your email address, your name and the message content are passed to it).
These providers act on our instructions as data processors. [Replace with the named providers before launch.]</p></section>
<section><h2>Reports you export</h2><p>CSV and PDF reports are created on your phone and contain only your own records. Once you share a report, it is outside DutyConnect's protection, so share it only with people and services you trust.</p></section>
<section><h2>How long we keep data</h2><ul>
<li>Account, shift and payment data: until you delete it or delete your account.</li>
<li>Deleted shifts: kept in Recently Deleted for 90 days so you can restore them, then permanently removed.</li>
<li>Encrypted backups: up to {c['backup_days']} days, then destroyed. Backups are not edited. If a backup ever has to be restored, accounts deleted since the backup was taken are deleted again straight away, using a deletion log that holds only a one-way code (not your email address).</li>
<li>Server logs: [state period, e.g. 30 days].</li></ul></section>
<section><h2>Your rights</h2><p>Under UK GDPR you can ask to access, correct, export, restrict or delete your data, and you can object to processing. On every plan you can use <b>Download my data</b> (Account → Privacy) for a free copy of all your records (JSON), once every 7 days; for anything more, email us – there is never a charge. Pro adds CSV/PDF reports.
<a href="delete-account">Delete your account here</a>, from the Account screen in the app, or by emailing us. You can complain to the Information Commissioner's Office (ico.org.uk).</p>
<p>Legal basis: performing our agreement with you (providing the app) and our legitimate interest in keeping it secure.</p></section>
<section><h2>Changes</h2><p>We will update this page and the date above if this policy changes.</p></section>"""
    return page("Privacy Policy", body)


def terms_html() -> HTMLResponse:
    c = {k: escape(v) for k, v in cfg().items()}
    body = f"""
<h1>Terms of Use</h1><p class="note">Last updated: {c['updated']}</p>
<section><h2>The service</h2><p>DutyConnect, provided by {c['org']}, helps you plan your shifts and record your own overtime, extra shifts and payments. Earnings figures are estimates and are not official payroll records. Always check them against your payslip.</p></section>
<section><h2>Your responsibilities</h2><ul><li>Keep your password and device secure.</li>
<li>Do not enter other people's personal details, operational or security-sensitive information.</li>
<li>Follow your employer's policies when you use personal apps.</li></ul></section>
<section><h2>Availability</h2><p>We aim to keep DutyConnect available and your data safe, but we cannot guarantee uninterrupted service. Keep your own exports of important records.</p></section>
<section><h2>Ending your account</h2><p>You can delete your account at any time. See the <a href="privacy">Privacy Policy</a> and the <a href="delete-account">account deletion page</a>.</p></section>
<section><h2>Contact</h2><p><a href="mailto:{c['email']}">{c['email']}</a></p></section>
<p class="note">[Have these terms reviewed by a qualified adviser before launch.]</p>"""
    return page("Terms of Use", body)


DELETE_JS = r"""
const $=id=>document.getElementById(id);let email='';
async function post(p,b){const r=await fetch('/api/public/account-deletion/'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});let d={};try{d=await r.json()}catch(e){}return [r.status,d]}
$('send').onclick=async()=>{email=$('email').value.trim();$('e1').textContent='';if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){$('e1').textContent='Enter a valid email address.';return}
$('send').disabled=true;const [s]=await post('request',{email});$('send').disabled=false;
if(s===429){$('e1').textContent='Too many requests. Please wait a few minutes and try again.';return}
if(s>=400){$('e1').textContent='Something went wrong. Please try again.';return}
$('step1').classList.add('hidden');$('step2').classList.remove('hidden')};
$('confirm').onclick=async()=>{$('e2').textContent='';const code=$('code').value.trim();
if(!/^\d{6}$/.test(code)){$('e2').textContent='Enter the 6-digit code from the email.';return}
if(!$('agree').checked){$('e2').textContent='Tick the box to confirm you understand.';return}
$('confirm').disabled=true;const [s]=await post('confirm',{email,code,confirm:true});$('confirm').disabled=false;
if(s===200){$('step2').classList.add('hidden');$('done').classList.remove('hidden');return}
$('e2').textContent=s===429?'Too many attempts. Please wait and request a new code.':'That code is invalid or has expired. Request a new code and try again.'};
$('again').onclick=()=>{$('step2').classList.add('hidden');$('step1').classList.remove('hidden')};
"""


def delete_html() -> HTMLResponse:
    c = {k: escape(v) for k, v in cfg().items()}
    body = f"""
<h1>Delete your DutyConnect account</h1>
<section><h2>What is deleted</h2><ul>
<li>Your profile: name, email address, professional category, hourly rate and preferences</li>
<li>All your shifts (including Recently Deleted), payment records and payment choices</li>
<li>Your sign-in sessions and one-time codes</li></ul>
<p><b>What is kept:</b> nothing that identifies you is kept in the live service. Encrypted backups are destroyed within {c['backup_days']} days. If a backup is restored before then, your account is deleted again automatically.
A deletion log keeps only a one-way code and the date (no email address or records) so this can happen. [Confirm with your adviser whether any legal retention applies.]</p>
<p class="warn">Deletion is permanent and cannot be undone. Export any reports you need from the app first. Copies on your phone are removed the next time the app connects.</p></section>
<section id="step1"><h2>Step 1: confirm your email</h2><p>We'll send a 6-digit code to the email address on your account. The code expires in 15 minutes and works once.</p>
<label for="email">Account email address</label><input id="email" type="email" autocomplete="email" inputmode="email">
<p id="e1" class="err" role="alert"></p><button id="send">Send code</button></section>
<section id="step2" class="hidden"><h2>Step 2: enter the code and confirm</h2>
<p>If an account exists for this email, a code has been sent. Check your inbox and spam folder.</p>
<label for="code">6-digit code</label><input id="code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
<div class="check"><input id="agree" type="checkbox"><label for="agree">I understand that my account, shifts and payment records will be permanently deleted.</label></div>
<p id="e2" class="err" role="alert"></p><button id="confirm" class="danger">Permanently delete my account</button>
<button id="again" class="secondary">Use a different email</button></section>
<section id="done" class="hidden"><p class="ok">Your account has been deleted. A confirmation email is on its way.</p></section>
<p class="note">Need help? <a href="mailto:{c['email']}">{c['email']}</a> · <a href="privacy">Privacy Policy</a></p>"""
    return page("Delete account", body, DELETE_JS)


router = APIRouter(prefix="/api/public")
router.add_api_route("/privacy", privacy_html, methods=["GET"], include_in_schema=False)
router.add_api_route("/terms", terms_html, methods=["GET"], include_in_schema=False)
router.add_api_route("/delete-account", delete_html, methods=["GET"], include_in_schema=False)
