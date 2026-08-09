"""DBM Phase-1 ingest-enrichment integration tests.

Prereq: a running OpenObserve built from this worktree, plus env vars
    ZO_BASE_URL            e.g. http://localhost:5092
    ZO_ROOT_USER_EMAIL     root@example.com
    ZO_ROOT_USER_PASSWORD  Complexpass#123
    DBM_GRPC_PORT          gRPC port of the same node (json-path tests), default 5093

Harness choice: uses the repo's `support.client.OpenObserveClient` +
`support.wait.wait_until` conventions (lightweight, env-var driven — same as
tests/ingest/*). Fixture replay is delegated to tests/dbm-capture/replay/replay.py
(imported by path), so the ingest shape is identical to the CLI tool's.

Two run modes (the server cannot be restarted from inside pytest):
  default              groups (a) OTLP enrichment, (b) json-path spoof strip,
                       (c) _o2_ write guard
  DBM_DISABLED_MODE=1  group (d) only — run against a server started with
                       ZO_DB_MONITORING_ENABLED=false, asserts NO o2_db_*
                       columns appear on newly ingested spans

Orchestration example (from tests/api-testing):
    ZO_BASE_URL=http://localhost:5092 DBM_GRPC_PORT=5093 \
        python3 -m pytest tests/dbm/test_phase1_ingest.py -q
    # restart server with ZO_DB_MONITORING_ENABLED=false, then:
    DBM_DISABLED_MODE=1 ZO_BASE_URL=http://localhost:5092 \
        python3 -m pytest tests/dbm/test_phase1_ingest.py -q

Assertions run on CLOSED data: every replay is followed by PUT /node/flush and
a wait_until on searchable counts (start the server with a small
ZO_MAX_FILE_RETENTION_TIME, e.g. 15s, to keep this fast).
"""
from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until

logger = logging.getLogger(__name__)

# tests/api-testing/tests/dbm/x.py -> parents[4] = repo root -> tests/dbm-capture
_REPO_ROOT = Path(__file__).resolve().parents[4]
_CAPTURE_DIR = _REPO_ROOT / "tests" / "dbm-capture"
sys.path.insert(0, str(_CAPTURE_DIR / "replay"))

import replay  # noqa: E402  (tests/dbm-capture/replay/replay.py)

ORG = "default"
STREAM = "default"          # OTLP replays land in the default traces stream
JSON_STREAM = "dbmjson"     # json-path replay goes to its own stream for isolation
DISABLED_STREAM = "dbmoff"  # group (d) fresh stream

DISABLED_MODE = os.environ.get("DBM_DISABLED_MODE") == "1"
GRPC_PORT = int(os.environ.get("DBM_GRPC_PORT", "5093"))

# fixture -> (total spans, driver spans) from tests/dbm-capture/MANIFEST.md
FIXTURES = {
    "java-dup.json": (157, 120),
    "python-pg-new.json": (32, 20),
    "dotnet-pg10-legacy.json": (37, 24),
}

# S01 anchor (MANIFEST appendix): same logical statement, per-SDK raw text.
S01_PREFIX = "SELECT id, name, price FROM dbm_items WHERE id ="
# Literals seeded by apps/WORKLOAD.md S00 — must never survive normalization.
SEEDED_LITERALS = ["alpha", "epsilon", "ins-1"]


def _grpc_host_port() -> tuple[str, int]:
    return "localhost", GRPC_PORT


def _flush(client: OpenObserveClient) -> None:
    resp = client.put("node/flush", prefix="")
    assert resp.status_code in (200, 404), f"flush failed: {resp.status_code} {resp.text[:200]}"


def _traces_sql(client: OpenObserveClient, sql: str, minutes: int = 30):
    return client.search.hits(sql, minutes=minutes, type_="traces", size=1000)


def _traces_count(client: OpenObserveClient, sql: str, minutes: int = 30) -> int:
    hits = _traces_sql(client, sql, minutes=minutes)
    return int(hits[0]["c"]) if hits else 0


