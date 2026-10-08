"""RFC3339 timestamps with 2 or 5 fractional digits and a zone are read like any other (#15058).

`parse_str_to_time` chose the zone-less `%.3f` / `%.6f` formats from the length of the text after
the last `.`, zone included, so `.12Z` and `.12345Z` failed while `.123Z` parsed.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until


@pytest.fixture
def ten_minutes_ago() -> tuple[str, int]:
    """A whole second inside the ingestion window, as RFC3339 text without a zone and as microseconds."""
    at = (datetime.now(UTC) - timedelta(minutes=10)).replace(microsecond=0)
    return at.strftime("%Y-%m-%dT%H:%M:%S"), int(at.timestamp()) * 1_000_000


def _stored(client: OpenObserveClient, stream: str) -> dict[str, int]:
    resp = client.search.sql(f'SELECT shape, _timestamp FROM "{stream}"', minutes=30, raise_for_status=False)
    if resp.status_code != 200:
        return {}
    return {hit["shape"]: hit["_timestamp"] for hit in resp.json().get("hits", [])}


@pytest.mark.parametrize(
    ("suffix", "micros"),
    [(".12Z", 120_000), (".12345Z", 123_450), (".123Z", 123_000), (".12+00:00", 120_000)],
    ids=["two-digits-z", "five-digits-z", "three-digits-z", "two-digits-offset"],
)
def test_json_ingest_stores_the_timestamp(
    client: OpenObserveClient, temp_stream_name: str, ten_minutes_ago: tuple[str, int], suffix: str, micros: int
):
    second, second_us = ten_minutes_ago
    resp = client.post(f"{temp_stream_name}/_json", json=[{"shape": suffix, "_timestamp": second + suffix}])
    assert resp.status_code == 200, resp.text
    status = resp.json()["status"][0]
    assert (status["successful"], status["failed"]) == (1, 0), f"#15058: {second + suffix} -> {status}"

    stored = wait_until(lambda: _stored(client, temp_stream_name), timeout=30, msg=f"{temp_stream_name} has no record")
    assert stored == {suffix: second_us + micros}


def test_bulk_ingest_stores_a_two_digit_fraction_with_z(
    client: OpenObserveClient, temp_stream_name: str, ten_minutes_ago: tuple[str, int]
):
    second, second_us = ten_minutes_ago
    body = "\n".join(
        [
            json.dumps({"index": {"_index": temp_stream_name}}),
            json.dumps({"shape": ".12Z", "_timestamp": second + ".12Z"}),
        ]
    )
    resp = client.post("_bulk", data=body + "\n", headers={"Content-Type": "application/json"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["errors"] is False, f"#15058: {resp.text}"

    stored = wait_until(lambda: _stored(client, temp_stream_name), timeout=30, msg=f"{temp_stream_name} has no record")
    assert stored == {".12Z": second_us + 120_000}


def test_promql_query_range_reads_start_and_end(client: OpenObserveClient, ten_minutes_ago: tuple[str, int]):
    second, _ = ten_minutes_ago
    end = datetime.now(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%S")
    resp = client.get(
        "prometheus/api/v1/query_range",
        params={"query": "up", "start": second + ".12Z", "end": end + ".12345Z", "step": "60"},
    )
    assert resp.status_code == 200, f"#15058: {resp.status_code} {resp.text}"
    assert resp.json()["status"] == "success", resp.text
