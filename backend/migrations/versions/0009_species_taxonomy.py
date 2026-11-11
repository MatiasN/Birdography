"""species taxonomy fields and accent-insensitive search

Revision ID: 0009
Revises: 0008
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("species", sa.Column("order_name", sa.String(100)))
    op.add_column("species", sa.Column("ebird_code", sa.String(16)))
    op.add_column("species", sa.Column("taxon_order", sa.Numeric(10, 2)))
    op.create_unique_constraint("uq_species_ebird_code", "species", ["ebird_code"])
    op.create_index("ix_species_taxon_order", "species", ["taxon_order"])
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")


def downgrade():
    op.execute("DROP EXTENSION IF EXISTS unaccent")
    op.drop_index("ix_species_taxon_order", table_name="species")
    op.drop_constraint("uq_species_ebird_code", "species", type_="unique")
    op.drop_column("species", "taxon_order")
    op.drop_column("species", "ebird_code")
    op.drop_column("species", "order_name")
