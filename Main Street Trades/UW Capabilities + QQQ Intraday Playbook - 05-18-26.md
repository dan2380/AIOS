# Unusual Whales — Capabilities Map + QQQ Intraday Playbook

Captured 2026-05-18 from a live Playwright session on Daniel's logged-in UW Retail Pro account. The capabilities list is what is reachable in the UI right now; the QQQ playbook is the operational sequence to use those tools to read intraday direction.

---

## Part 1 — UW Capabilities Map

UW is organized as: per-ticker pages (deep), market-wide tools (broad), and live streams. The taxonomy below maps every meaningful page to what it answers.

### A. Per-ticker pages — `/stock/{TICKER}/{view}`

All 28 views are available for any optionable ticker. Highest-signal ones marked ⭐.

| Slug | What it shows | Best for |
|---|---|---|
| `overview` | Price, vol, premium, put/call breakdown, dark-pool % per $1 price bucket, options-volume chart | Quick read on the day so far |
| ⭐ `greek-exposure` | GEX, DEX, Vanna, Charm — gamma heatmap by strike + price, put wall, call wall, gamma flip, 0DTE GEX, gamma decay schedule, **interpreted volatility regime** (Explosive / Stable / Dampening) | Single most predictive page for intraday direction |
| ⭐ `nope` | NOPE (Net Options Pricing Effect), COPE, Ratio. Bullish/Neutral/Bearish volume overlay on price chart. Most-active chains table | Quantifies how dealer hedging will push spot |
| ⭐ `net-premium` | Real-time net put premium (NPP), net call premium (NCP), cumulative directional delta, net premium by expiry, net premium by strike | "Where is the money going right now?" |
| ⭐ `darkpool` | Block trades >10K shares on this ticker. Time, size, $ value | Institutional accumulation/distribution |
| `volatility` | IV term structure, IV percentile, put-call skew | Skew flip = positioning rotation |
| `heatmap` | (ETFs only) Component contribution heatmap | For QQQ — see which Mag-7 names are leading/lagging |
| `open-interest-changes` | OI change per strike today | Where new positions are being put on |
| `options-charting` | Multi-overlay options charts | Custom analysis |
| `option-chains` | Full option chain | Single-strike inspection |
| `greeks` | Greeks per contract | Pricing sanity-check |
| `flow-alerts` | UW's algorithmic unusual-flow flags on this ticker | Live unusual-trade alerts |
| `options-flow-history` | Historical flow (n-day lookback) | Backtest a thesis |
| `risk` | UW risk model | Risk score |
| `shorts` | Short interest, days-to-cover | Squeeze setup detection |
| `institutions` | 13F holdings | Slow-moving context |
| `seasonality` | Historical month/day-of-month patterns | Slow-moving context |
| `chart` | Standard price chart | Visual TA |
| `earnings` | Earnings dates + reactions | Event risk |
| `dividends` | Distribution history | Ex-div windows |
| `stock-talk` | Community discussion | Sentiment color |

### B. Market-wide tools

| URL | What it gives you |
|---|---|
| `/live-options-flow` | The full live flow stream (default — apply MST High Conviction filter via `?watchlist_name=MST%20High%20Conviction` query string) |
| `/live-options-flow/saved` | All your saved filters |
| `/zero-dte` | 0DTE-specific flow, separated from the main stream |
| `/interval-flow` | Bucketed flow at 5-min / 15-min / 1-hr resolution |
| `/flow/super` | "Super Dashboard" — composite view across multiple flow streams |
| `/option-flow-alerts` | Market-wide algorithmic unusual-flow alerts |
| `/options-screener` | Screen option contracts by Vol/OI, IV, delta, premium, etc. |
| `/stock-screener` | Pre-built stock screens (Advancers, Decliners, 52w Highs/Lows) |
| `/predictions` | UW's prediction-market product |
| `/earnings` | Earnings calendar (this week + next week) |

### C. Sidebar categories (collapsed groupings)

The left nav organizes everything under nine collapsible categories:

- **Options Flow** — flow streams, alerts, screeners
- **Tickers** — per-ticker pages (deep tools above)
- **Market** — aggregate market views (Market Tide, sector breakdowns)
- **Periscope** — UW's macro/sector lens (newer)
- **Predictions** — prediction markets
- **My Workspace** — saved filters, watchlists
- **Tools** — utilities (calculators, etc.)
- **Data Access / API** — API docs + the MCP server pointer
- **More** — overflow

Bottom-of-sidebar buckets:
- FLOW & OPTIONS / MARKET DATA / CONGRESS & POLITICS / COMMUNITY / HELP & RESOURCES / PARTNERS

### D. The Mr. Whale AI assistant

Floating button bottom-right. Natural-language queries against UW data. Examples it ships with:

- "Summarize the most unusual options flow in mega-cap tech today"
- "What are the top bullish sweeps from today over $500K premium?"
- "Show me the largest option trades by premium excluding ETFs and indices"
- "Compare MSFT and GOOGL fundamentals"
- "Show me the top institutional holders of AAPL"

Treat this as a fallback for ad-hoc questions you don't want to navigate to.

