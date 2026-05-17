'use strict';

/* Preview the EW + expected-moves composite graphic for this week.
 *
 * Usage:
 *   node scripts/preview-composite.js
 *   node scripts/preview-composite.js --post   # also posts live to Discord
 *
 * Reads the saved EW screenshot from assets/ew-week-<weekStart>.png.
 * Enriches via the existing anticipation pipeline. Renders. Opens.
 * Optional --post sends to #earnings-this-week with FORCE override.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const parentEnvPath = path.resolve(__dirname, '..', '..', '.env');
const localEnvPath = path.resolve(__dirname, '..', '.env');
const envPath = fs.existsSync(localEnvPath) ? localEnvPath : parentEnvPath;
require('dotenv').config({ path: envPath });

const { enrichAndScore } = require('../lib/anticipation');
const { generateCompositeGraphic, sortChronological } = require('../lib/composite-anticipated');

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

// EW's ranked anticipation list for the week of 2026-05-18 (from the @eWhispers caption).
const EW_TICKERS_2026_05_18 = [
  'NVDA','ELF','ADI','NIO','INTU','BIDU','DECK','HD','BULL','WMT',
  'DE','VFC','VRT','KEYS','ZIM','ZM','TTWO','TGT','CAVA','AGYS',
  'TOL','WDAY','LOW','ARCO','TOYO','URBN','WMS','AS','HAS','CPRT',
  'GDS','SBLK','NDSN','FATN','STEP','RL','AAP','ECC','NRXP','TJX',
  'LSPD','BJ','HLNE','BAH','AUNA','DAVA','RERE','CCIF','YMM','CGEN',
];

const WEEK_START = '2026-05-18';
const WEEK_END = '2026-05-22';
const EW_IMAGE = path.resolve(__dirname, '..', 'assets', `ew-week-${WEEK_START}.png`);
const TICKERS_PER_PANEL = 20; // top 2-col grid = 10 rows × 2

async function fetchEarningsRows(symbols) {
  // Filter Finnhub's weekly calendar to just the EW-listed symbols.
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${WEEK_START}&to=${WEEK_END}&token=${FINNHUB_API_KEY}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'MainStreetTrades-Composite/1.0' } });
  if (!res.ok) throw new Error(`finnhub: HTTP ${res.status}`);
  const json = await res.json();
  const all = json.earningsCalendar || [];
  const want = new Set(symbols);
  return all.filter((r) => want.has(r.symbol));
}

(async () => {
  if (!FINNHUB_API_KEY) {
    console.error('FINNHUB_API_KEY missing in env'); process.exit(1);
  }
  const rows = await fetchEarningsRows(EW_TICKERS_2026_05_18);
  console.log(`→ matched ${rows.length}/${EW_TICKERS_2026_05_18.length} EW tickers in Finnhub calendar`);
  console.log('→ enriching market cap + last-4Q reaction…');
  const enriched = await enrichAndScore(rows, { finnhubKey: FINNHUB_API_KEY });

  // Take top N by EW rank (preserving caption order), then sort chronologically.
  const ewRank = new Map(EW_TICKERS_2026_05_18.map((s, i) => [s, i]));
  const byEw = enriched
    .filter((r) => ewRank.has(r.symbol))
    .sort((a, b) => ewRank.get(a.symbol) - ewRank.get(b.symbol))
    .slice(0, TICKERS_PER_PANEL);

  const chronological = sortChronological(byEw);
  console.log('\nChronological order for the panel:');
  for (const r of chronological) {
    const move = r.avgMove == null ? '—' : `${(r.avgMove * 100).toFixed(1)}%`;
    console.log(`  ${r.date} ${r.hour || 'tbd'}  ${r.symbol.padEnd(5)}  ±${move}`);
  }

  // Dedupe by symbol — Finnhub sometimes returns a ticker twice (e.g. TGT
  // with both a TBD and a BMO entry). Keep the entry with a concrete
  // session ('bmo'/'amc') over a 'tbd'/null one; otherwise keep earliest.
  const SESS_RANK = { bmo: 0, amc: 0, dmh: 1, tbd: 2, '': 2, undefined: 2 };
  const dedup = new Map();
  for (const r of chronological) {
    const prev = dedup.get(r.symbol);
    if (!prev) { dedup.set(r.symbol, r); continue; }
    const a = SESS_RANK[prev.hour ?? ''] ?? 2;
    const b = SESS_RANK[r.hour ?? ''] ?? 2;
    if (b < a || (b === a && r.date < prev.date)) dedup.set(r.symbol, r);
  }
  const finalRows = [...dedup.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const A = SESS_RANK[a.hour ?? ''] ?? 2;
    const B = SESS_RANK[b.hour ?? ''] ?? 2;
    return A - B;
  });

  // Compose the Discord message body.
  const tickerLines = finalRows
    .map((r) => {
      const pct = r.avgMove == null ? '—' : `${(r.avgMove * 100).toFixed(1)}%`;
      return `${r.symbol}: ±${pct}`;
    })
    .join('\n');
  const body = `Expected moves after earnings:\n\n${tickerLines}`;

  console.log('\n----- Discord message body -----');
  console.log(body);
  console.log('--------------------------------\n');
  console.log(`(image attachment: ${EW_IMAGE})`);

  if (process.argv.includes('--post')) {
    if (!TOKEN || !GUILD_ID) {
      console.error('DISCORD_BOT_TOKEN or GUILD_ID missing — skipping post'); return;
    }
    const { Client, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await client.login(TOKEN);
    await new Promise((res) => client.once('clientReady', res));
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    const ch = guild.channels.cache.find(
      (c) => c.isTextBased && c.isTextBased() && /earnings-this-week/.test(c.name),
    );
    if (!ch) { console.error('channel not found'); await client.destroy(); return; }
    const attachment = new AttachmentBuilder(EW_IMAGE, { name: `most-anticipated-${WEEK_START}.png` });
    await ch.send({ content: body, files: [attachment] });
    console.log(`✓ posted → #${ch.name}`);
    await client.destroy();
  }
})().catch((e) => { console.error('fatal:', e); process.exit(1); });
