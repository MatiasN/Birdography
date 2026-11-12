import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, BinaryIO, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import derivatives, exif, exiftool, filetypes, storage
from app.auth import CurrentUser
from app.config import settings
from app.db import DB
from app.models import FILE_KINDS, Location, Photo, PhotoFile, PhotoSpecies, Species, User
from app.storage import MB

log = logging.getLogger(__name__)
router = APIRouter(prefix="/photos", tags=["photos"])
DUPLICATE = "This file has already been uploaded"


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
    point_manual: bool
    species_ids: list[int]
    location_id: int | None = Field(validation_alias="active_location_id")
    files: list[FileOut]


class PhotoUpdate(BaseModel):
    species_ids: list[int] | None = None
    location_id: int | None = None
    # A naive value is the camera's local time; an offset-aware value also sets taken_offset_minutes.
    # Explicit null reverts to the EXIF date.
    taken_at_local: datetime | None = None
    # Where the photo was taken, chosen on a map. Both or neither; explicit nulls revert to the camera's GPS.
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)

    @model_validator(mode="after")
    def _coordinates_go_together(self):
        if ("lat" in self.model_fields_set) != ("lon" in self.model_fields_set) or (self.lat is None) != (
            self.lon is None
        ):
            raise ValueError("lat and lon go together")
        return self


class Rejected(Exception):
    """An upload refused before anything was stored; `status` is the HTTP status the API answers with."""

    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


@router.post("", response_model=PhotoOut, status_code=201)
def upload(file: UploadFile, background: BackgroundTasks, db: DB, user: CurrentUser):
    """Store one photo. The type comes from the content; the client's file name is only kept for display."""
    try:
        photo, inline = ingest(db, user, file.file, file.filename)
    except Rejected as err:
        raise HTTPException(err.status, err.detail) from None
    if not inline:
        background.add_task(derivatives.process, photo.id)
    return photo


