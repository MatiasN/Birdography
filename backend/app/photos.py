import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, BinaryIO, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import distinct, func, select
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


class SpeciesBrief(BaseModel):
    """A species as a photo shows it; the full record is at /species/{id}."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    scientific_name: str
    name_en: str | None
    name_pt: str | None
    ebird_code: str | None  # None for a species added by hand


class PhotoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    uploaded_at: datetime
    taken_at: datetime | None
    taken_at_local: datetime | None
    taken_offset_minutes: int | None
    taken_at_manual: bool
    camera: str | None
    camera_make: str | None
    camera_model: str | None
    lens: str | None
    iso: int | None
    shutter_seconds: float | None
    aperture: float | None
    focal_length_mm: float | None
    lat: float | None
    lon: float | None
    point_manual: bool
    species_ids: list[int]
    species: list[SpeciesBrief]  # the same species, in the same order, with their names
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

    def __init__(self, status: int, detail: str, photo_id: int | None = None):
        super().__init__(detail)
        self.status = status
        self.detail = detail
        self.photo_id = photo_id  # a duplicate: the user's own photo with this file, if there is one to show


@router.post(
    "",
    response_model=PhotoOut,
    status_code=201,
    responses={409: {"description": "Already uploaded; `photo_id` is the user's own copy, when it isn't trashed"}},
)
def upload(
    file: UploadFile,
    background: BackgroundTasks,
    db: DB,
    user: CurrentUser,
    species_ids: Annotated[list[int] | None, Form()] = None,
    companion: Annotated[UploadFile | None, File()] = None,
):
    """Store one photo, with its species if given. The type comes from the content; the client's file name is
    only kept for display. Unknown species are refused before anything is stored.

    `companion` is the camera's JPEG of a RAW+JPEG pair: it becomes the photo's preview, with its metadata
    dropped. The Upload tab checks that the two are the same shot before sending them and lets the user choose;
    the server checks again and only logs a mismatch, storing the pair as sent.
    """
    links = species_links(db, species_ids or [])
    pair = (companion.file, companion.filename) if companion else None
    try:
        stored = ingest(db, user, file.file, file.filename, links, pair)
    except Rejected as err:
        if err.photo_id is not None:
            return JSONResponse({"detail": err.detail, "photo_id": err.photo_id}, status_code=err.status)
        raise HTTPException(err.status, err.detail) from None
    if not stored.inline:
        background.add_task(derivatives.process, stored.photo.id)
    return stored.photo


def species_links(db: Session, ids: list[int]) -> list[PhotoSpecies]:
    """Links to these species in this order, duplicates dropped; 400 if one is unknown or trashed."""
    ids = list(dict.fromkeys(ids))
    found = set(db.scalars(select(Species.id).where(Species.id.in_(ids), Species.deleted_at.is_(None))))
    if found != set(ids):
        raise HTTPException(400, "Unknown species")
    return [PhotoSpecies(species_id=sid, position=i) for i, sid in enumerate(ids)]


def _duplicate(db: Session, user: User, sha256: str) -> Rejected:
    """The 409 for a file stored already. Hashes are unique across all users, so the copy found may be someone
    else's or in the trash; only the user's own, visible photo is pointed at."""
    owned = db.scalar(
        select(Photo.id)
        .join(PhotoFile)
        .where(PhotoFile.sha256 == sha256, PhotoFile.kind == "original")
        .where(Photo.owner_id == user.id, Photo.deleted_at.is_(None))
    )
    return Rejected(409, DUPLICATE, owned)


@dataclass
class Ingested:
    photo: Photo
    inline: bool  # the preview and thumbnail were made already; otherwise the caller runs `derivatives.process`


Companion = tuple[BinaryIO, str | None]  # the camera JPEG of a RAW+JPEG pair, and its file name


def ingest(
    db: Session,
    user: User,
    stream: BinaryIO,
    filename: str | None,
    species: list[PhotoSpecies] | None = None,
    companion: Companion | None = None,
) -> Ingested:
    """Store one photo for `user` and commit it; shared by the upload endpoint and the dev seeder.

    Raises `Rejected` for content that is not accepted. With a `companion`, the main file must be RAW and the
    companion a JPEG; it is stored as the preview after its metadata is dropped.
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
        raise _duplicate(db, user, temp.sha256)
    try:
        partner = _check_companion(companion, ftype) if companion else None
    except Rejected:
        storage.remove(temp.name)
        raise

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
        files = [
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
        ]
        if partner and companion:
            preview = _store_companion(partner, companion[1], meta["exif"])
            written.append(preview.path)
            files.append(preview)

        photo = Photo(owner_id=user.id, files=files, species_links=species or [])
        exif.apply(photo, meta)
        db.add(photo)
        inline = temp.size <= settings.background_derivatives_mb * MB
        if inline:
            written += derivatives.build(photo)
        db.commit()
    except IntegrityError:
        db.rollback()
        _remove_all(written)
        raise _duplicate(db, user, temp.sha256) from None
    except BaseException:
        db.rollback()
        _remove_all(written)
        raise
    db.refresh(photo)
    return Ingested(photo, inline)


