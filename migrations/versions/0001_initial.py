"""Initial collection schema and hedonic method v1.

Revision ID: 0001
"""

import json
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def column(name, nullable=False):
    return sa.Column(name, sa.String(), nullable=nullable)


def upgrade():
    op.create_table(
        "test_types",
        column("id"),
        column("key"),
        column("name"),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.Column("configuration_schema", sa.JSON(), nullable=False),
        sa.Column("method_metadata", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key", "schema_version"),
    )
    op.create_table(
        "studies",
        column("id"),
        column("title"),
        column("description"),
        column("status"),
        column("created_at"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "study_versions",
        column("id"),
        column("study_id"),
        sa.Column("version_number", sa.Integer(), nullable=False),
        column("title"),
        column("description"),
        column("published_at", True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["study_id"], ["studies.id"]),
        sa.UniqueConstraint("study_id", "version_number"),
    )
    op.create_index("ix_study_versions_study_id", "study_versions", ["study_id"])
    op.create_index(
        "uq_study_versions_one_draft",
        "study_versions",
        ["study_id"],
        unique=True,
        sqlite_where=sa.text("published_at IS NULL"),
    )
    op.create_table(
        "study_tests",
        column("id"),
        column("study_version_id"),
        column("test_type_id"),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("configuration", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["study_version_id"], ["study_versions.id"]),
        sa.ForeignKeyConstraint(["test_type_id"], ["test_types.id"]),
        sa.UniqueConstraint("study_version_id", "position"),
    )
    op.create_index("ix_study_tests_study_version_id", "study_tests", ["study_version_id"])
    op.create_table(
        "sessions",
        column("id"),
        column("study_version_id"),
        column("assessor_code"),
        column("token_hash"),
        sa.Column("presentation_order", sa.JSON(), nullable=False),
        column("started_at"),
        column("completed_at", True),
        column("status"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
        sa.ForeignKeyConstraint(["study_version_id"], ["study_versions.id"]),
    )
    op.create_index("ix_sessions_study_version_id", "sessions", ["study_version_id"])
    op.create_table(
        "responses",
        column("id"),
        column("session_id"),
        column("study_test_id"),
        column("sample_id", True),
        column("question_id"),
        sa.Column("value", sa.JSON(), nullable=False),
        column("recorded_at"),
        column("received_at"),
        column("client_event_id"),
        column("supersedes_event_id", True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_event_id"),
        sa.UniqueConstraint("supersedes_event_id"),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"]),
        sa.ForeignKeyConstraint(["study_test_id"], ["study_tests.id"]),
        sa.ForeignKeyConstraint(["supersedes_event_id"], ["responses.client_event_id"]),
    )
    op.create_index(
        "ix_responses_session_test_question",
        "responses",
        ["session_id", "study_test_id", "question_id"],
    )
    op.create_index("ix_responses_study_test_id", "responses", ["study_test_id"])
    registry = sa.table(
        "test_types",
        sa.column("id", sa.String()),
        sa.column("key", sa.String()),
        sa.column("name", sa.String()),
        sa.column("schema_version", sa.Integer()),
        sa.column("configuration_schema", sa.JSON()),
        sa.column("method_metadata", sa.JSON()),
    )
    schema = json.loads(Path(__file__).with_name("hedonic_v1.json").read_text(encoding="utf-8"))
    op.bulk_insert(
        registry,
        [
            {
                "id": "hedonic-9-v1",
                "key": "hedonic_acceptance_9",
                "name": "Nine-point hedonic acceptance",
                "schema_version": 1,
                "configuration_schema": schema,
                "method_metadata": {
                    "backend_status": "implemented",
                    "renderer_status": "planned",
                    "scale_min": 1,
                    "scale_max": 9,
                    "citation": "Peryam & Pilgrim (1957), Hedonic scale method "
                    "of measuring food preferences, Food Technology 11, 9-14",
                    "source_url": "https://www.pk-research.com/wp-content/uploads/"
                    "2021/09/TheNinePointHedonicScale-Papers.pdf",
                    "label_policy": "Labels in ascending rating order; translations "
                    "require researcher review",
                },
            }
        ],
    )
    if op.get_bind().dialect.name == "sqlite":
        for operation in ("UPDATE", "DELETE"):
            op.execute(f"""CREATE TRIGGER freeze_versions_{operation.lower()}
                BEFORE {operation} ON study_versions WHEN OLD.published_at IS NOT NULL
                BEGIN SELECT RAISE(ABORT, 'Published versions are immutable'); END""")
        for operation in ("INSERT", "UPDATE", "DELETE"):
            references = ["OLD"] if operation == "DELETE" else ["NEW"]
            if operation == "UPDATE":
                references.append("OLD")
            condition = " OR ".join(
                f"EXISTS (SELECT 1 FROM study_versions WHERE id={ref}.study_version_id "
                "AND published_at IS NOT NULL)"
                for ref in references
            )
            op.execute(f"""CREATE TRIGGER freeze_tests_{operation.lower()}
                BEFORE {operation} ON study_tests WHEN {condition}
                BEGIN SELECT RAISE(ABORT, 'Published tests are immutable'); END""")
        op.execute("""CREATE TRIGGER responses_version_guard BEFORE INSERT ON responses
            WHEN (SELECT study_version_id FROM sessions WHERE id=NEW.session_id)
                 != (SELECT study_version_id FROM study_tests WHERE id=NEW.study_test_id)
            BEGIN SELECT RAISE(ABORT, 'Response version does not match session'); END""")
        for operation in ("UPDATE", "DELETE"):
            op.execute(f"""CREATE TRIGGER immutable_responses_{operation.lower()}
                BEFORE {operation} ON responses
                BEGIN SELECT RAISE(ABORT, 'Responses are append-only'); END""")
        op.execute("""CREATE TRIGGER sessions_version_guard BEFORE INSERT ON sessions
            WHEN NOT EXISTS (SELECT 1 FROM study_versions WHERE id=NEW.study_version_id
                             AND published_at IS NOT NULL)
            BEGIN SELECT RAISE(ABORT, 'Session requires a published version'); END""")
        op.execute("""CREATE TRIGGER sessions_assignment_guard
            BEFORE UPDATE OF study_version_id, presentation_order ON sessions
            BEGIN SELECT RAISE(ABORT, 'Session assignment is immutable'); END""")


def downgrade():
    # Dropping a table also drops its triggers and indexes in SQLite.
    for table in (
        "responses",
        "sessions",
        "study_tests",
        "study_versions",
        "studies",
        "test_types",
    ):
        op.drop_table(table)
