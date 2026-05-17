'use strict';

/* Delete the legacy Sunday weekly posts from #📊-earnings-this-week:
 *   - The "Earnings This Week" text-embed message
 *   - The MST-branded "Most Anticipated Earnings · Week of …" PNG message
 * Run with --post to actually delete; default is dry preview. */

const fs = require('fs');
const path = require('path');

const parentEnvPath = path.resolve(__dirname, '..', '..', '.env');
const localEnvPath = path.resolve(__dirname, '..', '.env');
const envPath = fs.existsSync(localEnvPath) ? localEnvPath : parentEnvPath;
require('dotenv').config({ path: envPath });

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

function looksLikeLegacy(m) {
  const content = m.content || '';
  if (/^\*\*Most Anticipated Earnings · Week of/.test(content)) return true;
  const embed = m.embeds?.[0];
  if (embed && /^Earnings This Week$/.test(embed.title || '')) return true;
  return false;
}

(async () => {
  const { Client, GatewayIntentBits } = require('discord.js');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(TOKEN);
  await new Promise((res) => client.once('clientReady', res));
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.channels.fetch();
  const ch = guild.channels.cache.find(
    (c) => c.isTextBased && c.isTextBased() && /earnings-this-week/.test(c.name),
  );
  if (!ch) { console.error('channel not found'); await client.destroy(); return; }

  const msgs = await ch.messages.fetch({ limit: 50 });
  const mine = msgs.filter((m) => m.author?.id === client.user.id && looksLikeLegacy(m));
  console.log(`→ found ${mine.size} legacy weekly post(s) to remove`);
  for (const m of mine.values()) {
    const tag = (m.embeds?.[0]?.title) || (m.content || '').slice(0, 60);
    console.log(`  ${m.id}  posted ${m.createdAt.toISOString()}  "${tag}"`);
  }

  if (!process.argv.includes('--post')) {
    console.log('\n(dry preview — pass --post to actually delete)');
    await client.destroy(); return;
  }

  for (const m of mine.values()) {
    try { await m.delete(); console.log(`✗ deleted ${m.id}`); }
    catch (e) { console.warn(`could not delete ${m.id}: ${e.message}`); }
  }
  await client.destroy();
})().catch((e) => { console.error('fatal:', e); process.exit(1); });
