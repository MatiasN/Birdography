from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Species

router = APIRouter(prefix="/species", tags=["species"])


class SpeciesIn(BaseModel):
    scientific_name: str
    name_en: str | None = None
    name_pt: str | None = None
    family: str | None = None


class SpeciesOut(SpeciesIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


@router.get("", response_model=list[SpeciesOut])
def list_species(
    q: str | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
):
    query = select(Species).order_by(Species.scientific_name)
    if q:
        like = f"%{q}%"
        query = query.where(
            or_(Species.scientific_name.ilike(like), Species.name_en.ilike(like), Species.name_pt.ilike(like))
        )
    return db.scalars(query.limit(limit).offset(offset)).all()


@router.get("/{species_id}", response_model=SpeciesOut)
def get_species(species_id: int, db: Session = Depends(get_db)):
    species = db.get(Species, species_id)
    if not species:
        raise HTTPException(404, "Species not found")
    return species


@router.post("", response_model=SpeciesOut, status_code=201)
def create_species(data: SpeciesIn, db: Session = Depends(get_db)):
    species = Species(**data.model_dump())
    db.add(species)
    try:
        db.commit()
    except IntegrityError:
        raise HTTPException(409, "Species already exists")
    db.refresh(species)
    return species
