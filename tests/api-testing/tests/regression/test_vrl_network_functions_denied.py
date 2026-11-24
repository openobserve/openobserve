"""Without ZO_SKIP_SSRF_CHECKS, VRL network functions do not compile (#16551)."""

from __future__ import annotations

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from tests.regression.test_vrl_network_functions_skip_ssrf import HOST_CALLS, NETWORK_CALLS, _save


@pytest.mark.parametrize(
    "call", NETWORK_CALLS + HOST_CALLS, ids=["dns_lookup", "reverse_dns", "http_request", "get_env_var", "get_hostname"]
)
def test_network_and_host_functions_are_denied_by_default(client: OpenObserveClient, call: str):
    """openobserve#16551: the fix must not unlock outbound calls on a server that keeps its SSRF checks."""
    name = unique_name("pyt_ssrf_off")
    try:
        resp = _save(client, name, call)
        assert resp.status_code == 400, f"{call!r} must not compile: {resp.status_code} {resp.text[:300]}"
        assert "call to undefined function" in resp.text, resp.text[:300]
    finally:
        client.delete(f"functions/{name}")
