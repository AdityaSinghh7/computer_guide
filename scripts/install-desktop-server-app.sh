#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_PATH="${COMPUTER_GUIDE_DESKTOP_APP_PATH:-$HOME/Applications/ComputerGuideDesktopServer.app}"
APP_CONTENTS="$APP_PATH/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_BINARY="$APP_MACOS/ComputerGuideDesktopServer"
INFO_PLIST="$APP_CONTENTS/Info.plist"
BUNDLE_ID="${COMPUTER_GUIDE_DESKTOP_BUNDLE_ID:-com.computerguide.desktopserver}"
CODESIGN_IDENTITY="${COMPUTER_GUIDE_DESKTOP_CODESIGN_IDENTITY:--}"

mkdir -p "$HOME/Applications"
cd "$REPO_ROOT"

env PATH="$HOME/.swiftly/bin:$PATH" "$HOME/.swiftly/bin/swift" build --configuration release --package-path desktop-server

BUILD_BINARY="$(find "$REPO_ROOT/desktop-server/.build" -path '*/release/computer-guide-desktop-server' -type f | head -n 1)"
if [[ -z "$BUILD_BINARY" ]]; then
  echo "Failed to locate built desktop server binary." >&2
  exit 1
fi

rm -rf "$APP_PATH"
mkdir -p "$APP_MACOS"

cat > "$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>ComputerGuideDesktopServer</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>Computer Guide Desktop Server</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSBackgroundOnly</key>
  <true/>
</dict>
</plist>
PLIST

cp "$BUILD_BINARY" "$APP_BINARY"
chmod +x "$APP_BINARY"
codesign --force --deep --sign "$CODESIGN_IDENTITY" "$APP_PATH"

echo "Installed desktop server app at $APP_PATH"
echo "Bundle ID: $BUNDLE_ID"
