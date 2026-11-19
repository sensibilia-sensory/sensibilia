"""Study closing and archiving: when a study stopped taking assessments and when it was hidden."""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("studies", sa.Column("closed_at", sa.String(), nullable=True))
    op.add_column("studies", sa.Column("archived_at", sa.String(), nullable=True))


def downgrade():
    op.drop_column("studies", "archived_at")
    op.drop_column("studies", "closed_at")
