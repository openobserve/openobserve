"""
Sensitive-data redaction — pattern admission guards and the redaction round trip
(SDR-01 .. SDR-08).

Feature: fail-closed redaction and the logs work merged as 6971683fe6 (#15086) with
o2-enterprise#2789.

The guards below are what make `ZO_SDR_FAIL_CLOSED`'s "unbuilt pattern" state
unreachable from the API: a pattern that vectorscan cannot build is rejected on create
AND on update, a pattern cannot be orphaned by deleting it out from under a stream, and
the Detect policy cannot be authored unless the node opts in. If any of them regresses,
an association can reach a state where the fail-closed path refuses ingestion for a
whole org, so they are worth pinning even though each is only a 400.

ENTERPRISE ONLY, and needs the `vectorscan` feature. On a build without it
`POST /re_patterns` answers 403 "not supported", so every assertion here would pass
vacuously — the suite skips rather than report a false green.

All artifacts are namespaced `sdr_auto_*` and torn down by fixtures.
"""

import base64
import os
import time
import uuid

import pytest

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
CARD = "4111111111111111"
# Unbuildable: an unbalanced group. PatternManager::test_pattern rejects it, which is the
# behaviour these tests exist to pin.
UNBUILDABLE = "("


def _suffix():
    return f"{int(time.time())}{uuid.uuid4().hex[:4]}"


@pytest.fixture(scope="module", autouse=True)
def _require_vectorscan(create_session, base_url):
    """Skip unless this build can actually compile patterns."""
    resp = create_session.get(f"{base_url}api/{ORG_ID}/re_patterns")
    if resp.status_code == 403:
        pytest.skip("re_patterns unavailable: build lacks the vectorscan feature")
    if resp.status_code != 200:
        pytest.skip(f"re_patterns unavailable ({resp.status_code}); not an enterprise build")


def _create_pattern(session, base_url, name, pattern):
    return session.post(
        f"{base_url}api/{ORG_ID}/re_patterns",
        json={"name": name, "description": "sdr auto test", "pattern": pattern},
    )


def _list_patterns(session, base_url):
    body = session.get(f"{base_url}api/{ORG_ID}/re_patterns").json()
    return body["patterns"] if isinstance(body, dict) else body


def _pattern_id(session, base_url, name):
    for p in _list_patterns(session, base_url):
        if p["name"] == name:
            return p["id"]
    return None


def _associate(session, base_url, stream, field, pattern_id, pattern, name, policy="Redact"):
    return session.put(
        f"{base_url}api/{ORG_ID}/streams/{stream}/settings?type=logs",
        json={
            "pattern_associations": {
                "add": [
                    {
                        "field": field,
                        "pattern_name": name,
                        "description": "sdr auto test",
                        "pattern": pattern,
                        "pattern_id": pattern_id,
                        "policy": policy,
                        "apply_at": "Both",
                    }
                ],
                "remove": [],
            }
        },
    )


def _search(session, base_url, sql, minutes=60):
    now = int(time.time() * 1_000_000)
    return session.post(
        f"{base_url}api/{ORG_ID}/_search?type=logs",
        json={
            "query": {
                "sql": sql,
                "start_time": now - minutes * 60 * 1_000_000,
                "end_time": now,
                "from": 0,
                "size": 50,
            }
        },
    )


