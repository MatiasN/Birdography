"""The command-line entry point, command by command."""

from sqlalchemy.orm import Session

from app import cli, storage
from app.db import engine
from app.models import Photo
from tests.conftest import make_jpeg


def run(monkeypatch, capsys, *argv) -> str:
    monkeypatch.setattr("sys.argv", ["cli", *argv])
    cli.main()
    return capsys.readouterr().out


def upload(client, data=None):
    return client.post("/photos", files={"file": ("bird.jpg", data or make_jpeg(), "image/jpeg")}).json()


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
