"""Scripted stand-in for the o2-ai AutoResolve agent (O2_AGENT_URL) in the e2e / AutoResolve shard. It plans on the first
connection (a replan gets one option, `[af-needs:<name>]` a partial one and missing_capability), then runs steps."""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

log = logging.getLogger("autoresolve-agent-mock")

DEFAULT_PORT = 5098
DEFAULT_O2_URL = "http://127.0.0.1:5080"
STREAM_PATH = "/o2_agent/autoresolve/query/stream"
SESSION_HEADER = "x-o2-assistant-session-id"
INTERNAL_HEADER = "x-o2-internal-secret"
# o2-ai sends the hash of the connection's live tool definition; the mock has no live tools, so plan and consume share one.
TOOL_DEF_HASH = "autoresolve-mock-tool-def-v1"
O2_TIMEOUT_SECS = 15
NEEDS_MARKER = re.compile(r"\[af-needs(?::([a-z0-9_-]+))?\]")


def plan_body(connection: str, goal: str = "", autoresolve: dict[str, Any] | None = None) -> dict[str, Any]:
    autoresolve = autoresolve or {}

    def step(kind: str, arguments: dict[str, Any], reason: str) -> dict[str, Any]:
        return {
            "connection": connection,
            "tool": "scale_service",
            "kind": kind,
            "arguments": arguments,
            "refs": [],
            "reason": reason,
            "tool_def_hash": TOOL_DEF_HASH,
            "preview": None,
        }

    if autoresolve.get("note"):
        return {
            "options": [
                {
                    "title": "Scale up the checkout service as corrected",
                    "recommended": True,
                    "changes_production_directly": False,
                    "tradeoffs": "Changes only the checkout service.",
                    "reason": "The note says what the first plan got wrong.",
                    "steps": [step("change", {"service": "checkout", "replicas": 3}, "Add two replicas")],
                }
            ],
            "omitted_count": 0,
            "omitted_reason": None,
            "missing_capability": None,
        }
    needs = NEEDS_MARKER.search(goal)
    if needs:
        others = [c.get("name") for c in autoresolve.get("not_connected") or [] if c.get("name")]
        target = needs.group(1) or (others[0] if others else None)
        if target not in others:
            raise ValueError(f"[af-needs] names {target!r}, which is not in not_connected {others}")
        return {
            "options": [
                {
                    "title": "Restart the checkout service",
                    "recommended": False,
                    "partial_fix": "drops every in-flight checkout",
                    "changes_production_directly": False,
                    "tradeoffs": "Ends the stuck session, and every other one with it.",
                    "reason": "A restart releases the lock, but so does ending one session.",
                    "steps": [step("change", {"service": "checkout", "restart": True}, "Restart")],
                }
            ],
            "omitted_count": 0,
            "omitted_reason": None,
            "missing_capability": f"needs {target}: end session 4211",
        }
    return {
        "options": [
            {
                "title": "Check the scale-up first",
                "recommended": True,
                "changes_production_directly": False,
                "tradeoffs": "Changes nothing; shows what a scale-up would do.",
                "reason": "The error rate rose with traffic, so more replicas should absorb it.",
                "steps": [step("dry_run", {"service": "checkout", "replicas": 3, "dry_run": True}, "Preview")],
            },
            {
                "title": "Scale up the checkout service",
                "recommended": False,
                "changes_production_directly": False,
                "tradeoffs": "Fixes it now; costs two more replicas until scaled back.",
                "reason": "More replicas absorb the traffic peak.",
                "steps": [step("change", {"service": "checkout", "replicas": 3}, "Add two replicas")],
            },
        ],
        "omitted_count": 0,
        "omitted_reason": None,
        "missing_capability": None,
    }


def sse(frame: dict[str, Any]) -> bytes:
    return f"data: {json.dumps(frame)}\n\n".encode()


