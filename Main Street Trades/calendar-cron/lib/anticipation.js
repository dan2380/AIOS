'use strict';

/* ============================================================================
 *  Anticipation scoring — replaces the hard-coded HEADLINERS allow-list.
 * ----------------------------------------------------------------------------
 *  Score combines:
 *    + log10(market_cap)              ~9 ($1B) → ~13 ($1T)
 *    + avg post-earnings move (%)     ~3–15 typical
 *    + headliner bonus                +3 if in index allow-list
 *    + analyst-coverage bumps         small additive
 *
 *  Data sources (all free):
 *    market cap         → Finnhub /stock/profile2
 *    historical EPS     → Finnhub /stock/earnings (last 4 quarters)
 *    daily OHLC         → Yahoo Finance chart endpoint (unofficial, no key)
 *
 *  Graceful degradation: any per-symbol fetch failure falls back to the
 *  available signal. A symbol with NO data still gets a base score from the
 *  earnings row itself (estimate presence, ticker length, headliner flag).
 * ============================================================================
 */

const { HEADLINERS } = require('../headliners');

const FINNHUB = 'https://finnhub.io/api/v1';
const YAHOO = 'https://query1.finance.yahoo.com/v7/finance/chart';

const UA = 'MainStreetTrades-CalendarCron/2.0';

const _profileCache = new Map(); // symbol → { marketCap, name }
const _moveCache = new Map();    // symbol → avg |post-er next-day move| as decimal (0.07 = 7%)

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} ← ${url.replace(/token=[^&]+/, 'token=***')}`);
  }
  return res.json();
}

function isHeadliner(symbol) {
  if (!symbol) return false;
  if (HEADLINERS.has(symbol)) return true;
  const alt = symbol.replace('-', '.');
  if (HEADLINERS.has(alt)) return true;
  const alt2 = symbol.replace('.', '-');
  if (HEADLINERS.has(alt2)) return true;
  return false;
}

async function getProfile(symbol, finnhubKey) {
  if (!finnhubKey) return null;
  if (_profileCache.has(symbol)) return _profileCache.get(symbol);
  try {
    const json = await fetchJson(`${FINNHUB}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`);
    // Finnhub returns marketCapitalization in MILLIONS of USD.
    const marketCap = json.marketCapitalization ? Number(json.marketCapitalization) * 1e6 : null;
    const profile = { marketCap, name: json.name || null };
    _profileCache.set(symbol, profile);
    return profile;
  } catch (_e) {
    _profileCache.set(symbol, null);
    return null;
  }
}

// Last 4 quarters of earnings dates (Finnhub /stock/earnings is free).
async function getHistoricalEarningsDates(symbol, finnhubKey) {
  if (!finnhubKey) return [];
  try {
    const json = await fetchJson(`${FINNHUB}/stock/earnings?symbol=${encodeURIComponent(symbol)}&limit=4&token=${finnhubKey}`);
    if (!Array.isArray(json)) return [];
    return json
      .map((r) => r.period)
      .filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
  } catch (_e) {
    return [];
  }
}

// Yahoo /chart for daily OHLC. Returns { timestamps: number[], closes: number[] }.
async function fetchDailyOhlc(symbol, fromYmd, toYmd) {
  const period1 = Math.floor(new Date(fromYmd + 'T00:00:00Z').getTime() / 1000);
  const period2 = Math.floor(new Date(toYmd + 'T23:59:59Z').getTime() / 1000);
  const url = `${YAHOO}/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
  try {
    const json = await fetchJson(url);
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];
    return { timestamps, closes };
  } catch (_e) {
    return null;
  }
}