def _replay_otlp(client: OpenObserveClient, name: str) -> None:
    fx = replay.load_fixture(str(_CAPTURE_DIR / "fixtures" / name))
    prepared = replay.prepare(fx)
    req = replay.build_otlp_request(prepared)
    base = client.base_url.rstrip("/")
    resp = replay.send_otlp(
        req,
        url=base,
        org=ORG,
        user=client.email,
        password=client.password,
        stream=None,
    )
    assert resp.status_code == 200, f"{name}: OTLP replay failed {resp.status_code} {resp.text[:300]}"


@pytest.fixture(scope="module")
def client() -> OpenObserveClient:
    return OpenObserveClient(org=ORG)


# ---------------------------------------------------------------------------
# group (a) — OTLP replay + enrichment assertions
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def replayed(client: OpenObserveClient):
    """Replay the three cross-vocabulary fixtures once, flush, wait for closed data."""
    if DISABLED_MODE:
        pytest.skip("enabled-mode fixture")
    for name in FIXTURES:
        _replay_otlp(client, name)
    _flush(client)
    expected_db_spans = sum(driver for _, driver in FIXTURES.values())

    def _enriched_count():
        return _traces_count(
            client,
            f'SELECT count(*) AS c FROM "{STREAM}" WHERE o2_db_fingerprint IS NOT NULL',
        )

    count = wait_until(
        lambda: (c := _enriched_count()) >= expected_db_spans and c,
        timeout=90,
        interval=3,
        msg=f"expected >= {expected_db_spans} enriched db spans searchable",
    )
    logger.info("replayed fixtures: %s enriched db spans searchable", count)
    return count


pytestmark_enabled = pytest.mark.skipif(DISABLED_MODE, reason="DBM_DISABLED_MODE=1")


@pytestmark_enabled
class TestOtlpEnrichment:
    def test_identity_fields_present_on_all_db_spans(self, client, replayed):
        """o2_db_fingerprint/system/stmt_class/env non-empty on every DB span."""
        for col in ("o2_db_system", "o2_db_stmt_class", "o2_db_env"):
            missing = _traces_count(
                client,
                f'SELECT count(*) AS c FROM "{STREAM}" '
                f"WHERE o2_db_fingerprint IS NOT NULL AND ({col} IS NULL OR {col} = '')",
            )
            assert missing == 0, f"{missing} db spans missing {col}"

    def test_env_value_is_capture_env(self, client, replayed):
        """o2_db_env carries the fixtures' resource-level deployment environment."""
        rows = _traces_sql(
            client,
            f'SELECT DISTINCT o2_db_env FROM "{STREAM}" WHERE o2_db_fingerprint IS NOT NULL',
        )
        envs = {r["o2_db_env"] for r in rows}
        assert envs == {"capture-env-a"}, f"unexpected envs {envs}"

    def test_query_norm_present_on_text_spans(self, client, replayed):
        """Spans carrying query text store a normalized text (norm_len > 0)."""
        with_text = _traces_count(
            client,
            f'SELECT count(*) AS c FROM "{STREAM}" '
            "WHERE (db_statement IS NOT NULL OR db_query_text IS NOT NULL) "
            "AND o2_db_fingerprint IS NOT NULL",
        )
        with_norm = _traces_count(
            client,
            f'SELECT count(*) AS c FROM "{STREAM}" '
            "WHERE (db_statement IS NOT NULL OR db_query_text IS NOT NULL) "
            "AND o2_db_query_norm IS NOT NULL AND o2_db_query_norm != ''",
        )
        assert with_text > 0
        # allow the rare lexer-failure degraded row, but the bulk must normalize
        assert with_norm >= int(with_text * 0.95), f"norm on {with_norm}/{with_text} text spans"

    def test_s01_same_fingerprint_across_sdk_vocabularies(self, client, replayed):
        """S01 binds to ONE fingerprint across java `?` / python `%s` / dotnet `$1`."""
        rows = _traces_sql(
            client,
            f'SELECT service_name, o2_db_fingerprint, o2_db_query_norm, '
            f'o2_db_system, o2_db_stmt_class FROM "{STREAM}" '
            f"WHERE (db_statement LIKE '{S01_PREFIX}%' OR db_query_text LIKE '{S01_PREFIX}%') "
            "AND o2_db_fingerprint IS NOT NULL",
        )
        assert rows, "no S01 spans found"
        services = {r["service_name"] for r in rows}
        assert len(services) >= 3, f"S01 seen from only {services}"
        fingerprints = {r["o2_db_fingerprint"] for r in rows}
        assert len(fingerprints) == 1, (
            f"S01 split across fingerprints {fingerprints} (services {services})"
        )
        # the rest of the derived identity is byte-identical across vocabularies
        assert {r["o2_db_query_norm"] for r in rows} == {
            "SELECT id, name, price FROM dbm_items WHERE id = ?"
        }
        assert {r["o2_db_stmt_class"] for r in rows} == {"query"}

    def test_deadlock_victim_status_code(self, client, replayed):
        """dotnet-pg10 deadlock victim (S12) surfaces o2_db_status_code='40P01'."""
        c = _traces_count(
            client,
            f'SELECT count(*) AS c FROM "{STREAM}" WHERE o2_db_status_code = \'40P01\'',
        )
        assert c >= 1, "deadlock victim span with o2_db_status_code=40P01 not found"

    @pytest.mark.parametrize("literal", SEEDED_LITERALS)
    def test_no_seeded_literal_leaks_into_query_norm(self, client, replayed, literal):
        c = _traces_count(
            client,
            f'SELECT count(*) AS c FROM "{STREAM}" '
            f"WHERE o2_db_query_norm LIKE '%{literal}%'",
        )
        assert c == 0, f"literal {literal!r} leaked into o2_db_query_norm on {c} spans"


