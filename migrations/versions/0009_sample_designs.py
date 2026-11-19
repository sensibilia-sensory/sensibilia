"""Frozen loop designs and append-only provisioned allocations."""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "study_designs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "study_version_id", sa.String(), sa.ForeignKey("study_versions.id"), nullable=False
        ),
        sa.Column("loop_id", sa.String(), nullable=False),
        sa.Column("settings", sa.JSON(), nullable=False),
        sa.Column("sequences", sa.JSON(), nullable=False),
        sa.UniqueConstraint("study_version_id", "loop_id"),
    )
    op.create_index("ix_study_designs_study_version_id", "study_designs", ["study_version_id"])
    op.create_table(
        "design_allocations",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("design_id", sa.String(), sa.ForeignKey("study_designs.id"), nullable=False),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("sequence_index", sa.Integer(), nullable=False),
        sa.UniqueConstraint("design_id", "ordinal"),
        sa.UniqueConstraint("design_id", "session_id"),
    )
    for key in ("design_id", "session_id"):
        op.create_index("ix_design_allocations_" + key, "design_allocations", [key])
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
                f"CREATE TRIGGER freeze_designs_{operation.lower()} BEFORE {operation} "
                f"ON study_designs WHEN {condition} BEGIN "
                "SELECT RAISE(ABORT, 'Published designs are immutable'); END"
            )
        for operation in ("UPDATE", "DELETE"):
            op.execute(
                f"CREATE TRIGGER immutable_allocations_{operation.lower()} BEFORE {operation} "
                "ON design_allocations BEGIN "
                "SELECT RAISE(ABORT, 'Allocations are retained'); END"
            )
        op.execute("""CREATE TRIGGER allocation_version_guard BEFORE INSERT ON design_allocations
            WHEN NOT EXISTS (SELECT 1 FROM study_designs d
                JOIN sessions s ON s.study_version_id=d.study_version_id
                JOIN study_versions v ON v.id=d.study_version_id
                WHERE d.id=NEW.design_id AND s.id=NEW.session_id AND v.published_at IS NOT NULL)
            BEGIN SELECT RAISE(ABORT, 'Allocation requires matching publication'); END""")


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM study_designs")):
        raise RuntimeError("Cannot discard design history; restore an explicit backup")
    op.drop_table("design_allocations")
    op.drop_table("study_designs")
