"""OTLP seeding, registry polls and the edition probe for the service versions API tests."""
from __future__ import annotations

import secrets
import time
import uuid
from typing import Any

from support.client import OpenObserveClient
from support.wait import wait_until

STREAM = "svcver_api_e2e"
ALIASES = "service_identity/aliases"
OVERRIDES = "service_identity/overrides"
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


def delete_versions(client: OpenObserveClient, *services: str) -> None:
    """Delete every registry version of `services`; a version already gone answers 200 or 404."""
    for service in services:
        for row in list_versions(client, service):
            resp = client.delete(f"service_versions/{row['version_key']}")
            assert resp.status_code in (200, 404), resp.text


def compare_body(seeded: dict[str, Any], new: str, old: str, **changes: Any) -> dict[str, Any]:
    body = {
        "service": seeded["service"],
        "where": seeded["versions"][new]["where_key"],
        "a": {"version": new},
        "b": {"version": old},
        "signals": ["traces"],
    }
    return body | changes


def listed(client: OpenObserveClient, q: str, **params: str) -> dict[str, dict[str, Any]]:
    resp = client.get(ALIASES, params={"q": q, "limit": "1000", **params})
    assert resp.status_code == 200, resp.text
    return {row["alias_key"]: row for row in resp.json()["aliases"]}


def service_override(seeded: dict[str, Any], value: str, **changes: str) -> dict[str, str]:
    body = {
        "scope": "service",
        "service_name": seeded["service"],
        "where_key": seeded["where_key"],
        "k8s_cluster": CLUSTER,
        "value": value,
    }
    return body | changes


def overrides_for(client: OpenObserveClient, service: str) -> dict[str, dict[str, Any]]:
    resp = client.get(OVERRIDES, params={"q": service})
    assert resp.status_code == 200, resp.text
    return {row["rule_key"]: row for row in resp.json()["overrides"]}


def unversioned(client: OpenObserveClient) -> dict[str, dict[str, Any]]:
    resp = client.get("service_identity/unresolved", params={"limit": "1000"})
    assert resp.status_code == 200, resp.text
    return {row["service"]: row for row in resp.json()["no_version"]}


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
