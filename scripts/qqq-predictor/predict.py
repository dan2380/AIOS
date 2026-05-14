#!/usr/bin/env python3
"""QQQ 30-minutes-after-open directional predictor.

Pulls free pre-market data and emits a single directional call (UP/DOWN/NEUTRAL)
with confidence (LOW/MED/HIGH) and the drivers behind the call.

Data sources (all free):
  - yfinance: NQ=F, QQQ, ^VIX, ^N225, ^GDAXI, ^FTSE
  - Finnhub free tier (optional): news headlines for sentiment tilt

Run at ~09:25 ET on US trading days. Posts to a Discord webhook if
DISCORD_QQQ_WEBHOOK_URL is set, otherwise prints to stdout.

Env vars:
  DISCORD_QQQ_WEBHOOK_URL   Optional. Discord webhook URL.
  FINNHUB_API_KEY           Optional. Free tier key for news tilt.
"""

from __future__ import annotations

import json
import logging
import math
import os
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone, timedelta
from typing import Optional
from urllib import request as urlrequest
from urllib.error import URLError, HTTPError

try:
    import yfinance as yf
except ImportError:
    sys.stderr.write(
        "yfinance not installed. Run: pip install -r requirements.txt\n"
    )
    sys.exit(1)


DISCORD_USER_AGENT = "CosmeticsGrowth-QQQ-Predictor/1.0 (+https://cosmeticsgrowth.com)"
FINNHUB_BASE = "https://finnhub.io/api/v1"
YF_TIMEOUT = 8  # seconds, applied to each yfinance HTTP call

YF_EXC = (ValueError, KeyError, AttributeError, OSError, IndexError, TypeError)

logging.basicConfig(
    stream=sys.stdout,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("qqq-predictor")


@dataclass(frozen=True)
class MarketSnapshot:
    asof_utc: str
    qqq_prev_close: Optional[float]
    qqq_pre: Optional[float]
    qqq_gap_pct: Optional[float]
    nq_prev_close: Optional[float]
    nq_now: Optional[float]
    nq_gap_pct: Optional[float]
    vix: Optional[float]
    nikkei_pct: Optional[float]
    dax_pct: Optional[float]
    ftse_pct: Optional[float]
    news_tilt: Optional[float]


@dataclass(frozen=True)
class Prediction:
    direction: str
    confidence: str
    score: float
    drivers: tuple[str, ...]
    downside_scenario: str


def _is_finite_num(x: Optional[float]) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)


def _safe_pct(curr: Optional[float], prev: Optional[float]) -> Optional[float]:
    if not (_is_finite_num(curr) and _is_finite_num(prev)) or prev == 0:
        return None
    return (curr - prev) / prev * 100.0


def _previous_close(ticker: str) -> Optional[float]:
    """Authoritative previous regular-session close via yfinance fast_info."""
    try:
        info = yf.Ticker(ticker).fast_info
        val = info.get("previousClose") if hasattr(info, "get") else info.previous_close
        return float(val) if _is_finite_num(val) else None
    except YF_EXC as exc:
        log.warning("%s fast_info previousClose failed: %s", ticker, exc)
        return None


def _fast_quote(ticker: str) -> Optional[float]:
    """Best-effort current price via 1m intraday including pre/post-market."""
    try:
        hist = yf.Ticker(ticker).history(
            period="1d", interval="1m", prepost=True, timeout=YF_TIMEOUT
        )
        if hist.empty:
            return None
        latest = hist["Close"].dropna()
        if latest.empty:
            return None
        val = float(latest.iloc[-1])
        return val if math.isfinite(val) else None
    except YF_EXC as exc:
        log.warning("%s intraday failed: %s", ticker, exc)
        return None


def _pct_today(ticker: str) -> Optional[float]:
    """Latest daily-bar percent change vs the immediately prior close."""
    try:
        hist = yf.Ticker(ticker).history(
            period="5d", interval="1d", auto_adjust=False, timeout=YF_TIMEOUT
        )
        if hist.empty or len(hist) < 2:
            return None
        closes = hist["Close"].dropna()
        if len(closes) < 2:
            return None
        return _safe_pct(float(closes.iloc[-1]), float(closes.iloc[-2]))
    except YF_EXC as exc:
        log.warning("%s history failed: %s", ticker, exc)
        return None


def _news_tilt(api_key: Optional[str]) -> Optional[float]:
    """Headline keyword tilt in [-1, +1] from Finnhub free tier."""
    if not api_key:
        return None
    try:
        today = datetime.now(timezone.utc).date()
        frm = (today - timedelta(days=1)).isoformat()
        to = today.isoformat()
        url = f"{FINNHUB_BASE}/company-news?symbol=QQQ&from={frm}&to={to}"
        req = urlrequest.Request(
            url,
            headers={
                "User-Agent": DISCORD_USER_AGENT,
                "X-Finnhub-Token": api_key,
            },
        )
        with urlrequest.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if not isinstance(data, list) or not data:
            return 0.0
        bullish = {"beats", "surge", "rally", "record", "upgrade", "strong", "gains"}
        bearish = {"miss", "plunge", "selloff", "downgrade", "weak", "fears", "cut"}
        raw = 0
        count = 0
        for item in data[:30]:
            headline = str(item.get("headline", "")).lower()
            if not headline:
                continue
            count += 1
            raw += sum(w in headline for w in bullish)
            raw -= sum(w in headline for w in bearish)
        if count == 0:
            return 0.0
        return max(-1.0, min(1.0, raw / count))
    except (URLError, HTTPError, ValueError, KeyError, TimeoutError) as exc:
        log.warning("finnhub news failed: %s", exc)
        return None


