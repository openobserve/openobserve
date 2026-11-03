"""RUM /logs accepts a single JSON array of objects as a supported input format [openobserve#16229]."""

from __future__ import annotations

import gzip
import json
import logging
import secrets
import time
from pathlib import Path
from typing import Any

import pytest
import requests

from support.client import OpenObserveClient
from support.factories import search_payload
from support.wait import wait_until

logger = logging.getLogger(__name__)

NOT_AN_OBJECT = "each line must be a JSON object"
HOUR_US = 60 * 60 * 1000 * 1000
# Fixtures are reconstructed from the SDK log models, not captured from a device.
FIXTURES = Path(__file__).parent.parent.parent / "fixtures" / "rum"
SERVICE = "e2e-rum-16229"


def _marker() -> str:
    return f"e2e16229{secrets.token_hex(6)}"


def _event(marker: str, n: int = 0, **extra: Any) -> dict[str, Any]:
    record = {
        "date": int(time.time() * 1000),
        "status": "info",
        "service": SERVICE,
        "message": f"e2e-16229 {marker} #{n}",
        **extra,
    }
    return record


def _fixture(name: str, marker: str) -> list[dict[str, Any]]:
    text = (FIXTURES / name).read_text().replace("__MARKER__", marker)
    return json.loads(text)


@pytest.fixture(scope="module")
def rum_token(client: OpenObserveClient) -> str:
    current = client.get("rumtoken")
    token = (current.json().get("data") or {}).get("rum_token") if current.status_code == 200 else None
    if token:
        return token
    created = client.post("rumtoken")
    assert created.status_code == 200, f"could not create a RUM token: {created.status_code} {created.text}"
    token = (created.json().get("data") or {}).get("rum_token")
    assert token, f"no RUM token in the create response: {created.text}"
    return token


def _post(
    client: OpenObserveClient,
    token: str,
    route: str,
    body: bytes | str,
    headers: dict[str, str] | None = None,
) -> requests.Response:
    data = body.encode() if isinstance(body, str) else body
    return requests.post(
        f"{client.base_url}rum/v1/{client.org}/{route}",
        params={"oo-api-key": token, "oosource": "browser"},
        headers={"Content-Type": "text/plain", **(headers or {})},
        data=data,
        timeout=30,
    )


def _rows(client: OpenObserveClient, marker: str) -> list[dict[str, Any]]:
    end_us = int(time.time() * 1_000_000) + 60_000_000
    payload = search_payload(
        f"SELECT * FROM \"_rumlog\" WHERE message LIKE '%{marker}%' ORDER BY message",
        start_time=end_us - HOUR_US,
        end_time=end_us,
        size=100,
    )
    resp = client.post("_search?type=logs", json=payload)
    assert resp.status_code == 200, f"_rumlog search failed: HTTP {resp.status_code} {resp.text}"
    return resp.json().get("hits", [])


def _wait_for_rows(client: OpenObserveClient, marker: str, count: int) -> list[dict[str, Any]]:
    wait_until(
        lambda: len(_rows(client, marker)) == count,
        timeout=60,
        interval=2,
        msg=f"{count} _rumlog rows with marker {marker} must become searchable",
    )
    return _rows(client, marker)


def _assert_refused(resp: requests.Response, what: str) -> None:
    assert resp.status_code == 400, f"{what} must be refused with a 400, got {resp.status_code}: {resp.text}"
    assert NOT_AN_OBJECT in (resp.json().get("message") or ""), f"{what}: unexpected message {resp.text}"


def test_array_body_is_accepted_and_stores_one_row_per_element(client: OpenObserveClient, rum_token: str):
    marker = _marker()
    body = json.dumps([_event(marker, 0), _event(marker, 1)], separators=(",", ":"))
    resp = _post(client, rum_token, "logs", body)
    assert resp.status_code == 202, f"{resp.status_code}: {resp.text}"
    rows = _wait_for_rows(client, marker, 2)
    assert [r["message"] for r in rows] == [f"e2e-16229 {marker} #0", f"e2e-16229 {marker} #1"]


