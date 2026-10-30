"""Splunk HEC ingestion-window API tests (behavioural coverage for PR #14613).

This PR's Playwright specs (#14641) cover the SplunkHec setup page (the UI).
This suite covers the server-side behaviour that page documents and that the
feature PR #14613 actually changed:

- an out-of-window event still answers ``{"text":"Success","code":0}`` (the
  wire contract #14613 deliberately kept), yet stores nothing;
- a mixed batch keeps the in-window records and silently drops the stale ones;
- each drop increments ``zo_ingest_records_dropped_total{reason=ingestion_window}``,
  the new signal that makes an otherwise-silent drop alertable.

It provisions its own Splunk HEC token so it exercises the real root-mounted
``/services/collector`` endpoint rather than a stand-in ingest path.

The "stale" offset is derived from the server's own ZO_INGEST_ALLOWED_UPTO so
the events are genuinely out of window whatever that is set to (CI raises it to
48h for backfill tests); searches use a window WIDE enough to span the stale
timestamp, so a record that was wrongly stored instead of dropped is caught
rather than hidden behind a short lookback.
"""
from __future__ import annotations

import json
import logging
import os
import time
import uuid

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.wait import wait_until

logger = logging.getLogger(__name__)

# The server drops events older than ZO_INGEST_ALLOWED_UPTO hours (default 5;
# CI sets 48 for backfill tests). Read the same value the server runs with and
# push the stale events a full day past it so they are unambiguously dropped.
WINDOW_HOURS = int(os.environ.get("ZO_INGEST_ALLOWED_UPTO", "5"))
STALE_OFFSET_SECONDS = (WINDOW_HOURS + 24) * 60 * 60

# Search back past the stale timestamp (+2 days) so a row that was stored at its
# stale time instead of dropped is found — a short lookback would hide it and
# turn a non-drop into a false "dropped" pass.
SEARCH_MINUTES = int(STALE_OFFSET_SECONDS / 60) + 2 * 24 * 60

DROP_METRIC = "zo_ingest_records_dropped_total"


# ----- helpers -----


def _collector_post(client: OpenObserveClient, guid: str, body: str):
    """POST a raw HEC body to the root-mounted collector as a Splunk credential.

    The per-request Authorization overrides the session's Basic header; the
    collector authorises only the ``Splunk <guid>`` scheme.
    """
    return client.post(
        "services/collector",
        prefix="",
        data=body,
        headers={"Authorization": f"Splunk {guid}"},
        raise_for_status=False,
    )


def _event(marker: str, *, index: str, time_seconds: float | None) -> str:
    """One HEC event as a JSON object string. ``time_seconds=None`` omits time."""
    obj: dict = {"event": {"log": "hec window test", "marker": marker}, "index": index}
    if time_seconds is not None:
        obj["time"] = time_seconds
    return json.dumps(obj)


def _marker_count(client: OpenObserveClient, index: str, marker: str) -> int:
    """Rows in ``index`` carrying ``marker``; 0 if the stream does not exist yet.

    The window spans past the stale timestamp on purpose: a stale row that was
    stored rather than dropped must be visible here so the test can fail on it.
    """
    resp = client.search.sql(
        f"SELECT COUNT(*) AS count FROM \"{index}\" WHERE marker = '{marker}'",
        minutes=SEARCH_MINUTES,
        raise_for_status=False,
    )
    if resp.status_code != 200:
        return 0
    hits = resp.json().get("hits", [])
    return int(hits[0].get("count", 0)) if hits else 0


def _dropped_by_window(metrics_text: str, org: str) -> int:
    """Sum ``zo_ingest_records_dropped_total`` series for org + ingestion_window."""
    total = 0
    for line in metrics_text.splitlines():
        if not line.startswith(DROP_METRIC + "{"):
            continue
        if f'organization="{org}"' not in line or 'reason="ingestion_window"' not in line:
            continue
        total += int(float(line.rsplit(" ", 1)[1]))
    return total


# ----- fixtures -----


@pytest.fixture(scope="module")
def hec_guid(client: OpenObserveClient):
    """A live Splunk HEC token GUID for the test org.

    Minted via the ingestion-tokens API, then polled until the collector's
    in-memory token cache has picked it up (an unloaded cache answers 503, an
    unknown GUID 403), so tests never race the cache load.
    """
    name = unique_name("pytest_hec")
    resp = client.post(
        "ingestion-tokens",
        json={"name": name, "splunk_token": True},
        raise_for_status=False,
    )
    assert resp.status_code == 200, f"token create failed: {resp.status_code} {resp.text}"
    guid = resp.json().get("data", {}).get("splunk_token")
    assert guid, f"no splunk_token minted: {resp.text}"

    def _token_live() -> bool:
        probe = _collector_post(
            client, guid, _event(uuid.uuid4().hex, index=unique_name("probe"), time_seconds=None)
        )
        return probe.status_code == 200 and probe.json().get("code") == 0

    wait_until(_token_live, timeout=30, interval=1.0, msg="splunk token not live on collector")

    yield guid

    client.patch(
        f"ingestion-tokens/{name}", json={"enabled": False}, raise_for_status=False
    )


