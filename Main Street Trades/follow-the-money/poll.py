#!/usr/bin/env python3
"""
Follow the Money — MST poller for insider buys + politician trades.

Fires every 60s via launchd. Each cycle:
  1. Polls SEC EDGAR Atom (Form 4) → posts open-market BUYS only to Discord.
  2. Every 5th cycle (≈5 min), polls Financial Modeling Prep for Senate +
     House disclosures → posts new rows to Discord.

Why split sources:
  - SEC EDGAR is the official source of truth, free forever, no API key.
  - The free politician-trade JSON dumps (house-stock-watcher etc.) all
    rotted by 2026. FMP's free tier (250 req/day) is the simplest live
    replacement; Daniel adds a free key once and politician feed lights up.

State files:
  ~/Library/Application Support/MainStreetTrades/follow-the-money/state/
    insider_seen.txt   one SEC accession per line
    house_seen.txt     one disclosure composite key per line
    senate_seen.txt    one disclosure composite key per line
    cycle.txt          monotonic counter, used to throttle politician polls

Env (see ../.env):
  FTM_INSIDER_WEBHOOK_URL       Discord webhook for insider-buy channel
  FTM_POLITICIAN_WEBHOOK_URL    Discord webhook for politician-trade channel
  FTM_SEC_USER_AGENT            Required by SEC ("Name email")
  FMP_API_KEY                   Optional. Without it, politician poll no-ops.
  FTM_DRY_RUN=1                 Print payloads instead of posting.
  FTM_STATE_DIR                 Override default state dir (testing).
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

STATE_DIR = Path(
    os.environ.get(
        "FTM_STATE_DIR",
        Path.home() / "Library/Application Support/MainStreetTrades/follow-the-money/state",
    )
)
STATE_DIR.mkdir(parents=True, exist_ok=True)

SEC_USER_AGENT = os.environ.get(
    "FTM_SEC_USER_AGENT",
    "Main Street Trades dan@cosmeticsgrowth.com",
)
WEBHOOK_UA = "MainStreetTrades-FollowTheMoney/1.0"

INSIDER_WEBHOOK = os.environ.get("FTM_INSIDER_WEBHOOK_URL", "").strip()
POLITICIAN_WEBHOOK = os.environ.get("FTM_POLITICIAN_WEBHOOK_URL", "").strip()
FMP_API_KEY = os.environ.get("FMP_API_KEY", "").strip()
DRY_RUN = bool(os.environ.get("FTM_DRY_RUN"))

POLITICIAN_EVERY_N_CYCLES = 15  # every 15 min — 2 endpoints × 96/day = 192/day, under FMP free 250 cap
MAX_POSTS_PER_RUN = 8  # safety cap to avoid spamming on backlog

TEAL = 0x1EA8BA
RED = 0xB22222
GRAY = 0x7A8A95

# Twemoji 72x72 — same glyph set Discord renders inline emojis with, so they
# match the channel-name prefixes visually. Used as embed author icon + thumbnail.
TWEMOJI = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72"
ICON_INSIDER = f"{TWEMOJI}/1f50d.png"     # 🔍 magnifier
ICON_POLITICIAN = f"{TWEMOJI}/1f3db.png"  # 🏛️ classical building


# ────────────────────────────────────────── http

def http_get(url: str, headers: dict[str, str] | None = None, timeout: int = 25) -> bytes:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def webhook_post(url: str, payload: dict) -> None:
    if DRY_RUN:
        print("DRY_RUN payload:", json.dumps(payload)[:400])
        return
    if not url:
        return
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": WEBHOOK_UA,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status >= 400:
                print(f"  webhook {resp.status}: {resp.read()[:200]!r}", file=sys.stderr)
    except urllib.error.HTTPError as e:
        # Surface webhook failures; never silently swallow (memory: feedback_discord_webhook_user_agent).
        try:
            detail = e.read()[:200]
        except Exception:
            detail = b""
        print(f"  webhook HTTP {e.code}: {detail!r}", file=sys.stderr)
    except Exception as e:
        print(f"  webhook post failed: {e}", file=sys.stderr)
    # Stay well under Discord's 5-msg/2s/channel rate limit.
    time.sleep(0.4)


# ────────────────────────────────────────── state

def load_seen(name: str) -> set[str]:
    p = STATE_DIR / name
    if not p.exists():
        return set()
    return {line.strip() for line in p.read_text(encoding="utf-8").splitlines() if line.strip()}


def append_seen(name: str, ids: list[str]) -> None:
    if not ids:
        return
    p = STATE_DIR / name
    with p.open("a", encoding="utf-8") as f:
        for i in ids:
            f.write(f"{i}\n")


def read_cycle() -> int:
    p = STATE_DIR / "cycle.txt"
    if not p.exists():
        return 0
    try:
        return int(p.read_text().strip() or "0")
    except ValueError:
        return 0


def write_cycle(n: int) -> None:
    (STATE_DIR / "cycle.txt").write_text(str(n))


# ────────────────────────────────────────── insider buys (SEC Form 4)

ATOM_NS = {"a": "http://www.w3.org/2005/Atom"}


def fetch_form4_feed() -> list[dict]:
    url = (
        "https://www.sec.gov/cgi-bin/browse-edgar"
        "?action=getcurrent&type=4&output=atom&count=100"
    )
    try:
        body = http_get(url, headers={"User-Agent": SEC_USER_AGENT, "Accept": "application/atom+xml"})
    except Exception as e:
        print(f"[insider] feed fetch failed: {e}", file=sys.stderr)
        return []

    try:
        root = ET.fromstring(body)
    except ET.ParseError as e:
        print(f"[insider] feed parse failed: {e}", file=sys.stderr)
        return []

    out: list[dict] = []
    for entry in root.findall("a:entry", ATOM_NS):
        title = (entry.findtext("a:title", default="", namespaces=ATOM_NS) or "").strip()
        link_el = entry.find("a:link", ATOM_NS)
        link = link_el.get("href") if link_el is not None else ""
        updated = (entry.findtext("a:updated", default="", namespaces=ATOM_NS) or "").strip()
        # Accession looks like 0001234567-26-000123; lives in the link path.
        m = re.search(r"/(\d{10}-\d{2}-\d{6})", link or "")
        accession = m.group(1) if m else (link or title)
        out.append(
            {
                "accession": accession,
                "title": title,
                "link": link,
                "updated": updated,
            }
        )
    return out


def fetch_form4_xml(filing_index_url: str) -> bytes | None:
    """Resolve and fetch the Form 4 XML doc for a filing index URL.

    The Atom feed links to an HTML index page; SEC exposes a directory listing
    at <dir>/index.json (NOT the accession-prefixed -index.json variant — that
    returns 404). We strip the trailing index file to get the directory, list
    it, then fetch the first .xml file (Form 4 filings have exactly one).
    """
    if not filing_index_url:
        return None

    # https://www.sec.gov/Archives/edgar/data/<cik>/<acc>/<acc>-index.htm
    #   → https://www.sec.gov/Archives/edgar/data/<cik>/<acc>/
    dir_url = filing_index_url.rsplit("/", 1)[0]
    listing_url = f"{dir_url}/index.json"

    try:
        body = http_get(listing_url, headers={"User-Agent": SEC_USER_AGENT})
        index = json.loads(body)
    except Exception as e:
        print(f"  [insider] index listing failed ({listing_url}): {e}", file=sys.stderr)
        return None

    directory = index.get("directory") or {}
    items = directory.get("item") or []

    # Files are listed relative to directory.name (an absolute path like
    # /Archives/edgar/data/<cik>/<acc>). Pick the first .xml — Form 4 filings
    # have one ownership XML doc; filenames vary (ownership.xml, doc4.xml,
    # primary_doc.xml, edgardoc1.xml, wf-form4_*.xml).
    xml_names = [
        it.get("name", "") for it in items if (it.get("name") or "").lower().endswith(".xml")
    ]
    if not xml_names:
        return None

    # Heuristic ranking when there are multiple XMLs (rare).
    xml_names.sort(
        key=lambda n: (
            0 if "primary" in n.lower() else 1,
            0 if "ownership" in n.lower() else 1,
            0 if n.lower().startswith("doc") else 1,
            len(n),
        )
    )
    primary = xml_names[0]
    base_path = (directory.get("name") or "").strip("/")
    doc_url = f"https://www.sec.gov/{base_path}/{primary}"

    try:
        return http_get(doc_url, headers={"User-Agent": SEC_USER_AGENT})
    except Exception as e:
        print(f"  [insider] xml fetch failed ({doc_url}): {e}", file=sys.stderr)
        return None


def parse_form4(xml_bytes: bytes) -> dict | None:
    """Return dict for posting if there's at least one open-market BUY (code P)."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return None

    def text(path: str, parent=root) -> str:
        n = parent.find(path)
        return (n.text or "").strip() if (n is not None and n.text) else ""

    issuer_name = text(".//issuer/issuerName")
    issuer_ticker = text(".//issuer/issuerTradingSymbol")
    reporter = text(".//reportingOwner/reportingOwnerId/rptOwnerName")
    is_officer = text(".//reportingOwner/reportingOwnerRelationship/isOfficer") in ("1", "true", "True")
    is_director = text(".//reportingOwner/reportingOwnerRelationship/isDirector") in ("1", "true", "True")
    is_10pct = text(".//reportingOwner/reportingOwnerRelationship/isTenPercentOwner") in ("1", "true", "True")
    officer_title = text(".//reportingOwner/reportingOwnerRelationship/officerTitle")

    buys: list[dict] = []
    for tx in root.findall(".//nonDerivativeTransaction"):
        code = (tx.findtext(".//transactionCoding/transactionCode") or "").strip()
        # P = open-market purchase. Skip everything else — option exercises, gifts,
        # automatic plans (S/M/F/G/J), grants (A), tax withholds (F) all add noise.
        if code != "P":
            continue
        shares_raw = tx.findtext(".//transactionAmounts/transactionShares/value") or ""
        price_raw = tx.findtext(".//transactionAmounts/transactionPricePerShare/value") or ""
        tx_date = tx.findtext(".//transactionDate/value") or ""
        try:
            shares = float(shares_raw)
        except (TypeError, ValueError):
            shares = 0.0
        try:
            price = float(price_raw)
        except (TypeError, ValueError):
            price = 0.0
        buys.append(
            {
                "shares": shares,
                "price": price,
                "value": shares * price,
                "date": tx_date,
            }
        )

    if not buys:
        return None

    roles: list[str] = []
    if is_officer:
        roles.append(officer_title or "Officer")
    if is_director:
        roles.append("Director")
    if is_10pct:
        roles.append("10% Owner")

    return {
        "issuer_name": issuer_name,
        "issuer_ticker": issuer_ticker,
        "reporter": reporter,
        "role": ", ".join(roles) or "Insider",
        "buys": buys,
    }


