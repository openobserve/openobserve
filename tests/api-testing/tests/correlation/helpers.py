"""Shared API plumbing for the Correlation (service-streams) API tests.

Python port of the Playwright `utils/correlation-api-helpers.js` module — the
single source of truth for the enterprise `service_streams` endpoints
(discovery, `_correlate`, `config/identity`, `_analytics`, `_reset`), the
semantic-groups endpoint, and the ingest paths. It deliberately contains NO
assertions — those belong in the test files, so every correlation test stays in
lockstep on the same plumbing.

AUTH: routes through the framework `OpenObserveClient` (root Basic auth). On the
local/CI enterprise build the root header authorizes every org, including
freshly created ones — so, unlike the cloud Playwright path, no per-org passcode
minting is needed here.

ORG ISOLATION (deliberate deviation from the shared-org norm): correlation
discovery, identity config, semantic groups and `_reset` are ORG-GLOBAL and
DESTRUCTIVE — one test's saveIdentity/reset would corrupt any test sharing the
org. So each test provisions a FRESH org via `create_correlation_org` and tears
it down best-effort in the fixture. Org names are never idempotent; uniqueness
(not delete) is the isolation guarantee — delete is cleanup only.
"""
from __future__ import annotations

import logging
import os
import random
import time
import uuid
from typing import Any

from support.client import OpenObserveClient
from support.wait import wait_until

log = logging.getLogger("o2-corr")

# ---------------------------------------------------------------------------
# Temporal contract (f(env) of the backend under test):
#   ZO_MAX_FILE_RETENTION_TIME=10, ZO_FILE_PUSH_INTERVAL=10,
#   O2_SERVICE_STREAMS_BATCH_FLUSH_INTERVAL_SECS=5, SAMPLE_RATE=1.
# Measured end-to-end discovery latency is ~2min (WAL move-job cadence
# dominates). First flush after a cold start ~3.3min. 300s covers it with
# margin; deployed envs can raise it via env without a code change.
# ---------------------------------------------------------------------------
DISCOVERY_DEADLINE_S = int(os.environ.get("O2_CORR_DISCOVERY_DEADLINE_MS", "300000")) / 1000
POLL_INTERVAL_S = 3.0
MAX_STREAMS_PER_TYPE = int(os.environ.get("O2_SERVICE_STREAMS_MAX_STREAMS_PER_SERVICE", "50"))


def _uniq_org(prefix: str) -> str:
    """Unique, human-readable org name so parallel/repeat runs never collide."""
    return f"{prefix}_{int(time.time() * 1000):x}{uuid.uuid4().hex[:4]}"


def _now_micros() -> int:
    return int(time.time() * 1_000_000)


def _now_millis() -> int:
    return int(time.time() * 1000)


def _rand_hex(n: int) -> str:
    return "".join(random.choice("0123456789abcdef") for _ in range(n))


# SQLite is single-writer; under parallel workers (`pytest -n`) concurrent writes
# (ingest, save-identity, org-create, reset) can race and the server returns a
# lock error. It surfaces as BOTH 500 and 400 with this marker in the body, so —
# unlike the framework's status-gated `retry_on_db_lock` — we match on the text.
# A short exponential backoff lets the other writer commit and release the lock.
_LOCK_MARKER = "database is locked"


def _request_retrying_lock(client, method: str, path: str, *, retries: int = 6, base_delay: float = 0.4, **kw):
    """Issue a write request, retrying while the response body reports a DB lock."""
    resp = client.request(method, path, **kw)
    delay = base_delay
    for _ in range(retries):
        if _LOCK_MARKER not in (resp.text or ""):
            return resp
        log.warning("DB locked on %s %s — retrying in %.1fs", method, path, delay)
        time.sleep(delay)
        delay = min(delay * 2, 4.0)
        resp = client.request(method, path, **kw)
    return resp


