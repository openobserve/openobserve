"""RUM intake answers a non-object NDJSON line with a 400, not a dropped connection  [regressions #15056, #14797]."""

from __future__ import annotations

import json
import logging
import secrets
import time
from dataclasses import dataclass, field
from typing import Any

import pytest
import requests

from support.client import OpenObserveClient
from support.factories import search_payload
from support.wait import wait_until

logger = logging.getLogger(__name__)

NOT_AN_OBJECT = "each line must be a JSON object"
HOUR_US = 60 * 60 * 1000 * 1000
NON_OBJECT_LINES = ["[]", '[{"type":"view"}]', '"text"', "123", "true", "null"]
SERVICE = "e2e-rum-15056"


@dataclass
class IntakeResult:
    status: int
    body: dict[str, Any] = field(default_factory=dict)
    dropped: str | None = None


def _marker() -> str:
    return f"e2e15056{secrets.token_hex(6)}"


def _now_ms() -> int:
    return int(time.time() * 1000)


def _action_line(marker: str) -> str:
    record = {"type": "action", "date": _now_ms(), "service": SERVICE, "action_type": "custom", "action_id": marker}
    return json.dumps(record, separators=(",", ":"))


def _log_line(marker: str) -> str:
    record = {"date": _now_ms(), "status": "info", "service": SERVICE, "message": f"e2e-15056 {marker}"}
    return json.dumps(record, separators=(",", ":"))


VALID_LINE = {"rum": _action_line, "logs": _log_line}


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


def _send_rum_body(client: OpenObserveClient, token: str, route: str, body: str) -> IntakeResult:
    try:
        resp = requests.post(
            f"{client.base_url}rum/v1/{client.org}/{route}",
            params={"oo-api-key": token, "oosource": "browser"},
            headers={"Content-Type": "text/plain"},
            data=body.encode(),
            timeout=30,
        )
    except requests.RequestException as e:
        # The pre-fix server closes the connection without a response, so the error is kept as a value to assert on.
        return IntakeResult(status=0, dropped=repr(e))
    try:
        parsed = resp.json()
    except ValueError:
        parsed = {}
    return IntakeResult(status=resp.status_code, body=parsed if isinstance(parsed, dict) else {})


def _stored_action_ids(client: OpenObserveClient, markers: list[str]) -> list[str]:
    end_us = int(time.time() * 1_000_000) + 60_000_000
    in_list = ",".join(f"'{m}'" for m in markers)
    payload = search_payload(
        f'SELECT action_id FROM "_rumdata" WHERE action_id IN ({in_list})',
        start_time=end_us - HOUR_US,
        end_time=end_us,
        size=100,
    )
    resp = client.post("_search?type=logs", json=payload)
    assert resp.status_code == 200, f"_rumdata search failed: HTTP {resp.status_code} {resp.text}"
    return [h.get("action_id") for h in resp.json().get("hits", [])]


def _assert_refused_as_not_an_object(result: IntakeResult, what: str) -> None:
    assert result.dropped is None, f"#14797: {what} must get an answer, not a dropped connection: {result.dropped}"
    assert result.status == 400, f"{what} must be refused with a 400, got {result.status}: {result.body}"
    message = result.body.get("message") or ""
    assert NOT_AN_OBJECT in message, f"{what} must say why it was refused, got {message!r}"


@pytest.mark.parametrize("route", ["rum", "logs"])
def test_non_object_line_gets_400_instead_of_dropped_connection(client: OpenObserveClient, rum_token: str, route: str):
    """#15056: a line that is an array, string, number, boolean or null gets a 400 instead of a dropped connection."""
    accepted = _send_rum_body(client, rum_token, route, VALID_LINE[route](_marker()))
    assert accepted.dropped is None, f"Precondition: a valid /{route} object must reach the server: {accepted.dropped}"
    assert accepted.status == 202, (
        f"Precondition: a valid /{route} object must be accepted, got {accepted.status}: {accepted.body}"
    )

    for line in NON_OBJECT_LINES:
        result = _send_rum_body(client, rum_token, route, line)
        logger.info(
            "RUM non-object line route=%s line=%s status=%s dropped=%s", route, line, result.status, result.dropped
        )
        _assert_refused_as_not_an_object(result, f"a /{route} line of {line}")


def test_request_with_one_non_object_line_is_refused_as_a_whole(client: OpenObserveClient, rum_token: str):
    """#15056: a request with one non-object line is refused as a whole, so its valid record is not stored."""
    refused_marker = _marker()
    kept_markers = [_marker(), _marker()]

    mixed = _send_rum_body(client, rum_token, "rum", f"{_action_line(refused_marker)}\n[]")
    logger.info("RUM mixed request status=%s dropped=%s", mixed.status, mixed.dropped)
    _assert_refused_as_not_an_object(mixed, "a request with a valid object line and a [] line")

    valid = _send_rum_body(client, rum_token, "rum", "\n".join(_action_line(m) for m in kept_markers))
    assert valid.status == 202, (
        f"two valid NDJSON object lines must still be accepted, got {valid.status}: {valid.body}"
    )
    statuses = valid.body.get("status") or [{}]
    assert statuses[0].get("successful") == 2, f"both valid lines must be stored: {valid.body}"

    # The later valid request becoming searchable proves the refused one had time to land, had it been kept.
    wait_until(
        lambda: len(_stored_action_ids(client, kept_markers)) == 2,
        timeout=60,
        interval=2,
        msg="the valid records must become searchable in _rumdata",
    )
    assert _stored_action_ids(client, [refused_marker]) == [], (
        "the valid line of the refused request must not be stored"
    )
