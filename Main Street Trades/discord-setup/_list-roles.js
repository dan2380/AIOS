/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.resolve(__dirname, '..', '.env'))
  ? path.resolve(__dirname, '..', '.env')
  : path.resolve(__dirname, '.env');
require('dotenv').config({ path: envPath });

const { Client, GatewayIntentBits } = require('discord.js');
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.roles.fetch();
    const rolesSorted = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position);
    for (const r of rolesSorted) {
      console.log(`${String(r.position).padStart(3, ' ')}  ${r.id}  ${r.managed ? '[managed]' : '         '}  ${r.name}`);
    }
  } catch (e) {
    console.error('✗', e.message); process.exitCode = 1;
  } finally { client.destroy(); process.exit(); }
});
client.login(TOKEN);
