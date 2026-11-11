"""Supported image formats, detected from file content rather than from the name the client gave."""

import logging
from dataclasses import dataclass
from pathlib import Path

from app import exiftool

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class FileType:
    format: str
    mime_type: str
    is_raw: bool

    @property
    def ext(self) -> str:
        return {"jpeg": ".jpg", "tiff": ".tif"}.get(self.format, f".{self.format}")

    @property
    def browser_viewable(self) -> bool:
        return self.format in ("jpeg", "png", "webp")


TYPES = {
    t.format: t
    for t in (
        FileType("jpeg", "image/jpeg", False),
        FileType("png", "image/png", False),
        FileType("tiff", "image/tiff", False),
        FileType("webp", "image/webp", False),
        FileType("heic", "image/heic", False),
        FileType("heif", "image/heif", False),
        FileType("dng", "image/x-adobe-dng", True),
        FileType("cr2", "image/x-canon-cr2", True),
        FileType("cr3", "image/x-canon-cr3", True),
        FileType("nef", "image/x-nikon-nef", True),
        FileType("nrw", "image/x-nikon-nrw", True),
        FileType("arw", "image/x-sony-arw", True),
        FileType("orf", "image/x-olympus-orf", True),
        FileType("rw2", "image/x-panasonic-rw2", True),
        FileType("raf", "image/x-fuji-raf", True),
        FileType("pef", "image/x-pentax-pef", True),
    )
}

HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs"}
HEIF_GENERIC_BRANDS = {b"mif1", b"msf1"}
# TIFF-based formats that share the `II*\0` / `MM\0*` header: ExifTool's FileType -> our format.
TIFF_FAMILY = {"TIFF": "tiff", "DNG": "dng", "CR2": "cr2", "NEF": "nef", "NRW": "nrw", "ARW": "arw", "PEF": "pef"}


def detect(path: Path) -> FileType | None:
    """The type of the file at `path` from its content, or None when it is not a supported image.

    ExifTool trusts the extension of TIFF-based files, so `path` should have none (the upload temp file).
    """
    with path.open("rb") as f:
        head = f.read(16)
    if head[:3] == b"\xff\xd8\xff":
        return TYPES["jpeg"]
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return TYPES["png"]
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return TYPES["webp"]
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in HEIF_BRANDS:
            return TYPES["heic"]
        if brand in HEIF_GENERIC_BRANDS:
            return TYPES["heif"]
        if brand == b"crx ":
            return TYPES["cr3"]
        return None
    if head.startswith(b"FUJIFILMCCD-RAW"):
        return TYPES["raf"]
    if head[:4] in (b"IIRO", b"IIRS", b"MMOR"):
        return TYPES["orf"]
    if head[:4] == b"IIU\x00":
        return TYPES["rw2"]
    if head[:4] in (b"II*\x00", b"MM\x00*"):
        return _tiff_family(path, head)
    return None


def _tiff_family(path: Path, head: bytes) -> FileType | None:
    if head[8:10] == b"CR":
        return TYPES["cr2"]
    try:
        reported = exiftool.file_type(path)
    except exiftool.ExifToolError as err:
        # Without ExifTool a RAW degrades to a TIFF: wrong preview and limit, but never a lost upload.
        log.warning("cannot tell TIFF-based formats apart (%s); treating %s as TIFF", err, path.name)
        return TYPES["tiff"]
    fmt = TIFF_FAMILY.get(reported["file_type"] or "")
    # NRW is the Coolpix variant of NEF, but ExifTool also reports it for NEFs from newer Nikon Z bodies
    # (seen with the Z5_2 on ExifTool 13.50, with or without a .nef extension).
    if fmt == "nrw" and "COOLPIX" not in (reported.get("model") or "").upper():
        fmt = "nef"
    return TYPES[fmt] if fmt else None