def post_insider_buy(filing: dict, parsed: dict) -> None:
    total_value = sum(b["value"] for b in parsed["buys"])
    total_shares = sum(b["shares"] for b in parsed["buys"])
    avg_price = (total_value / total_shares) if total_shares else 0.0
    tx_date = parsed["buys"][0]["date"]

    ticker = parsed["issuer_ticker"] or "—"
    issuer = parsed["issuer_name"] or ""
    reporter = parsed["reporter"] or "Insider"
    role = parsed["role"]

    # Layout mirrors Tradytics UOV: small author label + icon, bold one-line
    # headline as description, 3-up inline fields, big thumbnail, source footer.
    embed = {
        "author": {
            "name": "Form 4 · Insider Buy",
            "icon_url": ICON_INSIDER,
        },
        "description": f"**Open-Market Purchase**\n_{issuer}_" if issuer else "**Open-Market Purchase**",
        "color": TEAL,
        "thumbnail": {"url": ICON_INSIDER},
        "fields": [
            {"name": "Symbol",    "value": ticker,                  "inline": True},
            {"name": "Total",     "value": f"${total_value:,.0f}",  "inline": True},
            {"name": "Avg Price", "value": f"${avg_price:,.2f}",    "inline": True},
            {"name": "Insider",   "value": reporter[:40],           "inline": True},
            {"name": "Role",      "value": role,                    "inline": True},
            {"name": "Tx Date",   "value": tx_date or "—",          "inline": True},
        ],
        "footer": {"text": "Source: SEC EDGAR · Form 4 code P"},
        "url": filing.get("link") or "",
    }
    if filing.get("updated"):
        embed["timestamp"] = filing["updated"]

    webhook_post(
        INSIDER_WEBHOOK,
        {"username": "SEC Insider Buys", "embeds": [embed]},
    )


