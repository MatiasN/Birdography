from datetime import datetime

from geoalchemy2 import Geography, Geometry, WKBElement
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    MetaData,
    SmallInteger,
    String,
    UniqueConstraint,
    cast,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, column_property, mapped_column, relationship

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

FILE_KINDS = ("original", "preview", "thumbnail")


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Species(Base):
    __tablename__ = "species"

    id: Mapped[int] = mapped_column(primary_key=True)
    scientific_name: Mapped[str] = mapped_column(String(200), unique=True)
    name_en: Mapped[str | None] = mapped_column(String(200))
    name_pt: Mapped[str | None] = mapped_column(String(200))
    family: Mapped[str | None] = mapped_column(String(200))


class Location(Base):
    __tablename__ = "locations"
    __table_args__ = (Index("ix_locations_point", "point", postgresql_using="gist"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    point: Mapped[WKBElement] = mapped_column(Geography("POINT", srid=4326, spatial_index=False))
    lat: Mapped[float] = column_property(func.ST_Y(cast(point, Geometry(srid=4326))))
    lon: Mapped[float] = column_property(func.ST_X(cast(point, Geometry(srid=4326))))


class Photo(Base):
    __tablename__ = "photos"
    __table_args__ = (Index("ix_photos_point", "point", postgresql_using="gist"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    taken_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    camera: Mapped[str | None] = mapped_column(String(200))
    lens: Mapped[str | None] = mapped_column(String(200))
    exif: Mapped[dict | None] = mapped_column(JSONB)
    point: Mapped[WKBElement | None] = mapped_column(Geography("POINT", srid=4326, spatial_index=False))
    lat: Mapped[float | None] = column_property(func.ST_Y(cast(point, Geometry(srid=4326))))
    lon: Mapped[float | None] = column_property(func.ST_X(cast(point, Geometry(srid=4326))))
    location_id: Mapped[int | None] = mapped_column(ForeignKey("locations.id"), index=True)

    location: Mapped[Location | None] = relationship()
    files: Mapped[list[PhotoFile]] = relationship(
        back_populates="photo", cascade="all, delete-orphan", lazy="selectin", order_by="PhotoFile.kind"
    )
    species_links: Mapped[list[PhotoSpecies]] = relationship(
        cascade="all, delete-orphan", lazy="selectin", order_by="PhotoSpecies.position"
    )

    @property
    def species_ids(self) -> list[int]:
        return [link.species_id for link in self.species_links]

    def file(self, kind: str) -> PhotoFile | None:
        return next((f for f in self.files if f.kind == kind), None)


class PhotoFile(Base):
    __tablename__ = "photo_files"
    __table_args__ = (
        UniqueConstraint("photo_id", "kind", name="uq_photo_files_photo_id_kind"),
        CheckConstraint("kind IN ('original', 'preview', 'thumbnail')", name="kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    photo_id: Mapped[int] = mapped_column(ForeignKey("photos.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(10))
    path: Mapped[str] = mapped_column(String(500), unique=True)
    original_filename: Mapped[str | None] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    format: Mapped[str] = mapped_column(String(10))
    is_raw: Mapped[bool] = mapped_column(Boolean)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    # Unique across all users: the same file cannot be uploaded twice.
    sha256: Mapped[str] = mapped_column(String(64), unique=True)
    width: Mapped[int | None]
    height: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    photo: Mapped[Photo] = relationship(back_populates="files")

    @property
    def url(self) -> str:
        return f"/photos/{self.photo_id}/file?kind={self.kind}"


class PhotoSpecies(Base):
    __tablename__ = "photo_species"

    photo_id: Mapped[int] = mapped_column(ForeignKey("photos.id", ondelete="CASCADE"), primary_key=True)
    species_id: Mapped[int] = mapped_column(ForeignKey("species.id", ondelete="CASCADE"), primary_key=True, index=True)
    position: Mapped[int] = mapped_column(SmallInteger, default=0, server_default="0")

    species: Mapped[Species] = relationship(lazy="joined")
