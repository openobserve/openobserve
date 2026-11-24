"""Short URLs store only a same-origin path  [#16637].

`POST /api/{org}/short` used to store any `original_url` verbatim and redirect to it, so a
`javascript:` or off-origin link could be minted on this instance's domain. The fix rejects
non-http(s) and protocol-relative values with 400 and keeps only path, query and fragment.
"""

import uuid

import pytest

from support.client import OpenObserveClient

REFUSAL = "original_url must be an http(s) URL or a path starting with '/'"


def _shorten(client: OpenObserveClient, original_url: str):
    return client.post("short", json={"original_url": original_url})


def _short_id(resp) -> str:
    assert resp.status_code == 200, f"{resp.status_code} {resp.text[:200]}"
    short_url = resp.json()["short_url"]
    return short_url.split("/web/short/", 1)[1].split("?", 1)[0]


def _resolve(client: OpenObserveClient, short_id: str):
    resp = client.get(f"short/{short_id}", params={"type": "ui"})
    assert resp.status_code == 200, f"{resp.status_code} {resp.text[:200]}"
    return resp.json()


@pytest.mark.parametrize(
    "original_url",
    [
        "javascript:alert(document.domain)",
        " JaVaScRiPt:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "//evil.example/x",
        "/\\evil.example/x",
        "ftp://evil.example/x",
    ],
    ids=["javascript", "javascript-mixed-case", "data", "protocol-relative", "backslash-host", "ftp"],
)
def test_non_http_or_off_origin_url_is_refused(client: OpenObserveClient, original_url: str):
    resp = _shorten(client, original_url)
    assert resp.status_code == 400, f"{original_url!r} answered {resp.status_code} {resp.text[:200]}"
    assert REFUSAL in resp.json().get("message", ""), resp.text[:200]


def test_absolute_https_url_resolves_to_its_path_query_and_fragment_only(client: OpenObserveClient):
    marker = uuid.uuid4().hex[:10]
    resp = _shorten(client, f"https://user:pass@evil.example:8443/web/metrics?q={marker}#row")
    assert _resolve(client, _short_id(resp)) == f"/web/metrics?q={marker}#row"


def test_same_origin_path_resolves_unchanged(client: OpenObserveClient):
    path = f"/web/logs?stream=default&org_identifier={client.org}&marker={uuid.uuid4().hex[:10]}#row"
    assert _resolve(client, _short_id(_shorten(client, path))) == path
