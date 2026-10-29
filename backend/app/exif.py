from datetime import datetime
from pathlib import Path

import exifread


def read(path: Path) -> dict:
    with path.open("rb") as f:
        tags = exifread.process_file(f, details=False)

    def get(key):
        tag = tags.get(key)
        return str(tag).strip() if tag else None

    return {
        "taken_at": _taken_at(get("EXIF DateTimeOriginal"), get("EXIF OffsetTimeOriginal")),
        "camera": _camera(get("Image Make"), get("Image Model")),
        "lens": get("EXIF LensModel"),
        "lat": _coord(tags.get("GPS GPSLatitude"), get("GPS GPSLatitudeRef"), "S"),
        "lon": _coord(tags.get("GPS GPSLongitude"), get("GPS GPSLongitudeRef"), "W"),
        "exif": {k: str(v) for k, v in tags.items() if "Thumbnail" not in k},
    }


def _taken_at(value, offset):
    if not value:
        return None
    try:
        return datetime.strptime(value + (offset or ""), "%Y:%m:%d %H:%M:%S" + ("%z" if offset else ""))
    except ValueError:
        return None


def _camera(make, model):
    if model and make and not model.startswith(make):
        return f"{make} {model}"
    return model or make


def _coord(tag, ref, negative):
    if not tag:
        return None
    d, m, s = (float(v) for v in tag.values)
    value = d + m / 60 + s / 3600
    return -value if ref == negative else value
