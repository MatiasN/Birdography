from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from geoalchemy2 import WKTElement
from pydantic import BaseModel, ConfigDict
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
