#!/usr/bin/env bash
# Local installation of Sensibilia (development / single-machine use).
#
#   ./install.sh [--password] [--no-frontend] [--dev]
#
# By default no sign-in is needed; --password generates keys.
# Safe to re-run: keeps an existing .env and database data, and only applies
# migrations to the database named in .env after printing what it is about to do.
# Afterwards run ./start.sh. For the production Docker deployment use
# scripts/laboratory.py (see README).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

WITH_FRONTEND=1
BUILD=1
NO_PASSWORD=1
for arg in "$@"; do
  case "$arg" in
    --no-frontend) WITH_FRONTEND=0 ;;
    --password) NO_PASSWORD=0 ;;
    --dev) BUILD=0 ;;
    -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

info() { printf '\n==> %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

# --- Prerequisites -----------------------------------------------------------
info "Checking prerequisites"
PYTHON="${PYTHON:-}"
if [ -z "$PYTHON" ]; then
  for candidate in python3.13 python3 python; do
    if command -v "$candidate" >/dev/null 2>&1 \
      && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 13))' 2>/dev/null; then
      PYTHON="$candidate"
      break
    fi
  done
fi
[ -n "$PYTHON" ] || die "Python 3.13 or newer is required (set PYTHON=/path/to/python3.13)."
echo "Python: $("$PYTHON" --version)"

if [ "$WITH_FRONTEND" -eq 1 ]; then
  command -v node >/dev/null 2>&1 || die "Node.js 22.12+ or 24+ is required (or use --no-frontend)."
  command -v npm >/dev/null 2>&1 || die "npm is required (or use --no-frontend)."
  node -e '
    const [maj, min] = process.versions.node.split(".").map(Number);
    process.exit(maj > 22 || (maj === 22 && min >= 12) ? 0 : 1);
  ' || die "Node.js 22.12+ or 24+ is required; found $(node --version)."
  echo "Node: $(node --version)"
fi

# --- Python environment ------------------------------------------------------
info "Creating virtual environment (.venv)"
[ -d .venv ] || "$PYTHON" -m venv .venv
VENV_PY=".venv/bin/python"

info "Installing Python dependencies from requirements-dev.lock"
"$VENV_PY" -m pip install --quiet --upgrade pip
"$VENV_PY" -m pip install --quiet -r requirements-dev.lock
"$VENV_PY" -m pip install --quiet --no-deps -e .

# --- Configuration -----------------------------------------------------------
info "Creating local configuration (.env)"
if [ "$NO_PASSWORD" -eq 1 ]; then
  "$VENV_PY" scripts/init_local.py --no-password
  echo "No sign-in is required. Keep the server on this machine or a trusted network."
else
  "$VENV_PY" scripts/init_local.py
fi
chmod 600 .env

if ! grep -Eq '^SENSIBILIA_OPERATOR_TOKEN(_FILE)?=' .env; then
  if [ "$NO_PASSWORD" -eq 1 ]; then
    printf 'SENSIBILIA_OPERATOR_TOKEN=\n' >> .env   # serving enabled, no sign-in
  else
    info "Adding a separate operator (serving staff) key to .env"
    printf 'SENSIBILIA_OPERATOR_TOKEN=%s\n' "$("$VENV_PY" -c 'import secrets; print(secrets.token_urlsafe(48))')" >> .env
  fi
fi

mkdir -p data

# --- Database ----------------------------------------------------------------
info "Applying database migrations"
DB_URL="$(grep -E '^SENSIBILIA_DATABASE_URL=' .env | tail -n1 | cut -d= -f2-)"
echo "Database: ${DB_URL:-sqlite:///./data/sensibilia.db}"
if [ -f data/sensibilia.db ]; then
  echo "An existing database was found; back it up first if it holds collected data."
  echo "Copying it to data/sensibilia.db.pre-install before migrating."
  cp -n data/sensibilia.db "data/sensibilia.db.pre-install"
fi
"$VENV_PY" -m alembic upgrade head

# --- Frontend ----------------------------------------------------------------
if [ "$WITH_FRONTEND" -eq 1 ]; then
  info "Installing frontend dependencies"
  npm --prefix frontend ci
  if [ "$BUILD" -eq 1 ]; then
    info "Building the frontend (served by the API from frontend/dist)"
    npm --prefix frontend run build
  fi
fi

# --- Done --------------------------------------------------------------------
printf '\nInstallation complete.\n\n  Start:  ./start.sh\n  Open:   http://127.0.0.1:8000/researcher/\n'
if grep -Eq '^SENSIBILIA_RESEARCHER_TOKEN=.+' .env; then
  printf '  Sign in with SENSIBILIA_RESEARCHER_TOKEN from .env\n'
else
  printf '  No sign-in needed. Re-create .env with --password for a key.\n'
fi
[ "$BUILD" -eq 1 ] || printf '\nDevelopment mode: run ./start.sh --dev for hot reload on http://127.0.0.1:5173/researcher/\n'
