/* eslint-disable no-console */
'use strict';
// One-shot, idempotent: create the TRADYTICS category (hidden from @everyone,
// visible to Founder/Admin/Mod) and a text channel per Tradytics feed inside
// it. Then create or reuse a webhook per channel and emit a single HTML page
// with copy-to-clipboard buttons for every webhook URL.
//
// Visibility:
//   @everyone   → denied
//   Admin       → full access (view, send, manage, history, attach, embed, webhooks)
//   Mod         → full access except channel/message management
//   Bot itself  → view + send + history + manage-webhooks + embed + attach
//
// Note: MST has no "Founder" role — Admin is the top human role. There are
// two "Admin" roles in the guild (one is a managed bot integration); we
// select the unmanaged human role via `!r.managed`.
//
// Output:
//   Main Street Trades/Tradytics Webhooks - <MM-DD-YY>.html

const fs = require('fs');
const path = require('path');

const parentEnvPath = path.resolve(__dirname, '..', '.env');
const localEnvPath = path.resolve(__dirname, '.env');
const envPath = fs.existsSync(parentEnvPath) ? parentEnvPath : localEnvPath;
require('dotenv').config({ path: envPath });

const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !GUILD_ID) {
  console.error('✗ Missing DISCORD_BOT_TOKEN or GUILD_ID in .env');
  console.error(`  Looked in: ${envPath}`);
  process.exit(1);
}

const CATEGORY_NAME = 'TRADYTICS';
// Order matches the Tradytics dashboard screenshots; channels will be
// positioned in this exact order inside the category.
const FEEDS = [
  { label: 'Trady Flow',       slug: 'trady-flow',       topic: 'Tradytics — Trady Flow signals (auto-posted).' },
  { label: 'Darkpool',         slug: 'darkpool',         topic: 'Tradytics — Darkpool prints (auto-posted).' },
  { label: 'Bullseye',         slug: 'bullseye',         topic: 'Tradytics — Bullseye signals (auto-posted).' },
  { label: 'Scalps',           slug: 'scalps',           topic: 'Tradytics — Scalp setups (auto-posted).' },
  { label: 'Social Spike',     slug: 'social-spike',     topic: 'Tradytics — Social Spike signals (auto-posted).' },
  { label: 'Stock Breakouts',  slug: 'stock-breakouts',  topic: 'Tradytics — Stock Breakouts (auto-posted).' },
  { label: 'Analyst Grades',   slug: 'analyst-grades',   topic: 'Tradytics — Analyst Grades / rating changes (auto-posted).' },
  { label: 'Important News',   slug: 'important-news',   topic: 'Tradytics — Important News alerts (auto-posted).' },
  { label: 'Crypto Breakouts', slug: 'crypto-breakouts', topic: 'Tradytics — Crypto Breakouts (auto-posted).' },
  { label: 'Crypto Signals',   slug: 'crypto-signals',   topic: 'Tradytics — Crypto Signals (auto-posted).' },
];

const P = PermissionFlagsBits;
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function buildOverwrites(everyone, admin, mod, botId) {
  return [
    { id: everyone.id, deny: [P.ViewChannel] },
    {
      id: admin.id,
      allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages, P.ManageChannels, P.EmbedLinks, P.AttachFiles, P.ManageWebhooks, P.AddReactions],
    },
    {
      id: mod.id,
      allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.AttachFiles, P.AddReactions],
    },
    {
      id: botId,
      allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.AttachFiles, P.ManageWebhooks],
    },
  ];
}

