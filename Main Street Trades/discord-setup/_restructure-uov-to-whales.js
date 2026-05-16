/* eslint-disable no-console */
'use strict';
// One-shot: split the existing #🐋-unusual-options-volume channel into two
// new member-facing channels under the same category, with the same perms,
// at the same slot:
//
//   #🐋-whale-trades   → Tradytics Sweeps feed (regular)
//   #🐳-mega-whales    → Tradytics Golden Sweeps feed (>$1M premium)
//
// Then refresh "Tradytics Webhooks - <MM-DD-YY>.html" so it lists all 12
// channels (10 existing TRADYTICS feeds + 2 new whale channels) with copy
// buttons. The two new entries go at positions 2 and 3 (right after Trady
// Flow), not at the bottom.
//
// After this runs, Daniel must repaste the two new webhook URLs into
// Tradytics' dashboard portal (the Sweeps + Golden Sweeps fields) — the
// previous webhooks pointing at the deleted UOV channel will 404.

const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.resolve(__dirname, '..', '.env'))
  ? path.resolve(__dirname, '..', '.env')
  : path.resolve(__dirname, '.env');
require('dotenv').config({ path: envPath });

const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits, OverwriteType } = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
if (!TOKEN || !GUILD_ID) { console.error('✗ missing DISCORD_BOT_TOKEN or GUILD_ID'); process.exit(1); }

const UOV_CHANNEL_ID = '1504238046156165150';
const TRADYTICS_CAT_ID = '1504914311745900615';

const NEW_CHANNELS = [
  {
    name: '🐋-whale-trades',
    label: 'Whale Trades',
    topic: 'Tradytics — Whale Trades (options sweeps). Replaces #unusual-options-volume.',
    webhookName: 'Tradytics — Whale Trades',
  },
  {
    name: '🐳-mega-whales',
    label: 'Mega Whales',
    topic: 'Tradytics — Mega Whales (golden sweeps · options orders with >$1M premium).',
    webhookName: 'Tradytics — Mega Whales',
  },
];

// Order to render in the HTML (label + slug match the channel inside the
// TRADYTICS category). The two new whale channels are inserted at positions
// 2 and 3 — right after Trady Flow.
const TRADYTICS_FEEDS_ORDER = [
  { label: 'Trady Flow',       slug: 'trady-flow',       categoryId: TRADYTICS_CAT_ID },
  { label: 'Whale Trades',     slug: '🐋-whale-trades',   categoryId: null /* filled at runtime */ },
  { label: 'Mega Whales',      slug: '🐳-mega-whales',    categoryId: null },
  { label: 'Darkpool',         slug: 'darkpool',         categoryId: TRADYTICS_CAT_ID },
  { label: 'Bullseye',         slug: 'bullseye',         categoryId: TRADYTICS_CAT_ID },
  { label: 'Scalps',           slug: 'scalps',           categoryId: TRADYTICS_CAT_ID },
  { label: 'Social Spike',     slug: 'social-spike',     categoryId: TRADYTICS_CAT_ID },
  { label: 'Stock Breakouts',  slug: 'stock-breakouts',  categoryId: TRADYTICS_CAT_ID },
  { label: 'Analyst Grades',   slug: 'analyst-grades',   categoryId: TRADYTICS_CAT_ID },
  { label: 'Important News',   slug: 'important-news',   categoryId: TRADYTICS_CAT_ID },
  { label: 'Crypto Breakouts', slug: 'crypto-breakouts', categoryId: TRADYTICS_CAT_ID },
  { label: 'Crypto Signals',   slug: 'crypto-signals',   categoryId: TRADYTICS_CAT_ID },
];

