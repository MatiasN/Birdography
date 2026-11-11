"""Upload API: content-based type detection, size limits, previews and thumbnails."""

import io
import os
import time

import exifread
import pytest
from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import derivatives, storage
from app.cli import backfill_derivatives
from app.config import settings
from app.db import engine
from app.models import Photo, PhotoFile
from tests.conftest import make_image, make_jpeg, stored

# Just enough of a Canon CR3 container to be detected as one; nothing else in it is valid.
FAKE_CR3 = b"\x00\x00\x00\x18ftypcrx \x00\x00\x00\x01crx isom" + b"\0" * 64


def upload(client, data, name="upload.bin"):
    return client.post("/photos", files={"file": (name, data, "application/octet-stream")})


def kinds(photo):
    return {f["kind"]: f for f in photo["files"]}


def exif_tags(data: bytes) -> dict:
    return exifread.process_file(io.BytesIO(data), details=False)


@pytest.mark.parametrize(
    ("data", "fmt", "mime", "ext"),
    [
        (make_jpeg(), "jpeg", "image/jpeg", ".jpg"),
        (make_image("PNG"), "png", "image/png", ".png"),
        (make_image("WEBP"), "webp", "image/webp", ".webp"),
        (make_image("TIFF"), "tiff", "image/tiff", ".tif"),
        (make_image("HEIF"), "heic", "image/heic", ".heic"),
        (FAKE_CR3, "cr3", "image/x-canon-cr3", ".cr3"),
    ],
)
def test_detects_type_by_content(client, data, fmt, mime, ext):
    response = upload(client, data, name="whatever.txt")
    assert response.status_code == 201, response.text
    original = kinds(response.json())["original"]
    assert (original["format"], original["is_raw"]) == (fmt, fmt == "cr3")
    assert client.get(original["url"]).headers["content-type"] == mime
    assert any(name.endswith(ext) and not name.startswith(".tmp") for name in stored())


def test_plain_tiff_named_nef_is_stored_as_tiff(client):
    """ExifTool would call a TIFF with a .nef extension a NEF; detection runs on an extension-less temp file."""
    original = kinds(upload(client, make_image("TIFF"), name="DSC_0001.NEF").json())["original"]
    assert (original["format"], original["is_raw"]) == ("tiff", False)


def test_rejects_non_images_and_empty_files(client):
    assert upload(client, b"not an image at all", name="x.nef").status_code == 415
    assert upload(client, b"", name="empty.jpg").status_code == 400
    assert stored() == []


def test_limits_depend_on_type(client, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    monkeypatch.setattr(settings, "max_raw_upload_mb", 2)
    padding = b"\0" * int(1.5 * storage.MB)

    too_big_jpeg = upload(client, make_jpeg() + padding)
    assert too_big_jpeg.status_code == 413
    assert "JPEG files are limited to 1 MB" in too_big_jpeg.json()["detail"]
    assert upload(client, FAKE_CR3 + padding).status_code == 201  # RAW gets the larger limit

    over_everything = upload(client, FAKE_CR3 + b"\0" * int(2.5 * storage.MB))
    assert over_everything.status_code == 413
    assert "2 MB" in over_everything.json()["detail"]
    assert all(not name.startswith(".tmp") for name in stored())
    assert len(stored()) == 1


def test_thumbnail_is_small_upright_and_stripped(client):
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90° clockwise to display
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2], gps[3], gps[4] = "N", (38.5, 0.0, 0.0), "W", (9.25, 0.0, 0.0)
    buf = io.BytesIO()
    Image.new("RGB", (1000, 500), (1, 2, 3)).save(buf, "JPEG", exif=exif)
    photo = upload(client, buf.getvalue()).json()

    files = kinds(photo)
    assert set(files) == {"original", "thumbnail"}
    assert (files["original"]["width"], files["original"]["height"]) == (1000, 500)
    assert (files["thumbnail"]["width"], files["thumbnail"]["height"]) == (200, 400)
    served = client.get(f"/photos/{photo['id']}/file", params={"kind": "thumbnail"})
    assert served.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(served.content)) as image:
        assert image.size == (200, 400)
    assert not any(tag.startswith("GPS") for tag in exif_tags(served.content))
    assert any(tag.startswith("GPS") for tag in exif_tags(client.get(files["original"]["url"]).content))


@pytest.mark.parametrize("fmt", ["HEIF", "TIFF"])
def test_non_browser_formats_get_a_jpeg_preview(client, fmt):
    photo = upload(client, make_image(fmt, size=(600, 300))).json()
    files = kinds(photo)
    assert set(files) == {"original", "preview", "thumbnail"}
    assert files["preview"]["format"] == "jpeg"
    assert (files["preview"]["width"], files["preview"]["height"]) == (600, 300)
    assert (files["thumbnail"]["width"], files["thumbnail"]["height"]) == (400, 200)
    preview = client.get(f"/photos/{photo['id']}/file")  # default kind
    assert preview.headers["content-type"] == "image/jpeg"