class CorrelationClient:
    """Per-org wrapper around `OpenObserveClient` exposing the correlation API.

    One instance is bound to exactly one org (the isolation unit). Mirrors the
    JS helper's function surface 1:1 so the ported specs read the same.
    """

    def __init__(self, client: OpenObserveClient, org: str):
        self._c = client
        self.org = org

    # -- ingest -----------------------------------------------------------

    def ingest_logs(self, stream: str, records: list[dict]) -> dict:
        """records: list of flat dicts; `_timestamp` (micros) added if missing."""
        ts = _now_micros()
        data = [{"_timestamp": ts, **r} for r in records]
        resp = _request_retrying_lock(self._c, "POST", f"{stream}/_json", org=self.org, json=data)
        body = _safe_json(resp)
        if resp.status_code != 200 or body.get("code") != 200:
            raise AssertionError(
                f"ingest_logs({stream}) failed: {resp.status_code} {body}"
            )
        return body

    def ingest_metrics(self, records: list[dict]) -> dict:
        """records: [{__name__, ...labels}]; gauge/value/_timestamp defaults added."""
        ts = _now_millis()
        data = [{"__type__": "gauge", "_timestamp": ts, "value": 1, **r} for r in records]
        resp = _request_retrying_lock(self._c, "POST", "ingest/metrics/_json", org=self.org, json=data)
        body = _safe_json(resp)
        if resp.status_code != 200 or body.get("code") != 200:
            raise AssertionError(f"ingest_metrics failed: {resp.status_code} {body}")
        return body

    def ingest_traces(
        self, service_name: str, attrs: dict[str, str], child_count: int = 1
    ):
        """Minimal OTLP-JSON trace ingest: 1 parent + `child_count` children.

        `attrs` are flat key->string maps placed as resource attributes (keys
        without dots flatten to themselves in the stored record).
        """
        now_ns = _now_millis() * 1_000_000
        trace_id = "a" * 16 + _rand_hex(16)
        parent_id = _rand_hex(16)

        def mk_attr(k: str, v: Any) -> dict:
            return {"key": k, "value": {"stringValue": str(v)}}

        resource_attrs = [mk_attr("service.name", service_name)] + [
            mk_attr(k, v) for k, v in attrs.items()
        ]
        spans = [
            {
                "traceId": trace_id,
                "spanId": parent_id,
                "name": "parent-op",
                "kind": 2,
                "startTimeUnixNano": str(now_ns - 5_000_000),
                "endTimeUnixNano": str(now_ns),
                "attributes": [],
                "status": {},
            }
        ]
        for i in range(child_count):
            spans.append(
                {
                    "traceId": trace_id,
                    "spanId": _rand_hex(16),
                    "parentSpanId": parent_id,
                    "name": f"child-op-{i}",
                    "kind": 3,
                    "startTimeUnixNano": str(now_ns - 4_000_000),
                    "endTimeUnixNano": str(now_ns - 1_000_000),
                    "attributes": [],
                    "status": {},
                }
            )
        data = {
            "resourceSpans": [
                {
                    "resource": {"attributes": resource_attrs},
                    "scopeSpans": [{"scope": {"name": "corr-e2e"}, "spans": spans}],
                }
            ]
        }
        resp = _request_retrying_lock(self._c, "POST", "v1/traces", org=self.org, prefix="api/", json=data)
        if resp.status_code != 200:
            raise AssertionError(f"ingest_traces failed: {resp.status_code} {resp.text}")
        return resp

    # -- service_streams API ---------------------------------------------

    def list_services(self) -> list[dict]:
        resp = self._c.get("service_streams", org=self.org)
        if resp.status_code != 200:
            raise AssertionError(f"list_services failed: {resp.status_code}")
        return resp.json()

    def correlate(
        self,
        available_dimensions: dict,
        *,
        source_stream: str = "unknown",
        source_type: str = "logs",
    ) -> tuple[int, Any]:
        """Returns (status, body) — body is None on a 200-null no-match."""
        resp = self._c.post(
            "service_streams/_correlate",
            org=self.org,
            json={
                "source_stream": source_stream,
                "source_type": source_type,
                "available_dimensions": available_dimensions,
            },
        )
        return resp.status_code, _safe_json_or_none(resp)

    def get_identity(self) -> dict:
        resp = self._c.get("service_streams/config/identity", org=self.org)
        if resp.status_code != 200:
            raise AssertionError(f"get_identity failed: {resp.status_code}")
        return resp.json()

    def save_identity(self, cfg: dict) -> tuple[int, Any]:
        """Returns (status, body) so 400-path tests can assert the message."""
        resp = _request_retrying_lock(
            self._c, "PUT", "service_streams/config/identity", org=self.org, json=cfg
        )
        return resp.status_code, _safe_json_or_none(resp)

    def get_analytics(self) -> dict:
        resp = self._c.get("service_streams/_analytics", org=self.org)
        if resp.status_code != 200:
            raise AssertionError(f"get_analytics failed: {resp.status_code}")
        return resp.json()

    def reset(self) -> Any:
        resp = _request_retrying_lock(self._c, "DELETE", "service_streams/_reset", org=self.org)
        if resp.status_code != 200:
            raise AssertionError(f"reset failed: {resp.status_code} {resp.text}")
        return _safe_json(resp)

    # -- semantic groups (Field Mappings) --------------------------------

    def get_semantic_groups(self) -> Any:
        resp = self._c.get("alerts/deduplication/semantic-groups", org=self.org)
        if resp.status_code != 200:
            raise AssertionError(f"get_semantic_groups failed: {resp.status_code}")
        return resp.json()

    def put_semantic_groups(self, groups: Any) -> tuple[int, Any]:
        resp = _request_retrying_lock(
            self._c, "PUT", "alerts/deduplication/semantic-groups", org=self.org, json=groups
        )
        return resp.status_code, _safe_json_or_none(resp)

    def add_semantic_group(self, group: dict) -> list:
        """Append a custom group to the org's current groups."""
        current = self.get_semantic_groups()
        groups = current if isinstance(current, list) else current.get("groups", [])
        nxt = [g for g in groups if g.get("id") != group["id"]] + [group]
        status, body = self.put_semantic_groups(nxt)
        if status != 200:
            raise AssertionError(f"add_semantic_group failed: {status} {body}")
        return nxt

    def remove_semantic_group(self, group_id: str) -> None:
        """Remove a group by id."""
        current = self.get_semantic_groups()
        groups = current if isinstance(current, list) else current.get("groups", [])
        status, body = self.put_semantic_groups(
            [g for g in groups if g.get("id") != group_id]
        )
        if status != 200:
            raise AssertionError(f"remove_semantic_group failed: {status} {body}")

    # -- search (for zero-row / F1 verification) -------------------------

    def search_logs(self, sql: str) -> list[dict]:
        """Run SQL against logs; returns hits array. Window: last 30 min."""
        end = _now_micros()
        start = end - 30 * 60 * 1_000_000
        resp = self._c.post(
            "_search?type=logs",
            org=self.org,
            json={
                "query": {
                    "sql": sql,
                    "start_time": start,
                    "end_time": end,
                    "from": 0,
                    "size": 100,
                }
            },
        )
        if resp.status_code != 200:
            raise AssertionError(f"search_logs failed: {resp.status_code} {resp.text}")
        return resp.json().get("hits", [])

    # -- polling ----------------------------------------------------------

    def wait_for_services(self, pred, label: str = "services") -> list[dict]:
        """Poll list_services until `pred(rows)` is truthy; return that snapshot."""

        def _check():
            rows = self.list_services()
            return rows if pred(rows) else None

        return wait_until(
            _check,
            timeout=DISCOVERY_DEADLINE_S,
            interval=POLL_INTERVAL_S,
            msg=label,
        )


