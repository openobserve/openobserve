"""Contracts the function import/export screens depend on.

Function import/export (openobserve#13299) is a frontend feature: the file is
built and read in the browser. What it cannot control is how the server stores
what it sends and hands it back, and every one of those behaviours is something
the screens encode:

- the conflict prompt keys off the *text* of the duplicate-name error;
- the export payload is assembled from the keys `GET /functions` returns;
- VRL bodies are normalised on write, so "export then import" has to survive a
  body that is not byte-identical to the one that was sent;
- JS bodies must not be normalised that way, or importing one would corrupt it.

Phase 2 bundles the functions a pipeline calls into the pipeline's export file
and recreates them on import, which adds two more server behaviours the screen
depends on: a pipeline naming a function the org does not have is refused, and a
copy name (`parse_nginx_1`) is a name the server will actually accept.

These run against the API alone, so they fail loudly if the server moves even
when the UI tests are not running.
"""
from __future__ import annotations

import logging
import re
from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

logger = logging.getLogger(__name__)

# The suffix the server appends to a VRL body that does not already end in `.`,
# so the program returns the event it just modified.
VRL_RETURN_SUFFIX = " \n ."

# What the import screen's conflict detection matches on. If the server changes
# this wording, a clash stops offering the rename/override controls and is
# reported as a plain failure instead.
DUPLICATE_NAME_PATTERN = re.compile(r"already exist", re.IGNORECASE)

# Exactly what the export writes into the file — no more (the server also
# returns `numArgs`, which it derives, and would be stale in a file).
EXPORT_KEYS = {"name", "function", "params", "transType"}


def vrl_payload(name: str, *, body: str = ".a = 1") -> dict:
    return {"name": name, "function": body, "params": "row", "transType": 0}


def js_payload(name: str, *, body: str = "function transform(row){ return row; }") -> dict:
    return {"name": name, "function": body, "params": "row", "transType": 1}


def fetch_function(client: OpenObserveClient, name: str, *, org: str | None = None) -> dict | None:
    """Find one function in the org's list, the way the export does."""
    kwargs = {"org": org} if org else {}
    resp = client.get("functions", **kwargs)
    assert resp.status_code == 200, f"list functions failed: {resp.status_code} {resp.text}"
    return next((f for f in resp.json().get("list", []) if f.get("name") == name), None)


@pytest.fixture
def temp_vrl_function(client: OpenObserveClient) -> Generator[str, None, None]:
    name = unique_name("pytest_impexp")
    resp = client.post("functions", json=vrl_payload(name))
    assert resp.status_code == 200, f"setup failed: {resp.status_code} {resp.text}"
    yield name
    try:
        client.delete(f"functions/{name}")
    except Exception as e:  # pragma: no cover - cleanup only
        logger.warning("cleanup failed for %s: %s", name, e)


# ----- the conflict contract the import screen reads -----


def test_duplicate_name_is_refused_with_the_message_the_ui_matches(
    client: OpenObserveClient, temp_vrl_function: str
):
    """A second create under one name is refused, and says so in the wording
    the import screen looks for before it offers rename/override."""
    resp = client.post("functions", json=vrl_payload(temp_vrl_function))

    assert resp.status_code == 400, f"expected a refusal, got {resp.status_code} {resp.text}"
    message = resp.json().get("message", "")
    assert DUPLICATE_NAME_PATTERN.search(message), (
        "the import screen decides a clash is a clash by matching 'already exist' "
        f"in this message; got: {message!r}"
    )


