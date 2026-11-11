"""Thin wrapper around the ExifTool command line.

Used for what Pillow cannot do: tell TIFF-based RAW formats apart and pull the embedded JPEG out of a RAW
file. `metadata` reads every tag of every supported format, for when EXIF extraction moves off exifread. One
process per call; a persistent `-stay_open` process is a later optimisation if uploads ever queue up.
"""

import base64
import functools
import json
import logging
import subprocess
from pathlib import Path

from app.config import settings

TIMEOUT = 20
# Embedded JPEGs found in RAW files, best first. ThumbnailImage is tiny (~160 px) and only a last resort.
PREVIEW_TAGS = ("JpgFromRaw", "PreviewImage", "OtherImage", "ThumbnailImage")

log = logging.getLogger(__name__)


class ExifToolError(RuntimeError):
    pass


def version() -> str | None:
    """ExifTool version, or None when the binary is missing. Cached per configured path."""
    return _version(settings.exiftool_path)


@functools.cache
def _version(path: str) -> str | None:
    try:
        return _run("-ver").decode().strip()
    except ExifToolError as err:
        log.warning("ExifTool unavailable: %s", err)
        return None


def file_type(path: Path) -> dict:
    """`{"file_type": "NEF", "extension": "nef", "mime_type": "image/x-nikon-nef"}`.

    ExifTool trusts the extension of TIFF-based files (a TIFF named `.nef` is reported as NEF), so call this on
    a path without extension to get an answer based on content alone.
    """
    args = ("-j", "-n", "-FileType", "-FileTypeExtension", "-MIMEType", "--", str(path))
    (row,) = json.loads(_run(*args))
    return {
        "file_type": row.get("FileType"),
        "extension": (row.get("FileTypeExtension") or "").lower() or None,
        "mime_type": row.get("MIMEType"),
    }


def extract_preview(src: Path, dest: Path) -> bool:
    """Write the largest embedded JPEG of `src` to `dest`, keeping only its orientation as metadata.

    Returns False (and writes nothing) when the file embeds no JPEG.
    """
    (row,) = json.loads(_run("-j", "-b", *(f"-{tag}" for tag in PREVIEW_TAGS), "--", str(src)))
    candidates = [row[tag] for tag in PREVIEW_TAGS if isinstance(row.get(tag), str) and row[tag].startswith("base64:")]
    if not candidates:
        return False
    data = base64.b64decode(max(candidates, key=len)[len("base64:") :])
    dest.write_bytes(data)
    # Embedded previews often carry a full EXIF copy, GPS included; drop it all, then copy the orientation back.
    _run("-all=", "-tagsfromfile", str(src), "-Orientation", "-overwrite_original", "--", str(dest))
    return True


def metadata(path: Path) -> dict:
    """All tags with group-1 prefixes (`EXIF:DateTimeOriginal`, `GPS:GPSLatitude`), numeric values unconverted."""
    (row,) = json.loads(_run("-j", "-n", "-G1", "--", str(path)))
    row.pop("SourceFile", None)
    # PostgreSQL rejects NUL characters inside jsonb strings.
    return {k: v.replace("\x00", "") if isinstance(v, str) else v for k, v in row.items()}


def _run(*args: str) -> bytes:
    cmd = [settings.exiftool_path, *args]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=TIMEOUT, check=False)
    except FileNotFoundError:
        raise ExifToolError(f"{settings.exiftool_path!r} not found") from None
    except subprocess.TimeoutExpired:
        raise ExifToolError(f"timed out after {TIMEOUT}s: {' '.join(cmd)}") from None
    if result.returncode != 0:
        raise ExifToolError(result.stderr.decode(errors="replace").strip() or f"exit code {result.returncode}")
    return result.stdout
