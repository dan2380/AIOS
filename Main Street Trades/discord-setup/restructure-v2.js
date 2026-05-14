'use strict';
/* ============================================================================
 *  Main Street Trades · Server Restructure v2 · 05-14-26
 * ----------------------------------------------------------------------------
 *  Implements the "tools vs. humans" reorg from
 *  ../Discord Structure Proposal - 05-14-26.html
 *
 *  Idempotent. Re-runnable. Dry-run by default.
 *
 *  Changes:
 *    + create category  🛠️・PAID TOOLS / SIGNALS
 *        ← move:  unusual-options-volume, politician-trade-alerts,
 *                 insider-buy-alerts, earnings-this-week,
 *                 macro-events, premarket-brief
 *    + create category  🤝・PARTNER ANALYSTS
 *        + create divider channel  ━━charlie-plattus┃zip-trader━━ (locked)
 *        ← move:  charlie-options-ideas
 *    - delete (only if now empty):
 *        📅・CALENDAR, ⚡・SHORT TERM, 📡・SIGNALS
 *
 *  Usage:
 *    node restructure-v2.js          # dry-run, prints planned ops
 *    node restructure-v2.js --apply  # mutates Discord
 * ============================================================================
 */

const fs   = require('fs');
const path = require('path');

const parentEnvPath = path.resolve(__dirname, '..', '.env');
const localEnvPath  = path.resolve(__dirname, '.env');
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
const APPLY = process.argv.includes('--apply');

if (!TOKEN || !GUILD_ID) {
  console.error('✗ Missing DISCORD_BOT_TOKEN or GUILD_ID in', envPath);
  process.exit(1);
}

const P = PermissionFlagsBits;

// ---- Spec ------------------------------------------------------------------

const PAID_TOOLS = {
  base: 'PAID TOOLS / SIGNALS',
  emoji: '🛠️',
  name() { return `${this.emoji}・${this.base}`; },
  channels: [
    'unusual-options-volume',
    'politician-trade-alerts',
    'insider-buy-alerts',
    'earnings-this-week',
    'macro-events',
    'premarket-brief',
  ],
};

const PARTNER_ANALYSTS = {
  base: 'PARTNER ANALYSTS',
  emoji: '🤝',
  name() { return `${this.emoji}・${this.base}`; },
  divider: '━━charlie-plattus┃zip-trader━━',
  moves: ['charlie-options-ideas'],
};

const CATS_TO_DELETE = ['CALENDAR', 'SHORT TERM', 'SIGNALS'];

// ---- Name normalization ----------------------------------------------------

const EMOJI_PREFIX_RE = /^[\p{Extended_Pictographic}‍️⃣]+[\s\-・│]*/u;
function stripEmojiPrefix(name) {
  return (name || '').replace(EMOJI_PREFIX_RE, '');
}
function norm(s) {
  return stripEmojiPrefix(s).toLowerCase().trim();
}

// ---- Permissions builders --------------------------------------------------

function buildCategoryOverwrites({ everyone, Founder, Mod, VIP, Premium, botUserId }) {
  const ow = [{ id: everyone.id, deny: [P.ViewChannel, P.SendMessages, P.Connect] }];
  const full = [
    P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AddReactions,
    P.AttachFiles, P.EmbedLinks, P.ManageMessages,
  ];
  if (Founder)   ow.push({ id: Founder.id, allow: full });
  if (Mod)       ow.push({ id: Mod.id, allow: full });
  if (botUserId) ow.push({ id: botUserId, allow: full });
  for (const r of [Premium, VIP]) {
    if (!r) continue;
    ow.push({
      id: r.id,
      allow: [P.ViewChannel, P.ReadMessageHistory],
      deny:  [P.SendMessages],
    });
  }
  return ow;
}

function buildDividerOverwrites({ everyone, Founder, Mod, VIP, Premium, botUserId }) {
  const ow = [{ id: everyone.id, deny: [P.ViewChannel, P.SendMessages, P.AddReactions] }];
  const staff = [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.ManageMessages];
  if (Founder)   ow.push({ id: Founder.id, allow: staff });
  if (Mod)       ow.push({ id: Mod.id, allow: staff });
  if (botUserId) ow.push({ id: botUserId, allow: staff });
  for (const r of [Premium, VIP]) {
    if (!r) continue;
    ow.push({
      id: r.id,
      allow: [P.ViewChannel, P.ReadMessageHistory],
      deny:  [P.SendMessages, P.AddReactions],
    });
  }
  return ow;
}

// ---- Helpers ---------------------------------------------------------------

function findCategory(guild, baseName) {
  const want = norm(baseName);
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && norm(c.name) === want,
  );
}
function findTextChannel(guild, baseName) {
  const want = norm(baseName);
  return guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && norm(c.name) === want,
  );
}

async function ensureCategory(guild, spec, perms) {
  let cat = findCategory(guild, spec.base);
  if (cat) {
    console.log(`→ category "${cat.name}" exists (${cat.id})`);
    return cat;
  }
  console.log(`✓ create category "${spec.name()}"`);
  if (!APPLY) return null;
  cat = await guild.channels.create({
    name: spec.name(),
    type: ChannelType.GuildCategory,
    reason: 'MST restructure v2 — proposed sections',
    permissionOverwrites: buildCategoryOverwrites(perms),
  });
  console.log(`  ↳ created (${cat.id})`);
  return cat;
}

