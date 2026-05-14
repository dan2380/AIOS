/* eslint-disable no-console */
'use strict';
/* ============================================================================
 *  Main Street Trades · Rotate pinned welcome + disclaimer
 * ----------------------------------------------------------------------------
 *  Replaces the bot's existing welcome/disclaimer pins with the current copy
 *  from ./messages/{welcome,disclaimer}.md.
 *
 *  Strategy:
 *    1. Find target channel (norm match — emoji prefix tolerant).
 *    2. Delete every bot-authored message in the channel's recent history.
 *       (#welcome and #disclaimer-must-read should only ever contain the
 *        pinned welcome/disclaimer — they're informational, not feeds.)
 *    3. Post fresh content. If it overflows 2000 chars, chunk on paragraph
 *       breaks. Pin the first chunk.
 *
 *  Idempotent — re-runnable. Always overwrites.
 *
 *  Usage:
 *    node update-pinned-messages.js          # dry-run
 *    node update-pinned-messages.js --apply  # mutate
 * ============================================================================
 */

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
} = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const APPLY = process.argv.includes('--apply');

if (!TOKEN || !GUILD_ID) {
  console.error('✗ Missing DISCORD_BOT_TOKEN or GUILD_ID in', envPath);
  process.exit(1);
}

const TARGETS = [
  { base: 'welcome', file: 'welcome.md', label: 'welcome' },
  { base: 'disclaimer-must-read', file: 'disclaimer.md', label: 'disclaimer' },
];

const EMOJI_PREFIX_RE = /^[\p{Extended_Pictographic}‍️⃣]+[\s\-・│]*/u;
function norm(s) {
  return (s || '').replace(EMOJI_PREFIX_RE, '').toLowerCase().trim();
}

function readBody(file) {
  return fs.readFileSync(path.join(__dirname, 'messages', file), 'utf8').trim();
}

function chunkMessage(text, limit = 1900) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let buf = '';
  for (const para of text.split(/\n\n+/)) {
    const piece = para + '\n\n';
    if ((buf + piece).length > limit) {
      if (buf) chunks.push(buf.trimEnd());
      if (piece.length > limit) {
        for (let i = 0; i < piece.length; i += limit) chunks.push(piece.slice(i, i + limit));
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once('ready', async () => {
  console.log(`Connected as ${client.user.tag}`);
  console.log(APPLY ? 'MODE: APPLY (will mutate Discord)' : 'MODE: DRY-RUN (no changes)');

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    console.log(`Guild: ${guild.name} (${guild.id})\n`);

    for (const t of TARGETS) {
      const ch = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildText && norm(c.name) === t.base,
      );
      if (!ch) {
        console.warn(`⚠ channel matching "${t.base}" not found, skipping`);
        continue;
      }

      const body = readBody(t.file);
      const chunks = chunkMessage(body);
      console.log(`— ${t.label} (#${ch.name}) —`);
      console.log(`  body: ${body.length} chars · ${chunks.length} chunk(s)`);

      // Wipe existing bot messages in this channel.
      const recent = await ch.messages.fetch({ limit: 100 }).catch(() => null);
      const mine = recent ? recent.filter((m) => m.author && m.author.id === client.user.id) : null;
      if (mine && mine.size) {
        console.log(`  removing ${mine.size} existing bot message(s)`);
        if (APPLY) {
          for (const m of mine.values()) {
            try {
              await m.delete();
            } catch (e) {
              console.warn(`    ⚠ delete failed for ${m.id}: ${e.message}`);
            }
          }
        }
      } else {
        console.log(`  no existing bot messages to remove`);
      }

      // Post fresh chunks; pin the first.
      if (APPLY) {
        let first = null;
        for (let i = 0; i < chunks.length; i++) {
          const msg = await ch.send({ content: chunks[i] });
          if (i === 0) first = msg;
        }
        if (first) {
          try {
            await first.pin('Rotated MST pinned message');
            console.log(`  ✓ posted ${chunks.length} chunk(s), pinned first`);
          } catch (e) {
            console.warn(`  ⚠ pin failed: ${e.message}`);
          }
        }
      } else {
        console.log(`  ✓ would post ${chunks.length} chunk(s), pin first`);
      }
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
