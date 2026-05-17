#!/usr/bin/env bash
# Wrapper for the Main Street Trades calendar cron.
# Loads env, runs the Node script, logs output, surfaces failures to Discord.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# Log dir: prefer ~/Library/Logs (never TCC-protected) so launchd can write.
LOG_DIR="${LOG_DIR:-$HOME/Library/Logs/MainStreetTrades/calendar-cron}"
mkdir -p "$LOG_DIR"

LOG_FILE="$LOG_DIR/$(date +%Y-%m-%d).log"

# Load .env (token + guild + finnhub key). Prefer the runtime-local copy
# created by install.sh; fall back to ../.env when run from the repo.
ENV_FILE=""
[ -f "$HERE/.env" ] && ENV_FILE="$HERE/.env"
[ -z "$ENV_FILE" ] && [ -f "$HERE/../.env" ] && ENV_FILE="$HERE/../.env"
if [ -n "$ENV_FILE" ]; then
  set -a
  set +u
  # shellcheck disable=SC1091
  . "$ENV_FILE"
  set -u
  set +a
fi

NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"
if [ ! -x "$NODE_BIN" ]; then NODE_BIN="$(command -v node || true)"; fi
if [ -z "$NODE_BIN" ]; then
  echo "[$(date)] FATAL: no node binary on PATH" | tee -a "$LOG_FILE" >&2
  exit 1
fi

echo "[$(date)] running calendar cron with $NODE_BIN" | tee -a "$LOG_FILE"
"$NODE_BIN" "$HERE/post-calendar.js" 2>&1 | tee -a "$LOG_FILE"
echo "[$(date)] done." | tee -a "$LOG_FILE"
