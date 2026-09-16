"""HTTP-layer regression lock for stream delete_fields reserved-column guard.

Verifies PUT /api/{org}/streams/{stream}/delete_fields rejects the reserved
columns _timestamp and _all with 400 while still deleting a real field.

Reference: openobserve#14331 — guard in src/stream/src/lib.rs (find_reserved_field).
"""

import logging
import os
import time

import pytest

from support.wait import wait_until

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
STREAM_TYPE = "logs"
ROW_COUNT = 5


def _ingest_rows(session, base_url, stream_name):
    """Ingest ROW_COUNT logs rows with fields a and b."""
    rows = [{"a": f"val_a_{i}", "b": f"val_b_{i}"} for i in range(ROW_COUNT)]
    url = f"{base_url}api/{ORG_ID}/{stream_name}/_json"
    resp = session.post(url, json=rows, headers={"Content-Type": "application/json"})
    assert resp.status_code == 200, f"Ingest failed: {resp.status_code} {resp.text[:500]}"


def _schema_field_names(session, base_url, stream_name):
    """Return the list of field names in the stream schema."""
    url = f"{base_url}api/{ORG_ID}/streams/{stream_name}/schema?type={STREAM_TYPE}"
    resp = session.get(url)
    assert resp.status_code == 200, f"Schema fetch failed: {resp.status_code} {resp.text[:500]}"
    return [f["name"] for f in resp.json().get("schema", [])]


def _count_rows(session, base_url, stream_name):
    """Return COUNT(*) for the stream over a wide window via the search API."""
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    payload = {
        "query": {
            "sql": f'SELECT COUNT(*) AS c FROM "{stream_name}"',
            "start_time": int((now - timedelta(weeks=2)).timestamp() * 1_000_000),
            "end_time": int(now.timestamp() * 1_000_000),
            "from": 0,
            "size": 1,
        }
    }
    resp = session.post(f"{base_url}api/{ORG_ID}/_search?type={STREAM_TYPE}", json=payload)
    if resp.status_code != 200:
        return -1
    hits = resp.json().get("hits", [])
    return hits[0].get("c", 0) if hits else 0


def _delete_fields(session, base_url, stream_name, fields):
    """PUT the delete_fields request; return the response."""
    url = f"{base_url}api/{ORG_ID}/streams/{stream_name}/delete_fields?type={STREAM_TYPE}"
    return session.put(url, json={"fields": fields}, headers={"Content-Type": "application/json"})


class TestDeleteFieldsReserved:
    """delete_fields must reject reserved columns but allow real fields."""

    _stream_name = None

    @pytest.fixture(scope="class", autouse=True)
    def seed_stream(self, create_session, base_url):
        """Create a fresh logs stream with 5 rows; drop it after the class."""
        session = create_session
        stream_name = f"del_fields_reserved_{int(time.time() * 1000)}"
        TestDeleteFieldsReserved._stream_name = stream_name

        _ingest_rows(session, base_url, stream_name)
        wait_until(
            lambda: _count_rows(session, base_url, stream_name) == ROW_COUNT,
            timeout=30,
            interval=0.5,
            msg=f"{ROW_COUNT} rows not searchable in {stream_name}",
        )
        fields = _schema_field_names(session, base_url, stream_name)
        assert "_timestamp" in fields, f"_timestamp missing from schema: {fields}"
        assert "a" in fields and "b" in fields, f"seed fields missing: {fields}"

        yield

        session.delete(f"{base_url}api/{ORG_ID}/streams/{stream_name}?type={STREAM_TYPE}")

    def test_01_delete_timestamp_rejected_400(self, create_session, base_url):
        """Deleting _timestamp returns 400 with the reserved-field message."""
        session = create_session
        stream_name = TestDeleteFieldsReserved._stream_name

        resp = _delete_fields(session, base_url, stream_name, ["_timestamp"])
        assert resp.status_code == 400, (
            f"Expected 400 deleting _timestamp, got {resp.status_code}: {resp.text}"
        )
        assert "field [_timestamp] is reserved and cannot be deleted" in resp.text, (
            f"Missing reserved-field message: {resp.text}"
        )

        fields = _schema_field_names(session, base_url, stream_name)
        assert "_timestamp" in fields, f"_timestamp should still be present: {fields}"
        assert _count_rows(session, base_url, stream_name) == ROW_COUNT, "Row count changed"

    def test_02_delete_all_column_rejected_400(self, create_session, base_url):
        """Deleting the reserved _all column returns 400."""
        session = create_session
        stream_name = TestDeleteFieldsReserved._stream_name

        resp = _delete_fields(session, base_url, stream_name, ["_all"])
        assert resp.status_code == 400, (
            f"Expected 400 deleting _all, got {resp.status_code}: {resp.text}"
        )
        assert "field [_all] is reserved and cannot be deleted" in resp.text, (
            f"Missing reserved-field message: {resp.text}"
        )
        assert _count_rows(session, base_url, stream_name) == ROW_COUNT, "Row count changed"

    def test_03_delete_real_field_succeeds(self, create_session, base_url):
        """Control: deleting a real field (b) returns 200 and drops it."""
        session = create_session
        stream_name = TestDeleteFieldsReserved._stream_name

        resp = _delete_fields(session, base_url, stream_name, ["b"])
        assert resp.status_code == 200, (
            f"Expected 200 deleting real field b, got {resp.status_code}: {resp.text}"
        )

        def _b_gone():
            return "b" not in _schema_field_names(session, base_url, stream_name)

        wait_until(_b_gone, timeout=15, interval=0.5, msg="field b still in schema after delete")
        fields = _schema_field_names(session, base_url, stream_name)
        assert "_timestamp" in fields, f"_timestamp must survive control delete: {fields}"
        assert "a" in fields, f"unrelated field a must survive control delete: {fields}"
