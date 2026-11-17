"""RAW+JPEG pairs (plan 0008 D12): the camera JPEG uploaded as `companion` becomes the preview, and a JPEG that
doesn't look like the same shot is stored as sent, with a warning in the log (the Upload tab checks first)."""

import logging

import pytest
from sqlalchemy.orm import Session

from app import exif, exiftool, storage
from app.config import settings
from app.db import engine
from app.models import Photo, PhotoFile
from tests.conftest import RAW_SAMPLES, make_jpeg, stored

pytestmark = pytest.mark.exiftool

# What the NEF sample says about itself; a camera writes the same into its JPEG.
NEF_TAKEN = "2025:04:27 17:57:05"
NEF_MODEL = "NIKON Z5_2"
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64  # enough of a PNG to be detected as one


def upload(client, main: bytes, companion: bytes | None, main_name="DSC_0001.NEF", companion_name="DSC_0001.JPG"):
    files = {"file": (main_name, main, "application/octet-stream")}
    if companion is not None:
        files["companion"] = (companion_name, companion, "image/jpeg")
    return client.post("/photos", files=files)


def preview_file(photo_id: int) -> PhotoFile:
    with Session(engine) as db:
        return db.get(Photo, photo_id).file("preview")


def matching_jpeg(**overrides) -> bytes:
    return make_jpeg(**{"camera": NEF_MODEL, "taken_at": NEF_TAKEN, "lat": 38.7, "lon": -9.1, **overrides})


def test_the_camera_jpeg_becomes_the_preview_without_its_metadata(client, caplog):
    with caplog.at_level(logging.WARNING, logger="app.photos"):
        response = upload(client, RAW_SAMPLES["nef"].read(), matching_jpeg())
    assert response.status_code == 201, response.text
    photo = response.json()
    assert "warning" not in photo  # the reply is the photo; the browser did the checking
    assert caplog.records == []  # the same shot: nothing to log
    assert photo["camera"] == "Nikon Z5_2" and photo["species"] == []  # the RAW's metadata, the usual fields
    files = {f["kind"]: f for f in photo["files"]}
    assert set(files) == {"original", "preview", "thumbnail"}
    assert (files["preview"]["format"], files["preview"]["is_raw"]) == ("jpeg", False)
    assert (files["preview"]["width"], files["preview"]["height"]) == (8, 8)

    served = client.get(f"/photos/{photo['id']}/file", params={"kind": "preview"})
    assert served.headers["content-type"] == "image/jpeg"
    tags = exiftool.metadata(storage.path(preview_file(photo["id"]).path))
    assert not any(k.startswith("GPS") or k.endswith("DateTimeOriginal") or k.endswith(":Model") for k in tags)
    assert files["preview"]["size_bytes"] < len(matching_jpeg())  # the EXIF is gone


def test_the_preview_keeps_the_original_file_name(client):
    photo = upload(client, RAW_SAMPLES["nef"].read(), matching_jpeg(), companion_name="DSC_0001.JPG").json()
    assert preview_file(photo["id"]).original_filename == "DSC_0001.JPG"


@pytest.mark.parametrize(
    ("jpeg", "warning"),
    [
        (
            {"taken_at": "2025:04:27 17:57:07"},
            "The JPEG may not belong to this RAW: taken at 17:57:07, the RAW at 17:57:05",
        ),
        (
            {"camera": "Canon EOS R5"},
            "The JPEG may not belong to this RAW: taken with a Canon EOS R5, the RAW with a Nikon Z5_2",
        ),
        ({"taken_at": None}, "Couldn't confirm the JPEG belongs to this RAW: the JPEG has no date"),
    ],
)
def test_a_jpeg_that_may_be_another_shot_is_stored_and_logged(client, caplog, jpeg, warning):
    with caplog.at_level(logging.WARNING, logger="app.photos"):
        response = upload(client, RAW_SAMPLES["nef"].read(), matching_jpeg(**jpeg))
    assert response.status_code == 201
    assert "warning" not in response.json()
    assert [r.getMessage() for r in caplog.records] == [
        f"{preview_file(response.json()['id']).path} (DSC_0001.JPG): {warning}"
    ]
    assert {f["kind"] for f in response.json()["files"]} == {"original", "preview", "thumbnail"}


