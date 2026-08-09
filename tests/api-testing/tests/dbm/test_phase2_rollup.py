"""DBM Phase-2 rollup + read-API integration tests.

Prereq: a running OpenObserve built from this worktree, started with a SHORT
rollup interval and a FORCED-truncation top-N (the java fixtures carry more
than 5 distinct fingerprints per (system, instance)):
    ZO_DB_MONITORING_INTERVAL_SECS=60  ZO_DB_MONITORING_TOP_N=5
    ZO_MAX_FILE_RETENTION_TIME=15      ZO_MEM_PERSIST_INTERVAL=2
plus the phase-1 env vars
    ZO_BASE_URL            e.g. http://localhost:5094
    ZO_ROOT_USER_EMAIL     root@example.com
    ZO_ROOT_USER_PASSWORD  Complexpass#123
and optionally (must mirror the server's values)
    DBM_INTERVAL_SECS      default 60
    DBM_TOP_N              default 5

The single-node default role includes Scheduler, so the rollup job runs.

Timing model (why the fixture waits for a tick FIRST): the rollup's first
window starts one interval back from its first tick and the offset only moves
forward, so spans must land INSIDE the currently-open window to ever be rolled
up. The fixture polls `freshness.data_through` (== the stream's rollup offset)
until it advances, replays anchored at "now" (start of the fresh window), then
waits for the offset to pass the replay time — at which point the spans'
window has been rolled up. Worst case ~2.5 intervals.

Repeatability: `_o2_db_stats` records accumulate across runs, so every
assertion scopes to windows that END after this run's replay time; the
per-window assertions group by `_timestamp` so earlier runs never bleed in.

NULL vs "": the rollup's derived `_other` rows canonicalize absent dimensions
to "" (`get_str`), while passthrough SQL rows keep NULL — the read API treats
them as one key and so do these tests (`_k()`).

Orchestration example (from tests/api-testing):
    ZO_BASE_URL=http://localhost:5094 \
        python3 -m pytest tests/dbm/test_phase2_rollup.py -q
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[4]
_CAPTURE_DIR = _REPO_ROOT / "tests" / "dbm-capture"
sys.path.insert(0, str(_CAPTURE_DIR / "replay"))

import replay  # noqa: E402  (tests/dbm-capture/replay/replay.py)

ORG = "default"
STREAM = "default"        # OTLP replays land in the default traces stream
SECOND_STREAM = "dbmp2b"  # per-stream offset isolation check

INTERVAL_SECS = int(os.environ.get("DBM_INTERVAL_SECS", "60"))
TOP_N = int(os.environ.get("DBM_TOP_N", "5"))

FIXTURES = ["java-dup.json", "dotnet-pg10-legacy.json", "python-pg-new.json"]

# S01 anchor (MANIFEST appendix): one logical statement across 3 SDK vocabularies.
S01_PREFIX = "SELECT id, name, price FROM dbm_items WHERE id ="

ADDITIVE = ("calls", "total_time_ns", "statements", "errors")


def _k(v) -> str:
    """Dimension key: NULL and '' are ONE group (matches the read API's get_str)."""
    return v if isinstance(v, str) else ""


def _flush(client: OpenObserveClient) -> None:
    resp = client.put("node/flush", prefix="")
    assert resp.status_code in (200, 404), f"flush failed: {resp.status_code} {resp.text[:200]}"


def _replay_otlp(client: OpenObserveClient, name: str, *, stream: str | None = None) -> None:
    """Replay one fixture anchored at NOW (inside the open rollup window)."""
    fx = replay.load_fixture(str(_CAPTURE_DIR / "fixtures" / name))
    prepared = replay.prepare(fx, anchor_seconds_ago=0)
    req = replay.build_otlp_request(prepared)
    resp = replay.send_otlp(
        req,
        url=client.base_url.rstrip("/"),
        org=ORG,
        user=client.email,
        password=client.password,
        stream=stream,
    )
    assert resp.status_code == 200, f"{name}: OTLP replay failed {resp.status_code} {resp.text[:300]}"


def _stats_sql(client: OpenObserveClient, sql: str, minutes: int = 30):
    return client.search.hits(sql, minutes=minutes, type_="logs", size=1000)


def _dbm_get(client: OpenObserveClient, path: str, **params) -> dict:
    resp = client.get(f"traces/db_monitoring/{path}", params=params)
    assert resp.status_code == 200, f"{path}: {resp.status_code} {resp.text[:300]}"
    return resp.json()


def _data_through(client: OpenObserveClient, stream: str) -> int:
    """The stream's rollup offset, read through the queries endpoint (D4)."""
    return int(_dbm_get(client, "queries", stream=stream)["freshness"]["data_through"])


@pytest.fixture(scope="module")
def client() -> OpenObserveClient:
    return OpenObserveClient(org=ORG)


@pytest.fixture(scope="module")
def rolled_up(client: OpenObserveClient) -> dict:
    """Replay the fixtures inside a fresh rollup window and wait until rolled up.

    Returns {"replayed_at": µs, "s01_fingerprint": str}.
    """
    # 1. Wait for a tick so the replay lands at the START of the open window.
    #    (data_through == 0 means the stream was never rolled up — replaying
    #    creates it and the first tick starts one window back, covering us.)
    d0 = _data_through(client, STREAM)
    if d0 > 0:
        wait_until(
            lambda: _data_through(client, STREAM) > d0,
            timeout=INTERVAL_SECS * 2 + 30,
            interval=3,
            msg=f"rollup offset for {STREAM} did not advance past {d0}",
        )

    replayed_at = int(time.time() * 1e6)
    for name in FIXTURES:
        _replay_otlp(client, name)
    _flush(client)

    # 2. Wait for the offset to pass the replay time: the spans' window has
    #    then been searched + written by the rollup job.
    wait_until(
        lambda: _data_through(client, STREAM) > replayed_at,
        timeout=INTERVAL_SECS * 3 + 30,
        interval=3,
        msg=f"rollup offset for {STREAM} did not pass replay time {replayed_at}",
    )

    # 3. This run's query_stats rows must exist (window END > replay time).
    wait_until(
        lambda: _stats_sql(
            client,
            f"SELECT count(*) AS c FROM \"_o2_db_stats\" WHERE record_type = 'query_stats'"
            f" AND trace_stream_name = '{STREAM}' AND _timestamp > {replayed_at}",
        )[0]["c"]
        > 0,
        timeout=60,
        interval=3,
        msg="no query_stats rows for this run's window",
    )

    # S01 fingerprint from raw spans (it ranks below top-5 by design).
    rows = client.search.hits(
        f"SELECT DISTINCT o2_db_fingerprint FROM \"{STREAM}\" "
        f"WHERE (db_statement LIKE '{S01_PREFIX}%' OR db_query_text LIKE '{S01_PREFIX}%') "
        "AND o2_db_fingerprint IS NOT NULL",
        minutes=30,
        type_="traces",
    )
    assert len(rows) == 1, f"S01 must bind to ONE fingerprint, got {rows}"
    return {"replayed_at": replayed_at, "s01_fingerprint": rows[0]["o2_db_fingerprint"]}


def _run_scoped_stats(client: OpenObserveClient, rolled_up: dict, record_type: str) -> list[dict]:
    return _stats_sql(
        client,
        f"SELECT * FROM \"_o2_db_stats\" WHERE record_type = '{record_type}'"
        f" AND trace_stream_name = '{STREAM}'"
        f" AND _timestamp > {rolled_up['replayed_at']}",
    )


# ---------------------------------------------------------------------------
# (a) query_stats shape: identity stamps + top-N bound + constituents kept
# ---------------------------------------------------------------------------


class TestQueryStatsRecords:
    def test_identity_stamps(self, client, rolled_up):
        rows = _run_scoped_stats(client, rolled_up, "query_stats")
        assert rows, "no query_stats rows"
        for r in rows:
            assert r["fp_version"] == 1, r
            assert r["org_id"] == ORG, r
            assert r["trace_stream_name"] == STREAM, r

    def test_top_n_bound_per_system_instance_per_window(self, client, rolled_up):
        rows = _run_scoped_stats(client, rolled_up, "query_stats")
        fps = defaultdict(set)
        constituents = defaultdict(int)
        for r in rows:
            if r["fingerprint"] == "_other":
                continue
            key = (r["_timestamp"], _k(r.get("db_system")), _k(r.get("db_instance")))
            fps[key].add(r["fingerprint"])
            constituents[key] += 1
        assert fps, "no fingerprint rows"
        for key, s in fps.items():
            assert len(s) <= TOP_N, f"{key}: {len(s)} fingerprints > top_n={TOP_N}"
        # java-dup guarantees forced truncation: at least one group hits the cap
        assert any(len(s) == TOP_N for s in fps.values()), (
            f"expected >= 1 group at the top_n={TOP_N} cap: " f"{ {k: len(v) for k, v in fps.items()} }"
        )
        # constituent rows kept: some winning fingerprint appears with > 1 row
        assert any(n > len(fps[k]) for k, n in constituents.items()), (
            "expected constituent (per namespace × env × service) rows to be kept"
        )

    def test_other_rows_present_at_both_grains(self, client, rolled_up):
        rows = _run_scoped_stats(client, rolled_up, "query_stats")
        other = [r for r in rows if r["fingerprint"] == "_other"]
        assert any(r.get("stmt_class") is None for r in other), "no instance-grain _other"
        assert any(r.get("stmt_class") == "query" for r in other), "no query-class _other"
        for r in other:
            assert r.get("p95_ns") is None, "_other must carry no latency distribution"


# ---------------------------------------------------------------------------
# (b) db_totals at both grains + exact reconciliation
# ---------------------------------------------------------------------------


class TestReconciliation:
    def _pools(self, client, rolled_up):
        qs = _run_scoped_stats(client, rolled_up, "query_stats")
        totals = _run_scoped_stats(client, rolled_up, "db_totals")
        return qs, totals

    def test_totals_exist_at_both_grains(self, client, rolled_up):
        _, totals = self._pools(client, rolled_up)
        assert any(r.get("stmt_class") is None for r in totals), "no namespace-grain totals"
        assert any(r.get("stmt_class") is not None for r in totals), "no class-grain totals"

    @pytest.mark.parametrize("metric", ["calls", "total_time_ns", "statements"])
    def test_instance_grain_reconciles(self, client, rolled_up, metric):
        """sum(top-N per (window, system, instance)) + _other == namespace-grain totals."""
        qs, totals = self._pools(client, rolled_up)
        tot = defaultdict(int)
        for r in totals:
            if r.get("stmt_class") is None:
                tot[(r["_timestamp"], _k(r.get("db_system")), _k(r.get("db_instance")))] += r.get(metric, 0)
        got = defaultdict(int)
        for r in qs:
            if r["fingerprint"] == "_other" and r.get("stmt_class") is not None:
                continue  # class-grain _other reconciles the class totals, not these
            got[(r["_timestamp"], _k(r.get("db_system")), _k(r.get("db_instance")))] += r.get(metric, 0)
        assert tot, "no namespace-grain totals"
        for key in tot:
            assert got.get(key, 0) == tot[key], (
                f"{metric} mismatch at {key}: query_stats+_other={got.get(key, 0)} totals={tot[key]}"
            )

    @pytest.mark.parametrize("metric", ["calls", "total_time_ns", "statements"])
    def test_query_class_grain_reconciles(self, client, rolled_up, metric):
        qs, totals = self._pools(client, rolled_up)
        tot = defaultdict(int)
        for r in totals:
            if r.get("stmt_class") == "query":
                tot[(r["_timestamp"], _k(r.get("db_system")), _k(r.get("db_instance")))] += r.get(metric, 0)
        got = defaultdict(int)
        for r in qs:
            if r.get("stmt_class") != "query":
                continue
            got[(r["_timestamp"], _k(r.get("db_system")), _k(r.get("db_instance")))] += r.get(metric, 0)
        assert tot, "no query-class totals"
        for key in tot:
            assert got.get(key, 0) == tot[key], (
                f"query-class {metric} mismatch at {key}: {got.get(key, 0)} != {tot[key]}"
            )


# ---------------------------------------------------------------------------
# (c) error_class incl. the dotnet 40P01 deadlock victim
# ---------------------------------------------------------------------------


class TestErrorClass:
    def test_rows_exist(self, client, rolled_up):
        rows = _run_scoped_stats(client, rolled_up, "error_class")
        assert rows, "no error_class rows"
        for r in rows:
            assert r.get("errors", 0) >= 1

    def test_deadlock_victim_40p01(self, client, rolled_up):
        """The dotnet-pg10 deadlock victim (S12) appears — fingerprint-attributed
        or folded into the _other errors row for its (system, instance, code)."""
        rows = _run_scoped_stats(client, rolled_up, "error_class")
        hits = [r for r in rows if r.get("status_code") == "40P01"]
        assert hits, f"40P01 not in error_class: {[(r.get('fingerprint'), r.get('status_code')) for r in rows]}"
        assert any(r.get("db_system") == "postgresql" for r in hits)


# ---------------------------------------------------------------------------
# (d) GET queries
# ---------------------------------------------------------------------------


class TestQueriesEndpoint:
    def test_default_stmt_class_is_query(self, client, rolled_up):
        body = _dbm_get(client, "queries", stream=STREAM)
        assert body["hits"], "no query rows"
        assert {h.get("stmt_class") for h in body["hits"]} == {"query"}
        assert body["top_n_subset"] is False

    def test_other_present_unfiltered(self, client, rolled_up):
        body = _dbm_get(client, "queries", stream=STREAM)
        assert body["other"], "no _other remainder at the unfiltered grain"
        for o in body["other"]:
            assert o["fingerprint"] == "_other"

    def test_service_filter_sets_top_n_subset(self, client, rolled_up):
        body = _dbm_get(client, "queries", stream=STREAM, service="dbm-java")
        assert body["top_n_subset"] is True
        assert body["other"] == [], "_other must be dropped for narrower-than-grain scopes"

    def test_freshness_data_through_positive(self, client, rolled_up):
        body = _dbm_get(client, "queries", stream=STREAM)
        f = body["freshness"]
        assert f["data_through"] > 0
        assert f["traces_upper_bound"] is True

    def test_sort_and_limit(self, client, rolled_up):
        body = _dbm_get(client, "queries", stream=STREAM, sort="calls", limit=3)
        assert len(body["hits"]) <= 3
        calls = [h["calls"] for h in body["hits"]]
        assert calls == sorted(calls, reverse=True), calls
        assert body["total"] >= len(body["hits"])


# ---------------------------------------------------------------------------
# (e) GET databases
# ---------------------------------------------------------------------------


class TestDatabasesEndpoint:
    def test_rows_grouped_with_percentiles_and_services(self, client, rolled_up):
        body = _dbm_get(client, "databases", stream=STREAM)
        hits = body["hits"]
        assert hits, "no database rows"
        seen = set()
        for h in hits:
            key = (_k(h.get("db_system")), _k(h.get("db_instance")), _k(h.get("db_namespace")))
            assert key not in seen, f"duplicate group {key}"
            seen.add(key)
            for col in ("p50_ns", "p95_ns", "p99_ns", "max_ns"):
                assert isinstance(h.get(col), int), f"{key} missing {col}"
        systems = {_k(h.get("db_system")) for h in hits}
        assert {"postgresql", "mysql", "redis"} <= systems, systems
        assert any(h.get("calling_services") for h in hits), "calling_services all empty"


# ---------------------------------------------------------------------------
# (f) GET query/history for S01
# ---------------------------------------------------------------------------


class TestHistoryEndpoint:
    def test_s01_series_has_points(self, client, rolled_up):
        body = _dbm_get(
            client, "query/history", fingerprint=rolled_up["s01_fingerprint"], stream=STREAM
        )
        assert body["fingerprint"] == rolled_up["s01_fingerprint"]
        pts = [p for p in body["series"] if p.get("calls", 0) > 0 or p.get("below_top_n")]
        assert pts, f"empty series: {body['series']}"

    def test_s01_below_top_n_flagged_and_backfilled(self, client, rolled_up):
        """S01 ranks below top-5 by design → its rolled-up windows must be
        flagged below_top_n, and (within the K-window budget) backfilled."""
        body = _dbm_get(
            client, "query/history", fingerprint=rolled_up["s01_fingerprint"], stream=STREAM
        )
        below = [p for p in body["series"] if p.get("below_top_n")]
        assert below, "expected S01 below-top-N windows with TOP_N=5"
        backfilled = [p for p in below if p.get("backfilled")]
        assert backfilled, "no below-top-N window was backfilled"
        assert any(p.get("calls", 0) > 0 for p in backfilled), backfilled


# ---------------------------------------------------------------------------
# (g) GET query/endpoints for S01
# ---------------------------------------------------------------------------


class TestEndpointsEndpoint:
    def test_s01_root_span_attribution(self, client, rolled_up):
        body = _dbm_get(
            client, "query/endpoints", fingerprint=rolled_up["s01_fingerprint"], stream=STREAM
        )
        hits = body["hits"]
        assert hits, "no endpoint attribution rows"
        services = {h["service_name"] for h in hits}
        # S01 is issued by all three replayed services
        assert {"dbm-java", "dbm-python-pg", "dbm-dotnet-pg10"} <= services, services
        for h in hits:
            assert h["calls"] >= 1
            assert h.get("endpoint"), h

    def test_missing_params_are_400(self, client):
        assert client.get("traces/db_monitoring/query/endpoints").status_code == 400
        assert (
            client.get("traces/db_monitoring/query/endpoints", params={"fingerprint": "x"}).status_code
            == 400
        )


# ---------------------------------------------------------------------------
# (h) live tail: post-tick data visible via tail merge before the next tick
# ---------------------------------------------------------------------------


class TestLiveTail:
    def test_tail_merge_shows_new_data_immediately(self, client, rolled_up):
        def snapshot():
            body = _dbm_get(client, "queries", stream=STREAM, stmt_class="all")
            calls = sum(h["calls"] for h in body["hits"]) + sum(o["calls"] for o in body["other"])
            return body["freshness"], calls

        # replay right AFTER a tick so the spans sit in the un-rolled-up tail
        d0 = _data_through(client, STREAM)
        wait_until(
            lambda: _data_through(client, STREAM) > d0,
            timeout=INTERVAL_SECS * 2 + 30,
            interval=2,
            msg="rollup offset did not advance",
        )
        _, calls_before = snapshot()
        _replay_otlp(client, "java-dup.json")

        # visible before the next tick: within ~interval/2, far less than 60 s
        def merged():
            fresh, calls = snapshot()
            return (
                calls > calls_before
                and fresh["tail_through"] is not None
                and fresh["tail_through"] > fresh["data_through"]
            ) and (fresh, calls)

        fresh, calls_after = wait_until(
            lambda: merged(),
            timeout=max(15, INTERVAL_SECS // 2),
            interval=2,
            msg="tail merge did not surface new spans before the next tick",
        )
        logger.info(
            "tail merge: calls %s -> %s, data_through=%s tail_through=%s",
            calls_before, calls_after, fresh["data_through"], fresh["tail_through"],
        )


# ---------------------------------------------------------------------------
# (i) per-stream offsets: a second stream rolls up independently
# ---------------------------------------------------------------------------


class TestPerStreamOffsets:
    def test_second_stream_gets_own_offset_and_records(self, client, rolled_up):
        _replay_otlp(client, "python-pg-new.json", stream=SECOND_STREAM)
        _flush(client)
        replayed_at = int(time.time() * 1e6)

        # its own offset advances past the replay (first-run starts one window
        # back, so the spans' window is covered)
        wait_until(
            lambda: _data_through(client, SECOND_STREAM) > replayed_at,
            timeout=INTERVAL_SECS * 3 + 30,
            interval=3,
            msg=f"rollup offset for {SECOND_STREAM} did not pass {replayed_at}",
        )
        # and its records carry ITS stream identity
        rows = wait_until(
            lambda: _stats_sql(
                client,
                f"SELECT record_type, count(*) AS c FROM \"_o2_db_stats\""
                f" WHERE trace_stream_name = '{SECOND_STREAM}' GROUP BY record_type",
            ),
            timeout=60,
            interval=3,
            msg=f"no _o2_db_stats records for {SECOND_STREAM}",
        )
        types = {r["record_type"] for r in rows}
        assert "query_stats" in types and "db_totals" in types, types
        # offsets are independent objects: default's offset is not forced equal
        assert _data_through(client, STREAM) > 0
