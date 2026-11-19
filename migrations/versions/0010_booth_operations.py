"""Versioned rooms, booth history, current presence and durable serving ledger."""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "rooms",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_table(
        "booths",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("room_id", sa.String(), sa.ForeignKey("rooms.id"), nullable=False),
    )
    op.create_index("ix_booths_room_id", "booths", ["room_id"])
    op.create_table(
        "room_versions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("room_id", sa.String(), sa.ForeignKey("rooms.id"), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("rows", sa.Integer(), nullable=False),
        sa.Column("columns", sa.Integer(), nullable=False),
        sa.Column("booths", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.UniqueConstraint("room_id", "revision"),
    )
    op.create_index("ix_room_versions_room_id", "room_versions", ["room_id"])
    op.create_table(
        "booth_assignments",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "room_version_id", sa.String(), sa.ForeignKey("room_versions.id"), nullable=False
        ),
        sa.Column("booth_id", sa.String(), sa.ForeignKey("booths.id"), nullable=False),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("staff_name", sa.String(), nullable=False),
        sa.Column("principal", sa.String(), nullable=False),
        sa.Column("reason", sa.String(), nullable=False),
        sa.Column("assigned_at", sa.String(), nullable=False),
        sa.Column("released_at", sa.String()),
    )
    for column in ("room_version_id", "session_id"):
        op.create_index("ix_booth_assignments_" + column, "booth_assignments", [column])
    for name, column in (
        ("uq_booth_active", "booth_id"),
        ("uq_session_booth_active", "session_id"),
    ):
        op.create_index(
            name,
            "booth_assignments",
            [column],
            unique=True,
            sqlite_where=sa.text("released_at IS NULL"),
        )
    op.create_table(
        "presence",
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id"), primary_key=True),
        sa.Column("last_seen", sa.String(), nullable=False),
        sa.Column("process_id", sa.String(), nullable=False),
    )
    op.create_table(
        "serving_signals",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "assignment_id", sa.String(), sa.ForeignKey("booth_assignments.id"), nullable=False
        ),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("step_id", sa.String(), nullable=False),
        sa.Column("occurrence_id", sa.String(), nullable=False),
        sa.Column("state", sa.String(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("requested_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("actor", sa.String(), nullable=False),
        sa.UniqueConstraint("assignment_id", "step_id", "occurrence_id"),
    )
    for column in ("assignment_id", "session_id"):
        op.create_index("ix_serving_signals_" + column, "serving_signals", [column])
    op.create_table(
        "operational_events",
        sa.Column("cursor", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("client_event_id", sa.String(), nullable=False, unique=True),
        sa.Column("signal_id", sa.String(), sa.ForeignKey("serving_signals.id")),
        sa.Column(
            "assignment_id", sa.String(), sa.ForeignKey("booth_assignments.id"), nullable=False
        ),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("actor", sa.String(), nullable=False),
        sa.Column("principal", sa.String(), nullable=False),
        sa.Column("recorded_at", sa.String(), nullable=False),
        sa.Column("received_at", sa.String(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=False),
    )
    for column in ("signal_id", "assignment_id"):
        op.create_index("ix_operational_events_" + column, "operational_events", [column])
    if op.get_bind().dialect.name == "sqlite":
        for table in ("rooms", "booths", "room_versions", "operational_events"):
            for action in ("UPDATE", "DELETE"):
                op.execute(
                    f"CREATE TRIGGER retain_{table}_{action.lower()} BEFORE {action} "
                    f"ON {table} BEGIN "
                    "SELECT RAISE(ABORT, 'Operational history is immutable'); END"
                )
        op.execute("""CREATE TRIGGER booth_membership_guard BEFORE INSERT ON booth_assignments
            WHEN NOT EXISTS (SELECT 1 FROM room_versions r, booths b, json_each(r.booths) cell
                WHERE r.id=NEW.room_version_id AND b.id=NEW.booth_id AND b.room_id=r.room_id
                AND json_extract(cell.value, '$.id')=b.id
                AND json_extract(cell.value, '$.enabled')=1)
            BEGIN SELECT RAISE(ABORT, 'Booth must belong to assigned layout'); END""")
        op.execute("""CREATE TRIGGER retain_booth_assignment BEFORE UPDATE ON booth_assignments
            WHEN OLD.id IS NOT NEW.id OR OLD.room_version_id IS NOT NEW.room_version_id
            OR OLD.booth_id IS NOT NEW.booth_id OR OLD.session_id IS NOT NEW.session_id
            OR OLD.staff_name IS NOT NEW.staff_name OR OLD.principal IS NOT NEW.principal
            OR OLD.reason IS NOT NEW.reason OR OLD.assigned_at IS NOT NEW.assigned_at
            OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL
            BEGIN SELECT RAISE(ABORT, 'Assignment history is immutable'); END""")
        op.execute(
            "CREATE TRIGGER retain_booth_assignment_delete BEFORE DELETE ON booth_assignments "
            "BEGIN SELECT RAISE(ABORT, 'Assignment history is retained'); END"
        )


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM room_versions")):
        raise RuntimeError("Cannot discard operational history; restore an explicit backup")
    for table in (
        "operational_events",
        "serving_signals",
        "presence",
        "booth_assignments",
        "room_versions",
        "booths",
        "rooms",
    ):
        op.drop_table(table)
