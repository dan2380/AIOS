# Follow the Money

MST poller that mirrors two free public-money signals into Discord:

| Channel | Source | Latency | Auth needed |
|---|---|---|---|
| `1504326226175725730` — Insider Buys | SEC EDGAR Form 4 Atom feed, filtered to open-market purchases (code `P`) | ~60s | none |
| `1504326222078021794` — Politician Trades | Financial Modeling Prep `stable/senate-latest` + `stable/house-latest` | ~15 min | free FMP API key |

## How it runs

- One `launchctl` agent: `com.dwang.mst-follow-the-money`
- Fires `run-poll.sh` every 60s
- Insider-buy poll: every cycle (60s)
- Politician poll: every 15th cycle (~15 min) — sized to keep us under FMP's 250-call/day free quota (2 endpoints × 96 cycles/day = 192/day, ~58 in reserve for retries / manual tests)
- State files live at `~/Library/Application Support/MainStreetTrades/follow-the-money/state/`

## Install

```bash
cd "Main Street Trades/follow-the-money"
./install.sh
```

`install.sh` will:

1. Copy source into the TCC-safe runtime path (`~/Library/Application Support/MainStreetTrades/follow-the-money/`)
2. Create the two Discord webhooks via the MST bot, idempotently (reuses any with the same name)
3. Append webhook URLs + SEC user-agent + blank `FMP_API_KEY` to the shared `.env`
4. Write + bootstrap the launchd plist

## Lighting up politician trades

The insider-buy channel works out of the box.

The politician channel waits until `FMP_API_KEY` is set:

1. Sign up free: <https://site.financialmodelingprep.com/developer> (250 req/day quota — we use ~96/day)
2. Paste the key into `Main Street Trades/.env`:
   ```
   FMP_API_KEY=your_key_here
   ```
3. Re-run `./install.sh` to sync the runtime `.env`
4. Politician posts begin within ~5 min on next cycle

## Dry-run

```bash
FTM_DRY_RUN=1 ./run-poll.sh
```

Prints would-be webhook payloads to stdout; no state writes, no Discord posts.

## Files

| Path | Role |
|---|---|
| `poll.py` | Main script — SEC parsing + FMP fetch + Discord posting |
| `run-poll.sh` | Env loader + invocation wrapper |
| `create-webhooks.py` | One-shot: creates the two webhooks via bot, idempotent |
| `install.sh` | Sync runtime + create webhooks + install launchd plist |

## State

| File | Purpose |
|---|---|
| `state/insider_seen.txt` | One SEC accession per line — already-posted Form 4s |
| `state/senate_seen.txt` | Composite keys for Senate disclosures |
| `state/house_seen.txt` | Composite keys for House disclosures |
| `state/cycle.txt` | Monotonic cycle counter (gates politician polls) |

On first run, the poller records the current state of each feed without
posting (no backlog flood). Posts begin on cycle 2+.

## First-cycle behaviour

| Source | Cycle 1 | Cycle 2+ |
|---|---|---|
| SEC insider buys | Record ~100 accessions, post 0 | Post new Form 4 buys, cap 8/cycle |
| Senate (FMP) | Record current page, post 0 | Post new rows, cap 8/cycle |
| House (FMP) | Record current page, post 0 | Post new rows, cap 8/cycle |

The 8/cycle cap exists so a sudden backlog (e.g. SEC's daily 4pm filing surge)
doesn't dump 40+ embeds at once — the rest queue and post over subsequent
cycles.

## Tail logs

```bash
tail -f "$HOME/Library/Logs/MainStreetTrades/follow-the-money/launchd.out.log"
```

## Why FMP for politicians (and not free JSON dumps)?

The house-stock-watcher and senate-stock-watcher S3 buckets all returned 403 by
2026 (project went stale circa 2023). CapitolTrades' public BFF endpoint returns
503 from a broken Lambda. Quiver Quantitative requires auth on every endpoint.

FMP's free tier (250 req/day) covers our polling budget with margin. The
`stable/senate-latest` and `stable/house-latest` endpoints return the 100 most
recent disclosures per chamber with full transaction details (ticker, type,
amount range, transaction + disclosure dates, owner, district, official PDF
link). Note: the older `/api/v4/*-rss-feed` endpoints were retired Aug 31 2025
and now 403 with a "Legacy Endpoint" message.

## Why SEC direct for insiders?

SEC EDGAR is the source of truth — every paid service is reselling this data.
The Atom feed updates within ~1 min of filing acceptance. Polling every 60s
gives end-to-end latency under 2 min from filing → Discord.
