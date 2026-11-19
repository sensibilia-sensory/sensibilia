#!/usr/bin/env bash
# Start and look after the standard Sensibilia install, reachable from the LAN.
#
#   ./docker-up.sh              start; builds the image only if it does not exist yet, so a
#                               server moved to a LAN without internet starts as it is
#   ./docker-up.sh update       rebuild from the working tree and restart (needs internet;
#                               run ./docker-up.sh backup first)
#   ./docker-up.sh backup       verified backup of the database and images into data/backups
#   ./docker-up.sh status       check the last backup (fails if older than 26 hours)
#   ./docker-up.sh restore FILE put back a backup (a file name in the backup directory); the
#                               data it replaces is kept in data/before-restore-<time>
#   ./docker-up.sh down         stop, keep data
#   ./docker-up.sh --password   also generate researcher and operator keys in .env
#                               (any command that starts the stack)
#   DEV_LAN_ADDRESS=192.168.1.20 ./docker-up.sh   use a specific address
#   BACKUP_DIRECTORY=/mnt/usb/sensibilia ./docker-up.sh backup   back up to a second disk
#
# The proxy only answers HTTPS requests for localhost and DEV_LAN_ADDRESS, so this
# script detects this computer's LAN address and passes it on.
#
# Everything collected lives in ./data (server, assets, dev-tls, backups), not in Docker
# volumes, so `docker compose down -v` removes none of it. The certificate authority is in
# ./data/dev-tls, so the Android app built from its root (android/README.md) stays valid. This
# script saves that root to data/lab-ca/root.crt and prints its fingerprint; copy it to the
# computer that builds the Android app (the server can be a headless machine). See
# android/INSTALL.md.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

PROJECT="${COMPOSE_PROJECT_NAME:-sensibilia-dev}"
IMAGE=sensibilia-dev:local
COMPOSE=(docker compose -f dev.compose.yaml)
APP_UID=10001 # the user the application image runs as
MODE=start
PASSWORD=0
ARCHIVE=""
EXPECT_ARCHIVE=0

for arg in "$@"; do
  if [ "$EXPECT_ARCHIVE" = "1" ]; then
    ARCHIVE="$arg"
    EXPECT_ARCHIVE=0
    continue
  fi
  case "$arg" in
    start | update | backup | status | down) MODE="$arg" ;;
    restore)
      MODE=restore
      EXPECT_ARCHIVE=1
      ;;
    --password) PASSWORD=1 ;;
    -h | --help)
      sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg (see ./docker-up.sh --help)" >&2
      exit 2
      ;;
  esac
done

image_exists() { docker image inspect "$IMAGE" >/dev/null 2>&1; }

# Compose reads .env itself, but this script decides these two values first, so it reads them too.
from_env_file() { { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -n1; } || true; }
if [ -z "${BACKUP_DIRECTORY:-}" ]; then BACKUP_DIRECTORY="$(from_env_file BACKUP_DIRECTORY)"; fi
if [ -z "${DEV_LAN_ADDRESS:-}" ]; then DEV_LAN_ADDRESS="$(from_env_file DEV_LAN_ADDRESS)"; fi

if [ "$MODE" = "down" ]; then
  "${COMPOSE[@]}" down
  exit 0
fi

# An absolute path: compose would read a bare relative name as a Docker volume.
mkdir -p "${BACKUP_DIRECTORY:-data/backups}"
BACKUP_DIR="$(cd "${BACKUP_DIRECTORY:-data/backups}" && pwd)"
export BACKUP_DIRECTORY="$BACKUP_DIR"

