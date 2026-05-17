'use strict';

/* ============================================================================
 *  Main Street Trades · Calendar Cron · v1.0
 * ----------------------------------------------------------------------------
 *  Runs Mon–Fri 6:00 AM ET via launchd. Pulls:
 *    - Earnings   : Finnhub /calendar/earnings           (FINNHUB_API_KEY)
 *    - Macro      : Trading Economics /calendar (guest)  (no key required)
 *
 *  Posts to channels by name (auto-discovered each run):
 *    #earnings-this-week — Mon: full week ahead. Tue–Fri: tomorrow's reports.
 *    #macro-events       — high-importance US macro events for the next 24h.
 *
 *  Env (in ../.env or ./.env):
 *    DISCORD_BOT_TOKEN  (required)
 *    GUILD_ID           (required)
 *    FINNHUB_API_KEY    (optional — earnings post skipped if missing)
 *    DRY_RUN=1          (skip Discord posting; print payloads to stdout)
 *
 *  Idempotency: a daily marker file in _work/stocks-calendar/markers/ stops
 *  duplicate posts if launchd fires twice in one day. Manual re-runs can pass
 *  FORCE=1 to bypass.
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

const parentEnvPath = path.resolve(__dirname, '..', '.env');
const localEnvPath = path.resolve(__dirname, '.env');
const envPath = fs.existsSync(parentEnvPath) ? parentEnvPath : localEnvPath;
require('dotenv').config({ path: envPath });

const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { HEADLINERS } = require('./headliners');
const { enrichAndScore, isHeadliner, fmtMarketCap, fmtMove } = require('./lib/anticipation');
const { generateAnticipatedGraphic } = require('./lib/branded-graphic');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY || '';
const DRY_RUN = !!process.env.DRY_RUN;
const FORCE = !!process.env.FORCE;

if (!TOKEN || !GUILD_ID) {
  console.error('✗ Missing DISCORD_BOT_TOKEN or GUILD_ID.');
  process.exit(1);
}

const TEAL = 0x1ea8ba;
const CYAN = 0x00e5ff;

const MARKER_DIR = path.resolve(__dirname, '..', '..', '_work', 'stocks-calendar', 'markers');

function todayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function shiftDaysET(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

function dowET() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  });
}

function fmtDateLong(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'MainStreetTrades-CalendarCron/1.0' } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} ← ${url.replace(/token=[^&]+/, 'token=***')}`);
  }
  return res.json();
}

async function fetchEarnings(fromDate, toDate) {
  if (!FINNHUB_API_KEY) return null;
  const u = `https://finnhub.io/api/v1/calendar/earnings?from=${fromDate}&to=${toDate}&token=${FINNHUB_API_KEY}`;
  const json = await fetchJson(u);
  const rows = (json.earningsCalendar || []).filter((r) => r.symbol && /^[A-Z.-]+$/.test(r.symbol));
  return rows;
}

// Cache ticker → company-name map. /stock/symbol returns the entire US ticker
// list in one call, so we pay the cost once per run instead of N times.
let _tickerMap = null;
async function getTickerMap() {
  if (_tickerMap) return _tickerMap;
  if (!FINNHUB_API_KEY) {
    _tickerMap = {};
    return _tickerMap;
  }
  try {
    const u = `https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${FINNHUB_API_KEY}`;
    const json = await fetchJson(u);
    _tickerMap = {};
    for (const row of json || []) {
      if (row.symbol && row.description) _tickerMap[row.symbol] = row.description;
    }
    console.log(`→ ticker map cached (${Object.keys(_tickerMap).length} symbols)`);
  } catch (e) {
    console.warn(`⚠ ticker map fetch failed (will fall back to ticker-only): ${e.message}`);
    _tickerMap = {};
  }
  return _tickerMap;
}

function shortenCompany(name) {
  if (!name) return '';
  // Trim common corporate suffixes for tighter rows.
  return name
    .replace(/\s+(Corporation|Corp\.?|Inc\.?|Incorporated|Limited|Ltd\.?|plc|PLC|Company|Co\.?|Holdings?|Group|Trust|S\.A\.|N\.V\.|S\.E\.|AG|SE)$/i, '')
    .replace(/\s+(Common Stock|Class [A-Z]|ADR)$/i, '')
    .trim()
    .slice(0, 32);
}

async function fetchMacro(fromDate, toDate) {
  if (!FINNHUB_API_KEY) return [];
  const u = `https://finnhub.io/api/v1/calendar/economic?from=${fromDate}&to=${toDate}&token=${FINNHUB_API_KEY}`;
  try {
    const json = await fetchJson(u);
    const all = Array.isArray(json.economicCalendar) ? json.economicCalendar : [];
    // Filter to US, importance in {high, medium}, skip holidays and pure-string events.
    return all.filter((ev) => {
      if (ev.country !== 'US') return false;
      if (ev.impact !== 'high' && ev.impact !== 'medium') return false;
      const e = (ev.event || '').toLowerCase();
      if (e.includes('holiday') || e.includes('ascension')) return false;
      return true;
    });
  } catch (e) {
    console.warn(`⚠ macro fetch failed: ${e.message}`);
    return [];
  }
}

function fmtTimeBucket(hour) {
  if (hour === 'bmo') return 'BMO';
  if (hour === 'amc') return 'AMC';
  if (hour === 'dmh') return 'During';
  return '—';
}

function shortenName(name) {
  if (!name) return '';
  return name
    .replace(/\s+(Corporation|Corp\.?|Inc\.?|Incorporated|Limited|Ltd\.?|plc|PLC|Company|Co\.?|Holdings?|Group|Trust|S\.A\.|N\.V\.|S\.E\.|AG|SE)$/i, '')
    .replace(/\s+(Common Stock|Class [A-Z]|ADR)$/i, '')
    .trim()
    .slice(0, 24);
}

// Daily row: `TICKER · Company · ±X% avg · $MktCap`
function fmtDailyRow(r) {
  const name = shortenName(r.profile?.name) || '—';
  const move = fmtMove(r.avgMove);
  const cap = fmtMarketCap(r.profile?.marketCap);
  return `\`${r.symbol.padEnd(5)}\` ${name.padEnd(22)} · ±${move.padStart(5)} · ${cap}`;
}

function buildEarningsEmbedDaily(enrichedRows, dateStr) {
  if (!enrichedRows || enrichedRows.length === 0) {
    return new EmbedBuilder()
      .setTitle(`Earnings — ${fmtDateLong(dateStr)}`)
      .setDescription('_No scheduled reports for tomorrow._')
      .setColor(TEAL)
      .setFooter({ text: 'Data: Finnhub · Yahoo Finance' });
  }
  // Rank within each session by anticipation score.
  const byScore = (a, b) => b.score - a.score;
  const bmo = enrichedRows.filter((r) => r.hour === 'bmo').sort(byScore).slice(0, 10);
  const amc = enrichedRows.filter((r) => r.hour === 'amc').sort(byScore).slice(0, 10);
  const other = enrichedRows.filter((r) => r.hour !== 'bmo' && r.hour !== 'amc').sort(byScore).slice(0, 5);

  const totalBmo = enrichedRows.filter((r) => r.hour === 'bmo').length;
  const totalAmc = enrichedRows.filter((r) => r.hour === 'amc').length;
  const totalOther = enrichedRows.filter((r) => r.hour !== 'bmo' && r.hour !== 'amc').length;

  const fields = [];
  if (bmo.length) {
    fields.push({
      name: `Before Market Open · top ${bmo.length} of ${totalBmo}`,
      value: bmo.map(fmtDailyRow).join('\n').slice(0, 1024),
    });
  }
  if (amc.length) {
    fields.push({
      name: `After Market Close · top ${amc.length} of ${totalAmc}`,
      value: amc.map(fmtDailyRow).join('\n').slice(0, 1024),
    });
  }
  if (other.length) {
    fields.push({
      name: `Other / Unscheduled · top ${other.length} of ${totalOther}`,
      value: other.map(fmtDailyRow).join('\n').slice(0, 1024),
    });
  }

  return new EmbedBuilder()
    .setTitle(`Earnings — ${fmtDateLong(dateStr)}`)
    .setDescription(`**${enrichedRows.length}** companies reporting. Ranked by anticipation — size × historical post-earnings move × institutional coverage.`)
    .setColor(TEAL)
    .addFields(fields)
    .setFooter({ text: 'Data: Finnhub · Yahoo Finance · ±% = avg |next-day move| over last 4 quarters' });
}

function sessionTag(hour) {
  if (hour === 'bmo') return 'BMO';
  if (hour === 'amc') return 'AMC';
  return 'D';
}

function sessionLong(hour) {
  if (hour === 'bmo') return 'Before Open';
  if (hour === 'amc') return 'After Close';
  if (hour === 'dmh') return 'During Market';
  return 'Time TBD';
}

// Format a date string as "May 11 2026".
function fmtAiosDate(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short' });
  return `${month} ${d} ${y}`;
}

function dayName(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long' });
}

function fmtWeeklyRow(r) {
  const name = shortenName(r.profile?.name) || '—';
  const move = fmtMove(r.avgMove);
  const session = sessionTag(r.hour);
  return `\`${r.symbol.padEnd(5)}\` ${name.padEnd(22)} · ${session.padEnd(3)} · ±${move.padStart(5)}`;
}

function buildEarningsEmbedWeekly(enrichedByDay, weekStart, weekEnd) {
  const total = Object.values(enrichedByDay).reduce((acc, rs) => acc + rs.length, 0);
  const rangeHeader = `${fmtAiosDate(weekStart)} - ${fmtAiosDate(weekEnd)}`;

  const eb = new EmbedBuilder()
    .setTitle(`Earnings This Week`)
    .setDescription(
      `**${rangeHeader}**\n\n` +
      `**${total}** reports scheduled Mon–Fri. Ranked by anticipation — ` +
      `size × historical post-earnings move × institutional coverage.\n` +
      `Detailed next-day previews drop each weekday at 6 AM ET.`,
    )
    .setColor(CYAN)
    .setFooter({ text: 'Data: Finnhub · Yahoo Finance · ±% = avg |next-day move| over last 4 quarters' });

  const dayOrder = Object.keys(enrichedByDay).sort();
  for (const day of dayOrder) {
    const rows = enrichedByDay[day];
    const totalCount = rows.length;
    const top = [...rows].sort((a, b) => b.score - a.score).slice(0, 8);
    const lines = top.map(fmtWeeklyRow);
    const restCount = totalCount - top.length;
    if (restCount > 0) lines.push(`_+${restCount} smaller-cap reports_`);

    eb.addFields({
      name: `${dayName(day)} — top ${top.length} of ${totalCount}`,
      value: lines.join('\n').slice(0, 1024) || '_no reports_',
    });
  }
  return eb;
}

function buildMacroEmbedDaily(events, dateStr) {
  if (!events || events.length === 0) {
    return new EmbedBuilder()
      .setTitle(`Macro — next 24h`)
      .setDescription(`**${fmtAiosDate(dateStr)}**\n\n_No high-importance US macro events scheduled in the next 24 hours._`)
      .setColor(TEAL)
      .setFooter({ text: 'Data: Finnhub' });
  }
  const top = events
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
    .slice(0, 10)
    .map((ev) => {
      const t = (ev.time || '').slice(11, 16) || 'TBD'; // HH:MM
      const eventDate = (ev.time || '').slice(0, 10);
      const name = ev.event || '—';
      const est = ev.estimate ?? '—';
      const prev = ev.prev ?? '—';
      const impact = (ev.impact || '').toUpperCase();
      const tag = impact === 'HIGH' ? '🔴' : '🟡';
      const dateStrAios = fmtAiosDate(eventDate || dateStr);
      return `${tag} ${name} - ${dateStrAios} @ ${t} ET (est ${est} · prior ${prev})`;
    });
  return new EmbedBuilder()
    .setTitle(`Macro — next 24h`)
    .setDescription(`**${fmtAiosDate(dateStr)}**\n\n` + top.join('\n'))
    .setColor(TEAL)
    .setFooter({ text: 'Data: Finnhub · US · 🔴 high · 🟡 medium' });
}

function buildMacroEmbedWeekly(events, weekStart, weekEnd) {
  const rangeHeader = `${fmtAiosDate(weekStart)} - ${fmtAiosDate(weekEnd)}`;
  const eb = new EmbedBuilder()
    .setTitle(`Macro This Week`)
    .setDescription(`**${rangeHeader}**\n\nHigh and medium-impact US macro events. 🔴 high · 🟡 medium.`)
    .setColor(TEAL)
    .setFooter({ text: 'Data: Finnhub' });

  if (!events || events.length === 0) {
    eb.addFields({ name: '—', value: '_No high or medium-impact US macro events scheduled this week._' });
    return eb;
  }

  // Group by date (yyyy-mm-dd)
  const byDay = {};
  for (const ev of events) {
    const d = (ev.time || '').slice(0, 10);
    if (!d) continue;
    (byDay[d] ||= []).push(ev);
  }
  const days = Object.keys(byDay).sort();

  for (const d of days) {
    const evs = byDay[d]
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
      .slice(0, 10);
    const lines = evs.map((ev) => {
      const t = (ev.time || '').slice(11, 16) || 'TBD';
      const name = ev.event || '—';
      const impact = (ev.impact || '').toUpperCase();
      const tag = impact === 'HIGH' ? '🔴' : '🟡';
      const est = ev.estimate ?? '—';
      const prev = ev.prev ?? '—';
      return `${tag} ${name} - ${fmtAiosDate(d)} @ ${t} ET (est ${est} · prior ${prev})`;
    });
    eb.addFields({
      name: `${dayName(d)} — ${byDay[d].length} events`,
      value: lines.join('\n').slice(0, 1024) || '_—_',
    });
  }
  return eb;
}

function markerPath(kind) {
  return path.join(MARKER_DIR, `${todayET()}-${kind}.marker`);
}

function isAlreadyPostedToday(kind) {
  if (FORCE) return false;
  return fs.existsSync(markerPath(kind));
}

function markPosted(kind) {
  fs.mkdirSync(MARKER_DIR, { recursive: true });
  fs.writeFileSync(markerPath(kind), new Date().toISOString());
}

// Match by exact name first, then by name with emoji/punct prefix stripped
// (e.g. "📅-earnings-this-week" should resolve "earnings-this-week"). In
// DRY_RUN we tolerate misses so a config drift doesn't block the preview.
function normalizeChannelName(n) {
  return (n || '')
    .normalize('NFKD')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{So}\p{Cn}]/gu, '')
    .replace(/^[-_·•\s]+|[-_·•\s]+$/g, '')
    .toLowerCase();
}

async function findChannel(guild, name) {
  const want = normalizeChannelName(name);
  const exact = guild.channels.cache.find((x) => x.name === name && x.isTextBased && x.isTextBased());
  if (exact) return exact;
  const fuzzy = guild.channels.cache.find(
    (x) => x.isTextBased && x.isTextBased() && normalizeChannelName(x.name) === want,
  );
  if (fuzzy) return fuzzy;
  const msg = `Channel #${name} not found in guild.`;
  if (DRY_RUN) {
    console.warn(`⚠ ${msg} (DRY_RUN: continuing with stub)`);
    return { name, isTextBased: () => true, send: async () => {} };
  }
  throw new Error(msg);
}

async function postEmbed(channel, embed, kind) {
  if (DRY_RUN) {
    console.log(`-- DRY_RUN: would post to #${channel.name} (${kind}) --`);
    console.log(JSON.stringify(embed.toJSON(), null, 2));
    return;
  }
  await channel.send({ embeds: [embed] });
  markPosted(kind);
  console.log(`✓ posted ${kind} → #${channel.name}`);
}

async function main() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(TOKEN);
  await new Promise((res) => client.once('clientReady', res));

  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();

  const today = todayET();
  const tomorrow = shiftDaysET(1);
  const dow = process.env.SIMULATE_DOW || dowET();

  // weekStart/weekEnd:
  //   - On real Sundays: shiftDaysET(1)..(5) → upcoming Mon..Fri
  //   - FORCE_WEEKLY=1 (test mode): Mon..Fri of THIS week (the week containing
  //     today), so we can dry-run the weekly preview mid-week.
  let weekStart, weekEnd;
  if (process.env.FORCE_WEEKLY) {
    const dowNumMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const dn = dowNumMap[dowET()];
    const daysSinceMon = dn === 0 ? -6 : 1 - dn; // negative or zero → days to shift from today
    weekStart = shiftDaysET(daysSinceMon);
    weekEnd = shiftDaysET(daysSinceMon + 4);
  } else if (dow === 'Sun') {
    weekStart = shiftDaysET(1);
    weekEnd = shiftDaysET(5);
  } else {
    weekStart = today;
    weekEnd = shiftDaysET(7);
  }

  console.log(`Today ${today} (${dow}) · tomorrow ${tomorrow} · weekly→${weekStart}..${weekEnd}${process.env.FORCE_WEEKLY ? ' [FORCE_WEEKLY]' : ''}`);

  const earningsCh = await findChannel(guild, 'earnings-this-week');
  const macroCh = await findChannel(guild, 'macro-events');

  // ---- Earnings ----
  if (!FINNHUB_API_KEY) {
    console.warn('⚠ FINNHUB_API_KEY not set — skipping earnings post. Sign up at finnhub.io.');
  } else {
    try {
      // NOTE: The Sunday weekly text-embed + MST-branded "Most Anticipated"
      // graphic were retired 2026-05-17. The new Sunday format is the
      // Earnings Whispers screenshot + chronological expected-moves text,
      // posted via scripts/repost-correct-order.js until weekly automation
      // is wired. Mon–Fri next-day previews below remain unchanged.
      if (dow === 'Sun') {
        console.log('→ Sunday: weekly post is handled by repost-correct-order.js, not this cron.');
      } else if (dow !== 'Sat' && !isAlreadyPostedToday('earnings-daily')) {
        const rows = await fetchEarnings(tomorrow, tomorrow);
        console.log(`→ enriching ${rows.length} daily earnings rows — market cap + last-4Q reaction…`);
        const enriched = await enrichAndScore(rows, { finnhubKey: FINNHUB_API_KEY });
        await postEmbed(earningsCh, buildEarningsEmbedDaily(enriched, tomorrow), 'earnings-daily');
      } else if (dow === 'Sat') {
        console.log('→ Saturday: no earnings post.');
      } else {
        console.log('→ earnings already posted today, skipping (pass FORCE=1 to override).');
      }
    } catch (e) {
      console.error(`✗ earnings post failed: ${e.message}`);
    }
  }

  // ---- Macro ----
  try {
    const wantMacroWeekly = process.env.FORCE_WEEKLY || dow === 'Sun';
    if (wantMacroWeekly && !isAlreadyPostedToday('macro-weekly')) {
      const events = await fetchMacro(weekStart, weekEnd);
      await postEmbed(macroCh, buildMacroEmbedWeekly(events, weekStart, weekEnd), 'macro-weekly');
    } else if (dow !== 'Sat' && dow !== 'Sun' && !isAlreadyPostedToday('macro-daily')) {
      const events = await fetchMacro(today, tomorrow);
      await postEmbed(macroCh, buildMacroEmbedDaily(events, tomorrow), 'macro-daily');
    } else if (dow === 'Sat') {
      console.log('→ Saturday: no macro post.');
    } else {
      console.log('→ macro already posted today, skipping (pass FORCE=1 to override).');
    }
  } catch (e) {
    console.error(`✗ macro post failed: ${e.message}`);
  }

  await client.destroy();
  console.log('done.');
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