def test_large_array_batch_is_accepted_and_every_element_is_stored(client: OpenObserveClient, rum_token: str):
    marker = _marker()
    count = 2000
    body = json.dumps([_event(marker, i, pad="x" * 200) for i in range(count)], separators=(",", ":"))
    resp = _post(client, rum_token, "logs", body)
    assert resp.status_code == 202, f"{resp.status_code}: {resp.text}"
    end_us = int(time.time() * 1_000_000) + 60_000_000
    sql = f"SELECT COUNT(*) AS c FROM \"_rumlog\" WHERE message LIKE '%{marker}%'"
    payload = search_payload(sql, start_time=end_us - HOUR_US, end_time=end_us, size=1)

    def stored() -> int:
        hits = client.post("_search?type=logs", json=payload).json().get("hits", [])
        return int(hits[0]["c"]) if hits else 0

    wait_until(lambda: stored() == count, timeout=90, interval=3, msg=f"{count} array elements must all be stored")


def test_pretty_printed_array_is_accepted(client: OpenObserveClient, rum_token: str):
    marker = _marker()
    body = "\n  " + json.dumps([_event(marker, 0), _event(marker, 1)], indent=2) + "\n\n"
    resp = _post(client, rum_token, "logs", body)
    assert resp.status_code == 202, f"{resp.status_code}: {resp.text}"
    _wait_for_rows(client, marker, 2)


def test_empty_array_is_accepted_like_an_empty_body(client: OpenObserveClient, rum_token: str):
    for body in ["[]", "  [ ]\n"]:
        resp = _post(client, rum_token, "logs", body)
        assert resp.status_code == 202, f"{body!r}: {resp.status_code}: {resp.text}"
    assert _post(client, rum_token, "logs", "").status_code == 202


def test_gzipped_array_is_accepted(client: OpenObserveClient, rum_token: str):
    marker = _marker()
    body = gzip.compress(json.dumps([_event(marker, 0), _event(marker, 1)]).encode())
    resp = _post(client, rum_token, "logs", body, headers={"Content-Encoding": "gzip"})
    assert resp.status_code == 202, f"{resp.status_code}: {resp.text}"
    _wait_for_rows(client, marker, 2)


@pytest.mark.parametrize(
    "name,expected_service",
    [("android_logs_batch.json", "e2e-android-app"), ("ios_logs_batch.json", "e2e-ios-app")],
)
def test_sdk_batch_fixture_is_accepted_and_enriched(
    client: OpenObserveClient, rum_token: str, name: str, expected_service: str
):
    marker = _marker()
    batch = _fixture(name, marker)
    resp = _post(
        client,
        rum_token,
        "logs",
        json.dumps(batch),
        headers={"User-Agent": "e2e-sdk/1.0", "X-Forwarded-For": "8.8.8.8"},
    )
    assert resp.status_code == 202, f"{resp.status_code}: {resp.text}"
    rows = _wait_for_rows(client, marker, len(batch))
    for row in rows:
        assert row["service"] == expected_service
        assert row.get("ip"), f"enrichment must add ip: {row}"
        assert any(k.startswith("user_agent") for k in row), f"enrichment must add user_agent fields: {sorted(row)}"
    assert {r["status"] for r in rows} == {e["status"] for e in batch}


@pytest.mark.parametrize("element", ["1", "null", '"s"', "true", "[1]", "[]"])
def test_array_with_a_non_object_element_is_refused_and_nothing_is_stored(
    client: OpenObserveClient, rum_token: str, element: str
):
    marker = _marker()
    _assert_refused(_post(client, rum_token, "logs", f"[{element}]"), f"array [{element}]")
    mixed = f"[{json.dumps(_event(marker, 0))},{element}]"
    _assert_refused(_post(client, rum_token, "logs", mixed), f"array {mixed}")
    # A later accepted request becoming searchable shows the refused one had time to land, had it been kept.
    ok_marker = _marker()
    assert _post(client, rum_token, "logs", json.dumps(_event(ok_marker))).status_code == 202
    _wait_for_rows(client, ok_marker, 1)
    assert _rows(client, marker) == [], "an array refused for a non-object element must store none of its objects"


