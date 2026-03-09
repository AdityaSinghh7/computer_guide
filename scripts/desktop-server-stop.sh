#!/usr/bin/env bash
set -euo pipefail

PORT="${COMPUTER_GUIDE_DESKTOP_PORT:-47613}"
PIDS="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN || true)"

if [[ -z "$PIDS" ]]; then
  echo "No desktop server listener found on port $PORT."
  exit 0
fi

echo "$PIDS" | while IFS= read -r pid; do
  [[ -n "$pid" ]] || continue
  kill "$pid"
  echo "Stopped desktop server process $pid on port $PORT."
done
