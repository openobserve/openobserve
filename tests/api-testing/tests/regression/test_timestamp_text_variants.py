"""Space-separated and ISO 8601 timestamp text is stored at its own instant (#16565, #16907)."""

from __future__ import annotations

import pytest

from support.client import OpenObserveClient
from support.wait import wait_until
from tests.ingest.test_rfc3339_timestamp_fractions import ten_minutes_ago  # noqa: F401


def _stored(client: OpenObserveClient, stream: str) -> dict[str, int]:
    # A +01:00 offset lands an hour before the local clock, outside a 30-minute search.
    resp = client.search.sql(f'SELECT shape, _timestamp FROM "{stream}"', minutes=180, raise_for_status=False)
    if resp.status_code != 200:
        return {}
    return {hit["shape"]: hit["_timestamp"] for hit in resp.json().get("hits", [])}


@pytest.mark.parametrize(
    ("template", "offset_us"),
    [
        ("{d} {t}.123456", 123_456),
        ("{d} {t}+00:00", 0),
        ("{d} {t}.12+01:00", 120_000 - 3_600_000_000),
        ("{d}T{t}.5", 500_000),
        ("{d}T{t}.123456789", 123_456),
        ("{d}T{t}+0000", 0),
        ("{d}T{t}.123456+0100", 123_456 - 3_600_000_000),
        ("{d}T{t},123", 123_000),
        ("{d} {t},5+00", 500_000),
    ],
    ids=[
        "space-six-digits",
        "space-offset",
        "space-fraction-colon-offset",
        "t-one-digit-no-zone",
        "t-nine-digits-no-zone",
        "t-colonless-offset",
        "t-colonless-nonzero-offset",
        "t-comma-decimal",
        "space-comma-hour-offset",
    ],
)
def test_json_ingest_reads_space_separated_and_iso8601_variants(
    client: OpenObserveClient, temp_stream_name: str, ten_minutes_ago: tuple[str, int], template: str, offset_us: int  # noqa: F811
):
    """#16565 / #16907: these shapes were refused or stored at ingest time instead of their own instant."""
    second, second_us = ten_minutes_ago
    day, clock = second.split("T")
    text = template.format(d=day, t=clock)
    resp = client.post(f"{temp_stream_name}/_json", json=[{"shape": text, "_timestamp": text}])
    assert resp.status_code == 200, resp.text
    status = resp.json()["status"][0]
    assert (status["successful"], status["failed"]) == (1, 0), f"{text} -> {status}"

    stored = wait_until(
        lambda: _stored(client, temp_stream_name), timeout=30, msg=f"{temp_stream_name} has no record"
    )
    assert stored == {text: second_us + offset_us}
