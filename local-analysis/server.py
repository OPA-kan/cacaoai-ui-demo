"""Local-only server for the CacaoAI Desktop: the dashboard pages and the field analysis.

One process on 127.0.0.1 serves the repository's static pages (open
http://127.0.0.1:8787/valencia-desktop/) and the analysis API
(GET /health, POST /analyze), so no second web server is needed.
"""

from __future__ import annotations

import argparse
import json
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
SITE_ROOT = HERE.parent  # cacaoai-ui-demo-public: valencia-desktop/, cacaoai-pwa/, ...
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
from pipeline import analyze_payload
from prices import fetch_international_cocoa
from weather import fetch_weather


class Handler(SimpleHTTPRequestHandler):
    server_version = "CacaoAI-Local-Analysis/1.0"

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._send(204, {})

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/health":
            self._send(200, {"status": "ok", "service": "cacaoai-local-analysis", "model_version": "field-pipeline-v2"})
        elif parsed.path == "/weather":
            try:
                result = fetch_weather(
                    float(_query_value(query, "latitude", "9.262")),
                    float(_query_value(query, "longitude", "123.218")),
                    _query_value(query, "start_date"),
                    _query_value(query, "end_date"),
                    _query_value(query, "timezone", "Asia/Manila"),
                )
                self._send(200, result)
            except Exception as error:
                self._send(502, {"status": "error", "message": str(error)})
        elif parsed.path == "/market-prices":
            try:
                self._send(200, fetch_international_cocoa(_query_value(query, "start_date"), _query_value(query, "end_date")))
            except Exception as error:
                self._send(502, {"status": "error", "message": str(error)})
        elif parsed.path in ("", "/"):
            self.send_response(302)
            self.send_header("Location", "/valencia-desktop/")
            self.end_headers()
        else:
            super().do_GET()  # static pages, confined to SITE_ROOT

    def do_POST(self) -> None:  # noqa: N802
        if urlparse(self.path).path != "/analyze":
            self._send(404, {"status": "error", "message": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            self._send(200, analyze_payload(payload))
        except Exception as error:  # field records should remain in Supabase if analysis fails
            self._send(500, {"status": "error", "message": str(error)})


def _query_value(query: dict[str, list[str]], key: str, default: str | None = None) -> str:
    value = (query.get(key) or [default])[0]
    if not value:
        raise ValueError(f"missing query parameter: {key}")
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(SITE_ROOT)))
    print(f"CacaoAI Desktop: http://{args.host}:{args.port}/valencia-desktop/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
