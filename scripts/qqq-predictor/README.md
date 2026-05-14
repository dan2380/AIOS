# QQQ Predictor

Heuristic call for QQQ's direction 30 minutes after the open (10:00 ET).
Free data only: yfinance + Finnhub free tier (optional). Posts to Discord.

## Setup

```bash
cd scripts/qqq-predictor
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Optional env vars (add to `~/Desktop/CosmeticsGrowthAI/AI OS/.env`):

```
DISCORD_QQQ_WEBHOOK_URL=https://discord.com/api/webhooks/...
FINNHUB_API_KEY=ck_...
```

## Run

```bash
./run-and-post.sh
```

Output: directional call (UP/DOWN), confidence (LOW/MED/HIGH), signed score,
drivers, downside scenario. Also dumps the raw snapshot JSON for audit.

## Schedule (launchd at 09:25 ET on weekdays)

`StartCalendarInterval` fires at the Mac's **system** timezone, not at
`TZ=America/New_York` from the env dict. Set the Mac to ET, or compute the
offset and edit the plist. Pre-create the log directory before bootstrap or
launchd will fail to open `StandardOutPath`/`StandardErrorPath`.

```bash
mkdir -p "_work/qqq-predictor"
cp scripts/launchd/com.dwang.qqq-predictor.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dwang.qqq-predictor.plist
```

Then run `/verify-scheduled-job com.dwang.qqq-predictor` per the
[mandatory pre-flight rule](../../CLAUDE.md).

## Signals

| Signal | Weight | Notes |
| --- | --- | --- |
| NQ/QQQ pre-market gap | 1.2× | Primary. Falls back to QQQ if futures missing. |
| VIX regime | ±0.4 / 1.15× | High VIX fades the gap; low VIX amplifies continuation. |
| Asia/Europe (N225/DAX/FTSE) | 0.25× each | Overnight tape tilt. |
| News tilt (Finnhub) | 0.3× | Keyword sentiment, [-1, +1]. |

Score ≥ 0 → UP. `|score| ≥ 0.7` → HIGH, `≥ 0.25` → MED, else LOW.

## Limits

Not investment advice. Heuristic, not a model. Pre-market liquidity is thin —
single prints can mislead. Always treat the call as a prior, not a trade.
