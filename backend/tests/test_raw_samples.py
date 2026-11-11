"""Real camera RAW files (shrunk, see tests/fixtures/raw/README.md) through detection, preview and upload."""

import shutil
from datetime import datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import exif, exiftool, filetypes, storage
from app.cli import backfill_derivatives
from app.config import settings
from app.db import engine
from app.models import PhotoFile
from tests.conftest import RAW_SAMPLES, stored
from tests.test_upload import kinds, upload

pytestmark = pytest.mark.exiftool


SAMPLES = list(RAW_SAMPLES.values())


# The client's name never decides the type: no extension, or the extension of another format.
CLIENT_NAMES = {"nef": "IMG_0001.CR3", "cr3": "DSC_0001.NEF", "arw": "DSC00001", "dng": "photo.jpg"}


def by_format(sample):
    return sample.format


@pytest.mark.parametrize("sample", SAMPLES, ids=by_format)
def test_detected_by_content_without_extension(tmp_path, sample):
    upload_temp = tmp_path / "upload"
    shutil.copyfile(sample.path, upload_temp)
    assert filetypes.detect(upload_temp) == filetypes.TYPES[sample.format]


# camera, lens, ISO, shutter, aperture, focal length, offset minutes; None where the file says 0 or '----'.
EXPECTED_FIELDS = {
    "nef": ("NIKON CORPORATION NIKON Z5_2", "NIKKOR Z 24-70mm f/4 S", 100, "0.002500", "7.1", "24.0", 120),
    "cr3": ("Canon EOS R6 Mark III", "RF50mm F1.4 L VCM", 100, "0.050000", "7.1", "50.0", -480),
    "arw": ("SONY ILCE-7S", None, 400, "0.004000", None, None, None),
    "dng": ("Canon EOS 5D Mark III", "EF70-200mm f/2.8L IS II USM", 200, "0.008000", "2.8", "70.0", None),
}


@pytest.mark.parametrize("sample", SAMPLES, ids=by_format)
def test_metadata_fields(sample):
    camera, lens, iso, shutter, aperture, focal, offset = EXPECTED_FIELDS[sample.format]
    meta = exif.read(sample.path)
    assert (meta["camera"], meta["lens"], meta["iso"]) == (camera, lens, iso)
    assert meta["shutter_seconds"] == Decimal(shutter)
    assert meta["aperture"] == (Decimal(aperture) if aperture else None)
    assert meta["focal_length_mm"] == (Decimal(focal) if focal else None)
    assert meta["taken_at_local"] == datetime.strptime(sample.taken_at, "%Y:%m:%d %H:%M:%S")
    assert meta["taken_offset_minutes"] == offset
    assert (meta["lat"], meta["lon"]) == (None, None)
    assert not any(k.startswith(("System:", "ExifTool:")) for k in meta["exif"])


def test_nikon_z_nef_is_not_mistaken_for_coolpix_nrw(tmp_path):
    """ExifTool 13.50 reports this NEF as NRW even with a .nef extension; detection corrects it."""
    sample = RAW_SAMPLES["nef"]
    upload_temp = tmp_path / "upload"
    shutil.copyfile(sample.path, upload_temp)
    reported = exiftool.file_type(upload_temp)
    assert reported["file_type"] in ("NEF", "NRW")
    assert reported["model"] == sample.model
    assert filetypes.detect(upload_temp).format == "nef"


@pytest.mark.parametrize("sample", SAMPLES, ids=by_format)
def test_metadata_survived_shrinking(sample):
    tags = exiftool.metadata(sample.path)
    assert tags["IFD0:Model"] == sample.model
    assert tags["ExifIFD:DateTimeOriginal"] == sample.taken_at
    assert str(tags.get("ExifTool:Warning", "[Minor]")).startswith("[Minor]")  # nothing truncated


