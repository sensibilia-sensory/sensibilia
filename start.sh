#!/usr/bin/env bash
# Start Sensibilia locally after ./install.sh.
#
#   ./start.sh          API and built interface on http://127.0.0.1:8000
#   ./start.sh --dev    hot-reloading developer setup (API 8001, interface 5173)
#   ./start.sh --lan    listen on all network interfaces (trusted networks only)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

[ -x .venv/bin/python ] && [ -f .env ] || { echo "Run ./install.sh first." >&2; exit 1; }

HOST=127.0.0.1
DEV=0
for arg in "$@"; do
  case "$arg" in
    --dev) DEV=1 ;;
    --lan) HOST=0.0.0.0 ;;
    -h|--help) sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$DEV" -eq 1 ]; then
  .venv/bin/python -m uvicorn sensibilia.main:app --reload --host "$HOST" --port 8001 &
  API=$!
  trap 'kill "$API" 2>/dev/null' EXIT INT TERM
  echo "Researcher workspace: http://127.0.0.1:5173/researcher/"
  npm --prefix frontend run dev
else
  [ -d frontend/dist ] || { echo "No built interface found; run ./install.sh (without --dev)." >&2; exit 1; }
  echo "Researcher workspace: http://127.0.0.1:8000/researcher/   (Ctrl+C to stop)"
  exec .venv/bin/python -m uvicorn sensibilia.main:app --host "$HOST" --port 8000
fi
