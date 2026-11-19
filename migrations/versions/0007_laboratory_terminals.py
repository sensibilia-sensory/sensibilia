"""Dedicated terminals, assignment history and staff audit."""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "terminals",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False, unique=True),
        sa.Column("token_hash", sa.String(), nullable=False, unique=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("registered_at", sa.String(), nullable=False),
        sa.Column("retired_at", sa.String(), nullable=True),
    )
    op.create_table(
        "terminal_assignments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("terminal_id", sa.String(), sa.ForeignKey("terminals.id"), nullable=False),
        sa.Column(
            "session_id", sa.String(), sa.ForeignKey("sessions.id"), nullable=False, unique=True
        ),
        sa.Column("assigned_at", sa.String(), nullable=False),
        sa.Column("released_at", sa.String(), nullable=True),
    )
    op.create_index("ix_terminal_assignments_terminal_id", "terminal_assignments", ["terminal_id"])
    op.create_index(
        "uq_terminal_current_assignment",
        "terminal_assignments",
        ["terminal_id"],
        unique=True,
        sqlite_where=sa.text("released_at IS NULL"),
    )
    op.create_table(
        "terminal_audit",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("terminal_id", sa.String(), sa.ForeignKey("terminals.id"), nullable=False),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id"), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("staff_name", sa.String(), nullable=False),
        sa.Column("principal", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("recorded_at", sa.String(), nullable=False),
    )
    op.create_index("ix_terminal_audit_terminal_id", "terminal_audit", ["terminal_id"])
    if op.get_bind().dialect.name == "sqlite":
        for operation in ("UPDATE", "DELETE"):
            op.execute(f"""CREATE TRIGGER immutable_terminal_audit_{operation.lower()}
                BEFORE {operation} ON terminal_audit
                BEGIN SELECT RAISE(ABORT, 'Terminal audit is append-only'); END""")
        op.execute("""CREATE TRIGGER terminal_assignment_identity
            BEFORE UPDATE ON terminal_assignments
            WHEN NEW.id != OLD.id OR NEW.terminal_id != OLD.terminal_id
            OR NEW.session_id != OLD.session_id OR NEW.assigned_at != OLD.assigned_at
            OR OLD.released_at IS NOT NULL
            BEGIN SELECT RAISE(ABORT, 'Assignment history is immutable'); END""")
        op.execute("""CREATE TRIGGER terminal_assignment_delete
            BEFORE DELETE ON terminal_assignments
            BEGIN SELECT RAISE(ABORT, 'Assignment history is retained'); END""")


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM terminals")):
        raise RuntimeError("Cannot discard terminal history; restore an explicit backup")
    op.drop_table("terminal_audit")
    op.drop_table("terminal_assignments")
    op.drop_table("terminals")