def test_override_rewrites_the_function_for_everything_using_it(
    client: OpenObserveClient, temp_vrl_function: str
):
    """Choosing Override on import is a PUT against the one org-wide function:
    the stored body is replaced, and the pipeline that calls it is still
    reported as depending on it rather than being detached by the rewrite."""
    pipeline_name = unique_name("pytest_impexp_pl")
    pipeline_id = None
    try:
        created = client.post(
            "pipelines", json=_pipeline_using_function(pipeline_name, temp_vrl_function)
        )
        assert created.status_code == 200, f"pipeline setup failed: {created.text}"
        pipeline_id = created.json().get("id")

        resp = client.put(
            f"functions/{temp_vrl_function}",
            json=vrl_payload(temp_vrl_function, body=".overridden = true"),
        )
        assert resp.status_code == 200, f"override failed: {resp.status_code} {resp.text}"

        stored = fetch_function(client, temp_vrl_function)
        assert stored is not None, "function disappeared after the override"
        assert ".overridden = true" in stored["function"]

        # The dependency survives the rewrite — this is what the import screen
        # warns about before it lets the user override.
        assoc = client.get(f"functions/{temp_vrl_function}")
        assert assoc.status_code == 200, assoc.text
        assert any(p.get("name") == pipeline_name for p in assoc.json().get("list", [])), (
            "the pipeline that uses the function should still be reported as "
            f"depending on it; got {assoc.json()}"
        )
    finally:
        if pipeline_id:
            client.delete(f"pipelines/{pipeline_id}")


# ----- normalisation, which export/import has to round trip through -----


def test_vrl_body_is_normalised_once_not_on_every_write(client: OpenObserveClient):
    """A VRL body that does not end in `.` gains a return suffix on write.

    Export therefore never gets back the exact text it sent, and re-importing an
    exported file must not stack a second suffix on top.
    """
    name = unique_name("pytest_impexp_norm")
    try:
        assert client.post("functions", json=vrl_payload(name, body=".a = 1")).status_code == 200

        first = fetch_function(client, name)
        assert first is not None
        assert first["function"] == ".a = 1" + VRL_RETURN_SUFFIX, (
            f"expected the return suffix to be appended once, got {first['function']!r}"
        )

        # Writing back exactly what was read — which is what importing an
        # exported file does — must not append the suffix a second time.
        resp = client.put(f"functions/{name}", json=vrl_payload(name, body=first["function"]))
        assert resp.status_code == 200, f"re-write failed: {resp.status_code} {resp.text}"

        second = fetch_function(client, name)
        assert second is not None
        assert second["function"] == first["function"], (
            "a body that already ends in a return should be stored unchanged; "
            f"{first['function']!r} became {second['function']!r}"
        )
    finally:
        client.delete(f"functions/{name}")


def test_js_body_is_stored_verbatim(client: OpenObserveClient):
    """JS is not VRL: it must keep its language and never pick up the VRL
    return suffix, or an exported JS function would come back broken."""
    name = unique_name("pytest_impexp_js")
    body = "function transform(row){ row.js = 1; return row; }"
    try:
        resp = client.post("functions", json=js_payload(name, body=body))
        assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text}"

        stored = fetch_function(client, name)
        assert stored is not None
        assert stored["transType"] == 1, f"language not preserved: {stored}"
        assert stored["function"] == body, (
            f"a JS body must be stored verbatim, got {stored['function']!r}"
        )
        assert not stored["function"].endswith(VRL_RETURN_SUFFIX)
    finally:
        client.delete(f"functions/{name}")


# ----- the wire shape the export file is built from -----


def test_listed_function_carries_the_keys_the_export_writes(
    client: OpenObserveClient, temp_vrl_function: str
):
    """The export file is assembled from these four keys, spelled this way."""
    stored = fetch_function(client, temp_vrl_function)
    assert stored is not None, "function missing from the list"

    missing = EXPORT_KEYS - stored.keys()
    assert not missing, f"the export reads these keys and they were absent: {missing}"

    # camelCase, not snake_case — a rename here silently empties the field in
    # every exported file.
    assert "trans_type" not in stored, f"transType should be camelCase: {stored}"
    # `streams` would name streams the importing org may not have.
    assert "streams" not in stored, f"a function should not carry streams: {stored}"
    assert isinstance(stored["transType"], int), (
        f"transType should be a number, got {type(stored['transType']).__name__}"
    )