# ---------------------------------------------------------------------------
# group (b) — json-path (internal gRPC ingest_json) spoof strip
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def json_replayed(client):
    """Replay one fixture through the JSON path with spoofed derived fields.

    The JSON path (`core::traces::ingest_json`) has no HTTP route — it is
    reachable only via the internal gRPC cluster.Ingest service (see
    replay.py docstring), which is how pipeline-derived re-ingest flows in.
    """
    if DISABLED_MODE:
        pytest.skip("enabled-mode fixture")
    fx = replay.load_fixture(str(_CAPTURE_DIR / "fixtures" / "python-pg-new.json"))
    prepared = replay.prepare(fx)
    records = replay.flatten_records(
        prepared,
        spoof={"o2_db_fingerprint": "HACK", "infer_service_name": "HACK"},
    )
    host, port = _grpc_host_port()
    code, message = replay.send_json_grpc(
        records,
        host=host,
        port=port,
        org=ORG,
        stream=JSON_STREAM,
        user=client.email,
        password=client.password,
    )
    assert code == 200, f"json-path replay failed: {code} {message}"
    _flush(client)
    wait_until(
        lambda: _traces_count(client, f'SELECT count(*) AS c FROM "{JSON_STREAM}"')
        >= len(records),
        timeout=90,
        interval=3,
        msg=f"{JSON_STREAM}: expected {len(records)} spans searchable",
    )
    return len(records)


