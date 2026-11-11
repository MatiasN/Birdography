"""Photo metadata, read with ExifTool and reduced to the catalog's columns.

`read` runs ExifTool; `parse` derives the columns from its tags and can be rerun from `photos.exif` without the
file. Tags are keyed ExifTool style with group-1 prefixes (`ExifIFD:DateTimeOriginal`, `Composite:GPSLatitude`)
and numeric values unconverted (`-n`), see `exiftool.metadata`.

The UTC offset of the taken time comes from the camera when it records one, otherwise from the time zone at the
photo's position: the camera's GPS, or the spot the user chose on the map (`position`).
"""

from datetime import UTC, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

from geoalchemy2 import WKTElement

from app import exiftool, timezones

# These describe the file on disk (which is a temp file at upload time) or the tool, not the photo.
DROPPED_GROUPS = ("System:", "ExifTool:")
Position = tuple[float, float]  # lat, lon
TAKEN_FIELDS = ("taken_at_local", "taken_offset_minutes", "taken_at")
CAMERA_FIELDS = ("camera", "lens", "iso", "shutter_seconds", "aperture", "focal_length_mm")


def read(path: Path, position: Position | None = None) -> dict:
    """Parsed fields plus the raw tags under `exif`. Raises `exiftool.ExifToolError` when ExifTool cannot run."""
    tags = {k: v for k, v in exiftool.metadata(path).items() if not k.startswith(DROPPED_GROUPS)}
    return {**parse(tags, position), "exif": tags}


def empty() -> dict:
    """What `read` would return for a file without metadata."""
    return {**parse({}), "exif": {}}


def parse(tags: dict, position: Position | None = None) -> dict:
    """Catalog fields from ExifTool tags, as stored in `photos.exif`. Fields missing from the tags are None.

    `position` is where the user says the photo was taken; it decides the offset when the camera recorded
    none, instead of the GPS tags. `lat`/`lon` in the result are always the camera's.
    """
    local = _local_time(_first(tags, "ExifIFD:DateTimeOriginal", "ExifIFD:CreateDate"))
    offset = _offset_minutes(tags.get("ExifIFD:OffsetTimeOriginal")) if local else None
    # Composite values are signed and cover EXIF, XMP and QuickTime GPS alike.
    lat, lon = _float(tags.get("Composite:GPSLatitude")), _float(tags.get("Composite:GPSLongitude"))
    if position is None and lat is not None and lon is not None:
        position = (lat, lon)
    if local and offset is None and position is not None:
        offset = timezones.offset_minutes(*position, local)
    lens_keys = ["ExifIFD:LensModel", *(k for k in tags if k.endswith(":LensModel"))]
    return {
        "taken_at_local": local,
        "taken_offset_minutes": offset,
        "taken_at": instant(local, offset),
        "camera": _camera(tags.get("IFD0:Make"), tags.get("IFD0:Model")),
        "lens": _lens(_first(tags, *lens_keys)),
        "iso": _int(tags.get("ExifIFD:ISO")),
        "shutter_seconds": _decimal(tags.get("ExifIFD:ExposureTime"), places=6),
        "aperture": _decimal(tags.get("ExifIFD:FNumber"), places=1),
        "focal_length_mm": _decimal(tags.get("ExifIFD:FocalLength"), places=1),
        "lat": lat,
        "lon": lon,
    }


def apply(photo, meta: dict, *, keep_manual: bool = False) -> None:
    """Write the fields from `read` onto a Photo. With `keep_manual`, a date or position the user set stays."""
    photo.exif = meta["exif"]
    for field in CAMERA_FIELDS:
        setattr(photo, field, meta[field])
    if not (keep_manual and photo.point_manual):
        set_point(photo, meta["lat"], meta["lon"], manual=False)
    if not (keep_manual and photo.taken_at_manual):
        set_taken(photo, meta)


def set_point(photo, lat: float | None, lon: float | None, *, manual: bool) -> None:
    photo.point = WKTElement(f"POINT({lon} {lat})", srid=4326) if lat is not None and lon is not None else None
    photo.point_manual = manual and photo.point is not None


def set_taken(photo, meta: dict) -> None:
    """The taken time as the metadata says; the user's override, if any, is dropped."""
    for field in TAKEN_FIELDS:
        setattr(photo, field, meta[field])
    photo.taken_at_manual = False


