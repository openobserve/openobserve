"""RUM Product Analytics named events and saved funnels, end to end over HTTP.

Each test uses its own random app, so it never sees another test's rows and the
50-per-app cap is reached without touching shared data.
"""

import logging
import random
import string
import uuid

import pytest
import requests

logger = logging.getLogger(__name__)

PASSWORD = "TestPass123!Secure"


def _app():
    return "pa-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=10))


def _url(base_url, org_id, path, app, **params):
    query = {"app": app, **params}
    tail = "&".join(f"{k}={v}" for k, v in query.items())
    return f"{base_url}api/{org_id}/rum/analytics/{path}?{tail}"


def _event_body(name, value="/signup"):
    return {"name": name, "rules": [{"t": "view", "op": "eq", "value": value}]}


def _funnel_body(name, *steps):
    return {
        "name": name,
        "def": {"s": [list(s) for s in steps], "u": "sessions", "w": "session"},
        "sql": 'SELECT 1 FROM "_rumdata"',
    }


def _cleanup(session, base_url, org_id, app):
    funnels = session.get(_url(base_url, org_id, "funnels", app)).json().get("list", [])
    for f in funnels:
        session.delete(_url(base_url, org_id, f"funnels/{f['id']}", app))
    events = session.get(_url(base_url, org_id, "named_events", app)).json().get("list", [])
    for e in events:
        session.delete(_url(base_url, org_id, f"named_events/{e['id']}", app, force="true"))


@pytest.fixture()
def app(create_session, base_url, org_id):
    name = _app()
    yield name
    _cleanup(create_session, base_url, org_id, name)


def test_event_then_funnel_round_trip(create_session, base_url, org_id, app):
    s = create_session
    created = s.post(_url(base_url, org_id, "named_events", app), json=_event_body("Signup"))
    assert created.status_code == 201, created.text
    event = created.json()
    assert len(event["id"]) == 27 and event["id"].isalnum()
    assert event["version"] == 1 and event["app"] == app

    listed = s.get(_url(base_url, org_id, "named_events", app))
    assert listed.status_code == 200
    assert [e["id"] for e in listed.json()["list"]] == [event["id"]]

    funnel = s.post(
        _url(base_url, org_id, "funnels", app),
        json=_funnel_body("Flow", ["p", "/"], ["e", event["id"]]),
    )
    assert funnel.status_code == 201, funnel.text
    assert funnel.json()["eventIds"] == [event["id"]]

    fetched = s.get(_url(base_url, org_id, f"funnels/{funnel.json()['id']}", app))
    assert fetched.status_code == 200
    assert fetched.json()["sql"] == 'SELECT 1 FROM "_rumdata"'

    other_app = s.get(_url(base_url, org_id, f"named_events/{event['id']}", app + "x"))
    assert other_app.status_code == 404
    assert other_app.json()["code"] == "not_found"


def test_stale_put_is_a_version_conflict(create_session, base_url, org_id, app):
    s = create_session
    event = s.post(_url(base_url, org_id, "named_events", app), json=_event_body("Signup")).json()
    path = _url(base_url, org_id, f"named_events/{event['id']}", app)
    first = s.put(path, json={**_event_body("Signed up"), "version": 1})
    assert first.status_code == 200, first.text
    assert first.json()["version"] == 2
    stale = s.put(path, json={**_event_body("Stale"), "version": 1})
    assert stale.status_code == 409
    body = stale.json()
    assert body["code"] == "version_conflict"
    assert body["current"]["name"] == "Signed up" and body["current"]["version"] == 2


