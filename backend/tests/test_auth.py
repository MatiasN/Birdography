import jwt
import pytest
from sqlalchemy import update
from sqlalchemy.orm import Session
from starlette.requests import Request

from app import auth
from app.config import settings
from app.db import engine
from app.models import User
from tests.conftest import login, make_jpeg

NEW = "a brand new password"


def attempt(client, password="nope", email="me@example.com", **kwargs):
    return client.post("/auth/login", json={"email": email, "password": password}, **kwargs)


def test_me(client):
    assert client.get("/auth/me").json()["email"] == "me@example.com"


def test_wrong_password(client, anon):
    assert anon.post("/auth/login", json={"email": "me@example.com", "password": "nope"}).status_code == 401


def test_bearer_token(client, anon):
    token = anon.post("/auth/login", json={"email": "ME@example.com", "password": "secret"}).json()["access_token"]
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 200


def test_routes_require_login(anon):
    for path in ["/photos", "/species", "/locations", "/auth/me"]:
        assert anon.get(path).status_code == 401
    assert anon.get("/health").status_code == 200


def test_logout(client):
    client.post("/auth/logout")
    assert client.get("/auth/me").status_code == 401


def test_deleted_account_is_logged_out(client, anon):
    token = anon.post("/auth/login", json={"email": "me@example.com", "password": "secret"}).json()["access_token"]
    assert client.delete("/auth/me").status_code == 204
    assert client.get("/auth/me").status_code == 401  # cookie cleared
    assert anon.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401  # token still valid
    assert anon.post("/auth/login", json={"email": "me@example.com", "password": "secret"}).status_code == 401


def test_registration_when_enabled(anon, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "allow_registration", True)
    credentials = {"email": "new@example.com", "password": NEW}
    assert anon.post("/auth/register", json=credentials).status_code == 201
    assert anon.post("/auth/register", json=credentials).status_code == 409
    assert anon.post("/auth/register", json={"email": "x@example.com", "password": "short"}).status_code == 422


def test_registration_disabled_by_default(anon):
    assert anon.post("/auth/register", json={"email": "new@example.com", "password": NEW}).status_code == 403


def test_users_cannot_see_each_others_data(client):
    photo = client.post("/photos", files={"file": ("bird.jpg", make_jpeg(), "image/jpeg")}).json()
    location = client.post("/locations", json={"name": "Home", "lat": 0, "lon": 0}).json()

    other = login("other@example.com")
    assert other.get("/photos").json() == []
    assert other.get(f"/photos/{photo['id']}").status_code == 404
    assert other.get(f"/photos/{photo['id']}/file").status_code == 404
    assert other.get(f"/locations/{location['id']}").status_code == 404

    own = other.post("/photos", files={"file": ("mine.jpg", make_jpeg(), "image/jpeg")}).json()
    assert other.patch(f"/photos/{own['id']}", json={"location_id": location["id"]}).status_code == 400


# Password change


def test_change_password(client, anon):
    other_session = login_again(anon)
    response = client.post("/auth/password", json={"current_password": "secret", "new_password": NEW})
    assert response.status_code == 204
    assert "session=" in response.headers["set-cookie"]  # this session continues with a new token
    assert client.get("/auth/me").status_code == 200
    assert anon.get("/auth/me", headers=bearer(other_session)).status_code == 401  # every other session ended
    assert attempt(anon, "secret").status_code == 401
    assert attempt(anon, NEW).status_code == 200


def test_change_password_wrong_current(client):
    response = client.post("/auth/password", json={"current_password": "nope", "new_password": NEW})
    assert response.status_code == 400
    assert client.get("/auth/me").status_code == 200  # the session is untouched


def test_change_password_too_short(client):
    response = client.post("/auth/password", json={"current_password": "secret", "new_password": "short"})
    assert response.status_code == 422


def test_change_password_needs_login(anon):
    assert anon.post("/auth/password", json={"current_password": "secret", "new_password": NEW}).status_code == 401


def test_change_password_is_throttled(client):
    for _ in range(5):
        client.post("/auth/password", json={"current_password": "nope", "new_password": NEW})
    response = client.post("/auth/password", json={"current_password": "secret", "new_password": NEW})
    assert response.status_code == 429


def login_again(anon) -> str:
    return attempt(anon, "secret").json()["access_token"]


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# Tokens


@pytest.mark.parametrize(
    "claims",
    [
        {"ver": 1},  # issued for an older session version
        {"ver": "x"},  # malformed
        {"sub": "not a number"},
        {"sub": None},
    ],
)
def test_rejected_tokens(client, anon, claims):
    user_id = client.get("/auth/me").json()["id"]
    token = jwt.encode({"sub": str(user_id), "exp": 2**40, **claims}, settings.secret_key, algorithm="HS256")
    assert anon.get("/auth/me", headers=bearer(token)).status_code == 401


def test_token_without_version_is_accepted_until_the_password_changes(client, anon):
    """Tokens issued before migration 0012 have no `ver` and count as version 0."""
    user_id = client.get("/auth/me").json()["id"]
    token = jwt.encode({"sub": str(user_id), "exp": 2**40}, settings.secret_key, algorithm="HS256")
    assert anon.get("/auth/me", headers=bearer(token)).status_code == 200
    with Session(engine) as db:
        db.execute(update(User).values(session_version=User.session_version + 1))
        db.commit()
    assert anon.get("/auth/me", headers=bearer(token)).status_code == 401


# Login throttling


def test_login_blocked_after_five_failures_per_email(client, anon):
    for _ in range(5):
        assert attempt(anon).status_code == 401
    blocked = attempt(anon, "secret")  # the right password, but it is not even checked
    assert blocked.status_code == 429
    assert 0 < int(blocked.headers["retry-after"]) <= auth.WINDOW_SECONDS
    assert attempt(anon, "secret", email="ME@EXAMPLE.COM").status_code == 429  # emails compare lowercased
    login("other@example.com")
    assert attempt(anon, "secret", email="other@example.com").status_code == 200  # other accounts unaffected


def test_successful_login_resets_the_email_counter(client, anon):
    for _ in range(4):
        attempt(anon)
    assert attempt(anon, "secret").status_code == 200
    for _ in range(4):
        assert attempt(anon).status_code == 401


def test_login_blocked_after_twenty_failures_per_address(client, anon):
    for n in range(20):
        assert attempt(anon, email=f"guess{n}@example.com").status_code == 401
    assert attempt(anon, "secret").status_code == 429


def test_unknown_client_address():
    """Without a peer address (unix sockets) every request shares one bucket."""
    assert auth.client_ip(Request({"type": "http", "client": None, "headers": []})) == "unknown"
