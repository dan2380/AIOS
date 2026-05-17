'use strict';

/* Repost the most-anticipated graphic + expected-moves text in the right
 * order (image FIRST, text SECOND), and delete the existing broken post
 * if it's still up. Also re-runs the enrichment so the new persistent
 * disk cache fills in any blanks left by Yahoo rate-limiting earlier. */

const fs = require('fs');
const path = require('path');

const parentEnvPath = path.resolve(__dirname, '..', '..', '.env');
const localEnvPath = path.resolve(__dirname, '..', '.env');
const envPath = fs.existsSync(localEnvPath) ? localEnvPath : parentEnvPath;
require('dotenv').config({ path: envPath });

const { enrichAndScore } = require('../lib/anticipation');
const { sortChronological } = require('../lib/composite-anticipated');

const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const EW_TICKERS = [
  'NVDA','ELF','ADI','NIO','INTU','BIDU','DECK','HD','BULL','WMT',
  'DE','VFC','VRT','KEYS','ZIM','ZM','TTWO','TGT','CAVA','AGYS',
  'TOL','WDAY','LOW','ARCO','TOYO','URBN','WMS','AS','HAS','CPRT',
  'GDS','SBLK','NDSN','FATN','STEP','RL','AAP','ECC','NRXP','TJX',
  'LSPD','BJ','HLNE','BAH','AUNA','DAVA','RERE','CCIF','YMM','CGEN',
];
const WEEK_START = '2026-05-18';
const WEEK_END = '2026-05-22';
const TICKERS_PER_PANEL = 20;
const EW_IMAGE = path.resolve(__dirname, '..', 'assets', `ew-week-${WEEK_START}.png`);

(async () => {
  if (!FINNHUB_API_KEY || !TOKEN || !GUILD_ID) {
    console.error('missing FINNHUB_API_KEY / DISCORD_BOT_TOKEN / GUILD_ID'); process.exit(1);
  }
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${WEEK_START}&to=${WEEK_END}&token=${FINNHUB_API_KEY}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'MST/repost' } });
  const json = await res.json();
  const want = new Set(EW_TICKERS);
  const rows = (json.earningsCalendar || []).filter((r) => want.has(r.symbol));

  console.log(`→ enriching ${rows.length} tickers with new disk cache + retry…`);
  const enriched = await enrichAndScore(rows, { finnhubKey: FINNHUB_API_KEY });

  const ewRank = new Map(EW_TICKERS.map((s, i) => [s, i]));
  const byEw = enriched
    .filter((r) => ewRank.has(r.symbol))
    .sort((a, b) => ewRank.get(a.symbol) - ewRank.get(b.symbol))
    .slice(0, TICKERS_PER_PANEL);

  const SESS_RANK = { bmo: 0, amc: 0, dmh: 1, tbd: 2, '': 2, undefined: 2 };
  const dedup = new Map();
  for (const r of sortChronological(byEw)) {
    const prev = dedup.get(r.symbol);
    if (!prev) { dedup.set(r.symbol, r); continue; }
    const a = SESS_RANK[prev.hour ?? ''] ?? 2;
    const b = SESS_RANK[r.hour ?? ''] ?? 2;
    if (b < a || (b === a && r.date < prev.date)) dedup.set(r.symbol, r);
  }
  const finalRows = [...dedup.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (SESS_RANK[a.hour ?? ''] ?? 2) - (SESS_RANK[b.hour ?? ''] ?? 2);
  });

  const incomplete = finalRows.filter((r) => r.avgMove == null);
  if (incomplete.length) {
    console.warn(`⚠ ${incomplete.length} tickers still missing avgMove after retry: ${incomplete.map((r) => r.symbol).join(', ')}`);
  } else {
    console.log('✓ all tickers populated');
  }

  const body = `Expected moves after earnings:\n\n` + finalRows
    .map((r) => `${r.symbol}: ±${r.avgMove == null ? '—' : (r.avgMove * 100).toFixed(1) + '%'}`)
    .join('\n');

  console.log('\n----- text message body -----');
  console.log(body);
  console.log('-----------------------------\n');

  if (!process.argv.includes('--post')) {
    console.log('(preview only — pass --post to actually delete-and-repost)');
    return;
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

  // 1) Delete previous bot-authored "Expected moves after earnings" message(s).
  const msgs = await ch.messages.fetch({ limit: 30 });
  const mine = msgs.filter((m) => m.author?.id === client.user.id && /Expected moves after earnings/.test(m.content || ''));
  for (const m of mine.values()) {
    try { await m.delete(); console.log(`✗ deleted prior message ${m.id}`); } catch (e) { console.warn(`could not delete ${m.id}: ${e.message}`); }
  }

  // 2) Post image FIRST.
  const attachment = new AttachmentBuilder(EW_IMAGE, { name: `most-anticipated-${WEEK_START}.png` });
  await ch.send({ files: [attachment] });
  console.log(`✓ posted image → #${ch.name}`);

  // 3) Post text SECOND.
  await ch.send({ content: body });
  console.log(`✓ posted text → #${ch.name}`);

  await client.destroy();
})().catch((e) => { console.error('fatal:', e); process.exit(1); });
