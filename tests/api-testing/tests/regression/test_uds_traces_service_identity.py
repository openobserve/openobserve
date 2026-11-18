"""A traces stream with a user-defined schema keeps the service identity columns (#16861).

Before the fix the traces UDS kept the derived `infer_*` and `gen_ai` columns but not `o2_service_where/env/version/image`,
so spans on such a stream stored them as NULL and the version signals read from the stream never resolved. Stamping is enterprise-only
(the test skips on OSS) and a UDS needs ZO_ALLOW_USER_DEFINED_SCHEMAS=true, which the `uds_enabled` regression shard sets.
"""

from __future__ import annotations

from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import search_payload, time_window, unique_name
from support.wait import wait_until
from tests.service_versions.svcver_helpers import (
    CLUSTER,
    delete_versions,
    resource_spans,
    service_versions_served,
    uniq,
)

IDENTITY_COLUMNS = ("o2_service_where", "o2_service_env", "o2_service_version", "o2_service_image")
SEED_VERSION, UDS_VERSION = "2.0.0", "2.1.0"
IMAGE_ID = "sha256:" + "4f2c9a1" + "0" * 57
IMAGE = "4f2c9a1"


@pytest.fixture(scope="module")
def uds_stream(client: OpenObserveClient) -> Generator[dict[str, Any], None, None]:
    """A traces stream whose UDS lists one user attribute, then spans of a k8s prod service with an image."""
    if not service_versions_served(client):
        pytest.skip("service identity stamping is enterprise-only and this is an OSS build")
    stream, service, namespace = unique_name("pytest_uds_svcid"), uniq("svcver-uds"), uniq("svcver-ns")
    _ingest(client, stream, service, SEED_VERSION, namespace)
    wait_until(lambda: _schema(client, stream), timeout=60, msg=f"{stream} was never created")
    resp = client.streams.update_settings(stream, type_="traces", defined_schema_fields={"add": ["http_route"]})
    assert resp.status_code == 200, f"saving the UDS failed (is ZO_ALLOW_USER_DEFINED_SCHEMAS on?): {resp.text}"
    saved = client.get(f"streams/{stream}/schema", params={"type": "traces"}).json()["settings"].get("defined_schema_fields") or []
    assert "http_route" in saved, f"the UDS was not saved: {saved}"
    _ingest(client, stream, service, UDS_VERSION, namespace)
    yield {"stream": stream, "service": service, "namespace": namespace, "uds": set(saved)}
    delete_versions(client, service)
    client.streams.delete(stream, type_="traces")


def _ingest(client: OpenObserveClient, stream: str, service: str, version: str, namespace: str) -> None:
    resource = resource_spans(service, version=version, env="production", namespace=namespace)
    resource["resource"]["attributes"].append({"key": "container.image.id", "value": {"stringValue": IMAGE_ID}})
    resp = client.otlp.traces_json({"resourceSpans": [resource]}, stream=stream)
    assert resp.status_code == 200, f"Precondition: spans must ingest, got {resp.status_code}: {resp.text}"


def _schema(client: OpenObserveClient, stream: str) -> set[str]:
    resp = client.get(f"streams/{stream}/schema", params={"type": "traces"})
    return {field["name"] for field in resp.json().get("schema", [])} if resp.status_code == 200 else set()


def _uds_rows(client: OpenObserveClient, stream: str) -> list[dict[str, Any]]:
    start, end = time_window(minutes=30)
    columns = ", ".join(IDENTITY_COLUMNS)
    sql = f"SELECT {columns} FROM \"{stream}\" WHERE o2_service_version = '{UDS_VERSION}'"
    resp = client.post("_search", params={"type": "traces"}, json=search_payload(sql, start_time=start, end_time=end))
    return resp.json().get("hits", []) if resp.status_code == 200 else []


def test_spans_after_the_uds_save_keep_every_identity_column(client: OpenObserveClient, uds_stream):
    stream = uds_stream["stream"]

    rows = wait_until(
        lambda: _uds_rows(client, stream),
        timeout=60,
        msg=f"no span of {stream} has o2_service_version = '{UDS_VERSION}'; the UDS dropped the identity columns",
    )

    where = f"k8s:{CLUSTER}/{uds_stream['namespace']}"
    assert [(r["o2_service_where"], r["o2_service_env"], r["o2_service_image"]) for r in rows] == [(where, "prod", IMAGE)] * 3, rows


def test_the_saved_uds_lists_the_identity_columns(uds_stream):
    assert set(IDENTITY_COLUMNS) <= uds_stream["uds"], sorted(uds_stream["uds"])
