#!/usr/bin/env bash
set -euo pipefail

APP="/Applications/Messages.app/Contents/MacOS/Messages"

if [[ ! -x "$APP" ]]; then
  echo "Messages.app not found at /Applications/Messages.app — run npm run install:app first." >&2
  exit 1
fi

echo "Triggering batch notification test (5 messages, 8s apart)…"
"$APP" --run-notification-tests