@pytest.fixture(scope="module")
def redacted_stream(create_session, base_url):
    """A stream with one card-number pattern associated to `body` at Both."""
    suffix = _suffix()
    stream = f"sdr_auto_{suffix}"
    name = f"sdr_auto_card_{suffix}"

    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/{stream}/_json",
        json=[{"body": f"charged card {CARD} ok", "service": "billing"}],
    )
    assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"

    assert _create_pattern(create_session, base_url, name, "[0-9]{16}").status_code == 200
    pattern_id = _pattern_id(create_session, base_url, name)
    assert pattern_id, "pattern was created but does not appear in the list"

    assert (
        _associate(create_session, base_url, stream, "body", pattern_id, "[0-9]{16}", name).status_code
        == 200
    )
    # The association has to reach the pattern manager before a search reflects it.
    time.sleep(5)

    yield {"stream": stream, "name": name, "id": pattern_id}

    # Remove EVERY association a test in this module may have added, not just the one the
    # fixture created: test_sdr_06 attempts a Detect association on `service` and skips
    # where the node allows it, which would otherwise leave that association in place,
    # block the pattern delete, and orphan an org-level pattern silently.
    def _assoc(field, policy):
        return {
            "field": field,
            "pattern_name": name,
            "description": "sdr auto test",
            "pattern": "[0-9]{16}",
            "pattern_id": pattern_id,
            "policy": policy,
            "apply_at": "Both",
        }

    create_session.put(
        f"{base_url}api/{ORG_ID}/streams/{stream}/settings?type=logs",
        json={
            "pattern_associations": {
                "add": [],
                "remove": [_assoc("body", "Redact"), _assoc("service", "Detect")],
            }
        },
    )
    deleted = create_session.delete(f"{base_url}api/{ORG_ID}/re_patterns/{pattern_id}")
    # Assert rather than hope: a blocked delete means an association survived teardown,
    # and the next run inherits a pattern it did not create.
    assert deleted.status_code == 200, (
        f"pattern {name} was not deleted ({deleted.status_code} {deleted.text}); "
        "an association probably survived teardown"
    )
    create_session.delete(f"{base_url}api/{ORG_ID}/streams/{stream}?type=logs")


# ---------------------------------------------------------------------------
# SDR-01/02 — the redaction round trip
# ---------------------------------------------------------------------------


def test_sdr_01_search_returns_redacted_values(create_session, base_url, redacted_stream):
    """A card number ingested into an associated field must never come back in a search."""
    resp = _search(create_session, base_url, f'SELECT body FROM "{redacted_stream["stream"]}"')
    assert resp.status_code == 200, f"search failed: {resp.status_code} {resp.text}"

    bodies = [h.get("body", "") for h in resp.json().get("hits", [])]
    assert bodies, "no hits came back; the fixture row should be searchable"
    assert all(CARD not in b for b in bodies), f"unredacted card number in {bodies}"
    assert any("[REDACTED]" in b for b in bodies), f"nothing was redacted: {bodies}"


def test_sdr_02_redaction_applies_to_rows_ingested_after_association(
    create_session, base_url, redacted_stream
):
    """apply_at=Both covers later writes too, not just the rows present at association."""
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/{redacted_stream['stream']}/_json",
        json=[{"body": f"second charge {CARD} ok", "service": "billing"}],
    )
    assert resp.status_code == 200
    time.sleep(5)

    hits = _search(
        create_session, base_url, f'SELECT body FROM "{redacted_stream["stream"]}"'
    ).json().get("hits", [])
    later = [h.get("body", "") for h in hits if "second charge" in h.get("body", "")]
    assert later, "the row ingested after association is not searchable"
    assert all(CARD not in b for b in later), f"unredacted card number in {later}"


# ---------------------------------------------------------------------------
# SDR-03..06 — the admission guards that keep an association buildable
# ---------------------------------------------------------------------------


def test_sdr_03_create_rejects_an_unbuildable_pattern(create_session, base_url):
    """A pattern vectorscan cannot compile must never reach the database."""
    resp = _create_pattern(create_session, base_url, f"sdr_auto_bad_{_suffix()}", UNBUILDABLE)
    assert resp.status_code == 400, f"expected 400, got {resp.status_code} {resp.text}"


