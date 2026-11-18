"""A PromQL range ending an hour ago still reads a late sample that sits only in the WAL (#16865)."""

from __future__ import annotations

import time

from support.wait import wait_until
from tests.metrics.test_promql_regressions import (  # noqa: F401
    HALF,
    _ingest,
    _metric_name,
    _promql,
    _range_query,
    _series,
    _values_of,
    created,
)


def test_range_ending_an_hour_ago_reads_a_late_sample_still_in_the_wal_16865(client, created):  # noqa: F811
    """a sample stamped two hours ago is in the WAL, which a range ending past the WAL floor skipped (#16865)."""
    metric = _metric_name("late_wal")
    now = int(time.time()) // 60 * 60
    _ingest(client, _series(metric, {"job": "e2e"}, [(now - 2 * 3600 + HALF, 7)]), created)

    def visible() -> bool:
        _, body = _promql(client, "query", {"query": f"count_over_time({metric}[3h])"})
        result = (body.get("data") or {}).get("result") or []
        return bool(result) and result[0]["value"][1] == "1"

    wait_until(visible, timeout=60, interval=1, msg=f"{metric} never became queryable up to now")
    window = {"start": now - 3 * 3600, "end": now - 3600}
    first = _values_of(_range_query(client, metric, **window))
    assert first, "the late sample is missing from [now-3h, now-1h]"
    assert set(first) == {"7"}, first
    assert _values_of(_range_query(client, metric, **window)) == first, "a repeat of the range lost the late sample"
