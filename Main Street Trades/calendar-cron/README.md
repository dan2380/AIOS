# Main Street Trades · Calendar Cron

Daily 6:00 AM ET cron that posts the trading calendar to Discord.

## What it posts

| Day | Channel | Content |
| --- | --- | --- |
| Mon | `#earnings-this-week` | Full week earnings preview (all tickers reporting Mon–Sun) |
| Tue–Fri | `#earnings-this-week` | Next-trading-day earnings list (BMO / AMC / Other) |
| Mon–Fri | `#macro-events` | High-importance US macro events for the next 24h |

If `FINNHUB_API_KEY` is not set, the earnings post is skipped (macro still runs).
Trading Economics is the guest endpoint — no key required.

## One-time setup

```bash
cd "Main Street Trades/calendar-cron"
npm install
```

Add to `Main Street Trades/.env`:

```
FINNHUB_API_KEY=...   # free signup at https://finnhub.io
```

(`DISCORD_BOT_TOKEN` and `GUILD_ID` should already be there from the discord-setup provisioner.)

## Manual run

```bash
# Smoke-test (does everything except posting to Discord)
DRY_RUN=1 ./run-and-post.sh

# Force a real post even if today's marker exists
FORCE=1 ./run-and-post.sh
```

## Install the schedule

```bash
cp scripts/launchd/com.dwang.stocks-calendar.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.dwang.stocks-calendar.plist
launchctl print gui/$UID/com.dwang.stocks-calendar | grep -E 'state|next fire'
```

The plist runs Mon–Fri 6:00 AM **ET** (`TZ=America/New_York` in `EnvironmentVariables` — survives travel / system-clock changes).

## Logs

```
_work/stocks-calendar/
├── 2026-05-14.log          ← daily wrapper log
├── launchd.out.log         ← stdout from launchd
├── launchd.err.log         ← stderr from launchd
└── markers/                ← idempotency markers (yyyy-mm-dd-{kind}.marker)
```

## Idempotency

Each post writes a date-stamped marker file. If the wrapper fires twice in one day, the second run skips. Pass `FORCE=1` to bypass.

## Troubleshooting

| Symptom | Likely fix |
| --- | --- |
| `Channel #earnings-this-week not found` | Discord-setup provisioner hasn't run, or the channel was renamed. Re-run `npm run setup` in `discord-setup/`. |
| `HTTP 401` from Finnhub | `FINNHUB_API_KEY` missing / wrong / quota exhausted. |
| `HTTP 409` posting to Discord | Bot lacks `SendMessages` in that channel. Confirm the bot still has Administrator or is in the `Mod` role. |
| Macro post shows `No high-importance events` repeatedly | Trading Economics guest API rate-limits aggressive callers. The cron only fires once/day so this is usually transient. |
