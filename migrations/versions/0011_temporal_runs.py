"""Immutable TCATA runs and ordered transitions; register frozen schema."""

import json
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "temporal_runs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("study_test_id", sa.String(), sa.ForeignKey("study_tests.id"), nullable=False),
        sa.Column("step_id", sa.String(), nullable=False),
        sa.Column("occurrence_id", sa.String(), nullable=False),
        sa.Column("sample_id", sa.String(), sa.ForeignKey("samples.id")),
        sa.Column("client_event_id", sa.String(), nullable=False, unique=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("recorded_at", sa.String(), nullable=False),
        sa.Column("received_at", sa.String(), nullable=False),
        sa.UniqueConstraint("session_id", "step_id", "occurrence_id"),
    )
    for column in ("session_id", "study_test_id"):
        op.create_index("ix_temporal_runs_" + column, "temporal_runs", [column])
    op.create_table(
        "temporal_events",
        sa.Column("client_event_id", sa.String(), primary_key=True),
        sa.Column("run_id", sa.String(), sa.ForeignKey("temporal_runs.id"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("elapsed_ms", sa.Integer(), nullable=False),
        sa.Column("attribute_id", sa.String(), nullable=False),
        sa.Column("selected", sa.Integer(), nullable=False),
        sa.Column("recorded_at", sa.String(), nullable=False),
        sa.UniqueConstraint("run_id", "seq"),
        sa.CheckConstraint("seq >= 1 AND elapsed_ms >= 0 AND selected IN (0, 1)"),
    )
    op.create_index("ix_temporal_events_run_id", "temporal_events", ["run_id"])
    methods = sa.table(
        "test_types",
        sa.column("id"),
        sa.column("key"),
        sa.column("name"),
        sa.column("schema_version"),
        sa.column("configuration_schema", sa.JSON()),
        sa.column("method_metadata", sa.JSON()),
    )
    op.bulk_insert(
        methods,
        [
            dict(
                id="tcata-v1",
                key="tcata",
                name="TCATA — Temporal check all that apply",
                schema_version=1,
                configuration_schema=json.loads(
                    Path(__file__).with_name("tcata_v1.json").read_text(encoding="utf-8")
                ),
                method_metadata=dict(
                    renderer_status="implemented",
                    response_validator_status="implemented",
                    source_url="https://doi.org/10.1016/j.foodqual.2015.06.017",
                    description=(
                        "Concurrent attribute transitions; physical timing validation required."
                    ),
                    timing_acceptance="unverified",
                ),
            )
        ],
    )
    if op.get_bind().dialect.name == "sqlite":
        for table in ("temporal_runs", "temporal_events"):
            for action in ("UPDATE", "DELETE"):
                op.execute(
                    f"CREATE TRIGGER retain_{table}_{action.lower()} BEFORE {action} "
                    f"ON {table} BEGIN SELECT RAISE(ABORT, 'Temporal history is immutable'); END"
                )
        op.execute("""CREATE TRIGGER temporal_version_guard BEFORE INSERT ON temporal_runs
            WHEN NOT EXISTS (SELECT 1 FROM sessions s JOIN study_tests t
                ON t.study_version_id=s.study_version_id
                WHERE s.id=NEW.session_id AND t.id=NEW.study_test_id AND t.test_type_id='tcata-v1')
            BEGIN SELECT RAISE(ABORT, 'Foreign temporal test'); END""")


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM temporal_runs")) or op.get_bind().scalar(
        sa.text("SELECT count(*) FROM study_tests WHERE test_type_id='tcata-v1'")
    ):
        raise RuntimeError("Temporal collection history cannot be discarded by downgrade")
    op.drop_table("temporal_events")
    op.drop_table("temporal_runs")
    op.execute(sa.text("DELETE FROM test_types WHERE id='tcata-v1'"))