class Turn:
    """One agent turn: what OpenObserve sent and every call the mock made back to it."""

    def __init__(self, o2_url: str, headers: Any, body: dict[str, Any]):
        self.o2_url = o2_url.rstrip("/")
        self.body = body
        self.context = body.get("context") or {}
        self.autoresolve = self.context.get("autoresolve") or {}
        self.auth = headers.get("Authorization", "")
        self.secret = headers.get(INTERNAL_HEADER, "")
        self.session = headers.get(SESSION_HEADER, "")
        # Same rule as o2-ai's resolve_org_id, so an org OpenObserve forgets to send shows up here too.
        self.org = body.get("org_id") or self.context.get("org_id") or "default"
        self.record: dict[str, Any] = {
            "phase": self.autoresolve.get("phase"),
            "run_id": self.autoresolve.get("run_id"),
            "org": self.org,
            "session_id": self.session,
            "has_authorization": bool(self.auth),
            "has_internal_secret": bool(self.secret),
            "mcps": [m.get("name") for m in body.get("mcps") or []],
            "not_connected": [c.get("name") for c in self.autoresolve.get("not_connected") or []],
            "corrections": [
                {"kind": c.get("kind"), "note": c.get("note"), "this_run": c.get("this_run")}
                for c in self.autoresolve.get("corrections") or []
            ],
            "posts": [],
            "error": None,
        }

    def post(self, path: str, payload: dict[str, Any]) -> tuple[int, Any]:
        org, run = quote(self.org, safe=""), quote(str(self.autoresolve.get("run_id")), safe="")
        url = f"{self.o2_url}/api/v2/{org}/autoresolve/runs/{run}/{path}"
        headers = {"Content-Type": "application/json", "Authorization": self.auth, INTERNAL_HEADER: self.secret}
        req = Request(url, data=json.dumps(payload).encode(), headers=headers, method="POST")
        try:
            with urlopen(req, timeout=O2_TIMEOUT_SECS) as resp:
                status, raw = resp.status, resp.read()
        except HTTPError as exc:
            status, raw = exc.code, exc.read()
        except URLError as exc:
            status, raw = 0, str(exc.reason).encode()
        try:
            answer = json.loads(raw) if raw else None
        except ValueError:
            answer = raw.decode(errors="replace")[:300]
        self.record["posts"].append({"path": path, "status": status, "answer": answer})
        return status, answer

    def run(self) -> None:
        phase = self.autoresolve.get("phase")
        if phase == "plan":
            self.plan()
        elif phase == "execute":
            self.execute()
        else:
            self.record["error"] = f"no context.autoresolve phase: {phase!r}"

    def plan(self) -> None:
        mcps = self.body.get("mcps") or []
        if not mcps:
            self.record["error"] = "the request carried no mcps"
            return
        goal = str(self.body.get("query") or "")
        try:
            body = plan_body(mcps[0]["name"], goal, self.autoresolve)
        except ValueError as exc:
            self.record["error"] = str(exc)
            log.error("plan not posted: %s", exc)
            return
        status, _ = self.post("plan", body)
        if not 200 <= status < 300:
            self.record["error"] = f"plan refused with HTTP {status}"

    def execute(self) -> None:
        urls = {m.get("name"): m.get("url") for m in self.body.get("mcps") or []}
        for step in self.autoresolve.get("steps") or []:
            request = {
                "connection": step["connection"],
                "tool": step["tool"],
                "arguments": step["arguments"],
                "upstream_url": urls.get(step["connection"], ""),
                "tool_def_hash": TOOL_DEF_HASH,
            }
            status, answer = self.post("consume", request)
            if status != 200 or not isinstance(answer, dict) or answer.get("decision") != "run":
                self.record["error"] = f"step {step.get('seq')} not run: HTTP {status}"
                return
            result = {"content": [{"type": "text", "text": f"{step['tool']} done"}]}
            outcome = {"ok": True, "unknown": False, "result": result, "error": None}
            status, _ = self.post(f"steps/{quote(answer['step_id'], safe='')}/result", outcome)
            if not 200 <= status < 300:
                self.record["error"] = f"result of step {step.get('seq')} refused with HTTP {status}"
                return
        verdict = {"verdict": "worked", "explanation": "The error rate is back under its threshold."}
        status, _ = self.post("outcome", verdict)
        if not 200 <= status < 300:
            self.record["error"] = f"outcome refused with HTTP {status}"


class AgentMockHandler(BaseHTTPRequestHandler):
    o2_url = DEFAULT_O2_URL
    turns: list[dict[str, Any]] = []
    lock = threading.Lock()

    def log_message(self, fmt: str, *args: Any) -> None:
        log.info("%s %s", self.command, self.path)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/_mock/health":
            return self.reply(200, {"ok": True})
        if self.path == "/_mock/requests":
            with self.lock:
                return self.reply(200, {"turns": list(self.turns)})
        self.reply(404, {"error": "unknown_path"})

    def do_POST(self) -> None:  # noqa: N802
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if self.path == "/_mock/reset":
            with self.lock:
                self.turns.clear()
            return self.reply(200, {"ok": True})
        if self.path.startswith("/o2_agent/session/") and self.path.endswith("/cancel"):
            return self.reply(200, {"cancelled": False, "active": False})
        if self.path != STREAM_PATH:
            return self.reply(404, {"error": "unknown_path"})
        try:
            body = json.loads(raw or b"{}")
        except ValueError:
            return self.reply(400, {"error": "invalid_json"})
        self.stream(Turn(self.o2_url, self.headers, body))

    def stream(self, turn: Turn) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        sid = turn.body.get("known_opencode_session_id") or f"ses_mock_{turn.session or 'none'}"
        known = turn.body.get("known_seq", -1)
        # Without sync_state OpenObserve reports the turn as unsaved; no sync events keeps its watermark at known_seq.
        sync_state = {
            "type": "sync_state",
            "available": True,
            "opencode_session_id": sid,
            "known_seq": known,
            "local_max_seq": known,
            "behind": False,
        }
        self.write(sse(sync_state))
        try:
            turn.run()
        except Exception as exc:  # noqa: BLE001
            turn.record["error"] = f"{type(exc).__name__}: {exc}"
        with self.lock:
            self.turns.append(turn.record)
        if turn.record["error"]:
            log.warning("turn %s/%s: %s", turn.record["phase"], turn.record["run_id"], turn.record["error"])
            self.write(sse({"type": "error", "code": "agent_error", "message": turn.record["error"]}))
        self.write(sse({"type": "complete", "last_seq": known}))

    def write(self, data: bytes) -> None:
        self.wfile.write(data)
        self.wfile.flush()

    def do_DELETE(self) -> None:  # noqa: N802
        self.reply(200, {"deleted": True})

    def reply(self, status: int, body: Any) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def make_server(host: str = "127.0.0.1", port: int = 0, o2_url: str = DEFAULT_O2_URL) -> ThreadingHTTPServer:
    bound = type(
        "BoundAgentMockHandler", (AgentMockHandler,), {"o2_url": o2_url, "turns": [], "lock": threading.Lock()}
    )
    return ThreadingHTTPServer((host, port), bound)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--o2-url", default=DEFAULT_O2_URL, help="OpenObserve base URL the mock posts plans and steps to"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s autoresolve-agent-mock %(message)s")
    server = make_server(args.host, args.port, args.o2_url)
    sys.stderr.write(f"autoresolve agent mock listening on http://{args.host}:{server.server_address[1]}\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
