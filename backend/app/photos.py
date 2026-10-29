from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from geoalchemy2 import WKTElement
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import exif, storage
from app.db import get_db
from app.models import Photo

ALLOWED = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".dng", ".cr2", ".cr3", ".nef", ".arw", ".orf", ".rw2", ".raf"}

router = APIRouter(prefix="/photos", tags=["photos"])


class PhotoOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    file_path: str
    uploaded_at: datetime
    taken_at: datetime | None
    camera: str | None
    lens: str | None
    species_id: int | None
    location_id: int | None


@router.post("", response_model=PhotoOut, status_code=201)
def upload(file: UploadFile, db: Session = Depends(get_db)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(400, f"Unsupported file type: {suffix or 'none'}")

    name = storage.save(file.file, suffix)
    meta = exif.read(storage.path(name))
    point = None
    if meta["lat"] is not None and meta["lon"] is not None:
        point = WKTElement(f"POINT({meta['lon']} {meta['lat']})", srid=4326)

    photo = Photo(
        file_path=name,
        taken_at=meta["taken_at"],
        camera=meta["camera"],
        lens=meta["lens"],
        exif=meta["exif"],
        point=point,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)
    return photo


@router.get("", response_model=list[PhotoOut])
def list_photos(
    species_id: int | None = None,
    camera: str | None = None,
    taken_from: datetime | None = None,
    taken_to: datetime | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    query = select(Photo).order_by(Photo.taken_at.desc().nulls_last(), Photo.id.desc())
    if species_id is not None:
        query = query.where(Photo.species_id == species_id)
    if camera:
        query = query.where(Photo.camera == camera)
    if taken_from:
        query = query.where(Photo.taken_at >= taken_from)
    if taken_to:
        query = query.where(Photo.taken_at <= taken_to)
    return db.scalars(query.limit(limit).offset(offset)).all()


@router.get("/{photo_id}/file")
def get_file(photo_id: int, db: Session = Depends(get_db)):
    photo = db.get(Photo, photo_id)
    if not photo:
        raise HTTPException(404, "Photo not found")
    path = storage.path(photo.file_path)
    if not path.exists():
        raise HTTPException(404, "File missing")
    return FileResponse(path)
