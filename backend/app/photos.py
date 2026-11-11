from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from geoalchemy2 import WKTElement
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import exif, filetypes, storage
from app.auth import CurrentUser
from app.config import settings
from app.db import DB
from app.models import FILE_KINDS, Location, Photo, PhotoFile, PhotoSpecies, Species, User
from app.storage import MB

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
    taken_at_local: datetime | None
    taken_offset_minutes: int | None
    taken_at_manual: bool
    camera: str | None
    lens: str | None
    iso: int | None
    shutter_seconds: float | None
    aperture: float | None
    focal_length_mm: float | None
    lat: float | None
    lon: float | None
    species_ids: list[int]
    location_id: int | None = Field(validation_alias="active_location_id")
    files: list[FileOut]


class PhotoUpdate(BaseModel):
    species_ids: list[int] | None = None
    location_id: int | None = None
    # A naive value is the camera's local time; an offset-aware value also sets taken_offset_minutes.
    # Explicit null reverts to the EXIF date.
    taken_at_local: datetime | None = None


@router.post("", response_model=PhotoOut, status_code=201)
def upload(file: UploadFile, db: DB, user: CurrentUser):
    """Store one photo. The type comes from the content; the client's file name is only kept for display."""
    try:
        temp = storage.save_temp(file.file, max_bytes=settings.max_raw_upload_mb * MB)
    except storage.TooLarge:
        raise HTTPException(413, f"Files are limited to {settings.max_raw_upload_mb} MB") from None
    if temp.size == 0:
        storage.remove(temp.name)
        raise HTTPException(400, "Empty file")

    ftype = filetypes.detect(storage.path(temp.name))
    if ftype is None:
        storage.remove(temp.name)
        raise HTTPException(415, "Unsupported file type")
    limit_mb = settings.max_raw_upload_mb if ftype.is_raw else settings.max_upload_mb
    if temp.size > limit_mb * MB:
        storage.remove(temp.name)
        raise HTTPException(413, f"{ftype.format.upper()} files are limited to {limit_mb} MB")
    if db.scalar(select(PhotoFile.id).where(PhotoFile.sha256 == temp.sha256)):
        storage.remove(temp.name)
        raise HTTPException(409, "This file has already been uploaded")

    name = storage.finalize(temp.name, ftype.ext)
    try:
        meta = exif.read(storage.path(name))
        point = None
        if meta["lat"] is not None and meta["lon"] is not None:
            point = WKTElement(f"POINT({meta['lon']} {meta['lat']})", srid=4326)
        # Pillow cannot open RAW; those get their dimensions once metadata is read with ExifTool.
        width, height = (None, None) if ftype.is_raw else _dimensions(storage.path(name))

        photo = Photo(
            owner_id=user.id,
            **{field: meta[field] for field in (*exif.TAKEN_FIELDS, *exif.CAMERA_FIELDS)},
            exif=meta["exif"],
            point=point,
            files=[
                PhotoFile(
                    kind="original",
                    path=name,
                    original_filename=(file.filename or "")[:255] or None,
                    mime_type=ftype.mime_type,
                    format=ftype.format,
                    is_raw=ftype.is_raw,
                    size_bytes=temp.size,
                    sha256=temp.sha256,
                    width=width,
                    height=height,
                )
            ],
        )
        db.add(photo)
        db.commit()
    except IntegrityError:
        db.rollback()
        storage.remove(name)
        raise HTTPException(409, "This file has already been uploaded") from None
    except BaseException:
        db.rollback()
        storage.remove(name)
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
    query = (
        select(Photo)
        .where(Photo.owner_id == user.id, Photo.deleted_at.is_(None))
        .order_by(Photo.taken_at.desc().nulls_last(), Photo.id.desc())
    )
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
            if not location or location.owner_id != user.id or location.deleted_at:
                raise HTTPException(400, "Unknown location")
        photo.location_id = changes["location_id"]

    if "species_ids" in changes:
        ids = list(dict.fromkeys(changes["species_ids"] or []))
        found = set(db.scalars(select(Species.id).where(Species.id.in_(ids), Species.deleted_at.is_(None))))
        if found != set(ids):
            raise HTTPException(400, "Unknown species")
        photo.species_links = [PhotoSpecies(species_id=sid, position=i) for i, sid in enumerate(ids)]

    if "taken_at_local" in changes:
        _set_taken_at(photo, changes["taken_at_local"])

    db.commit()
    db.refresh(photo)
    return photo


@router.delete("/{photo_id}", status_code=204)
def delete_photo(photo_id: int, db: DB, user: CurrentUser):
    """Move the photo to the trash; it is purged after the retention period."""
    photo = _get(db, user, photo_id)
    photo.deleted_at = datetime.now(UTC)
    db.commit()


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


def _set_taken_at(photo: Photo, value: datetime | None) -> None:
    if value is None:  # back to what the camera recorded
        meta = exif.parse(photo.exif or {})
        for field in exif.TAKEN_FIELDS:
            setattr(photo, field, meta[field])
        photo.taken_at_manual = False
        return
    if value.tzinfo is not None:
        photo.taken_offset_minutes = int(value.utcoffset().total_seconds() // 60)
        value = value.replace(tzinfo=None)
    photo.taken_at_local = value
    photo.taken_at = exif.instant(value, photo.taken_offset_minutes)
    photo.taken_at_manual = True


def _dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        with Image.open(path) as image:
            return image.size
    except UnidentifiedImageError, OSError:
        return None, None


def _get(db: Session, user: User, photo_id: int) -> Photo:
    photo = db.get(Photo, photo_id)
    if not photo or photo.owner_id != user.id or photo.deleted_at:
        raise HTTPException(404, "Photo not found")
    return photo
