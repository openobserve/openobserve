"""Profiles result-size limit: more than 99 999 unique stacks marks merge and diff `truncated` (feature §3.5, §3.7)."""

from __future__ import annotations

import pytest

from support.client import OpenObserveClient

from .profiles_helpers import (
    NS,
    ProfilesBuilder,
    child,
    cpu,
    ingest_proto,
    now_ns,
    query,
    recent_window,
    wait_merge_total,
)

LIGHT_STACKS = 100_000
HEAVY_VALUE = 1_000_000
TOTAL = LIGHT_STACKS + HEAVY_VALUE
RESULT_SIZE = 99_999


@pytest.mark.slow
def test_lim01_more_unique_stacks_than_result_size(client: OpenObserveClient, prof_stream: str):
    b = ProfilesBuilder()
    samples = [b.sample([f"lim_{i:06d}", "lim_root"], values=[1]) for i in range(LIGHT_STACKS)]
    samples.append(b.sample(["heavy_leaf", "lim_root"], values=[HEAVY_VALUE]))
    b.resource([b.profile(samples, time_ns=now_ns() - 60 * NS)], {"service.name": "svc-lim"})
    resp = ingest_proto(client, prof_stream, b.model(), timeout=180)
    assert resp.status_code == 200, resp.text[:500]
    assert resp.content == b""

    # A debug build needs ~35 s to merge 100k unique stacks.
    body = wait_merge_total(client, prof_stream, recent_window(**cpu()), TOTAL, timeout=240, request_timeout=180)
    assert body["truncated"] is True
    assert body["total"] == TOTAL
    assert body["merged_total"] == HEAVY_VALUE + RESULT_SIZE - 1
    assert child(child(body["root"], "lim_root"), "heavy_leaf")["self"] == HEAVY_VALUE
    assert body["top"][0] == {"name": "heavy_leaf", "self": HEAVY_VALUE, "total": HEAVY_VALUE}

    side = recent_window(**cpu())
    resp = query(client, prof_stream, "diff", {"baseline": side, "comparison": side}, timeout=240)
    assert resp.status_code == 200, resp.text[:500]
    diff = resp.json()
    assert diff["truncated"] is True
    assert diff["baseline_total"] == diff["comparison_total"] == TOTAL
