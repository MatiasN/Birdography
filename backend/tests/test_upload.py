"""Upload API: content-based type detection."""

import pytest

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


def test_duplicate_upload_leaves_no_files_behind(client):
    data = make_jpeg()
    assert upload(client, data).status_code == 201
    before = stored()
    assert upload(client, data).status_code == 409
    assert stored() == before
