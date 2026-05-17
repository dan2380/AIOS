'use strict';

/* ============================================================================
 *  MST-branded "Most Anticipated Earnings" weekly graphic.
 * ----------------------------------------------------------------------------
 *  Renders an HTML template (Cosmetics Growth tokens: teal #1ea8ba,
 *  Bricolage Grotesque + Inter) to a 1200x1500 PNG via Playwright headless
 *  Chromium. Output is shareable on Discord, X, Reddit, etc. — no IP risk
 *  vs. mirroring the @eWhispers graphic.
 *
 *  Public API:
 *    generateAnticipatedGraphic({ tickers, weekStart, weekEnd }) → string (PNG path)
 *
 *  Each ticker row expects:
 *    { symbol, hour, date, profile: { name, marketCap }, avgMove, score }
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { fmtMarketCap, fmtMove } = require('./anticipation');

function fmtDayOfWeek(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short' });
}

function sessionPill(hour) {
  if (hour === 'bmo') return { label: 'BMO', bg: '#1ea8ba', fg: '#fff' };
  if (hour === 'amc') return { label: 'AMC', bg: '#00E5FF', fg: '#0a1018' };
  return { label: 'TBD', bg: '#3a4858', fg: '#fff' };
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shorten(name, max = 28) {
  if (!name) return '';
  return name
    .replace(/\s+(Corporation|Corp\.?|Inc\.?|Incorporated|Limited|Ltd\.?|plc|PLC|Company|Co\.?|Holdings?|Group|Trust|S\.A\.|N\.V\.|S\.E\.|AG|SE)$/i, '')
    .replace(/\s+(Common Stock|Class [A-Z]|ADR)$/i, '')
    .trim()
    .slice(0, max);
}

function fmtRange(weekStart, weekEnd) {
  const fmt = (ymd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  return `${fmt(weekStart)} – ${fmt(weekEnd)}`;
}

function renderHtml({ tickers, weekStart, weekEnd }) {
  const rows = tickers
    .map((t, i) => {
      const s = sessionPill(t.hour);
      const name = escapeHtml(shorten(t.profile?.name) || '—');
      const move = fmtMove(t.avgMove);
      const cap = fmtMarketCap(t.profile?.marketCap);
      const day = fmtDayOfWeek(t.date);
      return `
        <li class="row">
          <span class="rank">${i + 1}</span>
          <span class="ticker">${escapeHtml(t.symbol)}</span>
          <span class="name">${name}</span>
          <span class="day">${day}</span>
          <span class="pill" style="background:${s.bg};color:${s.fg}">${s.label}</span>
          <span class="move">±${move}</span>
          <span class="cap">${cap}</span>
        </li>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
  :root{
    --bg-darkest:#0a1018;
    --bg-dark:#141a24;
    --teal:#1ea8ba;
    --cyan:#00E5FF;
    --text:#ffffff;
    --text-mid:#a8b3bd;
    --text-muted:#5a6a78;
    --border:rgba(255,255,255,0.06);
    --border-mid:rgba(255,255,255,0.12);
    --font-display:'Bricolage Grotesque',system-ui,sans-serif;
    --font-body:'Inter',system-ui,sans-serif;
    --font-mono:'JetBrains Mono','SF Mono',monospace;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1200px;height:1500px;background:var(--bg-darkest);color:var(--text);font-family:var(--font-body);overflow:hidden}
  body{
    background:
      radial-gradient(ellipse at top right, rgba(30,168,186,0.18), transparent 55%),
      radial-gradient(ellipse at bottom left, rgba(0,229,255,0.08), transparent 55%),
      var(--bg-darkest);
    padding:64px 72px;
    position:relative;
  }
  .grain::before{
    content:"";position:absolute;inset:0;pointer-events:none;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence baseFrequency='0.9' numOctaves='2' /></filter><rect width='200' height='200' filter='url(%23n)' opacity='0.04'/></svg>");
    mix-blend-mode:overlay;
  }
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid var(--border-mid);padding-bottom:32px;margin-bottom:40px}
  .brand-mark{font-family:var(--font-mono);font-size:14px;letter-spacing:0.18em;color:var(--teal);text-transform:uppercase;margin-bottom:18px;display:flex;align-items:center;gap:14px}
  .brand-mark::before{content:"";width:24px;height:2px;background:var(--teal);display:inline-block}
  h1{font-family:var(--font-display);font-weight:700;font-size:64px;line-height:1.02;letter-spacing:-0.025em;margin-bottom:16px}
  h1 .accent{color:var(--teal)}
  .subtitle{font-family:var(--font-mono);font-size:18px;color:var(--text-mid);letter-spacing:0.04em}
  .week-stamp{text-align:right;font-family:var(--font-mono);font-size:14px;color:var(--text-muted);letter-spacing:0.14em;text-transform:uppercase}
  .week-stamp .range{display:block;font-family:var(--font-display);font-size:28px;color:var(--text);letter-spacing:-0.01em;margin-top:6px;text-transform:none}

  ul.list{list-style:none;display:flex;flex-direction:column;gap:8px}
  .col-head{
    display:grid;grid-template-columns:48px 110px 1fr 80px 84px 110px 130px;
    align-items:center;gap:18px;
    padding:0 24px 14px 24px;
    font-family:var(--font-mono);font-size:11px;letter-spacing:0.16em;color:var(--text-muted);text-transform:uppercase;
    border-bottom:1px solid var(--border);
    margin-bottom:6px;
  }
  .row{
    display:grid;grid-template-columns:48px 110px 1fr 80px 84px 110px 130px;
    align-items:center;gap:18px;
    background:rgba(255,255,255,0.025);
    border:1px solid var(--border);
    border-radius:14px;
    padding:18px 24px;
    transition:background .2s;
  }
  .row:nth-child(odd){background:rgba(255,255,255,0.04)}
  .rank{font-family:var(--font-mono);font-weight:700;font-size:22px;color:var(--teal);text-align:left}
  .ticker{font-family:var(--font-display);font-weight:700;font-size:26px;letter-spacing:-0.01em}
  .name{font-family:var(--font-body);font-size:18px;color:var(--text-mid);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .day{font-family:var(--font-mono);font-size:14px;color:var(--text);letter-spacing:0.08em;text-transform:uppercase}
  .pill{display:inline-block;padding:5px 12px;border-radius:999px;font-family:var(--font-mono);font-size:11px;font-weight:700;letter-spacing:0.1em;text-align:center}
  .move{font-family:var(--font-mono);font-size:18px;font-weight:700;color:var(--cyan);text-align:right}
  .cap{font-family:var(--font-mono);font-size:18px;font-weight:600;color:var(--text);text-align:right}

  footer{position:absolute;bottom:48px;left:72px;right:72px;display:flex;justify-content:space-between;align-items:center;padding-top:24px;border-top:1px solid var(--border)}
  .source{font-family:var(--font-mono);font-size:12px;color:var(--text-muted);letter-spacing:0.06em}
  .footer-brand{font-family:var(--font-display);font-weight:700;font-size:22px;color:var(--text);letter-spacing:-0.01em}
  .footer-brand .dot{color:var(--teal);margin:0 6px}
</style>
</head>
<body class="grain">
  <header>
    <div>
      <div class="brand-mark">Main Street Trades</div>
      <h1>Most Anticipated<br/><span class="accent">Earnings</span> This Week</h1>
      <div class="subtitle">Ranked by size · historical post-earnings move · coverage</div>
    </div>
    <div class="week-stamp">
      Week of
      <span class="range">${escapeHtml(fmtRange(weekStart, weekEnd))}</span>
    </div>
  </header>
  <div class="col-head">
    <span>#</span>
    <span>Ticker</span>
    <span>Company</span>
    <span>Day</span>
    <span style="text-align:center">Session</span>
    <span style="text-align:right">Avg Move</span>
    <span style="text-align:right">Mkt Cap</span>
  </div>
  <ul class="list">${rows}</ul>
  <footer>
    <span class="source">Data · Finnhub + Yahoo Finance · Avg move = mean |next-day close %| last 4 quarters</span>
    <span class="footer-brand">Main Street<span class="dot">·</span>Trades</span>
  </footer>
</body>
</html>`;
}

async function generateAnticipatedGraphic({ tickers, weekStart, weekEnd }) {
  // Lazy-require so the cron doesn't pay the Playwright load cost on weekdays.
  const { chromium } = require('playwright');

  const html = renderHtml({ tickers, weekStart, weekEnd });
  const outDir = path.join(os.tmpdir(), 'mst-calendar-cron');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `most-anticipated-${weekStart}.png`);

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1200, height: 1500 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    // Give web fonts an extra moment so the screenshot doesn't fall back to system fonts.
    await page.waitForTimeout(500);
    await page.screenshot({ path: outPath, type: 'png', fullPage: false });
    await ctx.close();
  } finally {
    await browser.close();
  }

  return outPath;
}

module.exports = { generateAnticipatedGraphic };
