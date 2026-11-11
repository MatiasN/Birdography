"""Unit tests for the derivative pipeline's edge cases; the happy paths are covered through the upload API."""

import io
import logging

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import derivatives, exiftool, filetypes, storage
from app.db import engine
from app.models import Photo, PhotoFile
from tests.conftest import make_image, make_jpeg, stored

NEF = filetypes.TYPES["nef"]


def upload(client, data, name="x.bin"):
    return client.post("/photos", files={"file": (name, data, "application/octet-stream")}).json()


def drop_thumbnail(photo_id: int) -> None:
    with Session(engine) as db:
        thumbnail = db.scalar(select(PhotoFile).where(PhotoFile.photo_id == photo_id, PhotoFile.kind == "thumbnail"))
        storage.remove(thumbnail.path)
        db.delete(thumbnail)
        db.commit()


def test_build_skips_photos_it_cannot_work_on(client):
    gone = upload(client, make_jpeg())
    unknown = upload(client, make_jpeg())
    drop_thumbnail(gone["id"])
    drop_thumbnail(unknown["id"])
    with Session(engine) as db:
        photo = db.get(Photo, gone["id"])
        storage.remove(photo.file("original").path)
        db.get(Photo, unknown["id"]).file("original").format = "xyz"
        db.commit()
        assert derivatives.build(db.get(Photo, gone["id"])) == []
        assert derivatives.build(db.get(Photo, unknown["id"])) == []
        assert derivatives.build(Photo(owner_id=1)) == []  # no original at all


def test_process_removes_files_when_the_commit_fails(client, monkeypatch, caplog):
    photo = upload(client, make_jpeg())
    drop_thumbnail(photo["id"])
    original_path = photo["files"][0]["url"]  # not the storage path; fetched below

    def broken_build(p: Photo) -> list[str]:
        junk = storage.save(io.BytesIO(b"junk"), ".jpg")
        # Same storage path as the original: violates uq_photo_files_path at commit time.
        p.files.append(
            PhotoFile(
                kind="thumbnail",
                path=p.file("original").path,
                mime_type="image/jpeg",
                format="jpeg",
                is_raw=False,
                size_bytes=4,
                sha256="x",
            )
        )
        return [junk.name]

    monkeypatch.setattr(derivatives, "build", broken_build)
    with caplog.at_level(logging.ERROR):
        derivatives.process(photo["id"])
    assert "could not store derived files" in caplog.text
    assert len(stored()) == 1  # the junk file is gone, the original stays
    assert client.get(original_path).status_code == 200


def test_raw_preview_success_path(tmp_path, monkeypatch):
    raw = storage.save(io.BytesIO(b"pretend this is a NEF"), ".nef")

    def fake_extract(src, dest):
        dest.write_bytes(make_jpeg())
        return True

    monkeypatch.setattr(exiftool, "extract_preview", fake_extract)
    derived = derivatives.make_preview(raw.name, NEF)
    assert (derived.width, derived.height) == (8, 8)
    assert derived.saved.name.endswith(".jpg")
    assert storage.digest(derived.saved.name) == (derived.saved.size, derived.saved.sha256)
    assert derived.as_file("preview").kind == "preview"
    assert sorted(stored()) == sorted([raw.name, derived.saved.name])


def test_raw_preview_that_is_not_an_image_is_discarded(monkeypatch):
    raw = storage.save(io.BytesIO(b"pretend this is a NEF"), ".nef")

    def fake_extract(src, dest):
        dest.write_bytes(b"not a jpeg")
        return True

    monkeypatch.setattr(exiftool, "extract_preview", fake_extract)
    assert derivatives.make_preview(raw.name, NEF) is None
    assert stored() == [raw.name]


def test_raw_preview_extraction_error_is_logged(monkeypatch, caplog):
    raw = storage.save(io.BytesIO(b"pretend this is a NEF"), ".nef")

    def failing_extract(src, dest):
        dest.write_bytes(b"partial")
        raise exiftool.ExifToolError("boom")

    monkeypatch.setattr(exiftool, "extract_preview", failing_extract)
    assert derivatives.make_preview(raw.name, NEF) is None
    assert "preview extraction failed: boom" in caplog.text
    assert stored() == [raw.name]


def test_dimensions_of_a_non_image(tmp_path):
    file = tmp_path / "x.jpg"
    file.write_bytes(b"nope")
    assert derivatives.dimensions(file) == (None, None)


def test_grayscale_source_becomes_rgb_thumbnail(client):
    photo = upload(client, make_image("JPEG", mode="L"))
    thumbnail = client.get(f"/photos/{photo['id']}/file", params={"kind": "thumbnail"})
    with Image.open(io.BytesIO(thumbnail.content)) as image:
        assert image.mode == "RGB"


def test_undecodable_source_yields_no_thumbnail(client, caplog):
    """A PNG signature on garbage passes detection; Pillow then fails, and the upload still succeeds."""
    photo = upload(client, b"\x89PNG\r\n\x1a\n" + b"garbage" * 4)
    assert [f["kind"] for f in photo["files"]] == ["original"]
    assert photo["files"][0]["width"] is None
    assert "cannot derive JPEG" in caplog.text