@pytestmark_enabled
class TestJsonPathSpoofStrip:
    def test_spoofed_values_do_not_survive(self, client, json_replayed):
        for col in ("o2_db_fingerprint", "infer_service_name"):
            c = _traces_count(
                client,
                f'SELECT count(*) AS c FROM "{JSON_STREAM}" WHERE {col} = \'HACK\'',
            )
            assert c == 0, f"spoofed {col}='HACK' survived on {c} records"

    def test_derived_fields_rederived_from_raw_attrs(self, client, json_replayed):
        rederived = _traces_count(
            client,
            f'SELECT count(*) AS c FROM "{JSON_STREAM}" '
            "WHERE o2_db_fingerprint IS NOT NULL AND o2_db_fingerprint != ''",
        )
        assert rederived >= FIXTURES["python-pg-new.json"][1], (
            f"only {rederived} json-path records re-derived o2_db_fingerprint"
        )
        # and they re-derived to REAL values, matching the OTLP path's S01 identity
        rows = _traces_sql(
            client,
            f'SELECT DISTINCT o2_db_fingerprint FROM "{JSON_STREAM}" '
            f"WHERE db_query_text LIKE '{S01_PREFIX}%'",  # python-pg-new is new-vocab only
        )
        assert len(rows) == 1
        assert rows[0]["o2_db_fingerprint"] != "HACK"


# ---------------------------------------------------------------------------
# group (c) — `_o2_` write guard
# ---------------------------------------------------------------------------


@pytestmark_enabled
class TestInternalRollupWriteGuard:
    RECORD = [{"level": "info", "message": "user write attempt", "code": 1}]

    def test_user_write_to_o2_db_stats_rejected(self, client):
        resp = client.post("_o2_db_stats/_json", json=self.RECORD, raise_for_status=False)
        assert 400 <= resp.status_code < 500, (
            f"expected 4xx for _o2_db_stats user write, got {resp.status_code}: {resp.text[:300]}"
        )

    def test_user_write_to_normal_stream_accepted(self, client):
        resp = client.post("dbm_guard_control/_json", json=self.RECORD, raise_for_status=False)
        assert 200 <= resp.status_code < 300, (
            f"control write failed {resp.status_code}: {resp.text[:300]}"
        )


# ---------------------------------------------------------------------------
# group (d) — ZO_DB_MONITORING_ENABLED=false (separate server run)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def disabled_replayed(client):
    if not DISABLED_MODE:
        pytest.skip("disabled-mode fixture")
    fx = replay.load_fixture(str(_CAPTURE_DIR / "fixtures" / "python-pg-new.json"))
    prepared = replay.prepare(fx)
    req = replay.build_otlp_request(prepared)
    resp = replay.send_otlp(
        req,
        url=client.base_url.rstrip("/"),
        org=ORG,
        user=client.email,
        password=client.password,
        stream=DISABLED_STREAM,  # fresh stream => fresh schema
    )
    assert resp.status_code == 200, f"replay failed {resp.status_code} {resp.text[:300]}"
    _flush(client)
    total = FIXTURES["python-pg-new.json"][0]
    wait_until(
        lambda: _traces_count(client, f'SELECT count(*) AS c FROM "{DISABLED_STREAM}"')
        >= total,
        timeout=90,
        interval=3,
        msg=f"{DISABLED_STREAM}: expected {total} spans searchable",
    )
    return total


@pytest.mark.skipif(not DISABLED_MODE, reason="needs server with ZO_DB_MONITORING_ENABLED=false")
class TestDisabledMode:
    def test_no_o2_db_columns_in_schema(self, client, disabled_replayed):
        resp = client.get(f"streams/{DISABLED_STREAM}/schema?type=traces")
        assert resp.status_code == 200, resp.text[:300]
        fields = {f["name"] for f in resp.json().get("schema", [])}
        o2_db_cols = {f for f in fields if f.startswith("o2_db_")}
        assert not o2_db_cols, f"o2_db_* columns present with DBM disabled: {o2_db_cols}"

    def test_db_spans_ingested_but_unstamped(self, client, disabled_replayed):
        """The raw db attrs still land (only the o2_db_* enrichment is off)."""
        c = _traces_count(
            client,
            f'SELECT count(*) AS c FROM "{DISABLED_STREAM}" '
            "WHERE db_query_text IS NOT NULL",  # python-pg-new is new-vocab only
        )
        assert c >= FIXTURES["python-pg-new.json"][1], (
            f"only {c} raw db spans found in {DISABLED_STREAM}"
        )