def test_in_use_delete_needs_force_and_the_funnel_keeps_the_orphan(
    create_session, base_url, org_id, app
):
    s = create_session
    event = s.post(_url(base_url, org_id, "named_events", app), json=_event_body("Signup")).json()
    funnel = s.post(
        _url(base_url, org_id, "funnels", app),
        json=_funnel_body("Flow", ["p", "/"], ["e", event["id"]]),
    ).json()

    usages = s.get(_url(base_url, org_id, f"named_events/{event['id']}/funnels", app))
    assert usages.json() == {"list": [{"id": funnel["id"], "name": "Flow"}]}

    path = f"named_events/{event['id']}"
    refused = s.delete(_url(base_url, org_id, path, app))
    assert refused.status_code == 409
    assert refused.json()["code"] == "event_in_use"
    assert refused.json()["funnels"] == [{"id": funnel["id"], "name": "Flow"}]

    forced = s.delete(_url(base_url, org_id, path, app, force="true"))
    assert forced.status_code == 204

    listed = s.get(_url(base_url, org_id, "funnels", app)).json()["list"]
    assert listed[0]["eventIds"] == [event["id"]]

    copy = s.post(
        _url(base_url, org_id, "funnels", app),
        json=_funnel_body("Copy", ["p", "/"], ["e", event["id"]]),
    )
    assert copy.status_code == 409 and copy.json()["code"] == "unknown_event"


@pytest.mark.parametrize("flag", ["true", "1", "TRUE", "True"])
def test_force_accepts_boolean_spellings(create_session, base_url, org_id, app, flag):
    s = create_session
    event = s.post(_url(base_url, org_id, "named_events", app), json=_event_body("Signup")).json()
    s.post(
        _url(base_url, org_id, "funnels", app),
        json=_funnel_body("Flow", ["p", "/"], ["e", event["id"]]),
    )
    path = f"named_events/{event['id']}"
    for off in ("false", "0"):
        kept = s.delete(_url(base_url, org_id, path, app, force=off))
        assert kept.status_code == 409 and kept.json()["code"] == "event_in_use", off
    forced = s.delete(_url(base_url, org_id, path, app, force=flag))
    assert forced.status_code == 204, forced.text


def test_duplicate_name_cap_and_unknown_field(create_session, base_url, org_id, app):
    s = create_session
    url = _url(base_url, org_id, "named_events", app)
    assert s.post(url, json=_event_body("Signup")).status_code == 201
    dup = s.post(url, json=_event_body("  SIGNUP "))
    assert dup.status_code == 409 and dup.json()["code"] == "duplicate_name"

    for i in range(49):
        r = s.post(url, json=_event_body(f"event {i}"))
        assert r.status_code == 201, r.text
    capped = s.post(url, json=_event_body("one too many"))
    assert capped.status_code == 409 and capped.json()["code"] == "limit_reached"

    extra = s.post(
        _url(base_url, org_id, "funnels", app),
        json={**_funnel_body("Flow", ["p", "/"], ["p", "/a"]), "eventIds": []},
    )
    assert extra.status_code == 400 and extra.json()["code"] == "invalid_body"
    not_json = s.post(url, data="{nope", headers={"Content-Type": "application/json"})
    assert not_json.status_code == 400 and not_json.json()["code"] == "invalid_body"


def test_validation_codes(create_session, base_url, org_id, app):
    s = create_session
    url = _url(base_url, org_id, "named_events", app)
    long_page = {"t": "action", "targets": ["Buy"], "onPage": "a" * 1025}
    rules = s.post(url, json={"name": "x", "rules": [long_page]})
    assert rules.status_code == 400 and rules.json()["code"] == "invalid_rules"
    name = s.post(url, json=_event_body("n" * 81))
    assert name.status_code == 400 and name.json()["code"] == "invalid_name"
    expands = s.post(url, json=_event_body("\u0130" * 80))
    assert expands.status_code == 400 and expands.json()["code"] == "invalid_name", expands.text
    bad_id = s.get(_url(base_url, org_id, "named_events/not-an-id", app))
    assert bad_id.status_code == 400 and bad_id.json()["code"] == "invalid_id"
    no_app = s.get(f"{base_url}api/{org_id}/rum/analytics/named_events")
    assert no_app.status_code == 400 and no_app.json()["code"] == "invalid_app"
    one_step = s.post(
        _url(base_url, org_id, "funnels", app), json=_funnel_body("F", ["p", "/"])
    )
    assert one_step.status_code == 400 and one_step.json()["code"] == "invalid_definition"


