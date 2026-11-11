"""The command-line entry point, command by command."""

import os
import time
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import cli, storage
from app.db import engine
from app.models import Photo, PhotoFile, Species, User
from tests.conftest import make_jpeg, stored


def run(monkeypatch, capsys, *argv) -> str:
    monkeypatch.setattr("sys.argv", ["cli", *argv])
    cli.main()
    return capsys.readouterr().out


def upload(client, data=None):
    return client.post("/photos", files={"file": ("bird.jpg", data or make_jpeg(), "image/jpeg")}).json()


def test_create_user(monkeypatch, capsys, anon):
    answers = iter(["pw", "pw"])
    monkeypatch.setattr(cli, "getpass", lambda prompt: next(answers))
    out = run(monkeypatch, capsys, "create-user", "New@Example.com")
    assert out.startswith("Created user ") and out.strip().endswith("new@example.com")
    assert anon.post("/auth/login", json={"email": "new@example.com", "password": "pw"}).status_code == 200


def test_create_user_password_mismatch(monkeypatch, capsys):
    answers = iter(["pw", "other"])
    monkeypatch.setattr(cli, "getpass", lambda prompt: next(answers))
    with pytest.raises(SystemExit, match="Passwords do not match"):
        run(monkeypatch, capsys, "create-user", "x@example.com")


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
    stale = storage.temp_name()
    storage.path(stale).parent.mkdir(parents=True, exist_ok=True)
    storage.path(stale).write_bytes(b"partial")
    os.utime(storage.path(stale), (time.time() - 7200, time.time() - 7200))

    assert (
        run(monkeypatch, capsys, "purge-trash").strip()
        == "0 photos, 0 locations, 0 species, 0 users, 1 temp files purged"
    )
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
        db.commit()

    out = run(monkeypatch, capsys, "backfill-files")
    assert "missing, skipped" in out and "1 files hashed" in out
    with Session(engine) as db:
        photo = db.get(Photo, complete["id"])
        assert photo.file("original").size_bytes > 0
        assert len(photo.file("original").sha256) == 64
        assert db.get(Photo, missing["id"]).file("original").sha256 == f"pending:{missing['id']}"


@pytest.mark.exiftool
def test_reread_metadata(monkeypatch, capsys, client):
    settings = {"iso": 800, "exposure": (1, 500), "fnumber": (28, 5), "focal_length": (600, 1)}
    legacy = upload(client, make_jpeg(camera="Canon EOS R5", taken_at="2026:05:14 07:32:10", settings=settings))
    manual = upload(client, make_jpeg(camera="Nikon Z9", taken_at="2020:01:01 00:00:00"))
    client.patch(f"/photos/{manual['id']}", json={"taken_at_local": "2024-06-01T12:00:00"})
    placed = upload(client, make_jpeg(camera="Nikon Z8", taken_at="2026:05:14 07:32:10"))
    client.patch(f"/photos/{placed['id']}", json={"lat": 38.7, "lon": -9.1})
    gone = upload(client)
    with Session(engine) as db:
        # As stored by the exifread-based reader of earlier versions: keys the current parser does not know.
        photo = db.get(Photo, legacy["id"])
        photo.exif = {"EXIF DateTimeOriginal": "2026:05:14 07:32:10", "Image Model": "Canon EOS R5"}
        photo.camera = photo.iso = photo.taken_at_local = photo.taken_at = None
        db.get(Photo, manual["id"]).camera = None
        db.get(Photo, placed["id"]).camera = None
        storage.remove(db.get(Photo, gone["id"]).file("original").path)
        db.commit()

    out = run(monkeypatch, capsys, "reread-metadata", "--photo", str(legacy["id"]))
    assert out.strip() == "1 photos updated"
    with Session(engine) as db:
        photo = db.get(Photo, legacy["id"])
        assert (photo.camera, photo.iso) == ("Canon EOS R5", 800)
        assert photo.taken_at_local == datetime(2026, 5, 14, 7, 32, 10)
        assert "ExifIFD:DateTimeOriginal" in photo.exif and "EXIF DateTimeOriginal" not in photo.exif
        assert db.get(Photo, manual["id"]).camera is None  # out of scope of --photo

    out = run(monkeypatch, capsys, "reread-metadata")
    assert f"photo {gone['id']}: original missing, skipped" in out and out.strip().endswith("3 photos updated")
    with Session(engine) as db:
        photo = db.get(Photo, manual["id"])
        assert photo.camera == "Nikon Z9"
        assert (photo.taken_at_local, photo.taken_at_manual) == (datetime(2024, 6, 1, 12), True)
        photo = db.get(Photo, placed["id"])
        assert photo.camera == "Nikon Z8"
        assert (photo.lat, photo.lon, photo.point_manual) == (pytest.approx(38.7), pytest.approx(-9.1), True)
        assert photo.taken_offset_minutes == 60  # derived from the spot the user chose


def test_reread_metadata_skips_photos_exiftool_cannot_read(monkeypatch, capsys, client, tmp_path):
    photo = upload(client)
    monkeypatch.setattr(cli.settings, "exiftool_path", str(tmp_path / "missing-exiftool"))
    out = run(monkeypatch, capsys, "reread-metadata")
    assert f"photo {photo['id']}: " in out and "not found, skipped" in out and "0 photos updated" in out


def test_backfill_derivatives(monkeypatch, capsys, client):
    photo = upload(client)
    with Session(engine) as db:
        thumbnail = db.scalar(select(PhotoFile).where(PhotoFile.photo_id == photo["id"], PhotoFile.kind == "thumbnail"))
        storage.remove(thumbnail.path)
        db.delete(thumbnail)
        db.commit()
    assert run(monkeypatch, capsys, "backfill-derivatives", "--photo", str(photo["id"])).strip() == "1 photos updated"
    assert run(monkeypatch, capsys, "backfill-derivatives").strip() == "0 photos updated"


def test_restorable_kinds_match_the_parser():
    assert set(cli.trash.RESTORABLE) == {"photo", "location", "species", "user"}
    assert Species in cli.trash.RESTORABLE.values()