def trade_key(parsed: dict) -> str:
    """Trade-level dedup key. One transaction frequently generates multiple
    Form 4s (one per nested fund entity); we want one post per trade.
    Composite: ticker + transaction_date + total_shares + price-per-share."""
    total_shares = sum(b["shares"] for b in parsed["buys"])
    total_value = sum(b["value"] for b in parsed["buys"])
    avg_price = (total_value / total_shares) if total_shares else 0.0
    date = parsed["buys"][0]["date"]
    ticker = (parsed.get("issuer_ticker") or "").upper().strip() or "—"
    return f"{ticker}|{date}|{total_shares:.4f}|{avg_price:.4f}"


def run_insider_buys() -> None:
    if not INSIDER_WEBHOOK and not DRY_RUN:
        print("[insider] no FTM_INSIDER_WEBHOOK_URL — skipping")
        return

    filing_seen = load_seen("insider_seen.txt")
    trade_seen = load_seen("insider_trades_seen.txt")
    feed = fetch_form4_feed()
    new_filings = [f for f in feed if f["accession"] not in filing_seen]
    print(f"[insider] feed={len(feed)} new_filings={len(new_filings)} trades_seen={len(trade_seen)}")

    is_first_run = not (STATE_DIR / "insider_seen.txt").exists()
    if is_first_run:
        # Don't dump 100+ historical filings on first run; just record state.
        append_seen("insider_seen.txt", [f["accession"] for f in feed])
        print(f"[insider] first run — recorded {len(feed)} accessions, posted 0")
        return

    posted = 0
    accessions_to_mark: list[str] = []
    trades_to_mark: list[str] = []
    # Oldest-first reads chronologically in chat.
    for filing in reversed(new_filings):
        if posted >= MAX_POSTS_PER_RUN:
            print("[insider] hit MAX_POSTS_PER_RUN — deferring rest to next cycle")
            break
        accession = filing["accession"]
        xml_bytes = fetch_form4_xml(filing["link"])
        if xml_bytes is None:
            # Mark seen — don't keep retrying a broken filing forever.
            accessions_to_mark.append(accession)
            continue
        parsed = parse_form4(xml_bytes)
        if parsed is None:
            # No P-code transaction in this Form 4 — not a buy.
            accessions_to_mark.append(accession)
            continue
        tk = trade_key(parsed)
        if tk in trade_seen:
            # Same trade reported by a different fund entity — skip post but
            # mark the filing seen so we don't re-fetch its XML.
            accessions_to_mark.append(accession)
            continue
        post_insider_buy(filing, parsed)
        accessions_to_mark.append(accession)
        trades_to_mark.append(tk)
        trade_seen.add(tk)  # in-memory so subsequent filings this cycle dedup correctly
        posted += 1
        # SEC asks for ≤10 req/s. We're well under but spaced anyway.
        time.sleep(0.15)

    append_seen("insider_seen.txt", accessions_to_mark)
    append_seen("insider_trades_seen.txt", trades_to_mark)
    print(f"[insider] posted={posted} accessions_marked={len(accessions_to_mark)} trades_marked={len(trades_to_mark)}")


