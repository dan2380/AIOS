#!/usr/bin/env python3
"""
One-shot: create the two Discord webhooks for follow-the-money channels
using DISCORD_BOT_TOKEN from .env. Idempotent — if a webhook with the
given name already exists in the channel, reuses it instead of creating
a duplicate.

Prints two lines to stdout that install.sh appends to .env:
  FTM_INSIDER_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>
  FTM_POLITICIAN_WEBHOOK_URL=https://discord.com/api/webhooks/<id>/<token>
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

POLITICIAN_CHANNEL_ID = "1504326222078021794"
INSIDER_CHANNEL_ID = "1504326226175725730"

POLITICIAN_HOOK_NAME = "Follow the Money — Politicians"
INSIDER_HOOK_NAME = "Follow the Money — Insiders"


def discord_get(url: str, token: str) -> list | dict:
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bot {token}",
            "User-Agent": "MainStreetTrades-FollowTheMoney/1.0 (setup)",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def discord_post(url: str, token: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
            "User-Agent": "MainStreetTrades-FollowTheMoney/1.0 (setup)",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def ensure_webhook(token: str, channel_id: str, name: str) -> str:
    """Return webhook URL — reuse existing or create a fresh one."""
    list_url = f"https://discord.com/api/v10/channels/{channel_id}/webhooks"
    try:
        existing = discord_get(list_url, token)
    except urllib.error.HTTPError as e:
        body = b""
        try:
            body = e.read()
        except Exception:
            pass
        sys.stderr.write(
            f"failed to list webhooks for channel {channel_id}: HTTP {e.code} — "
            f"{body[:200]!r}\n"
        )
        raise

    if isinstance(existing, list):
        for wh in existing:
            if wh.get("name") == name and wh.get("token"):
                return f"https://discord.com/api/webhooks/{wh['id']}/{wh['token']}"

    created = discord_post(list_url, token, {"name": name})
    if "token" not in created:
        raise RuntimeError(f"webhook create returned no token: {created}")
    return f"https://discord.com/api/webhooks/{created['id']}/{created['token']}"


def main() -> int:
    token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
    if not token:
        sys.stderr.write("DISCORD_BOT_TOKEN missing from environment\n")
        return 1

    try:
        insider_url = ensure_webhook(token, INSIDER_CHANNEL_ID, INSIDER_HOOK_NAME)
        politician_url = ensure_webhook(token, POLITICIAN_CHANNEL_ID, POLITICIAN_HOOK_NAME)
    except Exception as e:
        sys.stderr.write(f"webhook setup failed: {e}\n")
        return 2

    # Output is consumed by install.sh — keep this format stable.
    print(f"FTM_INSIDER_WEBHOOK_URL={insider_url}")
    print(f"FTM_POLITICIAN_WEBHOOK_URL={politician_url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
