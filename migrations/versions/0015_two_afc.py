"""Register the 2-AFC (paired comparison) method with its frozen schema."""

import json
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade():
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
                id="two-afc-v1",
                key="two_afc",
                name="2-AFC — Two-alternative forced choice",
                schema_version=1,
                configuration_schema=json.loads(
                    Path(__file__).with_name("two_afc_v1.json").read_text(encoding="utf-8")
                ),
                method_metadata=dict(
                    renderer_status="implemented",
                    response_validator_status="implemented",
                    source_url="https://www.iso.org/standard/31621.html",
                    description=(
                        "Choose one of two blinded samples (directional or preference); "
                        "balanced AB/BA order."
                    ),
                ),
            )
        ],
    )


def downgrade():
    if op.get_bind().scalar(
        sa.text("SELECT count(*) FROM study_tests WHERE test_type_id='two-afc-v1'")
    ):
        raise RuntimeError("Studies already use 2-AFC; downgrade would discard their method")
    op.execute(sa.text("DELETE FROM test_types WHERE id='two-afc-v1'"))
