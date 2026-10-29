"""species and locations

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geography

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "species",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("scientific_name", sa.String(200), nullable=False, unique=True),
        sa.Column("name_en", sa.String(200)),
        sa.Column("name_pt", sa.String(200)),
        sa.Column("family", sa.String(200)),
    )
    op.create_table(
        "locations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("point", Geography("POINT", srid=4326, spatial_index=False), nullable=False),
    )
    op.create_index("idx_locations_point", "locations", ["point"], postgresql_using="gist")


def downgrade():
    op.drop_table("locations")
    op.drop_table("species")