function fmtDateMMDDYY(d = new Date()) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}-${dd}-${yy}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    :root {
      --bg: #FFFFFF;
      --bg-soft: #F2F5F8;
      --bg-dark: #1c232f;
      --bg-darkest: #141a24;
      --teal: #1ea8ba;
      --teal-dark: #177080;
      --teal-pale: rgba(30,168,186,0.08);
      --teal-border: rgba(30,168,186,0.18);
      --cyan: #00E5FF;
      --text: #1c232f;
      --text-mid: #3a4858;
      --text-muted: #7a8a95;
      --border: rgba(28,35,47,0.08);
      --border-mid: rgba(28,35,47,0.14);
      --font-display: 'Bricolage Grotesque', system-ui, sans-serif;
      --font-body: 'Inter', system-ui, sans-serif;
      --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; }
    body {
      background:
        radial-gradient(900px 500px at 90% -10%, var(--teal-pale), transparent 60%),
        radial-gradient(700px 400px at -10% 110%, rgba(0,229,255,0.04), transparent 55%),
        var(--bg);
      color: var(--text);
      font-family: var(--font-body);
      font-size: 15px;
      line-height: 1.55;
      min-height: 100vh;
    }
    .wrap { max-width: 920px; margin: 0 auto; padding: 56px 28px 80px; }
    header {
      display: flex; align-items: flex-end; justify-content: space-between;
      gap: 24px; padding-bottom: 28px; margin-bottom: 32px;
      border-bottom: 1px solid var(--border);
    }
    h1 {
      font-family: var(--font-display);
      font-size: clamp(2rem, 1.4rem + 2vw, 2.75rem);
      letter-spacing: -0.02em;
      margin: 0 0 6px;
    }
    .eyebrow {
      font-family: var(--font-mono);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--teal-dark);
      margin-bottom: 12px;
    }
    .lede { color: var(--text-mid); margin: 0; max-width: 56ch; }
    .meta {
      font-family: var(--font-mono); font-size: 12px; color: var(--text-muted);
      text-align: right; line-height: 1.7; flex-shrink: 0;
    }
    .meta strong { color: var(--text-mid); font-weight: 500; }
    .all-bar {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; padding: 14px 18px; margin-bottom: 24px;
      background: var(--teal-pale);
      border: 1px solid var(--teal-border);
      border-radius: 10px;
    }
    .all-bar .label {
      font-family: var(--font-mono); font-size: 12px; color: var(--teal-dark);
      letter-spacing: 0.04em;
    }
    .copy-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 7px 12px; font: 500 12px var(--font-body);
      background: var(--bg); color: var(--text);
      border: 1px solid var(--border-mid); border-radius: 8px;
      cursor: pointer; transition: transform 120ms ease, background 120ms ease, border-color 120ms ease, color 120ms ease;
    }
    .copy-btn:hover { border-color: var(--teal); color: var(--teal-dark); }
    .copy-btn:active { transform: translateY(1px); }
    .copy-btn.copied { background: var(--teal); border-color: var(--teal); color: #fff; }
    .copy-btn.copied .ico { opacity: 0.9; }
    .ico { display: inline-block; }
    ol.feeds { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }
    .row {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 18px;
      transition: border-color 140ms ease, transform 140ms ease;
    }
    .row:hover { border-color: var(--border-mid); }
    .row-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; margin-bottom: 10px;
    }
    .row-label { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
    .row-num {
      font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);
      letter-spacing: 0.06em;
    }
    .row-name {
      font-family: var(--font-display); font-weight: 600; font-size: 18px;
      letter-spacing: -0.01em;
    }
    .row-meta {
      font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    code.hook {
      display: block;
      font-family: var(--font-mono); font-size: 12px; color: var(--text);
      background: var(--bg-soft);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      white-space: nowrap; overflow-x: auto;
      user-select: all;
    }
    .toast {
      position: fixed; bottom: 28px; left: 50%; transform: translateX(-50%) translateY(20px);
      background: var(--bg-dark); color: #fff;
      padding: 10px 16px; border-radius: 8px;
      font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.03em;
      box-shadow: 0 12px 32px rgba(28,35,47,0.18);
      opacity: 0; transition: opacity 180ms ease, transform 180ms ease;
      pointer-events: none;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    footer {
      margin-top: 44px; padding-top: 22px; border-top: 1px solid var(--border);
      font-family: var(--font-mono); font-size: 11px; color: var(--text-muted);
      display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    }
    @media (max-width: 640px) {
      header { flex-direction: column; align-items: flex-start; }
      .meta { text-align: left; }
      .row-head { flex-direction: column; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <div class="eyebrow">Main Street Trades · ${escapeHtml(fmtDateMMDDYY())}</div>
        <h1>Tradytics Webhooks</h1>
        <p class="lede">Paste each webhook URL into the matching field on the Tradytics dashboard. Channels are hidden from <code>@everyone</code> and visible to Founder, Admin, and Mod only.</p>
      </div>
      <div class="meta">
        <div><strong>Server:</strong> Main Street Trades</div>
        <div><strong>Category:</strong> ${escapeHtml(CATEGORY_NAME)}</div>
        <div><strong>Feeds:</strong> ${results.length}</div>
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
${rows}
    </ol>

    <footer>
      <span>Generated ${escapeHtml(new Date().toISOString())}</span>
      <span>Webhook URLs are bearer credentials — treat like passwords.</span>
    </footer>
  </div>

  <div id="toast" class="toast" role="status" aria-live="polite">Copied</div>

  <script>
    const toast = document.getElementById('toast');
    let toastTimer;
    function showToast(msg) {
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
    }
    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
        document.body.appendChild(ta); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      }
    }
    document.querySelectorAll('.copy-btn[data-target]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const el = document.getElementById(btn.dataset.target);
        if (!el) return;
        const ok = await copyText(el.textContent);
        if (!ok) return showToast('Copy failed');
        btn.classList.add('copied');
        const lbl = btn.querySelector('.copy-label');
        const prev = lbl.textContent;
        lbl.textContent = 'Copied';
        showToast('Webhook copied');
        setTimeout(() => { btn.classList.remove('copied'); lbl.textContent = prev; }, 1400);
      });
    });
    const allBtn = document.getElementById('copy-all');
    if (allBtn) {
      allBtn.addEventListener('click', async () => {
        const lines = [...document.querySelectorAll('.row')].map((row) => {
          const name = row.querySelector('.row-name')?.textContent?.trim() || '';
          const url = row.querySelector('code.hook')?.textContent?.trim() || '';
          return name + '\\t' + url;
        }).join('\\n');
        const ok = await copyText(lines);
        if (!ok) return showToast('Copy failed');
        allBtn.classList.add('copied');
        const lbl = allBtn.querySelector('.copy-label');
        const prev = lbl.textContent;
        lbl.textContent = 'Copied';
        showToast('All ' + ${results.length} + ' webhooks copied');
        setTimeout(() => { allBtn.classList.remove('copied'); lbl.textContent = prev; }, 1600);
      });
    }
  </script>