# ────────────────────────────────────────── politician trades (FMP)

def fetch_fmp(endpoint: str) -> list[dict]:
    if not FMP_API_KEY:
        return []
    # FMP migrated to /stable/ in 2025; the legacy /api/v4/*-rss-feed endpoints
    # were retired Aug 31 2025 and now 403 with a "Legacy Endpoint" message.
    url = f"https://financialmodelingprep.com/stable/{endpoint}?apikey={FMP_API_KEY}"
    try:
        body = http_get(url, headers={"User-Agent": WEBHOOK_UA})
        data = json.loads(body)
    except Exception as e:
        print(f"[politician] FMP fetch failed ({endpoint}): {e}", file=sys.stderr)
        return []
    if not isinstance(data, list):
        # FMP returns {"Error Message": "..."} on auth/quota/scope failures.
        print(f"[politician] FMP non-list response ({endpoint}): {str(data)[:200]}", file=sys.stderr)
        return []
    return data


def politician_key(row: dict) -> str:
    """Stable composite key for dedup — FMP rows lack a single unique ID.

    Schema (FMP /stable/senate-latest + /stable/house-latest, 2026):
      symbol, disclosureDate, transactionDate, firstName, lastName, office,
      district, owner, assetDescription, assetType, type, amount, comment, link
    """
    parts = [
        row.get("firstName") or "",
        row.get("lastName") or "",
        row.get("symbol") or row.get("assetDescription") or "",
        row.get("transactionDate") or "",
        row.get("type") or "",
        row.get("amount") or "",
        row.get("owner") or "",
    ]
    return "|".join(str(p) for p in parts)


def fmt_amount(amount: str | None) -> str:
    if not amount:
        return "—"
    # FMP returns ranges like "$1,001 - $15,000" — keep as-is.
    return str(amount).strip()


