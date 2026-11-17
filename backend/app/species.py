from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError

from app.db import DB
from app.models import Species

router = APIRouter(prefix="/species", tags=["species"])


class SpeciesFields(BaseModel):
    scientific_name: str
    name_en: str | None = None
    name_pt: str | None = None
    family: str | None = None
    order_name: str | None = None
    ebird_code: str | None = None
    taxon_order: float | None = None


class SpeciesIn(SpeciesFields):
    """A new species: the scientific name, and a common name in English, Portuguese or both. Surrounding spaces
    are dropped and blank names count as missing."""

    @field_validator("scientific_name")
    @classmethod
    def _scientific(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("The scientific name is required")
        return value.strip()

    @field_validator("name_en", "name_pt", "family", "order_name", "ebird_code", mode="before")
    @classmethod
    def _strip(cls, value):
        return (value.strip() or None) if isinstance(value, str) else value

    @model_validator(mode="after")
    def _named(self):
        if not (self.name_en or self.name_pt):
            raise ValueError("Give the English name, the Portuguese name or both")
        return self


class SpeciesOut(SpeciesFields):
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


EXISTS = "Species with this scientific name or eBird code already exists"


@router.post(
    "",
    response_model=SpeciesOut,
    status_code=201,
    responses={409: {"description": "Exists already; `species_id` is it, unless it is in the trash"}},
)
def create_species(data: SpeciesIn, db: DB):
    """Add a species. The scientific name is unique regardless of case, so "ardea cinerea" finds Ardea cinerea."""
    clash = or_(func.lower(Species.scientific_name) == data.scientific_name.lower())
    if data.ebird_code:
        clash = or_(clash, Species.ebird_code == data.ebird_code)
    existing = db.scalar(select(Species).where(clash))
    if existing is None:
        species = Species(**data.model_dump())
        db.add(species)
        try:
            db.commit()
        except IntegrityError:  # created by someone else in the meantime
            db.rollback()
            existing = db.scalar(select(Species).where(clash))
        else:
            db.refresh(species)
            return species
    if existing is None or existing.deleted_at is not None:
        raise HTTPException(409, EXISTS)
    return JSONResponse({"detail": EXISTS, "species_id": existing.id}, status_code=409)


@router.delete("/{species_id}", status_code=204)
def delete_species(species_id: int, db: DB):
    """Move the species to the trash. Photos keep their link and show it again if the species is restored."""
    species = db.get(Species, species_id)
    if not species or species.deleted_at:
        raise HTTPException(404, "Species not found")
    species.deleted_at = datetime.now(UTC)
    db.commit()
