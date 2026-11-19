"""Immutable image blobs and version-owned references."""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "asset_blobs",
        sa.Column("sha256", sa.String(), primary_key=True),
        sa.Column("media_type", sa.String(), nullable=False),
        sa.Column("byte_size", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.CheckConstraint("byte_size > 0 AND byte_size <= 5242880 AND width > 0 AND height > 0"),
    )
    op.create_table(
        "assets",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "study_version_id", sa.String(), sa.ForeignKey("study_versions.id"), nullable=False
        ),
        sa.Column("sha256", sa.String(), sa.ForeignKey("asset_blobs.sha256"), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("alt_text", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_index("ix_assets_study_version_id", "assets", ["study_version_id"])
    if op.get_bind().dialect.name == "sqlite":
        for table in ("asset_blobs", "assets"):
            for action in ("UPDATE", "DELETE"):
                op.execute(
                    f"CREATE TRIGGER retain_{table}_{action.lower()} BEFORE {action} "
                    f"ON {table} BEGIN SELECT RAISE(ABORT, 'Asset history is immutable'); END"
                )
        op.execute("""CREATE TRIGGER asset_draft_guard BEFORE INSERT ON assets
            WHEN NOT EXISTS (SELECT 1 FROM study_versions WHERE id=NEW.study_version_id
                AND published_at IS NULL)
            BEGIN SELECT RAISE(ABORT, 'Published assets are immutable'); END""")


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM assets")):
        raise RuntimeError("Asset history cannot be discarded by downgrade")
    op.drop_table("assets")
    op.drop_table("asset_blobs")
