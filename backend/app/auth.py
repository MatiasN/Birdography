from datetime import UTC, datetime, timedelta
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pwdlib import PasswordHash
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import DB
from app.models import User

COOKIE = "session"
passwords = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)

router = APIRouter(prefix="/auth", tags=["auth"])


class Credentials(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str


def create_user(db: Session, email: str, password: str) -> User:
    user = User(email=email.lower(), password_hash=passwords.hash(password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_current_user(
    request: Request,
    db: DB,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    token = credentials.credentials if credentials else request.cookies.get(COOKIE)
    try:
        user_id = int(jwt.decode(token or "", settings.secret_key, algorithms=["HS256"])["sub"])
    except jwt.InvalidTokenError, KeyError, ValueError:
        raise HTTPException(401, "Not authenticated") from None
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(401, "Not authenticated")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post("/login")
def login(data: Credentials, response: Response, db: DB):
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if not user or not passwords.verify(data.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")

    expires = datetime.now(UTC) + timedelta(days=settings.session_days)
    token = jwt.encode({"sub": str(user.id), "exp": expires}, settings.secret_key, algorithm="HS256")
    response.set_cookie(COOKIE, token, expires=expires, httponly=True, samesite="lax", secure=settings.secure_cookies)
    return {"access_token": token, "token_type": "bearer"}


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(COOKIE)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser):
    return user


@router.post("/register", response_model=UserOut, status_code=201)
def register(data: Credentials, db: DB):
    if not settings.allow_registration:
        raise HTTPException(403, "Registration is disabled")
    try:
        return create_user(db, data.email, data.password)
    except IntegrityError:
        raise HTTPException(409, "Email already registered") from None