### E. The API (paid tier, not currently subscribed)

UW publishes everything we'd need if we ever upgrade. Key endpoints from `unusualwhales.com/skill.md`:

| Endpoint | Data |
|---|---|
| `/api/option-trades/flow-alerts` | Unusual flow trades |
| `/api/screener/option-contracts` | Hottest chains by vol/OI |
| `/api/stock/{T}/flow-recent` | Stock-specific unusual activity |
| `/api/market/market-tide` | **Aggregate call/put premium flows market-wide** |
| `/api/stock/{T}/net-prem-ticks` | Tick-level NPP/NCP |
| `/api/stock/{T}/greeks` | Greeks by strike/expiry |
| `/api/stock/{T}/spot-exposures/strike` | **Real-time GEX by strike** |
| `/api/stock/{T}/greek-exposure/strike` | Historical gamma maps |
| `/api/stock/{T}/interpolated-iv` | IV surface |
| `/api/stock/{T}/options-volume` | Activity ratios |
| `/api/darkpool/{T}` | Dark pool for ticker |
| `/api/darkpool/recent` | Market-wide dark pool |
| `/api/stock/{T}/technical-indicator/{f}` | RSI, MACD, BBands, Stoch, VWAP, MAs |
| `/api/stock/{T}/financials` | Financials |
| `/api/stock/{T}/earnings` | Earnings |

**Upgrade path:** wire the official MCP server at `https://unusualwhales.com/public-api/mcp` into `.mcp.json` if we ever buy the API tier. That replaces the Playwright scraper entirely.

---

## Part 2 — QQQ Intraday Prediction Playbook

Below is a five-step morning routine + intraday checks. Each step uses one UW page and answers one question. By the end you have a directional bias, levels, and confidence.

### The intraday-direction stack — what each tool actually predicts

Stop thinking of QQQ as one chart. It's the product of three forces, and UW exposes each:

1. **Dealer hedging regime** (forced flows) — drives the actual mechanical movement
2. **Positioning** (where money is open) — sets the "want"
3. **Speculation** (0DTE / unusual flow today) — adds short-term pressure

| Force | UW page | Numeric signal | What you read |
|---|---|---|---|
| Dealer regime | `/stock/QQQ/greek-exposure` | Volatility Regime label (Explosive / Stable / Dampening), Γ / V / C scores | If Explosive + negative Γ → moves accelerate. If Dampening + positive Γ → moves get sucked back to call wall = chop / pin |
| Positioning | `/stock/QQQ/net-premium` | NPP, NCP, cumulative Dir Delta | NPP negative + NCP positive = bullish (money paying for calls, fading puts). Opposite = bearish |
| Speculation | `/zero-dte` (filter to QQQ) and `/stock/QQQ/nope` | NOPE value + sign, 0DTE call/put volume imbalance | NOPE deeply negative = puts pricing dominates = mechanical downward pressure as dealers hedge |
| Components | `/stock/QQQ/heatmap` | Mag-7 contribution | If NVDA + MSFT green and AAPL red, QQQ is bid by the big two; if leaders red, no bid |
| Block flow | `/stock/QQQ/darkpool` and `/darkpool` | Recent large prints | Heavy buy-side dark pool with green tape = real institutional accumulation |
| Macro | `/market/...` (Market Tide) and `/zero-dte` for SPX/SPY | Aggregate net premium across market | Confirms QQQ isn't fighting the broader tape |

### The 5-step morning routine (pre-market → first hour)

**Step 1 — Read the regime (30 sec).** Open `/stock/QQQ/greek-exposure`. Look only at the upper-right "VOLATILITY REGIME" card.

- **Explosive** = trending day expected. Trade breakouts of the accel levels.
- **Stable** = mean-revert to the call wall / pin. Trade the range, fade extremes.
- **Dampening** = consolidation. Sit on hands or sell premium.

Also note Γ (gamma): negative number = dealers short gamma = they have to sell rallies and buy dips amplified. Positive Γ = the opposite — they suppress.

**Step 2 — Locate the levels (30 sec).** Same page, "CLOSEST LEVELS" card.

- **Put Wall** = support (large gamma below spot, dealers defend it)
- **Call Wall** = resistance (large gamma above spot, dealers defend it)
- **Accel ↓** = next short-gamma pocket below spot. Break → acceleration down.
- **Accel ↑** = next short-gamma pocket above spot. Break → acceleration up.
- **Gamma flip** = the spot price where dealer gamma flips sign. Above = stabilizing; below = destabilizing.

**Step 3 — Read the money (45 sec).** Open `/stock/QQQ/net-premium`. Look at the bottom-left readout (current values of NPP and NCP).

- **NPP > 0 and NCP > 0** → bullish (calls being bought, puts being sold)
- **NPP < 0 and NCP < 0** → bearish (puts being bought, calls being sold)
- **Split signs** → uncertain — wait for confluence

Also glance at the "Net Premium by Strike" panel for the day's big up- and down-tilt strikes.

**Step 4 — Confirm with NOPE (30 sec).** Open `/stock/QQQ/nope`. Look at the NOPE value vs its 30D median.

