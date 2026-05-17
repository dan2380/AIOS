'use strict';

/* Standalone preview — renders the branded graphic with fixture data
 * and opens the PNG. Lets you iterate on the template without paying
 * the Finnhub/Yahoo enrichment cost. */

const { generateAnticipatedGraphic } = require('../lib/branded-graphic');
const { execSync } = require('child_process');

const FIXTURE = {
  weekStart: '2026-05-18',
  weekEnd: '2026-05-22',
  tickers: [
    { symbol: 'NVDA',  hour: 'amc', date: '2026-05-20', profile: { name: 'NVIDIA Corp',        marketCap: 3.4e12 }, avgMove: 0.082, score: 21.2 },
    { symbol: 'WMT',   hour: 'bmo', date: '2026-05-19', profile: { name: 'Walmart Inc',         marketCap: 7.5e11 }, avgMove: 0.045, score: 17.3 },
    { symbol: 'HD',    hour: 'bmo', date: '2026-05-20', profile: { name: 'Home Depot Inc',      marketCap: 3.6e11 }, avgMove: 0.041, score: 16.1 },
    { symbol: 'BABA',  hour: 'bmo', date: '2026-05-21', profile: { name: 'Alibaba Group',       marketCap: 2.4e11 }, avgMove: 0.071, score: 18.0 },
    { symbol: 'PANW',  hour: 'amc', date: '2026-05-20', profile: { name: 'Palo Alto Networks',  marketCap: 1.3e11 }, avgMove: 0.092, score: 19.1 },
    { symbol: 'SNOW',  hour: 'amc', date: '2026-05-21', profile: { name: 'Snowflake Inc',       marketCap: 6.5e10 }, avgMove: 0.135, score: 21.8 },
    { symbol: 'ZM',    hour: 'amc', date: '2026-05-21', profile: { name: 'Zoom Communications', marketCap: 2.3e10 }, avgMove: 0.082, score: 15.4 },
    { symbol: 'TGT',   hour: 'bmo', date: '2026-05-21', profile: { name: 'Target Corporation',  marketCap: 6.8e10 }, avgMove: 0.097, score: 17.3 },
    { symbol: 'LOW',   hour: 'bmo', date: '2026-05-21', profile: { name: 'Lowes Companies',     marketCap: 1.4e11 }, avgMove: 0.053, score: 16.6 },
    { symbol: 'INTU',  hour: 'amc', date: '2026-05-22', profile: { name: 'Intuit Inc',          marketCap: 1.8e11 }, avgMove: 0.062, score: 17.4 },
  ],
};

(async () => {
  const out = await generateAnticipatedGraphic(FIXTURE);
  console.log(`✓ rendered ${out}`);
  try { execSync(`open "${out}"`); } catch (_e) { /* ignore on non-mac */ }
})();
