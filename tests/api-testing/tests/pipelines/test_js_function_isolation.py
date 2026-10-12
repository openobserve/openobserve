"""API regression tests: a JavaScript function never sees another organization's state (#14868)."""

import uuid

import pytest

SECRET = "SECRET_XYZ_14868"
# a request runs on whichever blocking-pool thread is free, so repeat to make the two orgs share threads
ROUNDS = 20


@pytest.fixture(scope="module")
def two_orgs(create_session, base_url):
    """Two new orgs, created once per module because `DELETE /api/organizations/{id}` answers 404."""
    orgs = []
    for role in ("a", "b"):
        name = f"jsiso_{role}_{uuid.uuid4().hex[:8]}"
        resp = create_session.post(f"{base_url}api/organizations", json={"name": name})
        assert resp.status_code in (200, 201), f"could not create org {name}: {resp.status_code} {resp.text[:200]}"
        orgs.append(resp.json().get("identifier", name))
    return orgs


def _run(session, base_url, org_id, function, event):
    resp = session.post(
        f"{base_url}api/{org_id}/functions/test",
        json={"function": function, "events": [event], "trans_type": 1},
    )
    assert resp.status_code == 200, f"{org_id}: expected 200, got {resp.status_code}: {resp.content}"
    results = resp.json()["results"]
    assert len(results) == 1, f"{org_id}: expected one result, got: {results}"
    # a function that failed or never ran has nothing to leak, so the leak checks would pass vacuously
    assert not results[0].get("message"), f"{org_id}: the function failed: {results[0]!r}"
    assert results[0]["event"].get("ran") is True, f"{org_id}: the function did not run: {results[0]!r}"
    return results[0]["event"]


def test_js_builtin_replacement_does_not_leak_to_another_org(create_session, base_url, two_orgs):
    """A `JSON.parse` replaced by one org's function must never see another org's rows."""
    org_a, org_b = two_orgs
    hook = (
        "var _o = JSON.parse;"
        "if (!JSON.hooked) { JSON.hooked = true;"
        " JSON.parse = function (s) { JSON.grab = (JSON.grab || '') + s + '|'; return _o(s); }; }"
        "row.ran = true;"
        "row.leaked = JSON.grab || '';"
    )
    for _ in range(ROUNDS):
        _run(create_session, base_url, org_a, hook, {"n": 1})
    for _ in range(ROUNDS):
        _run(create_session, base_url, org_b, hook, {"secret": SECRET})
    later = [_run(create_session, base_url, org_a, hook, {"n": 2}) for _ in range(ROUNDS)]

    for event in later:
        assert SECRET not in event["leaked"], f"org A's JSON.parse hook saw org B's row: {event!r}"
    # unless the hook outlived a request, no two requests shared a thread and the check above proved nothing
    assert any(event["leaked"] for event in later), f"org A's hook never outlived a request: {later!r}"


def test_js_global_object_property_does_not_leak_to_another_org(create_session, base_url, two_orgs):
    """A property one org's function adds to a global object must never be visible to another org."""
    org_a, org_b = two_orgs
    fn = (
        "if (row.secret) { JSON.stash = row.secret; }"
        "row.ran = true;"
        "row.leaked = (typeof JSON.stash !== 'undefined') ? JSON.stash : '';"
    )
    for _ in range(ROUNDS):
        _run(create_session, base_url, org_a, fn, {"secret": SECRET})
    for _ in range(ROUNDS):
        event = _run(create_session, base_url, org_b, fn, {"n": 1})
        assert SECRET not in str(event.get("leaked", "")), f"org B saw a property set by org A: {event!r}"
    # unless org A reads its own property back, no two requests shared a thread and the check above proved nothing
    own = [_run(create_session, base_url, org_a, fn, {"n": 1}).get("leaked") for _ in range(ROUNDS)]
    assert SECRET in own, f"org A's property never outlived a request: {own!r}"