def snapshot() -> MarketSnapshot:
    qqq_pre = _fast_quote("QQQ")
    qqq_prev = _previous_close("QQQ")
    qqq_gap = _safe_pct(qqq_pre, qqq_prev)

    nq_now = _fast_quote("NQ=F")
    nq_prev = _previous_close("NQ=F")
    nq_gap = _safe_pct(nq_now, nq_prev)

    vix_quote = _fast_quote("^VIX")
    vix_now = vix_quote if vix_quote is not None else _previous_close("^VIX")

    return MarketSnapshot(
        asof_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        qqq_prev_close=qqq_prev,
        qqq_pre=qqq_pre,
        qqq_gap_pct=qqq_gap,
        nq_prev_close=nq_prev,
        nq_now=nq_now,
        nq_gap_pct=nq_gap,
        vix=vix_now,
        nikkei_pct=_pct_today("^N225"),
        dax_pct=_pct_today("^GDAXI"),
        ftse_pct=_pct_today("^FTSE"),
        news_tilt=_news_tilt(os.environ.get("FINNHUB_API_KEY")),
    )


def predict(snap: MarketSnapshot) -> Prediction:
    """Transparent score-based call. Gap continuation + VIX regime + overnight tape."""
    drivers: list[str] = []
    score = 0.0

    gap = snap.nq_gap_pct if snap.nq_gap_pct is not None else snap.qqq_gap_pct
    if gap is not None:
        score += gap * 1.2
        drivers.append(f"NQ/QQQ gap {gap:+.2f}%")

    for label, val in (("Nikkei", snap.nikkei_pct), ("DAX", snap.dax_pct), ("FTSE", snap.ftse_pct)):
        if val is None:
            continue
        score += val * 0.25
        drivers.append(f"{label} {val:+.2f}%")

    if snap.news_tilt is not None and snap.news_tilt != 0.0:
        score += snap.news_tilt * 0.3
        drivers.append(f"News tilt {snap.news_tilt:+.2f}")

    # VIX regime applied last so it modulates the composite, not just the gap.
    if snap.vix is not None:
        if snap.vix >= 22 and gap is not None and gap != 0:
            score -= 0.4 * (gap / abs(gap))
            drivers.append(f"VIX {snap.vix:.1f} → fade tilt")
        elif snap.vix <= 16:
            score *= 1.15
            drivers.append(f"VIX {snap.vix:.1f} → continuation tilt")
        else:
            drivers.append(f"VIX {snap.vix:.1f} neutral")

    abs_score = abs(score)
    if score == 0 or not drivers:
        direction = "NEUTRAL"
        confidence = "LOW"
    else:
        direction = "UP" if score > 0 else "DOWN"
        if abs_score >= 0.7:
            confidence = "HIGH"
        elif abs_score >= 0.25:
            confidence = "MED"
        else:
            confidence = "LOW"

    if direction == "UP":
        downside = "Hawkish Fed headline or weak US data print between 09:30–10:00 ET flips the call."
    elif direction == "DOWN":
        downside = "Dovish surprise or short squeeze on benign data between 09:30–10:00 ET flips the call."
    else:
        downside = "Signals cancel out — wait for the open."

    return Prediction(
        direction=direction,
        confidence=confidence,
        score=round(score, 3),
        drivers=tuple(drivers),
        downside_scenario=downside,
    )


def format_message(snap: MarketSnapshot, pred: Prediction) -> str:
    lines = [
        f"**QQQ 10:00 ET call — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}**",
        f"**{pred.direction}** · confidence **{pred.confidence}** · score `{pred.score:+.2f}`",
        "",
        "**Drivers**",
    ]
    lines.extend(f"• {d}" for d in pred.drivers) if pred.drivers else lines.append("• (no signals available)")
    lines.append("")
    lines.append(f"**Downside scenario:** {pred.downside_scenario}")
    return "\n".join(lines)


def post_discord(webhook: str, content: str) -> None:
    """Post to Discord. urlopen raises HTTPError on 4xx/5xx — let it propagate."""
    payload = json.dumps({"content": content}).encode("utf-8")
    req = urlrequest.Request(
        webhook,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": DISCORD_USER_AGENT,
        },
    )
    with urlrequest.urlopen(req, timeout=10) as resp:
        resp.read()  # drain


def main() -> int:
    snap = snapshot()
    pred = predict(snap)
    msg = format_message(snap, pred)

    print(msg)
    print()
    print("--- snapshot ---")
    print(json.dumps(asdict(snap), indent=2))

    webhook = os.environ.get("DISCORD_QQQ_WEBHOOK_URL")
    if webhook:
        try:
            post_discord(webhook, msg)
            log.info("posted to Discord")
        except (URLError, HTTPError, TimeoutError, OSError) as exc:
            log.error("Discord post failed: %s", exc)
            return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
