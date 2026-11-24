"""A huge `page` on a check's run history must get an answer, not overflow the offset and drop the connection (#16691)."""

from __future__ import annotations

import pytest
import requests

from support.client import OpenObserveClient

# page * page_size (20) overflows i64 in the OFFSET computation.
OVERFLOWING_PAGE = 461168601842738791


@pytest.mark.xfail(
    strict=True,
    raises=requests.exceptions.ConnectionError,
    reason="https://github.com/openobserve/openobserve/issues/16691",
)
def test_overflowing_runs_page_is_answered_not_dropped(client: OpenObserveClient, make_synthetic):
    check_id = make_synthetic("tcp")["id"]

    resp = client.synthetics.runs(check_id, page=OVERFLOWING_PAGE)

    # Either fix is valid: refuse the page (4xx) or clamp it and return an empty page (200).
    assert resp.status_code == 200 or 400 <= resp.status_code < 500, resp.text
