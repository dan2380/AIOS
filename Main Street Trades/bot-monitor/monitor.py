#!/usr/bin/env python3
"""
mst-bot-monitor — health snapshot for every bot/feed that posts into MST.

For each feed we check two things:
  1. The daemon process is loaded in launchd (if it has one).
  2. The destination channel has a recent message (within the cadence threshold).

A green check means BOTH. A red mark means at least one of them is wrong. We
learned the hard way (2026-05-15) that a "process alive" daemon can still go
silent for hours when its gateway session gets zombied — so the "fresh message
in the destination channel" check is the one that actually matters.

Usage:
  python3 monitor.py            # print to stdout
  python3 monitor.py --post     # also post the report to the bot-health webhook
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

# ── env loading ──────────────────────────────────────────────────────────────

HERE = Path(__file__).resolve().parent
ENV_PATHS = [
    HERE / ".env",
    Path.home() / "Library/Application Support/MainStreetTrades/uov-mirror/.env",
]
for p in ENV_PATHS:
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            os.environ.setdefault(k, v)

BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
MONITOR_WEBHOOK = os.environ.get("MST_BOT_MONITOR_WEBHOOK_URL", "").strip()
UA = "MST-BotMonitor/1.0"

# Persists the last-seen message ID per channel across runs. Lets us count
# how many *new* messages arrived since the previous run instead of only
# checking the age of whatever happens to be latest. Lives next to the script
# so a `cp` deploy doesn't drop state.
STATE_FILE = Path.home() / "Library/Application Support/MainStreetTrades/bot-monitor/state.json"

if not BOT_TOKEN:
    print("✗ DISCORD_BOT_TOKEN missing from env", file=sys.stderr)
    sys.exit(1)


# ── inventory ────────────────────────────────────────────────────────────────

# Each feed has a destination channel where content lands and a cadence
# threshold in hours. If we don't see a fresh message within that window we
# flag the feed as stale. Some feeds also pin to a specific daemon — if the
# daemon is unloaded that's an automatic red regardless of the channel state.
FEEDS: list[dict] = [
    # UOV mirror retired 2026-05-16 — Tradytics pings MST directly now.
    {
        "name": "Charlie Options Ideas",
        "dest_channel": "1504262744675844096",   # 💡-charlie-options-ideas
        "daemon":       "com.dwang.uov-mirror",
        "fresh_hours":  72,
    },
    {
        "name": "Charlie LEAPS",
        "dest_channel": "1504461438545166386",   # 🗓️-leaps-ideas
        "daemon":       "com.dwang.uov-mirror",
        "fresh_hours":  120,
    },
    {
        "name": "Long-Term Price Analysis",
        "dest_channel": "1504459138359627918",   # 🎯-long-term-price-analysis
        "daemon":       "com.dwang.uov-mirror",
        "fresh_hours":  120,
    },
    {
        "name": "Morning Briefing",
        "dest_channel": "1504461359943909416",   # 🧨-morning-briefing
        "daemon":       "com.dwang.uov-mirror",
        "fresh_hours":  30,   # daily
    },
    {
        "name": "Stock Briefs",
        "dest_channel": "1504461365673201735",   # 💡-stock-briefs
        "daemon":       "com.dwang.uov-mirror",
        "fresh_hours":  30,   # daily-ish
    },
    {
        "name": "Politician Trades (FTM)",
        "dest_channel": "1504326222078021794",   # 🏛️-politician-trade-alerts
        "daemon":       "com.dwang.mst-follow-the-money",
        "fresh_hours":  48,
    },
    {
        "name": "Insider Buys (FTM)",
        "dest_channel": "1504326226175725730",   # 🔍-insider-buy-alerts
        "daemon":       "com.dwang.mst-follow-the-money",
        "fresh_hours":  48,
    },
    {
        "name": "Earnings This Week",
        "dest_channel": "1504221765163946026",   # 📊-earnings-this-week
        "daemon":       "com.dwang.stocks-calendar",
        "fresh_hours":  192,  # weekly cron (Sundays)
    },
    {
        "name": "Macro Events Calendar",
        "dest_channel": "1504221769576222861",   # 🌐-macro-events
        "daemon":       "com.dwang.stocks-calendar",
        "fresh_hours":  192,  # weekly cron
    },
    {
        "name": "Subscription Logs (Whop → Discord)",
        "dest_channel": "1504313308470054932",   # subscription-logs
        # No local daemon — Whop's outbound webhook delivers directly.
        "daemon":       None,
        "fresh_hours":  720,  # only fires when subs change, so generous
    },
    {
        "name": "MST Server Bot (roles, reactions)",
        "dest_channel": None,                    # bot doesn't post content
        "daemon":       "com.mst.bot",
        "fresh_hours":  None,
    },
]


# ── helpers ──────────────────────────────────────────────────────────────────

def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def parse_iso(ts: str) -> dt.datetime:
    # Discord timestamps look like "2026-05-15T14:09:39.123456+00:00"
    return dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))


def human_age(delta: dt.timedelta) -> str:
    secs = int(delta.total_seconds())
    if secs < 60:
        return f"{secs}s ago"
    if secs < 3600:
        return f"{secs // 60}m ago"
    if secs < 86400:
        return f"{secs // 3600}h{(secs % 3600) // 60:02d}m ago"
    days = secs // 86400
    hours = (secs % 86400) // 3600
    return f"{days}d{hours:02d}h ago"


def http_get_json(url: str, headers: dict | None = None, timeout: int = 15):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def http_post_json(url: str, body: dict, timeout: int = 15):
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "User-Agent": UA},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8")


# ── checks ───────────────────────────────────────────────────────────────────

def load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text())
    except Exception:
        return {}


def save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2))


def channel_activity(channel_id: str, since_message_id: str | None) -> dict:
    """Return {'latest_ts', 'latest_id', 'new_since_last': int}.

    If since_message_id is set, fetches up to 100 messages after that ID and
    counts them. If unset (first run for this channel), just grabs the latest
    message so we have a baseline for next time.
    """
    out = {"latest_ts": None, "latest_id": None, "new_since_last": None}

    if since_message_id:
        try:
            new_msgs = http_get_json(
                f"https://discord.com/api/v10/channels/{channel_id}/messages"
                f"?after={since_message_id}&limit=100",
                headers={"Authorization": f"Bot {BOT_TOKEN}", "User-Agent": UA},
            )
        except Exception as ex:
            print(f"  (after-fetch failed for {channel_id}: {ex})", file=sys.stderr)
            new_msgs = []

        if new_msgs and not isinstance(new_msgs, dict):
            # newest-first ordering
            out["new_since_last"] = len(new_msgs)
            out["latest_id"] = new_msgs[0]["id"]
            out["latest_ts"] = parse_iso(new_msgs[0]["timestamp"])
            return out
        # No new messages — fall through to fetch the latest so we still
        # report its age (even though we already know its ID).
        out["new_since_last"] = 0

    try:
        latest = http_get_json(
            f"https://discord.com/api/v10/channels/{channel_id}/messages?limit=1",
            headers={"Authorization": f"Bot {BOT_TOKEN}", "User-Agent": UA},
        )
    except Exception as ex:
        print(f"  (fetch failed for {channel_id}: {ex})", file=sys.stderr)
        return out
    if not latest or isinstance(latest, dict):
        return out
    m = latest[0] or {}
    out["latest_id"] = m.get("id")
    ts = m.get("timestamp")
    if ts:
        out["latest_ts"] = parse_iso(ts)
    return out


def daemon_state(label: str) -> dict:
    """Return {'loaded': bool, 'pid': str|None, 'last_exit': int|None}."""
    try:
        out = subprocess.check_output(["launchctl", "list"], text=True, stderr=subprocess.DEVNULL)
    except Exception as ex:
        return {"loaded": False, "pid": None, "last_exit": None, "error": str(ex)}
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) == 3 and parts[2] == label:
            pid = parts[0] if parts[0] != "-" else None
            try:
                last_exit = int(parts[1])
            except ValueError:
                last_exit = None
            return {"loaded": True, "pid": pid, "last_exit": last_exit}
    return {"loaded": False, "pid": None, "last_exit": None}


# ── verdict / formatting ─────────────────────────────────────────────────────

def feed_verdict(feed: dict, latest: dt.datetime | None, daemon: dict | None,
                 new_since_last: int | None) -> tuple[str, str]:
    """Return (status_emoji, reason)."""
    if daemon is not None and not daemon["loaded"]:
        return "🔴", "daemon not loaded"

    if feed.get("fresh_hours") is None:
        # Bot with no content channel — only daemon liveness matters.
        if daemon and daemon["last_exit"] not in (0, None):
            return "🟡", f"last exit code {daemon['last_exit']}"
        return "🟢", "daemon loaded"

    if latest is None:
        return "🔴", "no messages found in destination"

    age = now_utc() - latest
    fresh_window = dt.timedelta(hours=feed["fresh_hours"])
    new_note = ""
    if new_since_last is not None:
        new_note = f", +{new_since_last} new since last check" if new_since_last else ", no new since last check"

    if age > fresh_window * 2:
        return "🔴", f"last post {human_age(age)} (threshold {feed['fresh_hours']}h){new_note}"
    if age > fresh_window:
        return "🟡", f"last post {human_age(age)} (threshold {feed['fresh_hours']}h){new_note}"
    return "🟢", f"last post {human_age(age)}{new_note}"


def build_report() -> dict:
    """Run every check; return a structured snapshot."""
    rows = []
    daemons_seen: dict[str, dict] = {}
    state = load_state()
    next_state = dict(state)  # mutate a copy so partial failures don't corrupt

    for feed in FEEDS:
        daemon = None
        if feed.get("daemon"):
            label = feed["daemon"]
            daemons_seen.setdefault(label, daemon_state(label))
            daemon = daemons_seen[label]

        latest_ts = None
        new_since_last = None
        if feed.get("dest_channel"):
            ch_id = feed["dest_channel"]
            prev_id = (state.get(ch_id) or {}).get("last_seen_id")
            activity = channel_activity(ch_id, prev_id)
            latest_ts = activity["latest_ts"]
            new_since_last = activity["new_since_last"]
            if activity["latest_id"]:
                next_state[ch_id] = {
                    "last_seen_id": activity["latest_id"],
                    "last_check_at": now_utc().isoformat(),
                }

        emoji, reason = feed_verdict(feed, latest_ts, daemon, new_since_last)

        rows.append({
            "emoji": emoji,
            "name": feed["name"],
            "reason": reason,
            "new_since_last": new_since_last,
            "daemon": feed.get("daemon") or "—",
            "daemon_loaded": (daemon["loaded"] if daemon else True),
            "daemon_pid": (daemon["pid"] if daemon else None),
        })

    save_state(next_state)
    return {"rows": rows, "daemons": daemons_seen, "generated_at": now_utc().isoformat()}


def format_text(report: dict) -> str:
    lines = ["MST Bot Health — " + report["generated_at"][:19] + "Z", ""]
    width = max(len(r["name"]) for r in report["rows"])
    for r in report["rows"]:
        lines.append(f"  {r['emoji']} {r['name']:<{width}}  {r['reason']}")
    return "\n".join(lines)


def format_embed(report: dict) -> dict:
    """Single embed with one line per feed; color = worst-feed verdict."""
    colors = {"🟢": 0x2ECC71, "🟡": 0xF1C40F, "🔴": 0xE74C3C}
    worst = "🟢"
    for r in report["rows"]:
        if r["emoji"] == "🔴":
            worst = "🔴"
            break
        if r["emoji"] == "🟡" and worst != "🔴":
            worst = "🟡"

    lines = []
    for r in report["rows"]:
        lines.append(f"{r['emoji']} **{r['name']}** — {r['reason']}")
    description = "\n".join(lines)

    return {
        "title": f"{worst}  MST Bot Health",
        "description": description,
        "color": colors[worst],
        "footer": {"text": f"mst-bot-monitor • generated {report['generated_at'][:19]}Z"},
    }


# ── main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--post", action="store_true",
                   help="Post the report to MST_BOT_MONITOR_WEBHOOK_URL.")
    args = p.parse_args()

    report = build_report()
    print(format_text(report))

    if args.post:
        if not MONITOR_WEBHOOK:
            print("\n✗ MST_BOT_MONITOR_WEBHOOK_URL not set — cannot post", file=sys.stderr)
            return 1
        embed = format_embed(report)
        try:
            status, _ = http_post_json(MONITOR_WEBHOOK, {"embeds": [embed]})
            print(f"\n✓ posted to webhook (HTTP {status})")
        except urllib.error.HTTPError as ex:
            body = ex.read().decode("utf-8", errors="replace")[:300]
            print(f"\n✗ webhook post failed: HTTP {ex.code} {body}", file=sys.stderr)
            return 1
        except Exception as ex:
            print(f"\n✗ webhook post failed: {ex}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
