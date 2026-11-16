"""International cocoa benchmark adapter.

FRED exposes the IMF monthly global cocoa benchmark as PCOCOUSDM. Local
farmgate/market observations remain first-party records in Supabase.

The series is monthly, so the last good download is kept on disk and served
when FRED is slow or unreachable (marked ``stale``), instead of making the
dashboard wait for a timeout on every start.
"""

from __future__ import annotations

import csv
import io
import json
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SERIES_ID = "PCOCOUSDM"
_CACHE: dict[tuple, tuple[float, dict]] = {}
_CACHE_SECONDS = 12 * 3600
_TIMEOUT_SECONDS = 6
_DISK_CACHE = Path(__file__).resolve().parent / ".cache" / "fred_pcocousdm.json"


def _download(start_date: str, end_date: str) -> list[dict]:
    params = urlencode({"id": SERIES_ID, "cosd": start_date, "coed": end_date})
    # No custom User-Agent: FRED stalls some self-named clients until the read times out,
    # while the standard urllib client is answered at once (checked 2026-11-16).
    request = Request(f"https://fred.stlouisfed.org/graph/fredgraph.csv?{params}")
    with urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
        text = response.read().decode("utf-8")
    rows = []
    for row in csv.DictReader(io.StringIO(text)):
        value = row.get(SERIES_ID)
        observed = row.get("observation_date") or row.get("DATE")
        if not value or value == "." or not observed:
            continue
        rows.append({"date": observed, "value": float(value), "currency": "USD", "unit": "metric_ton"})
    return rows


def _read_disk() -> dict:
    try:
        return json.loads(_DISK_CACHE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write_disk(rows: list[dict]) -> None:
    try:
        _DISK_CACHE.parent.mkdir(parents=True, exist_ok=True)
        ignore = _DISK_CACHE.parent / ".gitignore"
        if not ignore.exists():
            ignore.write_text("*\n", encoding="utf-8")
        merged = {row["date"]: row for row in _read_disk().get("series", [])}
        merged.update({row["date"]: row for row in rows})
        _DISK_CACHE.write_text(json.dumps({"saved_at": time.time(), "series": sorted(merged.values(), key=lambda r: r["date"])}),
                               encoding="utf-8")
    except OSError:
        pass  # the cache is only a convenience


def fetch_international_cocoa(start_date: str, end_date: str) -> dict:
    key = (start_date, end_date)
    cached = _CACHE.get(key)
    if cached and time.time() - cached[0] < _CACHE_SECONDS:
        return cached[1]
    result = {
        "provider": "FRED / IMF Primary Commodity Prices",
        "series_id": SERIES_ID,
        "source": "https://fred.stlouisfed.org/series/PCOCOUSDM",
        "start_date": start_date,
        "end_date": end_date,
    }
    try:
        rows = _download(start_date, end_date)
    except Exception as error:  # network trouble: fall back to the last saved series
        disk = _read_disk()
        rows = [r for r in disk.get("series", []) if (not start_date or r["date"] >= start_date) and (not end_date or r["date"] <= end_date)]
        if not rows:
            raise
        result.update(status="stale", series=rows, error=str(error),
                      saved_at=time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(disk.get("saved_at", 0))))
        return result  # not cached in memory, so the next request tries FRED again
    _write_disk(rows)
    result.update(status="ok", series=rows)
    _CACHE[key] = (time.time(), result)
    return result
