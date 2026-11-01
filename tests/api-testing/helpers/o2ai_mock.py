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
- ``GET  /_mock/requests``      every recorded request: method, path, headers, body, at, and for a
  streamed turn ``last_frame_at`` (just before its last frame is written)
- ``POST /_mock/reset``         forget requests, scripts and confirmations; the default turn is ``chart``
- ``POST /_mock/script``        queue answers for the next streamed turns, one per turn, in order:
  ``{"responses": [{"error": "session_not_found" | "turn_in_progress" | "session_owner_unavailable"},
  {"in_band": "restore_required" | "stale_epoch" | "turn_in_progress"}, {"turn": "partial"},
  {"status": 503, "body": {...}}, {"confirm": "cli" | "o2_delete" | "permission", "wait_secs"?: 30,
  "delete_status"?: 403}]}``;
  ``{"default_turn": "plain"}`` changes the turn served when the queue is empty; ``"hold_secs"`` on a
  turn keeps its stream open before ``complete``. A ``confirm`` turn streams o2-ai's own
  ``confirmation_required`` frame (``o2ai_confirmations.json``); a ``cli`` or ``permission`` one then
  pauses until ``POST /confirm/<session>`` (or ``wait_secs``, after which o2-ai drops it, as its
  timeout denies), and an ``o2_delete`` one does not pause, since o2-ai answers deletes after the turn;
  then the ``plain`` turn. ``/confirm`` answers as o2-ai's ``confirm_action`` does: its per-kind body,
  a delete's per-resource ``results`` (``delete_status`` other than 200 makes O2 refuse the delete),
  and 404 ``No pending confirmation`` once the confirmation was answered or dropped. An answer with
  ``"match": "<text>"`` is only served to a turn whose question contains that text, so other tests'
  background turns never take it. ``{"report": "<markdown>", "probable_cause"?: "<text>"}`` is served
  to the next RCA turn (``/o2_agent/sre-rca/query/stream``) whose question contains its ``match``:
  the replayed run's ``submit_report`` carries that markdown and probable cause; other turns never
  take it. A non-streamed ``/query`` also takes a ``report`` answer, as its ``response``
- ``GET  /_mock/frames``        the recorded frames file

An RCA turn (``/o2_agent/sre-rca/query/stream``) is OpenObserve's durable chat: it replays the
opencode events of one graded run (``o2ai_rca_events.json``, the core crate's ledger fixture, kept
in step by ``rca_turn::tests::the_pytest_o2ai_mock_replays_the_graded_run_fixture``) as o2-ai forwards
them: a ``sync_state`` frame, one ``sync`` frame per event after the request's ``known_seq``, then
``complete`` with ``last_seq``. Without them OpenObserve ends the turn ``persistence_failed`` and
the run never completes.

``O2AI_MOCK_LOG=<path>`` also appends every recorded request as a JSON line, reset or not.

o2-ai paths: ``POST /o2_agent/<agent>/query/stream`` (SSE), ``POST /o2_agent/<agent>/query``
(JSON); every other path answers ``{}`` and is recorded (feedback, confirm, cancel, session).
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

log = logging.getLogger("o2ai-mock")

FRAMES_FILE = Path(__file__).with_name("o2ai_frames.json")
RCA_EVENTS_FILE = Path(__file__).with_name("o2ai_rca_events.json")
RCA_AGENT = "/sre-rca/"
CONFIRMATIONS_FILE = Path(__file__).with_name("o2ai_confirmations.json")

