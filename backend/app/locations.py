from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2 import WKTElement
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Location

router = APIRouter(prefix="/locations", tags=["locations"])


class LocationIn(BaseModel):
    name: str
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class LocationOut(LocationIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


@router.get("", response_model=list[LocationOut])
def list_locations(db: Session = Depends(get_db)):
    return db.scalars(select(Location).order_by(Location.name)).all()


@router.get("/{location_id}", response_model=LocationOut)
def get_location(location_id: int, db: Session = Depends(get_db)):
    location = db.get(Location, location_id)
    if not location:
        raise HTTPException(404, "Location not found")
    return location


@router.post("", response_model=LocationOut, status_code=201)
def create_location(data: LocationIn, db: Session = Depends(get_db)):
    location = Location(name=data.name, point=WKTElement(f"POINT({data.lon} {data.lat})", srid=4326))
    db.add(location)
    db.commit()
    db.refresh(location)
    return location
