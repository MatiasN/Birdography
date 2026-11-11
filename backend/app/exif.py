"""Photo metadata, read with exifread and reduced to the catalog's columns.

`read` runs exifread; `parse` derives the columns from its tags and can be rerun from `photos.exif` without the
file. Tags are keyed exifread style (`EXIF DateTimeOriginal`, `GPS GPSLatitude`), values stored as text
(`"1/500"`, `"[38, 42, 3/2]"`).
"""

from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal
from fractions import Fraction
from pathlib import Path

import exifread

TAKEN_FIELDS = ("taken_at_local", "taken_offset_minutes", "taken_at")
CAMERA_FIELDS = ("camera", "lens", "iso", "shutter_seconds", "aperture", "focal_length_mm")


def read(path: Path) -> dict:
    """Parsed fields plus the tags under `exif`, as stored in `photos.exif`."""
    with path.open("rb") as f:
        tags = exifread.process_file(f, details=False)
    stored = {k: str(v) for k, v in tags.items() if "Thumbnail" not in k}
    return {**parse(stored), "exif": stored}


def parse(tags: dict) -> dict:
    """Catalog fields from exifread tags, as stored in `photos.exif`. Fields missing from the tags are None."""

    def get(key):
        return str(tags.get(key) or "").strip() or None

    local = _local_time(get("EXIF DateTimeOriginal"))
    offset = _offset_minutes(get("EXIF OffsetTimeOriginal")) if local else None
    return {
        "taken_at_local": local,
        "taken_offset_minutes": offset,
        "taken_at": instant(local, offset),
        "camera": _camera(get("Image Make"), get("Image Model")),
        "lens": get("EXIF LensModel"),
        "iso": _int(get("EXIF ISOSpeedRatings")),
        "shutter_seconds": _decimal(get("EXIF ExposureTime"), places=6),
        "aperture": _decimal(get("EXIF FNumber"), places=1),
        "focal_length_mm": _decimal(get("EXIF FocalLength"), places=1),
        "lat": _coord(get("GPS GPSLatitude"), get("GPS GPSLatitudeRef"), "S"),
        "lon": _coord(get("GPS GPSLongitude"), get("GPS GPSLongitudeRef"), "W"),
    }


def instant(local: datetime | None, offset_minutes: int | None) -> datetime | None:
    """Timezone-aware instant for a local time; without an offset the local time is read as UTC."""
    if local is None:
        return None
    tz = timezone(timedelta(minutes=offset_minutes)) if offset_minutes is not None else UTC
    return local.replace(tzinfo=tz)


def _local_time(value):
    """'2026:05:14 07:32:10' -> datetime."""
    if not value:
        return None
    try:
        return datetime.strptime(value[:19], "%Y:%m:%d %H:%M:%S")
    except ValueError:  # includes cameras writing '0000:00:00 00:00:00'
        return None


def _offset_minutes(value):
    """'+01:00' -> 60, '-03:30' -> -210."""
    if not value or len(value) != 6 or value[0] not in "+-" or value[3] != ":":
        return None
    try:
        minutes = int(value[1:3]) * 60 + int(value[4:6])
    except ValueError:
        return None
    return -minutes if value[0] == "-" else minutes


def _camera(make, model):
    if model and make and not model.startswith(make):
        return f"{make} {model}"
    return model or make


def _int(value):
    """'800' -> 800; '[800, 800]' (two ISO values) -> 800."""
    try:
        return int(value.strip("[]").split(",")[0]) if value else None
    except ValueError:
        return None


def _fraction(value):
    try:
        return Fraction(value.strip())
    except ValueError, ZeroDivisionError:
        return None


def _decimal(value, places):
    """'1/500' -> Decimal('0.002000') for places=6. Zero or negative means the camera did not know."""
    number = _fraction(value) if value else None
    if number is None or number <= 0:
        return None
    return (Decimal(number.numerator) / Decimal(number.denominator)).quantize(Decimal(1).scaleb(-places))


def _coord(value, ref, negative):
    """'[38, 42, 3/2]' (degrees, minutes, seconds) and a reference letter -> signed decimal degrees."""
    if not value:
        return None
    parts = [_fraction(v) for v in value.strip("[]").split(",")]
    if len(parts) != 3 or None in parts:
        return None
    d, m, s = parts
    coord = float(d + m / 60 + s / 3600)
    return -coord if ref == negative else coord
