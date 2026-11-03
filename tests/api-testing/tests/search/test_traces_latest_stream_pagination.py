"""Streamed trace list pagination: a size of 0, below 0 or omitted uses ZO_QUERY_DEFAULT_LIMIT  [regression #15507].

The streamed endpoint used to stop before its first partition for size=-1 and size=0 and return no traces. Every
case runs through `traces/latest_stream` in all four sort combinations, because timestamp and duration sorts take
different paths through the partition loop. Offsets are checked on the descending sorts only.
"""

from __future__ import annotations

import logging
import secrets
import time
from collections.abc import Generator
from dataclasses import dataclass
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.otlp_json import span, traces_request
from support.sse import read_sse_frames
from support.wait import wait_until

logger = logging.getLogger(__name__)

SEC_NS = 1_000_000_000
MS_NS = 1_000_000
SORTS = [("start_time", "desc"), ("start_time", "asc"), ("duration", "desc"), ("duration", "asc")]
DESC_SORTS = [("start_time", "desc"), ("duration", "desc")]
LETTERS = "ABCDEFGHIJKLMNO"
FEW_SERVICE = "e2e-15507-few"
MAIN_SERVICE = "e2e-15507-main"


@dataclass
class Seeded:
    stream: str
    window: tuple[int, int]
    # Newest and longest first, so every descending sort lists them in this order.
    ordered: list[str]
    few: list[str]


def _trace(trace_id: str, start_ns: int, dur_ns: int, name: str) -> list[dict[str, Any]]:
    # A covering root and a child that starts with it keep the trace in one partition, so its rank is exact.
    root_id = secrets.token_hex(8)
    root = span(name, trace_id=trace_id, span_id=root_id, time_unix_nano=start_ns, duration_nanos=dur_ns)
    child = span(
        f"{name}-child",
        trace_id=trace_id,
        span_id=secrets.token_hex(8),
        time_unix_nano=start_ns,
        duration_nanos=dur_ns // 2,
    )
    child["parentSpanId"] = root_id
    return [root, child]


def _ingest(client: OpenObserveClient, stream: str, spans_by_service: dict[str, list[dict[str, Any]]]) -> None:
    for service, spans in spans_by_service.items():
        for i in range(0, len(spans), 500):
            resp = client.post(
                "v1/traces", json=traces_request(spans[i : i + 500], service=service), headers={"stream-name": stream}
            )
            assert resp.status_code == 200, f"Precondition: traces must ingest, got {resp.status_code}: {resp.text}"


def _count_spans(client: OpenObserveClient, stream: str, window: tuple[int, int]) -> int:
    body = {
        "query": {
            "sql": f'SELECT count(*) AS count FROM "{stream}"',
            "start_time": window[0],
            "end_time": window[1],
            "from": 0,
            "size": 10,
        }
    }
    resp = client.post("_search?type=traces", json=body)
    if resp.status_code != 200:
        return 0
    hits = resp.json().get("hits") or []
    return int(hits[0].get("count", 0)) if hits else 0


def _wait_for_spans(client: OpenObserveClient, stream: str, window: tuple[int, int], spans: int) -> None:
    wait_until(
        lambda: _count_spans(client, stream, window) >= spans,
        timeout=90,
        interval=2,
        msg=f"all {spans} seeded spans must become searchable",
    )


def _latest_stream(
    client: OpenObserveClient, stream: str, window: tuple[int, int], sort: tuple[str, str], **params: Any
) -> list[dict[str, Any]]:
    query = {
        "start_time": window[0],
        "end_time": window[1],
        "sort_by": sort[0],
        "sort_order": sort[1],
        "use_cache": "false",
        **{k: v for k, v in params.items() if v is not None},
    }
    resp = client.get(f"{stream}/traces/latest_stream", params=query, timeout=180)
    assert resp.status_code == 200, f"latest_stream {query} failed: {resp.status_code} {resp.text[:300]}"
    frames = read_sse_frames(resp)
    errors = [data for event, data in frames if event == "error"]
    assert not errors, f"latest_stream {query} streamed an error: {errors}"
    return [hit for event, data in frames if event == "search_response_hits" for hit in data.get("hits") or []]


def _ids(hits: list[dict[str, Any]]) -> list[str]:
    return [hit.get("trace_id") for hit in hits]


def _in_order(ids: list[str], sort: tuple[str, str]) -> list[str]:
    return ids if sort[1] == "desc" else list(reversed(ids))


def _delete_stream(client: OpenObserveClient, stream: str) -> None:
    try:
        client.streams.delete(stream, type_="traces")
    except Exception as e:
        logger.warning("could not delete trace stream %s: %s", stream, e)