</body>
</html>
`;
}

client.once('ready', async () => {
  const results = [];
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    await guild.roles.fetch();

    const everyone = guild.roles.everyone;
    // Two roles named "Admin" exist (one is a managed bot integration);
    // pick the unmanaged human role.
    const admin = guild.roles.cache.find((r) => r.name === 'Admin' && !r.managed);
    const mod = guild.roles.cache.find((r) => r.name === 'Mod' && !r.managed);
    if (!admin) throw new Error('Unmanaged role "Admin" not found.');
    if (!mod)   throw new Error('Role "Mod" not found.');

    const overwrites = buildOverwrites(everyone, admin, mod, client.user.id);

    // 1) Category (idempotent)
    let category = guild.channels.cache.find(
      (c) => c.name === CATEGORY_NAME && c.type === ChannelType.GuildCategory,
    );
    if (category) {
      console.log(`→ existing category "${CATEGORY_NAME}" (${category.id}) — re-syncing overwrites`);
      await category.permissionOverwrites.set(overwrites);
    } else {
      category = await guild.channels.create({
        name: CATEGORY_NAME,
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites,
        reason: 'Tradytics internal feed category — hidden from members.',
      });
      console.log(`✓ created category "${CATEGORY_NAME}" (${category.id})`);
    }

    // 2) Channels + webhooks (idempotent)
    for (let i = 0; i < FEEDS.length; i++) {
      const f = FEEDS[i];
      let channel = guild.channels.cache.find(
        (c) => c.name === f.slug && c.type === ChannelType.GuildText && c.parentId === category.id,
      );
      if (!channel) {
        // Also check for a channel with the same slug elsewhere — surface to user but don't move blindly.
        const stray = guild.channels.cache.find(
          (c) => c.name === f.slug && c.type === ChannelType.GuildText,
        );
        if (stray) {
          console.log(`→ found existing #${f.slug} (${stray.id}) outside ${CATEGORY_NAME} — moving in`);
          await stray.setParent(category.id, { lockPermissions: true });
          await stray.setTopic(f.topic).catch(() => {});
          channel = stray;
        } else {
          channel = await guild.channels.create({
            name: f.slug,
            type: ChannelType.GuildText,
            parent: category.id,
            topic: f.topic,
            reason: `Tradytics feed: ${f.label}`,
          });
          console.log(`✓ created #${f.slug} (${channel.id})`);
        }
      } else {
        console.log(`→ existing #${f.slug} (${channel.id}) — re-syncing`);
        await channel.lockPermissions().catch(() => {});
        if (channel.topic !== f.topic) await channel.setTopic(f.topic).catch(() => {});
      }

      // Position within the category to match Tradytics dashboard order.
      try {
        await channel.setPosition(i);
      } catch (e) {
        console.warn(`  ⚠ could not set position for #${f.slug}: ${e.message}`);
      }

      // 3) Webhook (idempotent by name)
      const hookName = `Tradytics — ${f.label}`;
      const hooks = await channel.fetchWebhooks();
      let webhook = hooks.find((w) => w.name === hookName);
      if (webhook) {
        console.log(`  → reusing webhook "${hookName}" (${webhook.id})`);
      } else {
        webhook = await channel.createWebhook({
          name: hookName,
          reason: `Tradytics ${f.label} feed`,
        });
        console.log(`  ✓ created webhook "${hookName}" (${webhook.id})`);
      }

      results.push({
        label: f.label,
        slug: f.slug,
        channelId: channel.id,
        topic: f.topic,
        webhookId: webhook.id,
        webhookName: hookName,
        webhookUrl: webhook.url,
      });
    }

    // 4) Emit HTML report
    const stamp = fmtDateMMDDYY();
    const outPath = path.resolve(__dirname, '..', `Tradytics Webhooks - ${stamp}.html`);
    fs.writeFileSync(outPath, buildHtml(results), { mode: 0o600 });
    console.log('');
    console.log(`✓ wrote ${outPath}`);
    console.log(`  ${results.length} channels + webhooks ready under category "${CATEGORY_NAME}" (${category.id}).`);
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
