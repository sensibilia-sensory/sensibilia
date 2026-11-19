"""Reviewed publication templates and append-only draft audit."""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "study_templates",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "source_version_id", sa.String(), sa.ForeignKey("study_versions.id"), nullable=False
        ),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("review_notes", sa.String(), nullable=False),
        sa.Column("principal", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_index(
        "ix_study_templates_source_version_id", "study_templates", ["source_version_id"]
    )
    op.create_table(
        "draft_audit",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "study_version_id", sa.String(), sa.ForeignKey("study_versions.id"), nullable=False
        ),
        sa.Column("principal", sa.String(), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("revision_hash", sa.String(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("recorded_at", sa.String(), nullable=False),
    )
    op.create_index("ix_draft_audit_study_version_id", "draft_audit", ["study_version_id"])
    if op.get_bind().dialect.name == "sqlite":
        for table in ("study_templates", "draft_audit"):
            for operation in ("UPDATE", "DELETE"):
                op.execute(
                    f"""CREATE TRIGGER immutable_{table}_{operation.lower()}
                    BEFORE {operation} ON {table}
                    BEGIN SELECT RAISE(ABORT, 'Draft history and templates are retained'); END"""
                )


def downgrade():
    for table in ("draft_audit", "study_templates"):
        if op.get_bind().scalar(sa.text(f"SELECT count(*) FROM {table}")):
            raise RuntimeError("Cannot discard draft/template history; restore an explicit backup")
    op.drop_table("draft_audit")
    op.drop_table("study_templates")
