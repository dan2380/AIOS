/* ============================================================================
 *  Main Street Trades · Discord Server Provisioning · v1.0
 * ----------------------------------------------------------------------------
 *  One-shot provisioner. Idempotent. Re-runnable.
 *
 *  Reads:    ../.env  (DISCORD_BOT_TOKEN, GUILD_ID) — falls back to ./.env
 *  Builds:   roles → categories → channels → channel perm overwrites
 *            → pinned welcome + disclaimer messages
 *
 *  Brand voice: populist, plain-spoken, warm. "Main Street", not "Wall Street."
 *
 *  Logging legend:
 *    ✓  created / posted something new
 *    →  found existing, skipped (idempotent path)
 *    ⚠  recoverable failure (continued)
 *    ✗  fatal (aborted)
 *
 *  Design notes / decisions worth knowing:
 *    - Roles created top-down. Position = (existing roles count - index).
 *      Discord auto-shuffles, but we make a best-effort sort after creation.
 *    - @everyone is heavily denied at the category level. Roles open holes
 *      back up. This is more maintainable than per-channel allow lists.
 *    - Alert channels deny SEND_MESSAGES for VIP/Premium/Free; only Founder,
 *      Mod, and the bot itself can post. Discussion happens in -chat siblings.
 *    - Voice channels grant CONNECT + SPEAK to Premium+ (and Free is denied).
 *    - Slowmode 5s on main-chat and off-topic to discourage spam.
 *    - Pinned message bodies are read from ./messages/*.md at runtime, so
 *      Daniel can edit copy without touching this file.
 *    - If a category exists but is missing channels, we add only the missing
 *      ones. Re-runs are safe.
 *    - We do NOT delete anything. Cleanup is manual on purpose.
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');

// dotenv lookup: prefer ../.env (Daniel's existing file at Main Street Trades/.env),
// fall back to a local .env in this directory.
const parentEnvPath = path.resolve(__dirname, '..', '.env');
const localEnvPath = path.resolve(__dirname, '.env');
const envPath = fs.existsSync(parentEnvPath) ? parentEnvPath : localEnvPath;
require('dotenv').config({ path: envPath });

const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !GUILD_ID) {
  console.error('✗ Missing DISCORD_BOT_TOKEN or GUILD_ID.');
  console.error(`  Looked in: ${envPath}`);
  console.error('  Copy .env.example → .env and fill in both values.');
  process.exit(1);
}

const P = PermissionFlagsBits;

// Role definitions, highest authority first.
// Discord stores higher = more authority. We create top-down so the first
// role here will end up at the top (closest to server owner).
const ROLES = [
  {
    name: 'Founder',
    color: 0x1ea8ba,
    hoist: true,
    mentionable: true,
    permissions: [P.Administrator],
    reason: 'Owner role — Daniel.',
  },
  {
    name: 'Mod',
    color: 0x00e5ff,
    hoist: true,
    mentionable: true,
    permissions: [
      P.ManageMessages,
      P.ManageChannels,
      P.KickMembers,
      P.ModerateMembers, // timeout
      P.ManageThreads,
      P.MuteMembers,
      P.DeafenMembers,
    ],
    reason: 'Trusted moderators.',
  },
  {
    name: 'VIP',
    color: 0xffd166,
    hoist: true,
    mentionable: false,
    permissions: [], // permissions granted via channel overwrites
    reason: 'Top paid tier.',
  },
  {
    name: 'Premium',
    color: 0x6ee7b7,
    hoist: true,
    mentionable: false,
    permissions: [],
    reason: 'Standard paid tier.',
  },
  {
    name: 'Free',
    color: 0x9ca3af,
    hoist: false,
    mentionable: false,
    permissions: [],
    reason: 'Free Discord members (limited access).',
  },
];

// Channel topic copy (one-liner each).
const TOPICS = {
  'welcome': 'Start here. React ✅ on the pinned message to unlock the rest of the server.',
  'start-here': 'Pick your role, set notification preferences, find the scoreboard.',
  'disclaimer-must-read': 'Plain-English risk disclaimer. Must be read before you post.',
  'manage-membership': 'Upgrade, downgrade, or cancel your membership.',
  'support-tickets': 'Stuck on something? Open a ticket here. A human reads them.',
  'feature-suggestions': "Got a feature request? Drop it here. React 👍 on suggestions you'd like to see shipped.",
  'announcements': 'Server-wide news. Read-only.',

  'earnings-this-week': 'Earnings calendar for the week ahead. Auto-posted.',
  'macro-events': 'CPI, FOMC, NFP, jobs, GDP. The days that move the tape.',
  'premarket-brief': 'What I am watching before the open. Daily.',

  'unusual-options-volume': 'UOV scanner — large block + sweep prints worth a look.',
  'politician-trade-alerts': 'Congressional + Senate trade disclosures (Capitol Trades / Quiver). Follow the money.',
  'insider-buy-alerts': 'Form 4 insider buys — C-suite and 10%+ holders putting their own cash in.',
  'morning-briefing': 'Morning pre-market briefing — mirrored from upstream. Read-only.',
  'stock-briefs': 'Stock brief — single-ticker deep dives mirrored from upstream. Read-only.',

  '━━charlie-plattus┃zip-trader━━': 'Section header — Charlie Plattus, founder of Zip Trader. Read-only.',
  'charlie-options-ideas': "Charlie's options ideas — mirrored from his channel. Read-only.",
  'long-term-price-analysis': "Charlie's longer-horizon price analysis — multi-week / multi-month setups. Read-only.",
  'leaps-ideas': "Charlie's LEAPS — long-dated options ideas. Mirrored. Read-only.",

  'trade-on-moomoo-claim-free-gift': 'Member perks — partner offers, broker bonuses, free trials. New deals dropped here.',

  'main-chat': 'General community chat. Be useful or be quiet.',
  'day-trading-chat': 'Live day-trading talk. Fast-moving.',
  'long-term-chat': 'Position-trader discussion. Slower, deeper.',
  'options-chat': 'Greeks, IV, spreads, hedging — all things options.',
  'wins': 'Drop your green-day screenshots. Big or small.',
  'losses-lessons': 'Post the red and what you learned. No shame here.',
  'off-topic': 'Anything not market-related.',

  'market-open-room': 'Voice room. Live during 9:25–10:30 ET market open.',
  'fomc-watch': 'Voice room. Active on FOMC days.',
  'after-hours-lounge': 'Voice room. After-hours hangout.',

  'vip-alerts': 'VIP-only alerts. Highest conviction, smallest float.',
  'vip-portfolio': 'My live portfolio. VIP only.',
  'monthly-amas': 'Monthly AMA recordings + scheduling. VIP only.',
  'vip-chat': 'VIP-only chat.',
};

// Channels marked as alert channels (read-only for non-Founder/Mod/bot).
const ALERT_CHANNELS = new Set([
  'politician-trade-alerts',
  'insider-buy-alerts',
  'unusual-options-volume',
  'charlie-options-ideas',
  'earnings-this-week',
  'macro-events',
  'premarket-brief',
  'morning-briefing',
  'stock-briefs',
  'long-term-price-analysis',
  'leaps-ideas',
  '━━charlie-plattus┃zip-trader━━',
  'vip-alerts',
  'vip-portfolio',
  'monthly-amas',
]);

// Channels with a public-post permission, even though they are in
// otherwise read-only-feeling categories.
const POSTABLE_BY_EVERYONE_IN_GETTING_STARTED = new Set(['support-tickets', 'feature-suggestions']);

// 5-second slowmode on these to discourage spam.
const SLOWMODE_CHANNELS = new Set(['main-chat', 'off-topic']);

// Server architecture. Order matters — categories render top-down.
const ARCHITECTURE = [
  {
    category: 'GETTING STARTED',
    channels: [
      { name: 'welcome', type: 'text' },
      { name: 'start-here', type: 'text' },
      { name: 'disclaimer-must-read', type: 'text' },
      { name: 'manage-membership', type: 'text' },
      { name: 'support-tickets', type: 'text' },
      { name: 'feature-suggestions', type: 'text' },
      { name: 'announcements', type: 'text' },
    ],
  },
  {
    category: 'PAID TOOLS / SIGNALS',
    channels: [
      { name: 'unusual-options-volume', type: 'text' },
      { name: 'politician-trade-alerts', type: 'text' },
      { name: 'insider-buy-alerts', type: 'text' },
      { name: 'earnings-this-week', type: 'text' },
      { name: 'macro-events', type: 'text' },
      { name: 'premarket-brief', type: 'text' },
      { name: 'morning-briefing', type: 'text' },
      { name: 'stock-briefs', type: 'text' },
    ],
  },
  {
    category: 'PARTNER ANALYSTS',
    channels: [
      { name: '━━charlie-plattus┃zip-trader━━', type: 'text' },
      { name: 'charlie-options-ideas', type: 'text' },
      { name: 'long-term-price-analysis', type: 'text' },
      { name: 'leaps-ideas', type: 'text' },
    ],
  },
  {
    category: 'DISCUSSION',
    channels: [
      { name: 'main-chat', type: 'text' },
      { name: 'day-trading-chat', type: 'text' },
      { name: 'long-term-chat', type: 'text' },
      { name: 'options-chat', type: 'text' },
      { name: 'wins', type: 'text' },
      { name: 'losses-lessons', type: 'text' },
      { name: 'off-topic', type: 'text' },
    ],
  },
  {
    category: 'LIVE ROOMS',
    channels: [
      { name: 'market-open-room', type: 'voice' },
      { name: 'fomc-watch', type: 'voice' },
      { name: 'after-hours-lounge', type: 'voice' },
    ],
  },
  {
    category: 'PERKS',
    channels: [
      { name: 'trade-on-moomoo-claim-free-gift', type: 'text' },
    ],
  },
  {
    category: 'VIP ONLY',
    channels: [
      { name: 'vip-alerts', type: 'text' },
      { name: 'vip-portfolio', type: 'text' },
      { name: 'monthly-amas', type: 'text' },
      { name: 'vip-chat', type: 'text' },
    ],
  },
];

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function readMessageFile(name) {
  const file = path.join(__dirname, 'messages', name);
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    console.warn(`⚠ Could not read ${file} — using fallback string.`);
    return `(Could not load ${name}. Edit this message in #${name.replace('.md','')} after setup.)`;
  }
}

// Discord caps message bodies at 2000 chars. Split safely on paragraph
// breaks where possible.
function chunkMessage(text, limit = 1900) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let buf = '';
  for (const para of text.split(/\n\n+/)) {
    const piece = para + '\n\n';
    if ((buf + piece).length > limit) {
      if (buf) chunks.push(buf.trimEnd());
      // If a single paragraph is too long, hard-split it.
      if (piece.length > limit) {
        for (let i = 0; i < piece.length; i += limit) {
          chunks.push(piece.slice(i, i + limit));
        }
        buf = '';
      } else {
        buf = piece;
      }
    } else {
      buf += piece;
    }
  }
  if (buf.trim()) chunks.push(buf.trimEnd());
  return chunks;
}

// Channel-name normalize for idempotent lookup. Discord coerces names to
// lowercase for text channels; for voice it preserves case. We normalize.
// Also strips any leading emoji prefix (e.g. "📈-lt-individual-stocks"
// or "📡・SIGNALS") so a re-run after add-emojis.js matches by base name
// and doesn't create duplicates.
const EMOJI_PREFIX_RE = /^[\p{Extended_Pictographic}‍️⃣]+[\s\-・│]*/u;
function norm(s) {
  return s.replace(EMOJI_PREFIX_RE, '').toLowerCase().trim();
}