# ----- health -----


def test_health_endpoint_is_unauthenticated_and_reports_code_17(client: OpenObserveClient):
    """GET /services/collector/health needs no auth and returns the Splunk health code."""
    resp = client.get("services/collector/health", prefix="", raise_for_status=False)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {"text": "HEC is healthy", "code": 17}, body


# ----- happy path (control) -----


def test_in_window_event_is_stored(client: OpenObserveClient, hec_guid: str):
    """A current-time event is accepted with code 0 and becomes searchable."""
    index = unique_name("hecwin")
    marker = uuid.uuid4().hex
    resp = _collector_post(
        client, hec_guid, _event(marker, index=index, time_seconds=time.time())
    )
    assert resp.status_code == 200, resp.text
    assert resp.json().get("code") == 0, resp.text

    wait_until(
        lambda: _marker_count(client, index, marker) >= 1,
        timeout=30,
        interval=1.0,
        msg="in-window event never became searchable",
    )


# ----- wire contract: stale drop still answers code 0 -----


def test_stale_event_returns_success_code_0(client: OpenObserveClient, hec_guid: str):
    """An out-of-window event still answers {"text":"Success","code":0}.

    This is the contract #14613 deliberately preserved: returning an error code
    would make a Splunk client discard the whole batch on a few stale events.
    """
    index = unique_name("hecwin")
    resp = _collector_post(
        client,
        hec_guid,
        _event(uuid.uuid4().hex, index=index, time_seconds=time.time() - STALE_OFFSET_SECONDS),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"text": "Success", "code": 0}, resp.text


# ----- partial drop: fresh kept, stale dropped -----


def test_mixed_batch_stores_in_window_and_drops_stale(
    client: OpenObserveClient, hec_guid: str
):
    """A batch of one fresh + one stale event: fresh is stored, stale is not.

    The fresh row is the readiness gate — once it is searchable the batch has
    been processed, so the stale row's absence (searched over a window that
    spans its timestamp) is a real drop, not ingest lag or a lookback miss.
    """
    index = unique_name("hecwin")
    fresh, stale = uuid.uuid4().hex, uuid.uuid4().hex
    body = "\n".join(
        [
            _event(fresh, index=index, time_seconds=time.time()),
            _event(stale, index=index, time_seconds=time.time() - STALE_OFFSET_SECONDS),
        ]
    )
    resp = _collector_post(client, hec_guid, body)
    assert resp.status_code == 200, resp.text
    assert resp.json().get("code") == 0, resp.text

    wait_until(
        lambda: _marker_count(client, index, fresh) >= 1,
        timeout=30,
        interval=1.0,
        msg="in-window row of the mixed batch never became searchable",
    )
    assert _marker_count(client, index, stale) == 0, "stale row should have been dropped"


# ----- the new drop signal -----


def test_stale_drop_increments_records_dropped_metric(
    client: OpenObserveClient, hec_guid: str
):
    """Window drops raise zo_ingest_records_dropped_total{reason=ingestion_window}.

    The batch carries one in-window record so it is a PARTIAL drop: a batch with
    nothing left to write fast-returns before the counting path (ingest.rs "if no
    data, fast return"), so a wholly-discarded batch increments nothing. The real
    case this counter is for — a source with clock skew losing some records — is
    exactly this partial drop.

    Skips when Prometheus export is off (ZO_PROMETHEUS_ENABLED), since /metrics
    then serves an empty body and the counter is unobservable over the API.
    """
    metrics = client.get("metrics", prefix="", raise_for_status=False)
    assert metrics.status_code == 200, metrics.text
    if DROP_METRIC not in metrics.text and "zo_" not in metrics.text:
        pytest.skip("Prometheus export disabled (ZO_PROMETHEUS_ENABLED); counter unobservable")

    before = _dropped_by_window(metrics.text, client.org)

    n = 3
    index = unique_name("hecwin")
    stale = time.time() - STALE_OFFSET_SECONDS
    events = [_event(uuid.uuid4().hex, index=index, time_seconds=time.time())]
    events += [_event(uuid.uuid4().hex, index=index, time_seconds=stale) for _ in range(n)]
    resp = _collector_post(client, hec_guid, "\n".join(events))
    assert resp.status_code == 200, resp.text
    assert resp.json().get("code") == 0, resp.text

    # Counter is not stream-labelled and the instance is shared, so assert a
    # monotonic increase of at least n rather than an exact delta.
    wait_until(
        lambda: _dropped_by_window(
            client.get("metrics", prefix="", raise_for_status=False).text, client.org
        )
        >= before + n,
        timeout=30,
        interval=1.0,
        msg=f"{DROP_METRIC} did not rise by at least {n}",
    )
