"""Streamed trace list pagination: size=-1 lists every trace, size=0 or omitted lists 10  [regression #15507].

The streamed endpoint used to stop before its first partition for size=-1 and size=0, and the engine read a
negative per-partition size as ZO_QUERY_DEFAULT_LIMIT. Every case runs through `traces/latest_stream` in all four
sort combinations, because timestamp and duration sorts take different paths through the partition loop.
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


@dataclass
class LargeSet:
    stream: str
    dense_window: tuple[int, int]
    wide_window: tuple[int, int]
    dense: list[str]
    every: list[str]
    crossers: list[str]
    default_limit: int


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


def _partitions(client: OpenObserveClient, stream: str, window: tuple[int, int]) -> int:
    body = {"sql": f'SELECT * FROM "{stream}"', "start_time": window[0], "end_time": window[1]}
    resp = client.post("_search_partition?type=traces", json=body)
    assert resp.status_code == 200, resp.text
    return len(resp.json().get("partitions") or [])


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


def _default_limit(client: OpenObserveClient) -> int:
    resp = client.get("config")
    assert resp.status_code == 200, resp.text
    return int(resp.json()["query_default_limit"])


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


@pytest.fixture(scope="module")
def large(client: OpenObserveClient) -> Generator[LargeSet, None, None]:
    """More traces than ZO_QUERY_DEFAULT_LIMIT inside one second, a second cluster 3 s later and traces spanning both."""
    limit = _default_limit(client)
    stream = f"e2e_15507_large_{secrets.token_hex(4)}"
    base_ns = (time.time_ns() // SEC_NS - 900) * SEC_NS
    dense = [secrets.token_hex(16) for _ in range(limit + 7)]
    later = [secrets.token_hex(16) for _ in range(12)]
    crossers = [secrets.token_hex(16) for _ in range(5)]
    spans: list[dict[str, Any]] = []
    for i, trace_id in enumerate(dense):
        spans += _trace(trace_id, base_ns + 100 * MS_NS + i * 700 * MS_NS // len(dense), (i % 50 + 1) * MS_NS, "dense")
    for i, trace_id in enumerate(later):
        spans += _trace(trace_id, base_ns + 3 * SEC_NS + i * 50 * MS_NS, (i + 1) * MS_NS, "later")
    for i, trace_id in enumerate(crossers):
        start_ns = base_ns + 100 * MS_NS + i * 10 * MS_NS
        root_id = secrets.token_hex(8)
        spans.append(
            span("cross", trace_id=trace_id, span_id=root_id, time_unix_nano=start_ns, duration_nanos=4 * SEC_NS)
        )
        child = span(
            "cross-child",
            trace_id=trace_id,
            span_id=secrets.token_hex(8),
            time_unix_nano=start_ns + 3 * SEC_NS,
            duration_nanos=100 * MS_NS,
        )
        child["parentSpanId"] = root_id
        spans.append(child)
    dense_window = (base_ns // 1000, base_ns // 1000 + 1_000_000)
    wide_window = (base_ns // 1000, base_ns // 1000 + 5_000_000)
    _ingest(client, stream, {MAIN_SERVICE: spans})
    _wait_for_spans(client, stream, wide_window, len(spans))
    yield LargeSet(
        stream=stream,
        dense_window=dense_window,
        wide_window=wide_window,
        dense=dense,
        every=dense + later + crossers,
        crossers=crossers,
        default_limit=limit,
    )
    _delete_stream(client, stream)


@pytest.mark.parametrize("sort", SORTS, ids=lambda s: f"{s[0]}-{s[1]}")
@pytest.mark.parametrize(
    ("size", "from_", "start", "count"),
    [
        (-1, 0, 0, 15),
        (-1, 2, 2, 13),
        (0, 0, 0, 10),
        (0, 2, 2, 10),
        (None, 0, 0, 10),
        (None, 2, 2, 10),
        (2, 0, 0, 2),
        (2, 2, 2, 2),
        (20, 0, 0, 15),
    ],
)
def test_streamed_pages_follow_the_size_contract(
    client: OpenObserveClient,
    seeded: Seeded,
    sort: tuple[str, str],
    size: int | None,
    from_: int,
    start: int,
    count: int,
):
    """#15507: size=-1 returns every trace after `from`, size=0 or omitted returns 10, a positive size its own count."""
    hits = _latest_stream(client, seeded.stream, seeded.window, sort, size=size, **{"from": from_})
    expected = _in_order(seeded.ordered, sort)[start : start + count]
    got = _ids(hits)
    logger.info("sort=%s size=%s from=%s -> %s traces", sort, size, from_, len(got))
    assert got == expected, (
        f"sort={sort} size={size} from={from_}: expected {len(expected)} traces in order, got {len(got)}"
    )


