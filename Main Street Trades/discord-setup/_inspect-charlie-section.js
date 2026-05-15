/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.resolve(__dirname, '..', '.env'))
  ? path.resolve(__dirname, '..', '.env')
  : path.resolve(__dirname, '.env');
require('dotenv').config({ path: envPath });

const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const TARGETS = [
  '1504262744675844096', // charlie-options-ideas
  '1504459138359627918', // long-term-price-analysis
  '1504461438545166386', // leaps-ideas
];
const DIVIDER_NAMES = [
  '--charlie-plattus | zip-trader--',
  '--charlie-plattus---zip-trader--',
  'charlie-plattus---zip-trader',
];

const P = PermissionFlagsBits;
function permNames(bits) {
  if (!bits) return [];
  return Object.keys(P).filter((k) => (bits & P[k]) === P[k]);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    await guild.roles.fetch();
    const roleName = (id) => guild.roles.cache.get(id)?.name || `<role:${id}>`;

    console.log('--- 3 target channels ---');
    for (const id of TARGETS) {
      const c = guild.channels.cache.get(id);
      if (!c) { console.log(`  ✗ missing ${id}`); continue; }
      const parent = c.parentId ? guild.channels.cache.get(c.parentId) : null;
      console.log(`  #${c.name} (${c.id})`);
      console.log(`    parent: ${parent ? `${parent.name} (${parent.id})` : '<none>'}`);
      console.log(`    position: ${c.position}, rawPosition: ${c.rawPosition}`);
      console.log(`    permission overwrites:`);
      for (const ow of c.permissionOverwrites.cache.values()) {
        const tag = ow.type === 0 ? `role ${roleName(ow.id)}` : `user ${ow.id}`;
        console.log(`      ${tag}  allow=${permNames(BigInt(ow.allow.bitfield || 0n)).join('|') || '-'}  deny=${permNames(BigInt(ow.deny.bitfield || 0n)).join('|') || '-'}`);
      }
    }

    console.log('\n--- divider channel candidates ---');
    const text = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText);
    for (const c of text) {
      const lower = c.name.toLowerCase();
      if (DIVIDER_NAMES.some((n) => lower === n) || /charlie.*plattus|zip.*trader/i.test(c.name)) {
        const parent = c.parentId ? guild.channels.cache.get(c.parentId) : null;
        console.log(`  #${c.name} (${c.id}) — parent: ${parent ? parent.name : '<none>'}, position: ${c.position}`);
      }
    }

    console.log('\n--- all categories (for context) ---');
    const cats = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildCategory)
      .sort((a, b) => a.position - b.position);
    for (const cat of cats) {
      console.log(`  ${cat.position}  ${cat.name} (${cat.id})`);
    }
  } catch (e) {
    console.error('✗', e.message); if (e.stack) console.error(e.stack);
    process.exitCode = 1;
  } finally { client.destroy(); process.exit(); }
});
client.login(TOKEN);