def post_politician(row: dict, chamber: str) -> None:
    first = (row.get("firstName") or "").strip()
    last = (row.get("lastName") or "").strip()
    name = f"{first} {last}".strip() or "—"
    district = (row.get("district") or "").strip()
    title_prefix = "Sen." if chamber == "Senate" else "Rep."

    ticker = (row.get("symbol") or "").strip().upper() or "—"
    asset_desc = row.get("assetDescription") or ""
    tx_type = (row.get("type") or "").strip()
    amount = fmt_amount(row.get("amount"))
    tx_date = row.get("transactionDate") or ""
    disc_date = row.get("disclosureDate") or ""
    owner = (row.get("owner") or "").strip() or "Self"
    link = row.get("link") or ""

    t = tx_type.lower()
    if "purchase" in t:
        emoji, verb, color = "🟢", "BOUGHT", TEAL
    elif "sale" in t or "sold" in t:
        emoji, verb, color = "🔴", "SOLD", RED
    elif "exchange" in t:
        emoji, verb, color = "🔄", "EXCHANGED", GRAY
    else:
        emoji, verb, color = "⚪", (tx_type.upper() or "TRANSACTED"), GRAY

    # "FL19" → "FL-19" for readability; Senate's district is just state code.
    district_fmt = district
    if chamber == "House" and len(district) > 2 and district[2:].isdigit():
        district_fmt = f"{district[:2]}-{district[2:]}"

    headline = f"{emoji} **{verb}** ${ticker}" if ticker != "—" else f"{emoji} **{verb}**"
    description = headline
    if asset_desc:
        description += f"\n_{asset_desc}_"

    embed = {
        "author": {
            "name": f"{chamber} Disclosure · STOCK Act",
            "icon_url": ICON_POLITICIAN,
        },
        "description": description,
        "color": color,
        "thumbnail": {"url": ICON_POLITICIAN},
        "fields": [
            {"name": "Symbol",   "value": ticker,                              "inline": True},
            {"name": "Amount",   "value": amount,                              "inline": True},
            {"name": "Owner",    "value": owner,                               "inline": True},
            {"name": title_prefix.rstrip("."),  "value": name,                 "inline": True},
            {"name": "District", "value": district_fmt or "—",                 "inline": True},
            {"name": "Tx Date",  "value": tx_date or "—",                      "inline": True},
        ],
        "footer": {"text": f"Source: FMP · {chamber} · disclosed {disc_date}" if disc_date else f"Source: FMP · {chamber}"},
    }
    if link:
        embed["url"] = link

    webhook_post(
        POLITICIAN_WEBHOOK,
        {"username": f"{chamber} Trades", "embeds": [embed]},
    )


def run_politician_one(chamber: str, endpoint: str, state_file: str) -> None:
    rows = fetch_fmp(endpoint)
    if not rows:
        print(f"[{chamber.lower()}] no data (or no API key)")
        return

    seen = load_seen(state_file)
    new_rows = [r for r in rows if politician_key(r) not in seen]

    is_first_run = not (STATE_DIR / state_file).exists()
    print(f"[{chamber.lower()}] rows={len(rows)} new={len(new_rows)} first_run={is_first_run}")

    if is_first_run:
        append_seen(state_file, [politician_key(r) for r in rows])
        print(f"[{chamber.lower()}] first run — recorded {len(rows)} rows, posted 0")
        return

    posted = 0
    to_mark: list[str] = []
    # FMP returns newest-first; reverse so chat reads oldest-to-newest.
    for row in reversed(new_rows):
        if posted >= MAX_POSTS_PER_RUN:
            print(f"[{chamber.lower()}] hit MAX_POSTS_PER_RUN — deferring rest")
            break
        post_politician(row, chamber)
        to_mark.append(politician_key(row))
        posted += 1

    append_seen(state_file, to_mark)
    print(f"[{chamber.lower()}] posted={posted}")


def run_politician() -> None:
    if not POLITICIAN_WEBHOOK and not DRY_RUN:
        print("[politician] no FTM_POLITICIAN_WEBHOOK_URL — skipping")
        return
    if not FMP_API_KEY:
        print("[politician] no FMP_API_KEY — get a free key at "
              "https://site.financialmodelingprep.com/developer and add to .env")
        return
    run_politician_one("Senate", "senate-latest", "senate_seen.txt")
    run_politician_one("House", "house-latest", "house_seen.txt")


# ────────────────────────────────────────── main

def main() -> int:
    cycle = read_cycle() + 1
    write_cycle(cycle)
    start = time.time()
    print(f"━━ cycle {cycle} @ {datetime.now(timezone.utc).isoformat(timespec='seconds')}")

    try:
        run_insider_buys()
    except Exception as e:
        print(f"[insider] cycle failed: {e}", file=sys.stderr)

    if cycle % POLITICIAN_EVERY_N_CYCLES == 0:
        try:
            run_politician()
        except Exception as e:
            print(f"[politician] cycle failed: {e}", file=sys.stderr)

    print(f"━━ done in {time.time() - start:.1f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
