#!/usr/bin/env python3
"""
Backfill a destination webhook with the most recent N messages from a source
Discord channel.

Uses the same UOV_MIRROR_USER_TOKEN credential as the live mirror service —
this is the same token doing the same thing (forwarding source posts into the
destination webhook) just initiated at setup time rather than via the WebSocket
gateway. Format matches ws_wh_call.py exactly: source content forwarded
verbatim with username + avatar_url overrides, no "author:" prefix or other
added text (see feedback_mirror_strip_added_text).

Usage:
  python3 backfill.py <source_channel_id> <webhook_url> [--limit 25]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
ENV_PATHS = [HERE / ".env", HERE.parent / ".env"]
for p in ENV_PATHS:
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            if (val.startswith('"') and val.endswith('"')) or (
                val.startswith("'") and val.endswith("'")
            ):
                val = val[1:-1]
            os.environ.setdefault(key, val)
        break

TOKEN = os.environ.get("UOV_MIRROR_USER_TOKEN")
if not TOKEN:
    print("✗ UOV_MIRROR_USER_TOKEN missing", file=sys.stderr)
    sys.exit(1)

UA = "MST-Mirror-Backfill/1.0"
API = "https://discord.com/api/v10"
EMBED_KEYS = {
    "title", "description", "url", "timestamp", "color",
    "footer", "image", "thumbnail", "author", "fields",
}


def fetch_messages(channel_id: str, limit: int) -> list[dict]:
    """Newest-first, then we reverse so we post oldest-first."""
    r = requests.get(
        f"{API}/channels/{channel_id}/messages",
        params={"limit": str(min(limit, 100))},
        headers={"Authorization": TOKEN, "User-Agent": UA},
        timeout=20,
    )
    r.raise_for_status()
    msgs = r.json()
    return list(reversed(msgs))  # post oldest → newest


def post_to_webhook(webhook_url: str, msg: dict) -> None:
    """Forward a single message via the destination webhook, verbatim."""
    author = (msg.get("author") or {})
    username = author.get("username") or "mirror"
    author_id = author.get("id")
    avatar_hash = author.get("avatar")
    avatar_url = (
        f"https://cdn.discordapp.com/avatars/{author_id}/{avatar_hash}.png"
        if author_id and avatar_hash
        else None
    )

    content = msg.get("content") or ""
    embeds = [
        {k: v for k, v in (e or {}).items() if k in EMBED_KEYS}
        for e in (msg.get("embeds") or [])
    ][:10]
    attachments = msg.get("attachments") or []

    files_payload: list[tuple[str, tuple[str, bytes, str]]] = []
    fallback_urls: list[str] = []
    MAX_BYTES = 7 * 1024 * 1024
    for i, a in enumerate(attachments[:10]):
        url = a.get("url")
        if not url:
            continue
        size = a.get("size") or 0
        if size and size > MAX_BYTES:
            fallback_urls.append(url)
            continue
        try:
            r = requests.get(url, timeout=20)
            r.raise_for_status()
            files_payload.append(
                (
                    f"files[{i}]",
                    (
                        a.get("filename") or f"file{i}",
                        r.content,
                        a.get("content_type") or "application/octet-stream",
                    ),
                )
            )
        except Exception as ex:
            print(f"  attachment fetch failed ({url[:60]}…): {ex}")
            fallback_urls.append(url)
    if fallback_urls:
        content = (content + ("\n" if content else "") + "\n".join(fallback_urls)).strip()

    if not content and not embeds and not files_payload:
        return

    body = content or ""
    chunks: list[str] = []
    if body or not (embeds or files_payload):
        if not body:
            chunks = [""]
        else:
            while body:
                chunks.append(body[:2000])
                body = body[2000:]
    else:
        chunks = [""]

    for idx, chunk in enumerate(chunks):
        payload = {"content": chunk[:2000], "username": username}
        if avatar_url:
            payload["avatar_url"] = avatar_url
        if idx == 0 and embeds:
            payload["embeds"] = embeds
        try:
            if idx == 0 and files_payload:
                resp = requests.post(
                    webhook_url,
                    data={"payload_json": json.dumps(payload)},
                    files=files_payload,
                    timeout=30,
                )
            else:
                resp = requests.post(webhook_url, json=payload, timeout=10)
            if not resp.ok:
                # Honor webhook rate limits.
                if resp.status_code == 429:
                    retry = float(resp.json().get("retry_after", 1))
                    print(f"  rate limited, sleeping {retry:.1f}s")
                    time.sleep(retry)
                    continue
                print(f"  webhook responded {resp.status_code}: {resp.text[:200]}")
        except Exception as ex:
            print(f"  webhook post failed: {ex}")

        # gentle pace: stay under Discord's 30-per-minute global webhook limit.
        time.sleep(0.4)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("source_channel_id")
    p.add_argument("webhook_url")
    p.add_argument("--limit", type=int, default=25)
    args = p.parse_args()

    print(f"# fetching last {args.limit} from channel {args.source_channel_id}")
    try:
        msgs = fetch_messages(args.source_channel_id, args.limit)
    except requests.HTTPError as e:
        print(f"✗ fetch failed: {e.response.status_code} {e.response.text[:200]}")
        return 1
    print(f"# got {len(msgs)} messages, posting oldest → newest")
    for i, m in enumerate(msgs, 1):
        author = (m.get("author") or {}).get("username", "?")
        preview = (m.get("content") or "").replace("\n", " ")[:80]
        print(f"  [{i}/{len(msgs)}] {author}: {preview}")
        post_to_webhook(args.webhook_url, m)
    print("# done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
