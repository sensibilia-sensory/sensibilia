"""Method library, immutable coded samples and frozen per-session serving plans."""

import json
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "samples",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "study_version_id", sa.String(), sa.ForeignKey("study_versions.id"), nullable=False
        ),
        sa.Column("code", sa.String(), nullable=False),
        sa.Column("label", sa.String(), nullable=False),
        sa.UniqueConstraint("study_version_id", "code"),
    )
    op.create_index("ix_samples_study_version_id", "samples", ["study_version_id"])
    op.create_table(
        "session_test_assignments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("study_test_id", sa.String(), sa.ForeignKey("study_tests.id"), nullable=False),
        sa.Column("plan", sa.JSON(), nullable=False),
        sa.UniqueConstraint("session_id", "study_test_id"),
    )
    op.create_index(
        "ix_session_test_assignments_session_id", "session_test_assignments", ["session_id"]
    )
    op.create_index(
        "ix_session_test_assignments_study_test_id", "session_test_assignments", ["study_test_id"]
    )
    rows = json.loads(Path(__file__).with_name("methods_v1.json").read_text(encoding="utf-8"))
    table = sa.table(
        "test_types",
        sa.column("id", sa.String()),
        sa.column("key", sa.String()),
        sa.column("name", sa.String()),
        sa.column("schema_version", sa.Integer()),
        sa.column("configuration_schema", sa.JSON()),
        sa.column("method_metadata", sa.JSON()),
    )
    op.bulk_insert(table, rows)
    metadata = (
        op.get_bind()
        .execute(sa.select(table.c.method_metadata).where(table.c.id == "hedonic-9-v1"))
        .scalar_one()
    )
    op.execute(
        table.update()
        .where(table.c.id == "hedonic-9-v1")
        .values(method_metadata={**metadata, "renderer_status": "implemented"})
    )
    if op.get_bind().dialect.name == "sqlite":
        for operation in ("INSERT", "UPDATE", "DELETE"):
            refs = (
                ["OLD"]
                if operation == "DELETE"
                else ["NEW"]
                if operation == "INSERT"
                else ["OLD", "NEW"]
            )
            condition = " OR ".join(
                f"EXISTS (SELECT 1 FROM study_versions WHERE id={ref}.study_version_id "
                "AND published_at IS NOT NULL)"
                for ref in refs
            )
            op.execute(
                f"CREATE TRIGGER freeze_samples_{operation.lower()} BEFORE {operation} ON samples "
                f"WHEN {condition} BEGIN "
                "SELECT RAISE(ABORT, 'Published samples are immutable'); END"
            )
        for operation in ("UPDATE", "DELETE"):
            op.execute(
                f"CREATE TRIGGER immutable_assignments_{operation.lower()} BEFORE {operation} "
                "ON session_test_assignments BEGIN "
                "SELECT RAISE(ABORT, 'Serving assignments are immutable'); END"
            )
        op.execute("""CREATE TRIGGER assignments_version_guard
            BEFORE INSERT ON session_test_assignments
            WHEN (SELECT study_version_id FROM sessions WHERE id=NEW.session_id)
            != (SELECT study_version_id FROM study_tests WHERE id=NEW.study_test_id)
            BEGIN SELECT RAISE(ABORT, 'Assignment version does not match session'); END""")
        op.execute("""CREATE TRIGGER responses_sample_guard BEFORE INSERT ON responses
            WHEN NEW.sample_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM samples p JOIN sessions s ON p.study_version_id=s.study_version_id
                WHERE p.id=NEW.sample_id AND s.id=NEW.session_id)
            BEGIN SELECT RAISE(ABORT, 'Sample does not belong to the assigned version'); END""")


def downgrade():
    if op.get_bind().dialect.name == "sqlite":
        op.execute("DROP TRIGGER responses_sample_guard")
    op.drop_table("session_test_assignments")
    op.drop_table("samples")
    rows = json.loads(Path(__file__).with_name("methods_v1.json").read_text(encoding="utf-8"))
    table = sa.table("test_types", sa.column("id", sa.String()))
    op.execute(table.delete().where(table.c.id.in_([row["id"] for row in rows])))
