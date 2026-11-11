"""Metadata parsing from ExifTool tags, and `read` on real files."""

from datetime import datetime
from decimal import Decimal

import pytest

from app import exif, exiftool
from app.config import settings
from app.models import Photo
from tests.conftest import make_jpeg

FULL = {
    "IFD0:Make": "Canon",
    "IFD0:Model": "Canon EOS R5",
    "ExifIFD:DateTimeOriginal": "2026:05:14 07:32:10",
    "ExifIFD:OffsetTimeOriginal": "+01:00",
    "ExifIFD:LensModel": "RF600mm F4 L IS USM",
    "ExifIFD:ISO": 800,
    "ExifIFD:ExposureTime": 0.002,
    "ExifIFD:FNumber": 5.6,
    "ExifIFD:FocalLength": 600,
    "Composite:GPSLatitude": 38.5,
    "Composite:GPSLongitude": -9.25,
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


def test_parse_empty_and_empty_helper():
    assert all(value is None for value in exif.parse({}).values())
    assert exif.empty() == {**exif.parse({}), "exif": {}}


def test_date_fallbacks():
    only_create = {"ExifIFD:CreateDate": "2026:05:14 07:32:10"}
    assert exif.parse(only_create)["taken_at_local"] == datetime(2026, 5, 14, 7, 32, 10)
    both = {"ExifIFD:CreateDate": "2020:01:01 00:00:00", "ExifIFD:DateTimeOriginal": "2026:05:14 07:32:10.66"}
    assert exif.parse(both)["taken_at_local"] == datetime(2026, 5, 14, 7, 32, 10)  # original wins, subseconds dropped
    assert exif.parse({"ExifIFD:DateTimeOriginal": "0000:00:00 00:00:00"})["taken_at_local"] is None
    assert exif.parse({"ExifIFD:DateTimeOriginal": "", "ExifIFD:CreateDate": None})["taken_at_local"] is None
    # An offset without a time is meaningless.
    assert exif.parse({"ExifIFD:OffsetTimeOriginal": "+01:00"})["taken_offset_minutes"] is None


def test_offset_parsing():
    tags = {"ExifIFD:DateTimeOriginal": "2026:05:14 07:32:10"}
    assert exif.parse({**tags, "ExifIFD:OffsetTimeOriginal": "-03:30"})["taken_offset_minutes"] == -210
    assert exif.parse({**tags, "ExifIFD:OffsetTimeOriginal": "+ab:00"})["taken_offset_minutes"] is None
    assert exif.parse({**tags, "ExifIFD:OffsetTimeOriginal": "   :  "})["taken_offset_minutes"] is None
    assert exif.parse({**tags, "ExifIFD:OffsetTimeOriginal": 60})["taken_offset_minutes"] is None
    assert exif.parse(tags)["taken_at"].isoformat() == "2026-05-14T07:32:10+00:00"  # no offset: read as UTC


def test_parse_rejects_malformed_values():
    meta = exif.parse(
        {
            "ExifIFD:DateTimeOriginal": "yesterday",
            "ExifIFD:ISO": "high",
            "ExifIFD:ExposureTime": "fast",
            "ExifIFD:FNumber": "1/0",
            "ExifIFD:FocalLength": "nan",
            "Composite:GPSLatitude": "north",
        }
    )
    assert all(value is None for value in meta.values())


def test_unknown_values_from_manual_lenses():
    """Sony writes zeros and '----' when nothing is attached that the body can talk to."""
    meta = exif.parse({"ExifIFD:FNumber": 0, "ExifIFD:FocalLength": 0, "ExifIFD:LensModel": "----", "ExifIFD:ISO": ""})
    assert (meta["aperture"], meta["focal_length_mm"], meta["lens"], meta["iso"]) == (None, None, None, None)


def test_lens_falls_back_to_maker_notes():
    assert exif.parse({"Canon:LensModel": "EF400mm f/5.6L USM"})["lens"] == "EF400mm f/5.6L USM"
    both = {"Canon:LensModel": "maker", "ExifIFD:LensModel": "standard"}
    assert exif.parse(both)["lens"] == "standard"


def test_iso_with_two_values():
    assert exif.parse({"ExifIFD:ISO": "800 800"})["iso"] == 800


def test_camera_name_combines_make_and_model():
    assert exif.parse({"IFD0:Make": "Canon", "IFD0:Model": "Canon EOS R5"})["camera"] == "Canon EOS R5"
    assert exif.parse({"IFD0:Make": "Canon", "IFD0:Model": "EOS R5"})["camera"] == "Canon EOS R5"
    assert exif.parse({"IFD0:Make": "Canon "})["camera"] == "Canon"
    assert exif.parse({"IFD0:Model": "SM-G973U"})["camera"] == "SM-G973U"


def test_offset_derived_from_gps_when_the_camera_recorded_none():
    tags = {
        "ExifIFD:DateTimeOriginal": "2020:04:02 18:19:31",
        "Composite:GPSLatitude": 37.3016666666667,
        "Composite:GPSLongitude": -78.3952777777778,
    }
    meta = exif.parse(tags)
    assert meta["taken_offset_minutes"] == -240  # Virginia, daylight saving time
    assert meta["taken_at"].isoformat() == "2020-04-02T18:19:31-04:00"
    # The camera's own offset wins over the position.
    assert exif.parse({**tags, "ExifIFD:OffsetTimeOriginal": "+02:00"})["taken_offset_minutes"] == 120
    # Without a time there is nothing to offset; without a position, nothing to derive from.
    assert exif.parse({k: v for k, v in tags.items() if k.startswith("Composite")})["taken_offset_minutes"] is None
    assert exif.parse({"ExifIFD:DateTimeOriginal": "2020:04:02 18:19:31"})["taken_offset_minutes"] is None


def test_position_chosen_by_the_user_decides_the_offset():
    tags = {"ExifIFD:DateTimeOriginal": "2026:05:14 07:32:10"}
    meta = exif.parse(tags, position=(38.7, -9.1))
    assert meta["taken_offset_minutes"] == 60 and (meta["lat"], meta["lon"]) == (None, None)
    with_gps = {**tags, "Composite:GPSLatitude": 37.3, "Composite:GPSLongitude": -78.4}
    meta = exif.parse(with_gps, position=(38.7, -9.1))
    assert meta["taken_offset_minutes"] == 60  # the user's spot, not the camera's
    assert (meta["lat"], meta["lon"]) == (37.3, -78.4)  # but the camera's GPS is still reported


def test_apply_sets_columns_and_point():
    photo = Photo(taken_at_manual=False)
    exif.apply(photo, {**exif.parse(FULL), "exif": FULL})
    assert photo.camera == "Canon EOS R5" and photo.iso == 800 and photo.exif == FULL
    assert photo.taken_at_local == datetime(2026, 5, 14, 7, 32, 10) and photo.taken_at_manual is False
    assert photo.point.data == "POINT(-9.25 38.5)" and photo.point.srid == 4326

    assert photo.point_manual is False

    exif.apply(photo, exif.empty())
    assert photo.point is None and photo.camera is None and photo.taken_at is None and photo.exif == {}


def test_apply_can_keep_what_the_user_set():
    manual = datetime(2024, 1, 1, 12, 0, 0)
    photo = Photo(taken_at_manual=True, taken_at_local=manual, taken_offset_minutes=0, taken_at=exif.instant(manual, 0))
    exif.set_point(photo, 38.7, -9.1, manual=True)
    exif.apply(photo, {**exif.parse(FULL), "exif": FULL}, keep_manual=True)
    assert photo.camera == "Canon EOS R5"
    assert (photo.taken_at_local, photo.taken_offset_minutes, photo.taken_at_manual) == (manual, 0, True)
    assert photo.point.data == "POINT(-9.1 38.7)" and photo.point_manual is True

    photo.taken_at_manual = photo.point_manual = False
    exif.apply(photo, {**exif.parse(FULL), "exif": FULL}, keep_manual=True)  # nothing to keep
    assert photo.taken_at_local == datetime(2026, 5, 14, 7, 32, 10)
    assert photo.point.data == "POINT(-9.25 38.5)"


def test_set_point_and_manual_position():
    photo = Photo()
    exif.set_point(photo, None, None, manual=True)  # nothing to set: not manual either
    assert photo.point is None and photo.point_manual is False
    assert exif.manual_position(photo) is None


@pytest.mark.exiftool
def test_read_drops_file_and_tool_groups(tmp_path):
    file = tmp_path / "upload"
    file.write_bytes(make_jpeg(camera="Canon EOS R5", taken_at="2026:05:14 07:32:10", lat=38.5, lon=-9.25))
    meta = exif.read(file)
    assert meta["camera"] == "Canon EOS R5" and meta["lat"] == 38.5 and meta["lon"] == -9.25
    assert meta["exif"]["ExifIFD:DateTimeOriginal"] == "2026:05:14 07:32:10"
    assert not any(k.startswith(("System:", "ExifTool:")) for k in meta["exif"])
    assert "upload" not in str(meta["exif"])


def test_read_raises_without_exiftool(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "exiftool_path", str(tmp_path / "nope"))
    file = tmp_path / "x.jpg"
    file.write_bytes(make_jpeg())
    with pytest.raises(exiftool.ExifToolError, match="not found"):
        exif.read(file)


def test_raw_dimensions_prefer_crop_tags():
    sensor = {"Composite:ImageSize": "4000 2672", "IFD0:ImageWidth": 160, "IFD0:ImageHeight": 120}
    assert exif.raw_dimensions(sensor) == (4000, 2672)
    exif_size = {**sensor, "ExifIFD:ExifImageWidth": 3990, "ExifIFD:ExifImageHeight": 2660}
    assert exif.raw_dimensions(exif_size) == (3990, 2660)
    nikon = {**exif_size, "Nikon:CropArea": "8 8 3984 2656"}
    assert exif.raw_dimensions(nikon) == (3984, 2656)
    dng = {**nikon, "SubIFD:DefaultCropSize": "3960 2640"}
    assert exif.raw_dimensions(dng) == (3960, 2640)


def test_raw_dimensions_apply_dng_default_scale():
    """Non-square sensor pixels (Nikon D1X): the DNG says to stretch the crop to get the displayed size."""
    tags = {"IFD0:DefaultCropSize": "3008 960", "IFD0:DefaultScale": "0.5 1"}
    assert exif.raw_dimensions(tags) == (1504, 960)
    assert exif.raw_dimensions({**tags, "IFD0:DefaultScale": "junk"}) == (3008, 960)


def test_raw_dimensions_skip_unusable_values():
    assert exif.raw_dimensions({}) == (None, None)
    junk = {
        "SubIFD:DefaultCropSize": "0 0",
        "Nikon:CropArea": "8 8",
        "ExifIFD:ExifImageWidth": 4320,  # height missing
        "Composite:ImageSize": "wide tall",
    }
    assert exif.raw_dimensions(junk) == (None, None)
    assert exif.raw_dimensions({**junk, "Composite:ImageSize": "4320 2880"}) == (4320, 2880)
