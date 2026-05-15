#!/usr/bin/env bash
# Sync follow-the-money source from the repo to the runtime location
# (~/Library/Application Support/MainStreetTrades/follow-the-money/),
# create Discord webhooks if not yet recorded in .env, and ensure the
# launchd plist is loaded.
#
# Why a separate runtime path: /Users/.../Desktop/ is TCC-protected on
# macOS Sonoma+ — launchd-spawned processes can't read scripts there.
# Same pattern as the uov-mirror + calendar-cron jobs.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
RUNTIME="$HOME/Library/Application Support/MainStreetTrades/follow-the-money"
LOG_DIR="$HOME/Library/Logs/MainStreetTrades/follow-the-money"
ENV_SRC="$HERE/../.env"
PLIST_LABEL="com.dwang.mst-follow-the-money"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

mkdir -p "$RUNTIME" "$RUNTIME/state" "$LOG_DIR"

# ── 1. Sync source files ──────────────────────────────────────────────
cp -p "$HERE/poll.py"            "$RUNTIME/poll.py"
cp -p "$HERE/run-poll.sh"        "$RUNTIME/run-poll.sh"
cp -p "$HERE/create-webhooks.py" "$RUNTIME/create-webhooks.py"
cp -p "$HERE/README.md"          "$RUNTIME/README.md" 2>/dev/null || true
chmod +x "$RUNTIME/run-poll.sh"

if [[ -f "$ENV_SRC" ]]; then
  cp -p "$ENV_SRC" "$RUNTIME/.env"
  chmod 600 "$RUNTIME/.env"
else
  echo "warn: no .env at $ENV_SRC — runtime will fail until one is placed at $RUNTIME/.env" >&2
fi

# Strip the macOS provenance xattr (same fix as calendar-cron — without
# this, launchd's TCC layer blocks python from reading the scripts).
xattr -rd com.apple.provenance "$RUNTIME" 2>/dev/null || true

# ── 2. Ensure webhooks exist + recorded in .env ────────────────────────
# Use the same safe loader as run-poll.sh — split on first =, no eval, skip
# lines that aren't VAR=val. Handles values containing spaces and quotes.
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
done < "$ENV_SRC"

NEED_INSIDER="${FTM_INSIDER_WEBHOOK_URL:-}"
NEED_POL="${FTM_POLITICIAN_WEBHOOK_URL:-}"

if [[ -z "$NEED_INSIDER" || -z "$NEED_POL" ]]; then
  if [[ -z "${DISCORD_BOT_TOKEN:-}" ]]; then
    echo "ERROR: DISCORD_BOT_TOKEN missing from $ENV_SRC — cannot create webhooks" >&2
    exit 1
  fi
  echo "→ creating Discord webhooks via bot…"
  WH_OUT="$(DISCORD_BOT_TOKEN="$DISCORD_BOT_TOKEN" python3 "$HERE/create-webhooks.py")"
  echo "$WH_OUT"

  # Append to .env, but only the keys not already present.
  while IFS='=' read -r key val; do
    [[ -z "$key" ]] && continue
    if grep -q "^${key}=" "$ENV_SRC"; then
      # Overwrite in place (handles re-runs after channel rotation).
      python3 - "$ENV_SRC" "$key" "$val" <<'PY'
import sys, pathlib
path, key, val = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(path)
lines = p.read_text().splitlines()
out = []
replaced = False
for line in lines:
    if line.startswith(f"{key}="):
        out.append(f"{key}={val}")
        replaced = True
    else:
        out.append(line)
if not replaced:
    out.append(f"{key}={val}")
p.write_text("\n".join(out) + "\n")
PY
    else
      printf "\n%s=%s\n" "$key" "$val" >> "$ENV_SRC"
    fi
  done <<< "$WH_OUT"

  # Make sure SEC UA + politician webhook are also present (template defaults).
  if ! grep -q '^FTM_SEC_USER_AGENT=' "$ENV_SRC"; then
    printf 'FTM_SEC_USER_AGENT=Main Street Trades dan@cosmeticsgrowth.com\n' >> "$ENV_SRC"
  fi
  if ! grep -q '^FMP_API_KEY=' "$ENV_SRC"; then
    printf 'FMP_API_KEY=\n' >> "$ENV_SRC"
    echo "  (FMP_API_KEY left blank — politician feed will no-op until you add a free key from https://site.financialmodelingprep.com/developer)"
  fi
  # Re-sync runtime .env now that we've updated source.
  cp -p "$ENV_SRC" "$RUNTIME/.env"
  chmod 600 "$RUNTIME/.env"
else
  echo "→ webhooks already configured in .env — skipping creation"
fi

# ── 3. Install / refresh launchd plist ─────────────────────────────────
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>"\$HOME/Library/Application Support/MainStreetTrades/follow-the-money/run-poll.sh"</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${RUNTIME}</string>

  <key>RunAtLoad</key>
  <true/>

  <!-- Fire every 60s. SEC EDGAR Atom is the only hot source; politician
       sources are throttled internally to every 5 cycles (~5 min). -->
  <key>StartInterval</key>
  <integer>60</integer>

  <key>ThrottleInterval</key>
  <integer>30</integer>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>TZ</key>
    <string>America/New_York</string>
  </dict>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/launchd.err.log</string>
</dict>
</plist>
PLIST

xattr -d com.apple.provenance "$PLIST_PATH" 2>/dev/null || true

# Bootstrap / re-bootstrap the agent.
UID_NUM="$(id -u)"
launchctl bootout "gui/${UID_NUM}/${PLIST_LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/${UID_NUM}" "$PLIST_PATH"
launchctl enable "gui/${UID_NUM}/${PLIST_LABEL}"

echo "✓ runtime: $RUNTIME"
echo "✓ logs:    $LOG_DIR/launchd.{out,err}.log"
echo "✓ plist:   $PLIST_PATH"
echo "→ next launch: ~60s (StartInterval). Tail logs with:"
echo "    tail -f \"$LOG_DIR/launchd.out.log\""
