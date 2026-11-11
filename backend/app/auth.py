from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import DB
from app.models import User
from app.throttle import Throttle

COOKIE = "session"
# Browser sessions slide: a cookie older than this is re-issued with a fresh expiry on the next request, so a
# session ends only after SESSION_DAYS without a visit, or SESSION_MAX_DAYS after the password was last typed.
RENEW_AFTER = timedelta(days=1)
MIN_PASSWORD = 10
MAX_PASSWORD = 1024  # hashing is deliberately slow; don't let a request make it arbitrarily slower
passwords = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)

# Failed logins (and failed current-password checks), per account and per client address. Past either limit the
# password is not even checked, so a correct guess while blocked tells nothing.
WINDOW_SECONDS = 15 * 60
failures_by_email = Throttle(limit=5, window_seconds=WINDOW_SECONDS)
failures_by_ip = Throttle(limit=20, window_seconds=WINDOW_SECONDS)

router = APIRouter(prefix="/auth", tags=["auth"])


class Credentials(BaseModel):
    email: str
    password: str = Field(max_length=MAX_PASSWORD)


class Registration(Credentials):
    password: str = Field(min_length=MIN_PASSWORD, max_length=MAX_PASSWORD)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=MAX_PASSWORD)
    new_password: str = Field(min_length=MIN_PASSWORD, max_length=MAX_PASSWORD)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str


class SessionOut(UserOut):
    expires_at: datetime  # when this session ends; moves forward as a browser session is renewed


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime


def password_problem(password: str) -> str | None:
    """Why a new password is not acceptable, for callers outside the API (the CLI); the API uses the models."""
    if len(password) < MIN_PASSWORD:
        return f"Passwords need at least {MIN_PASSWORD} characters"
    if len(password) > MAX_PASSWORD:
        return f"Passwords are limited to {MAX_PASSWORD} characters"
    return None


