# Connections

Registry of every system your AIOS can reach. Filled by `/onboard` from Q4-Q7 answers; expanded over time as you wire new tools. `/audit` checks this file for domain coverage and freshness.

Provider-neutral rule: the canonical connection is the business system plus its durable interface: API, script, CLI, export, filesystem, or documented MCP server. Provider-hosted tool names such as `mcp__claude_ai_Gmail__*` are adapters for a specific assistant session. When using Codex/OpenAI or another assistant, use equivalent MCP/apps if configured; otherwise fall back to the script, API, CLI, or reference doc listed here.

| # | Domain | Tool(s) | Mechanism | Auth | Last checked |
|---|---|---|---|---|---|
| 1 | Revenue / Financials | PayPal, Mercury (checking) — **Whop parked** | **script + ref** (`scripts/weekly-revenue.py` + per-tool refs in `references/{paypal,whop,mercury}-api.md`) | **live** (PayPal + Mercury); Whop scope-blocked, parked | 2026-05-02 |
| 2 | Customer interactions | **Gmail** (`dan@cosmeticsgrowth.com`, `danielwang2029@gmail.com`), **GHL** | **mcp + ref** (Gmail via `mcp__claude_ai_Gmail__*`, see `references/gmail-api.md`); **key+ref** (GHL, see `references/ghl-api.md`) | live (Gmail, GHL) | 2026-05-02 |
| 3 | Calendar | **Google Calendar** | **mcp** (via `mcp__claude_ai_Google_Calendar__*`) | live | 2026-05-02 |
| 4 | Communication | **Gmail**, **GHL SMS**, **Reachinbox** (cold email outbound), WhatsApp (Treg), Slack (planned) | **mcp** (Gmail); **key+ref** (GHL); **script + ref** (Reachinbox — `scripts/weekly-cold-email.py` + `references/reachinbox-api.md`); not yet (WhatsApp/Slack) | live (Gmail, GHL, Reachinbox) | 2026-05-02 |
| 5 | Project / task tracking | **ClickUp** + local `actions/current.md` fallback | **mcp + ref** (Codex global MCP server `clickup`, see `references/clickup-mcp.md`); filesystem fallback remains live | live via OAuth; initial workspace layout created, review pending | 2026-05-03 |
| 6 | Meeting intelligence | **Fathom** | **mcp + key+ref** (MCP via `mcp__fathom__*`; REST key in `.env` as `FATHOM_API_KEY` for scheduled batches; webhook secret as `FATHOM_WEBHOOK_SECRET`; see `references/fathom-api.md`) | live | 2026-05-02 |
| 7 | Knowledge / files | **Obsidian (Dans Second Brain — 916 notes)** + Google Drive + local laptop sync | **filesystem + ref** (Obsidian, see `references/obsidian-vault.md`); not yet (Drive) | n/a (local FS) | 2026-05-02 (Obsidian) |
| 8 | Owned web properties | **cosmeticsgrowth.com** (live site, ~50 pages) + reusable client landing-page templates (Invisalign, Implants) | **filesystem + ref** (see `references/cosmetics-growth-website.md`) | n/a (local FS, push to GitHub → Vercel) | 2026-05-02 |
| 9 | Local filesystem hub | `~/Desktop/CosmeticsGrowthAI/` — single root for the entire business | **filesystem + ref** (see `references/filesystem-map.md`) | n/a | 2026-05-02 |
| 10 | Web analytics | **GA4** (`530825887` Cosmetics Growth Website) via **Windsor.ai** | **mcp + script + ref** (MCP via `mcp__claude_ai_Windsor_ai__*`; script `scripts/weekly-traffic.py` + `windsor_puller.py`; see `references/windsor-api.md` + `references/ga4-key-events-setup.md`) | live (MCP); script needs `WINDSOR_API_KEY` in `.env` | 2026-05-02 |
| 11 | Personal / business credit-card spend | Amex, Capital One, Discover, Chase, Citi, Apple Card | **not yet connected + ref** (target: Plaid first, Teller backup; Apple Card via manual export or FinanceKit only if building an iPhone app; see `references/credit-card-data-access-api.md`) | not yet; no aggregator keys found in `.env` | 2026-05-04 |

## Tier-2 — infrastructure & enabling APIs (now wired via `.env`)

These don't fit the 7 Tier-1 domains but are reachable from the AIOS as of 2026-05-02. Full key list in `.env`.

