'use strict';

/* ============================================================================
 *  Composite "Most Anticipated" graphic.
 * ----------------------------------------------------------------------------
 *  Layout:
 *    [ Earnings Whispers weekly graphic — cropped from a source screenshot ]
 *    [ Branded "Expected Move" table — chronological order by report time ]
 *
 *  The "expected move" column uses our own historical avg post-earnings
 *  move (last 4 quarters), labeled honestly. True options-implied move
 *  requires gated data (Yahoo /v7/finance/options returns 401 unauth);
 *  historical avg next-day reaction is the closest free proxy.
 *
 *  Public API:
 *    generateCompositeGraphic({ ewImagePath, tickers, weekStart, weekEnd, ewCrop })
 *
 *  ewCrop (optional, % of source image — defaults work for a 2000x867
 *  X.com screenshot at desktop zoom):
 *    { leftPct, topPct, widthPct, heightPct }
 *
 *  Each ticker row: { symbol, hour, date, profile, avgMove, score }
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { fmtMove } = require('./anticipation');

// Read PNG dimensions from the IHDR chunk without pulling in a heavy lib.
// PNG layout: 8-byte signature + IHDR length(4) + "IHDR" + width(4) + height(4)
function readPngSize(filePath) {
  const buf = Buffer.alloc(24);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buf, 0, 24, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (buf.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`Not a PNG (no IHDR): ${filePath}`);
  }
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

// Default crop rectangle (as % of source image) for a 2000x867 desktop
// X.com screenshot of an Earnings Whispers post. Override with ewCrop if
// next week's source screenshot has different dimensions or zoom.
// Default: show the full source image (no crop). Pass a custom ewCrop if
// you're feeding an X-screenshot or any source that has surrounding chrome.
const DEFAULT_CROP = {
  leftPct: 0.0,
  topPct: 0.0,
  widthPct: 100.0,
  heightPct: 100.0,
};

const SESSION_ORDER = { bmo: 0, dmh: 1, amc: 2 };
function sessionTag(hour) {
  if (hour === 'bmo') return 'BMO';
  if (hour === 'amc') return 'AMC';
  return 'TBD';
}
function dayShort(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short' });
}
function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function shortName(name, max = 22) {
  if (!name) return '';
  // Strip corporate suffixes — handle optional trailing comma+period
  // (e.g. "e.l.f. Beauty, Inc." → "e.l.f. Beauty") and run twice in case
  // both a comma-prefixed and trailing-period variant nest together.
  let s = name;
  for (let i = 0; i < 2; i++) {
    s = s
      .replace(/[,]?\s+(Corporation|Corp\.?|Inc\.?|Incorporated|Limited|Ltd\.?|plc|PLC|Company|Co\.?|Holdings?|Group|Trust|S\.A\.|N\.V\.|S\.E\.|AG|SE)\.?$/i, '')
      .replace(/[,]?\s+(Common Stock|Class [A-Z]|ADR)$/i, '')
      .replace(/,$/, '')
      .trim();
  }
  return s.slice(0, max);
}

// Sort by (date asc, session asc) → Mon BMO < Mon AMC < Tue BMO < …
function sortChronological(rows) {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (SESSION_ORDER[a.hour] ?? 1) - (SESSION_ORDER[b.hour] ?? 1);
  });
}

function fmtRange(weekStart, weekEnd) {
  const fmt = (ymd) => {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  return `${fmt(weekStart)} – ${fmt(weekEnd)}`;
}

function buildMoveRows(tickers) {
  return tickers
    .map((t) => {
      const move = fmtMove(t.avgMove);
      const tone = t.avgMove == null ? 'na' : t.avgMove >= 0.07 ? 'hot' : t.avgMove >= 0.04 ? 'mid' : 'cool';
      return `
        <li class="mv-row tone-${tone}">
          <span class="mv-ticker">${escapeHtml(t.symbol)}</span>
          <span class="mv-name">${escapeHtml(shortName(t.profile?.name) || '—')}</span>
          <span class="mv-day">${dayShort(t.date)}</span>
          <span class="mv-sess pill-${t.hour || 'tbd'}">${sessionTag(t.hour)}</span>
          <span class="mv-move">±${move}</span>
        </li>`;
    })
    .join('');
}

function renderHtml({ ewImagePath, tickers, weekStart, weekEnd, ewCrop }) {
  const crop = { ...DEFAULT_CROP, ...(ewCrop || {}) };
  const chronological = sortChronological(tickers);
  const moveRows = buildMoveRows(chronological);
  // Embed as data URL — Playwright's setContent() runs at about:blank where
  // file:// images are blocked. Base64-inlining is the simplest portable fix.
  const ewBase64 = fs.readFileSync(ewImagePath).toString('base64');
  const fileUrl = `data:image/png;base64,${ewBase64}`;

  // The crop math: render the source image at (100 / widthPct * 100)% so the
  // selected slice fills our 100%-wide frame. Then shift it via negative
  // top/left percentages of the SCALED image dimensions.
  const scale = 100 / crop.widthPct;
  const imgWidthPct = 100 * scale;
  const imgLeftPct = -crop.leftPct * scale;
  const imgTopPct = -crop.topPct * scale;
  // Read the actual source dimensions so the cropped frame's aspect ratio
  // is always correct, regardless of which source image is supplied.
  const srcSize = readPngSize(ewImagePath);
  const cropAspect = (crop.widthPct * srcSize.w) / (crop.heightPct * srcSize.h);

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
    --text-muted:#6a7886;
    --border:rgba(255,255,255,0.06);
    --border-mid:rgba(255,255,255,0.14);
    --hot:#ff6b8b;
    --mid:#00E5FF;
    --cool:#a8b3bd;
    --font-display:'Bricolage Grotesque',system-ui,sans-serif;
    --font-body:'Inter',system-ui,sans-serif;
    --font-mono:'JetBrains Mono','SF Mono',monospace;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:1200px;background:var(--bg-darkest);color:var(--text);font-family:var(--body)}
  body{
    background:
      radial-gradient(ellipse at top right, rgba(30,168,186,0.18), transparent 55%),
      radial-gradient(ellipse at bottom left, rgba(0,229,255,0.08), transparent 55%),
      var(--bg-darkest);
    padding:48px 56px;
  }
  .top-strip{display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}
  .source-tag{font-family:var(--font-mono);font-size:12px;color:var(--text-muted);letter-spacing:0.18em;text-transform:uppercase}
  .source-tag .src{color:var(--teal);margin-right:8px}
  .week-stamp{font-family:var(--font-mono);font-size:13px;color:var(--text-mid);letter-spacing:0.1em;text-transform:uppercase}
  .week-stamp .range{color:var(--text);margin-left:8px;font-family:var(--font-display);font-size:18px;letter-spacing:-0.005em;text-transform:none}

  .ew-frame{
    width:100%;
    aspect-ratio:${cropAspect.toFixed(4)} / 1;
    overflow:hidden;
    position:relative;
    border-radius:18px;
    border:1px solid var(--border-mid);
    background:#f3edd9; /* matches EW cream backdrop while image loads */
    box-shadow:0 24px 60px rgba(0,0,0,0.45);
  }
  .ew-frame img{
    position:absolute;
    width:${imgWidthPct.toFixed(3)}%;
    height:auto;
    left:${imgLeftPct.toFixed(3)}%;
    top:${imgTopPct.toFixed(3)}%;
    display:block;
  }

  .panel-head{display:flex;justify-content:space-between;align-items:flex-end;margin:36px 0 16px 0;padding-bottom:14px;border-bottom:1px solid var(--border-mid);gap:32px}
  .panel-title{font-family:var(--font-display);font-weight:700;font-size:34px;letter-spacing:-0.02em;flex-shrink:0}
  .panel-title .accent{color:var(--teal)}
  .panel-legends{display:flex;flex-direction:column;gap:8px;align-items:flex-end}
  .legend-row{display:flex;gap:14px;align-items:center;font-family:var(--font-mono);font-size:11px;color:var(--text-muted);letter-spacing:0.06em}
  .legend-row .lbl{text-transform:uppercase;letter-spacing:0.12em;color:var(--text-muted);margin-right:4px}
  .legend-pill{display:inline-flex;align-items:center;gap:6px}
  .legend-pill .pill-mini{display:inline-block;padding:2px 8px;border-radius:999px;font-size:9px;font-weight:700;letter-spacing:0.1em}
  .legend-pill .pill-mini.bmo{background:var(--teal);color:#fff}
  .legend-pill .pill-mini.amc{background:var(--cyan);color:#0a1018}
  .legend-pill .desc{color:var(--text-mid);text-transform:none;letter-spacing:0.02em}
  .swatch{display:inline-block;width:10px;height:10px;border-radius:2px}
  .swatch.hot{background:var(--hot)} .swatch.mid{background:var(--mid)} .swatch.cool{background:var(--cool)}

  ul.mv-list{list-style:none;display:grid;grid-template-columns:repeat(2, 1fr);gap:8px}
  .mv-row{
    display:grid;
    grid-template-columns:74px 1fr 50px 60px 84px;
    align-items:center;gap:14px;
    padding:14px 18px;
    background:rgba(255,255,255,0.025);
    border:1px solid var(--border);
    border-radius:12px;
  }
  .mv-ticker{font-family:var(--font-display);font-weight:700;font-size:22px;letter-spacing:-0.01em}
  .mv-name{font-family:var(--font-body);font-size:14px;color:var(--text-mid);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .mv-day{font-family:var(--font-mono);font-size:12px;color:var(--text);letter-spacing:0.08em;text-transform:uppercase;text-align:center}
  .mv-sess{display:inline-block;padding:4px 10px;border-radius:999px;font-family:var(--font-mono);font-size:10px;font-weight:700;letter-spacing:0.1em;text-align:center}
  .pill-bmo{background:var(--teal);color:#fff}
  .pill-amc{background:var(--cyan);color:#0a1018}
  .pill-dmh, .pill-tbd{background:#3a4858;color:#fff}
  .mv-move{font-family:var(--font-mono);font-size:18px;font-weight:700;text-align:right}
  .tone-hot  .mv-move{color:var(--hot)}
  .tone-mid  .mv-move{color:var(--mid)}
  .tone-cool .mv-move{color:var(--cool)}
  .tone-na   .mv-move{color:var(--text-muted)}

  .footer{margin-top:28px;padding-top:18px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
  .footer-note{font-family:var(--font-mono);font-size:11px;color:var(--text-muted);letter-spacing:0.04em;max-width:760px;line-height:1.5}
  .footer-brand{font-family:var(--font-display);font-weight:700;font-size:18px;color:var(--text);letter-spacing:-0.01em}
  .footer-brand .dot{color:var(--teal);margin:0 6px}
</style>
</head>
<body>
  <div class="top-strip">
    <span class="source-tag"><span class="src">Source</span>Earnings Whispers · @eWhispers</span>
    <span class="week-stamp">Week of <span class="range">${escapeHtml(fmtRange(weekStart, weekEnd))}</span></span>
  </div>
  <div class="ew-frame">
    <img src="${escapeHtml(fileUrl)}" alt="Earnings Whispers — Most Anticipated Earnings Releases" />
  </div>
  <div class="panel-head">
    <div class="panel-title">Expected <span class="accent">Moves</span> · Chronological</div>
    <div class="panel-legends">
      <div class="legend-row">
        <span class="lbl">Session</span>
        <span class="legend-pill"><span class="pill-mini bmo">BMO</span><span class="desc">Before Market Open</span></span>
        <span class="legend-pill"><span class="pill-mini amc">AMC</span><span class="desc">After Market Close</span></span>
      </div>
      <div class="legend-row">
        <span class="lbl">Avg Move</span>
        <span class="legend-pill"><span class="swatch hot"></span><span class="desc">≥ 7%</span></span>
        <span class="legend-pill"><span class="swatch mid"></span><span class="desc">4 – 7%</span></span>
        <span class="legend-pill"><span class="swatch cool"></span><span class="desc">&lt; 4%</span></span>
      </div>
    </div>
  </div>
  <ul class="mv-list">${moveRows}</ul>
  <div class="footer">
    <div class="footer-note">
      "Expected move" = mean |next-day close % change| over the last 4 earnings reports (Finnhub + Yahoo Finance).
      A free proxy for the options-implied move you'd see at the open of report day.
      Graphic above © Earnings Whispers, used as reference for community context.
    </div>
    <div class="footer-brand">Main Street<span class="dot">·</span>Trades</div>
  </div>
</body>
</html>`;
}

async function generateCompositeGraphic({ ewImagePath, tickers, weekStart, weekEnd, ewCrop }) {
  const { chromium } = require('playwright');

  if (!fs.existsSync(ewImagePath)) {
    throw new Error(`EW source image not found: ${ewImagePath}`);
  }

  const html = renderHtml({ ewImagePath, tickers, weekStart, weekEnd, ewCrop });
  const outDir = path.join(os.tmpdir(), 'mst-calendar-cron');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `composite-anticipated-${weekStart}.png`);

  const browser = await chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1200, height: 1800 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    // fullPage:true → output sized to actual document height
    await page.screenshot({ path: outPath, type: 'png', fullPage: true });
    await ctx.close();
  } finally {
    await browser.close();
  }
  return outPath;
}

module.exports = { generateCompositeGraphic, sortChronological };
