#!/usr/bin/env bash
set -euo pipefail

PORT="${COMPUTER_GUIDE_DESKTOP_PORT:-47613}"

if ! lsof -nP -iTCP:"$PORT" -sTCP:LISTEN; then
  echo "No desktop server listener found on port $PORT."
fi