def manual_position(photo) -> Position | None:
    """The position the user chose for the photo, if any, as stored."""
    return (photo.lat, photo.lon) if photo.point_manual and photo.lat is not None else None


def raw_dimensions(tags: dict) -> tuple[int | None, int | None]:
    """Visible size of a RAW image from its tags, in stored orientation (as Pillow reports other formats).

    The plain `ImageWidth`/`ImageHeight` don't work: on the raw IFD they include sensor margins the camera
    never shows, and in older NEFs the IFD0 pair describes a 160 px thumbnail. Crop tags come first:
    `DefaultCropSize` (DNG and newer ARW, scaled by `DefaultScale`), Nikon's `CropArea`, then the EXIF size
    the camera writes for its JPEG, and only then ExifTool's composite of the raw IFD.
    """
    for key, value in tags.items():
        if key.endswith(":DefaultCropSize"):
            scale = _numbers(tags.get(key.replace(":DefaultCropSize", ":DefaultScale")))
            if size := _size(_numbers(value), scale if len(scale) == 2 else [1, 1]):
                return size
    candidates = (
        _numbers(tags.get("Nikon:CropArea"))[2:],  # left, top, width, height
        _numbers(tags.get("ExifIFD:ExifImageWidth")) + _numbers(tags.get("ExifIFD:ExifImageHeight")),
        _numbers(tags.get("Composite:ImageSize")),
    )
    for numbers in candidates:
        if size := _size(numbers):
            return size
    return None, None


def instant(local: datetime | None, offset_minutes: int | None) -> datetime | None:
    """Timezone-aware instant for a local time; without an offset the local time is read as UTC."""
    if local is None:
        return None
    tz = timezone(timedelta(minutes=offset_minutes)) if offset_minutes is not None else UTC
    return local.replace(tzinfo=tz)


def _first(tags: dict, *keys: str):
    return next((tags[k] for k in keys if tags.get(k) not in (None, "")), None)


def _local_time(value):
    """'2026:05:14 07:32:10' -> datetime; subseconds or a zone suffix after the 19th character are ignored."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value[:19], "%Y:%m:%d %H:%M:%S")
    except ValueError:  # includes cameras writing '0000:00:00 00:00:00'
        return None


def _offset_minutes(value):
    """'+01:00' -> 60, '-03:30' -> -210."""
    if not isinstance(value, str) or len(value) != 6 or value[0] not in "+-" or value[3] != ":":
        return None
    try:
        minutes = int(value[1:3]) * 60 + int(value[4:6])
    except ValueError:
        return None
    return -minutes if value[0] == "-" else minutes


def _camera(make, model):
    make, model = (str(make).strip() if make else None, str(model).strip() if model else None)
    if model and make and not model.startswith(make):
        return f"{make} {model}"
    return model or make or None


def _lens(value):
    """Sony writes '----' for a lens it cannot identify; anything without a letter or digit is no lens."""
    text = str(value).strip() if value is not None else ""
    return text if any(c.isalnum() for c in text) else None


def _int(value):
    """800 -> 800; '800 800' (two ISO values) -> 800."""
    try:
        return int(str(value).split()[0]) if value not in (None, "") else None
    except ValueError:
        return None


def _decimal(value, places):
    """A positive number quantised to `places`; zero means the camera did not know (manual lenses)."""
    try:
        result = Decimal(str(value)) if value not in (None, "") else None
    except InvalidOperation:
        return None
    if result is None or not result.is_finite() or result <= 0:
        return None
    return result.quantize(Decimal(1).scaleb(-places))


def _numbers(value) -> list[float]:
    """3960 -> [3960.0]; '3960 2640' -> [3960.0, 2640.0]; None or junk -> []."""
    try:
        return [float(v) for v in str(value).split()] if value not in (None, "") else []
    except ValueError:
        return []


def _size(numbers: list[float], scale=(1, 1)) -> tuple[int, int] | None:
    if len(numbers) != 2 or min(numbers) <= 0:
        return None
    return round(numbers[0] * scale[0]), round(numbers[1] * scale[1])


def _float(value):
    try:
        return float(value) if value not in (None, "") else None
    except TypeError, ValueError:
        return None
