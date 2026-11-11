from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from geoalchemy2 import WKTElement
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.db import DB
from app.models import Location, User

router = APIRouter(prefix="/locations", tags=["locations"])


class LocationIn(BaseModel):
    name: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class LocationOut(LocationIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


@router.get("", response_model=list[LocationOut])
def list_locations(db: DB, user: CurrentUser):
    query = select(Location).where(Location.owner_id == user.id, Location.deleted_at.is_(None))
    return db.scalars(query.order_by(Location.name)).all()


@router.get("/{location_id}", response_model=LocationOut)
def get_location(location_id: int, db: DB, user: CurrentUser):
    return _get(db, user, location_id)


@router.post("", response_model=LocationOut, status_code=201)
def create_location(data: LocationIn, db: DB, user: CurrentUser):
    location = Location(owner_id=user.id, name=data.name, point=WKTElement(f"POINT({data.lon} {data.lat})", srid=4326))
    db.add(location)
    db.commit()
    db.refresh(location)
    return location


@router.delete("/{location_id}", status_code=204)
def delete_location(location_id: int, db: DB, user: CurrentUser):
    """Move the location to the trash. Its photos appear unlinked until it is restored or purged."""
    location = _get(db, user, location_id)
    location.deleted_at = datetime.now(UTC)
    db.commit()


def _get(db: Session, user: User, location_id: int) -> Location:
    location = db.get(Location, location_id)
    if not location or location.owner_id != user.id or location.deleted_at:
        raise HTTPException(404, "Location not found")
    return location
