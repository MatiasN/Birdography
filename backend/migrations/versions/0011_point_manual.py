"""photo position set by the user

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("photos", sa.Column("point_manual", sa.Boolean, nullable=False, server_default="false"))


def downgrade():
    op.drop_column("photos", "point_manual")