@pytest.mark.parametrize("sort", SORTS, ids=lambda s: f"{s[0]}-{s[1]}")
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
    """#15507: a filter matching three traces returns those three for -1, 0 and omitted sizes, and pages them."""
    few = _in_order(seeded.few, sort)
    flt = f"service_name = '{FEW_SERVICE}'"
    for size in [-1, 0, None, 20]:
        hits = _latest_stream(client, seeded.stream, seeded.window, sort, size=size, filter=flt)
        assert _ids(hits) == few, f"sort={sort} size={size}: the filter must return its three traces, got {_ids(hits)}"
        # The filtered page is re-aggregated over each whole trace: both spans and the root's duration.
        for hit in hits:
            assert hit.get("spans", [0])[0] == 2, f"filtered row lost its full span count: {hit}"
    paged = _latest_stream(client, seeded.stream, seeded.window, sort, size=1, filter=flt, **{"from": 1})
    assert _ids(paged) == few[1:2], f"sort={sort}: size=1 from=1 must return the second filtered trace"
    for size in [-1, 0, None]:
        none = _latest_stream(
            client, seeded.stream, seeded.window, sort, size=size, filter="service_name = 'e2e-15507-nobody'"
        )
        assert none == [], f"sort={sort} size={size}: a filter that matches nothing must return no traces"


@pytest.mark.parametrize("sort", SORTS, ids=lambda s: f"{s[0]}-{s[1]}")
def test_unlimited_size_is_not_cut_by_the_default_limit_inside_one_partition(
    client: OpenObserveClient, large: LargeSet, sort: tuple[str, str]
):
    """#15507: size=-1 returns more traces than ZO_QUERY_DEFAULT_LIMIT from a single partition, each fully enriched."""
    assert _partitions(client, large.stream, large.dense_window) == 1, (
        "Precondition: a one-second window must be a single partition"
    )
    dense = set(large.dense) | set(large.crossers)
    hits = _latest_stream(client, large.stream, large.dense_window, sort, size=-1)
    got = _ids(hits)
    logger.info("sort=%s default_limit=%s unlimited -> %s of %s", sort, large.default_limit, len(got), len(dense))
    assert len(got) == len(set(got)), f"sort={sort}: a trace was listed twice"
    assert set(got) == dense, f"sort={sort}: expected all {len(dense)} traces, got {len(got)}"
    for hit in hits:
        assert hit.get("spans", [0])[0] >= 1, f"row lost its span count: {hit}"
        assert hit.get("service_name"), f"row lost its services: {hit}"
    keys = [hit["duration"] if sort[0] == "duration" else hit["start_time"] for hit in hits]
    assert keys == sorted(keys, reverse=sort[1] == "desc"), f"sort={sort}: rows are out of order"
    for size in [0, None]:
        page = _latest_stream(client, large.stream, large.dense_window, sort, size=size)
        assert len(page) == 10, f"sort={sort} size={size}: the default page must stay 10 rows, got {len(page)}"


@pytest.mark.parametrize("sort", SORTS, ids=lambda s: f"{s[0]}-{s[1]}")
def test_unlimited_size_reads_every_partition_and_lists_each_trace_once(
    client: OpenObserveClient, large: LargeSet, sort: tuple[str, str]
):
    """#15507: across partitions size=-1 lists every trace once, including traces whose spans sit in two partitions."""
    partitions = _partitions(client, large.stream, large.wide_window)
    if partitions < 2:
        pytest.skip(f"server split the window into {partitions} partition; run it with ZO_QUERY_PARTITION_BY_SECS=1")
    hits = _latest_stream(client, large.stream, large.wide_window, sort, size=-1, **{"from": 0})
    got = _ids(hits)
    logger.info("sort=%s partitions=%s unlimited -> %s of %s", sort, partitions, len(got), len(large.every))
    assert len(got) == len(set(got)), f"sort={sort}: a trace that crosses partitions was listed twice"
    assert set(got) == set(large.every), f"sort={sort}: expected all {len(large.every)} traces, got {len(got)}"
    offset = _latest_stream(client, large.stream, large.wide_window, sort, size=-1, **{"from": 2})
    assert len(offset) == len(large.every) - 2, f"sort={sort}: from=2 must drop exactly two traces"
