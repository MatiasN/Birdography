"""The command-line entry point, command by command."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import cli, storage
from app.db import engine
from app.models import Photo, Species, User
from tests.conftest import make_jpeg, stored


def run(monkeypatch, capsys, *argv) -> str:
    monkeypatch.setattr("sys.argv", ["cli", *argv])
    cli.main()
    return capsys.readouterr().out


def upload(client, data=None):
    return client.post("/photos", files={"file": ("bird.jpg", data or make_jpeg(), "image/jpeg")}).json()


def test_restore_user(monkeypatch, capsys, client):
    client.delete("/auth/me")
    assert "Restored user" in run(monkeypatch, capsys, "restore-user", "me@example.com")
    with Session(engine) as db:
        assert db.scalar(select(User.deleted_at).where(User.email == "me@example.com")) is None
    with pytest.raises(SystemExit, match="No user with email nobody@example.com"):
        run(monkeypatch, capsys, "restore-user", "nobody@example.com")


def test_restore(monkeypatch, capsys, client):
    species = client.post("/species", json={"scientific_name": "Ardea cinerea"}).json()
    client.delete(f"/species/{species['id']}")
    assert (
        run(monkeypatch, capsys, "restore", "species", str(species["id"])).strip()
        == f"Restored species {species['id']}"
    )
    assert client.get(f"/species/{species['id']}").status_code == 200
    with pytest.raises(SystemExit, match="No photo with id 999"):
        run(monkeypatch, capsys, "restore", "photo", "999")


def test_purge_trash(monkeypatch, capsys, client):
    photo = upload(client)
    client.delete(f"/photos/{photo['id']}")

    assert run(monkeypatch, capsys, "purge-trash").strip() == "0 photos, 0 locations, 0 species, 0 users purged"
    with Session(engine) as db:
        db.get(Photo, photo["id"]).deleted_at = datetime.now(UTC) - timedelta(days=3)
        db.commit()
    assert run(monkeypatch, capsys, "purge-trash", "--days", "2").startswith("1 photos")
    assert stored() == []


def test_backfill_files(monkeypatch, capsys, client):
    complete = upload(client)
    missing = upload(client)  # file gone from disk: left alone and reported
    with Session(engine) as db:
        photo = db.get(Photo, complete["id"])
        photo.file("original").sha256, photo.file("original").size_bytes = f"pending:{photo.id}", 0
        other = db.get(Photo, missing["id"])
        other.file("original").sha256 = f"pending:{other.id}"
        storage.remove(other.file("original").path)
        # As migrated by 0008: EXIF stored, camera-setting columns empty.
        photo.exif = {"EXIF ISOSpeedRatings": "800", "EXIF FNumber": "28/5"}
        photo.iso = photo.aperture = None
        db.commit()

    out = run(monkeypatch, capsys, "backfill-files")
    assert "missing, skipped" in out and "1 files hashed" in out and "1 photos given camera settings" in out
    with Session(engine) as db:
        photo = db.get(Photo, complete["id"])
        assert photo.file("original").size_bytes > 0
        assert len(photo.file("original").sha256) == 64
        assert (photo.iso, float(photo.aperture)) == (800, 5.6)
        assert db.get(Photo, missing["id"]).file("original").sha256 == f"pending:{missing['id']}"


def test_restorable_kinds_match_the_parser():
    assert set(cli.trash.RESTORABLE) == {"photo", "location", "species", "user"}
    assert Species in cli.trash.RESTORABLE.values()