def test_sdr_04_update_rejects_an_unbuildable_pattern(create_session, base_url, redacted_stream):
    """The same guard on update — otherwise a built association becomes unbuildable in place."""
    resp = create_session.put(
        f"{base_url}api/{ORG_ID}/re_patterns/{redacted_stream['id']}",
        json={
            "name": redacted_stream["name"],
            "description": "sdr auto test",
            "pattern": UNBUILDABLE,
        },
    )
    assert resp.status_code == 400, f"expected 400, got {resp.status_code} {resp.text}"

    # And the stored pattern is untouched, so redaction still works.
    stored = [p for p in _list_patterns(create_session, base_url) if p["id"] == redacted_stream["id"]]
    assert stored and stored[0]["pattern"] == "[0-9]{16}"


def test_sdr_05_delete_is_blocked_while_a_stream_uses_the_pattern(
    create_session, base_url, redacted_stream
):
    """Deleting an associated pattern would leave an association that cannot be built."""
    resp = create_session.delete(f"{base_url}api/{ORG_ID}/re_patterns/{redacted_stream['id']}")
    assert resp.status_code == 400, f"expected 400, got {resp.status_code} {resp.text}"
    assert "associated" in resp.text.lower(), f"unexpected rejection reason: {resp.text}"


def test_sdr_06_detect_policy_needs_the_node_to_opt_in(create_session, base_url, redacted_stream):
    """Detect is count-only and gated on ZO_SDR_DETECT_POLICY_ENABLED.

    Skipped where the node has opted in, since there the association is legitimate.
    """
    resp = _associate(
        create_session,
        base_url,
        redacted_stream["stream"],
        "service",
        redacted_stream["id"],
        "[0-9]{16}",
        redacted_stream["name"],
        policy="Detect",
    )
    if resp.status_code == 200:
        pytest.skip("ZO_SDR_DETECT_POLICY_ENABLED is on for this node")
    assert resp.status_code == 400, f"expected 400, got {resp.status_code} {resp.text}"
    assert "detect" in resp.text.lower(), f"unexpected rejection reason: {resp.text}"


# ---------------------------------------------------------------------------
# SDR-07/08 — config surface
# ---------------------------------------------------------------------------


def test_sdr_07_config_always_reports_ai_enabled_as_a_bool(create_session, base_url):
    """`/config` keeps reporting `ai_enabled`, and reports it as a boolean.

    #15086 turned O2_AI_ENABLED on by default and gated the reported value on an agent
    target being configured. This does NOT exercise that gate — the target is server
    env (O2_AGENT_URL / O2_AI_HA_ENABLED) and cannot be toggled from a test against a
    running instance. What it pins is the contract the frontend depends on: the key is
    present and boolean. If it disappeared, the UI would read undefined and quietly
    render AI controls that can only fail.
    """
    resp = create_session.get(f"{base_url}api/{ORG_ID}/config")
    assert resp.status_code == 200, f"config failed: {resp.status_code} {resp.text}"

    body = resp.json()
    assert "ai_enabled" in body, "config no longer reports ai_enabled"
    assert isinstance(body["ai_enabled"], bool), f"ai_enabled is not a bool: {body['ai_enabled']!r}"


def test_sdr_08_search_around_is_single_stream(create_session, base_url, redacted_stream):
    """The _around endpoint is per-stream; the UI picks the stream from the hit.

    Pins the contract the multi-stream search-around work depends on: a request naming
    one stream returns that stream's neighbours rather than erroring or fanning out.
    """
    hits = _search(
        create_session, base_url, f'SELECT * FROM "{redacted_stream["stream"]}"'
    ).json().get("hits", [])
    assert hits, "fixture row is not searchable"
    key = hits[0]["_timestamp"]

    encoded = base64.b64encode(
        f'SELECT * FROM "{redacted_stream["stream"]}" '.encode()
    ).decode()
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/{redacted_stream['stream']}/_around"
        f"?key={key}&size=10&sql={encoded}&type=logs"
    )
    assert resp.status_code == 200, f"search around failed: {resp.status_code} {resp.text}"
    assert "hits" in resp.json(), f"unexpected around response: {resp.text[:200]}"
