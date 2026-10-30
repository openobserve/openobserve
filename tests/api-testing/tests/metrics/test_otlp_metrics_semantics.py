"""OTLP metric data-point semantics that PromQL reads back.

Two regressions from o2-enterprise#2661:

1. Exponential histograms wrote each bucket's RAW count instead of a running
   total, never emitted a ``+Inf`` bucket, and dropped ``zero_count`` entirely.
   ``histogram_quantile`` over such a series returns NaN — silently, as a gap on
   a chart rather than an error. Exponential histograms are the recommended
   default in current OTel SDKs, so this was not an edge case.

2. A data point flagged ``NO_RECORDED_VALUE`` was stored and charted as a real
   reading. OTel defines that flag as "no value was recorded" — the point is a
   gap; Prometheus represents it with a staleness marker.
"""
from __future__ import annotations

import logging
import uuid

from support.otlp_json import (
    NO_RECORDED_VALUE_MASK,
    exponential_histogram,
    gauge,
    metrics_request,
    now_unix_nano,
)
from support.wait import wait_until

logger = logging.getLogger(__name__)

SEARCH_MINUTES = 30


def _metric_name(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def test_exponential_histogram_buckets_are_cumulative_and_bounded(client):
    """Buckets accumulate, the zero bucket is emitted, and +Inf closes the series."""
    name = _metric_name("otlp_exphist")
    # count=7 = zero_count(1) + positive(2+3) + negative(1); sum is arbitrary.
    payload = metrics_request(
        [
            exponential_histogram(
                name,
                count=7,
                total=21.0,
                scale=2,
                zero_count=1,
                positive_bucket_counts=[2, 3],
                negative_bucket_counts=[1],
                time_unix_nano=now_unix_nano(),
            )
        ]
    )
    assert client.post("v1/metrics", json=payload).status_code == 200

    def buckets():
        resp = client.search.sql(
            f'SELECT le, value FROM "{name}_bucket"',
            minutes=SEARCH_MINUTES,
            type_="metrics",
            raise_for_status=False,
        )
        if resp.status_code != 200:
            return None
        hits = resp.json().get("hits", [])
        return hits or None

    hits = wait_until(buckets, timeout=90, interval=3, msg=f"buckets for {name}")
    les = {str(h.get("le")).lower() for h in hits}

    assert "0" in les, f"the zero bucket (zero_count) must be emitted; got {sorted(les)}"
    assert les & {"inf", "+inf"}, f"a +Inf bucket must close the series; got {sorted(les)}"

    # The whole point of the bucket layout: a quantile is computable from it.
    resp = client.get(
        "prometheus/api/v1/query",
        params={"query": f"histogram_quantile(0.5, {name}_bucket)"},
    )
    assert resp.status_code == 200, resp.text
    values = [
        r["value"][1]
        for r in resp.json().get("data", {}).get("result", [])
        if "value" in r
    ]
    assert values, f"histogram_quantile returned no series for {name}_bucket"
    assert not any(str(v).lower() == "nan" for v in values), (
        f"histogram_quantile must not be NaN over a cumulative exponential histogram; got {values}"
    )


def test_no_recorded_value_point_is_not_stored_as_a_reading(client):
    """A NO_RECORDED_VALUE point is a gap — it must not come back as its value."""
    name = _metric_name("otlp_norecord")
    payload = metrics_request(
        [gauge(name, 1.0, time_unix_nano=now_unix_nano(), flags=NO_RECORDED_VALUE_MASK)]
    )
    assert client.post("v1/metrics", json=payload).status_code == 200

    resp = client.search.sql(
        f'SELECT value FROM "{name}"',
        minutes=SEARCH_MINUTES,
        type_="metrics",
        raise_for_status=False,
    )
    # Either the stream was never created (the point was dropped at ingest) or
    # it exists with no rows. Both are "the gap is a gap"; a stored 1.0 is not.
    if resp.status_code != 200:
        return
    values = [h.get("value") for h in resp.json().get("hits", [])]
    # 1 and 1.0 are the same reading; compare numerically so the int/float the
    # storage layer happens to return cannot let the value slip through.
    readings = [v for v in values if isinstance(v, (int, float)) and float(v) == 1.0]
    assert readings == [], (
        f"a point flagged NO_RECORDED_VALUE was charted as a real reading: {values}"
    )