def test_writes_with_another_apps_id_are_not_found(create_session, base_url, org_id, app):
    s = create_session
    other = app + "x"
    event = s.post(_url(base_url, org_id, "named_events", app), json=_event_body("Signup")).json()
    funnel = s.post(
        _url(base_url, org_id, "funnels", app),
        json=_funnel_body("Flow", ["p", "/"], ["p", "/a"]),
    ).json()

    for path, body in (
        (f"named_events/{event['id']}", {**_event_body("Hijacked"), "version": 1}),
        (f"funnels/{funnel['id']}", {**_funnel_body("Hijacked", ["p", "/"], ["p", "/b"]), "version": 1}),
    ):
        put = s.put(_url(base_url, org_id, path, other), json=body)
        assert put.status_code == 404 and put.json()["code"] == "not_found", put.text
        deleted = s.delete(_url(base_url, org_id, path, other, force="true"))
        assert deleted.status_code == 404 and deleted.json()["code"] == "not_found", deleted.text
        kept = s.get(_url(base_url, org_id, path, app))
        assert kept.status_code == 200 and kept.json()["version"] == 1, kept.text
        assert kept.json()["name"] != "Hijacked"


@pytest.fixture(scope="module")
def second_org(create_session, base_url):
    """One extra org per module: `DELETE /api/organizations/{id}` is not available to clean it up."""
    name = f"rum_pa_{uuid.uuid4().hex[:8]}"
    resp = create_session.post(f"{base_url}api/organizations", json={"name": name})
    if resp.status_code not in (200, 201):
        pytest.skip(f"could not create a second org ({resp.status_code}): {resp.text[:200]}")
    return resp.json().get("identifier", name)


def test_another_org_cannot_reach_the_rows(create_session, base_url, org_id, app, second_org):
    s = create_session
    event = s.post(_url(base_url, org_id, "named_events", app), json=_event_body("Signup")).json()
    funnel = s.post(
        _url(base_url, org_id, "funnels", app),
        json=_funnel_body("Flow", ["p", "/"], ["e", event["id"]]),
    ).json()

    for kind in ("named_events", "funnels"):
        listed = s.get(_url(base_url, second_org, kind, app))
        assert listed.status_code == 200 and listed.json()["list"] == [], listed.text
    for path, body in (
        (f"named_events/{event['id']}", {**_event_body("Hijacked"), "version": 1}),
        (f"funnels/{funnel['id']}", {**_funnel_body("Hijacked", ["p", "/"], ["p", "/b"]), "version": 1}),
    ):
        for method, kwargs, params in (("get", {}, {}), ("put", {"json": body}, {}), ("delete", {}, {"force": "true"})):
            resp = getattr(s, method)(_url(base_url, second_org, path, app, **params), **kwargs)
            assert resp.status_code == 404 and resp.json()["code"] == "not_found", f"{method} {path}: {resp.text}"
        kept = s.get(_url(base_url, org_id, path, app))
        assert kept.status_code == 200 and kept.json()["name"] != "Hijacked", kept.text


def _login(base_url, email):
    session = requests.Session()
    resp = session.post(f"{base_url}auth/login", json={"name": email, "password": PASSWORD}, timeout=30)
    assert resp.status_code == 200, resp.text
    return session


def test_viewer_reads_but_cannot_write(create_session, base_url, org_id, app):
    """Enterprise only: GET follows `_rumdata` read, writes need `rum_analytics`."""
    probe = create_session.get(f"{base_url}api/{org_id}/roles")
    if probe.status_code != 200:
        pytest.skip(f"custom roles are not available on this build (GET /roles -> {probe.status_code})")
    email = f"viewer-{app}@rum-pa-test.local"
    created = create_session.post(
        f"{base_url}api/{org_id}/users",
        json={"email": email, "password": PASSWORD, "first_name": "Rum", "last_name": "Viewer", "role": "viewer"},
    )
    assert created.status_code in (200, 201), created.text
    try:
        viewer = _login(base_url, email)
        listed = viewer.get(_url(base_url, org_id, "named_events", app))
        assert listed.status_code == 200, listed.text
        refused = viewer.post(_url(base_url, org_id, "named_events", app), json=_event_body("Nope"))
        assert refused.status_code == 403, refused.text
    finally:
        create_session.delete(f"{base_url}api/{org_id}/users/{email}")