def test_pair_warning_details():
    raw = {
        "ExifIFD:DateTimeOriginal": NEF_TAKEN,
        "ExifIFD:SubSecTimeOriginal": 66,
        "IFD0:Make": "NIKON",
        "IFD0:Model": "Z5",
    }
    assert exif.pair_warning(raw, {**raw, "ExifIFD:SubSecTimeOriginal": "67"}) == (
        "The JPEG may not belong to this RAW: taken the same second, but not at the same instant"
    )
    assert exif.pair_warning(raw, {**raw, "ExifIFD:SubSecTimeOriginal": "66"}) is None
    assert exif.pair_warning(raw, {"ExifIFD:DateTimeOriginal": NEF_TAKEN}) is None  # no camera on one side: fine
    model_only = {"ExifIFD:DateTimeOriginal": NEF_TAKEN, "IFD0:Model": "Z5"}  # no Make: only the model counts
    assert exif.pair_warning(raw, model_only) is None
    assert exif.pair_warning(raw, {**model_only, "IFD0:Model": "Z6"}).startswith("The JPEG may not belong")
    assert exif.pair_warning(raw, {**raw, "IFD0:Make": "Canon"}).endswith("the RAW with a Nikon Z5")
    assert exif.pair_warning({}, raw) == "Couldn't confirm the JPEG belongs to this RAW: the RAW has no date"
    unset = {**raw, "ExifIFD:DateTimeOriginal": "0000:00:00 00:00:00"}  # some cameras write this for "unknown"
    assert exif.pair_warning(unset, raw).endswith("RAW has no date")


def test_a_companion_whose_metadata_cannot_be_read_is_kept_and_logged(client, monkeypatch, caplog):
    def broken(path):
        raise exiftool.ExifToolError("no exiftool")

    monkeypatch.setattr(exiftool, "strip_metadata", broken)
    with caplog.at_level(logging.WARNING, logger="app.photos"):
        response = upload(client, RAW_SAMPLES["nef"].read(), matching_jpeg())
    assert response.status_code == 201
    assert "companion metadata not read or stripped (no exiftool)" in caplog.text
    assert {f["kind"] for f in response.json()["files"]} == {"original", "preview", "thumbnail"}


@pytest.mark.parametrize(
    ("main", "companion", "status", "detail"),
    [
        (lambda: make_jpeg(), lambda: matching_jpeg(), 400, "Only a RAW file takes a companion JPEG"),
        (lambda: RAW_SAMPLES["nef"].read(), lambda: PNG, 415, "The companion must be a JPEG"),
        (lambda: RAW_SAMPLES["nef"].read(), lambda: b"", 415, "The companion must be a JPEG"),
    ],
)
def test_a_companion_that_wont_do_refuses_the_pair_and_stores_nothing(client, main, companion, status, detail):
    response = upload(client, main(), companion())
    assert (response.status_code, response.json()["detail"]) == (status, detail)
    assert stored() == []
    assert client.get("/photos").json() == []


def test_a_companion_over_the_jpeg_limit_is_refused(client, monkeypatch):
    monkeypatch.setattr(settings, "max_upload_mb", 0)
    response = upload(client, RAW_SAMPLES["nef"].read(), matching_jpeg())
    assert response.status_code == 413
    assert response.json()["detail"] == "The companion JPEG is limited to 0 MB"
    assert stored() == []


def test_the_raw_is_checked_before_the_companion(client):
    """A RAW uploaded already is still a duplicate, companion or not, and nothing of the pair is kept."""
    assert upload(client, RAW_SAMPLES["nef"].read(), None).status_code == 201
    before = stored()
    response = upload(client, RAW_SAMPLES["nef"].read(), matching_jpeg())
    assert response.status_code == 409
    assert stored() == before
