"""An in-process webhook receiver on 127.0.0.1 (server needs ZO_SSRF_ALLOW_LOOPBACK=true) with scripted replies per path."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


@dataclass(frozen=True)
class Delivery:
    at: float
    status: int
    body: bytes


class WebhookSink:
    """`respond(path, 500, then=200)` answers 500 once and 200 afterwards; `deliveries(path)` lists what arrived."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._queued: dict[str, deque[int]] = defaultdict(deque)
        self._then: dict[str, int] = {}
        self._seen: dict[str, list[Delivery]] = defaultdict(list)
        sink = self

        class _Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                status = sink._record(self.path.strip("/"), body)
                self.send_response(status)
                self.send_header("Content-Length", "0")
                self.end_headers()

            do_PUT = do_POST  # noqa: N815

            def log_message(self, *_args) -> None:
                pass

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self._server.server_address[1]}/{path}"

    def respond(self, path: str, *first: int, then: int = 200) -> None:
        with self._lock:
            self._queued[path] = deque(first)
            self._then[path] = then

    def deliveries(self, path: str) -> list[Delivery]:
        with self._lock:
            return list(self._seen[path])

    def close(self) -> None:
        self._server.shutdown()
        self._server.server_close()

    def _record(self, path: str, body: bytes) -> int:
        with self._lock:
            queued = self._queued[path]
            status = queued.popleft() if queued else self._then.get(path, 200)
            self._seen[path].append(Delivery(time.monotonic(), status, body))
            return status
