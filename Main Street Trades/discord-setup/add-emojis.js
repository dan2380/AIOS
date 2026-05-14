'use strict';
/* Main Street Trades — add emojis to channel + category names.
 * Idempotent: skips anything already prefixed with the target emoji.
 * Usage:
 *   node add-emojis.js          # dry-run preview
 *   node add-emojis.js --apply  # actually rename
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: '/Users/dwang/Desktop/CosmeticsGrowthAI/AI OS/Main Street Trades/.env' });
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const APPLY = process.argv.includes('--apply');

// Channel emoji map (matches by BASE name without any existing emoji prefix).
const CHANNELS = {
  // GETTING STARTED
  'welcome': '👋',
  'start-here': '🧭',
  'disclaimer-must-read': '⚠️',
  'manage-membership': '💳',
  'support-tickets': '🎫',
  'feature-suggestions': '📝',
  'announcements': '📢',
  // PAID TOOLS / SIGNALS  (consolidated 2026-05-14 from CALENDAR + SHORT TERM + SIGNALS)
  'earnings-this-week': '📊',
  'macro-events': '🌐',
  'premarket-brief': '🌅',
  'unusual-options-volume': '🔍',
  'politician-trade-alerts': '🏛️',
  'insider-buy-alerts': '🐋',
  'morning-briefing': '🧨',
  'stock-briefs': '💡',
  // PARTNER ANALYSTS
  // (the divider channel ━━charlie-plattus┃zip-trader━━ has no emoji prefix on purpose)
  'charlie-options-ideas': '💡',
  'long-term-price-analysis': '🎯',
  'leaps-ideas': '🗓️',
  // PERKS
  'trade-on-moomoo-claim-free-gift': '🎁',
  // DISCUSSION
  'main-chat': '💬',
  'day-trading-chat': '🔥',
  'long-term-chat': '🧠',
  'options-chat': '🎲',
  'wins': '💸',
  'losses-lessons': '📉',
  'off-topic': '🍻',
  // LIVE ROOMS (voice)
  'market-open-room': '🔔',
  'fomc-watch': '🏛️',
  'after-hours-lounge': '🌙',
  // VIP ONLY
  'vip-alerts': '💎',
  'vip-portfolio': '💼',
  'monthly-amas': '🎙️',
  'vip-chat': '👑',
};

// Category emoji map.
const CATEGORIES = {
  'GETTING STARTED': '🏁',
  'PAID TOOLS / SIGNALS': '🛠️',
  'PARTNER ANALYSTS': '🤝',
  'DISCUSSION': '💬',
  'LIVE ROOMS': '🎙️',
  'PERKS': '🎁',
  'VIP ONLY': '💎',
};

// Strip any leading emoji + separator so we can match on the base name.
// Handles: "📈-lt-stocks", "📈 lt-stocks", "📈・lt-stocks", "📈│lt-stocks".
const PREFIX_RE = /^[\p{Extended_Pictographic}‍️⃣]+[\s\-・│]*/u;
function stripEmojiPrefix(name) {
  return name.replace(PREFIX_RE, '');
}

function targetTextName(base, emoji) {
  // Discord text channel: lowercase, hyphens. emoji prefix + hyphen.
  return `${emoji}-${base}`;
}
function targetVoiceName(base, emoji) {
  // Voice channels allow spaces + capitals; use a space separator.
  return `${emoji} ${base}`;
}
function targetCategoryName(base, emoji) {
  return `${emoji}・${base}`;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Connected as ${client.user.tag}`);
  console.log(APPLY ? 'MODE: APPLY (will rename)' : 'MODE: DRY-RUN (no changes)');
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  console.log(`Guild: ${guild.name}\n`);

  let renamed = 0, skipped = 0, missed = 0, failed = 0;

  // Categories first.
  const cats = [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position);
  for (const cat of cats) {
    const base = stripEmojiPrefix(cat.name).trim();
    const emoji = CATEGORIES[base];
    if (!emoji) {
      console.log(`[skip cat]   ${cat.name}  (no emoji mapping)`);
      missed++;
      continue;
    }
    const next = targetCategoryName(base, emoji);
    if (cat.name === next) {
      console.log(`[ok cat]     ${cat.name}`);
      skipped++;
      continue;
    }
    console.log(`[rename cat] "${cat.name}" → "${next}"`);
    if (APPLY) {
      try {
        await cat.setName(next, 'MST emoji rename');
        renamed++;
      } catch (e) {
        console.log(`             ⚠ failed: ${e.message}`);
        failed++;
      }
    }
  }

  // Channels (text + voice).
  const channels = [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildVoice)
    .sort((a, b) => (a.parentId || '').localeCompare(b.parentId || '') || a.position - b.position);

  for (const ch of channels) {
    const base = stripEmojiPrefix(ch.name).trim();
    const emoji = CHANNELS[base];
    if (!emoji) {
      console.log(`[skip ch]    ${ch.name}  (no emoji mapping)`);
      missed++;
      continue;
    }
    const next = ch.type === ChannelType.GuildVoice
      ? targetVoiceName(base, emoji)
      : targetTextName(base, emoji);
    // Discord lowercases text channel names. Compare case-insensitively.
    const current = ch.name;
    const eq = ch.type === ChannelType.GuildText
      ? current.toLowerCase() === next.toLowerCase()
      : current === next;
    if (eq) {
      console.log(`[ok ch]      ${current}`);
      skipped++;
      continue;
    }
    console.log(`[rename ch]  "${current}" → "${next}"`);
    if (APPLY) {
      try {
        await ch.setName(next, 'MST emoji rename');
        renamed++;
      } catch (e) {
        console.log(`             ⚠ failed: ${e.message}`);
        failed++;
      }
    }
  }

  console.log(`\nSummary: ${renamed} renamed · ${skipped} already-ok · ${missed} unmapped · ${failed} failed`);
  if (!APPLY) console.log('Re-run with --apply to commit changes.');
  await client.destroy();
  process.exit(0);
});

client.login(TOKEN);
