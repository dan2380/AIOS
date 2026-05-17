#!/usr/bin/env bash
# Sync calendar-cron source from the repo to the runtime location.
# Runtime lives at ~/Library/Application Support/MainStreetTrades/calendar-cron/
# because /Users/<u>/Desktop/ is TCC-protected on macOS Sonoma+ — launchd-spawned
# processes (specifically node) get EPERM trying to read scripts there.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="$HOME/Library/Application Support/MainStreetTrades/calendar-cron"
ENV_SRC="$HERE/../.env"

mkdir -p "$RUNTIME"

cp -p "$HERE/post-calendar.js"  "$RUNTIME/post-calendar.js"
cp -p "$HERE/package.json"      "$RUNTIME/package.json"
cp -p "$HERE/run-and-post.sh"   "$RUNTIME/run-and-post.sh"
chmod +x "$RUNTIME/run-and-post.sh"

# Sync the .env so the runtime is self-contained.
if [ -f "$ENV_SRC" ]; then
  cp -p "$ENV_SRC" "$RUNTIME/.env"
  chmod 600 "$RUNTIME/.env"
else
  echo "warn: no .env at $ENV_SRC — runtime will look in $RUNTIME/.env instead"
fi

# Strip the macOS provenance xattr that re-attaches itself on every copy
# — without this, launchd's TCC layer blocks node from reading the script.
xattr -rd com.apple.provenance "$RUNTIME" 2>/dev/null || true

# Install npm deps inside the runtime (separate node_modules from the repo).
if [ ! -d "$RUNTIME/node_modules" ] || [ "$HERE/package.json" -nt "$RUNTIME/node_modules" ]; then
  echo "→ installing runtime dependencies"
  ( cd "$RUNTIME" && npm install --no-audit --no-fund --loglevel=error )
fi

echo "✓ runtime installed at: $RUNTIME"
echo "  to verify: ls -la \"$RUNTIME\""