# What O2 answered o2-ai's delete with, per status, as o2-ai's perform_resource_delete reports it.
DELETE_DETAIL = {200: "", 403: "Unauthorized Access", 404: "Not Found"}

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
        self.rca_events = json.loads(RCA_EVENTS_FILE.read_text())
        self.confirmations = json.loads(CONFIRMATIONS_FILE.read_text())
        self.reset()

    def reset(self) -> None:
        with self.lock:
            self.requests: list[dict[str, Any]] = []
            self.queue: list[dict[str, Any]] = []
            self.default_turn = "chart"
            self.confirmed: dict[str, threading.Event] = {}
            self.pending: dict[str, dict[str, Any]] = {}
            self.resolved: set[str] = set()

    def record(self, method: str, path: str, headers: dict[str, str], body: Any) -> dict[str, Any]:
        entry = {"method": method, "path": path, "headers": headers, "body": body, "at": time.time()}
        with self.lock:
            self.requests.append(entry)
        if os.environ.get("O2AI_MOCK_LOG"):
            with open(os.environ["O2AI_MOCK_LOG"], "a") as f:
                f.write(json.dumps(entry) + "\n")
        return entry

    def stamp(self, entry: dict[str, Any], key: str) -> None:
        with self.lock:
            entry[key] = time.time()

    def confirm_event(self, session_id: str) -> threading.Event:
        """Session ids are UUIDs; O2 lower-cases them, so the header and the path must agree in any case."""
        with self.lock:
            return self.confirmed.setdefault(session_id.lower(), threading.Event())

    def hold(self, session_id: str, kind: str, delete_status: int) -> None:
        with self.lock:
            self.pending[session_id.lower()] = {"kind": kind, "delete_status": delete_status}

    def drop(self, session_id: str) -> None:
        """o2-ai's confirmation timeout denies and forgets it."""
        with self.lock:
            if self.pending.pop(session_id.lower(), None) is not None:
                self.resolved.add(session_id.lower())

    def answer_confirmation(self, session_id: str, approved: bool) -> tuple[int, dict[str, Any]]:
        key = session_id.lower()
        with self.lock:
            pending = self.pending.pop(key, None)
            if pending is None:
                if key in self.resolved:
                    return 404, {"detail": f"No pending confirmation for session {session_id}"}
                # Answered before its turn asked: the turn then finds it already confirmed.
                return 200, {}
            self.resolved.add(key)
        return 200, confirm_reply(pending, approved, self.confirmations)

    def next_answer(self, query: str = "") -> dict[str, Any]:
        with self.lock:
            for i, answer in enumerate(self.queue):
                if "report" not in answer and answer.get("match", "") in query:
                    return self.queue.pop(i)
            return {"turn": self.default_turn}

    def next_report(self, query: str = "") -> dict[str, Any]:
        with self.lock:
            for i, answer in enumerate(self.queue):
                if "report" in answer and answer.get("match", "") in query:
                    return self.queue.pop(i)
            return {"turn": self.default_turn}


STATE = State()


def confirm_reply(pending: dict[str, Any], approved: bool, confirmations: dict[str, Any]) -> dict[str, Any]:
    """o2-ai's ``confirm_action`` return values (src/server/app.py), per kind."""
    kind = pending["kind"]
    if kind == "cli":
        return {"approved": approved, "kind": "cli_confirmation"}
    if kind == "permission":
        return {"approved": approved, "replied": True, "kind": "opencode_permission"}
    if not approved:
        return {"approved": False, "deleted": False, "count": 0}
    status = pending["delete_status"]
    results = [{"resource": item["name"], "resource_type": item["resource_type"], "deleted": status < 300,
                "status_code": status, "detail": DELETE_DETAIL.get(status, "error")}
               for item in confirmations[kind]["args"]["items"]]
    deleted = sum(1 for r in results if r["deleted"])
    return {"approved": True, "deleted": deleted == len(results), "count": deleted, "total": len(results),
            "results": results}


