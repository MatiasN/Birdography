from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import trash
from app.auth import restore_user
from app.db import engine
from app.models import Location, Photo, PhotoFile, Species, User
from tests.conftest import login, make_jpeg, stored

LATER = datetime.now(UTC) + timedelta(days=31)


def upload(client):
    return client.post("/photos", files={"file": ("bird.jpg", make_jpeg(), "image/jpeg")}).json()


def test_purge_removes_only_expired_rows_and_their_files(client):
    kept = upload(client)
    trashed = upload(client)
    client.delete(f"/photos/{trashed['id']}")
    species = client.post("/species", json={"scientific_name": "Ardea cinerea"}).json()
    client.delete(f"/species/{species['id']}")
    location = client.post("/locations", json={"name": "Home", "lat": 0, "lon": 0}).json()
    client.delete(f"/locations/{location['id']}")
    assert len(stored()) == 2  # two originals

    with Session(engine) as db:
        assert trash.purge(db) == {"photos": 0, "locations": 0, "species": 0, "users": 0}
        assert trash.purge(db, now=LATER) == {"photos": 1, "locations": 1, "species": 1, "users": 0}
        assert db.scalars(select(Photo.id)).all() == [kept["id"]]
        assert set(db.scalars(select(PhotoFile.photo_id))) == {kept["id"]}
        assert db.get(Species, species["id"]) is None
        assert db.get(Location, location["id"]) is None
    assert len(stored()) == 1
    assert client.get("/photos").json() == [kept]


def test_deleted_account_cannot_log_in_and_can_be_restored(client, anon):
    photo = upload(client)
    assert client.delete("/auth/me").status_code == 204

    assert client.get("/auth/me").status_code == 401
    login_response = anon.post("/auth/login", json={"email": "me@example.com", "password": "secret"})
    assert login_response.status_code == 401

    with Session(engine) as db:
        restore_user(db, "ME@example.com")
    assert anon.post("/auth/login", json={"email": "me@example.com", "password": "secret"}).status_code == 200
    assert anon.get("/photos").json() == [photo]


def test_purging_account_removes_its_photos_and_locations(client):
    upload(client)
    client.post("/locations", json={"name": "Home", "lat": 0, "lon": 0})
    other = login("other@example.com")
    upload(other)
    client.delete("/auth/me")

    with Session(engine) as db:
        assert trash.purge(db, now=LATER) == {"photos": 1, "locations": 1, "species": 0, "users": 1}
        assert db.scalar(select(User).where(User.email == "me@example.com")) is None
        assert db.scalars(select(Photo.owner_id)).all() == [2]
        assert db.scalars(select(Location.id)).all() == []
    assert len(stored()) == 1  # the other user's original
    assert len(other.get("/photos").json()) == 1
