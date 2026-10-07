"""Enrichment table name validation and VRL lookup  [regressions #2072, #5344].

#2072: the UI refused a whitespace-only table name but the API accepted it,
so a table could be created that the UI could never address again.

#5344: `get_enrichment_table_record` returned the row but the looked-up value
never reached the event, which silently produced un-enriched records rather
than an error.
"""
from __future__ import annotations

import logging
import os
import time
import uuid

import pytest

logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")

# Both the file-upload and URL handlers validate the name, so both are exercised.
BLANK_NAMES = ["%20%20", "   ", "%09"]

ENRICHMENT_CSV = b"code,label\nc1,ALPHA\nc2,BETA\n"

# The table is written asynchronously, so the VRL lookup needs it to settle first.
TABLE_READY_TIMEOUT = 60


def _delete_table(session, base_url, name):
    session.delete(
        f"{base_url}api/{ORG_ID}/streams/{name}?type=enrichment_tables", timeout=30
    )


def _poll_function_test(session, base_url, vrl, events, accept):
    """Poll the function-test endpoint until `accept(resp)`, then return that response.

    Returns the last response on timeout so the caller's assertion reports the
    real failure rather than a timeout with no detail.
    """
    deadline = time.time() + TABLE_READY_TIMEOUT
    last = None
    while time.time() < deadline:
        last = session.post(
            f"{base_url}api/{ORG_ID}/functions/test",
            json={"function": vrl, "events": events},
            timeout=60,
        )
        if accept(last):
            return last
        time.sleep(3)
    return last


def _compiles(resp):
    """The VRL compiler resolved the table name.

    Its known-table list is a cached enum, so a table this test only just
    created is not in it yet and `get_enrichment_table_record` fails to
    *compile* with `E401 invalid enum variant` — a 400, before any row is
    looked up. Every test that names a fresh table has to wait for this.
    """
    return resp.status_code == 200


def _labels_applied(resp):
    """The table is not just resolvable but actually backing the lookup."""
    if not _compiles(resp):
        return False
    results = resp.json().get("results", [])
    return bool(results) and all(r.get("event", {}).get("label") for r in results)


def _wait_for_lookup(session, base_url, vrl, events):
    """Poll until the table backs the lookup and every event carries its label."""
    return _poll_function_test(session, base_url, vrl, events, _labels_applied)


def _wait_for_compile(session, base_url, vrl, events):
    """Poll only until the table name resolves.

    For assertions about what a lookup does *not* produce — `_wait_for_lookup`
    waits for a label on every event, which is the opposite of a missing-key
    expectation and would always time out.
    """
    return _poll_function_test(session, base_url, vrl, events, _compiles)


@pytest.fixture
def enrichment_table(create_session, base_url):
    # Deletes are asynchronous, so a per-second name collides with the previous
    # test's teardown and the create is refused as "being deleted".
    name = f"et_validation_{uuid.uuid4().hex[:12]}"
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/enrichment_tables/{name}",
        files={"file": ("lookup.csv", ENRICHMENT_CSV, "text/csv")},
        timeout=60,
    )
    assert resp.status_code == 200, f"table create failed: {resp.text}"
    yield name
    _delete_table(create_session, base_url, name)


@pytest.mark.parametrize("blank", BLANK_NAMES)
def test_file_upload_rejects_a_blank_table_name(create_session, base_url, blank):
    """A whitespace-only name must be refused, not silently accepted (#2072)."""
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/enrichment_tables/{blank}",
        files={"file": ("lookup.csv", ENRICHMENT_CSV, "text/csv")},
        timeout=60,
    )
    assert resp.status_code == 400, f"blank name {blank!r} was accepted: {resp.text}"
    assert "empty" in resp.text.lower(), f"error does not name the problem: {resp.text}"


def test_url_upload_rejects_a_blank_table_name(create_session, base_url):
    """The URL handler validates the name on its own path, so it is asserted too."""
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/enrichment_tables/%20%20/url",
        json={"url": "https://example.com/lookup.csv"},
        timeout=60,
    )
    assert resp.status_code == 400, f"blank name was accepted: {resp.text}"
    assert "empty" in resp.text.lower(), f"error does not name the problem: {resp.text}"


def test_a_valid_table_name_is_still_accepted(create_session, base_url, enrichment_table):
    """Negative control: the validation must not reject ordinary names."""
    resp = create_session.get(
        f"{base_url}api/{ORG_ID}/streams?type=enrichment_tables", timeout=30
    )
    assert resp.status_code == 200
    names = [s["name"] for s in resp.json().get("list", [])]
    assert enrichment_table in names, f"{enrichment_table} missing from {names}"


def test_vrl_lookup_substitutes_the_enrichment_value(
    create_session, base_url, enrichment_table
):
    """The looked-up column must reach the event, not just be found (#5344)."""
    vrl = (
        f'rec, err = get_enrichment_table_record("{enrichment_table}", '
        '{"code": to_string!(.code)})\n.label = rec.label\n.'
    )
    events = [{"code": "c1"}, {"code": "c2"}]

    resp = _wait_for_lookup(create_session, base_url, vrl, events)

    assert resp.status_code == 200, f"function test failed: {resp.text}"
    labels = [r["event"].get("label") for r in resp.json()["results"]]
    assert labels == ["ALPHA", "BETA"], f"enrichment not applied, got {labels}"


def test_vrl_lookup_of_a_missing_key_leaves_the_event_unenriched(
    create_session, base_url, enrichment_table
):
    """A key with no row must not fabricate a value (#5344)."""
    vrl = (
        f'rec, err = get_enrichment_table_record("{enrichment_table}", '
        '{"code": to_string!(.code)})\n.label = rec.label\n.'
    )
    # Must wait like its sibling: the fixture is function-scoped, so this is a
    # brand-new table and the VRL compiler's cached table list has not picked it
    # up yet. Posting straight away raced that refresh and failed with
    # `E401 invalid enum variant ... received: "et_validation_<uuid>"`.
    resp = _wait_for_compile(
        create_session, base_url, vrl, [{"code": "no-such-code"}]
    )

    assert resp.status_code == 200, f"function test failed: {resp.text}"
    assert not resp.json()["results"][0]["event"].get("label")
