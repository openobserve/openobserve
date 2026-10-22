"""The o2-ai mock's own contract, so a mock bug never passes for an O2 bug."""
from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Generator
from http.server import ThreadingHTTPServer

import pytest
import requests

from helpers.o2ai_mock import Handler


@pytest.fixture(scope="module")
def api() -> Generator[str, None, None]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def confirm_turn(api: str, session: str, wait_secs: float) -> float:
    """Streams a ``confirm`` turn for ``session`` and returns how long it took."""
    requests.post(f"{api}/_mock/script", json={"responses": [{"confirm": "cli", "wait_secs": wait_secs}]},
                  timeout=5).raise_for_status()
    started = time.time()
    resp = requests.post(f"{api}/o2_agent/o2-ai/query/stream", json={"query": "restart"},
                         headers={"x-o2-assistant-session-id": session}, timeout=30)
    assert resp.status_code == 200, resp.text
    assert '"type": "complete"' in resp.text
    return time.time() - started


def test_a_confirmation_matches_its_session_in_any_case(api: str) -> None:
    session = str(uuid.uuid4()).upper()
    requests.post(f"{api}/_mock/reset", json={}, timeout=5).raise_for_status()
    requests.post(f"{api}/o2_agent/confirm/{session}", json={"approved": True}, timeout=5).raise_for_status()
    assert confirm_turn(api, session, wait_secs=5) < 2


def test_reset_forgets_confirmations(api: str) -> None:
    session = str(uuid.uuid4())
    requests.post(f"{api}/o2_agent/confirm/{session}", json={"approved": True}, timeout=5).raise_for_status()
    requests.post(f"{api}/_mock/reset", json={}, timeout=5).raise_for_status()
    assert confirm_turn(api, session, wait_secs=2) >= 1.5


def test_a_streamed_turn_records_when_its_last_frame_left(api: str) -> None:
    requests.post(f"{api}/_mock/reset", json={}, timeout=5).raise_for_status()
    requests.post(f"{api}/_mock/script", json={"responses": [{"turn": "plain", "hold_secs": 1}]},
                  timeout=5).raise_for_status()
    requests.post(f"{api}/o2_agent/o2-ai/query/stream", json={"query": "hello"}, timeout=30).raise_for_status()
    turn = requests.get(f"{api}/_mock/requests", timeout=5).json()["requests"][-1]
    assert turn["last_frame_at"] - turn["at"] >= 1


def test_a_plain_query_answers_o2ais_query_response_shape(api: str) -> None:
    requests.post(f"{api}/_mock/reset", json={}, timeout=5).raise_for_status()
    body = requests.post(f"{api}/o2_agent/o2-ai/query", json={"query": "hello"}, timeout=10).json()
    assert {"response", "history", "compacted", "usage"} <= set(body), body