def create_user(db: Session, email: str, password: str) -> User:
    user = User(email=email.lower(), password_hash=passwords.hash(password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def set_password(db: Session, user: User, password: str) -> None:
    """Replace the password and end every session of the account."""
    user.password_hash = passwords.hash(password)
    user.session_version += 1
    db.commit()


def restore_user(db: Session, email: str) -> User:
    """Take an account out of the trash, together with its photos and locations."""
    user = db.scalar(select(User).where(User.email == email.lower()))
    if not user:
        raise LookupError(f"No user with email {email}")
    user.deleted_at = None
    db.commit()
    return user


def get_current_user(
    request: Request,
    response: Response,
    db: DB,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    token = credentials.credentials if credentials else request.cookies.get(COOKIE)
    try:
        claims = jwt.decode(token or "", settings.secret_key, algorithms=["HS256"])
        user_id = int(claims["sub"])
        version = int(claims.get("ver", 0))  # tokens issued before migration 0012 carry none
    except jwt.InvalidTokenError, KeyError, ValueError, TypeError:
        raise HTTPException(401, "Not authenticated") from None
    user = db.get(User, user_id)
    if not user or user.deleted_at or version != user.session_version:
        raise HTTPException(401, "Not authenticated")
    request.state.session_expires_at = _renew(response, user, claims, is_cookie=credentials is None)
    return user


def _ts(value: float) -> datetime:
    """A claim's timestamp as a datetime; values beyond the calendar (hand-made tokens) clamp to the extremes."""
    try:
        return datetime.fromtimestamp(value, UTC)
    except OverflowError, OSError, ValueError:
        return (datetime.max if value > 0 else datetime.min).replace(tzinfo=UTC)


def _renew(response: Response, user: User, claims: dict, is_cookie: bool) -> datetime:
    """Slide the session window: re-issue a cookie once a day while it is used. Returns when the session ends.

    Bearer tokens are not renewed (the client never sees the new value), and neither are tokens from before this
    feature (no `auth_time`): they keep their original expiry until the next login."""
    expires = _ts(claims["exp"])
    issued, auth_time = claims.get("iat"), claims.get("auth_time")
    if not (is_cookie and issued and auth_time):
        return expires
    now = datetime.now(UTC)
    if now - _ts(issued) < RENEW_AFTER:
        return expires
    if _expiry(now, _ts(auth_time)) <= expires:  # already at the SESSION_MAX_DAYS cap: nothing would change
        return expires
    _, renewed = start_session(response, user, auth_time=_ts(auth_time))
    return renewed


CurrentUser = Annotated[User, Depends(get_current_user)]


def client_ip(request: Request) -> str:
    # The real client only when uvicorn trusts the proxy's X-Forwarded-For (--proxy-headers, see the Dockerfile).
    return request.client.host if request.client else "unknown"


def check_throttle(email: str, ip: str) -> None:
    waits = [w for w in (failures_by_email.retry_after(email), failures_by_ip.retry_after(ip)) if w]
    if waits:
        wait = max(waits)
        raise HTTPException(429, "Too many failed attempts, try again later", headers={"Retry-After": str(wait)})


def record_failure(email: str, ip: str) -> None:
    failures_by_email.fail(email)
    failures_by_ip.fail(ip)


def _expiry(now: datetime, auth_time: datetime) -> datetime:
    """SESSION_DAYS from now, but never more than SESSION_MAX_DAYS after the password was last typed."""
    return min(now + timedelta(days=settings.session_days), auth_time + timedelta(days=settings.session_max_days))


def start_session(response: Response, user: User, auth_time: datetime | None = None) -> tuple[str, datetime]:
    """Issue a session token and cookie. `auth_time` stays the moment the password was typed, across renewals."""
    now = datetime.now(UTC).replace(microsecond=0)  # token timestamps are whole seconds
    auth_time = auth_time or now
    expires = _expiry(now, auth_time)
    claims = {
        "sub": str(user.id),
        "ver": user.session_version,
        "iat": now,
        "auth_time": int(auth_time.timestamp()),
        "exp": expires,
    }
    token = jwt.encode(claims, settings.secret_key, algorithm="HS256")
    response.set_cookie(COOKIE, token, expires=expires, httponly=True, samesite="lax", secure=settings.secure_cookies)
    return token, expires


@router.post("/login", response_model=LoginOut)
def login(data: Credentials, request: Request, response: Response, db: DB):
    email, ip = data.email.lower(), client_ip(request)
    check_throttle(email, ip)
    user = db.scalar(select(User).where(User.email == email))
    if not user or user.deleted_at or not passwords.verify(data.password, user.password_hash):
        record_failure(email, ip)
        raise HTTPException(401, "Invalid email or password")

    failures_by_email.reset(email)
    token, expires = start_session(response, user)
    return LoginOut(access_token=token, expires_at=expires)


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE)


@router.post("/password", status_code=204)
def change_password(data: PasswordChange, user: CurrentUser, request: Request, response: Response, db: DB):
    """Every other session of the account ends; this one gets a new cookie and stays logged in."""
    ip = client_ip(request)
    check_throttle(user.email, ip)
    if not passwords.verify(data.current_password, user.password_hash):
        record_failure(user.email, ip)
        raise HTTPException(400, "Current password is wrong")  # not 401: the session itself is fine
    failures_by_email.reset(user.email)
    set_password(db, user, data.new_password)
    start_session(response, user)


@router.get("/me", response_model=SessionOut)
def me(user: CurrentUser, request: Request):
    return SessionOut(id=user.id, email=user.email, expires_at=request.state.session_expires_at)


@router.delete("/me", status_code=204)
def delete_me(user: CurrentUser, response: Response, db: DB):
    """Move the account to the trash. Photos and locations go with it; `app.cli restore-user` brings it back."""
    user.deleted_at = datetime.now(UTC)
    db.commit()
    response.delete_cookie(COOKIE)


@router.post("/register", response_model=UserOut, status_code=201)
def register(data: Registration, db: DB):
    if not settings.allow_registration:
        raise HTTPException(403, "Registration is disabled")
    try:
        return create_user(db, data.email, data.password)
    except IntegrityError:
        raise HTTPException(409, "Email already registered") from None