// ---------------------------------------------------------------------------
// PROVISIONING
// ---------------------------------------------------------------------------

const summary = {
  rolesCreated: 0,
  rolesSkipped: 0,
  categoriesCreated: 0,
  categoriesSkipped: 0,
  channelsCreated: 0,
  channelsSkipped: 0,
  channelsFailed: 0,
  messagesPosted: 0,
  warnings: [],
};

async function ensureRoles(guild) {
  console.log('\n— Roles —');
  const byName = new Map();
  for (const r of ROLES) {
    const existing = guild.roles.cache.find((x) => x.name === r.name);
    if (existing) {
      console.log(`→ role "${r.name}" exists, skipping`);
      byName.set(r.name, existing);
      summary.rolesSkipped++;
      continue;
    }
    try {
      const role = await guild.roles.create({
        name: r.name,
        color: r.color,
        hoist: r.hoist,
        mentionable: r.mentionable,
        permissions: r.permissions,
        reason: r.reason,
      });
      console.log(`✓ role "${r.name}" created`);
      byName.set(r.name, role);
      summary.rolesCreated++;
    } catch (e) {
      console.warn(`⚠ failed to create role "${r.name}": ${e.message}`);
      summary.warnings.push(`role:${r.name}:${e.message}`);
    }
  }
  // Best-effort sort: Founder > Mod > VIP > Premium > Free.
  // Discord won't let us position above the bot's own role, so we just push
  // each role as high as we can. Daniel can drag them in the UI later.
  try {
    const ordered = ['Founder', 'Mod', 'VIP', 'Premium', 'Free']
      .map((n) => byName.get(n))
      .filter(Boolean);
    for (let i = 0; i < ordered.length; i++) {
      const targetPos = guild.roles.cache.size - 1 - i;
      if (ordered[i].position !== targetPos) {
        await ordered[i].setPosition(targetPos).catch(() => {});
      }
    }
  } catch (_) { /* non-fatal */ }
  return byName;
}

