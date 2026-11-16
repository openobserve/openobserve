"""OTLP seeding, registry polls and the edition probe for the service versions API tests."""
from __future__ import annotations

import secrets
import time
import uuid
from typing import Any

from support.client import OpenObserveClient
from support.wait import wait_until

STREAM = "svcver_api_e2e"
CLUSTER = "svcver-e2e-cluster"
OSS_DENIAL = "Service versions require the enterprise build"
# The registry flushes once a minute; four flushes leave room for a loaded CI runner.
REGISTRY_TIMEOUT = 240.0
REGISTRY_POLL = 5.0
SPANS_PER_RESOURCE = 3
DAY_MICROS = 86_400_000_000


def uniq(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def now_micros() -> int:
    return time.time_ns() // 1000


def _attrs(values: dict[str, str]) -> list[dict[str, Any]]:
    return [{"key": key, "value": {"stringValue": value}} for key, value in values.items()]


def resource_spans(
    service: str,
    *,
    version: str | None = None,
    env: str | None = None,
    namespace: str | None = None,
) -> dict[str, Any]:
    """One OTLP resource of SERVER spans; `namespace` adds the k8s attributes the resolver reads."""
    resource = {"service.name": service}
    if version is not None:
        resource["service.version"] = version
    if env is not None:
        resource["deployment.environment"] = env
    if namespace is not None:
        resource |= {
            "k8s.cluster.name": CLUSTER,
            "k8s.namespace.name": namespace,
            "k8s.deployment.name": service,
            "k8s.pod.name": f"{service}-{secrets.token_hex(3)}",
        }
    start = time.time_ns()
    spans = []
    for i in range(SPANS_PER_RESOURCE):
        begin = start + i * 1_000_000
        spans.append({
            "traceId": secrets.token_hex(16),
            "spanId": secrets.token_hex(8),
            "name": "GET /svcver",
            "kind": 2,
            "startTimeUnixNano": str(begin),
            "endTimeUnixNano": str(begin + 5_000_000),
            "attributes": _attrs({"http.method": "GET", "http.route": "/svcver"}),
            "status": {"code": 1},
        })
    return {
        "resource": {"attributes": _attrs(resource)},
        "scopeSpans": [{"scope": {"name": "svcver-api-tests"}, "spans": spans}],
    }


def ingest(client: OpenObserveClient, *resources: dict[str, Any]) -> None:
    resp = client.otlp.traces_json({"resourceSpans": list(resources)}, stream=STREAM)
    assert resp.status_code == 200, f"Precondition: spans must ingest, got {resp.status_code}: {resp.text}"


def list_versions(client: OpenObserveClient, service: str, **params: str) -> list[dict[str, Any]]:
    resp = client.get("service_versions", params={"service": service, **params})
    assert resp.status_code == 200, resp.text
    return resp.json()["versions"]


def wait_for_versions(client: OpenObserveClient, service: str, expected: set[str]) -> dict[str, dict[str, Any]]:
    """Poll until every expected version of `service` is listed; returns the rows keyed by version."""

    def listed() -> dict[str, dict[str, Any]] | None:
        rows = {row["version"]: row for row in list_versions(client, service)}
        return rows if expected <= rows.keys() else None

    return wait_until(
        listed,
        timeout=REGISTRY_TIMEOUT,
        interval=REGISTRY_POLL,
        msg=f"versions {sorted(expected)} of {service} in the registry",
    )


def catalog(client: OpenObserveClient, **params: str) -> list[dict[str, Any]]:
    resp = client.get("service_versions/_services", params=params)
    assert resp.status_code == 200, resp.text
    return resp.json()["services"]


def build_type(client: OpenObserveClient) -> str:
    resp = client.get("config", prefix="")
    assert resp.status_code == 200, f"GET /config: {resp.status_code} {resp.text[:200]}"
    kind = resp.json().get("build_type")
    assert kind, f"GET /config carries no build_type: {resp.text[:200]}"
    return kind


def service_versions_served(client: OpenObserveClient) -> bool:
    """False only on an OSS build that denies the routes; any other non-200 fails the run."""
    resp = client.get("service_identity/envs")
    if resp.status_code == 200:
        return True
    kind = build_type(client)
    if kind == "opensource" and resp.status_code == 403 and OSS_DENIAL in resp.text:
        return False
    raise AssertionError(
        f"service versions probe: HTTP {resp.status_code} on a {kind} build — {resp.text[:200]}"
    )
