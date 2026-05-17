'use strict';

/* Find the most recent message I (the bot) posted in #📊-earnings-this-week
 * and overwrite its content with the fresh data we just computed. Use this
 * to fix gaps from intermittent Yahoo rate-limiting without leaving a
 * duplicate post in the channel. */

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

const EW_TICKERS_2026_05_18 = [
  'NVDA','ELF','ADI','NIO','INTU','BIDU','DECK','HD','BULL','WMT',
  'DE','VFC','VRT','KEYS','ZIM','ZM','TTWO','TGT','CAVA','AGYS',
  'TOL','WDAY','LOW','ARCO','TOYO','URBN','WMS','AS','HAS','CPRT',
  'GDS','SBLK','NDSN','FATN','STEP','RL','AAP','ECC','NRXP','TJX',
  'LSPD','BJ','HLNE','BAH','AUNA','DAVA','RERE','CCIF','YMM','CGEN',
];
const WEEK_START = '2026-05-18';
const WEEK_END = '2026-05-22';
const TICKERS_PER_PANEL = 20;

(async () => {
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${WEEK_START}&to=${WEEK_END}&token=${FINNHUB_API_KEY}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'MST/edit' } });
  const json = await res.json();
  const want = new Set(EW_TICKERS_2026_05_18);
  const rows = (json.earningsCalendar || []).filter((r) => want.has(r.symbol));

  console.log(`→ re-enriching ${rows.length} tickers…`);
  const enriched = await enrichAndScore(rows, { finnhubKey: FINNHUB_API_KEY });

  const ewRank = new Map(EW_TICKERS_2026_05_18.map((s, i) => [s, i]));
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
    console.warn(`⚠ ${incomplete.length} tickers still missing avgMove: ${incomplete.map((r) => r.symbol).join(', ')}`);
  }

  const body = `Expected moves after earnings:\n\n` + finalRows
    .map((r) => `${r.symbol}: ±${r.avgMove == null ? '—' : (r.avgMove * 100).toFixed(1) + '%'}`)
    .join('\n');

  const { Client, GatewayIntentBits } = require('discord.js');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(TOKEN);
  await new Promise((res) => client.once('clientReady', res));
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  const ch = guild.channels.cache.find(
    (c) => c.isTextBased && c.isTextBased() && /earnings-this-week/.test(c.name),
  );
  if (!ch) { console.error('channel not found'); await client.destroy(); return; }

  const msgs = await ch.messages.fetch({ limit: 20 });
  const mine = msgs.find((m) => m.author?.id === client.user.id && /Expected moves after earnings/.test(m.content || ''));
  if (!mine) {
    console.error('no matching bot message found in last 20 messages');
    await client.destroy(); return;
  }
  console.log(`→ editing message ${mine.id} (posted ${mine.createdAt.toISOString()})`);
  await mine.edit({ content: body });
  console.log('✓ edited');
  await client.destroy();
})().catch((e) => { console.error('fatal:', e); process.exit(1); });
