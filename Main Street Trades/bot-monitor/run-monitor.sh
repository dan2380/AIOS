#!/usr/bin/env bash
# Wrapper that loads .env from the uov-mirror install location (single source of
# truth for tokens/webhooks across MST daemons) and invokes monitor.py --post.
# Intended to be called by launchd on a schedule; safe to run by hand too.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─────────────────────────────────────────────────────────────────────────────
# Daily-at-6-AM-NY gate. The plist fires us at TWO system-local hours (18:00
# and 19:00 BKK, covering EDT and EST). This gate ensures only ONE of those
# actually posts a report per NY day — whichever one lands on NY hour 06. The
# gate is DST-resilient and timezone-resilient: if the laptop moves to a
# different physical timezone, the plist may fire at the wrong system hour,
# but the gate still only acts when it's truly 6 AM Eastern.
#
# Set BOT_MONITOR_FORCE=1 to bypass the gate (manual testing).
# ─────────────────────────────────────────────────────────────────────────────
NY_HOUR=$(TZ=America/New_York date +%H)
if [[ "${BOT_MONITOR_FORCE:-0}" != "1" && "$NY_HOUR" != "06" ]]; then
  echo "[$(date +%Y-%m-%dT%H:%M:%S%z)] skipping: NY hour=$NY_HOUR (gate fires at 06; set BOT_MONITOR_FORCE=1 to override)"
  exit 0
fi

ENV_FILE="$HOME/Library/Application Support/MainStreetTrades/uov-mirror/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found at $ENV_FILE" >&2
  exit 1
fi

while IFS= read -r line; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue
  [[ "$line" != *=* ]] && continue
  [[ "${line%%=*}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
  key="${line%%=*}"
  val="${line#*=}"
  if [[ "$val" =~ ^\".*\"$ ]] || [[ "$val" =~ ^\'.*\'$ ]]; then
    val="${val:1:${#val}-2}"
  fi
  export "$key=$val"
done < "$ENV_FILE"

: "${DISCORD_BOT_TOKEN:?DISCORD_BOT_TOKEN is empty}"
: "${MST_BOT_MONITOR_WEBHOOK_URL:?MST_BOT_MONITOR_WEBHOOK_URL is empty}"

exec /usr/bin/python3 -u "$HERE/monitor.py" --post
