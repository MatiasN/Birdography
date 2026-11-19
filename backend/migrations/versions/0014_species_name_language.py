"""each user's main species name language

Revision ID: 0014
Revises: 0013
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("species_name_language", sa.String(3), server_default="en", nullable=False))
    op.create_check_constraint("species_name_language", "users", "species_name_language IN ('en', 'pt', 'sci')")


def downgrade():
    op.drop_constraint("species_name_language", "users", type_="check")
    op.drop_column("users", "species_name_language")