def test_transparent_png_is_flattened(client):
    photo = upload(client, make_image("PNG", mode="RGBA")).json()
    thumbnail = client.get(f"/photos/{photo['id']}/file", params={"kind": "thumbnail"})
    with Image.open(io.BytesIO(thumbnail.content)) as image:
        assert image.mode == "RGB"


def test_raw_without_embedded_preview_keeps_only_the_original(client):
    photo = upload(client, FAKE_CR3, name="IMG_0001.CR3").json()
    assert set(kinds(photo)) == {"original"}
    assert client.get(f"/photos/{photo['id']}/file", params={"kind": "thumbnail"}).content == FAKE_CR3
    assert len(stored()) == 1


def test_large_files_get_derivatives_in_the_background(client, monkeypatch):
    monkeypatch.setattr(settings, "background_derivatives_mb", 0)
    response = upload(client, make_jpeg())
    # Only the original is in the response; the TestClient runs the background task before returning.
    assert set(kinds(response.json())) == {"original"}
    assert set(kinds(client.get(f"/photos/{response.json()['id']}").json())) == {"original", "thumbnail"}


def test_background_job_skips_deleted_photo(client):
    photo = upload(client, make_jpeg()).json()
    with Session(engine) as db:
        thumbnail = db.scalar(select(PhotoFile).where(PhotoFile.photo_id == photo["id"], PhotoFile.kind == "thumbnail"))
        storage.remove(thumbnail.path)
        db.delete(thumbnail)
        db.commit()
    client.delete(f"/photos/{photo['id']}")

    derivatives.process(photo["id"])
    with Session(engine) as db:
        assert db.scalars(select(PhotoFile.kind).where(PhotoFile.photo_id == photo["id"])).all() == ["original"]
    assert len(stored()) == 1


def test_identical_derived_files_are_allowed_for_different_originals(client):
    # Same pixels, different ImageDescription: distinct originals, byte-identical thumbnails.
    a = upload(client, make_jpeg())
    b = upload(client, make_jpeg())
    assert (a.status_code, b.status_code) == (201, 201)
    assert kinds(a.json())["thumbnail"]["size_bytes"] == kinds(b.json())["thumbnail"]["size_bytes"]
    with Session(engine) as db:
        hashes = db.scalars(select(PhotoFile.sha256).where(PhotoFile.kind == "thumbnail")).all()
        assert len(hashes) == 2 and len(set(hashes)) == 1


def test_integrity_error_at_commit_cleans_up(client, monkeypatch):
    """The duplicate pre-check can lose a race; the unique index then fails the commit and no file may remain."""

    def colliding_build(photo):
        junk = storage.save(io.BytesIO(b"junk"), ".jpg")
        photo.files.append(
            PhotoFile(
                kind="thumbnail",
                path=photo.file("original").path,
                mime_type="image/jpeg",
                format="jpeg",
                is_raw=False,
                size_bytes=4,
                sha256="x",
            )
        )
        return [junk.name]

    monkeypatch.setattr(derivatives, "build", colliding_build)
    assert upload(client, make_jpeg()).status_code == 409
    assert stored() == []


def test_unexpected_error_after_the_file_was_written_cleans_up(client, monkeypatch):
    monkeypatch.setattr(derivatives, "build", lambda photo: (_ for _ in ()).throw(RuntimeError("disk on fire")))
    with pytest.raises(RuntimeError, match="disk on fire"):
        upload(client, make_jpeg())
    assert stored() == []
    assert client.get("/photos").json() == []


def test_duplicate_upload_leaves_no_files_behind(client):
    data = make_jpeg()
    assert upload(client, data).status_code == 201
    before = stored()
    assert upload(client, data).status_code == 409
    assert stored() == before


def test_backfill_derivatives_fills_gaps_and_is_idempotent(client):
    photo = upload(client, make_jpeg()).json()
    with Session(engine) as db:
        thumbnail = db.scalar(select(PhotoFile).where(PhotoFile.photo_id == photo["id"], PhotoFile.kind == "thumbnail"))
        storage.remove(thumbnail.path)
        db.delete(thumbnail)
        db.commit()
    assert set(kinds(client.get(f"/photos/{photo['id']}").json())) == {"original"}

    with Session(engine) as db:
        assert backfill_derivatives(db) == 1
        assert backfill_derivatives(db) == 0
        assert backfill_derivatives(db, photo_id=photo["id"] + 1) == 0
    assert set(kinds(client.get(f"/photos/{photo['id']}").json())) == {"original", "thumbnail"}
    with Session(engine) as db:
        assert db.scalar(select(Photo).where(Photo.id == photo["id"])).file("thumbnail") is not None


def test_sweep_removes_only_old_temp_files():
    old, fresh = storage.temp_name(), storage.temp_name()
    for name in (old, fresh):
        storage.path(name).parent.mkdir(parents=True, exist_ok=True)
        storage.path(name).write_bytes(b"partial")
    two_hours_ago = time.time() - 7200
    os.utime(storage.path(old), (two_hours_ago, two_hours_ago))

    assert storage.sweep_temp() == 1
    assert stored() == [fresh]
