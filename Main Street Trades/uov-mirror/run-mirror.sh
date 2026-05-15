#!/usr/bin/env bash
# Wrapper that loads ../.env and invokes ws_wh_call.py with the
# UOV_MIRROR_* variables. Run from anywhere:
#   ./run-mirror.sh
# Logs to stdout — wrap in nohup / launchd / tmux for persistence.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Prefer co-located .env (runtime install pattern); fall back to repo-root .env.
if [[ -f "$HERE/.env" ]]; then
  ENV_FILE="$HERE/.env"
else
  ENV_FILE="$HERE/../.env"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found at $ENV_FILE" >&2
  exit 1
fi

# Export every KEY=VAL line (skip comments/blank). Values may contain spaces,
# so split on the first `=` and assign safely rather than eval'ing the line.
while IFS= read -r line; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue
  [[ "$line" != *=* ]] && continue
  # Must look like a valid identifier on the left side.
  [[ "${line%%=*}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
  key="${line%%=*}"
  val="${line#*=}"
  if [[ "$val" =~ ^\".*\"$ ]] || [[ "$val" =~ ^\'.*\'$ ]]; then
    val="${val:1:${#val}-2}"
  fi
  export "$key=$val"
done < "$ENV_FILE"

: "${UOV_MIRROR_USER_TOKEN:?UOV_MIRROR_USER_TOKEN is empty — fill it in .env}"
: "${UOV_MIRROR_SOURCE_SERVER_ID:?UOV_MIRROR_SOURCE_SERVER_ID is empty}"

# Build the routes JSON from individual route blocks in .env.
# Add a new route by setting <PREFIX>_SOURCE_CHANNEL_ID, _WEBHOOK_URL, _WEBHOOK_NAME.
ROUTES_JSON=$(python3 - <<'PY'
import json, os
routes = []
def add(prefix, source_key):
    ch = os.environ.get(source_key) or os.environ.get(f"{prefix}SOURCE_CHANNEL_ID")
    wh = os.environ.get(f"{prefix}WEBHOOK_URL")
    nm = os.environ.get(f"{prefix}WEBHOOK_NAME")
    override = os.environ.get(f"{prefix}DISPLAY_NAME_OVERRIDE")
    if ch and wh:
        route = {"channel": ch, "webhook": wh, "webhook_name": nm or ""}
        if override:
            route["display_name_override"] = override
        routes.append(route)

# UOV_MIRROR_ route removed 2026-05-16 — Tradytics now pings MST directly.
# (UOV_MIRROR_USER_TOKEN + UOV_MIRROR_SOURCE_SERVER_ID are kept in .env because
# they're the shared selfbot auth + source guild for every route below.)
add("CHARLIE_IDEAS_MIRROR_",    "Charlie_Options_Channel_ID")
add("EARNINGS_MIRROR_",         "EARNINGS_MIRROR_SOURCE_CHANNEL_ID")
add("MORNING_BRIEFING_MIRROR_", "MORNING_BRIEFING_MIRROR_SOURCE_CHANNEL_ID")
add("STOCK_BRIEFS_MIRROR_",     "STOCK_BRIEFS_MIRROR_SOURCE_CHANNEL_ID")
add("CHARLIE_LEAPS_MIRROR_",    "CHARLIE_LEAPS_MIRROR_SOURCE_CHANNEL_ID")
add("LONG_TERM_PRICE_MIRROR_",  "LONG_TERM_PRICE_MIRROR_SOURCE_CHANNEL_ID")
print(json.dumps(routes))
PY
)
[[ "$ROUTES_JSON" == "[]" ]] && { echo "no routes configured in .env" >&2; exit 1; }

PY="$HERE/.venv/bin/python"
[[ -x "$PY" ]] || PY="python3"

# -u: unbuffered stdout/stderr so launchd log files reflect activity in real time.
exec "$PY" -u "$HERE/ws_wh_call.py" \
  --source_server "$UOV_MIRROR_SOURCE_SERVER_ID" \
  --routes        "$ROUTES_JSON" \
  --auth_token    "$UOV_MIRROR_USER_TOKEN"
