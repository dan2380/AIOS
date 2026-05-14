'use strict';
// Quick read-only dump of all categories + channels for sanity check.
const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.resolve(__dirname, '..', '.env'))
  ? path.resolve(__dirname, '..', '.env')
  : path.resolve(__dirname, '.env');
require('dotenv').config({ path: envPath });
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('ready', async () => {
  const g = await c.guilds.fetch(process.env.GUILD_ID);
  await g.channels.fetch();
  const cats = [...g.channels.cache.values()]
    .filter((x) => x.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position);
  for (const cat of cats) {
    console.log(`\n[CAT] ${cat.name}  (${cat.id})`);
    const kids = [...g.channels.cache.values()]
      .filter((x) => x.parentId === cat.id)
      .sort((a, b) => a.position - b.position);
    for (const k of kids) {
      const t = k.type === ChannelType.GuildVoice ? 'voice' : 'text ';
      console.log(`   ${t}  #${k.name}  (${k.id})`);
    }
  }
  const orphans = [...g.channels.cache.values()].filter(
    (x) =>
      x.parentId == null &&
      x.type !== ChannelType.GuildCategory,
  );
  if (orphans.length) {
    console.log('\n[ORPHAN — no category]');
    for (const o of orphans) console.log(`   #${o.name}  (${o.id})`);
  }
  c.destroy();
  process.exit(0);
});
c.login(process.env.DISCORD_BOT_TOKEN);