async function moveChannel(channel, parent, label) {
  if (!channel || !parent) return;
  if (channel.parentId === parent.id) {
    console.log(`→ #${channel.name} already in "${parent.name}"`);
    return;
  }
  console.log(`✓ move #${channel.name} → "${parent.name}"${label ? ` (${label})` : ''}`);
  if (!APPLY) return;
  await channel.setParent(parent.id, { lockPermissions: false });
}

async function ensureDivider(guild, parent, perms) {
  let div = findTextChannel(guild, PARTNER_ANALYSTS.divider);
  if (div) {
    console.log(`→ divider "#${div.name}" exists (${div.id})`);
    if (parent && div.parentId !== parent.id) {
      console.log(`  ↳ moving into "${parent.name}"`);
      if (APPLY) await div.setParent(parent.id, { lockPermissions: false });
    }
    return div;
  }
  if (!parent) return null;
  console.log(`✓ create divider "#${PARTNER_ANALYSTS.divider}" in "${parent.name}"`);
  if (!APPLY) return null;
  div = await guild.channels.create({
    name: PARTNER_ANALYSTS.divider,
    type: ChannelType.GuildText,
    parent: parent.id,
    topic: 'Section header — Charlie Plattus, founder of Zip Trader. Read-only.',
    reason: 'MST restructure v2 — partner divider',
    permissionOverwrites: buildDividerOverwrites(perms),
  });
  console.log(`  ↳ created (${div.id})`);
  return div;
}

async function deleteEmptyCategory(guild, baseName) {
  const cat = findCategory(guild, baseName);
  if (!cat) {
    console.log(`→ category "${baseName}" already gone`);
    return;
  }
  const kids = guild.channels.cache.filter((c) => c.parentId === cat.id);
  if (kids.size > 0) {
    console.warn(`⚠ skip delete "${cat.name}" — still has ${kids.size} child(ren): ${kids.map(c => '#' + c.name).join(', ')}`);
    return;
  }
  console.log(`✓ delete empty category "${cat.name}"`);
  if (!APPLY) return;
  await cat.delete('MST restructure v2 — old category no longer needed');
}

// ---- Main ------------------------------------------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Connected as ${client.user.tag}`);
  console.log(APPLY ? 'MODE: APPLY (will mutate Discord)' : 'MODE: DRY-RUN (no changes)');

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    await guild.roles.fetch();
    console.log(`Guild: ${guild.name} (${guild.id})\n`);

    const everyone = guild.roles.everyone;
    const byName = (n) => guild.roles.cache.find((r) => r.name === n);
    const perms = {
      everyone,
      Founder:   byName('Founder'),
      Mod:       byName('Mod'),
      VIP:       byName('VIP'),
      Premium:   byName('Premium'),
      botUserId: client.user.id,
    };

    // 1. Create PAID TOOLS / SIGNALS, then move all 6 feed channels in.
    console.log('— PAID TOOLS / SIGNALS —');
    const paidCat = await ensureCategory(guild, PAID_TOOLS, perms);
    for (const name of PAID_TOOLS.channels) {
      const ch = findTextChannel(guild, name);
      if (!ch) {
        console.warn(`⚠ #${name} not found — skipping`);
        continue;
      }
      await moveChannel(ch, paidCat, 'feed');
    }

    // 2. Create PARTNER ANALYSTS + divider + move charlie.
    console.log('\n— PARTNER ANALYSTS —');
    const partnersCat = await ensureCategory(guild, PARTNER_ANALYSTS, perms);
    const divider = await ensureDivider(guild, partnersCat, perms);
    for (const name of PARTNER_ANALYSTS.moves) {
      const ch = findTextChannel(guild, name);
      if (!ch) {
        console.warn(`⚠ #${name} not found — skipping`);
        continue;
      }
      await moveChannel(ch, partnersCat, 'analyst feed');
    }

    // 3. Order inside PARTNER ANALYSTS: divider first, then charlie's feed.
    if (APPLY && partnersCat && divider) {
      try {
        await divider.setPosition(0);
        const charlie = findTextChannel(guild, 'charlie-options-ideas');
        if (charlie && charlie.parentId === partnersCat.id) {
          await charlie.setPosition(1);
        }
        console.log('✓ ordered partner analysts (divider, charlie)');
      } catch (e) {
        console.warn(`⚠ ordering non-fatal: ${e.message}`);
      }
    }

    // 4. Delete the (now empty) legacy categories.
    console.log('\n— Legacy category cleanup —');
    // Re-fetch so child counts are accurate after moves.
    await guild.channels.fetch();
    for (const base of CATS_TO_DELETE) {
      await deleteEmptyCategory(guild, base);
    }

    console.log('\nDone.');
    if (!APPLY) console.log('Re-run with --apply to commit changes.');
  } catch (err) {
    console.error('\n✗ FATAL:', err.message || err);
    process.exitCode = 1;
  } finally {
    client.destroy();
    process.exit();
  }
});

client.on('error', (e) => console.error('Discord client error:', e.message));
client.login(TOKEN).catch((e) => {
  console.error('✗ Login failed:', e.message);
  process.exit(1);
});
