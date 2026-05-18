# Unusual Whales — Access Reference

How Claude reads Unusual Whales premium data on Daniel's behalf without an API token.

## Access method: Playwright MCP with persistent profile

Subscription is **Retail Pro ($48/mo)**, which does NOT include API token access. The UW API is a separate paid product (`unusualwhales.com/pricing?product=api`). To avoid that surcharge, we drive the logged-in dashboard via the Playwright MCP server with a persistent user-data dir so cookies survive Claude Code restarts.

### Config (already applied)

`.mcp.json`:

```json
"playwright": {
  "command": "npx",
  "args": [
    "-y",
    "@playwright/mcp@latest",
    "--user-data-dir",
    "/Users/dwang/.cache/playwright-mcp-profile"
  ]
}
```

Profile dir: `/Users/dwang/.cache/playwright-mcp-profile` — created on first launch with the flag. Holds cookies, localStorage, and IndexedDB for unusualwhales.com.

### First-time login (one-time, then persistent)

The flag took effect on next Claude Code restart after 2026-05-18. First Playwright session after that restart needs Daniel to log in once via `https://unusualwhales.com/login`. After that, all future sessions reuse the cookies — no re-login.

Claude is **not allowed to enter passwords or click SSO buttons** under safety policy. Login must always be Daniel-initiated in the Playwright window.

## Bookmarkable filtered-flow URL

Loading the `MST High Conviction` saved filter via dropdown takes 2 clicks. Skip that — the filter's full state is in the URL query string. Hit this URL directly:

```
https://unusualwhales.com/live-options-flow?exclude_deep_itm=true&excluded_tags[]=bid_side&excluded_tags[]=mid_side&excluded_tags[]=no_side&hide_expired=true&intraday_only=true&is_multi_leg=false&is_otm=true&issue_types[]=Common%20Stock&limit=50&max_diff=1&max_dte=90&min_ask_perc=0&min_diff=0&min_premium=25000&min_size=0&min_underlying_price=5&opening=true&report_flag[]=sweep&report_flag[]=cross&report_flag[]=floor&volume_greater_oi=true&watchlist_name=MST%20High%20Conviction
```

Page title resolves to `MST High Conviction - Flow` — that's the verification handshake.

## Pulling structured flow data

After navigating to the filtered URL, run this in `browser_evaluate` to get rows as JSON:

```js
() => {
  const rows = Array.from(document.querySelectorAll('tbody tr'));
  return rows
    .map(r => Array.from(r.querySelectorAll('td'))
      .map(td => (td.innerText || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean))
    .filter(arr => arr.length >= 5);
}
```

### Row schema (19 columns)

| # | Column | Example |
|---|---|---|
| 1 | Timestamp (UTC) | `05/18 11:05:48` |
| 2 | Ticker | `HD` |
| 3 | Side | `ASK` / `BID` / `MID` |
| 4 | Strike | `310` |
| 5 | Type | `call` / `put` |
| 6 | Expiry | `2026-07-17` |
| 7 | DTE | `60d` |
| 8 | Spot | `$302.66` |
| 9 | Bid-Ask spread | `$10.15 - $12.60` |
| 10 | Fill price | `$11.60` |
| 11 | Size | `500` |
| 12 | Premium | `$580K` |
| 13 | Volume | `500` |
| 14 | Open Interest | `100` |
| 15 | Vol/OI % | `100%` |
| 16 | Leg flag | `SL` (single-leg) / `ML` (multi-leg) |
| 17 | Trade code | `SLFT` / `ISOI` / `ISOIC` |
| 18 | Tape flag | `FLOOR` / `SWEEP` / `CROSS` |
| 19 | Sentiment + tags | `🐂 - BULLISH🛍️ - ASK🦄 - EARNINGS THIS WEEK` |

## Other useful URLs (premium, behind login)

| Page | URL |
|---|---|
| Live flow (default) | `https://unusualwhales.com/live-options-flow` |
| Saved filters list | `https://unusualwhales.com/live-options-flow/saved` |
| Interval flow | `https://unusualwhales.com/interval-flow` |
| 0DTE flow | `https://unusualwhales.com/zero-dte` |
| Dark pool | `https://unusualwhales.com/darkpool` |
| Congress trades | `https://unusualwhales.com/congress` |
| Insider trades | `https://unusualwhales.com/insiders` |
| Earnings calendar | `https://unusualwhales.com/earnings` |

## If we ever upgrade to the API tier

UW publishes everything we'd need:

- **REST docs (Markdown):** `https://api.unusualwhales.com/docs` (use header `Accept: text/plain`)
- **OpenAPI spec:** `https://api.unusualwhales.com/api/openapi`
- **MCP server:** `https://unusualwhales.com/public-api/mcp` — wire this directly into `.mcp.json` if we ever buy an API token
- **AI skill index:** `https://unusualwhales.com/skill.md`
- **Pricing:** `https://unusualwhales.com/pricing?product=api`

The MCP server route is the cleanest upgrade path — drops Playwright scraping entirely in favor of structured tool calls.

## Restrictions

- Claude **cannot** enter passwords or click SSO buttons in the Playwright window
- Claude **cannot** modify account settings, billing, or filter saves on UW
- Claude **can** navigate, read tables, run filters via URL query strings, take screenshots, and extract DOM data
- The Playwright Chromium window runs in the background — Daniel does not need to focus it

## Common patterns

**Daily MST flow brief:**
1. Navigate to bookmarkable filtered URL above
2. Wait 2s for rows to render
3. Run the row-extraction JS
4. Format for review

**Ad-hoc ticker dive:**
1. Navigate to `https://unusualwhales.com/stock/<TICKER>/flow`
2. Run row-extraction JS (same selector)

**Dark pool snapshot:**
1. Navigate to `https://unusualwhales.com/darkpool`
2. Apply filters via UI clicks or by appending query params

## Maintenance

- Profile dir grows over time (cookies, cache) — clear with `rm -rf /Users/dwang/.cache/playwright-mcp-profile` if it bloats beyond ~500MB
- After clearing, next session needs a fresh Daniel login
- UW occasionally rotates DOM class names — if `tbody tr` extraction stops returning 19-column rows, re-run discovery flow and update the schema above

---

Created 2026-05-18 during the initial UW access wire-up.