// Build the @everyone overwrite + per-role overwrites for one channel.
// Returns an array Discord.js accepts as permissionOverwrites.
function buildOverwritesForChannel(channelName, categoryName, roles, botUserId) {
  const everyone = roles.guild.roles.everyone;
  const { Founder, Mod, VIP, Premium, Free } = roles.byName;

  const ow = [];
  const denyAllView = { id: everyone.id, deny: [P.ViewChannel, P.SendMessages, P.Connect] };

  // @everyone defaults: deny view except a few intro channels.
  const everyoneViewable = new Set(['welcome', 'start-here', 'disclaimer-must-read']);
  if (everyoneViewable.has(channelName)) {
    ow.push({
      id: everyone.id,
      allow: [P.ViewChannel, P.ReadMessageHistory],
      deny: [P.SendMessages, P.AddReactions],
    });
  } else {
    ow.push(denyAllView);
  }

  // Founder + Mod always get full access. Bot too (so it can post alerts later).
  if (Founder) {
    ow.push({
      id: Founder.id,
      allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AddReactions, P.Connect, P.Speak, P.AttachFiles, P.EmbedLinks, P.ManageMessages],
    });
  }
  if (Mod) {
    ow.push({
      id: Mod.id,
      allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AddReactions, P.Connect, P.Speak, P.AttachFiles, P.EmbedLinks, P.ManageMessages],
    });
  }
  if (botUserId) {
    ow.push({
      id: botUserId,
      allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AddReactions, P.AttachFiles, P.EmbedLinks, P.ManageMessages],
    });
  }

  // Role-by-role access rules.
  const allowView = [P.ViewChannel, P.ReadMessageHistory];
  const allowPost = [...allowView, P.SendMessages, P.AddReactions, P.AttachFiles, P.EmbedLinks];
  const allowVoice = [...allowView, P.Connect, P.Speak, P.UseVAD];

  // GETTING STARTED — everyone with a role can view; only support-tickets is postable.
  if (categoryName === 'GETTING STARTED') {
    const canPost = POSTABLE_BY_EVERYONE_IN_GETTING_STARTED.has(channelName);
    [Free, Premium, VIP].forEach((r) => {
      if (!r) return;
      ow.push({ id: r.id, allow: canPost ? allowPost : allowView });
    });
  }

  // PAID TOOLS / SIGNALS — Premium and VIP can view (read-only). Free cannot.
  // Alert channels (all of them in this category) deny SendMessages for
  // everyone but Founder/Mod/bot via the final overlay below.
  // (Restructured 2026-05-14: replaces CALENDAR / SHORT TERM / SIGNALS.)
  if (categoryName === 'PAID TOOLS / SIGNALS') {
    [Premium, VIP].forEach((r) => {
      if (!r) return;
      ow.push({ id: r.id, allow: allowView, deny: [P.SendMessages] });
    });
    // Free gets no overwrite here — falls back to @everyone deny.
  }

  // PARTNER ANALYSTS — Premium and VIP read-only (analyst feeds + dividers).
  // Free cannot see. The divider channel is in ALERT_CHANNELS so SendMessages
  // is locked even for staff-adjacent roles (only Founder/Mod/bot post).
  if (categoryName === 'PARTNER ANALYSTS') {
    [Premium, VIP].forEach((r) => {
      if (!r) return;
      ow.push({ id: r.id, allow: allowView, deny: [P.SendMessages] });
    });
  }

  // DISCUSSION — Free can post in main-chat + off-topic only.
  //              Premium + VIP can post in all.
  if (categoryName === 'DISCUSSION') {
    const freePostable = new Set(['main-chat', 'off-topic', 'wins']);
    if (Free) {
      if (freePostable.has(channelName)) {
        ow.push({ id: Free.id, allow: allowPost });
      } else {
        // Free can't even view the deeper discussion channels.
        // (Stays denied via @everyone.)
      }
    }
    [Premium, VIP].forEach((r) => {
      if (!r) return;
      ow.push({ id: r.id, allow: allowPost });
    });
  }

  // PERKS — everyone with a role can view (read-only). Founder/Mod post curated offers.
  if (categoryName === 'PERKS') {
    [Free, Premium, VIP].forEach((r) => {
      if (!r) return;
      ow.push({ id: r.id, allow: allowView, deny: [P.SendMessages] });
    });
  }

  // LIVE ROOMS (voice) — Premium + VIP connect/speak. Free denied.
  if (categoryName === 'LIVE ROOMS') {
    [Premium, VIP].forEach((r) => {
      if (!r) return;
      ow.push({ id: r.id, allow: allowVoice });
    });
  }

  // VIP ONLY — VIP read+write (chat post-allowed), alert subchannels read-only.
  if (categoryName === 'VIP ONLY') {
    if (VIP) {
      const isAlert = ALERT_CHANNELS.has(channelName);
      ow.push({
        id: VIP.id,
        allow: isAlert ? allowView : allowPost,
        deny: isAlert ? [P.SendMessages] : [],
      });
    }
  }

  // Final overlay: alert channels enforce send-deny on VIP/Premium/Free even
  // if a category rule above allowed it. (Belt + suspenders.)
  if (ALERT_CHANNELS.has(channelName)) {
    for (const r of [Free, Premium, VIP]) {
      if (!r) continue;
      // Find existing overwrite for this role and force deny SendMessages.
      const existing = ow.find((o) => o.id === r.id);
      if (existing) {
        existing.deny = Array.from(new Set([...(existing.deny || []), P.SendMessages]));
      }
    }
  }

  return ow;
}

