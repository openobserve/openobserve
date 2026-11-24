"""With ZO_SKIP_SSRF_CHECKS=true, VRL may call the network functions but still not the host ones (#16551)."""

from __future__ import annotations

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

NETWORK_CALLS = [
    '.x = dns_lookup!("localhost")',
    '.x = reverse_dns!("127.0.0.1")',
    '.x = http_request!("http://127.0.0.1/")',
]
HOST_CALLS = ['.x = get_env_var!("HOME")', ".x = get_hostname!()"]


def _save(client: OpenObserveClient, name: str, body: str):
    return client.post("functions", json={"name": name, "function": f"{body}\n.", "params": "row", "transType": 0})


@pytest.mark.parametrize("call", NETWORK_CALLS, ids=["dns_lookup", "reverse_dns", "http_request"])
def test_network_function_compiles_when_ssrf_checks_are_skipped(client: OpenObserveClient, call: str):
    """openobserve#16551: these were removed unconditionally, so the flag that should unlock them did nothing."""
    name = unique_name("pyt_ssrf_net")
    try:
        # saving compiles without running, so no lookup or request leaves the runner
        resp = _save(client, name, call)
        assert resp.status_code == 200, f"{call!r} must compile with ZO_SKIP_SSRF_CHECKS=true: {resp.text[:300]}"
    finally:
        client.delete(f"functions/{name}")


@pytest.mark.parametrize("call", HOST_CALLS, ids=["get_env_var", "get_hostname"])
def test_host_function_stays_denied_when_ssrf_checks_are_skipped(client: OpenObserveClient, call: str):
    """openobserve#16551: the flag unlocks only network calls; reading server env or host identity stays denied."""
    name = unique_name("pyt_ssrf_host")
    try:
        resp = _save(client, name, call)
        assert resp.status_code == 400, f"{call!r} must not compile: {resp.status_code} {resp.text[:300]}"
        assert "call to undefined function" in resp.text, resp.text[:300]
    finally:
        client.delete(f"functions/{name}")