@pytest.fixture(scope="module")
def seeded(client: OpenObserveClient) -> Generator[Seeded, None, None]:
    """Fifteen traces A..O, 150 ms apart and 10 ms shorter each, A newest and longest; A, C and E form a smaller service."""
    stream = f"e2e_15507_{secrets.token_hex(4)}"
    base_ns = (time.time_ns() // SEC_NS - 600) * SEC_NS
    ordered = [secrets.token_hex(16) for _ in LETTERS]
    few = [ordered[0], ordered[2], ordered[4]]
    spans: dict[str, list[dict[str, Any]]] = {MAIN_SERVICE: [], FEW_SERVICE: []}
    for i, trace_id in enumerate(ordered):
        start_ns = base_ns + (len(ordered) - 1 - i) * 150 * MS_NS
        service = FEW_SERVICE if trace_id in few else MAIN_SERVICE
        spans[service] += _trace(trace_id, start_ns, (len(ordered) + 1 - i) * 10 * MS_NS, f"op-{LETTERS[i]}")
    window = (base_ns // 1000 - 1_000_000, base_ns // 1000 + 4_000_000)
    _ingest(client, stream, spans)
    _wait_for_spans(client, stream, window, 2 * len(ordered))
    yield Seeded(stream=stream, window=window, ordered=ordered, few=few)
    _delete_stream(client, stream)


@pytest.mark.parametrize("sort", SORTS, ids=lambda s: f"{s[0]}-{s[1]}")
@pytest.mark.parametrize(
    ("size", "count"),
    [(-1, 15), (0, 15), (-5, 15), (None, 15), (1, 1), (2, 2), (20, 15)],
)
def test_streamed_pages_follow_the_size_contract(
    client: OpenObserveClient, seeded: Seeded, sort: tuple[str, str], size: int | None, count: int
):
    """#15507: a size of 0, below 0 or omitted returns every seeded trace, a positive size its own count."""
    hits = _latest_stream(client, seeded.stream, seeded.window, sort, size=size, **{"from": 0})
    expected = _in_order(seeded.ordered, sort)[:count]
    got = _ids(hits)
    logger.info("sort=%s size=%s -> %s traces", sort, size, len(got))
    assert got == expected, f"sort={sort} size={size}: expected {len(expected)} traces in order, got {len(got)}"


@pytest.mark.parametrize("sort", DESC_SORTS, ids=lambda s: f"{s[0]}-{s[1]}")
@pytest.mark.parametrize(("size", "count"), [(-1, 13), (0, 13), (None, 13), (2, 2), (20, 13)])
def test_descending_offsets_skip_the_first_traces(
    client: OpenObserveClient, seeded: Seeded, sort: tuple[str, str], size: int | None, count: int
):
    """#15507: from=2 skips the two newest or longest traces and returns the next page."""
    hits = _latest_stream(client, seeded.stream, seeded.window, sort, size=size, **{"from": 2})
    expected = seeded.ordered[2 : 2 + count]
    assert _ids(hits) == expected, f"sort={sort} size={size} from=2: expected {len(expected)} traces from the third"


@pytest.mark.parametrize("sort", DESC_SORTS, ids=lambda s: f"{s[0]}-{s[1]}")
@pytest.mark.parametrize("size", [-1, 0, None, 2, 20])
@pytest.mark.parametrize("from_", [15, 40])
def test_an_offset_past_the_last_trace_returns_an_empty_page(
    client: OpenObserveClient, seeded: Seeded, sort: tuple[str, str], size: int | None, from_: int
):
    """#15507: an offset beyond the matching traces ends the stream normally with no rows."""
    hits = _latest_stream(client, seeded.stream, seeded.window, sort, size=size, **{"from": from_})
    assert hits == [], f"sort={sort} size={size} from={from_}: expected no traces, got {len(hits)}"


@pytest.mark.parametrize("sort", SORTS, ids=lambda s: f"{s[0]}-{s[1]}")
def test_filters_apply_to_every_size(client: OpenObserveClient, seeded: Seeded, sort: tuple[str, str]):
    """#15507: a filter matching three traces returns those three for -1, 0, omitted and large sizes."""
    few = _in_order(seeded.few, sort)
    flt = f"service_name = '{FEW_SERVICE}'"
    for size in [-1, 0, None, 20]:
        hits = _latest_stream(client, seeded.stream, seeded.window, sort, size=size, filter=flt)
        assert _ids(hits) == few, f"sort={sort} size={size}: the filter must return its three traces, got {_ids(hits)}"
        # The filtered page is re-aggregated over each whole trace: both spans and the root's duration.
        for hit in hits:
            assert hit.get("spans", [0])[0] == 2, f"filtered row lost its full span count: {hit}"
    first = _latest_stream(client, seeded.stream, seeded.window, sort, size=1, filter=flt)
    assert _ids(first) == few[:1], f"sort={sort}: size=1 must return the first filtered trace"
    if sort in DESC_SORTS:
        paged = _latest_stream(client, seeded.stream, seeded.window, sort, size=1, filter=flt, **{"from": 1})
        assert _ids(paged) == few[1:2], f"sort={sort}: size=1 from=1 must return the second filtered trace"


@pytest.mark.parametrize("sort", SORTS, ids=lambda s: f"{s[0]}-{s[1]}")
@pytest.mark.parametrize("size", [-1, 0, None, 2])
def test_a_filter_that_matches_nothing_returns_an_empty_page(
    client: OpenObserveClient, seeded: Seeded, sort: tuple[str, str], size: int | None
):
    """#15507: no matching trace ends the stream normally with no rows for every size."""
    flt = "service_name = 'e2e-15507-nobody'"
    hits = _latest_stream(client, seeded.stream, seeded.window, sort, size=size, filter=flt)
    assert hits == [], f"sort={sort} size={size}: a filter that matches nothing must return no traces"
