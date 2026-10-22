"""Records ``helpers/o2ai_frames.json``: o2-ai's own event conversion run on its recorded fixtures.

Run from an o2-ai checkout (branch with A3's answer fields)::

    uv run python <openobserve>/tests/api-testing/helpers/recorders/record_o2ai_frames.py \
        <openobserve>/tests/api-testing/helpers/o2ai_frames.json

Each SearchSQL call carries its own recorded case: the call's SQL is the case's SQL and its range is the
recording session's window, so a turn's ``tool_call`` and ``tool_result`` describe the same query.
"""

import asyncio
import copy
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path.cwd()))
sys.path.insert(0, str(Path.cwd() / "tests"))

from src.opencode.events import flush_text_buffer, process_opencode_event  # noqa: E402
from src.server import app as o2ai_app  # noqa: E402
from src.server.constants import EventType  # noqa: E402
from src.server.handlers.o2ai_handler import O2AIHandler  # noqa: E402
from src.server.stream_context import StreamState  # noqa: E402
from src.server.stream_helpers import build_completion_event  # noqa: E402
from test_completion_event import _RECORDED, _answer_events, _recorded_searchsql_parts  # noqa: E402

WINDOW_CASE = "histogram_1m_1h"
BUCKET_US = 60_000_000


def session_window() -> tuple[int, int]:
    """The 1-minute histogram's buckets span the recording session's hour; its last bucket is open."""
    stamps = [datetime.fromisoformat(h["x_axis_1"]).replace(tzinfo=UTC) for h in _RECORDED[WINDOW_CASE]["response"]["hits"]]
    start = int(min(stamps).timestamp() * 1_000_000)
    return start, int(max(stamps).timestamp() * 1_000_000) + BUCKET_US


def searchsql_call(call_id: str, case: str, **extra) -> list[dict]:
    """The recorded running/completed parts, with the case's own SQL, the session window and its response."""
    recorded = _RECORDED[case]
    start, end = session_window()
    running, completed = _recorded_searchsql_parts()
    for part in (running, completed):
        part["callID"] = call_id
        part["state"]["input"]["request_body"]["query"] = {"sql": recorded["sql"], "start_time": start, "end_time": end}
        part["state"]["time"]["start"] = end // 1000
    response = copy.deepcopy(recorded["response"]) | extra
    completed["state"]["output"] = json.dumps(response, separators=(",", ":"))
    completed["state"]["time"]["end"] = end // 1000 + response.get("took", 0)
    return [{"type": "message.part.updated", "properties": {"part": running}},
            {"type": "message.part.updated", "properties": {"part": completed}}]


async def turn(events: list[dict], query: str) -> list[dict]:
    state = StreamState(history=[])
    lines = []
    for event in events:
        lines += process_opencode_event(event, state)
    lines += flush_text_buffer(state) or []
    lines += await build_completion_event(SimpleNamespace(query=query), state, O2AIHandler("o2-ai", {}), "trace-1")
    return [json.loads(line.removeprefix("data: ")) for line in lines if line.startswith("data: ")]


def in_band() -> dict:
    tip = {"type": EventType.ERROR, "recoverable": True, **o2ai_app._turn_in_progress_detail()}
    stale = {"type": EventType.ERROR, "message": "A newer turn of this conversation has started.",
             "recoverable": False, "category": o2ai_app.STALE_EPOCH, "code": o2ai_app.STALE_EPOCH}
    restore = {"type": EventType.ERROR, "message": "This conversation must be restored on this replica; retry.",
               "recoverable": True, "category": o2ai_app.RESTORE_REQUIRED, "code": o2ai_app.RESTORE_REQUIRED,
               "opencode_session_id": "ses_0001", "local_max_seq": -1}
    return {name: json.loads(json.dumps(frame)) for name, frame in
            (("turn_in_progress", tip), ("stale_epoch", stale), ("restore_required", restore))}


async def main(out: str) -> None:
    chart = searchsql_call("c1", "histogram_1m_1h") + _answer_events("Queries held steady at ~400/min.\n\nConfidence: high")
    partial = searchsql_call("c1", "non_timeseries", is_partial=True)
    partial += _answer_events("svc-api ran the most queries (28,736).\n\nConfidence: medium")
    doc = {
        "_comment": "o2-ai SSE frames recorded by running o2-ai's process_opencode_event and build_completion_event "
        "(A3 answer fields) on its recorded fixtures (tests/fixtures/opencode_replay_session.json for the part "
        "shapes, searchsql_recorded_outputs.json for each call's SQL and response, already anonymized); every call "
        "is paired with its own case and the recording session's window. In-band error frames are o2-ai app.py's "
        "own payloads. Re-record with tests/api-testing/helpers/recorders/record_o2ai_frames.py.",
        "turns": {
            "chart": await turn(chart, "how many queries per minute?"),
            "partial": await turn(partial, "which user ran the most queries?"),
            "plain": await turn(_answer_events("Hello! How can I help?"), "hello"),
        },
        "in_band_errors": in_band(),
    }
    Path(out).write_text(json.dumps(doc, indent=1) + "\n")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
