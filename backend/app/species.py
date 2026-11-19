from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from sqlalchemy import delete, exists, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import CurrentUser
from app.db import DB, visible, visible_or_404
from app.models import Photo, PhotoSpecies, Species, User

router = APIRouter(prefix="/species", tags=["species"])
NOT_FOUND = "Species not found"


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
    """Case-, accent- and hyphen-insensitive form, so 'garca real' matches 'Garça-real'."""
    return func.unaccent(func.lower(func.replace(value, "-", " ")))


def _photographed_by(user: User):
    """Whether the user has a photo (not in the trash) showing the species."""
    return exists().where(
        PhotoSpecies.species_id == Species.id,
        PhotoSpecies.photo_id == Photo.id,
        Photo.owner_id == user.id,
        Photo.deleted_at.is_(None),
    )


@router.get("", response_model=list[SpeciesOut])
def list_species(
    db: DB,
    user: CurrentUser,
    q: str | None = None,
    photographed: bool = False,
    limit: int = Query(50, le=200),
    offset: int = 0,
):
    """Species in taxonomic order. With `q`, those with a name containing it (any of the three names, ignoring
    case, accents and hyphens), ranked: species you have photographed first, then names starting with it (or with
    a word starting with it), then taxonomic order. `photographed` keeps only species you have photographed."""
    mine = _photographed_by(user)
    query = select(Species).where(Species.deleted_at.is_(None))
    if photographed:
        query = query.where(mine)
    order = [Species.taxon_order.asc().nulls_last(), Species.scientific_name]
    if q and q.strip():
        text = q.strip().replace("%", r"\%").replace("_", r"\_")
        names = [_normalize(Species.scientific_name), _normalize(Species.name_en), _normalize(Species.name_pt)]
        query = query.where(or_(*(name.like(_normalize(f"%{text}%")) for name in names)))
        starts = or_(
            *(name.like(_normalize(f"{text}%")) for name in names),
            *(name.like(_normalize(f"% {text}%")) for name in names),
        )
        order = [mine.desc(), starts.desc(), *order]
    return db.scalars(query.order_by(*order).limit(limit).offset(offset)).all()


@router.get("/{species_id}", response_model=SpeciesOut)
def get_species(species_id: int, db: DB):
    return visible_or_404(db, Species, species_id, NOT_FOUND)


EXISTS = "Species with this scientific name or eBird code already exists"


@router.post(
    "",
    response_model=SpeciesOut,
    status_code=201,
    responses={409: {"description": "Exists already; `species_id` is it, unless it is in the trash"}},
)
def create_species(data: SpeciesIn, db: DB):
    """Add a species. The scientific name is unique regardless of case, so "ardea cinerea" finds Ardea cinerea."""
    clash = func.lower(Species.scientific_name) == data.scientific_name.lower()
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


@router.post("/{species_id}/merge-into/{target_id}", response_model=SpeciesOut)
def merge_species(species_id: int, target_id: int, db: DB):
    """You found out which species a hand-added one is: its photos move to `target` and it goes to the trash."""
    try:
        return merge(db, species_id, target_id)[0]
    except LookupError as err:
        raise HTTPException(404, str(err)) from None
    except ValueError as err:
        raise HTTPException(400, str(err)) from None


def merge(db: Session, source_id: int, target_id: int) -> tuple[Species, Species, int]:
    """Move every photo of the hand-added species `source_id` to `target_id` (keeping its place among the photo's
    species; a photo that has both keeps the target once), then trash the source. Returns the target, the source
    and how many photos moved. Affects every account's photos, since species are shared. Raises `LookupError` when
    either species is missing or in the trash, `ValueError` when the source can't be merged into the target."""
    source, target = visible(db, Species, source_id), visible(db, Species, target_id)
    if source is None or target is None:
        raise LookupError(NOT_FOUND)
    if source.id == target.id:
        raise ValueError("A species cannot be merged into itself")
    if source.ebird_code:
        raise ValueError("Only a species added by hand (without an eBird code) can be merged into another")
    has_target = select(PhotoSpecies.photo_id).where(PhotoSpecies.species_id == target.id)
    moved = db.execute(
        update(PhotoSpecies)
        .where(PhotoSpecies.species_id == source.id, PhotoSpecies.photo_id.not_in(has_target))
        .values(species_id=target.id)
    ).rowcount
    db.execute(delete(PhotoSpecies).where(PhotoSpecies.species_id == source.id))
    source.deleted_at = datetime.now(UTC)
    db.commit()
    db.expire_all()
    return target, source, moved


@router.delete("/{species_id}", status_code=204)
def delete_species(species_id: int, db: DB):
    """Move the species to the trash. Photos keep their link and show it again if the species is restored."""
    species = visible_or_404(db, Species, species_id, NOT_FOUND)
    species.deleted_at = datetime.now(UTC)
    db.commit()