# ----- importing one file into more than one org -----


def test_the_same_function_imports_independently_into_two_orgs(client: OpenObserveClient):
    """Importing an exported file into a second org creates a second, separate
    function — editing one must not reach into the other."""
    name = unique_name("pytest_impexp_xorg")
    other_org = _second_org(client)
    if other_org is None:
        pytest.skip("a second organization is not available here")

    try:
        assert client.post("functions", json=vrl_payload(name, body=".a = 1")).status_code == 200
        resp = client.post("functions", json=vrl_payload(name, body=".b = 2"), org=other_org)
        assert resp.status_code == 200, (
            f"the same name in another org should be free: {resp.status_code} {resp.text}"
        )

        in_default = fetch_function(client, name)
        in_other = fetch_function(client, name, org=other_org)
        assert in_default is not None and in_other is not None
        assert ".a = 1" in in_default["function"]
        assert ".b = 2" in in_other["function"]
    finally:
        client.delete(f"functions/{name}")
        if other_org:
            client.delete(f"functions/{name}", org=other_org)


# Orgs cannot be deleted — `DELETE /api/organizations/{id}` 404s even for one
# just created (see tests/orgs/test_organisations.py). A unique org per run would
# therefore leak one org per run forever on a long-lived env, so this reuses a
# single well-known org and only creates it the first time. Names are not unique
# either — posting the same name again makes another org — so look it up first.
SECOND_ORG_NAME = "pytest_fn_import_export_xorg"


def _second_org(client: OpenObserveClient) -> str | None:
    """Identifier of the shared second org, creating it once if absent."""
    listed = client.get("api/organizations", prefix="")
    if listed.status_code == 200:
        body = listed.json()
        for org in body.get("data", body.get("list", []) or []):
            if org.get("name") == SECOND_ORG_NAME:
                return org.get("identifier")

    created = client.post("api/organizations", json={"name": SECOND_ORG_NAME}, prefix="")
    if created.status_code != 200:
        logger.warning("could not create the second org: %s %s", created.status_code, created.text)
        return None
    return created.json().get("identifier")


def _pipeline_using_function(
    pipeline_name: str, function_name: str, *, source_stream: str | None = None
) -> dict:
    """A minimal realtime pipeline whose middle node calls a function.

    `source_stream` defaults to one derived from the pipeline name: a realtime source
    stream may feed only ONE pipeline, so sharing it makes the server answer "a realtime
    pipeline with same source stream already exists" -- also a 400, and nothing to do
    with the rule under test.
    """
    stream = source_stream or f"s_{pipeline_name}"[:60]
    input_id, fn_id, output_id = f"in-{pipeline_name}", f"fn-{pipeline_name}", f"out-{pipeline_name}"

    def edge(source: str, target: str) -> dict:
        return {
            "id": f"e-{source}-{target}",
            "source": source,
            "target": target,
            "type": "custom",
            "animated": True,
            "updatable": True,
            "markerEnd": {"type": "arrowclosed", "width": 20, "height": 20},
            "style": {"strokeWidth": 2},
        }

    return {
        "pipeline_id": "",
        "version": 0,
        "enabled": True,
        "org": "default",
        "name": pipeline_name,
        "description": f"api test pipeline using {function_name}",
        "source": {"source_type": "realtime", "stream_name": stream, "stream_type": "logs"},
        "paused_at": None,
        "nodes": [
            {
                "id": input_id,
                "position": {"x": 100, "y": 100},
                "io_type": "input",
                "data": {
                    "node_type": "stream",
                    "stream_type": "logs",
                    "stream_name": stream,
                    "org_id": "default",
                },
            },
            {
                "id": fn_id,
                "position": {"x": 300, "y": 200},
                "io_type": "default",
                "data": {"node_type": "function", "name": function_name, "after_flatten": True},
            },
            {
                "id": output_id,
                "position": {"x": 500, "y": 300},
                "io_type": "output",
                "data": {
                    "node_type": "stream",
                    "stream_type": "logs",
                    "stream_name": f"{pipeline_name}_dest",
                    "org_id": "default",
                },
            },
        ],
        "edges": [edge(input_id, fn_id), edge(fn_id, output_id)],
    }


