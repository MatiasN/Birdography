"""Upload API: content-based type detection and size limits."""

import pytest

from app import storage
from app.config import settings
from tests.conftest import make_image, make_jpeg, stored

# Just enough of a Canon CR3 container to be detected as one; nothing else in it is valid.
FAKE_CR3 = b"\x00\x00\x00\x18ftypcrx \x00\x00\x00\x01crx isom" + b"\0" * 64


def upload(client, data, name="upload.bin"):
    return client.post("/photos", files={"file": (name, data, "application/octet-stream")})


def kinds(photo):
    return {f["kind"]: f for f in photo["files"]}


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


def test_duplicate_upload_leaves_no_files_behind(client):
    data = make_jpeg()
    assert upload(client, data).status_code == 201
    before = stored()
    assert upload(client, data).status_code == 409
    assert stored() == before
