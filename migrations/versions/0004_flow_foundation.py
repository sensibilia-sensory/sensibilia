"""Flow v2 foundation: draft revisions and frozen session context.

Existing publications, values and event tables are not rewritten.
Execution/event-history extensions belong to the later collection slices.
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "study_versions", sa.Column("revision", sa.Integer(), nullable=False, server_default="0")
    )
    op.add_column("sessions", sa.Column("context", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column(
        "sessions", sa.Column("loop_assignments", sa.JSON(), nullable=False, server_default="[]")
    )
    if op.get_bind().dialect.name == "sqlite":
        op.execute("""CREATE TRIGGER sessions_context_guard
            BEFORE UPDATE OF context, loop_assignments ON sessions
            BEGIN SELECT RAISE(ABORT, 'Session context is immutable'); END""")
        for operation, ref in (("INSERT", "NEW"), ("UPDATE", "NEW"), ("DELETE", "OLD")):
            op.execute(f"""CREATE TRIGGER tests_revision_{operation.lower()} AFTER {operation}
                ON study_tests BEGIN UPDATE study_versions SET revision=revision+1
                WHERE id={ref}.study_version_id AND published_at IS NULL; END""")


def downgrade():
    if op.get_bind().dialect.name == "sqlite":
        op.execute("DROP TRIGGER sessions_context_guard")
        for operation in ("insert", "update", "delete"):
            op.execute(f"DROP TRIGGER tests_revision_{operation}")
    op.drop_column("sessions", "loop_assignments")
    op.drop_column("sessions", "context")
    op.drop_column("study_versions", "revision")
