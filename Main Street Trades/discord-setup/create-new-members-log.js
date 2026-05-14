/* eslint-disable no-console */
'use strict';
/* ============================================================================
 *  Main Street Trades · STAFF · #new-members
 * ----------------------------------------------------------------------------
 *  Creates the #new-members text channel under the STAFF category and wires
 *  Discord's native "X joined the server" system messages into it. No long-
 *  running bot required — Discord posts join messages itself.
 *
 *  Effect:
 *    + #new-members channel created inside STAFF (staff-readable, bot-posts)
 *    + Guild's "System Messages Channel" set to #new-members
 *    + System message flags configured so ONLY join messages appear there
 *      (boost notifications, setup tips, reply prompts all suppressed)
 *
 *  Idempotent. Re-runnable.
 *
 *  Usage:
 *    node create-new-members-log.js          # dry-run
 *    node create-new-members-log.js --apply  # mutate
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
  PermissionFlagsBits,
  GuildSystemChannelFlags,
} = require('discord.js');

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const APPLY = process.argv.includes('--apply');

if (!TOKEN || !GUILD_ID) {
  console.error('✗ Missing DISCORD_BOT_TOKEN or GUILD_ID in', envPath);
  process.exit(1);
}

const P = PermissionFlagsBits;
const CATEGORY_NAME = 'STAFF';
const CHANNEL_NAME = 'new-members';
const CHANNEL_TOPIC =
  'Auto-log of every new member that joins the server. Posted by Discord itself.';

// Suppress everything Discord would post in a system channel EXCEPT joins.
// (Join-message bit is the absence of SuppressJoinNotifications.)
function targetSystemFlags() {
  return (
    GuildSystemChannelFlags.SuppressPremiumSubscriptions
    | GuildSystemChannelFlags.SuppressGuildReminderNotifications
    | GuildSystemChannelFlags.SuppressJoinNotificationReplies
    | GuildSystemChannelFlags.SuppressRoleSubscriptionPurchaseNotifications
    | GuildSystemChannelFlags.SuppressRoleSubscriptionPurchaseNotificationReplies
  );
}

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
    const Founder = byName('Founder');
    const Mod = byName('Mod');

    // 1. Find STAFF category.
    let staff = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME,
    );
    if (!staff) {
      throw new Error(`STAFF category not found — run create-subscription-logs.js first.`);
    }
    console.log(`→ STAFF category (${staff.id})`);

    // 2. Create #new-members (idempotent).
    let chan = guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === CHANNEL_NAME,
    );
    if (chan) {
      console.log(`→ #${CHANNEL_NAME} exists (${chan.id})`);
      if (chan.parentId !== staff.id) {
        console.log(`  ↳ will reparent to STAFF`);
        if (APPLY) await chan.setParent(staff.id, { lockPermissions: false });
      }
    } else {
      console.log(`✓ create #${CHANNEL_NAME} in STAFF`);
      if (APPLY) {
        chan = await guild.channels.create({
          name: CHANNEL_NAME,
          type: ChannelType.GuildText,
          parent: staff.id,
          topic: CHANNEL_TOPIC,
          reason: 'New-members auto-log',
          permissionOverwrites: buildOverwrites({
            everyone, Founder, Mod, botUserId: client.user.id,
          }),
        });
        console.log(`  ↳ created (${chan.id})`);
      }
    }

    // 3. Configure the guild system channel.
    if (chan) {
      const currentId = guild.systemChannelId;
      if (currentId === chan.id) {
        console.log(`→ system channel already set to #${chan.name}`);
      } else {
        console.log(`✓ set system channel → #${chan.name}`);
        if (APPLY) await guild.setSystemChannel(chan.id, 'New-members auto-log');
      }

      const want = targetSystemFlags();
      const have = guild.systemChannelFlags?.bitfield ?? 0;
      if (have === want) {
        console.log(`→ system-channel flags already configured (joins-only)`);
      } else {
        console.log(`✓ set system-channel flags → joins-only (was 0x${have.toString(16)}, want 0x${want.toString(16)})`);
        if (APPLY) await guild.setSystemChannelFlags(want, 'Joins-only system channel');
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

function buildOverwrites({ everyone, Founder, Mod, botUserId }) {
  const ow = [
    { id: everyone.id, deny: [P.ViewChannel, P.SendMessages] },
  ];
  if (Founder) ow.push({
    id: Founder.id,
    allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.ManageMessages],
  });
  if (Mod) ow.push({
    id: Mod.id,
    allow: [P.ViewChannel, P.ReadMessageHistory],
    deny:  [P.SendMessages],
  });
  if (botUserId) ow.push({
    id: botUserId,
    allow: [P.ViewChannel, P.ReadMessageHistory, P.SendMessages, P.ManageMessages],
  });
  return ow;
}

client.on('error', (e) => console.error('Discord client error:', e.message));
client.login(TOKEN).catch((e) => {
  console.error('✗ Login failed:', e.message);
  process.exit(1);
});
