"""The open source build refuses enterprise-only writes before it reads the request  [#16471, #16860].

The UI locks pipeline remote destinations and the enterprise-only admin routes in the open
source build, but the API used to save remote pipeline nodes (pipeline destinations are
covered by helpers/workflow/pages/destination_page.py), and to answer a bad body on
the enterprise stubs with 400/415/422 (as if the feature worked) before its 403. The enterprise build is
unchanged, so every test here skips there.
"""

from __future__ import annotations

import uuid

import pytest

from support.client import OpenObserveClient

REMOTE_REFUSAL = "Remote destinations are not supported in the open source version"
BAD_BODIES = [
    pytest.param({"data": "{not json", "headers": {"Content-Type": "application/json"}}, id="bad-json"),
    pytest.param({"json": {}}, id="empty-object"),
    pytest.param({"data": ""}, id="no-content-type"),
]
# One stub per refusal shape; router/mod.rs enterprise_stubs_refuse_before_reading_the_request_in_the_oss_build covers every stub without the auth middleware.
STUBS = [
    ("POST", "api/v2/{org}/downtimes", 403, "Not Supported"),
    ("PUT", "api/{org}/alerts/deduplication/semantic-groups", 403, "Enterprise feature not available"),
    ("POST", "api/{org}/organizations/assume_service_account", 501, "only available in the enterprise version"),
]


@pytest.fixture(scope="module", autouse=True)
def _opensource_only(client: OpenObserveClient):
    resp = client.get("config", prefix="")
    assert resp.status_code == 200, resp.text[:200]
    if resp.json()["build_type"] != "opensource":
        pytest.skip("checks the open source build; the enterprise build serves these routes")


@pytest.mark.parametrize("body", BAD_BODIES)
@pytest.mark.parametrize(("method", "path", "status", "message"), STUBS, ids=lambda v: v if isinstance(v, str) else None)
def test_enterprise_stub_refuses_before_reading_the_body(client: OpenObserveClient, method, path, status, message, body):
    resp = client.request(method, path.format(org=client.org), prefix="", **body)
    assert resp.status_code == status, f"{method} {path}: {resp.status_code} {resp.text[:300]}"
    assert message in resp.text, f"{method} {path}: {resp.text[:300]}"


def test_pipeline_with_a_remote_node_is_refused(client: OpenObserveClient):
    name = f"oss_remote_pl_{uuid.uuid4().hex[:8]}"
    src, dst = str(uuid.uuid4()), str(uuid.uuid4())
    pipeline = {
        "name": name, "description": "", "source": {"source_type": "realtime"}, "org": client.org,
        "nodes": [
            {"id": src, "type": "input", "io_type": "input", "position": {"x": 100, "y": 100},
             "data": {"node_type": "stream", "stream_name": f"{name}_src", "stream_type": "logs", "org_id": client.org}},
            {"id": dst, "type": "output", "io_type": "output", "position": {"x": 300, "y": 100},
             "data": {"node_type": "remote_stream", "org_id": client.org, "destination_name": f"{name}_dest"}},
        ],
        "edges": [{"id": f"e-{src}-{dst}", "source": src, "target": dst}],
    }
    resp = client.post("pipelines", json=pipeline)
    assert resp.status_code == 400, f"{resp.status_code} {resp.text[:300]}"
    assert REMOTE_REFUSAL in resp.text, resp.text[:300]
    listed = client.get("pipelines")
    assert listed.status_code == 200, listed.text[:200]
    assert name not in listed.text, "the refused pipeline was stored"
