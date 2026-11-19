"""Immutable study forms and append-only block submissions.

Revision ID: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    # Existing published versions stay NULL (the legacy sequential-test contract).
    # Existing freeze_versions triggers also protect this new column.
    op.add_column("study_versions", sa.Column("form", sa.JSON(none_as_null=True), nullable=True))
    op.create_table(
        "form_events",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("step_id", sa.String(), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("recorded_at", sa.String(), nullable=False),
        sa.Column("received_at", sa.String(), nullable=False),
        sa.Column("client_event_id", sa.String(), nullable=False, unique=True),
        sa.UniqueConstraint("session_id", "step_id"),
    )
    op.create_index("ix_form_events_session_id", "form_events", ["session_id"])
    if op.get_bind().dialect.name == "sqlite":
        op.execute("""CREATE TRIGGER form_events_step_guard BEFORE INSERT ON form_events
            WHEN NOT EXISTS (
                SELECT 1 FROM sessions s JOIN study_versions v ON s.study_version_id=v.id,
                json_each(v.form, '$.steps') step
                WHERE s.id=NEW.session_id AND json_extract(step.value, '$.id')=NEW.step_id
                AND v.published_at IS NOT NULL)
            BEGIN SELECT RAISE(ABORT, 'Block does not belong to assigned published form'); END""")
        for operation in ("UPDATE", "DELETE"):
            op.execute(f"""CREATE TRIGGER immutable_form_events_{operation.lower()}
                BEFORE {operation} ON form_events
                BEGIN SELECT RAISE(ABORT, 'Form submissions are append-only'); END""")
        for target, other in (("responses", "form_events"), ("form_events", "responses")):
            op.execute(f"""CREATE TRIGGER {target}_event_id_guard BEFORE INSERT ON {target}
                WHEN EXISTS (SELECT 1 FROM {other} WHERE client_event_id=NEW.client_event_id)
                BEGIN SELECT RAISE(ABORT, 'Event identifier already used'); END""")


def downgrade():
    if op.get_bind().dialect.name == "sqlite":
        op.execute("DROP TRIGGER responses_event_id_guard")
    op.drop_table("form_events")
    op.drop_column("study_versions", "form")
