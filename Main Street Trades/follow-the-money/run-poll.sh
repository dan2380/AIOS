#!/usr/bin/env bash
# Wrapper for poll.py — loads ../.env (or co-located .env at runtime path)
# and invokes poll.py once. Designed to be called every 60s by launchd
# via StartInterval. Logs to stdout — launchd routes to log files.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$HERE/.env" ]]; then
  ENV_FILE="$HERE/.env"
else
  ENV_FILE="$HERE/../.env"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found at $ENV_FILE" >&2
  exit 1
fi

# Safe env loader (same shape as uov-mirror/run-mirror.sh): split on first =,
# don't eval, skip lines that aren't VAR=val.
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

# Webhooks + UA must be present. FMP key is optional (politician feed no-ops without it).
: "${FTM_INSIDER_WEBHOOK_URL:?FTM_INSIDER_WEBHOOK_URL is empty — run install.sh to create webhooks}"
: "${FTM_POLITICIAN_WEBHOOK_URL:?FTM_POLITICIAN_WEBHOOK_URL is empty — run install.sh to create webhooks}"
: "${FTM_SEC_USER_AGENT:?FTM_SEC_USER_AGENT is empty — SEC requires identification}"

PY="$HERE/.venv/bin/python"
[[ -x "$PY" ]] || PY="python3"

exec "$PY" -u "$HERE/poll.py"