def sql_for_filters(stream: str, filters: dict) -> str:
    """Build `SELECT * FROM "stream" WHERE f1='v1' AND ...` from a filters map."""
    where = " AND ".join(
        f"{k} = '{str(v).replace(chr(39), chr(39) * 2)}'" for k, v in filters.items()
    )
    return f'SELECT * FROM "{stream}"' + (f" WHERE {where}" if where else "")


# ---------------------------------------------------------------------------
# Org lifecycle
# ---------------------------------------------------------------------------

def create_correlation_org(client: OpenObserveClient, prefix: str = "corr") -> str:
    """Create a fresh org for one test's isolation. Returns its identifier.

    Names are NOT idempotent — always unique, underscores only.
    """
    name = _uniq_org(prefix)
    resp = _request_retrying_lock(client, "POST", "api/organizations", prefix="", json={"name": name})
    if resp.status_code != 200:
        raise AssertionError(f"org create failed: {resp.status_code} {resp.text}")
    body = resp.json()
    org = body.get("identifier") or (body.get("data") or {}).get("identifier")
    if not org:
        raise AssertionError(f"org create: no identifier in {body}")
    return org


def delete_org(client: OpenObserveClient, org: str) -> None:
    """Best-effort org teardown — never raises (cleanup must not fail a test)."""
    if not org:
        return
    try:
        client.delete(f"api/organizations/{org}", prefix="")
    except Exception:  # noqa: BLE001 — leak-avoidance is best-effort
        log.warning("best-effort delete_org(%s) failed", org)


# ---------------------------------------------------------------------------
# response helpers
# ---------------------------------------------------------------------------

def _safe_json(resp) -> dict:
    try:
        val = resp.json()
        return val if isinstance(val, dict) else {}
    except ValueError:
        return {}


def _safe_json_or_none(resp) -> Any:
    """Parse JSON; a literal `null` body (200-null no-match) returns None."""
    text = resp.text
    if text == "" or text is None:
        return None
    try:
        return resp.json()
    except ValueError:
        return text
