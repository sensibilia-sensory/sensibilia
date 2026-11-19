"""Immutable dataset cuts and bounded analysis job audit."""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "dataset_snapshots",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("study_id", sa.String(), sa.ForeignKey("studies.id"), nullable=False),
        sa.Column("study_version_id", sa.String(), sa.ForeignKey("study_versions.id")),
        *[
            sa.Column(c, sa.String(), nullable=False)
            for c in ("label", "staff_name", "principal", "created_at")
        ],
        sa.Column("manifest", sa.JSON(), nullable=False),
        sa.Column("files", sa.JSON(), nullable=False),
    )
    op.create_index("ix_dataset_snapshots_study_id", "dataset_snapshots", ["study_id"])
    op.create_table(
        "analysis_jobs",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column(
            "snapshot_id", sa.String(), sa.ForeignKey("dataset_snapshots.id"), nullable=False
        ),
        *[
            sa.Column(c, sa.String(), nullable=False)
            for c in ("recipe", "recipe_sha256", "staff_name", "principal", "created_at", "status")
        ],
        *[
            sa.Column(c, sa.String())
            for c in ("started_at", "finished_at", "image", "result_sha256", "error")
        ],
        sa.Column("result", sa.JSON()),
        sa.CheckConstraint("status IN ('queued','running','succeeded','failed','cancelled')"),
    )
    op.create_index("ix_analysis_jobs_snapshot_id", "analysis_jobs", ["snapshot_id"])
    if op.get_bind().dialect.name == "sqlite":
        for action in ("UPDATE", "DELETE"):
            op.execute(
                f"CREATE TRIGGER snapshot_{action.lower()} BEFORE {action} ON dataset_snapshots "
                "BEGIN SELECT RAISE(ABORT, 'Dataset snapshot is immutable'); END"
            )
        op.execute(
            "CREATE TRIGGER job_delete BEFORE DELETE ON analysis_jobs "
            "BEGIN SELECT RAISE(ABORT, 'Job history is retained'); END"
        )
        op.execute("""CREATE TRIGGER job_identity BEFORE UPDATE ON analysis_jobs
            WHEN NEW.id != OLD.id OR NEW.snapshot_id != OLD.snapshot_id OR NEW.recipe != OLD.recipe
            OR NEW.recipe_sha256 != OLD.recipe_sha256 OR NEW.staff_name != OLD.staff_name
            OR NEW.principal != OLD.principal OR NEW.created_at != OLD.created_at
            OR OLD.status IN ('succeeded','failed','cancelled')
            OR NOT ((OLD.status='queued' AND NEW.status IN ('running','cancelled'))
                OR (OLD.status='running' AND NEW.status IN ('succeeded','failed','cancelled')))
            BEGIN SELECT RAISE(ABORT, 'Invalid job transition or immutable audit'); END""")


def downgrade():
    if op.get_bind().scalar(sa.text("SELECT count(*) FROM dataset_snapshots")):
        raise RuntimeError("Dataset history cannot be discarded by downgrade")
    op.drop_table("analysis_jobs")
    op.drop_table("dataset_snapshots")
