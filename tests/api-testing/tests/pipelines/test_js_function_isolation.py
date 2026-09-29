"""API regression tests for JavaScript function context isolation (#14868).

A JavaScript ingest/test function used to run against one QuickJS context that was
reused for every record on a worker thread. A function could replace a builtin
(e.g. `JSON.parse`) or add a property to a global object, and the mutation would
persist to the next record — which, on an ingest worker, can belong to another
organization. `POST /functions/test` compiles the function once and applies it to
each event in order on a single thread, so it reproduces the cross-record leak
deterministically at the API layer.

The fix builds a fresh context per `apply_js_fn`/`compile_js_function` call, so a
mutation made while processing one event must not be visible to the next.

Notes:
- The test endpoint uses snake_case `trans_type`; 1 selects JavaScript.
- The eval runs in strict mode, so state is stashed on a property of the built-in
  `JSON` object (allowed in strict mode) rather than on an implicit global (which
  would throw and turn a leak into a per-event error instead).
"""

SECRET = "SECRET_XYZ_14868"


def _results(resp):
    assert resp.status_code == 200, f"expected 200, got {resp.status_code}: {resp.content}"
    body = resp.json()
    assert "results" in body, f"expected results in response, got: {body}"
    return body["results"]


def test_js_builtin_replacement_does_not_leak_across_events(create_session, base_url):
    """A replaced `JSON.parse` from one event must not capture later events (#14868).

    The wrapper parses each event's input with `JSON.parse` before user code runs,
    so on a shared context a replacement installed while handling event 1 captures
    event 2's row — another org's data in production. The hook stashes what it is
    given on `JSON.grab`; with a per-call context the hook never survives, so no
    later event's `leaked` field carries the secret.
    """
    session = create_session
    org_id = "default"

    hook_fn = (
        "var _o = JSON.parse;"
        "if (!JSON.hooked) { JSON.hooked = true;"
        " JSON.parse = function (s) { JSON.grab = (JSON.grab || '') + s + '|'; return _o(s); }; }"
        "row.ran = true;"
        "row.leaked = JSON.grab || '';"
    )
    payload = {
        "function": hook_fn,
        "events": [{"n": 1}, {"secret": SECRET}, {"n": 3}],
        "trans_type": 1,
    }
    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)
    results = _results(resp)
    assert len(results) == 3, f"expected one result per event, got: {results}"

    for i, r in enumerate(results):
        event = r.get("event", {})
        # Positive control: the function ran cleanly on every event. Without this a rejected
        # function or a per-event error would leave `leaked` empty and pass the leak check
        # vacuously.
        assert not r.get("message"), f"event {i} carried an error, test would be vacuous: {r!r}"
        assert event.get("ran") is True, f"event {i} did not run the function: {event!r}"
        assert SECRET not in str(event.get("leaked", "")), (
            f"event {i} saw another event's data through a persisted JSON.parse: {event!r}"
        )


def test_js_global_object_property_does_not_leak_across_events(create_session, base_url):
    """A property added to a global object must not persist to the next event (#14868).

    Event 1 sets `JSON.stash`; event 2 never sets it. On a shared context event 2
    reads event 1's value; with a per-call context it sees nothing.
    """
    session = create_session
    org_id = "default"

    fn = (
        "if (row.setit) { JSON.stash = row.secret; }"
        "row.ran = true;"
        "row.leaked = (typeof JSON.stash !== 'undefined') ? JSON.stash : '';"
    )
    payload = {
        "function": fn,
        "events": [{"setit": True, "secret": SECRET}, {"other": 1}],
        "trans_type": 1,
    }
    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)
    results = _results(resp)
    assert len(results) == 2, f"expected one result per event, got: {results}"
    assert all(not r.get("message") for r in results), f"a per-event error would be vacuous: {results!r}"
    assert all(r.get("event", {}).get("ran") is True for r in results), (
        f"the function did not run on every event: {results!r}"
    )

    # Positive control: event 1 set the property and read it back within its own call.
    first = results[0].get("event", {}).get("leaked", "")
    assert first == SECRET, f"event 1 should see the property it set: {first!r}"
    # Event 2 never set it and must not observe event 1's value.
    second = results[1].get("event", {}).get("leaked", "")
    assert SECRET not in str(second), (
        f"a global-object property leaked from a prior event: {second!r}"
    )
