"""users and ownership

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    for table in ("photos", "locations"):
        op.add_column(table, sa.Column("owner_id", sa.Integer, sa.ForeignKey("users.id"), nullable=False))
        op.create_index(f"ix_{table}_owner_id", table, ["owner_id"])


def downgrade():
    for table in ("photos", "locations"):
        op.drop_column(table, "owner_id")
    op.drop_table("users")
