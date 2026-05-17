/* eslint-disable no-console */
'use strict';
// Grant a role view-only access to a specific channel (feed-channel pattern:
// view + history + react, no send — posts come from the webhook).
//
// Usage:
//   node _grant-channel-access.js <channel-id-or-name> <role-name> [send|nosend]
//
// Examples:
//   node _grant-channel-access.js 🐋-whale-trades Free            # default: nosend
//   node _grant-channel-access.js 🐋-whale-trades Free send       # also grant send
//
// Idempotent: if the role already has the overwrites, it'll re-sync them.

const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.resolve(__dirname, '..', '.env'))
  ? path.resolve(__dirname, '..', '.env')
  : path.resolve(__dirname, '.env');
require('dotenv').config({ path: envPath });

const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
if (!TOKEN || !GUILD_ID) { console.error('✗ missing DISCORD_BOT_TOKEN or GUILD_ID'); process.exit(1); }

const [chanArg, roleNameArg, sendArg] = process.argv.slice(2);
if (!chanArg || !roleNameArg) {
  console.error('usage: node _grant-channel-access.js <channel-id-or-name> <role-name> [send|nosend]');
  process.exit(1);
}
const grantSend = sendArg === 'send';

const P = PermissionFlagsBits;
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    await guild.roles.fetch();

    // Resolve channel by ID or name
    let channel = guild.channels.cache.get(chanArg);
    if (!channel) {
      channel = guild.channels.cache.find(
        (c) => c.name === chanArg && c.type === ChannelType.GuildText,
      );
    }
    if (!channel) throw new Error(`channel not found: ${chanArg}`);

    // Resolve role by name (unmanaged only — avoids bot-integration roles)
    const role = guild.roles.cache.find((r) => r.name === roleNameArg && !r.managed);
    if (!role) throw new Error(`role not found: ${roleNameArg}`);

    const allow = [P.ViewChannel, P.ReadMessageHistory, P.AddReactions];
    if (grantSend) allow.push(P.SendMessages, P.EmbedLinks, P.AttachFiles);

    await channel.permissionOverwrites.edit(role.id, {
      ViewChannel: true,
      ReadMessageHistory: true,
      AddReactions: true,
      ...(grantSend ? { SendMessages: true, EmbedLinks: true, AttachFiles: true } : {}),
    }, { reason: `Grant "${role.name}" ${grantSend ? 'view+send' : 'view-only'} access to #${channel.name}` });

    console.log(`✓ granted role "${role.name}" (${role.id}) ${grantSend ? 'view+send' : 'view-only (feed pattern)'} on #${channel.name} (${channel.id})`);

    // Verify by reading back the overwrite
    const ow = channel.permissionOverwrites.cache.get(role.id);
    if (ow) {
      const names = Object.keys(P).filter((k) => (ow.allow.bitfield & P[k]) === P[k]);
      console.log(`  current allow bits: ${names.join('|') || '-'}`);
    }
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
