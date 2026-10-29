"""photos

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "photos",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("file_path", sa.String(500), nullable=False, unique=True),
        sa.Column("taken_at", sa.DateTime(timezone=True)),
        sa.Column("uploaded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("camera", sa.String(200)),
        sa.Column("lens", sa.String(200)),
        sa.Column("exif", JSONB),
        sa.Column("point", Geography("POINT", srid=4326, spatial_index=False)),
        sa.Column("species_id", sa.Integer, sa.ForeignKey("species.id")),
        sa.Column("location_id", sa.Integer, sa.ForeignKey("locations.id")),
    )
    op.create_index("ix_photos_taken_at", "photos", ["taken_at"])
    op.create_index("ix_photos_species_id", "photos", ["species_id"])
    op.create_index("ix_photos_location_id", "photos", ["location_id"])
    op.create_index("idx_photos_point", "photos", ["point"], postgresql_using="gist")


def downgrade():
    op.drop_table("photos")
