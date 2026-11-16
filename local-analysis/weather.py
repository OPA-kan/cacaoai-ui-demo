"""Small Open-Meteo adapter used by the local Valencia Desktop server."""

from __future__ import annotations

import json
import time
from datetime import date
from urllib.parse import urlencode
from urllib.request import Request, urlopen


DAILY_VARIABLES = [
    "temperature_2m_mean",
    "temperature_2m_max",
    "temperature_2m_min",
    "relative_humidity_2m_mean",
    "precipitation_sum",
    "precipitation_hours",
    "wind_speed_10m_max",
    "soil_moisture_0_to_7cm_mean",
]
_CACHE: dict[tuple, tuple[float, dict]] = {}
_CACHE_SECONDS = 1800


def _request(base_url: str, params: dict) -> dict:
    query = urlencode(params)
    request = Request(f"{base_url}?{query}", headers={"User-Agent": "CacaoAI-Valencia/1.0"})
    with urlopen(request, timeout=12) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_weather(latitude: float, longitude: float, start_date: str, end_date: str,
                  timezone: str = "Asia/Manila") -> dict:
    key = (round(float(latitude), 5), round(float(longitude), 5), start_date, end_date, timezone)
    cached = _CACHE.get(key)
    if cached and time.time() - cached[0] < _CACHE_SECONDS:
        return cached[1]
    # Archive is preferred for completed farm scans. Forecast is used for a range
    # that includes today or a future date, where the archive may not be available.
    today = date.today().isoformat()
    base_urls = [
        "https://archive-api.open-meteo.com/v1/archive" if end_date <= today else "https://api.open-meteo.com/v1/forecast",
    ]
    if base_urls[0].endswith("archive"):
        base_urls.append("https://api.open-meteo.com/v1/forecast")
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "start_date": start_date,
        "end_date": end_date,
        "daily": ",".join(DAILY_VARIABLES),
        "timezone": timezone,
    }
    errors = []
    for base_url in base_urls:
        try:
            payload = _request(base_url, params)
            daily = payload.get("daily") or {}
            dates = daily.get("time") or []
            rows = []
            for index, day in enumerate(dates):
                rows.append({
                    "date": day,
                    "temperature_mean_c": _value(daily, "temperature_2m_mean", index),
                    "temperature_max_c": _value(daily, "temperature_2m_max", index),
                    "temperature_min_c": _value(daily, "temperature_2m_min", index),
                    "humidity_mean_pct": _value(daily, "relative_humidity_2m_mean", index),
                    "precipitation_mm": _value(daily, "precipitation_sum", index),
                    "precipitation_hours": _value(daily, "precipitation_hours", index),
                    "wind_max_kmh": _value(daily, "wind_speed_10m_max", index),
                    "soil_moisture_0_7cm": _value(daily, "soil_moisture_0_to_7cm_mean", index),
                })
            result = {
                "status": "ok",
                "provider": "Open-Meteo",
                "source": base_url,
                "latitude": payload.get("latitude", latitude),
                "longitude": payload.get("longitude", longitude),
                "timezone": payload.get("timezone", timezone),
                "start_date": start_date,
                "end_date": end_date,
                "daily": rows,
                "summary": _summary(rows),
            }
            _CACHE[key] = (time.time(), result)
            return result
        except Exception as error:  # try the forecast endpoint after archive gaps
            errors.append(str(error))
    raise RuntimeError(f"Open-Meteo request failed: {'; '.join(errors)}")


def _value(daily: dict, key: str, index: int):
    values = daily.get(key) or []
    return values[index] if index < len(values) else None


def _summary(rows: list[dict]) -> dict:
    def numbers(key: str) -> list[float]:
        return [float(row[key]) for row in rows if row.get(key) is not None]

    rain = numbers("precipitation_mm")
    humidity = numbers("humidity_mean_pct")
    temperature = numbers("temperature_mean_c")
    return {
        "total_precipitation_mm": round(sum(rain), 1),
        "rainy_days": sum(1 for value in rain if value >= 1.0),
        "average_humidity_pct": round(sum(humidity) / len(humidity), 1) if humidity else None,
        "average_temperature_c": round(sum(temperature) / len(temperature), 1) if temperature else None,
        "max_precipitation_day_mm": round(max(rain), 1) if rain else None,
    }
