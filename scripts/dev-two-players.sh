#!/usr/bin/env bash
# Local 2-player playtest: one Tetrad server + the web client served on two
# ports. Two ports means two browser origins, so each tab gets its own
# localStorage session (otherwise the resume tokens would clobber each other).
#
# Usage:
#   ./scripts/dev-two-players.sh
#   SERVER_PORT=9000 CLIENT1_PORT=4001 CLIENT2_PORT=4002 ./scripts/dev-two-players.sh
#   SKIP_BUILD=1 ./scripts/dev-two-players.sh   # reuse the last web build

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_PORT="${SERVER_PORT:-8080}"
CLIENT1_PORT="${CLIENT1_PORT:-3001}"
CLIENT2_PORT="${CLIENT2_PORT:-3002}"
DIST="$ROOT/apps/client/dist"

cd "$ROOT"

if [ ! -d "$ROOT/node_modules" ]; then
  echo "==> installing dependencies"
  npm install
fi

if [ "${SKIP_BUILD:-0}" != "1" ] || [ ! -f "$DIST/index.html" ]; then
  echo "==> building web client"
  (cd apps/client && CI=1 npx expo export --platform web)
fi

PIDS=()
cleanup() {
  echo
  echo "==> shutting down"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> starting game server on port $SERVER_PORT"
PORT="$SERVER_PORT" TETRAD_LOG_DIR="$ROOT/games" npx tsx packages/server/src/main.ts &
PIDS+=($!)

serve_client() {
  local port="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -m http.server "$port" --directory "$DIST" --bind 0.0.0.0 >/dev/null 2>&1 &
  else
    npx --yes serve -l "$port" -s "$DIST" >/dev/null 2>&1 &
  fi
  PIDS+=($!)
}

echo "==> serving client on ports $CLIENT1_PORT and $CLIENT2_PORT"
serve_client "$CLIENT1_PORT"
serve_client "$CLIENT2_PORT"

sleep 1
echo
echo "  Tetrad is up:"
echo "    server     ws://localhost:$SERVER_PORT"
echo "    player 1   http://localhost:$CLIENT1_PORT"
echo "    player 2   http://localhost:$CLIENT2_PORT"
echo
echo "  Open both URLs, point them at ws://localhost:$SERVER_PORT,"
echo "  Create in one tab, Join with the room code in the other."
echo "  Ctrl-C stops everything."
echo

wait