async function ensureCategoryAndChannels(guild, roles, botUserId) {
  console.log('\n— Categories + Channels —');
  const channelMap = new Map(); // name → channel

  for (const block of ARCHITECTURE) {
    const wantCat = norm(block.category);
    let cat = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && norm(c.name) === wantCat,
    );
    if (cat) {
      console.log(`→ category "${block.category}" exists`);
      summary.categoriesSkipped++;
    } else {
      try {
        cat = await guild.channels.create({
          name: block.category,
          type: ChannelType.GuildCategory,
          reason: 'Main Street Trades provisioning.',
        });
        console.log(`✓ category "${block.category}" created`);
        summary.categoriesCreated++;
      } catch (e) {
        console.warn(`⚠ could not create category "${block.category}": ${e.message}`);
        summary.warnings.push(`category:${block.category}:${e.message}`);
        continue;
      }
    }

    for (const ch of block.channels) {
      const want = norm(ch.name);
      const existing = guild.channels.cache.find(
        (c) =>
          norm(c.name) === want &&
          (c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice),
      );

      let channel = existing;
      if (existing) {
        console.log(`→ #${ch.name} exists`);
        summary.channelsSkipped++;
      } else {
        try {
          channel = await guild.channels.create({
            name: ch.name,
            type: ch.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
            parent: cat.id,
            topic: ch.type === 'voice' ? undefined : TOPICS[ch.name] || undefined,
            reason: 'Main Street Trades provisioning.',
          });
          console.log(`✓ #${ch.name} created`);
          summary.channelsCreated++;
        } catch (e) {
          console.warn(`⚠ failed to create #${ch.name}: ${e.message}`);
          summary.warnings.push(`channel:${ch.name}:${e.message}`);
          summary.channelsFailed++;
          continue;
        }
      }

      channelMap.set(ch.name, channel);

      // Apply permission overwrites (idempotent: setPermissionOverwrites replaces).
      try {
        const overwrites = buildOverwritesForChannel(
          ch.name,
          block.category,
          { guild, byName: Object.fromEntries(roles) },
          botUserId,
        );
        await channel.permissionOverwrites.set(overwrites, 'MST permissions sync');
      } catch (e) {
        console.warn(`⚠ perms on #${ch.name}: ${e.message}`);
        summary.warnings.push(`perms:${ch.name}:${e.message}`);
      }

      // Re-apply topic if it drifted (idempotent).
      if (ch.type !== 'voice' && TOPICS[ch.name] && channel.topic !== TOPICS[ch.name]) {
        try { await channel.setTopic(TOPICS[ch.name]); } catch (_) {}
      }

      // Slowmode where applicable.
      if (SLOWMODE_CHANNELS.has(ch.name) && channel.rateLimitPerUser !== 5) {
        try { await channel.setRateLimitPerUser(5, 'MST slowmode'); } catch (_) {}
      }
    }
  }

  return channelMap;
}

