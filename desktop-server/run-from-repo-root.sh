#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

HOST="${COMPUTER_GUIDE_DESKTOP_HOST:-127.0.0.1}"
PORT="${COMPUTER_GUIDE_DESKTOP_PORT:-47613}"
APP_PATH="${COMPUTER_GUIDE_DESKTOP_APP_PATH:-$HOME/Applications/ComputerGuideDesktopServer.app}"
APP_EXECUTABLE="$APP_PATH/Contents/MacOS/ComputerGuideDesktopServer"

if lsof -tiTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  PID="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN | head -n 1)"
  COMMAND="$(ps -p "$PID" -o command= 2>/dev/null | sed 's/^[[:space:]]*//')"
  echo "Desktop server port $PORT is already in use by PID $PID${COMMAND:+ ($COMMAND)}." >&2
  echo "Run \`npm run desktop-server:status\` to inspect it or \`npm run desktop-server:stop\` to stop it." >&2
  exit 1
fi

if [[ ! -x "$APP_EXECUTABLE" ]]; then
  echo "Installed desktop server app not found at $APP_EXECUTABLE." >&2
  echo "Run \`npm run desktop-server:install-app\` first." >&2
  exit 1
fi

./scripts/with-dotenv.sh "$APP_EXECUTABLE"
