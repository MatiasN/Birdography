"""photo files

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

# Existing photos become 'original' files. Hash and size are placeholders until
# `python -m app.cli backfill-files` computes them from the files on disk.
COPY_FILES = r"""
WITH ext AS (
    SELECT id, file_path, uploaded_at, coalesce(lower(substring(file_path from '\.([^.]+)$')), '') AS format
    FROM photos
)
INSERT INTO photo_files (photo_id, kind, path, mime_type, format, is_raw, size_bytes, sha256, created_at)
SELECT id, 'original', file_path,
       CASE format
           WHEN 'jpg' THEN 'image/jpeg'
           WHEN 'jpeg' THEN 'image/jpeg'
           WHEN 'png' THEN 'image/png'
           WHEN 'tif' THEN 'image/tiff'
           WHEN 'tiff' THEN 'image/tiff'
           ELSE 'application/octet-stream'
       END,
       format,
       format IN ('dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'orf', 'rw2', 'raf', 'pef'),
       0,
       'pending:' || id,
       uploaded_at
FROM ext
"""


def upgrade():
    op.create_table(
        "photo_files",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("photo_id", sa.Integer, nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("path", sa.String(500), nullable=False),
        sa.Column("original_filename", sa.String(255)),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("format", sa.String(10), nullable=False),
        sa.Column("is_raw", sa.Boolean, nullable=False),
        sa.Column("size_bytes", sa.BigInteger, nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("width", sa.Integer),
        sa.Column("height", sa.Integer),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id", name="pk_photo_files"),
        sa.ForeignKeyConstraint(["photo_id"], ["photos.id"], name="fk_photo_files_photo_id_photos", ondelete="CASCADE"),
        sa.UniqueConstraint("photo_id", "kind", name="uq_photo_files_photo_id_kind"),
        sa.UniqueConstraint("path", name="uq_photo_files_path"),
        sa.UniqueConstraint("sha256", name="uq_photo_files_sha256"),
        sa.CheckConstraint("kind IN ('original', 'preview', 'thumbnail')", name=op.f("ck_photo_files_kind")),
    )
    op.create_index("ix_photo_files_photo_id", "photo_files", ["photo_id"])
    op.execute(COPY_FILES)
    op.drop_column("photos", "file_path")


def downgrade():
    op.add_column("photos", sa.Column("file_path", sa.String(500)))
    op.execute(
        "UPDATE photos SET file_path = f.path FROM photo_files f WHERE f.photo_id = photos.id AND f.kind = 'original'"
    )
    op.alter_column("photos", "file_path", nullable=False)
    op.create_unique_constraint("uq_photos_file_path", "photos", ["file_path"])
    op.drop_table("photo_files")
