"""HTTP-layer regression lock for stream delete_fields reserved-column guard.

Verifies PUT /api/{org}/streams/{stream}/delete_fields rejects the reserved
columns _timestamp and _all with 400 while still deleting a real field.

Reference: openobserve#14331 — guard in src/stream/src/lib.rs (find_reserved_field).
"""
from __future__ import annotations

import logging
from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until

logger = logging.getLogger(__name__)

STREAM_TYPE = "logs"
ROW_COUNT = 5


def _schema_field_names(client: OpenObserveClient, stream_name: str) -> list[str]:
    """Return the list of field names in the stream schema."""
    return [f["name"] for f in client.streams.schema(stream_name).get("schema", [])]


def _count_rows(client: OpenObserveClient, stream_name: str) -> int:
    """Return COUNT(*) for the stream via the search API."""
    return client.search.count(f'SELECT COUNT(*) AS count FROM "{stream_name}"')


def _delete_fields(client: OpenObserveClient, stream_name: str, fields: list[str]):
    """PUT the delete_fields request; return the response (no wrapper exists)."""
    return client.put(
        f"streams/{stream_name}/delete_fields?type={STREAM_TYPE}",
        json={"fields": fields},
    )


class TestDeleteFieldsReserved:
    """delete_fields must reject reserved columns but allow real fields."""

    @pytest.fixture(scope="class")
    def seed_stream(self, client: OpenObserveClient) -> Generator[str, None, None]:
        """Create a fresh logs stream with 5 rows; drop it after the class."""
        stream_name = unique_name("del_fields_reserved")
        rows = [{"a": f"val_a_{i}", "b": f"val_b_{i}"} for i in range(ROW_COUNT)]
        client.streams.ingest_json(stream_name, rows)

        wait_until(
            lambda: _count_rows(client, stream_name) == ROW_COUNT,
            timeout=30,
            interval=0.5,
            msg=f"{ROW_COUNT} rows not searchable in {stream_name}",
        )
        fields = _schema_field_names(client, stream_name)
        assert "_timestamp" in fields, f"_timestamp missing from schema: {fields}"
        assert "a" in fields, f"seed field a missing: {fields}"
        assert "b" in fields, f"seed field b missing: {fields}"

        yield stream_name

        try:
            client.streams.delete(stream_name, type_=STREAM_TYPE)
        except Exception as e:
            logger.warning("seed_stream cleanup failed for %s: %s", stream_name, e)

    def test_01_delete_timestamp_rejected_400(self, client: OpenObserveClient, seed_stream: str):
        """Deleting _timestamp returns 400 with the reserved-field message."""
        resp = _delete_fields(client, seed_stream, ["_timestamp"])
        assert resp.status_code == 400, (
            f"Expected 400 deleting _timestamp, got {resp.status_code}: {resp.text}"
        )
        assert "field [_timestamp] is reserved and cannot be deleted" in resp.text, (
            f"Missing reserved-field message: {resp.text}"
        )

        fields = _schema_field_names(client, seed_stream)
        assert "_timestamp" in fields, f"_timestamp should still be present: {fields}"
        assert _count_rows(client, seed_stream) == ROW_COUNT, "Row count changed"

    def test_02_delete_all_column_rejected_400(self, client: OpenObserveClient, seed_stream: str):
        """Deleting the reserved _all column returns 400."""
        resp = _delete_fields(client, seed_stream, ["_all"])
        assert resp.status_code == 400, (
            f"Expected 400 deleting _all, got {resp.status_code}: {resp.text}"
        )
        assert "field [_all] is reserved and cannot be deleted" in resp.text, (
            f"Missing reserved-field message: {resp.text}"
        )
        assert _count_rows(client, seed_stream) == ROW_COUNT, "Row count changed"

    def test_03_delete_real_field_succeeds(self, client: OpenObserveClient, seed_stream: str):
        """Control: deleting a real field (b) returns 200 and drops it."""
        resp = _delete_fields(client, seed_stream, ["b"])
        assert resp.status_code == 200, (
            f"Expected 200 deleting real field b, got {resp.status_code}: {resp.text}"
        )

        def _b_gone():
            return "b" not in _schema_field_names(client, seed_stream)

        wait_until(_b_gone, timeout=15, interval=0.5, msg="field b still in schema after delete")
        fields = _schema_field_names(client, seed_stream)
        assert "_timestamp" in fields, f"_timestamp must survive control delete: {fields}"
        assert "a" in fields, f"unrelated field a must survive control delete: {fields}"
