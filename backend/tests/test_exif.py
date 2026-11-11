"""Metadata parsing from exifread tags as stored in `photos.exif`, and `read` on generated files."""

from datetime import datetime
from decimal import Decimal

import pytest

from app import exif
from tests.conftest import make_jpeg

FULL = {
    "Image Make": "Canon",
    "Image Model": "Canon EOS R5",
    "EXIF DateTimeOriginal": "2026:05:14 07:32:10",
    "EXIF OffsetTimeOriginal": "+01:00",
    "EXIF LensModel": "RF600mm F4 L IS USM",
    "EXIF ISOSpeedRatings": "800",
    "EXIF ExposureTime": "1/500",
    "EXIF FNumber": "28/5",
    "EXIF FocalLength": "600",
    "GPS GPSLatitude": "[38, 30, 0]",
    "GPS GPSLatitudeRef": "N",
    "GPS GPSLongitude": "[9, 15, 0]",
    "GPS GPSLongitudeRef": "W",
}


def test_parse_maps_every_field():
    meta = exif.parse(FULL)
    assert meta == {
        "taken_at_local": datetime(2026, 5, 14, 7, 32, 10),
        "taken_offset_minutes": 60,
        "taken_at": meta["taken_at"],
        "camera": "Canon EOS R5",
        "lens": "RF600mm F4 L IS USM",
        "iso": 800,
        "shutter_seconds": Decimal("0.002000"),
        "aperture": Decimal("5.6"),
        "focal_length_mm": Decimal("600.0"),
        "lat": 38.5,
        "lon": -9.25,
    }
    assert meta["taken_at"].isoformat() == "2026-05-14T07:32:10+01:00"


def test_parse_empty():
    assert all(value is None for value in exif.parse({}).values())


def test_dates():
    assert exif.parse({"EXIF DateTimeOriginal": "0000:00:00 00:00:00"})["taken_at_local"] is None
    assert exif.parse({"EXIF DateTimeOriginal": "  "})["taken_at_local"] is None
    # An offset without a time is meaningless.
    assert exif.parse({"EXIF OffsetTimeOriginal": "+01:00"})["taken_offset_minutes"] is None


def test_offset_parsing():
    tags = {"EXIF DateTimeOriginal": "2026:05:14 07:32:10"}
    assert exif.parse({**tags, "EXIF OffsetTimeOriginal": "-03:30"})["taken_offset_minutes"] == -210
    assert exif.parse({**tags, "EXIF OffsetTimeOriginal": "+ab:00"})["taken_offset_minutes"] is None
    assert exif.parse({**tags, "EXIF OffsetTimeOriginal": "   :  "})["taken_offset_minutes"] is None
    assert exif.parse(tags)["taken_at"].isoformat() == "2026-05-14T07:32:10+00:00"  # no offset: read as UTC


def test_parse_rejects_malformed_values():
    meta = exif.parse(
        {
            "EXIF DateTimeOriginal": "yesterday",
            "EXIF ISOSpeedRatings": "high",
            "EXIF ExposureTime": "fast",
            "EXIF FNumber": "1/0",
            "EXIF FocalLength": "0",
            "GPS GPSLatitude": "[38, 30]",
            "GPS GPSLongitude": "[north, 0, 0]",
        }
    )
    assert all(value is None for value in meta.values())


def test_iso_with_two_values():
    assert exif.parse({"EXIF ISOSpeedRatings": "[800, 800]"})["iso"] == 800


def test_camera_name_combines_make_and_model():
    assert exif.parse({"Image Make": "Canon", "Image Model": "Canon EOS R5"})["camera"] == "Canon EOS R5"
    assert exif.parse({"Image Make": "Canon", "Image Model": "EOS R5"})["camera"] == "Canon EOS R5"
    assert exif.parse({"Image Make": "Canon "})["camera"] == "Canon"


@pytest.mark.parametrize(("lat", "lon"), [(38.5, -9.25), (-33.9, 151.2)])
def test_read_generated_jpeg(tmp_path, lat, lon):
    file = tmp_path / "x.jpg"
    settings = {"iso": 800, "exposure": (1, 500), "fnumber": (28, 5), "focal_length": (600, 1)}
    file.write_bytes(
        make_jpeg(camera="Canon EOS R5", taken_at="2026:05:14 07:32:10", lat=lat, lon=lon, settings=settings)
    )
    meta = exif.read(file)
    assert (meta["camera"], meta["iso"], meta["aperture"]) == ("Canon EOS R5", 800, Decimal("5.6"))
    assert meta["lat"] == pytest.approx(lat) and meta["lon"] == pytest.approx(lon)
    assert meta["exif"]["EXIF DateTimeOriginal"] == "2026:05:14 07:32:10"
    assert exif.parse(meta["exif"]) == {k: v for k, v in meta.items() if k != "exif"}
