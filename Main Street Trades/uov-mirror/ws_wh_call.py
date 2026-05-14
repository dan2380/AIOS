#!/usr/bin/env python3
# The MIT License
#
# Copyright (c) 2023-, Haibin Wen, Jason Wen, sunnyhaibin, and a number of other of contributors.
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.

import argparse
import json
import os
import requests
import time
import threading
import websocket


class MirrorBot:
  def __init__(self):
    self.ws = websocket.WebSocket()
    self.event = None
    self.heartbeat_interval = None

  def send_json_request(self, request):
    self.ws.send(json.dumps(request))

  def receive_json_response(self):
    response = self.ws.recv()
    if response:
      return json.loads(response)

  def heartbeat(self, interval, ws):
    print("Heartbeat begins")
    while True:
      time.sleep(interval)
      heartbeat_json = {
        "op": 1,
        "d": "null"
      }
      self.send_json_request(heartbeat_json)
      print("Heartbeat sent")

  def mirror_thread(self, source_server, routes, auth_token):
    # routes: list[dict] with keys {channel, webhook, webhook_name}
    route_by_channel = {str(r["channel"]): r for r in routes}
    referer_channel = next(iter(route_by_channel)) if route_by_channel else "0"
    print(f"routing {len(route_by_channel)} channel(s): "
          + ", ".join(f"{c}→{r.get('webhook_name','?')}" for c, r in route_by_channel.items()))

    self.ws.connect("wss://gateway.discord.gg/?v=6&encording=json")
    self.event = self.receive_json_response()

    self.heartbeat_interval = self.event["d"]["heartbeat_interval"] / 1000
    threading.Thread(
      target=self.heartbeat,
      args=(self.heartbeat_interval, self.ws),
      daemon=True,
    ).start()

    payload = {
      "op": 2,
      "d": {
        "token": auth_token,
        "properties": {
          "$os": "windows",
          "$browser": "chrome",
          "$device": "pc",
          "$referer": f"https://discord.com/channels/{source_server}/{referer_channel}"
        }
      }
    }
    self.send_json_request(payload)
    # Embed fields the webhook API accepts (anything else triggers HTTP 400).
    EMBED_KEYS = {"title","type","description","url","timestamp","color",
                  "footer","image","thumbnail","author","fields"}
    while 1:
      self.event = self.receive_json_response()
      if self.event is None:
        # Empty/close frame — gateway closed (auth failure, idle, rate limit).
        # The next recv() will raise WebSocketConnectionClosedException; launchd will respawn.
        print("gateway returned empty frame (likely close) — letting connection drop")
        continue
      try:
        if self.event.get("op") == 11:
          print("Heartbeat received")
          continue
        if self.event.get("t") != "MESSAGE_CREATE":
          continue
        d = self.event.get("d") or {}
        route = route_by_channel.get(f"{d.get('channel_id')}")
        if not route:
          continue
        author_obj = d.get("author") or {}
        author = author_obj.get("username") or "?"
        author_id = author_obj.get("id")
        author_avatar = author_obj.get("avatar")
        # Webhook display name + avatar override — used so the mirrored post
        # visually looks like the source author posted natively. NOT prepended
        # to message body (see feedback_mirror_strip_added_text).
        avatar_url = (
          f"https://cdn.discordapp.com/avatars/{author_id}/{author_avatar}.png"
          if author_id and author_avatar else None
        )
        if author == route.get("webhook_name"):
          continue  # don't echo our own posts

        content = d.get("content") or ""
        embeds  = [{k: v for k, v in (e or {}).items() if k in EMBED_KEYS}
                   for e in (d.get("embeds") or [])][:10]
        attachments = d.get("attachments") or []

        # Fetch each attachment so we can re-upload via multipart. Re-hosting
        # via the webhook makes Discord render images inline (URL-only posts
        # don't auto-embed via webhooks) AND survives source CDN URL expiry.
        files_payload = []  # list of (field_name, (filename, bytes, content_type))
        fallback_urls = []
        MAX_BYTES = 7 * 1024 * 1024  # webhook upload limit on non-Nitro tier
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
            files_payload.append((
              f"files[{i}]",
              (a.get("filename") or f"file{i}", r.content,
               a.get("content_type") or "application/octet-stream"),
            ))
          except Exception as ex:
            print(f"  attachment fetch failed ({url[:60]}…): {ex} — falling back to URL")
            fallback_urls.append(url)
        if fallback_urls:
          content = (content + ("\n" if content else "") + "\n".join(fallback_urls)).strip()

        print(f"[{route.get('webhook_name','?')}] {author}: {content[:120]}"
              f"{' [+embed]' if embeds else ''}{f' [+{len(files_payload)} file(s)]' if files_payload else ''}")
        if not content and not embeds and not files_payload:
          continue

        # Split the body across 2000-char Discord limit. First chunk carries
        # files + embeds; continuation chunks are plain text. The source
        # author's name appears via the webhook username override, not as an
        # inline "author:" prefix — mirrored posts must look identical to the
        # original (see feedback_mirror_strip_added_text).
        body = content if content else ""
        chunks = []
        if body or not (embeds or files_payload):
          if not body:
            chunks = [""]
          else:
            remaining = body
            while remaining:
              chunks.append(remaining[:2000])
              remaining = remaining[2000:]
        else:
          chunks = [""]

        for idx, chunk in enumerate(chunks):
          payload = {
            "content": chunk[:2000],
            "username": author,
          }
          if avatar_url:
            payload["avatar_url"] = avatar_url
          if idx == 0 and embeds:
            payload["embeds"] = embeds
          try:
            if idx == 0 and files_payload:
              resp = requests.post(
                route["webhook"],
                data={"payload_json": json.dumps(payload)},
                files=files_payload,
                timeout=30,
              )
            else:
              resp = requests.post(route["webhook"], json=payload, timeout=10)
            if not resp.ok:
              print(f"  webhook responded {resp.status_code}: {resp.text[:200]}")
          except Exception as ex:
            print(f"webhook post failed: {ex}")
      except KeyboardInterrupt:
        break
      except Exception as ex:
        print(f"event handler error: {ex}")


def main(source_server, routes, auth_token):
  mirror = MirrorBot()
  mirror.mirror_thread(source_server, routes, auth_token)


if __name__ == "__main__":
  parser = argparse.ArgumentParser(description="Mirror Discord messages from one or more source channels to webhooks.")
  parser.add_argument("--source_server", required=True, help="Source server (guild) ID — used in the gateway referer header.")
  parser.add_argument("--routes", default=None,
                      help='JSON array of routes: \'[{"channel":"<id>","webhook":"<url>","webhook_name":"<name>"}, ...]\'. '
                           "If omitted, falls back to the MIRROR_ROUTES env var.")
  parser.add_argument("--auth_token", required=True, help="Discord user token (selfbot).")

  args = parser.parse_args()
  routes_raw = args.routes or os.environ.get("MIRROR_ROUTES")
  if not routes_raw:
    parser.error("--routes is required (or set MIRROR_ROUTES env var)")
  try:
    routes = json.loads(routes_raw)
  except Exception as e:
    parser.error(f"--routes is not valid JSON: {e}")
  if not isinstance(routes, list) or not routes:
    parser.error("--routes must be a non-empty JSON array")
  for r in routes:
    for k in ("channel", "webhook", "webhook_name"):
      if k not in r:
        parser.error(f"route missing key '{k}': {r}")

  main(args.source_server, routes, args.auth_token)
