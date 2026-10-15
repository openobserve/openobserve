"""o2-ai mock for the Slack bridge tests (spec section 3.3, AC-10.3, AC-10.9, AC-10.14).

OpenObserve reaches it through ``O2_AI_ENABLED=true O2_AGENT_URL=http://127.0.0.1:<port>``. It replays
o2-ai SSE frames recorded from o2-ai's own event conversion (``o2ai_frames.json``: a SearchSQL turn
whose ``complete`` frame carries A3's ``chart_series``, ``is_partial``, ``searched_range`` and
``confidence``; a partial turn; a plain turn; and o2-ai's in-band error frames), and records every
request it receives, headers (``Authorization`` included) and JSON body (``context.currentPage``,
``confirm_timeout_secs``, the fork seed, feedback ``comment``).

Run it standalone::

    python3 tests/api-testing/helpers/o2ai_mock.py --port 5498

Control endpoints (JSON):

- ``GET  /_mock/health``        liveness
- ``GET  /_mock/requests``      every recorded request: method, path, headers, body, at
- ``POST /_mock/reset``         forget requests and scripts; the default turn is ``chart`` again
- ``POST /_mock/script``        queue answers for the next streamed turns, one per turn, in order:
  ``{"responses": [{"error": "session_not_found" | "turn_in_progress" | "session_owner_unavailable"},
  {"in_band": "restore_required" | "stale_epoch" | "turn_in_progress"}, {"turn": "partial"},
  {"status": 503, "body": {...}}, {"confirm": "cli" | "o2_delete" | "permission", "wait_secs"?: 30}]}``;
  ``{"default_turn": "plain"}`` changes the turn served when the queue is empty; ``"hold_secs"`` on a
  turn keeps its stream open before ``complete``. A ``confirm`` turn streams o2-ai's own
  ``confirmation_required`` frame (``o2ai_confirmations.json``), waits for ``POST /confirm/<session>``
  (or ``wait_secs``), then the ``plain`` turn. An answer with ``"match": "<text>"`` is only served to a
  turn whose question contains that text, so other tests' background turns never take it
- ``GET  /_mock/frames``        the recorded frames file

o2-ai paths: ``POST /o2_agent/<agent>/query/stream`` (SSE), ``POST /o2_agent/<agent>/query``
(JSON); every other path answers ``{}`` and is recorded (feedback, confirm, cancel, session).
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

log = logging.getLogger("o2ai-mock")

FRAMES_FILE = Path(__file__).with_name("o2ai_frames.json")
CONFIRMATIONS_FILE = Path(__file__).with_name("o2ai_confirmations.json")

ERRORS: dict[str, tuple[int, dict[str, Any]]] = {
    "session_not_found": (404, {"detail": {"code": "session_not_found", "session_id": "",
                                           "reason": "unknown"}}),
    "turn_in_progress": (409, {"detail": {"code": "turn_in_progress",
                                          "message": "another turn of this conversation is still running"}}),
    "session_owner_unavailable": (409, {"detail": {
        "code": "session_owner_unavailable",
        "message": ("This conversation is being served by another o2-ai replica and "
                    "cannot be continued here."),
        "session_id": "", "owner": "o2ai-1"}}),
}


class State:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.frames = json.loads(FRAMES_FILE.read_text())
        self.confirmations = json.loads(CONFIRMATIONS_FILE.read_text())
        self.confirmed: dict[str, threading.Event] = {}
        self.reset()

    def reset(self) -> None:
        with self.lock:
            self.requests: list[dict[str, Any]] = []
            self.queue: list[dict[str, Any]] = []
            self.default_turn = "chart"

    def record(self, method: str, path: str, headers: dict[str, str], body: Any) -> None:
        with self.lock:
            self.requests.append({"method": method, "path": path, "headers": headers,
                                  "body": body, "at": time.time()})

    def confirm_event(self, session_id: str) -> threading.Event:
        with self.lock:
            return self.confirmed.setdefault(session_id, threading.Event())

    def next_answer(self, query: str = "") -> dict[str, Any]:
        with self.lock:
            for i, answer in enumerate(self.queue):
                if answer.get("match", "") in query:
                    return self.queue.pop(i)
            return {"turn": self.default_turn}


STATE = State()


def error_answer(name: str, session_id: str) -> tuple[int, dict[str, Any]]:
    status, body = ERRORS[name]
    body = json.loads(json.dumps(body))
    if "session_id" in body["detail"]:
        body["detail"]["session_id"] = session_id
    return status, body


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        log.debug(fmt, *args)

    def _body(self) -> Any:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            return json.loads(raw) if raw else None
        except json.JSONDecodeError:
            return raw.decode(errors="replace")

    def _json(self, status: int, body: Any) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _sse_head(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()

    def _sse_frame(self, frame: dict[str, Any]) -> None:
        self.wfile.write(f"data: {json.dumps(frame)}\n\n".encode())
        self.wfile.flush()

    def _confirm_turn(self, kind: str, wait_secs: float, session_id: str) -> None:
        """o2-ai pauses the turn on the confirmation until ``POST /confirm/<session>`` answers it."""
        done = STATE.confirm_event(session_id)
        self._sse_head()
        self._sse_frame(STATE.confirmations[kind])
        done.wait(wait_secs)
        for frame in STATE.frames["turns"]["plain"]:
            self._sse_frame(frame)
        self.close_connection = True

    def _sse(self, frames: list[dict[str, Any]], hold_secs: float = 0) -> None:
        self._sse_head()
        for i, frame in enumerate(frames):
            if hold_secs and i == len(frames) - 1:
                time.sleep(hold_secs)
            self.wfile.write(f"data: {json.dumps(frame)}\n\n".encode())
            self.wfile.flush()
        self.close_connection = True

    def _stream_turn(self, body: Any) -> None:
        answer = STATE.next_answer(str((body or {}).get("query", "")) if isinstance(body, dict) else "")
        session_id = self.headers.get("x-o2-assistant-session-id", "")
        if "error" in answer:
            self._json(*error_answer(answer["error"], session_id))
        elif "status" in answer:
            self._json(answer["status"], answer.get("body", {}))
        elif "in_band" in answer:
            self._sse([STATE.frames["in_band_errors"][answer["in_band"]]])
        elif "confirm" in answer:
            self._confirm_turn(answer["confirm"], answer.get("wait_secs", 30), session_id)
        else:
            self._sse(STATE.frames["turns"][answer["turn"]], answer.get("hold_secs", 0))

    def _query(self) -> None:
        answer = STATE.next_answer()
        if "error" in answer:
            self._json(*error_answer(answer["error"], self.headers.get("x-o2-assistant-session-id", "")))
            return
        complete = STATE.frames["turns"][answer.get("turn", STATE.default_turn)][-1]
        self._json(200, {"response": complete["history"][-1]["content"], "history": complete["history"]})

    def _control(self, method: str, body: Any) -> bool:
        if self.path == "/_mock/health":
            self._json(200, {"ok": True})
        elif self.path == "/_mock/requests":
            with STATE.lock:
                self._json(200, {"requests": list(STATE.requests)})
        elif self.path == "/_mock/frames":
            self._json(200, STATE.frames)
        elif self.path == "/_mock/reset" and method == "POST":
            STATE.reset()
            self._json(200, {"ok": True})
        elif self.path == "/_mock/script" and method == "POST":
            with STATE.lock:
                STATE.queue.extend((body or {}).get("responses", []))
                STATE.default_turn = (body or {}).get("default_turn", STATE.default_turn)
            self._json(200, {"queued": len(STATE.queue)})
        else:
            return False
        return True

    def _handle(self, method: str) -> None:
        body = self._body() if method in ("POST", "PUT", "PATCH", "DELETE") else None
        if self.path.startswith("/_mock/"):
            if not self._control(method, body):
                self._json(404, {"error": "unknown control path"})
            return
        STATE.record(method, self.path, {k.lower(): v for k, v in self.headers.items()}, body)
        path = self.path.split("?", 1)[0]
        if method == "POST" and path.endswith("/query/stream"):
            self._stream_turn(body)
        elif method == "POST" and "/confirm/" in path:
            STATE.confirm_event(path.rsplit("/", 1)[-1].lower()).set()
            self._json(200, {"status": "ok"})
        elif method == "POST" and path.endswith("/query"):
            self._query()
        else:
            self._json(200, {})

    def do_GET(self) -> None:  # noqa: N802
        self._handle("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._handle("POST")

    def do_DELETE(self) -> None:  # noqa: N802
        self._handle("DELETE")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=5098)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    log.info("o2-ai mock on http://%s:%d", args.host, args.port)
    server.serve_forever()


if __name__ == "__main__":
    main()