# Older installs kept the database and images in Docker volumes. Copy them into ./data once,
# check the copy, and leave the volumes where they are.
import_volume() {
  local volume="$1" target="$2" check="$3"
  docker volume inspect "$volume" >/dev/null 2>&1 || return 0
  rm -rf "data/$target.importing" 2>/dev/null || true
  docker run --rm --user 0 --entrypoint sh -v "$volume:/from:ro" -v "$PWD/data:/data" "$IMAGE" -ec "
    rm -rf /data/$target.importing
    [ -n \"\$(ls -A /from)\" ] || exit 0
    mkdir /data/$target.importing
    cp -a /from/. /data/$target.importing/
    chown -R $APP_UID:$APP_UID /data/$target.importing"
  [ -d "data/$target.importing" ] || return 0
  if [ "$check" = "sqlite" ]; then
    docker run --rm --user "$APP_UID:$APP_UID" -v "$PWD/data/$target.importing:/data" "$IMAGE" python -c "
import sqlite3
result = sqlite3.connect('/data/sensibilia.db').execute('pragma integrity_check').fetchone()[0]
raise SystemExit(0 if result == 'ok' else 'Database check failed: ' + result)"
  fi
  rmdir "data/$target" 2>/dev/null || true
  if [ -e "data/$target" ]; then
    echo "data/$target is not empty; leaving the copy in data/$target.importing. Resolve and run again." >&2
    exit 1
  fi
  mv "data/$target.importing" "data/$target"
  echo "Copied $volume into data/$target (the Docker volume is kept; remove it with 'docker volume rm $volume' once you trust the copy)."
}

migrate_old_volumes() {
  if [ ! -e data/server/sensibilia.db ]; then
    if docker volume inspect "${PROJECT}_dev_data" >/dev/null 2>&1; then
      "${COMPOSE[@]}" down # stop the app so the database copy is consistent
      import_volume "${PROJECT}_dev_data" server sqlite
    fi
  fi
  if [ -z "$(ls -A data/assets 2>/dev/null || true)" ]; then
    import_volume "${PROJECT}_dev_assets" assets files
  fi
}

# The application runs as an unprivileged user; this gives it the data folders. A one-off
# container from the local image does it, so no internet is needed.
prepare_data() {
  mkdir -p data/dev-tls data/lab-ca data/server data/assets
  docker run --rm --user 0 --entrypoint sh \
    -v "$PWD/data/server:/data" -v "$PWD/data/assets:/assets" \
    -v "$BACKUP_DIR:/backup" "$IMAGE" -ec "
    chown -R $APP_UID:$APP_UID /data /assets
    chown $APP_UID:$APP_UID /backup || true"
}

new_key() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 32; }

make_keys() {
  touch .env
  chmod 600 .env
  if grep -Eq '^DEV_(RESEARCHER|OPERATOR)_KEY=.+' .env; then
    echo "Keys already set in .env; leaving them as they are."
    return 0
  fi
  local researcher operator
  researcher="$(new_key)"
  operator="$(new_key)"
  printf 'DEV_RESEARCHER_KEY=%s\nDEV_OPERATOR_KEY=%s\n' "$researcher" "$operator" >>.env
  KEY_NOTE="Sign-in keys (also saved in .env, shown only now):
  Researcher key: $researcher
  Operator key:   $operator"
}