async function postPinned(channel, body, label) {
  if (!channel) return;
  const chunks = chunkMessage(body);
  let firstMsg = null;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const msg = await channel.send({ content: chunks[i] });
      if (i === 0) firstMsg = msg;
      summary.messagesPosted++;
    } catch (e) {
      console.warn(`⚠ failed to post ${label} chunk ${i + 1}: ${e.message}`);
      summary.warnings.push(`post:${label}:${e.message}`);
      return;
    }
  }
  if (firstMsg) {
    try {
      await firstMsg.pin('Pinned by MST provisioner.');
      console.log(`✓ posted + pinned ${label} in #${channel.name}`);
    } catch (e) {
      console.warn(`⚠ pin failed on ${label}: ${e.message}`);
    }
  }
}

// Already-pinned guard: avoid double-posting on re-run.
async function hasPinFromBot(channel, botUserId) {
  try {
    const pins = await channel.messages.fetchPinned();
    return pins.some((m) => m.author && m.author.id === botUserId);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once('ready', async () => {
  console.log(`Connected as ${client.user.tag} (${client.user.id})`);
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.fetch(client.user.id).catch(() => {});
    await guild.channels.fetch();
    await guild.roles.fetch();
    console.log(`Guild: ${guild.name} (${guild.id})`);

    const roleMap = await ensureRoles(guild);
    const channelMap = await ensureCategoryAndChannels(guild, roleMap, client.user.id);

    console.log('\n— Pinned messages —');
    const welcomeChan = channelMap.get('welcome');
    const disclaimerChan = channelMap.get('disclaimer-must-read');

    if (welcomeChan && !(await hasPinFromBot(welcomeChan, client.user.id))) {
      await postPinned(welcomeChan, readMessageFile('welcome.md'), 'welcome');
    } else if (welcomeChan) {
      console.log('→ #welcome already has a bot pin, skipping');
    }
    if (disclaimerChan && !(await hasPinFromBot(disclaimerChan, client.user.id))) {
      await postPinned(disclaimerChan, readMessageFile('disclaimer.md'), 'disclaimer');
    } else if (disclaimerChan) {
      console.log('→ #disclaimer-must-read already has a bot pin, skipping');
    }

    // Final report.
    console.log('\n============================================================');
    console.log(' Main Street Trades · Provisioning complete');
    console.log('============================================================');
    console.log(` Roles:       +${summary.rolesCreated} created · ${summary.rolesSkipped} existing`);
    console.log(` Categories:  +${summary.categoriesCreated} created · ${summary.categoriesSkipped} existing`);
    console.log(` Channels:    +${summary.channelsCreated} created · ${summary.channelsSkipped} existing · ${summary.channelsFailed} failed`);
    console.log(` Messages:    ${summary.messagesPosted} posted`);
    console.log(` Warnings:    ${summary.warnings.length}`);
    if (summary.warnings.length) {
      console.log('\n Details:');
      for (const w of summary.warnings) console.log(`  - ${w}`);
    }
    console.log('\nNext: drop roles into the right hierarchy in Server Settings → Roles,');
    console.log('      and downgrade the bot from Administrator once everything looks right.');
    console.log('============================================================\n');

    client.destroy();
    process.exit(0);
  } catch (err) {
    console.error('\n✗ FATAL:', err);
    try { client.destroy(); } catch (_) {}
    process.exit(1);
  }
});

client.on('error', (e) => console.error('Discord client error:', e.message));

client.login(TOKEN).catch((e) => {
  console.error('✗ Login failed:', e.message);
  console.error('  Check DISCORD_BOT_TOKEN. Make sure the bot is invited to the server.');
  process.exit(1);
});
