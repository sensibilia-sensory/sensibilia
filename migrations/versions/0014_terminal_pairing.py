"""One-time terminal pairing codes and the terminal-to-booth link."""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "terminal_pairings",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("code_hash", sa.String(), nullable=False, unique=True),
        sa.Column("staff_name", sa.String(), nullable=False),
        sa.Column("principal", sa.String(), nullable=False),
        sa.Column("booth_id", sa.String(), sa.ForeignKey("booths.id")),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("expires_at", sa.String(), nullable=False),
        sa.Column("redeemed_at", sa.String()),
        sa.Column("terminal_id", sa.String(), sa.ForeignKey("terminals.id")),
    )
    # No FK: SQLite cannot add one in place, and rebuilding terminals would touch its history.
    op.add_column("terminals", sa.Column("booth_id", sa.String()))
    op.create_index(
        "uq_terminal_active_booth",
        "terminals",
        ["booth_id"],
        unique=True,
        sqlite_where=sa.text("retired_at IS NULL AND booth_id IS NOT NULL"),
    )


def downgrade():
    op.drop_index("uq_terminal_active_booth", table_name="terminals")
    with op.batch_alter_table("terminals") as batch:
        batch.drop_column("booth_id")
    op.drop_table("terminal_pairings")
