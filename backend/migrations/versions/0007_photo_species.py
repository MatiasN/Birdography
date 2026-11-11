"""several species per photo

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "photo_species",
        sa.Column("photo_id", sa.Integer, nullable=False),
        sa.Column("species_id", sa.Integer, nullable=False),
        sa.Column("position", sa.SmallInteger, nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("photo_id", "species_id", name="pk_photo_species"),
        sa.ForeignKeyConstraint(
            ["photo_id"], ["photos.id"], name="fk_photo_species_photo_id_photos", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["species_id"], ["species.id"], name="fk_photo_species_species_id_species", ondelete="CASCADE"
        ),
    )
    op.create_index("ix_photo_species_species_id", "photo_species", ["species_id"])
    op.execute(
        "INSERT INTO photo_species (photo_id, species_id, position) "
        "SELECT id, species_id, 0 FROM photos WHERE species_id IS NOT NULL"
    )
    op.drop_index("ix_photos_species_id", table_name="photos")
    op.drop_column("photos", "species_id")


def downgrade():
    op.add_column("photos", sa.Column("species_id", sa.Integer))
    op.create_foreign_key("fk_photos_species_id_species", "photos", "species", ["species_id"], ["id"])
    op.create_index("ix_photos_species_id", "photos", ["species_id"])
    # Keep the first species of each photo; the others cannot be represented.
    op.execute(
        "UPDATE photos SET species_id = ps.species_id FROM ("
        "  SELECT DISTINCT ON (photo_id) photo_id, species_id FROM photo_species"
        "  ORDER BY photo_id, position, species_id"
        ") ps WHERE ps.photo_id = photos.id"
    )
    op.drop_table("photo_species")