def _check_companion(companion: Companion, main: filetypes.FileType) -> storage.Saved:
    """Save the companion JPEG to a temp file and check it; `Rejected` (with the temp removed) when it won't do."""
    if not main.is_raw:
        raise Rejected(400, "Only a RAW file takes a companion JPEG")
    try:
        temp = storage.save_temp(companion[0], max_bytes=settings.max_upload_mb * MB)
    except storage.TooLarge:
        raise Rejected(413, f"The companion JPEG is limited to {settings.max_upload_mb} MB") from None
    ftype = filetypes.detect(storage.path(temp.name)) if temp.size else None
    if ftype is None or ftype.format != "jpeg":
        storage.remove(temp.name)
        raise Rejected(415, "The companion must be a JPEG")
    return temp


def _store_companion(temp: storage.Saved, filename: str | None, raw_tags: dict) -> PhotoFile:
    """Keep the camera JPEG as the preview, without its metadata. A JPEG that may not be the same shot is logged:
    the Upload tab has already shown that and let the user keep the pair or separate it."""
    name = storage.finalize(temp.name, ".jpg")
    path = storage.path(name)
    try:
        if warning := exif.pair_warning(raw_tags, exif.read(path)["exif"]):
            log.warning("%s (%s): %s", name, filename, warning)
        exiftool.strip_metadata(path)
    except exiftool.ExifToolError as err:
        # The pair is still worth keeping; the RAW holds the metadata that matters.
        log.warning("%s: companion metadata not read or stripped (%s)", name, err)
    size, sha256 = storage.digest(name)
    width, height = derivatives.dimensions(path)
    preview = PhotoFile(
        kind="preview",
        path=name,
        original_filename=(filename or "")[:255] or None,
        mime_type="image/jpeg",
        format="jpeg",
        is_raw=False,
        size_bytes=size,
        sha256=sha256,
        width=width,
        height=height,
    )
    return preview


@dataclass
class PhotoFilters:
    """The filters shared by the photo list and the map points."""

    # Photos with any of these species (`?species_id=1&species_id=4`).
    species_id: Annotated[list[int] | None, Query()] = None
    camera_make: str | None = None  # the brand, as in /photos/cameras: "Nikon"
    camera_model: str | None = None  # without the brand: "Z 8"
    # The instant, in UTC.
    taken_from: datetime | None = None
    taken_to: datetime | None = None
    # The day on the camera's clock (taken_at_local), both days included: what the Catalogue's date filter uses.
    date_from: date | None = None
    date_to: date | None = None
    located: bool | None = None  # with a position (true) or without (false)

    def apply(self, query, user: User):
        query = query.where(Photo.owner_id == user.id, Photo.deleted_at.is_(None))
        if self.species_id:
            query = query.where(Photo.species_links.any(PhotoSpecies.species_id.in_(self.species_id)))
        if self.camera_make:
            query = query.where(Photo.camera_make == self.camera_make)
        if self.camera_model:
            query = query.where(Photo.camera_model == self.camera_model)
        if self.taken_from:
            query = query.where(Photo.taken_at >= self.taken_from)
        if self.taken_to:
            query = query.where(Photo.taken_at <= self.taken_to)
        if self.date_from:
            query = query.where(Photo.taken_at_local >= datetime.combine(self.date_from, datetime.min.time()))
        if self.date_to:
            next_day = datetime.combine(self.date_to + timedelta(days=1), datetime.min.time())
            query = query.where(Photo.taken_at_local < next_day)
        if self.located is not None:
            query = query.where(Photo.point.is_not(None) if self.located else Photo.point.is_(None))
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


class SummaryOut(BaseModel):
    photos: int
    species: int


@router.get("/summary", response_model=SummaryOut)
def summary(db: DB, user: CurrentUser, filters: Filters):
    """How many photos the filters match, and how many species they show (trashed species not counted)."""
    photos = db.scalar(filters.apply(select(func.count(Photo.id)), user))
    matching = filters.apply(select(Photo.id), user).subquery()
    species = db.scalar(
        select(func.count(distinct(PhotoSpecies.species_id)))
        .join(Species)
        .where(PhotoSpecies.photo_id.in_(select(matching.c.id)), Species.deleted_at.is_(None))
    )
    return SummaryOut(photos=photos, species=species)


class CameraOut(BaseModel):
    make: str | None
    model: str | None
    photos: int


@router.get("/cameras", response_model=list[CameraOut])
def list_cameras(db: DB, user: CurrentUser):
    """The user's cameras, as brand and model, most used first: the options of the camera filter."""
    count = func.count(Photo.id)
    query = (
        select(Photo.camera_make, Photo.camera_model, count)
        .where(Photo.owner_id == user.id, Photo.deleted_at.is_(None))
        .where(Photo.camera_make.is_not(None) | Photo.camera_model.is_not(None))
        .group_by(Photo.camera_make, Photo.camera_model)
        .order_by(count.desc(), Photo.camera_make, Photo.camera_model)
    )
    return [CameraOut(make=make, model=model, photos=n) for make, model, n in db.execute(query)]


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
        photo.species_links = species_links(db, changes["species_ids"] or [])

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