def rca_run_events(events: list[dict[str, Any]], session_id: str, answer: dict[str, Any]) -> list[dict[str, Any]]:
    """The fixture run under this turn's opencode session, with the scripted report in its ``submit_report``."""
    out = json.loads(json.dumps(events))
    for event in out:
        event["aggregateID"] = session_id
        data = event.get("data") or {}
        for holder in (data, data.get("info") or {}, data.get("part") or {}):
            if "sessionID" in holder:
                holder["sessionID"] = session_id
        part = data.get("part") or {}
        if part.get("type") == "tool" and part.get("tool") == "submit_report":
            submitted = part["state"]["input"]
            if "report" in answer:
                submitted["markdown"] = answer["report"]
            if "probable_cause" in answer and "verdict" in submitted:
                submitted["verdict"]["probable_cause"] = answer["probable_cause"]
    return out


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

    def _confirm_turn(self, answer: dict[str, Any], session_id: str) -> None:
        """o2-ai pauses a CLI or permission turn until ``POST /confirm/<session>``; a delete waits for no one."""
        kind = answer["confirm"]
        done = STATE.confirm_event(session_id)
        STATE.hold(session_id, kind, answer.get("delete_status", 200))
        self._sse_head()
        self._sse_frame(STATE.confirmations[kind])
        if kind != "o2_delete" and not done.wait(answer.get("wait_secs", 30)):
            STATE.drop(session_id)
        for frame in STATE.frames["turns"]["plain"]:
            self._sse_frame(frame)
        self.close_connection = True

    def _sse(self, frames: list[dict[str, Any]], hold_secs: float = 0, entry: dict[str, Any] | None = None) -> None:
        self._sse_head()
        for i, frame in enumerate(frames):
            if i == len(frames) - 1:
                if hold_secs:
                    time.sleep(hold_secs)
                if entry is not None:
                    STATE.stamp(entry, "last_frame_at")
            self.wfile.write(f"data: {json.dumps(frame)}\n\n".encode())
            self.wfile.flush()
        self.close_connection = True

    def _rca_turn(self, body: Any, entry: dict[str, Any]) -> None:
        """o2-ai's durable RCA turn: sync_state, the run's events after ``known_seq``, complete."""
        body = body if isinstance(body, dict) else {}
        answer = STATE.next_report(str(body.get("query", "")))
        if "error" in answer:
            self._json(*error_answer(answer["error"], self.headers.get("x-o2-assistant-session-id", "")))
            return
        known_seq = int(body.get("known_seq", -1))
        session_id = "ses_" + (self.headers.get("x-o2-assistant-session-id") or uuid.uuid4().hex)[:8]
        events = [e for e in rca_run_events(STATE.rca_events, session_id, answer) if e["seq"] > known_seq]
        last_seq = events[-1]["seq"] if events else known_seq
        frames: list[dict[str, Any]] = [{"type": "sync_state", "available": True, "reason": "",
                                         "opencode_session_id": session_id, "known_seq": known_seq,
                                         "local_max_seq": known_seq, "behind": False}]
        frames.extend({"type": "sync", "seq": e["seq"], "event": e} for e in events)
        frames.append({"type": "complete", "last_seq": last_seq, "history": [], "compacted": False, "usage": {}})
        self._sse(frames, answer.get("hold_secs", 0), entry)

    def _stream_turn(self, body: Any, entry: dict[str, Any]) -> None:
        if RCA_AGENT in self.path:
            self._rca_turn(body, entry)
            return
        answer = STATE.next_answer(str((body or {}).get("query", "")) if isinstance(body, dict) else "")
        session_id = self.headers.get("x-o2-assistant-session-id", "")
        if "error" in answer:
            self._json(*error_answer(answer["error"], session_id))
        elif "status" in answer:
            self._json(answer["status"], answer.get("body", {}))
        elif "in_band" in answer:
            self._sse([STATE.frames["in_band_errors"][answer["in_band"]]])
        elif "confirm" in answer:
            self._confirm_turn(answer, session_id)
        else:
            self._sse(STATE.frames["turns"][answer["turn"]], answer.get("hold_secs", 0), entry)

    def _query(self) -> None:
        answer = STATE.next_report()
        if "report" in answer:
            self._json(200, {"response": answer["report"], "history": [], "compacted": False, "usage": {}})
            return
        if "error" in answer:
            self._json(*error_answer(answer["error"], self.headers.get("x-o2-assistant-session-id", "")))
            return
        complete = STATE.frames["turns"][answer.get("turn", STATE.default_turn)][-1]
        # o2-ai's QueryResponse (src/server/models.py), filled from the recorded complete frame.
        self._json(200, {"response": complete["history"][-1]["content"], "history": complete["history"],
                         "compacted": complete["compacted"], "usage": complete["usage"]})

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
        entry = STATE.record(method, self.path, {k.lower(): v for k, v in self.headers.items()}, body)
        path = self.path.split("?", 1)[0]
        if method == "POST" and path.endswith("/query/stream"):
            self._stream_turn(body, entry)
        elif method == "POST" and "/confirm/" in path:
            session_id = path.rsplit("/", 1)[-1]
            approved = isinstance(body, dict) and bool(body.get("approved"))
            status, reply = STATE.answer_confirmation(session_id, approved)
            STATE.confirm_event(session_id).set()
            self._json(status, reply)
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
