"""Analysis add-on: job settings and receipt, and append-only result figures."""

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

# 0013's guard, extended so the analysed test, recipe version and settings are as immutable as
# the recipe itself. The runtime receipt is written while the job runs, then frozen with it.
IDENTITY_0018 = """CREATE TRIGGER job_identity BEFORE UPDATE ON analysis_jobs
    WHEN NEW.id != OLD.id OR NEW.snapshot_id != OLD.snapshot_id OR NEW.recipe != OLD.recipe
    OR NEW.recipe_sha256 != OLD.recipe_sha256 OR NEW.staff_name != OLD.staff_name
    OR NEW.principal != OLD.principal OR NEW.created_at != OLD.created_at
    OR NEW.recipe_version IS NOT OLD.recipe_version OR NEW.parameters IS NOT OLD.parameters
    OR NEW.study_test_id IS NOT OLD.study_test_id
    OR OLD.status IN ('succeeded','failed','cancelled')
    OR NOT ((OLD.status='queued' AND NEW.status IN ('running','cancelled'))
        OR (OLD.status='running' AND NEW.status IN ('succeeded','failed','cancelled')))
    BEGIN SELECT RAISE(ABORT, 'Invalid job transition or immutable audit'); END"""

IDENTITY_0013 = """CREATE TRIGGER job_identity BEFORE UPDATE ON analysis_jobs
    WHEN NEW.id != OLD.id OR NEW.snapshot_id != OLD.snapshot_id OR NEW.recipe != OLD.recipe
    OR NEW.recipe_sha256 != OLD.recipe_sha256 OR NEW.staff_name != OLD.staff_name
    OR NEW.principal != OLD.principal OR NEW.created_at != OLD.created_at
    OR OLD.status IN ('succeeded','failed','cancelled')
    OR NOT ((OLD.status='queued' AND NEW.status IN ('running','cancelled'))
        OR (OLD.status='running' AND NEW.status IN ('succeeded','failed','cancelled')))
    BEGIN SELECT RAISE(ABORT, 'Invalid job transition or immutable audit'); END"""

COLUMNS = ("recipe_version", "parameters", "study_test_id", "runtime")


def upgrade():
    # Plain columns (no foreign key) so a downgrade can drop them in place without rebuilding
    # the table and its triggers; the API checks the test belongs to the snapshot's study.
    op.add_column("analysis_jobs", sa.Column("recipe_version", sa.Integer()))
    op.add_column("analysis_jobs", sa.Column("parameters", sa.JSON()))
    op.add_column("analysis_jobs", sa.Column("study_test_id", sa.String()))
    op.add_column("analysis_jobs", sa.Column("runtime", sa.JSON()))
    op.create_table(
        "analysis_job_figures",
        sa.Column("job_id", sa.String(), sa.ForeignKey("analysis_jobs.id"), primary_key=True),
        sa.Column("name", sa.String(), primary_key=True),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("sha256", sa.String(), nullable=False),
    )
    if op.get_bind().dialect.name == "sqlite":
        op.execute("DROP TRIGGER job_identity")
        op.execute(IDENTITY_0018)
        for action in ("UPDATE", "DELETE"):
            op.execute(
                f"CREATE TRIGGER job_figure_{action.lower()} BEFORE {action} "
                "ON analysis_job_figures "
                "BEGIN SELECT RAISE(ABORT, 'Analysis figures are retained'); END"
            )


def downgrade():
    bind = op.get_bind()
    if bind.scalar(sa.text("SELECT count(*) FROM analysis_job_figures")) or bind.scalar(
        sa.text("SELECT count(*) FROM analysis_jobs WHERE parameters IS NOT NULL")
    ):
        raise RuntimeError("Analysis results cannot be discarded by downgrade")
    if bind.dialect.name == "sqlite":
        op.execute("DROP TRIGGER job_identity")
    op.drop_table("analysis_job_figures")
    for column in COLUMNS:
        op.execute(f"ALTER TABLE analysis_jobs DROP COLUMN {column}")
    if bind.dialect.name == "sqlite":
        op.execute(IDENTITY_0013)