if [ "$MODE" = "restore" ]; then
  case "$ARCHIVE" in
    "" | */*)
      echo "Usage: ./docker-up.sh restore <backup file name from $BACKUP_DIR, ending in .db>" >&2
      exit 2
      ;;
  esac
  if ! image_exists; then
    echo "The application image does not exist yet. Run ./docker-up.sh first." >&2
    exit 1
  fi
  if [ ! -f "$BACKUP_DIR/$ARCHIVE" ]; then
    echo "No such backup: $BACKUP_DIR/$ARCHIVE" >&2
    exit 1
  fi
  "${COMPOSE[@]}" down
  STAMP="$(date +%Y%m%dT%H%M%S)"
  # The data being replaced is moved aside, never deleted.
  docker run --rm --user 0 --entrypoint sh -v "$PWD/data:/data" "$IMAGE" -ec "
    mkdir /data/before-restore-$STAMP
    [ ! -e /data/server ] || mv /data/server /data/before-restore-$STAMP/server
    [ ! -e /data/assets ] || mv /data/assets /data/before-restore-$STAMP/assets"
  prepare_data
  if ! "${COMPOSE[@]}" --profile scheduler run --rm -T --no-deps backup     python -m sensibilia.operations restore "/backup/$ARCHIVE" --target /data/sensibilia.db; then
    echo "Restore failed. The data from before is in data/before-restore-$STAMP." >&2
    exit 1
  fi
  echo "Restored $ARCHIVE. The data it replaced is in data/before-restore-$STAMP."
  echo "Start the server with ./docker-up.sh, then check the studies and an export."
  exit 0
fi

if [ "$MODE" = "backup" ] || [ "$MODE" = "status" ]; then
  if ! image_exists; then
    echo "The application image does not exist yet. Run ./docker-up.sh first." >&2
    exit 1
  fi
  if [ "$MODE" = "backup" ]; then
    prepare_data # also makes a new BACKUP_DIRECTORY writable for the application user
    "${COMPOSE[@]}" --profile scheduler run --rm -T --no-deps backup
    echo "Backup written to $BACKUP_DIR. Keep a copy on a second disk."
  else
    if ! "${COMPOSE[@]}" --profile scheduler run --rm -T --no-deps backup \
      python -m sensibilia.operations status --destination /backup --max-age-hours 26; then
      echo "No verified backup from the last 26 hours. Run ./docker-up.sh backup." >&2
      exit 1
    fi
  fi
  exit 0
fi

if [ -z "${DEV_LAN_ADDRESS:-}" ]; then
  DEV_LAN_ADDRESS="$(ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n1 || true)"
  DEV_LAN_ADDRESS="${DEV_LAN_ADDRESS:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
fi
export DEV_LAN_ADDRESS="${DEV_LAN_ADDRESS:-127.0.0.1}"

KEY_NOTE=""
if [ "$PASSWORD" = "1" ]; then
  make_keys
fi

# Builds only when the image is missing, or on `update`: this is the only step that needs internet.
if [ "$MODE" = "update" ]; then
  if [ -e data/server/sensibilia.db ] && image_exists; then
    echo "Backing up before updating..."
    prepare_data
    "${COMPOSE[@]}" --profile scheduler run --rm -T --no-deps backup
  fi
  "${COMPOSE[@]}" build
elif ! image_exists; then
  echo "Building the application image (first start; needs internet)..."
  "${COMPOSE[@]}" build
fi

mkdir -p data
migrate_old_volumes
prepare_data
"${COMPOSE[@]}" up -d --no-build

# Save the public root (plain HTTP, nothing else is served there) for the Android app build.
CA_FILE=data/lab-ca/root.crt
CA_NOTE=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "http://127.0.0.1:1380/certificate.crt" -o "$CA_FILE.tmp" 2>/dev/null; then
    mv "$CA_FILE.tmp" "$CA_FILE"
    if command -v openssl >/dev/null 2>&1; then
      CA_NOTE="Root certificate saved to $CA_FILE
  SHA-256 $(openssl x509 -in "$CA_FILE" -noout -fingerprint -sha256 | cut -d= -f2)
  Tablet app: copy $CA_FILE to the computer that builds the app, then see android/INSTALL.md"
    else
      CA_NOTE="Root certificate saved to $CA_FILE
  Tablet app: copy $CA_FILE to the computer that builds the app, then see android/INSTALL.md"
    fi
    break
  fi
  sleep 1
done
rm -f "$CA_FILE.tmp"

SIGN_IN_NOTE="Sign-in: none. Anyone on this network can open the researcher screen; ./docker-up.sh --password adds keys."
if grep -Eq '^DEV_RESEARCHER_KEY=.+' .env 2>/dev/null || [ -n "${DEV_RESEARCHER_KEY:-}" ]; then
  SIGN_IN_NOTE="Sign-in: researcher and operator keys are set (see .env)."
fi

cat <<EOT

Sensibilia is running.
  This computer: https://localhost:1379/researcher/
  Other devices: https://$DEV_LAN_ADDRESS:1379/researcher/
  Browsers can install the test certificate: http://$DEV_LAN_ADDRESS:1380/certificate.crt
${CA_NOTE:-No root certificate yet: run this script again once the stack is healthy.}
$SIGN_IN_NOTE
${KEY_NOTE:+$KEY_NOTE
}Backups: ./docker-up.sh backup (into $BACKUP_DIR; keep a copy on a second disk), ./docker-up.sh status
If other devices cannot connect, allow TCP ports 1379 and 1380 in this computer's firewall
(for example: sudo ufw allow 1379/tcp && sudo ufw allow 1380/tcp).
EOT