function fmtDateMMDDYY(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}-${dd}-${yy}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildHtml(results) {
  const rows = results.map((r, i) => `
        <li class="row" data-i="${i}">
          <div class="row-head">
            <div class="row-label">
              <span class="row-num">${String(i + 1).padStart(2, '0')}</span>
              <span class="row-name">${escapeHtml(r.label)}</span>
              <span class="row-meta">#${escapeHtml(r.slug)} · ${escapeHtml(r.channelId)}</span>
            </div>
            <button class="copy-btn" type="button" data-target="hook-${i}" aria-label="Copy ${escapeHtml(r.label)} webhook">
              <svg class="ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 9h11v11H9zM4 4h11v11"/></svg>
              <span class="copy-label">Copy</span>
            </button>
          </div>
          <code id="hook-${i}" class="hook">${escapeHtml(r.webhookUrl)}</code>
        </li>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="theme-color" content="#1ea8ba" />
  <link rel="icon" type="image/png" href="favicon.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="favicon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <title>Tradytics Webhooks · Main Street Trades</title>
  <style>
    :root{--bg:#FFFFFF;--bg-soft:#F2F5F8;--bg-dark:#1c232f;--bg-darkest:#141a24;--teal:#1ea8ba;--teal-dark:#177080;--teal-pale:rgba(30,168,186,0.08);--teal-border:rgba(30,168,186,0.18);--cyan:#00E5FF;--text:#1c232f;--text-mid:#3a4858;--text-muted:#7a8a95;--border:rgba(28,35,47,0.08);--border-mid:rgba(28,35,47,0.14);--font-display:'Bricolage Grotesque',system-ui,sans-serif;--font-body:'Inter',system-ui,sans-serif;--font-mono:'JetBrains Mono','SF Mono','Fira Code',monospace}
    *{box-sizing:border-box} html,body{margin:0}
    body{background:radial-gradient(900px 500px at 90% -10%,var(--teal-pale),transparent 60%),radial-gradient(700px 400px at -10% 110%,rgba(0,229,255,0.04),transparent 55%),var(--bg);color:var(--text);font-family:var(--font-body);font-size:15px;line-height:1.55;min-height:100vh}
    .wrap{max-width:920px;margin:0 auto;padding:56px 28px 80px}
    header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding-bottom:28px;margin-bottom:32px;border-bottom:1px solid var(--border)}
    h1{font-family:var(--font-display);font-size:clamp(2rem,1.4rem + 2vw,2.75rem);letter-spacing:-0.02em;margin:0 0 6px}
    .eyebrow{font-family:var(--font-mono);font-size:11px;text-transform:uppercase;letter-spacing:0.18em;color:var(--teal-dark);margin-bottom:12px}
    .lede{color:var(--text-mid);margin:0;max-width:56ch}
    .meta{font-family:var(--font-mono);font-size:12px;color:var(--text-muted);text-align:right;line-height:1.7;flex-shrink:0}
    .meta strong{color:var(--text-mid);font-weight:500}
    .all-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;margin-bottom:24px;background:var(--teal-pale);border:1px solid var(--teal-border);border-radius:10px}
    .all-bar .label{font-family:var(--font-mono);font-size:12px;color:var(--teal-dark);letter-spacing:0.04em}
    .copy-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;font:500 12px var(--font-body);background:var(--bg);color:var(--text);border:1px solid var(--border-mid);border-radius:8px;cursor:pointer;transition:transform 120ms ease,background 120ms ease,border-color 120ms ease,color 120ms ease}
    .copy-btn:hover{border-color:var(--teal);color:var(--teal-dark)} .copy-btn:active{transform:translateY(1px)}
    .copy-btn.copied{background:var(--teal);border-color:var(--teal);color:#fff}
    ol.feeds{list-style:none;padding:0;margin:0;display:grid;gap:14px}
    .row{background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:16px 18px;transition:border-color 140ms ease,transform 140ms ease}
    .row:hover{border-color:var(--border-mid)}
    .row-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:10px}
    .row-label{display:flex;align-items:baseline;gap:12px;min-width:0}
    .row-num{font-family:var(--font-mono);font-size:11px;color:var(--text-muted);letter-spacing:0.06em}
    .row-name{font-family:var(--font-display);font-weight:600;font-size:18px;letter-spacing:-0.01em}
    .row-meta{font-family:var(--font-mono);font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    code.hook{display:block;font-family:var(--font-mono);font-size:12px;color:var(--text);background:var(--bg-soft);border:1px solid var(--border);border-radius:8px;padding:10px 12px;white-space:nowrap;overflow-x:auto;user-select:all}
    .toast{position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);background:var(--bg-dark);color:#fff;padding:10px 16px;border-radius:8px;font-family:var(--font-mono);font-size:12px;letter-spacing:0.03em;box-shadow:0 12px 32px rgba(28,35,47,0.18);opacity:0;transition:opacity 180ms ease,transform 180ms ease;pointer-events:none}
    .toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
    .row.is-new{border-color:var(--teal);box-shadow:0 0 0 1px var(--teal-pale)}
    .row.is-new .row-name::after{content:'NEW';margin-left:10px;display:inline-block;font-family:var(--font-mono);font-size:9px;letter-spacing:0.12em;color:#fff;background:var(--teal);padding:2px 6px;border-radius:4px;vertical-align:middle}
    footer{margin-top:44px;padding-top:22px;border-top:1px solid var(--border);font-family:var(--font-mono);font-size:11px;color:var(--text-muted);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
    @media (max-width:640px){header{flex-direction:column;align-items:flex-start}.meta{text-align:left}.row-head{flex-direction:column;align-items:flex-start}}
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <div class="eyebrow">Main Street Trades · ${escapeHtml(fmtDateMMDDYY())}</div>
        <h1>Tradytics Webhooks</h1>
        <p class="lede">Paste each webhook URL into the matching field on the Tradytics dashboard. <strong>Whale Trades</strong> and <strong>Mega Whales</strong> are the Tradytics Sweeps + Golden Sweeps fields respectively — they replace the retired Unusual Options Volume webhook.</p>
      </div>
      <div class="meta">
        <div><strong>Server:</strong> Main Street Trades</div>
        <div><strong>Feeds:</strong> ${results.length}</div>
        <div><strong>New:</strong> 2 (whale-trades, mega-whales)</div>
      </div>
    </header>

    <div class="all-bar">
      <span class="label">Need all of them at once?</span>
      <button id="copy-all" class="copy-btn" type="button">
        <svg class="ico" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M9 9h11v11H9zM4 4h11v11"/></svg>
        <span class="copy-label">Copy all (label = url)</span>
      </button>
    </div>

    <ol class="feeds">
${rows.replace(/<li class="row" data-i="(\d+)">/g, (m, idx) => {
  const r = results[Number(idx)];
  return r && r.isNew ? `<li class="row is-new" data-i="${idx}">` : m;
})}
    </ol>

    <footer>
      <span>Generated ${escapeHtml(new Date().toISOString())}</span>
      <span>Webhook URLs are bearer credentials — treat like passwords.</span>
    </footer>
  </div>

  <div id="toast" class="toast" role="status" aria-live="polite">Copied</div>

  <script>
    const toast = document.getElementById('toast'); let toastTimer;
    function showToast(msg){toast.textContent=msg;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),1600)}
    async function copyText(text){try{await navigator.clipboard.writeText(text);return true}catch{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');document.body.removeChild(ta);return ok}}
    document.querySelectorAll('.copy-btn[data-target]').forEach((btn)=>{btn.addEventListener('click',async()=>{const el=document.getElementById(btn.dataset.target);if(!el)return;const ok=await copyText(el.textContent);if(!ok)return showToast('Copy failed');btn.classList.add('copied');const lbl=btn.querySelector('.copy-label');const prev=lbl.textContent;lbl.textContent='Copied';showToast('Webhook copied');setTimeout(()=>{btn.classList.remove('copied');lbl.textContent=prev},1400)})});
    const allBtn=document.getElementById('copy-all');
    if(allBtn){allBtn.addEventListener('click',async()=>{const lines=[...document.querySelectorAll('.row')].map((row)=>{const name=row.querySelector('.row-name')?.textContent?.replace(/NEW$/,'').trim()||'';const url=row.querySelector('code.hook')?.textContent?.trim()||'';return name+'\\t'+url}).join('\\n');const ok=await copyText(lines);if(!ok)return showToast('Copy failed');allBtn.classList.add('copied');const lbl=allBtn.querySelector('.copy-label');const prev=lbl.textContent;lbl.textContent='Copied';showToast('All '+${results.length}+' webhooks copied');setTimeout(()=>{allBtn.classList.remove('copied');lbl.textContent=prev},1600)})}
  </script>
</body>
</html>
`;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();

    const uov = guild.channels.cache.get(UOV_CHANNEL_ID);
    if (!uov) {
      throw new Error(`UOV channel ${UOV_CHANNEL_ID} not found — already deleted? Edit the script if you want to skip this step.`);
    }
    const parentId = uov.parentId;
    const uovPos = uov.position;
    const uovOverwrites = [...uov.permissionOverwrites.cache.values()].map((ow) => ({
      id: ow.id,
      type: ow.type === OverwriteType.Role ? 0 : 1,
      allow: ow.allow.bitfield,
      deny: ow.deny.bitfield,
    }));
    console.log(`→ UOV channel #${uov.name} (${uov.id}) — parent ${parentId}, position ${uovPos}, ${uovOverwrites.length} overwrites`);

    // Create the two new channels with cloned permissions, in the same category.
    const newResults = [];
    for (const spec of NEW_CHANNELS) {
      // Idempotency: skip if it already exists in the same category.
      let ch = guild.channels.cache.find(
        (c) => c.name === spec.name && c.type === ChannelType.GuildText && c.parentId === parentId,
      );
      if (ch) {
        console.log(`  → existing #${ch.name} (${ch.id}) — reusing`);
      } else {
        ch = await guild.channels.create({
          name: spec.name,
          type: ChannelType.GuildText,
          parent: parentId,
          topic: spec.topic,
          permissionOverwrites: uovOverwrites,
          reason: 'Replace #unusual-options-volume with Whale Trades + Mega Whales',
        });
        console.log(`  ✓ created #${ch.name} (${ch.id})`);
      }

      // Webhook (idempotent by name).
      const hooks = await ch.fetchWebhooks();
      let wh = hooks.find((h) => h.name === spec.webhookName);
      if (wh) {
        console.log(`    → reusing webhook "${spec.webhookName}" (${wh.id})`);
      } else {
        wh = await ch.createWebhook({ name: spec.webhookName, reason: `${spec.label} feed` });
        console.log(`    ✓ created webhook "${spec.webhookName}" (${wh.id})`);
      }

      newResults.push({
        label: spec.label,
        slug: spec.name,
        channelId: ch.id,
        webhookUrl: wh.url,
        isNew: true,
      });
    }

    // Position: whale-trades at uovPos, mega-whales at uovPos+1.
    try {
      const whale = newResults[0]; const mega = newResults[1];
      const whaleCh = guild.channels.cache.get(whale.channelId);
      const megaCh = guild.channels.cache.get(mega.channelId);
      await whaleCh.setPosition(uovPos);
      await megaCh.setPosition(uovPos + 1);
      console.log(`  ✓ positioned: whale=${uovPos}, mega=${uovPos + 1}`);
    } catch (e) {
      console.warn(`  ⚠ could not set positions: ${e.message}`);
    }

    // Delete the old UOV channel.
    await uov.delete('Replaced by #🐋-whale-trades + #🐳-mega-whales');
    console.log(`  ✓ deleted #${uov.name} (${uov.id})`);

    // ─── Build the 12-entry HTML ─────────────────────────────────────────────
    // Pull webhook URLs for the 10 TRADYTICS-category channels, then merge
    // the 2 new whale channels at positions 2 and 3 (after Trady Flow).
    await guild.channels.fetch();
    const tradyChannels = [...guild.channels.cache.values()].filter(
      (c) => c.parentId === TRADYTICS_CAT_ID && c.type === ChannelType.GuildText,
    );

    const results = [];
    for (const spec of TRADYTICS_FEEDS_ORDER) {
      // If it's a whale entry, take from newResults
      if (spec.slug === '🐋-whale-trades' || spec.slug === '🐳-mega-whales') {
        const m = newResults.find((r) => r.slug === spec.slug);
        if (m) results.push(m);
        continue;
      }
      const ch = tradyChannels.find((c) => c.name === spec.slug);
      if (!ch) { console.warn(`  ⚠ missing TRADYTICS feed: ${spec.slug}`); continue; }
      const hooks = await ch.fetchWebhooks();
      const wh = [...hooks.values()].find((h) => h.name === `Tradytics — ${spec.label}`)
               || [...hooks.values()][0];
      if (!wh) { console.warn(`  ⚠ no webhook on #${spec.slug}`); continue; }
      results.push({
        label: spec.label,
        slug: spec.slug,
        channelId: ch.id,
        webhookUrl: wh.url,
      });
    }

    const stamp = fmtDateMMDDYY();
    const outPath = path.resolve(__dirname, '..', `Tradytics Webhooks - ${stamp}.html`);
    fs.writeFileSync(outPath, buildHtml(results), { mode: 0o600 });
    console.log('');
    console.log(`✓ wrote ${outPath}`);
    console.log(`  ${results.length} entries total (2 new: whale-trades, mega-whales)`);

    console.log('\n--- Next step ---');
    console.log('  Repaste these two webhook URLs into Tradytics\' dashboard:');
    console.log(`    Sweeps         → ${newResults[0].webhookUrl}`);
    console.log(`    Golden Sweeps  → ${newResults[1].webhookUrl}`);
    console.log('  The previous webhooks (pointing at the deleted UOV channel) now 404.');
  } catch (err) {
    console.error('✗ failed:', err.message || err);
    if (err.stack) console.error(err.stack);
    process.exitCode = 1;
  } finally {
    client.destroy();
    process.exit();
  }
});

client.login(TOKEN);
