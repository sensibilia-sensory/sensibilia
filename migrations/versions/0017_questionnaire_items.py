"""Reusable questionnaire items: a bank of steps copied into drafts, never linked."""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "questionnaire_items",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("languages", sa.JSON(), nullable=False),
        sa.Column("default_language", sa.String(), nullable=False),
        sa.Column("text_version", sa.Integer(), nullable=True),
        sa.Column("node", sa.JSON(), nullable=False),
        sa.Column("principal", sa.String(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("archived_at", sa.String(), nullable=True),
    )


def downgrade():
    op.drop_table("questionnaire_items")
