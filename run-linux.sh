#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

export PORT=4180
export BASE_PATH="/"

mkdir -p "$ROOT_DIR/.logs"

PORT=4180 pnpm --dir "$ROOT_DIR/artifacts/api-server" run dev > "$ROOT_DIR/.logs/api.log" 2>&1 &
API_PID=$!

PORT=4173 BASE_PATH="/" pnpm --dir "$ROOT_DIR/artifacts/audi-tt-diagnostic" run dev > "$ROOT_DIR/.logs/web.log" 2>&1 &
WEB_PID=$!

cleanup() {
  echo "Stopping services..."
  kill "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "========================================================="
echo "Linux runnable stack started"
echo "API: http://localhost:4180"
echo "Web UI: http://localhost:4173"
echo "API PID: $API_PID"
echo "WEB PID: $WEB_PID"
echo "Logs:"
echo "  $ROOT_DIR/.logs/api.log"
echo "  $ROOT_DIR/.logs/web.log"
echo "========================================================="
echo "Press Ctrl+C to stop both services."
wait
