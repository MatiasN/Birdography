from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.db import DB
from app.models import Species

router = APIRouter(prefix="/species", tags=["species"])


class SpeciesIn(BaseModel):
    scientific_name: str
    name_en: str | None = None
    name_pt: str | None = None
    family: str | None = None
    order_name: str | None = None
    ebird_code: str | None = None
    taxon_order: float | None = None


class SpeciesOut(SpeciesIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


def _normalize(value):
    """Case- and accent-insensitive form, so 'garca' matches 'Garça-real'."""
    return func.unaccent(func.lower(value))


@router.get("", response_model=list[SpeciesOut])
def list_species(
    db: DB,
    q: str | None = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    query = select(Species).where(Species.deleted_at.is_(None)).order_by(Species.scientific_name)
    if q:
        like = _normalize(f"%{q}%")
        query = query.where(
            or_(
                _normalize(Species.scientific_name).like(like),
                _normalize(Species.name_en).like(like),
                _normalize(Species.name_pt).like(like),
            )
        )
    return db.scalars(query.limit(limit).offset(offset)).all()


@router.get("/{species_id}", response_model=SpeciesOut)
def get_species(species_id: int, db: DB):
    species = db.get(Species, species_id)
    if not species or species.deleted_at:
        raise HTTPException(404, "Species not found")
    return species


@router.post("", response_model=SpeciesOut, status_code=201)
def create_species(data: SpeciesIn, db: DB):
    species = Species(**data.model_dump())
    db.add(species)
    try:
        db.commit()
    except IntegrityError:
        raise HTTPException(409, "Species with this scientific name or eBird code already exists") from None
    db.refresh(species)
    return species


@router.delete("/{species_id}", status_code=204)
def delete_species(species_id: int, db: DB):
    """Move the species to the trash. Photos keep their link and show it again if the species is restored."""
    species = db.get(Species, species_id)
    if not species or species.deleted_at:
        raise HTTPException(404, "Species not found")
    species.deleted_at = datetime.now(UTC)
    db.commit()
