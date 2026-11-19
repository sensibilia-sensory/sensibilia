"""The standard install keeps collected data outside Docker volumes.

PyYAML is not a project dependency, so these tests read the compose file as text.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = (ROOT / "dev.compose.yaml").read_text(encoding="utf-8")
SCRIPT = (ROOT / "docker-up.sh").read_text(encoding="utf-8")


def service(name: str) -> str:
    """The text of one top-level service block."""
    match = re.search(rf"^  {name}:\n(.*?)(?=^  \S|^\S|\Z)", COMPOSE, re.S | re.M)
    assert match, f"service {name} not found"
    return match.group(1)


def test_collected_data_is_in_bind_mounts_not_volumes():
    app = service("app")
    assert "- ./data/server:/data" in app
    assert "- ./data/assets:/assets" in app
    # `down -v` removes named volumes only; none of them may hold collected data.
    declared = COMPOSE.split("\nvolumes:\n")[-1]
    assert re.findall(r"^  (\w+):", declared, re.M) == ["dev_tls_config"]


def test_backup_job_reads_the_same_data_and_writes_to_a_backup_directory():
    backup = service("backup")
    assert "profiles: [scheduler]" in backup
    assert "image: sensibilia-dev:local" in backup
    assert 'restart: "no"' in backup
    assert "sensibilia.operations, backup" in backup
    assert "- ./data/server:/data" in backup
    assert "- ./data/assets:/assets" in backup
    assert "- ${BACKUP_DIRECTORY:-./data/backups}:/backup" in backup


def test_certificate_authority_survives_recreating_containers():
    assert "- ./data/dev-tls:/data" in service("tls")


def test_start_does_not_need_the_internet_when_the_image_exists():
    assert '"${COMPOSE[@]}" up -d --no-build' in SCRIPT
    assert "up --build" not in SCRIPT
    # Building is a deliberate step: first start without an image, or `update`.
    assert "elif ! image_exists; then" in SCRIPT
    assert re.search(r'if \[ "\$MODE" = "update" \]', SCRIPT)