# ----- what pipeline function bundling leans on (Phase 2) -----


def test_pipeline_create_is_refused_when_the_function_does_not_exist(
    client: OpenObserveClient,
):
    """A pipeline naming a function the org does not have is refused.

    This is why the import resolves and creates a pipeline's bundled functions
    *before* it posts the pipeline: with the order reversed, every import into a
    fresh org would fail here.
    """
    pipeline_name = unique_name("pytest_bundle_missing_pl")
    missing = unique_name("pytest_bundle_ghost")
    pipeline_id = None
    try:
        resp = client.post("pipelines", json=_pipeline_using_function(pipeline_name, missing))
        if resp.status_code == 200:
            pipeline_id = resp.json().get("id")
        assert resp.status_code == 400, (
            "a pipeline calling a function that does not exist should be refused; "
            f"got {resp.status_code} {resp.text}"
        )
        # The reason matters: a shared source stream is also a 400, so a bare status
        # assertion would pass even if the server dropped this rule entirely.
        assert missing in resp.text, f"the refusal should name the function; got {resp.text}"
    finally:
        if pipeline_id:
            client.delete(f"pipelines/{pipeline_id}")


def test_pipeline_create_is_refused_when_the_function_is_javascript(
    client: OpenObserveClient,
):
    """A function node cannot call a JS function.

    A bundled JS function is created happily and the pipeline is then refused, so
    the import leaves a function behind and reports the pipeline as failed. The
    function has no dependents, so it can be deleted; what matters is that this
    is the server's rule and not something the screen can paper over.
    """
    fn_name = unique_name("pytest_bundle_js")
    pipeline_name = unique_name("pytest_bundle_js_pl")
    pipeline_id = None
    try:
        created = client.post("functions", json=js_payload(fn_name))
        assert created.status_code == 200, f"js function setup failed: {created.text}"

        resp = client.post("pipelines", json=_pipeline_using_function(pipeline_name, fn_name))
        if resp.status_code == 200:
            pipeline_id = resp.json().get("id")
        assert resp.status_code == 400, (
            "a function node calling a JS function should be refused; "
            f"got {resp.status_code} {resp.text}"
        )
        assert re.search(r"javascript", resp.text, re.IGNORECASE), (
            f"the refusal should say the function is JavaScript; got {resp.text}"
        )
    finally:
        if pipeline_id:
            client.delete(f"pipelines/{pipeline_id}")
        client.delete(f"functions/{fn_name}")


def test_a_copy_suffix_is_a_name_the_server_accepts(client: OpenObserveClient):
    """`<name>_1` is a usable function name, and a copy is an independent function.

    The import answers a name taken by different logic by creating a copy under
    the first free `_N`. The name rule it keeps to is the Add form's, which is
    client-side — this pins that the server agrees, and that the original is
    untouched by the copy.
    """
    base = unique_name("pytest_bundle_copy")
    copy = f"{base}_1"
    try:
        original = client.post("functions", json=vrl_payload(base, body=".original = true"))
        assert original.status_code == 200, f"original setup failed: {original.text}"

        resp = client.post("functions", json=vrl_payload(copy, body=".copied = true"))
        assert resp.status_code == 200, (
            f"a `_1` copy name should be accepted; got {resp.status_code} {resp.text}"
        )

        stored_copy = fetch_function(client, copy)
        stored_original = fetch_function(client, base)
        assert stored_copy is not None and stored_original is not None
        assert ".copied = true" in stored_copy["function"]
        # Never overwritten: this is what keeps every other pipeline unchanged.
        assert ".original = true" in stored_original["function"]
    finally:
        client.delete(f"functions/{copy}")
        client.delete(f"functions/{base}")
