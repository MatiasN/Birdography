"""initial schema

Revision ID: 0001
Revises:

The whole schema as of plan 0010: the earlier migrations were squashed into this one before the first release, as
no database built by them existed outside development. Generated from the models with `alembic revision
--autogenerate`, plus the two extensions the app needs: PostGIS for positions and unaccent for species search.
"""

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.create_table(
        "species",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("scientific_name", sa.String(length=200), nullable=False),
        sa.Column("name_en", sa.String(length=200), nullable=True),
        sa.Column("name_pt", sa.String(length=200), nullable=True),
        sa.Column("family", sa.String(length=200), nullable=True),
        sa.Column("order_name", sa.String(length=100), nullable=True),
        sa.Column("ebird_code", sa.String(length=16), nullable=True),
        sa.Column("taxon_order", sa.Numeric(precision=10, scale=2), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_species")),
        sa.UniqueConstraint("ebird_code", name=op.f("uq_species_ebird_code")),
        sa.UniqueConstraint("scientific_name", name=op.f("uq_species_scientific_name")),
    )
    op.create_index(op.f("ix_species_taxon_order"), "species", ["taxon_order"], unique=False)
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=200), nullable=False),
        sa.Column("session_version", sa.Integer(), server_default="0", nullable=False),
        sa.Column("species_name_language", sa.String(length=3), server_default="en", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("species_name_language IN ('en', 'pt', 'sci')", name=op.f("ck_users_species_name_language")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_table(
        "locations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "point",
            Geography(
                geometry_type="POINT",
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeogFromText",
                name="geography",
                nullable=False,
            ),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["owner_id"], ["users.id"], name=op.f("fk_locations_owner_id_users"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_locations")),
    )
    op.create_index(op.f("ix_locations_owner_id"), "locations", ["owner_id"], unique=False)
    op.create_index("ix_locations_point", "locations", ["point"], unique=False, postgresql_using="gist")
    op.create_table(
        "photos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("taken_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("taken_at_local", sa.DateTime(), nullable=True),
        sa.Column("taken_offset_minutes", sa.SmallInteger(), nullable=True),
        sa.Column("taken_at_manual", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("camera", sa.String(length=200), nullable=True),
        sa.Column("camera_make", sa.String(length=100), nullable=True),
        sa.Column("camera_model", sa.String(length=200), nullable=True),
        sa.Column("lens", sa.String(length=200), nullable=True),
        sa.Column("iso", sa.Integer(), nullable=True),
        sa.Column("shutter_seconds", sa.Numeric(precision=10, scale=6), nullable=True),
        sa.Column("aperture", sa.Numeric(precision=4, scale=1), nullable=True),
        sa.Column("focal_length_mm", sa.Numeric(precision=6, scale=1), nullable=True),
        sa.Column("exif", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "point",
            Geography(
                geometry_type="POINT",
                srid=4326,
                dimension=2,
                spatial_index=False,
                from_text="ST_GeogFromText",
                name="geography",
            ),
            nullable=True,
        ),
        sa.Column("point_manual", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("location_id", sa.Integer(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["location_id"], ["locations.id"], name=op.f("fk_photos_location_id_locations"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], name=op.f("fk_photos_owner_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_photos")),
    )
    op.create_index(op.f("ix_photos_deleted_at"), "photos", ["deleted_at"], unique=False)
    op.create_index(op.f("ix_photos_location_id"), "photos", ["location_id"], unique=False)
    op.create_index(op.f("ix_photos_owner_id"), "photos", ["owner_id"], unique=False)
    op.create_index("ix_photos_point", "photos", ["point"], unique=False, postgresql_using="gist")
    op.create_index(op.f("ix_photos_taken_at"), "photos", ["taken_at"], unique=False)
    op.create_table(
        "photo_files",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("photo_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("path", sa.String(length=500), nullable=False),
        sa.Column("original_filename", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("format", sa.String(length=10), nullable=False),
        sa.Column("is_raw", sa.Boolean(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("kind IN ('original', 'preview', 'thumbnail')", name=op.f("ck_photo_files_kind")),
        sa.ForeignKeyConstraint(
            ["photo_id"], ["photos.id"], name=op.f("fk_photo_files_photo_id_photos"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_photo_files")),
        sa.UniqueConstraint("path", name=op.f("uq_photo_files_path")),
        sa.UniqueConstraint("photo_id", "kind", name="uq_photo_files_photo_id_kind"),
    )
    op.create_index(op.f("ix_photo_files_photo_id"), "photo_files", ["photo_id"], unique=False)
    op.create_index(
        "ix_photo_files_sha256_original",
        "photo_files",
        ["sha256"],
        unique=True,
        postgresql_where=sa.text("kind = 'original'"),
    )
    op.create_table(
        "photo_species",
        sa.Column("photo_id", sa.Integer(), nullable=False),
        sa.Column("species_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.SmallInteger(), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(
            ["photo_id"], ["photos.id"], name=op.f("fk_photo_species_photo_id_photos"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["species_id"], ["species.id"], name=op.f("fk_photo_species_species_id_species"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("photo_id", "species_id", name=op.f("pk_photo_species")),
    )
    op.create_index(op.f("ix_photo_species_species_id"), "photo_species", ["species_id"], unique=False)


def downgrade():
    for table in ("photo_species", "photo_files", "photos", "locations", "users", "species"):
        op.drop_table(table)  # with their indexes and constraints
    op.execute("DROP EXTENSION IF EXISTS unaccent")
    op.execute("DROP EXTENSION IF EXISTS postgis")
