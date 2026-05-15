# MST Discord Mirror — Setup

Multi-route REST-polling mirror. Forwards messages from third-party
Discord channels into MST channels via webhooks.

> **History:** Originally built as the UOV (Unusual Options Volume) mirror
> from Tradytics. UOV route was retired 2026-05-16 because Tradytics now
> pings MST directly. The daemon now carries Charlie Ideas, Earnings,
> Morning Briefing, Stock Briefs, Charlie LEAPS, and Long-Term Price
> Analysis routes. Env keys still carry the legacy `UOV_MIRROR_*` prefix
> for the shared selfbot token + source guild (`UOV_MIRROR_USER_TOKEN`,
> `UOV_MIRROR_SOURCE_SERVER_ID`) — see `run-mirror.sh` for route assembly.

Cloned from: https://github.com/sunnyhaibin/simple-discord-mirror

## ⚠️ Read this first

`ws_wh_call.py` reads Discord via REST using a **user token** (a.k.a.
selfbot). That is a Discord ToS violation. Discord will ban the account
whose token is used if they detect it.

**Do not use Daniel's primary Discord account.** Create a throwaway:

1. New Gmail / Proton alias.
2. Sign up at https://discord.com with that alias.
3. Verify email + phone if Discord asks.
4. Join the source server.
5. Confirm the throwaway account can see every channel each active route
   reads from (see route list in `run-mirror.sh`).

If the throwaway gets banned, spin up another one. The mirror keeps
running once you swap the token.

## What's configured in `.env`

Shared daemon credentials:
- `UOV_MIRROR_USER_TOKEN` — selfbot user token (read every route)
- `UOV_MIRROR_SOURCE_SERVER_ID` — source guild (informational)

Per-route blocks (one per active mirror) — each defines
`<PREFIX>_SOURCE_CHANNEL_ID`, `<PREFIX>_WEBHOOK_URL`,
`<PREFIX>_WEBHOOK_NAME`, optional `<PREFIX>_DISPLAY_NAME_OVERRIDE`.
Add or remove an entry in `run-mirror.sh::add(...)` to enable/disable a
route. The UOV route was the original example and has been removed.

## What you still need to supply

`UOV_MIRROR_USER_TOKEN` in `Main Street Trades/.env`. To grab it:

1. Open https://discord.com/app in a browser logged in as the throwaway.
2. Open DevTools (`Cmd+Option+I`).
3. Console tab. Paste this and hit enter:

   ```js
   (webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken!==void 0).exports.default.getToken()
   ```

4. Copy the string it prints (no quotes). Paste it as the value of
   `UOV_MIRROR_USER_TOKEN=` in `.env`.

Alternative: DevTools → Network → reload → pick any request to
`discord.com/api/...` → copy the `Authorization` header value.

## Run it

```bash
cd "Main Street Trades/uov-mirror"
./run-mirror.sh
```

It runs in the foreground and prints every received message. Leave it
running in a terminal, or daemonize with `nohup`, `tmux`, or launchd.

### Background with nohup

```bash
cd "Main Street Trades/uov-mirror"
nohup ./run-mirror.sh > mirror.log 2>&1 &
echo $! > mirror.pid
```

Stop: `kill "$(cat mirror.pid)"`.

## Avatar convention (stable per-channel identity)

Any route can pin a stable display identity (name + avatar) by:

- Uploading the desired avatar to the **webhook itself** in Discord
  (Channel settings → Integrations → Webhooks → <webhook name> → set
  avatar to the image you want).
- Setting `<PREFIX>_DISPLAY_NAME_OVERRIDE=<Name>` in `.env`. This tells
  `ws_wh_call.py` to override the source username **and** strip the
  source-author avatar URL. With no `avatar_url` in the webhook payload,
  Discord falls back to the webhook's stored avatar.
- `backfill.py` honors the same convention via
  `--display-name-override "<Name>"`. Always pass it when backfilling,
  otherwise backfilled posts will render with the source author's
  avatar and name.

Active examples: the Oreo-branded feeds (Earnings, Morning Briefing,
Stock Briefs) use `DISPLAY_NAME_OVERRIDE=Oreo`. The historical UOV
example used `DISPLAY_NAME_OVERRIDE=Unusual Options Volume` with a
whale avatar.

If posts are showing the wrong avatar after a config change, check:

1. Webhook avatar still set to the whale in Discord channel settings.
2. `UOV_MIRROR_DISPLAY_NAME_OVERRIDE` is set in `.env`.
3. Live mirror was restarted after the `.env` edit.
4. Any backfill commands passed `--display-name-override`.

## Caveats

- Text-only mirror. No embeds, no attachments, no formatting preserved
  — just `username: content`.
- Reconnect / heartbeat handling is basic. Expect to restart it
  occasionally.
- If the source channel rate-limits or rotates IDs, update `.env`.
- The destination webhook URL is a bearer credential — anyone who
  gets it can post into our channel. Keep `.env` out of git.