| Service | Purpose | Key in .env | Notes |
|---|---|---|---|
| Anthropic | Claude API for AI calls | `ANTHROPIC_API_KEY` (+ `_ADSPY` alt) | Two accounts |
| OpenAI | gpt-image generation | `OPENAI_API_KEY` | Used by smile-simulator |
| Gemini | Google AI | `GEMINI_API_KEY` | |
| Reachinbox | Outbound cold email sequencer | `REACHINBOX_API_KEY` | Multiple campaigns wired |
| Inbox Insiders | Cold email infra | `INBOX_INSIDERS_API_KEY` | |
| n8n Cloud | Workflow automation hub | `N8N_API_KEY` + `N8N_API_URL` | `dan2380.app.n8n.cloud` — also reachable via **n8n-mcp** server (project `.mcp.json`, env-substituted from `.env`); 1,650 nodes + workflow CRUD |
| Vercel | Hosting + deploys for cosmeticsgrowth.com (root + sign./audit./app. subdomains) | n/a (OAuth via MCP) | Official remote MCP at `https://mcp.vercel.com` (HTTP transport, OAuth); wired in project `.mcp.json` as `vercel`. Run `/mcp` in Claude Code to authenticate. Capabilities: search Vercel docs, manage projects + deployments, analyze deployment logs |
| GitHub | Repo / issue / PR / Actions automation across all CG repos (cosmeticsgrowth.com site, AIOS workspace, sign./audit./app. apps) | `GITHUB_PAT` in `.env` (fine-grained or classic PAT) | Official GitHub MCP at `https://api.githubcopilot.com/mcp/` (HTTP transport, PAT bearer); wired in project `.mcp.json` as `github`. PAT scopes: `repo`, `read:org`, `workflow` (add `actions:write` only if needed). Capabilities: read repos/code, manage issues + PRs, monitor Actions runs, code analysis, Dependabot. Docker fallback (local stdio) available if remote ever rate-limits — `ghcr.io/github/github-mcp-server` |
| Brave Search | Web search for prospecting | `BRAVE_API_KEY` (+ alt) | Two keys |
| SerpAPI | SERP scraping | `SERPAPI_KEY` | |
| Hunter.io | Email enrichment | `HUNTER_API_KEY` | |
| Apify | Scraping platform (Indeed, DentalPost actors, web scrapers) | `APIFY_TOKEN` in `.env` | Official remote MCP at `https://mcp.apify.com/` (HTTP transport, Bearer token); wired in project `.mcp.json` as `apify`. Run `/mcp` in Claude Code to verify. Capabilities: discover/run Actors, fetch dataset items, manage runs |
| Million Verifier | Email verification | `MILLION_VERIFIER_API_KEY` | |
| Google Places | Business data | `GOOGLE_PLACES_API_KEY` (+ adspy alt) | |
| Google PSI | PageSpeed Insights | `GOOGLE_PSI_API_KEY` | Free 25k/day |
| KIE.ai | Image generation API | `KIE_API_KEY` (+ alt) | |
| Resend | Transactional email | `RESEND_API_KEY` | from `audit@cosmeticsgrowth.com` |
| Leadsie | One-click client asset-access onboarding (Meta BM, Google Ads, GA4, GBP, GTM, TikTok) | not yet (account creation pending) | Replaces the "schedule a separate call to walk client through partner sharing" step. See `references/leadsie-api.md`. Plan: Pro $49/mo on `dan@cosmeticsgrowth.com`, branded subdomain `connect.cosmeticsgrowth.com` |
| Discord webhooks | Alerts + blog publish | `DISCORD_BLOG_WEBHOOK` (blog channel id `1501542459606433893`); `DISCORD_WEBHOOK_URL` (legacy n8n channel id `1482810533575917690`) | Cloudflare in front of Discord blocks default Python-urllib UA — always set User-Agent on webhook POSTs. Helper: `Websites/cosmetics-growth/.claude/scripts/blog-pipeline/clickup_helpers.py` (`discord_post()`) |
| ClickUp Blog Topic Queue | Topic-picker queue for Mon/Thu publish flow | `CLICKUP_API_KEY` | List id `901817941771` under `Operating Rhythm` folder. Statuses: `To Score → Awaiting Pick → Writing → Published, Rejected`. Custom fields + cluster options mapped in `state/blog-pipeline-clickup.json` and `Websites/cosmetics-growth/.claude/scripts/blog-pipeline/clickup-config.json`. |
| Claude Code RemoteTriggers (blog pipeline) | Cloud-side cron for Sun prep / Sun cleanup / Thu writer (1/week cadence as of 2026-05-12) | n/a (managed via claude.ai) | Triggers operate against `dan2380/cosmetics-growth-website`. **BROKEN 2026-05-10/11:** Sunday Prep, Sunday Cleanup, and Monday Writer all auto-disabled with `ended_reason: auto_disabled_repo_access` when they tried to fire — claude.ai lost GitHub access. Thursday Writer still `enabled: true` but will hit the same wall on 2026-05-14 unless GitHub is re-authed via `/web-setup` or the Claude GitHub App is re-installed on `dan2380/cosmetics-growth-website`. DISABLED (intent): `Weekly Blog Publish — cosmeticsgrowth.com` (`trig_01ETENcxgNyP8LAirwPcJ5TK`, 2026-05-07 superseded) and `Blog Writer — Monday` (`trig_01W4F3QGuUp6BuJQ5XPCixvV`, 2026-05-12 — cadence dropped from 2/week to 1/week). Should-be-active set (creds embedded in each prompt): `Blog Sunday Prep` (`trig_016XWKPBNa6ghGCdbutU8H1p`, Sun 01:57 UTC, 3 candidates) • `Blog Sunday Cleanup` (`trig_01RNkM6jfTVAdqQyTUz72LR9`, Sun 15:53 UTC, auto-fill 1) • `Blog Writer — Thursday` (`trig_015zAVKYL5sqioAh18qQsZ2K`, Thu 00:57 UTC). |
| Supabase | Lead warehouse DB | `SUPABASE_DB_*` | Project ref `wdhvzwuqnuryydvwgjcy` |
| Neon | adspy DB | `NEON_DATABASE_URL` | |
| Alpaca (×4) | Paper trading | `ALPACA_API_KEY_*` | Personal investing — not Cosmetics Growth |
| Alpha Vantage / FRED / Finnhub | Market data | `*_API_KEY` | Personal investing |
| Unusual Whales — Retail Pro | Options-flow dashboard, 18 premium Discord slash commands, zero-delay alerts, dark pool + congress + insider + Greeks + IV | Playwright MCP session at `/Users/dwang/.cache/playwright-mcp-profile` (login cookies persist across restarts) | $48/mo or $528/yr. Personal subscription tied to Main Street Trades (not CG). Saved filter `"MST High Conviction"` at https://unusualwhales.com/flow. Direct filtered-flow URL + DOM row schema in `references/unusual-whales-access.md`. Replaces Tradytics/CheddarFlow/FlowAlgo — do not propose alternatives. See `memory/project_unusual_whales_subscription.md`. |
| Unusual Whales — Discord Server-Level | Premium Discord Bot autoposting into the MST guild (`unusual_whales_crier`, bot id `800519694754644029`) | n/a (purchased per-guild) | Pricing quoted at checkout. Unlocks Live Option Flow + Ticker Updates + Insider + Congress + News + Halt + OI autoposts in the 8 `*-uw` channels under `🛠️・PAID TOOLS / SIGNALS`. Setup steps + filter spec in `Main Street Trades/UW High Conviction Filter - 05-18-26.html`. |

