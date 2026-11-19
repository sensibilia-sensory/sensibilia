"""Fixed sample-loop metadata and draft revision tracking."""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("samples", sa.Column("ingredient_tags", sa.JSON(), nullable=True))
    if op.get_bind().dialect.name == "sqlite":
        for operation, ref in (("INSERT", "NEW"), ("UPDATE", "NEW"), ("DELETE", "OLD")):
            op.execute(f"""CREATE TRIGGER samples_revision_{operation.lower()} AFTER {operation}
                ON samples BEGIN UPDATE study_versions SET revision=revision+1
                WHERE id={ref}.study_version_id AND published_at IS NULL; END""")


def downgrade():
    if op.get_bind().dialect.name == "sqlite":
        for operation in ("insert", "update", "delete"):
            op.execute(f"DROP TRIGGER samples_revision_{operation}")
    op.drop_column("samples", "ingredient_tags")
