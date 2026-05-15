/* eslint-disable no-console */
'use strict';
// Two-in-one restructure:
//
// (1) Promote the Charlie Plattus / Zip Trader section to a proper top-level
//     Discord category so it collapses like TRADYTICS. The current setup uses
//     a fake "divider" channel "━━charlie-plattus┃zip-trader━━" as a label
//     inside the broader PARTNER ANALYSTS category — Discord doesn't support
//     nested categories, so the only way to get a collapsible Charlie/Zip
//     header is to make it its own category.
//
//     Moves the 3 channels (charlie-options-ideas, long-term-price-analysis,
//     leaps-ideas) into a new "Charlie Plattus | Zip Trader" category, then
//     deletes the divider channel. If PARTNER ANALYSTS becomes empty, deletes
//     it too. Per-channel overwrites are preserved (no lockPermissions).
//
// (2) Add an "ai-commands" channel to the TRADYTICS category (Admin/Mod only,
//     inherits category perms).

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

const P = PermissionFlagsBits;

const NEW_CAT_NAME = 'Charlie Plattus | Zip Trader';
const CHANNEL_IDS_IN_ORDER = [
  '1504262744675844096', // 💡-charlie-options-ideas
  '1504459138359627918', // 🎯-long-term-price-analysis
  '1504461438545166386', // 🗓️-leaps-ideas
];
const DIVIDER_CHANNEL_ID = '1504453509158932521'; // ━━charlie-plattus┃zip-trader━━
const PARTNER_ANALYSTS_CAT_ID = '1504453507283943617';

const TRADYTICS_CAT_ID = '1504914311745900615';
const AI_COMMANDS_SLUG = 'ai-commands';
const AI_COMMANDS_TOPIC = 'AI commands and tool integrations · staff only.';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

async function ensureCategory(guild, name, overwrites, positionHint) {
  let cat = guild.channels.cache.find((c) => c.name === name && c.type === ChannelType.GuildCategory);
  if (cat) {
    console.log(`→ existing category "${name}" (${cat.id}) — re-syncing overwrites`);
    await cat.permissionOverwrites.set(overwrites);
  } else {
    cat = await guild.channels.create({
      name, type: ChannelType.GuildCategory, permissionOverwrites: overwrites,
      reason: `Restructure: promote Charlie/Zip section to top-level collapsible category`,
    });
    console.log(`✓ created category "${name}" (${cat.id})`);
  }
  if (typeof positionHint === 'number') {
    try { await cat.setPosition(positionHint); } catch (e) { console.warn(`  ⚠ could not set position: ${e.message}`); }
  }
  return cat;
}

