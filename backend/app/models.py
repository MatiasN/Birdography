from datetime import datetime

from geoalchemy2 import Geography, WKBElement
from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Species(Base):
    __tablename__ = "species"

    id: Mapped[int] = mapped_column(primary_key=True)
    scientific_name: Mapped[str] = mapped_column(String(200), unique=True)
    name_en: Mapped[str | None] = mapped_column(String(200))
    name_pt: Mapped[str | None] = mapped_column(String(200))
    family: Mapped[str | None] = mapped_column(String(200))


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    point: Mapped[WKBElement] = mapped_column(Geography("POINT", srid=4326))


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[int] = mapped_column(primary_key=True)
    file_path: Mapped[str] = mapped_column(String(500), unique=True)
    taken_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    camera: Mapped[str | None] = mapped_column(String(200))
    lens: Mapped[str | None] = mapped_column(String(200))
    exif: Mapped[dict | None] = mapped_column(JSONB)
    point: Mapped[WKBElement | None] = mapped_column(Geography("POINT", srid=4326))
    species_id: Mapped[int | None] = mapped_column(ForeignKey("species.id"), index=True)
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), index=True)

    species: Mapped[Species | None] = relationship()
    location: Mapped[Location | None] = relationship()