- NOPE near zero = balanced
- NOPE deeply negative = put-pricing dominant = mechanical downward pressure
- NOPE deeply positive = call-pricing dominant = mechanical upward pressure

Below the chart, scan the "Most Active Chains" table — note which strikes have the highest Vol AND high bid/ask % (the BAS column). Strikes with 60%+ ask side = real buying pressure.

**Step 5 — Check the leaders (30 sec).** Open `/stock/QQQ/heatmap`. QQQ ~50% of weight sits in 8 stocks (AAPL, MSFT, NVDA, AMZN, META, GOOGL, AVGO, TSLA). If 5+ are green and the regime is bullish — high-confidence long. If 5+ are red — high-confidence short.

### Synthesizing into a bias

After the five steps you have six data points:

1. Regime (Explosive / Stable / Dampening)
2. Closest accel direction (↑ or ↓, in % from spot)
3. Net Premium signs (++ / -- / mixed)
4. NOPE sign vs median
5. Mag-7 color count
6. Dark pool tone (optional from step 6 below)

Build the bias by counting confluence:

| Reading | Bias |
|---|---|
| 5–6 of 6 align in one direction | High-confidence trend day in that direction |
| 3–4 align | Lean direction, but size down. Use accel level as trigger |
| 0–2 align | Chop. Trade the range between put wall and call wall, or skip |

### Live intraday checks (every 30-60 min)

- **Net Premium tick chart** — is the cumulative Dir Delta line still moving in your direction? If it flatlines or reverses, your bias is gone.
- **0DTE GEX value on the Greek Exposure page** — as 0DTE gamma compresses through the day, moves get more violent into the close. Heavy 0DTE short gamma + late-day breakout = momentum into the bell.
- **Flow Alerts on QQQ** (`/stock/QQQ/flow-alerts`) — new institutional positioning hitting your direction = add to confidence. Hitting opposite = exit.
- **Dark Pool prints on QQQ** (`/stock/QQQ/darkpool`) — large prints near key levels signal where real money is defending.
- **The Mag-7 heatmap** — if leaders rotate (NVDA was green, now red), QQQ usually follows within 15-30 min.

### Optional: the Mr. Whale AI shortcut

For a single-question read, ask the AI:

> "Give me a one-paragraph intraday bias for QQQ right now. Include current regime, closest gamma levels, net premium direction, NOPE vs median, and which Mag-7 are leading."

It will compose the same view, faster. Treat the LLM as a fallback or sanity-check, not a substitute for reading the pages yourself.

---

## Part 3 — Live QQQ reading at the time this doc was written (2026-05-18, 12:40 PM ET)

Captured live during the session to anchor the playbook in a real example.

- **Spot:** $701.82 (-1.00%)
- **Volume:** 4.31M, Premium $1.30B
- **Put 2.23M vol / Call 2.12M vol** → puts slightly more active
- **Volatility Regime: EXPLOSIVE.** Γ -0.70, V +0.18, C -0.12 → negative gamma, vanna positive, charm negative. Translation: dealers short gamma → amplify moves. Vanna positive → IV up = mechanical bullish. Charm negative → time decay tilts bearish today.
- **Gamma flip: $703.00** (1.2 points above spot) — currently below flip = unstable zone
- **Put Wall: $700.00** — sitting 0.3% above it; the round number is the line
- **Accel ↓ at $700.00** — break of $700 will accelerate down (dealers must sell to stay hedged)
- **Accel ↑ at $705.00** — break of $705 will accelerate up
- **Call Wall: $730.00** — too far to matter today
- **NPP: -$7.8M, NCP: -$1.2M** → both negative = money leaving both sides (defensive)
- **0DTE GEX: $153.32K** — 34% of total open chain in same-day expiry = lots of fuel
- **Most-active 0DTE chains:** call lottery tickets at 708-712 ($0.05-$0.16) competing with put hedges at 700-705 — the market is split

**Read:** coiled spring between $700 and $705. Regime is Explosive, so wait for the break. Long above $705 / short below $700 — both moves get a gamma tailwind. Inside the range, expect noise. If the heatmap shows Mag-7 green, lean long-bias on the break. If red, lean short-bias.

---

## Quick reference URLs

```
# QQQ direction stack (open these in tabs every morning)
https://unusualwhales.com/stock/QQQ/greek-exposure
https://unusualwhales.com/stock/QQQ/net-premium
https://unusualwhales.com/stock/QQQ/nope
https://unusualwhales.com/stock/QQQ/heatmap
https://unusualwhales.com/stock/QQQ/darkpool
https://unusualwhales.com/stock/QQQ/flow-alerts

# Same setup for SPY / SPX (for cross-confirmation)
https://unusualwhales.com/stock/SPY/greek-exposure
https://unusualwhales.com/stock/SPX/greek-exposure

# Market-wide context
https://unusualwhales.com/zero-dte
https://unusualwhales.com/flow/super
https://unusualwhales.com/option-flow-alerts
```

Bookmark this doc — it'll save you 5-10 min of orientation each morning.
