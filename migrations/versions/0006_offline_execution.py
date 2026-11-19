"""Occurrence-aware collection and append-only causal path audit."""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("responses", sa.Column("step_id", sa.String(), nullable=True))
    op.add_column("responses", sa.Column("occurrence_id", sa.String(), nullable=True))
    # Rebuild only the ordinary event table to replace its legacy structural uniqueness.
    if op.get_bind().dialect.name == "sqlite":
        for trigger in (
            "form_events_step_guard",
            "immutable_form_events_update",
            "immutable_form_events_delete",
            "form_events_event_id_guard",
            "responses_event_id_guard",
        ):
            op.execute(f"DROP TRIGGER {trigger}")
    with op.batch_alter_table(
        "form_events",
        naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s_%(column_1_name)s"},
    ) as batch:
        batch.drop_constraint("uq_form_events_session_id_step_id", type_="unique")
        batch.add_column(sa.Column("occurrence_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("sample_id", sa.String(), nullable=True))
        batch.add_column(sa.Column("supersedes_event_id", sa.String(), nullable=True))
        batch.create_unique_constraint(
            "uq_form_events_occurrence", ["session_id", "step_id", "occurrence_id"]
        )
    op.create_index(
        "uq_form_events_legacy_step",
        "form_events",
        ["session_id", "step_id"],
        unique=True,
        sqlite_where=sa.text("occurrence_id IS NULL"),
    )
    op.create_table(
        "path_events",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("client_event_id", sa.String(), nullable=False, unique=True),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("step_id", sa.String(), nullable=False),
        sa.Column("occurrence_id", sa.String(), nullable=False),
        sa.Column("sample_id", sa.String(), nullable=True),
        sa.Column("kind", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=True),
        sa.Column("target_id", sa.String(), nullable=True),
        sa.Column("answer_event_ids", sa.JSON(), nullable=False),
        sa.Column("recorded_at", sa.String(), nullable=False),
        sa.Column("received_at", sa.String(), nullable=False),
        sa.UniqueConstraint("session_id", "seq"),
    )
    op.create_index("ix_path_events_session_id", "path_events", ["session_id"])
    if op.get_bind().dialect.name == "sqlite":
        op.execute("""CREATE TRIGGER form_events_step_guard BEFORE INSERT ON form_events
            WHEN NOT EXISTS (
                SELECT 1 FROM sessions s JOIN study_versions v ON s.study_version_id=v.id,
                json_tree(v.form) node WHERE s.id=NEW.session_id AND v.published_at IS NOT NULL
                AND node.type='object' AND json_extract(node.value,'$.id')=NEW.step_id
                AND json_extract(node.value,'$.kind') IS NOT NULL)
            BEGIN SELECT RAISE(ABORT, 'Block does not belong to assigned published form'); END""")
        for table in ("form_events", "path_events"):
            for operation in ("UPDATE", "DELETE"):
                op.execute(f"""CREATE TRIGGER immutable_{table}_{operation.lower()}
                    BEFORE {operation}
                    ON {table}
                    BEGIN SELECT RAISE(ABORT, 'Collected events are append-only'); END""")
        for table in ("responses", "form_events", "path_events"):
            others = [t for t in ("responses", "form_events", "path_events") if t != table]
            condition = " OR ".join(
                f"EXISTS (SELECT 1 FROM {t} WHERE client_event_id=NEW.client_event_id)"
                for t in others
            )
            op.execute(f"""CREATE TRIGGER {table}_event_id_guard BEFORE INSERT ON {table}
                WHEN {condition}
                BEGIN SELECT RAISE(ABORT, 'Event identifier already used'); END""")


def downgrade():
    connection = op.get_bind()
    if (
        connection.scalar(sa.text("SELECT count(*) FROM path_events"))
        or connection.scalar(
            sa.text("SELECT count(*) FROM form_events WHERE occurrence_id IS NOT NULL")
        )
        or connection.scalar(
            sa.text("SELECT count(*) FROM responses WHERE occurrence_id IS NOT NULL")
        )
    ):
        raise RuntimeError("Cannot discard v2 collection provenance; restore an explicit backup")
    if connection.dialect.name == "sqlite":
        for table in ("responses", "form_events", "path_events"):
            op.execute(f"DROP TRIGGER {table}_event_id_guard")
        for trigger in (
            "form_events_step_guard",
            "immutable_form_events_update",
            "immutable_form_events_delete",
        ):
            op.execute(f"DROP TRIGGER {trigger}")
    op.drop_table("path_events")
    op.drop_index("uq_form_events_legacy_step", table_name="form_events")
    with op.batch_alter_table("form_events") as batch:
        batch.drop_constraint("uq_form_events_occurrence", type_="unique")
        batch.drop_column("occurrence_id")
        batch.drop_column("sample_id")
        batch.drop_column("supersedes_event_id")
        batch.create_unique_constraint("uq_form_events_session_step", ["session_id", "step_id"])
    op.drop_column("responses", "occurrence_id")
    op.drop_column("responses", "step_id")
    if connection.dialect.name == "sqlite":
        op.execute("""CREATE TRIGGER form_events_step_guard BEFORE INSERT ON form_events
            WHEN NOT EXISTS (
                SELECT 1 FROM sessions s JOIN study_versions v ON s.study_version_id=v.id,
                json_each(v.form, '$.steps') step
                WHERE s.id=NEW.session_id AND json_extract(step.value, '$.id')=NEW.step_id
                AND v.published_at IS NOT NULL)
            BEGIN SELECT RAISE(ABORT, 'Block does not belong to assigned published form'); END""")
        for operation in ("UPDATE", "DELETE"):
            op.execute(f"""CREATE TRIGGER immutable_form_events_{operation.lower()}
                BEFORE {operation}
                ON form_events
                BEGIN SELECT RAISE(ABORT, 'Form submissions are append-only'); END""")
        for target, other in (("responses", "form_events"), ("form_events", "responses")):
            op.execute(f"""CREATE TRIGGER {target}_event_id_guard BEFORE INSERT ON {target}
                WHEN EXISTS (SELECT 1 FROM {other} WHERE client_event_id=NEW.client_event_id)
                BEGIN SELECT RAISE(ABORT, 'Event identifier already used'); END""")
