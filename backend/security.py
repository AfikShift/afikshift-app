"""HTTP hardening: security headers, request-size limit and per-IP rate limiting.

The rate limiter is in-memory (per server process). On a multi-instance deployment, add a limit at
the load balancer / reverse proxy as well (see docs/HOSTING.md).
"""
import os
import time
from collections import defaultdict, deque

from starlette.responses import JSONResponse

MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", str(2 * 1024 * 1024)))
RATE_LIMIT_PER_MIN = int(os.environ.get("RATE_LIMIT_PER_MIN", "600"))
PUBLIC_LIMIT_PER_MIN = int(os.environ.get("PUBLIC_RATE_LIMIT_PER_MIN", "10"))

HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Cross-Origin-Opener-Policy": "same-origin",
}


class RateLimiter:
    """Sliding one-minute window per key."""

    def __init__(self, limit: int, window: float = 60.0):
        self.limit, self.window = limit, window
        self.hits: dict = defaultdict(deque)

    def allow(self, key: str, now: float | None = None) -> bool:
        t = time.monotonic() if now is None else now
        q = self.hits[key]
        while q and q[0] <= t - self.window:
            q.popleft()
        if len(q) >= self.limit:
            return False
        q.append(t)
        if len(self.hits) > 50_000:  # bound memory under abuse
            self.hits.clear()
        return True


class BodyLimit:
    """ASGI middleware enforcing MAX_BODY_BYTES while the body streams in, so requests without a
    Content-Length header (chunked) cannot bypass the cap."""

    def __init__(self, app, limit: int = MAX_BODY_BYTES):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        length = dict(scope.get("headers") or []).get(b"content-length", b"")
        if length.isdigit() and int(length) > self.limit:
            return await JSONResponse({"detail": "Request too large"}, status_code=413, headers=HEADERS)(scope, receive, send)
        seen, exceeded, sent_413 = 0, False, False

        async def limited():
            nonlocal seen, exceeded
            if exceeded:
                return {"type": "http.disconnect"}
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > self.limit:
                    exceeded = True
                    return {"type": "http.disconnect"}  # stop reading; the 413 replaces the app's reply
            return msg

        async def guarded_send(msg):
            nonlocal sent_413
            if not exceeded:
                return await send(msg)
            if not sent_413:
                sent_413 = True
                await JSONResponse({"detail": "Request too large"}, status_code=413, headers=HEADERS)(scope, receive, send)

        try:
            await self.app(scope, limited, guarded_send)
        except Exception:
            if not exceeded:
                raise
            await guarded_send({})


def install_security(app, client_ip):
    general = RateLimiter(RATE_LIMIT_PER_MIN)
    public = RateLimiter(PUBLIC_LIMIT_PER_MIN)
    app.add_middleware(BodyLimit)

    @app.middleware("http")
    async def harden(request, call_next):
        path = request.url.path
        if request.method != "OPTIONS":
            ip = client_ip(request)
            if not general.allow(ip) or (path.startswith("/api/public/account-deletion/") and not public.allow(ip)):
                return JSONResponse({"detail": "Too many requests. Please try again shortly."}, status_code=429,
                                    headers={"Retry-After": "60", **HEADERS})
        response = await call_next(request)
        for k, v in HEADERS.items():
            response.headers.setdefault(k, v)
        if path.startswith("/api/") and not path.startswith("/api/public/"):
            response.headers.setdefault("Cache-Control", "no-store")
            response.headers.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        return response
