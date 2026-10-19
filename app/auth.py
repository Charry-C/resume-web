"""Server-side sessions and password verification for private resume access."""
import hashlib
import hmac
import secrets
import time
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, Response

from . import config

COOKIE = "resume_session"
TTL = 8 * 60 * 60
SESSIONS: dict[str, dict] = {}
ATTEMPTS: dict[tuple, list] = {}


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260000).hex()
    return f"{salt}${digest}"


def verify(password: str, stored: str) -> bool:
    try:
        salt, digest = stored.split("$", 1)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260000).hex()
        return hmac.compare_digest(actual, digest)
    except (ValueError, AttributeError):
        return False


def session(request: Request) -> dict:
    token = request.cookies.get(COOKIE, "")
    value = SESSIONS.get(token)
    if not value:
        return {}
    if value["expires"] < time.time():
        SESSIONS.pop(token, None)
        return {}
    # Changing the deployment password invalidates existing admin sessions.
    if value["role"] == "admin" and value.get("credential") != admin_fingerprint():
        SESSIONS.pop(token, None)
        return {}
    return value


def admin_fingerprint() -> str:
    return hashlib.sha256(config.get("ADMIN_PASSWORD").encode()).hexdigest()


def require_admin(request: Request):
    if session(request).get("role") != "admin":
        raise HTTPException(403, "请先登录管理员")


def issue(request: Request, response: Response, role: str, **fields):
    now = time.time()
    for key in list(SESSIONS):
        if SESSIONS[key]["expires"] < now:
            del SESSIONS[key]
    SESSIONS.pop(request.cookies.get(COOKIE, ""), None)
    token = secrets.token_urlsafe(32)
    SESSIONS[token] = {"role": role, "expires": now + TTL, **fields}
    response.set_cookie(COOKIE, token, max_age=TTL, httponly=True,
                        secure=config.get("COOKIE_SECURE").lower() in ("1", "true"),
                        samesite="strict", path="/")


def throttle(request: Request, action: str):
    now = time.time()
    for key in list(ATTEMPTS):
        ATTEMPTS[key] = [t for t in ATTEMPTS[key] if now - t < 600]
        if not ATTEMPTS[key]:
            del ATTEMPTS[key]
    key = (request.client.host if request.client else "unknown", action)
    attempts = ATTEMPTS.setdefault(key, [])
    if len(attempts) >= 10:
        raise HTTPException(429, "尝试过于频繁，请 10 分钟后再试")
    attempts.append(now)


def same_origin(request: Request) -> bool:
    if request.headers.get("sec-fetch-site") == "cross-site":
        return False
    origin = request.headers.get("origin")
    if not origin:
        return True
    parsed = urlsplit(origin)
    return parsed.netloc == request.headers.get("host") and parsed.scheme in ("http", "https")