## Notes & gotchas

- **Payment processors:** Stripe and Square are blacklisted on Cosmetics Growth (industry risk profile). Never default-suggest either. Active priority is to add a 3rd processor so any single shutdown can't halt collections.
- **Content channels (Tier-2, future):** YouTube, LinkedIn, dental subreddits (e.g. r/Dentistry). Currently zero consistent posting — flagged as a Q3 leverage gap. Add as Domain 10 once a publishing cadence exists.
- **Contract gap:** CSA v1 exists in `templates/client-services-agreement-v1.md`. Remaining blocker is attorney review + signing workflow readiness before client-facing use.
- **Client sub-account:** White-label client environment needs to be built out (likely in GHL) before the wave of new signs.
- **GHL is doing double duty:** SMS (Domain 2 + 4), pipelines (likely Domain 5 once structured), client sub-accounts (Domain 7-adjacent). When GHL gets wired in, expect it to satisfy multiple domains at once — save `references/ghl-api.md` once and reference it from each row.
- **Website edits auto-push:** Any change to `Websites/cosmetics-growth/` is auto-committed and pushed to GitHub (which deploys via Vercel) unless Daniel explicitly says "don't push". Rule lives in that folder's own `CLAUDE.md`.

**Mechanism options:** `mcp` (MCP server), `script` (Python/Bash hitting an API, in `scripts/`), `export` (CSV/JSON dump pipeline), `key+ref` (`.env` key + `references/{tool}-api.md` guide), `filesystem + ref` (local files + map doc), `not yet connected`.

When you wire a new tool, also save `references/{tool}-api.md` capturing endpoints, auth flow, and common queries — researched-once-saved-forever.
