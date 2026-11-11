"""session version, to end every session of an account at once

Revision ID: 0012
Revises: 0011
"""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("session_version", sa.Integer, nullable=False, server_default="0"))


def downgrade():
    op.drop_column("users", "session_version")