@pytest.mark.parametrize("sample", SAMPLES, ids=by_format)
def test_extract_preview_keeps_orientation_only(tmp_path, sample):
    dest = tmp_path / "preview.jpg"
    assert exiftool.extract_preview(sample.path, dest) is True
    tags = exiftool.metadata(dest)
    assert (tags["File:ImageWidth"], tags["File:ImageHeight"]) == sample.preview_size
    assert "IFD0:Orientation" in tags
    assert not any(k.startswith("GPS:") or k.endswith((":Make", ":Model", ":SerialNumber")) for k in tags)


@pytest.mark.parametrize("sample", SAMPLES, ids=by_format)
def test_upload_produces_preview_and_thumbnail(client, sample):
    response = upload(client, sample.read(), name=CLIENT_NAMES[sample.format])
    assert response.status_code == 201, response.text
    files = kinds(response.json())
    assert set(files) == {"original", "preview", "thumbnail"}

    original = files["original"]
    assert (original["format"], original["is_raw"], original["size_bytes"]) == (
        sample.format,
        True,
        sample.path.stat().st_size,
    )
    photo = response.json()
    assert photo["camera"] == EXPECTED_FIELDS[sample.format][0]
    assert photo["taken_at_local"] == datetime.strptime(sample.taken_at, "%Y:%m:%d %H:%M:%S").isoformat()
    assert client.get(original["url"]).headers["content-type"] == sample.mime_type
    assert any(name.endswith(filetypes.TYPES[sample.format].ext) for name in stored())

    assert files["preview"]["format"] == "jpeg"
    assert (files["preview"]["width"], files["preview"]["height"]) == sample.preview_size
    assert max(files["thumbnail"]["width"], files["thumbnail"]["height"]) == 400


def test_raw_limit_with_real_files(client, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "max_upload_mb", 1)
    monkeypatch.setattr(settings, "max_raw_upload_mb", 2)
    cr3, nef = RAW_SAMPLES["cr3"], RAW_SAMPLES["nef"]
    assert 1 * storage.MB < cr3.path.stat().st_size < 2 * storage.MB < nef.path.stat().st_size

    # The camera JPEG inside the CR3 is a real non-RAW file over 1 MB.
    camera_jpeg = exiftool._run("-b", "-JpgFromRaw", "--", str(cr3.path))
    assert len(camera_jpeg) > 1 * storage.MB
    rejected = upload(client, camera_jpeg, name="IMG_0001.JPG")
    assert rejected.status_code == 413
    assert "JPEG files are limited to 1 MB" in rejected.json()["detail"]

    assert upload(client, cr3.read()).status_code == 201  # same size class, but RAW gets the larger limit
    after_cr3 = stored()

    too_big = upload(client, nef.read())
    assert too_big.status_code == 413
    assert "limited to 2 MB" in too_big.json()["detail"]
    assert stored() == after_cr3  # nothing left behind, temp files included
    assert not any(name.startswith(storage.TEMP_DIR) for name in stored())


def test_real_raw_in_the_background(client, monkeypatch):
    monkeypatch.setattr(settings, "background_derivatives_mb", 0)
    response = upload(client, RAW_SAMPLES["arw"].read())
    assert set(kinds(response.json())) == {"original"}
    # The TestClient runs the background task before returning.
    photo = client.get(f"/photos/{response.json()['id']}").json()
    assert set(kinds(photo)) == {"original", "preview", "thumbnail"}


def test_backfill_rebuilds_raw_preview(client):
    photo = upload(client, RAW_SAMPLES["dng"].read()).json()
    with Session(engine) as db:
        for file in db.scalars(
            select(PhotoFile).where(PhotoFile.photo_id == photo["id"], PhotoFile.kind != "original")
        ):
            storage.remove(file.path)
            db.delete(file)
        db.commit()
    assert set(kinds(client.get(f"/photos/{photo['id']}").json())) == {"original"}

    with Session(engine) as db:
        assert backfill_derivatives(db) == 1
        assert backfill_derivatives(db) == 0
    files = kinds(client.get(f"/photos/{photo['id']}").json())
    assert set(files) == {"original", "preview", "thumbnail"}
    assert (files["preview"]["width"], files["preview"]["height"]) == RAW_SAMPLES["dng"].preview_size