function ymdMinusDays(ymd, days) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function ymdPlusDays(ymd, days) {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Avg |close-to-next-trading-day-close % move| across the last 4 earnings.
// Wide ±10d window per event guarantees we capture both surrounding closes
// even when the earnings date itself isn't a trading day.
async function getAvgEarningsReaction(symbol, finnhubKey) {
  if (_moveCache.has(symbol)) return _moveCache.get(symbol);
  const dates = await getHistoricalEarningsDates(symbol, finnhubKey);
  if (dates.length === 0) {
    _moveCache.set(symbol, null);
    return null;
  }
  const moves = [];
  for (const erDate of dates) {
    const ohlc = await fetchDailyOhlc(symbol, ymdMinusDays(erDate, 10), ymdPlusDays(erDate, 10));
    if (!ohlc) continue;
    const target = Math.floor(new Date(erDate + 'T20:00:00Z').getTime() / 1000); // 4pm ET ish
    let idxBefore = -1;
    for (let i = 0; i < ohlc.timestamps.length; i++) {
      if (ohlc.timestamps[i] <= target) idxBefore = i;
      else break;
    }
    if (idxBefore < 0 || idxBefore + 1 >= ohlc.closes.length) continue;
    const a = ohlc.closes[idxBefore];
    const b = ohlc.closes[idxBefore + 1];
    if (typeof a !== 'number' || typeof b !== 'number' || a <= 0) continue;
    moves.push(Math.abs(b - a) / a);
  }
  if (moves.length === 0) {
    _moveCache.set(symbol, null);
    return null;
  }
  const avg = moves.reduce((acc, m) => acc + m, 0) / moves.length;
  _moveCache.set(symbol, avg);
  return avg;
}

// Lightweight base score, computable without external fetches.
function baseScore(row) {
  let s = 0;
  if (row.symbol.length <= 4) s += 0.5;
  if (row.epsEstimate != null) s += 0.5;
  if (row.revenueEstimate != null) s += Math.log10(Number(row.revenueEstimate) + 1) * 0.3;
  if (isHeadliner(row.symbol)) s += 3;
  return s;
}

// Full anticipation score — additive, all components optional.
function fullScore(row, { marketCap, avgMove }) {
  let s = baseScore(row);
  if (marketCap && marketCap > 0) s += Math.log10(marketCap);     // 9 ($1B) → 13 ($1T)
  if (avgMove != null) s += avgMove * 100;                         // 0.07 (7%) → +7
  return s;
}

// Enrich every earnings row with { profile, avgMove, score }. Bounded
// concurrency so we don't hammer Finnhub or Yahoo.
async function enrichAndScore(rows, { finnhubKey, concurrency = 6, maxEnrichCount = 80 } = {}) {
  const ranked = [...rows].sort((a, b) => baseScore(b) - baseScore(a));
  const toEnrich = ranked.slice(0, maxEnrichCount);
  const enriched = new Map();
  let i = 0;
  async function worker() {
    while (i < toEnrich.length) {
      const idx = i++;
      const r = toEnrich[idx];
      const [profile, avgMove] = await Promise.all([
        getProfile(r.symbol, finnhubKey),
        getAvgEarningsReaction(r.symbol, finnhubKey),
      ]);
      enriched.set(r.symbol, {
        profile,
        avgMove,
        score: fullScore(r, { marketCap: profile?.marketCap, avgMove }),
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, toEnrich.length) }, () => worker()));
  // Anything beyond maxEnrichCount keeps a base score so it still ranks below
  // enriched names but doesn't disappear from totals.
  return rows.map((r) => {
    const e = enriched.get(r.symbol);
    if (e) return { ...r, ...e };
    return { ...r, profile: null, avgMove: null, score: baseScore(r) };
  });
}

function fmtMarketCap(mc) {
  if (!mc) return '—';
  if (mc >= 1e12) return `$${(mc / 1e12).toFixed(2)}T`;
  if (mc >= 1e9) return `$${(mc / 1e9).toFixed(1)}B`;
  if (mc >= 1e6) return `$${(mc / 1e6).toFixed(0)}M`;
  return `$${mc.toFixed(0)}`;
}

function fmtMove(decimal) {
  if (decimal == null) return '—';
  return `${(decimal * 100).toFixed(1)}%`;
}

module.exports = {
  enrichAndScore,
  fullScore,
  baseScore,
  isHeadliner,
  fmtMarketCap,
  fmtMove,
};
