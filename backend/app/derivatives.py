"""Browser-viewable previews and small thumbnails derived from the uploaded original.

Derived files carry no metadata (no GPS, no serial numbers, no timestamps); only the orientation is kept so
they display upright. Failures here never fail an upload: the photo keeps whatever files exist and the file
endpoint falls back to the original. `backfill-derivatives` retries later.
"""

import io
import logging
from dataclasses import dataclass
from pathlib import Path

import pillow_heif
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from app import exiftool, filetypes, storage
from app.db import engine
from app.models import Photo, PhotoFile

THUMBNAIL_PX = 400
PREVIEW_MAX_PX = 4096
# Decoding anything larger fails (a derivative failure, not a rejected upload) instead of exhausting memory.
Image.MAX_IMAGE_PIXELS = 200_000_000

pillow_heif.register_heif_opener()
log = logging.getLogger(__name__)

DECODE_ERRORS = (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError)


@dataclass
class Derived:
    saved: storage.Saved
    width: int
    height: int

    def as_file(self, kind: str) -> PhotoFile:
        return PhotoFile(
            kind=kind,
            path=self.saved.name,
            mime_type="image/jpeg",
            format="jpeg",
            is_raw=False,
            size_bytes=self.saved.size,
            sha256=self.saved.sha256,
            width=self.width,
            height=self.height,
        )


def build(photo: Photo) -> list[str]:
    """Add the preview and thumbnail the photo is missing. Returns the names of the files written.

    Idempotent: kinds already present are left alone. Rows are added to `photo.files`, not committed.
    """
    original = photo.file("original")
    ftype = filetypes.TYPES.get(original.format) if original else None
    if original is None or ftype is None or not storage.path(original.path).exists():
        return []
    written = []

    if photo.file("preview") is None and not ftype.browser_viewable:
        preview = make_preview(original.path, ftype)
        if preview:
            photo.files.append(preview.as_file("preview"))
            written.append(preview.saved.name)

    if photo.file("thumbnail") is None:
        # Pillow cannot decode RAW, so a RAW without an extracted preview gets no thumbnail either.
        source = photo.file("preview") or (None if ftype.is_raw else original)
        thumbnail = make_thumbnail(source.path) if source else None
        if thumbnail:
            photo.files.append(thumbnail.as_file("thumbnail"))
            written.append(thumbnail.saved.name)
    return written


def process(photo_id: int) -> None:
    """Background counterpart of `build`, in its own session. Skips photos deleted in the meantime."""
    with Session(engine) as db:
        photo = db.get(Photo, photo_id)
        if photo is None or photo.deleted_at is not None:
            return
        written = build(photo)
        try:
            db.commit()
        except Exception:
            db.rollback()
            for name in written:
                storage.remove(name)
            log.exception("photo %s: could not store derived files", photo_id)


def make_preview(original: str, ftype: filetypes.FileType) -> Derived | None:
    src = storage.path(original)
    if ftype.is_raw:
        temp = storage.temp_name()
        storage.path(temp).parent.mkdir(parents=True, exist_ok=True)
        try:
            if not exiftool.extract_preview(src, storage.path(temp)):
                log.info("%s: no embedded preview", original)
                return None
        except exiftool.ExifToolError as err:
            storage.remove(temp)
            log.warning("%s: preview extraction failed: %s", original, err)
            return None
        name = storage.finalize(temp, ".jpg")
        size, sha256 = storage.digest(name)
        width, height = dimensions(storage.path(name))
        if width is None:
            storage.remove(name)
            return None
        return Derived(storage.Saved(name, size, sha256), width, height)
    return _jpeg(src, max_px=PREVIEW_MAX_PX, quality=90)


def make_thumbnail(source: str) -> Derived | None:
    return _jpeg(storage.path(source), max_px=THUMBNAIL_PX, quality=80)


def dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        with Image.open(path) as image:
            return image.size
    except DECODE_ERRORS:
        return None, None


def _jpeg(src: Path, max_px: int, quality: int) -> Derived | None:
    """A JPEG copy of `src`, upright, shrunk to fit `max_px`, flattened on white, with no metadata."""
    try:
        with Image.open(src) as image:
            image = ImageOps.exif_transpose(image)
            image.thumbnail((max_px, max_px))
            if image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info):
                rgba = image.convert("RGBA")
                image = Image.new("RGB", rgba.size, (255, 255, 255))
                image.paste(rgba, mask=rgba.getchannel("A"))
            elif image.mode != "RGB":
                image = image.convert("RGB")
            buf = io.BytesIO()
            image.save(buf, "JPEG", quality=quality)
            width, height = image.size
    except DECODE_ERRORS as err:
        log.warning("%s: cannot derive JPEG: %s", src.name, err)
        return None
    buf.seek(0)
    return Derived(storage.save(buf, ".jpg"), width, height)