client.once('ready', async () => {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.channels.fetch();
    await guild.roles.fetch();

    const everyone = guild.roles.everyone;
    const admin = guild.roles.cache.find((r) => r.name === 'Admin' && !r.managed);
    const mod = guild.roles.cache.find((r) => r.name === 'Mod' && !r.managed);
    const premium = guild.roles.cache.find((r) => r.name === 'Premium' && !r.managed);
    const vip = guild.roles.cache.find((r) => r.name === 'VIP' && !r.managed);
    if (!admin || !mod || !premium || !vip) {
      throw new Error('Missing one of Admin/Mod/Premium/VIP roles.');
    }

    // ────────────────────────────────────────────────────────────────────
    // (1) Charlie Plattus | Zip Trader category
    // ────────────────────────────────────────────────────────────────────

    // Template overwrites from the channels themselves (they share a scheme):
    // @everyone deny view+send, Admin+Mod full, Premium+VIP view+history+react
    // (no send), plus the MST bot's own allow.
    const partnerOverwrites = [
      { id: everyone.id, deny: [P.ViewChannel, P.SendMessages, P.Connect] },
      {
        id: admin.id,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages, P.EmbedLinks, P.AttachFiles, P.AddReactions, P.Connect, P.Speak],
      },
      {
        id: mod.id,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages, P.EmbedLinks, P.AttachFiles, P.AddReactions, P.Connect, P.Speak],
      },
      {
        id: premium.id,
        allow: [P.ViewChannel, P.ReadMessageHistory, P.AddReactions],
        deny: [P.SendMessages, P.ManageThreads, P.CreatePublicThreads, P.SendMessagesInThreads],
      },
      {
        id: vip.id,
        allow: [P.ViewChannel, P.ReadMessageHistory, P.AddReactions],
        deny: [P.SendMessages, P.ManageThreads, P.CreatePublicThreads, P.SendMessagesInThreads],
      },
      {
        id: client.user.id,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.AttachFiles, P.ManageWebhooks, P.ManageMessages],
      },
    ];

    const oldPartnerCat = guild.channels.cache.get(PARTNER_ANALYSTS_CAT_ID);
    const oldPos = oldPartnerCat ? oldPartnerCat.position : undefined;
    const newCat = await ensureCategory(guild, NEW_CAT_NAME, partnerOverwrites, oldPos);

    // Move each target channel into the new category (preserve per-channel
    // overwrites — no lockPermissions).
    for (let i = 0; i < CHANNEL_IDS_IN_ORDER.length; i++) {
      const id = CHANNEL_IDS_IN_ORDER[i];
      const ch = guild.channels.cache.get(id);
      if (!ch) { console.warn(`  ⚠ channel ${id} not found — skipping`); continue; }
      if (ch.parentId !== newCat.id) {
        await ch.setParent(newCat.id, { lockPermissions: false });
        console.log(`  ✓ moved #${ch.name} → "${NEW_CAT_NAME}"`);
      } else {
        console.log(`  → #${ch.name} already in "${NEW_CAT_NAME}"`);
      }
      try { await ch.setPosition(i); } catch (e) { console.warn(`    ⚠ position: ${e.message}`); }
    }

    // Delete the divider channel.
    const divider = guild.channels.cache.get(DIVIDER_CHANNEL_ID);
    if (divider) {
      // Check if there's meaningful content first.
      let msgCount = 0;
      try {
        const msgs = await divider.messages.fetch({ limit: 10 });
        msgCount = msgs.size;
      } catch (e) {
        console.warn(`  ⚠ couldn't read divider messages: ${e.message}`);
      }
      if (msgCount > 1) {
        console.log(`  ⚠ divider "${divider.name}" has ${msgCount} message(s) — KEEPING it; rename it manually if you want.`);
      } else {
        await divider.delete('Replaced by proper category "Charlie Plattus | Zip Trader"');
        console.log(`  ✓ deleted divider channel "━━charlie-plattus┃zip-trader━━" (was empty)`);
      }
    } else {
      console.log(`  → divider channel ${DIVIDER_CHANNEL_ID} already gone`);
    }

    // If PARTNER ANALYSTS is now empty, delete it.
    if (oldPartnerCat) {
      await guild.channels.fetch(); // refresh cache
      const stillIn = [...guild.channels.cache.values()].filter((c) => c.parentId === PARTNER_ANALYSTS_CAT_ID);
      if (stillIn.length === 0) {
        await oldPartnerCat.delete('Empty after Charlie/Zip section promoted to its own category');
        console.log(`  ✓ deleted empty category "🤝・PARTNER ANALYSTS"`);
      } else {
        console.log(`  → "🤝・PARTNER ANALYSTS" still has ${stillIn.length} channel(s): ${stillIn.map((c) => c.name).join(', ')} — keeping`);
      }
    }

    // ────────────────────────────────────────────────────────────────────
    // (2) Add ai-commands to TRADYTICS
    // ────────────────────────────────────────────────────────────────────

    const tradyCat = guild.channels.cache.get(TRADYTICS_CAT_ID);
    if (!tradyCat) {
      console.warn(`✗ TRADYTICS category ${TRADYTICS_CAT_ID} not found — skipping ai-commands creation`);
    } else {
      let aiCh = guild.channels.cache.find(
        (c) => c.name === AI_COMMANDS_SLUG && c.type === ChannelType.GuildText && c.parentId === tradyCat.id,
      );
      if (aiCh) {
        console.log(`→ existing #${AI_COMMANDS_SLUG} (${aiCh.id}) — re-syncing`);
        await aiCh.lockPermissions().catch(() => {});
        if (aiCh.topic !== AI_COMMANDS_TOPIC) await aiCh.setTopic(AI_COMMANDS_TOPIC).catch(() => {});
      } else {
        aiCh = await guild.channels.create({
          name: AI_COMMANDS_SLUG,
          type: ChannelType.GuildText,
          parent: tradyCat.id,
          topic: AI_COMMANDS_TOPIC,
          reason: 'AI commands channel (staff)',
        });
        console.log(`✓ created #${AI_COMMANDS_SLUG} (${aiCh.id}) in TRADYTICS`);
      }
      // Place ai-commands at the TOP of the TRADYTICS category (commands above feeds).
      try { await aiCh.setPosition(0); } catch (e) { console.warn(`  ⚠ position: ${e.message}`); }
    }

    console.log('\n--- done ---');
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