def ingest(db: Session, user: User, stream: BinaryIO, filename: str | None) -> tuple[Photo, bool]:
    """Store one photo for `user` and commit it; shared by the upload endpoint and the dev seeder.

    Returns the photo and whether its preview and thumbnail were made already; if not, the caller runs
    `derivatives.process` after responding. Raises `Rejected` for content that is not accepted.
    """
    try:
        temp = storage.save_temp(stream, max_bytes=settings.max_raw_upload_mb * MB)
    except storage.TooLarge:
        raise Rejected(413, f"Files are limited to {settings.max_raw_upload_mb} MB") from None
    if temp.size == 0:
        storage.remove(temp.name)
        raise Rejected(400, "Empty file")

    ftype = filetypes.detect(storage.path(temp.name))
    if ftype is None:
        storage.remove(temp.name)
        raise Rejected(415, "Unsupported file type")
    limit_mb = settings.max_raw_upload_mb if ftype.is_raw else settings.max_upload_mb
    if temp.size > limit_mb * MB:
        storage.remove(temp.name)
        raise Rejected(413, f"{ftype.format.upper()} files are limited to {limit_mb} MB")
    if db.scalar(select(PhotoFile.id).where(PhotoFile.sha256 == temp.sha256, PhotoFile.kind == "original")):
        storage.remove(temp.name)
        raise Rejected(409, DUPLICATE)

    name = storage.finalize(temp.name, ftype.ext)
    written = [name]
    try:
        try:
            meta = exif.read(storage.path(name))
        except exiftool.ExifToolError as err:
            # The photo is still worth keeping; `python -m app.cli reread-metadata` fills the gap later.
            log.warning("%s: metadata not read (%s)", name, err)
            meta = exif.empty()
        if ftype.is_raw:  # Pillow cannot open RAW; the camera's tags say how large the image is
            width, height = exif.raw_dimensions(meta["exif"])
        else:
            width, height = derivatives.dimensions(storage.path(name))

        photo = Photo(
            owner_id=user.id,
            files=[
                PhotoFile(
                    kind="original",
                    path=name,
                    original_filename=(filename or "")[:255] or None,
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
        exif.apply(photo, meta)
        db.add(photo)
        inline = temp.size <= settings.background_derivatives_mb * MB
        if inline:
            written += derivatives.build(photo)
        db.commit()
    except IntegrityError:
        db.rollback()
        _remove_all(written)
        raise Rejected(409, DUPLICATE) from None
    except BaseException:
        db.rollback()
        _remove_all(written)
        raise
    db.refresh(photo)
    return photo, inline


@dataclass
class PhotoFilters:
    """The filters shared by the photo list and the map points."""

    species_id: int | None = None
    camera: str | None = None
    taken_from: datetime | None = None
    taken_to: datetime | None = None

    def apply(self, query, user: User):
        query = query.where(Photo.owner_id == user.id, Photo.deleted_at.is_(None))
        if self.species_id is not None:
            query = query.where(Photo.species_links.any(PhotoSpecies.species_id == self.species_id))
        if self.camera:
            query = query.where(Photo.camera == self.camera)
        if self.taken_from:
            query = query.where(Photo.taken_at >= self.taken_from)
        if self.taken_to:
            query = query.where(Photo.taken_at <= self.taken_to)
        return query


Filters = Annotated[PhotoFilters, Depends()]


class PointOut(BaseModel):
    id: int
    lat: float
    lon: float


@router.get("", response_model=list[PhotoOut])
def list_photos(db: DB, user: CurrentUser, filters: Filters, limit: int = Query(50, le=200), offset: int = 0):
    query = filters.apply(select(Photo), user).order_by(Photo.taken_at.desc().nulls_last(), Photo.id.desc())
    return db.scalars(query.limit(limit).offset(offset)).all()


@router.get("/points", response_model=list[PointOut])
def list_points(db: DB, user: CurrentUser, filters: Filters):
    """Every located photo, as only its id and position, for the map to cluster. No limit: about 40 bytes a photo
    as JSON, so even 50 000 photos are ~2 MB before compression. Newest first, like the list."""
    query = filters.apply(select(Photo.id, Photo.lat, Photo.lon), user).where(Photo.point.is_not(None))
    query = query.order_by(Photo.taken_at.desc().nulls_last(), Photo.id.desc())
    return [PointOut(id=row.id, lat=row.lat, lon=row.lon) for row in db.execute(query)]


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

    position = exif.manual_position(photo)
    if "lat" in changes:
        exif.set_point(photo, changes["lat"], changes["lon"], manual=True)
        if changes["lat"] is None:  # back to the camera's GPS
            meta = exif.parse(photo.exif or {})
            exif.set_point(photo, meta["lat"], meta["lon"], manual=False)
        position = (changes["lat"], changes["lon"]) if changes["lat"] is not None else None

    if "taken_at_local" in changes:
        _set_taken_at(photo, changes["taken_at_local"], position)
    elif "lat" in changes and not photo.taken_at_manual:
        exif.set_taken(photo, exif.parse(photo.exif or {}, position))  # the offset may follow the position

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


def _set_taken_at(photo: Photo, value: datetime | None, position: exif.Position | None) -> None:
    if value is None:
        exif.set_taken(photo, exif.parse(photo.exif or {}, position))
        return
    if value.tzinfo is not None:
        photo.taken_offset_minutes = int(value.utcoffset().total_seconds() // 60)
        value = value.replace(tzinfo=None)
    photo.taken_at_local = value
    photo.taken_at = exif.instant(value, photo.taken_offset_minutes)
    photo.taken_at_manual = True


def _remove_all(names: list[str]) -> None:
    for name in names:
        storage.remove(name)


def _get(db: Session, user: User, photo_id: int) -> Photo:
    photo = db.get(Photo, photo_id)
    if not photo or photo.owner_id != user.id or photo.deleted_at:
        raise HTTPException(404, "Photo not found")
    return photo
