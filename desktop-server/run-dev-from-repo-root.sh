#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

./scripts/with-dotenv.sh env PATH="$HOME/.swiftly/bin:$PATH" "$HOME/.swiftly/bin/swift" run --package-path desktop-server computer-guide-desktop-server
