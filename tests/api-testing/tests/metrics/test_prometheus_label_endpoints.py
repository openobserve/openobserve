"""Prometheus label endpoints must honour a time range.

Regression test for o2-enterprise#2661: ``/labels`` and
``/label/__name__/values`` returned results without a range and an EMPTY list
with one. Grafana's metric picker always sends ``start``/``end``, so metric
autocomplete against OpenObserve returned nothing at all — while the same call
without a range looked healthy, which is why it went unnoticed.

The assertion is a comparison, not an absolute count: whatever the instance
holds, a range that spans it must not narrow the answer to nothing.
"""
from __future__ import annotations

import logging
import time
import uuid

from support.otlp_json import gauge, metrics_request, now_unix_nano
from support.wait import wait_until

logger = logging.getLogger(__name__)


def _seed_metric(client) -> str:
    name = f"promql_labels_{uuid.uuid4().hex[:8]}"
    payload = metrics_request([gauge(name, 1.0, time_unix_nano=now_unix_nano())])
    assert client.post("v1/metrics", json=payload).status_code == 200

    def visible():
        resp = client.get("prometheus/api/v1/label/__name__/values")
        return name in (resp.json().get("data") or []) if resp.status_code == 200 else False

    wait_until(visible, timeout=90, interval=3, msg=f"{name} visible to PromQL")
    return name


def test_label_endpoints_return_the_same_labels_with_and_without_a_range(client):
    _seed_metric(client)
    end = int(time.time())
    start = end - 3600
    params = {"start": start, "end": end}

    for path in ("prometheus/api/v1/labels", "prometheus/api/v1/label/__name__/values"):
        unranged = client.get(path)
        ranged = client.get(path, params=params)
        assert unranged.status_code == 200, unranged.text
        assert ranged.status_code == 200, ranged.text

        unranged_data = unranged.json().get("data") or []
        ranged_data = ranged.json().get("data") or []
        assert unranged_data, f"{path} returned nothing even without a range — bad fixture"
        assert ranged_data, (
            f"{path} returned an empty list for a range that spans the data "
            f"({len(unranged_data)} without a range). Grafana always sends a range, so this "
            f"is metric autocomplete returning nothing."
        )
