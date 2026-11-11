from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from geoalchemy2 import WKTElement
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import exif, storage
from app.auth import CurrentUser
from app.db import DB
from app.models import FILE_KINDS, Location, Photo, PhotoFile, PhotoSpecies, Species, User

# Extension -> (format, MIME type, is RAW).
FORMATS = {
    ".jpg": ("jpeg", "image/jpeg", False),
    ".jpeg": ("jpeg", "image/jpeg", False),
    ".png": ("png", "image/png", False),
    ".tif": ("tiff", "image/tiff", False),
    ".tiff": ("tiff", "image/tiff", False),
    ".dng": ("dng", "image/x-adobe-dng", True),
    ".cr2": ("cr2", "image/x-canon-cr2", True),
    ".cr3": ("cr3", "image/x-canon-cr3", True),
    ".nef": ("nef", "image/x-nikon-nef", True),
    ".arw": ("arw", "image/x-sony-arw", True),
    ".orf": ("orf", "image/x-olympus-orf", True),
    ".rw2": ("rw2", "image/x-panasonic-rw2", True),
    ".raf": ("raf", "image/x-fuji-raf", True),
}

router = APIRouter(prefix="/photos", tags=["photos"])


class FileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    kind: str
    url: str
    format: str
    is_raw: bool
    size_bytes: int
    width: int | None
    height: int | None


class PhotoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    uploaded_at: datetime
    taken_at: datetime | None
    camera: str | None
    lens: str | None
    lat: float | None
    lon: float | None
    species_ids: list[int]
    location_id: int | None
    files: list[FileOut]


class PhotoUpdate(BaseModel):
    species_ids: list[int] | None = None
    location_id: int | None = None


@router.post("", response_model=PhotoOut, status_code=201)
def upload(file: UploadFile, db: DB, user: CurrentUser):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in FORMATS:
        raise HTTPException(400, f"Unsupported file type: {suffix or 'none'}")
    fmt, mime_type, is_raw = FORMATS[suffix]

    saved = storage.save(file.file, suffix)
    if db.scalar(select(PhotoFile.id).where(PhotoFile.sha256 == saved.sha256)):
        storage.remove(saved.name)
        raise HTTPException(409, "This file has already been uploaded")
    try:
        meta = exif.read(storage.path(saved.name))
        point = None
        if meta["lat"] is not None and meta["lon"] is not None:
            point = WKTElement(f"POINT({meta['lon']} {meta['lat']})", srid=4326)
        # Pillow cannot open RAW; those get their dimensions once metadata is read with ExifTool.
        width, height = (None, None) if is_raw else _dimensions(storage.path(saved.name))

        photo = Photo(
            owner_id=user.id,
            taken_at=meta["taken_at"],
            camera=meta["camera"],
            lens=meta["lens"],
            exif=meta["exif"],
            point=point,
            files=[
                PhotoFile(
                    kind="original",
                    path=saved.name,
                    original_filename=(file.filename or "")[:255] or None,
                    mime_type=mime_type,
                    format=fmt,
                    is_raw=is_raw,
                    size_bytes=saved.size,
                    sha256=saved.sha256,
                    width=width,
                    height=height,
                )
            ],
        )
        db.add(photo)
        db.commit()
    except IntegrityError:
        db.rollback()
        storage.remove(saved.name)
        raise HTTPException(409, "This file has already been uploaded") from None
    except BaseException:
        db.rollback()
        storage.remove(saved.name)
        raise
    db.refresh(photo)
    return photo


@router.get("", response_model=list[PhotoOut])
def list_photos(
    db: DB,
    user: CurrentUser,
    species_id: int | None = None,
    camera: str | None = None,
    taken_from: datetime | None = None,
    taken_to: datetime | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    query = select(Photo).where(Photo.owner_id == user.id).order_by(Photo.taken_at.desc().nulls_last(), Photo.id.desc())
    if species_id is not None:
        query = query.where(Photo.species_links.any(PhotoSpecies.species_id == species_id))
    if camera:
        query = query.where(Photo.camera == camera)
    if taken_from:
        query = query.where(Photo.taken_at >= taken_from)
    if taken_to:
        query = query.where(Photo.taken_at <= taken_to)
    return db.scalars(query.limit(limit).offset(offset)).all()


@router.get("/{photo_id}", response_model=PhotoOut)
def get_photo(photo_id: int, db: DB, user: CurrentUser):
    return _get(db, user, photo_id)


@router.patch("/{photo_id}", response_model=PhotoOut)
def update_photo(photo_id: int, data: PhotoUpdate, db: DB, user: CurrentUser):
    photo = _get(db, user, photo_id)
    changes = data.model_dump(exclude_unset=True)

    if "location_id" in changes:
        if changes["location_id"] is not None:
            location = db.get(Location, changes["location_id"])
            if not location or location.owner_id != user.id:
                raise HTTPException(400, "Unknown location")
        photo.location_id = changes["location_id"]

    if "species_ids" in changes:
        ids = list(dict.fromkeys(changes["species_ids"] or []))
        found = set(db.scalars(select(Species.id).where(Species.id.in_(ids))))
        if found != set(ids):
            raise HTTPException(400, "Unknown species")
        photo.species_links = [PhotoSpecies(species_id=sid, position=i) for i, sid in enumerate(ids)]

    db.commit()
    db.refresh(photo)
    return photo


@router.get("/{photo_id}/file")
def get_file(
    photo_id: int,
    db: DB,
    user: CurrentUser,
    kind: Literal["original", "preview", "thumbnail"] = "preview",
):
    """Serve a stored file. Preview and thumbnail fall back to the original when absent."""
    photo = _get(db, user, photo_id)
    chain = FILE_KINDS[FILE_KINDS.index(kind) :: -1]  # requested kind, then larger ones down to the original
    file = next((f for k in chain if (f := photo.file(k))), None)
    if not file or not storage.path(file.path).exists():
        raise HTTPException(404, "File missing")
    return FileResponse(storage.path(file.path), media_type=file.mime_type)


def _dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        with Image.open(path) as image:
            return image.size
    except UnidentifiedImageError, OSError:
        return None, None


def _get(db: Session, user: User, photo_id: int) -> Photo:
    photo = db.get(Photo, photo_id)
    if not photo or photo.owner_id != user.id:
        raise HTTPException(404, "Photo not found")
    return photo