@pytest.mark.parametrize("suffix", ["", ","])
def test_malformed_array_is_refused(client: OpenObserveClient, rum_token: str, suffix: str):
    body = json.dumps(_event(_marker())) + suffix
    resp = _post(client, rum_token, "logs", "[" + body)
    assert resp.status_code == 400, f"a truncated array must be refused with a 400, got {resp.status_code}: {resp.text}"
    assert "Failed processing" in (resp.json().get("message") or ""), resp.text


def test_array_followed_by_extra_lines_is_refused(client: OpenObserveClient, rum_token: str):
    marker = _marker()
    body = json.dumps([_event(marker, 0)]) + "\n" + json.dumps(_event(marker, 1))
    _assert_refused(_post(client, rum_token, "logs", body), "an array followed by another line")


def test_single_object_and_ndjson_are_still_accepted(client: OpenObserveClient, rum_token: str):
    single = _marker()
    assert _post(client, rum_token, "logs", json.dumps(_event(single))).status_code == 202
    _wait_for_rows(client, single, 1)

    nd = _marker()
    lines = "\n".join(json.dumps(_event(nd, i)) for i in range(3)) + "\n"
    assert _post(client, rum_token, "logs", lines).status_code == 202
    _wait_for_rows(client, nd, 3)


def test_invalid_token_is_still_forbidden_for_an_array(client: OpenObserveClient):
    resp = _post(client, "not-a-real-token", "logs", json.dumps([_event(_marker())]))
    assert resp.status_code == 403, f"{resp.status_code}: {resp.text}"


def test_rum_route_stays_strict_ndjson_for_an_array_body(client: OpenObserveClient, rum_token: str):
    body = json.dumps([{"type": "action", "date": int(time.time() * 1000), "service": SERVICE}])
    _assert_refused(_post(client, rum_token, "rum", body), "an array body on /rum")


def _tagged_events(marker: str) -> list[dict[str, Any]]:
    return [_event(marker, i, o2tags="env:dev,service:x") for i in range(3)]


def _tag_columns(rows: list[dict[str, Any]]) -> list[tuple[Any, Any]]:
    return [(r.get("env"), r.get("service")) for r in rows]


def test_array_body_o2tags_reach_every_row_like_ndjson(client: OpenObserveClient, rum_token: str):
    arr_marker, nd_marker = _marker(), _marker()
    arr = _post(client, rum_token, "logs", json.dumps(_tagged_events(arr_marker)))
    nd = _post(client, rum_token, "logs", "\n".join(json.dumps(e) for e in _tagged_events(nd_marker)))
    assert arr.status_code == 202 and nd.status_code == 202, f"{arr.text} {nd.text}"
    arr_rows = _wait_for_rows(client, arr_marker, 3)
    nd_rows = _wait_for_rows(client, nd_marker, 3)
    assert _tag_columns(arr_rows) == [("dev", "x")] * 3, _tag_columns(arr_rows)
    assert _tag_columns(arr_rows) == _tag_columns(nd_rows)


def test_query_string_o2tags_take_precedence_over_array_body_tags(client: OpenObserveClient, rum_token: str):
    marker = _marker()
    resp = requests.post(
        f"{client.base_url}rum/v1/{client.org}/logs",
        params={"oo-api-key": rum_token, "oosource": "browser", "o2tags": "env:qs,service:qs"},
        headers={"Content-Type": "text/plain"},
        data=json.dumps(_tagged_events(marker)).encode(),
        timeout=30,
    )
    assert resp.status_code == 202, f"{resp.status_code}: {resp.text}"
    rows = _wait_for_rows(client, marker, 3)
    assert _tag_columns(rows) == [("qs", "qs")] * 3, _tag_columns(rows)

