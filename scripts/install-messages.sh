#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="/Applications/Messages.app"

echo "Quitting Messages..."
osascript -e 'tell application "Messages" to quit' 2>/dev/null || true
sleep 1
pkill -x Messages 2>/dev/null || true
sleep 1

echo "Building..."
cd "$ROOT"
npm run pack

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$ROOT/dist/mac-arm64/Messages.app/Contents/Info.plist")"
echo "Built version: $VERSION"

echo "Installing to $APP..."
rm -rf "$APP"
cp -R "$ROOT/dist/mac-arm64/Messages.app" "$APP"

INSTALLED="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
echo "Installed version: $INSTALLED"

if [[ "${1:-}" != "--no-open" ]]; then
  open "$APP"
fi
echo "Done."
