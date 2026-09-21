"""RUM ootags/o2tags extraction from the request body  [regression #12351].

The browser RUM SDK sends `ootags` in the POST body, not as a query-string
parameter. The middleware used to read query params only, so every tag the SDK
carried -- `env`, `service`, `version`, `sdk_version` -- was silently dropped
and never reached the ingested record. Fixed in c6179b91c5 (PR #12349), which
buffers the body, parses the first JSON object and merges its tags in.

`tests/rum/test_rum.py` puts `ootags` in the query string, so it exercises the
path that always worked and cannot catch a regression here. These tests must
keep `ootags` OUT of the params.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

import requests

from support.client import OpenObserveClient
from support.wait import wait_until

logger = logging.getLogger(__name__)

ORG_ID = "default"

RUM_DATA_TEMPLATE: dict[str, Any] = {
    "_oo": {
        "format_version": 2,
        "drift": 0,
        "session": {"plan": 2},
        "configuration": {"session_sample_rate": 100, "session_replay_sample_rate": 100},
        "discarded": False,
    },
    "application": {"id": "1"},
    "service": "my-web-application",
    "version": "0.0.1",
    "source": "browser",
    "view": {"url": "http://127.0.0.1:5173/", "referrer": ""},
    "display": {"viewport": {"width": 1920, "height": 941}},
}


def _rum_token(client: OpenObserveClient) -> str:
    resp = client.get("rumtoken")
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["rum_token"]


def _ingest_params(rum_token: str) -> dict[str, str]:
    """RUM ingest params WITHOUT ootags -- the tags under test travel in the body."""
    return {
        "oosource": "browser",
        "oo-api-key": rum_token,
        "oo-request-id": str(uuid.uuid4()),
        "oo-evp-origin": "browser",
    }


def _ingest(
    client: OpenObserveClient,
    rum_token: str,
    marker: str,
    *,
    body_tags: str | None = None,
    body_tag_key: str = "ootags",
    param_tags: str | None = None,
) -> None:
    payload = {**RUM_DATA_TEMPLATE, "type": marker}
    if body_tags is not None:
        payload[body_tag_key] = body_tags

    params = _ingest_params(rum_token)
    if param_tags is not None:
        params["ootags"] = param_tags

    resp = requests.post(
        f"{client.base_url}rum/v1/{ORG_ID}/rum",
        params=params,
        json=payload,
        headers={"X-Forwarded-For": "182.70.14.246"},
        timeout=10,
    )
    # 202 Accepted: the RUM SDKs drop the whole batch on any non-202 intake response.
    assert resp.status_code == 202, f"rum ingest failed: {resp.status_code} {resp.text}"


def _hit_for_marker(client: OpenObserveClient, marker: str) -> dict[str, Any]:
    """Wait for the ingested record to become searchable and return it."""
    found: dict[str, Any] = {}

    def _searchable() -> bool:
        resp = client.search.sql(
            f"SELECT * FROM \"_rumdata\" WHERE type = '{marker}'",
            minutes=60,
            size=1,
            raise_for_status=False,
        )
        if resp.status_code != 200:
            return False
        hits = resp.json().get("hits", [])
        if not hits:
            return False
        found.update(hits[0])
        return True

    wait_until(
        _searchable,
        timeout=60,
        interval=1.0,
        msg=f"RUM record {marker} never became searchable in _rumdata",
    )
    return found


def test_env_tag_from_request_body_is_ingested(client: OpenObserveClient):
    """`ootags` sent in the POST body lands on the record as discrete fields."""
    marker = f"pytest-body-env-{uuid.uuid4()}"
    env = f"env-{uuid.uuid4().hex[:8]}"
    _ingest(
        client,
        _rum_token(client),
        marker,
        body_tags=f"sdk_version:0.2.7,api:fetch,env:{env},service:my-web-application,version:0.0.1",
    )

    hit = _hit_for_marker(client, marker)
    assert hit.get("env") == env, f"env from body ootags missing or wrong: {hit!r}"
    assert hit.get("sdk_version") == "0.2.7", f"sdk_version from body ootags missing: {hit!r}"
    assert hit.get("version") == "0.0.1", f"version from body ootags missing: {hit!r}"


def test_o2tags_alias_in_request_body_is_ingested(client: OpenObserveClient):
    """`o2tags` is accepted as an alias for `ootags` on the body path too."""
    marker = f"pytest-body-o2tags-{uuid.uuid4()}"
    env = f"env-{uuid.uuid4().hex[:8]}"
    _ingest(
        client,
        _rum_token(client),
        marker,
        body_tags=f"env:{env},version:0.0.1",
        body_tag_key="o2tags",
    )

    hit = _hit_for_marker(client, marker)
    assert hit.get("env") == env, f"env from body o2tags missing or wrong: {hit!r}"


def test_query_param_tags_take_precedence_over_body_tags(client: OpenObserveClient):
    """Body tags are merged only when absent from the query string, never over it."""
    marker = f"pytest-precedence-{uuid.uuid4()}"
    param_env = f"param-{uuid.uuid4().hex[:8]}"
    body_env = f"body-{uuid.uuid4().hex[:8]}"
    _ingest(
        client,
        _rum_token(client),
        marker,
        body_tags=f"env:{body_env}",
        param_tags=f"env:{param_env}",
    )

    hit = _hit_for_marker(client, marker)
    assert hit.get("env") == param_env, \
        f"query-string ootags must win over body ootags, got {hit.get('env')!r}"


def test_body_tag_value_containing_a_colon_is_preserved(client: OpenObserveClient):
    """Tags split on the FIRST colon only, so a value may itself contain colons."""
    marker = f"pytest-colon-{uuid.uuid4()}"
    env = f"ns:{uuid.uuid4().hex[:8]}"
    _ingest(client, _rum_token(client), marker, body_tags=f"env:{env},version:0.0.1")

    hit = _hit_for_marker(client, marker)
    assert hit.get("env") == env, f"colon in tag value was truncated: {hit!r}"
