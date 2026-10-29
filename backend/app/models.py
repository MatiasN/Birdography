from geoalchemy2 import Geography, WKBElement
from sqlalchemy import String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


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
