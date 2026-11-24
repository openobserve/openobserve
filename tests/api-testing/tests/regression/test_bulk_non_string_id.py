"""A `_json` or `_bulk` record whose `_id` is not a string is stored, not dropped with the connection (#16608)."""

from __future__ import annotations

from support.client import OpenObserveClient
from support.wait import wait_until
from tests.ingest.test_bulk import _bulk_post, _ndjson


def _stored_markers(client: OpenObserveClient, stream: str, want: set[str]) -> set[str] | None:
    resp = client.search.sql(f'SELECT m FROM "{stream}"', minutes=30, size=50, raise_for_status=False)
    if resp.status_code != 200:
        return None
    stored = {h.get("m") for h in resp.json().get("hits", [])}
    return stored if want <= stored else None


def test_json_and_bulk_records_with_a_non_string_id_are_stored(client: OpenObserveClient, temp_stream_name: str):
    """openobserve#16608: a record whose `_id` is a number, bool or null panicked the writer and dropped the connection."""
    json_rows = [{"_id": 123, "m": "json-number"}, {"_id": True, "m": "json-bool"}, {"_id": None, "m": "json-null"}]
    resp = client.post(f"{temp_stream_name}/_json", json=json_rows)
    assert resp.status_code == 200, resp.text
    status = resp.json()["status"][0]
    assert (status["successful"], status["failed"]) == (3, 0), status

    bulk_rows = [{"_id": 456, "m": "bulk-number"}, {"_id": False, "m": "bulk-bool"}, {"_id": None, "m": "bulk-null"}]
    resp = _bulk_post(client, _ndjson([line for row in bulk_rows for line in ({"index": {"_index": temp_stream_name}}, row)]))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["errors"] is False, body
    assert [item["index"]["status"] for item in body["items"]] == [200, 200, 200], body

    want = {row["m"] for row in json_rows + bulk_rows}
    wait_until(
        lambda: _stored_markers(client, temp_stream_name, want), timeout=30, msg=f"not every record was stored in {temp_stream_name}"
    )
