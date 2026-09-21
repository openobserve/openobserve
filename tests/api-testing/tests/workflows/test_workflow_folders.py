"""
Workflow folders REST API tests (WFF-API-01 .. WFF-API-13).

Feature: folders for Workflows + folder-scoped RBAC, merged as 8bd20ac96c (#14421).
Plan: .claude/commands/nvpworkflow/workflow-folders-automation.md

Endpoints:
    GET/POST   /api/v2/{org}/folders/workflows                folder list / create -> {"folderId": ...}
    GET/PUT/DELETE /api/v2/{org}/folders/workflows/{id}        folder read / update / delete
    GET        /api/v2/{org}/folders/workflows/name/{name}     folder lookup by display name
    GET        /api/{org}/workflows?folder=&all_folders=&search_substring=
    POST       /api/{org}/workflows?folder=&draft=
    PATCH      /api/v2/{org}/workflows/move                    {"workflow_ids": [], "dst_folder_id": ""}
    POST       /api/{org}/workflows/promote/{id}?folder=

The `folder` query param is the folder SLUG, which is the `folderId` folder-create returns.
Omitting it means the org's default folder, which is how pre-folders clients behave.

All artifacts are namespaced `wf_auto_fld_*` and torn down by fixtures.
"""

import os
import time
import uuid

import pytest

ORG_ID = os.environ.get("TEST_ORG_ID", "default")

SINK_URL = "http://example.com/sink"

# move_workflows rejects more than MAX_MOVE_WORKFLOWS ids before authorizing anything.
MAX_MOVE_WORKFLOWS = 100


@pytest.fixture(scope="module", autouse=True)
def _require_workflows(create_session, base_url):
    # WORKFLOWS_REQUIRED=1 (set in ent CI) turns the skip into a hard fail so a
    # route-registration regression or an accidentally-off feature flag can't
    # slip through as a silent skip.
    resp = create_session.get(f"{base_url}api/{ORG_ID}/workflows")
    if resp.status_code in (403, 404):
        msg = f"Workflows feature not available (/workflows returned {resp.status_code})."
        if os.environ.get("WORKFLOWS_REQUIRED") == "1":
            pytest.fail(f"{msg} WORKFLOWS_REQUIRED=1 — expected enabled on this build.")
        pytest.skip(f"{msg} Enterprise-only / not enabled on this build.")


def _suffix():
    return f"{int(time.time())}{uuid.uuid4().hex[:4]}"


def _workflow_payload(name, dest_name, description="folder automation workflow"):
    """Minimal valid graph: Alert Trigger -> Destination bound to a pipeline destination."""
    return {
        "workflow": {
            "id": "",
            "org_id": "",
            "created_at": 0,
            "updated_at": 0,
            "created_by": "",
            "name": name,
            "description": description,
            "enabled": True,
            "nodes": [
                {
                    "id": "trigger-1",
                    "data": {"node_type": "workflow_trigger"},
                    "position": {"x": 100, "y": 100},
                    "io_type": "input",
                },
                {
                    "id": "dest-1",
                    "data": {
                        "node_type": "destination",
                        "destination_id": dest_name,
                        "template_override": None,
                    },
                    "position": {"x": 400, "y": 100},
                    "io_type": "output",
                },
            ],
            "edges": [{"id": "etrigger-1-dest-1", "source": "trigger-1", "target": "dest-1"}],
        },
        "trigger_type": "AlertFired",
    }


# --------------------------------------------------------------------------- helpers


def _list_items(session, base_url, strict=True, **params):
    """GET the workflow list and normalise the envelope to a plain list of rows.

    `strict=False` is for teardown: a folder a test already deleted answers 500
    ("folder not found"), and a cleanup pass must not turn that into an error.
    """
    resp = session.get(f"{base_url}api/{ORG_ID}/workflows", params=params)
    if not strict and resp.status_code != 200:
        return []
    assert resp.status_code == 200, f"list failed: {resp.status_code} {resp.text[:300]}"
    data = resp.json()
    return data if isinstance(data, list) else data.get("list", data.get("data", []))


def _ids(items):
    return {w.get("id") for w in items}


def _row(items, wf_id):
    return next((w for w in items if w.get("id") == wf_id), None)


def _create_folder(session, base_url, name, description="workflow folder automation"):
    resp = session.post(
        f"{base_url}api/v2/{ORG_ID}/folders/workflows",
        json={"name": name, "description": description},
    )
    assert resp.status_code == 200, f"folder create failed: {resp.status_code} {resp.text[:300]}"
    folder_id = resp.json().get("folderId")
    assert folder_id, f"no folderId in create response: {resp.text[:300]}"
    return folder_id


def _delete_folder(session, base_url, folder_id):
    return session.delete(f"{base_url}api/v2/{ORG_ID}/folders/workflows/{folder_id}")


def _create_workflow(session, base_url, name, dest_name, folder=None, draft=None):
    params = {}
    if folder is not None:
        params["folder"] = folder
    if draft is not None:
        params["draft"] = draft
    resp = session.post(
        f"{base_url}api/{ORG_ID}/workflows",
        params=params,
        json=_workflow_payload(name, dest_name),
    )
    assert resp.status_code == 200, f"create failed: {resp.status_code} {resp.text[:300]}"
    wf_id = resp.json().get("id")
    assert wf_id, f"no id in create response: {resp.text[:300]}"
    return wf_id


def _promote(session, base_url, workflow_id, folder=None):
    """Promote a draft. Returns 201 Created, not 200 — `MetaHttpResponse::created`."""
    params = {"folder": folder} if folder else {}
    return session.post(
        f"{base_url}api/{ORG_ID}/workflows/promote/{workflow_id}", params=params
    )


def _delete_workflow(session, base_url, workflow_id, draft=False):
    """Delete a workflow. A DRAFT needs `?draft=true` or the call 404s.

    Note the asymmetry with create: `save` parses the flag with `unwrap_or(true)`,
    `delete` with `unwrap_or(false)`. The same junk value means opposite things.
    """
    params = {"draft": "true"} if draft else {}
    return session.delete(f"{base_url}api/{ORG_ID}/workflows/{workflow_id}", params=params)


def _move(session, base_url, workflow_ids, dst_folder_id):
    return session.patch(
        f"{base_url}api/v2/{ORG_ID}/workflows/move",
        json={"workflow_ids": workflow_ids, "dst_folder_id": dst_folder_id},
    )


# --------------------------------------------------------------------------- fixtures


@pytest.fixture
def pipeline_destination(create_session, base_url):
    """A pipeline destination for the Destination node. Workflow graph validation needs a real one."""
    session = create_session
    name = f"wf_auto_fld_dest_{_suffix()}"
    # NOT a loopback/private URL: the SSRF guard rejects those at destination-SAVE time,
    # which fails the fixture rather than any assertion. example.com is IANA-reserved and
    # never contacted — these tests never fire the workflow.
    payload = {
        "name": name,
        "url": SINK_URL,
        "method": "post",
        "type": "http",
    }
    resp = session.post(
        f"{base_url}api/{ORG_ID}/alerts/destinations?module=pipeline", json=payload
    )
    assert resp.status_code == 200, f"destination create failed: {resp.status_code} {resp.text[:300]}"
    yield name
    session.delete(f"{base_url}api/{ORG_ID}/alerts/destinations/{name}")


@pytest.fixture
def folder_factory(create_session, base_url):
    """Creates workflow folders and tears them down, emptying them first if a test left rows behind."""
    session = create_session
    created = []

    def _make(label="a"):
        folder_id = _create_folder(session, base_url, f"wf_auto_fld_{label}_{_suffix()}")
        created.append(folder_id)
        return folder_id

    yield _make

    for folder_id in reversed(created):
        # A folder still holding a workflow or a draft refuses to delete, so sweep
        # its contents first — otherwise one failed test leaks a folder forever.
        for row in _list_items(session, base_url, strict=False, folder=folder_id):
            _delete_workflow(session, base_url, row["id"], draft=bool(row.get("is_draft")))
        _delete_folder(session, base_url, folder_id)


@pytest.fixture
def workflow_factory(create_session, base_url, pipeline_destination):
    """Creates workflows/drafts in a given folder and deletes them afterwards."""
    session = create_session
    created = []

    def _make(folder=None, draft=None, name=None):
        wf_name = name or f"wf_auto_fld_{_suffix()}"
        wf_id = _create_workflow(
            session, base_url, wf_name, pipeline_destination, folder=folder, draft=draft
        )
        # Remember draft-ness: deleting a draft without ?draft=true 404s and leaks it,
        # which then blocks its folder's teardown too.
        created.append((wf_id, str(draft).lower() == "true"))
        return {"id": wf_id, "name": wf_name}

    yield _make

    for wf_id, was_draft in reversed(created):
        # A promoted draft is no longer a draft, so try the recorded kind then the other.
        if _delete_workflow(session, base_url, wf_id, draft=was_draft).status_code == 404:
            _delete_workflow(session, base_url, wf_id, draft=not was_draft)


# --------------------------------------------------------------------------- WFF-API-01


def test_workflow_folder_crud(create_session, base_url):
    """WFF-API-01 — create -> get -> get-by-name -> update -> delete for FolderType::Workflows."""
    session = create_session
    name = f"wf_auto_fld_crud_{_suffix()}"
    folder_id = _create_folder(session, base_url, name, "created by automation")

    try:
        resp = session.get(f"{base_url}api/v2/{ORG_ID}/folders/workflows/{folder_id}")
        assert resp.status_code == 200, f"get failed: {resp.status_code} {resp.text[:300]}"
        assert resp.json().get("name") == name

        resp = session.get(f"{base_url}api/v2/{ORG_ID}/folders/workflows/name/{name}")
        assert resp.status_code == 200, f"get-by-name failed: {resp.status_code} {resp.text[:300]}"
        assert resp.json().get("folderId") == folder_id

        renamed = f"{name}_renamed"
        resp = session.put(
            f"{base_url}api/v2/{ORG_ID}/folders/workflows/{folder_id}",
            json={"folderId": folder_id, "name": renamed, "description": "updated"},
        )
        assert resp.status_code == 200, f"update failed: {resp.status_code} {resp.text[:300]}"
        assert (
            session.get(f"{base_url}api/v2/{ORG_ID}/folders/workflows/{folder_id}").json()["name"]
            == renamed
        )

        listed = session.get(f"{base_url}api/v2/{ORG_ID}/folders/workflows")
        assert listed.status_code == 200
        body = listed.json()
        folders = body if isinstance(body, list) else body.get("list", [])
        assert folder_id in {f.get("folderId") for f in folders}
    finally:
        resp = _delete_folder(session, base_url, folder_id)
        assert resp.status_code == 200, f"delete failed: {resp.status_code} {resp.text[:300]}"

    assert session.get(f"{base_url}api/v2/{ORG_ID}/folders/workflows/{folder_id}").status_code == 404


# --------------------------------------------------------------------------- WFF-API-02/03


def test_create_workflow_into_folder(create_session, base_url, folder_factory, workflow_factory):
    """WFF-API-02 — ?folder= puts the workflow in that folder, and the row reports slug + display name."""
    session = create_session
    folder_id = folder_factory("into")
    wf = workflow_factory(folder=folder_id)

    row = _row(_list_items(session, base_url, folder=folder_id), wf["id"])
    assert row is not None, f"workflow {wf['id']} not listed in folder {folder_id}"
    # folder_id in the response is the slug the browser puts in the URL, not the primary key.
    assert row.get("folder_id") == folder_id
    expected_name = session.get(
        f"{base_url}api/v2/{ORG_ID}/folders/workflows/{folder_id}"
    ).json()["name"]
    assert row.get("folder_name") == expected_name


def test_create_workflow_without_folder_lands_in_default(
    create_session, base_url, workflow_factory
):
    """WFF-API-03 — a pre-folders client that sends no `folder` still lands in the default folder."""
    wf = workflow_factory()
    row = _row(_list_items(create_session, base_url), wf["id"])
    assert row is not None, "workflow created without ?folder= is missing from the default listing"
    assert row.get("folder_id") == "default"


# --------------------------------------------------------------------------- WFF-API-04/05


def test_folder_listing_is_scoped_and_all_folders_spans(
    create_session, base_url, folder_factory, workflow_factory
):
    """WFF-API-04 — folder=A excludes B's rows; all_folders=true returns both."""
    session = create_session
    folder_a, folder_b = folder_factory("a"), folder_factory("b")
    wf_a = workflow_factory(folder=folder_a)
    wf_b = workflow_factory(folder=folder_b)

    in_a = _ids(_list_items(session, base_url, folder=folder_a))
    assert wf_a["id"] in in_a
    assert wf_b["id"] not in in_a, "folder A's listing leaked a workflow from folder B"

    in_b = _ids(_list_items(session, base_url, folder=folder_b))
    assert wf_b["id"] in in_b
    assert wf_a["id"] not in in_b

    across = _ids(_list_items(session, base_url, all_folders="true"))
    assert {wf_a["id"], wf_b["id"]} <= across


def test_all_folders_overrides_folder(
    create_session, base_url, folder_factory, workflow_factory
):
    """WFF-API-05 — all_folders=true wins when both params are sent (no folder=all sentinel)."""
    session = create_session
    folder_a, folder_b = folder_factory("a"), folder_factory("b")
    wf_a = workflow_factory(folder=folder_a)
    wf_b = workflow_factory(folder=folder_b)

    both = _ids(_list_items(session, base_url, all_folders="true", folder=folder_b))
    assert {wf_a["id"], wf_b["id"]} <= both, "all_folders did not override the folder param"


# --------------------------------------------------------------------------- WFF-API-06/07


def test_move_workflow_between_folders(
    create_session, base_url, folder_factory, workflow_factory
):
    """WFF-API-06 — a moved workflow leaves the source listing and appears in the destination."""
    session = create_session
    folder_a, folder_b = folder_factory("a"), folder_factory("b")
    wf = workflow_factory(folder=folder_a)

    resp = _move(session, base_url, [wf["id"]], folder_b)
    assert resp.status_code == 200, f"move failed: {resp.status_code} {resp.text[:300]}"

    assert wf["id"] not in _ids(_list_items(session, base_url, folder=folder_a))
    moved = _row(_list_items(session, base_url, folder=folder_b), wf["id"])
    assert moved is not None, "workflow missing from the destination folder after move"
    assert moved.get("folder_id") == folder_b


@pytest.mark.parametrize(
    "body_key, body_value, expected_status",
    [
        ("workflow_ids", [], 400),
        ("dst_folder_id", "   ", 400),
    ],
)
def test_move_validation_rejects_bad_bodies(
    create_session, base_url, folder_factory, workflow_factory, body_key, body_value, expected_status
):
    """WFF-API-07a — empty id list and a blank destination are each rejected before any work."""
    session = create_session
    folder_a, folder_b = folder_factory("a"), folder_factory("b")
    wf = workflow_factory(folder=folder_a)

    body = {"workflow_ids": [wf["id"]], "dst_folder_id": folder_b}
    body[body_key] = body_value
    resp = session.patch(f"{base_url}api/v2/{ORG_ID}/workflows/move", json=body)
    assert resp.status_code == expected_status, f"got {resp.status_code}: {resp.text[:300]}"


def test_move_rejects_more_than_max_ids(create_session, base_url, folder_factory):
    """WFF-API-07b — the id list is bounded because the move runs one OpenFGA check per id."""
    session = create_session
    folder_b = folder_factory("b")
    ids = [f"wf_auto_fld_bogus_{i}" for i in range(MAX_MOVE_WORKFLOWS + 1)]
    resp = _move(session, base_url, ids, folder_b)
    assert resp.status_code == 400, f"expected 400, got {resp.status_code}: {resp.text[:300]}"
    assert str(MAX_MOVE_WORKFLOWS) in resp.text


def test_move_unknown_id_is_not_reported_as_success(
    create_session, base_url, folder_factory
):
    """WFF-API-07c — a nonexistent id must fail loudly; the UPDATE would otherwise match no rows."""
    session = create_session
    folder_b = folder_factory("b")
    resp = _move(session, base_url, [f"wf_auto_fld_missing_{_suffix()}"], folder_b)
    assert resp.status_code != 200, f"move of an unknown id reported success: {resp.text[:300]}"


# --------------------------------------------------------------------------- WFF-API-08/09


def test_delete_folder_blocked_while_it_holds_a_workflow(
    create_session, base_url, folder_factory, workflow_factory
):
    """WFF-API-08 — a non-empty folder refuses to delete, and deletes once its workflow moves out."""
    session = create_session
    folder_a, folder_b = folder_factory("a"), folder_factory("b")
    wf = workflow_factory(folder=folder_a)

    resp = _delete_folder(session, base_url, folder_a)
    assert resp.status_code == 400, f"expected 400, got {resp.status_code}: {resp.text[:300]}"
    assert "contains workflows" in resp.text.lower()

    assert _move(session, base_url, [wf["id"]], folder_b).status_code == 200
    resp = _delete_folder(session, base_url, folder_a)
    assert resp.status_code == 200, f"delete after emptying failed: {resp.status_code} {resp.text[:300]}"


def test_delete_folder_blocked_while_it_holds_only_a_draft(
    create_session, base_url, folder_factory, workflow_factory
):
    """WFF-API-09 — drafts count toward the guard; before the fix this was an FK violation on Postgres."""
    session = create_session
    folder_a = folder_factory("draftonly")
    draft = workflow_factory(folder=folder_a, draft="true")

    resp = _delete_folder(session, base_url, folder_a)
    assert resp.status_code == 400, (
        f"a drafts-only folder was deletable: {resp.status_code} {resp.text[:300]}"
    )
    assert "contains workflows" in resp.text.lower()

    _delete_workflow(session, base_url, draft["id"], draft=True)


# --------------------------------------------------------------------------- WFF-API-10


def test_draft_is_folder_scoped(create_session, base_url, folder_factory, workflow_factory):
    """WFF-API-10 — a draft belongs to one folder. It used to be appended to every folder's listing."""
    session = create_session
    folder_a, folder_b = folder_factory("a"), folder_factory("b")
    draft = workflow_factory(folder=folder_a, draft="true")

    row = _row(_list_items(session, base_url, folder=folder_a), draft["id"])
    assert row is not None, "draft missing from the folder it was created in"
    assert row.get("is_draft") is True
    assert row.get("folder_id") == folder_a

    assert draft["id"] not in _ids(_list_items(session, base_url, folder=folder_b)), (
        "draft leaked into another folder's listing"
    )
    assert draft["id"] not in _ids(_list_items(session, base_url)), (
        "draft leaked into the default folder's listing"
    )


# --------------------------------------------------------------------------- WFF-API-11


def test_promote_without_folder_publishes_into_the_drafts_own_folder(
    create_session, base_url, folder_factory, workflow_factory
):
    """WFF-API-11a — promoting with no ?folder= keeps the draft where it is, rather than dumping it in default."""
    session = create_session
    folder_a = folder_factory("promote")
    draft = workflow_factory(folder=folder_a, draft="true")

    resp = _promote(session, base_url, draft["id"])
    assert resp.status_code == 201, f"promote failed: {resp.status_code} {resp.text[:300]}"

    row = _row(_list_items(session, base_url, folder=folder_a), draft["id"])
    assert row is not None, "promoted workflow left its own folder"
    assert row.get("is_draft") is False
    assert draft["id"] not in _ids(_list_items(session, base_url)), (
        "promote with no folder published into the default folder"
    )


def test_promote_with_folder_publishes_into_that_folder(
    create_session, base_url, folder_factory, workflow_factory
):
    """WFF-API-11b — ?folder=B publishes the draft into B."""
    session = create_session
    folder_a, folder_b = folder_factory("a"), folder_factory("b")
    draft = workflow_factory(folder=folder_a, draft="true")

    resp = _promote(session, base_url, draft["id"], folder=folder_b)
    assert resp.status_code == 201, f"promote failed: {resp.status_code} {resp.text[:300]}"

    row = _row(_list_items(session, base_url, folder=folder_b), draft["id"])
    assert row is not None, "promoted workflow is not in the requested folder"
    assert row.get("is_draft") is False


# --------------------------------------------------------------------------- WFF-API-12


def test_cross_folder_search_matches_name_and_description(
    create_session, base_url, folder_factory, workflow_factory
):
    """WFF-API-12 — search_substring is matched in the database, so it spans folders and covers drafts."""
    session = create_session
    folder_a, folder_b = folder_factory("a"), folder_factory("b")
    token = f"needle{_suffix()}"

    published = workflow_factory(folder=folder_a, name=f"wf_auto_fld_{token}")
    draft = workflow_factory(folder=folder_b, draft="true", name=f"wf_auto_fld_{token}_draft")

    hits = _ids(_list_items(session, base_url, all_folders="true", search_substring=token))
    assert {published["id"], draft["id"]} <= hits, "cross-folder search missed a row"

    # The description is the same on every row this suite creates, so a description-only
    # term must still match — this is the half of the LIKE that name matching would hide.
    by_description = _ids(
        _list_items(session, base_url, all_folders="true", search_substring="folder automation")
    )
    assert published["id"] in by_description, "search_substring did not match the description"

    scoped = _ids(_list_items(session, base_url, folder=folder_a, search_substring=token))
    assert published["id"] in scoped
    assert draft["id"] not in scoped, "a folder-scoped search returned a row from another folder"


# --------------------------------------------------------------------------- WFF-API-13


@pytest.mark.parametrize(
    "draft_param, expected_is_draft",
    [
        ("false", False),
        ("true", True),
        # is_draft.parse().unwrap_or(true) — an unparseable value is treated as a draft,
        # so a typo can never publish a workflow by accident.
        ("yes", True),
    ],
)
def test_draft_param_parsing(
    create_session, base_url, folder_factory, workflow_factory, draft_param, expected_is_draft
):
    """WFF-API-13 — the draft flag is parsed leniently and fails closed to `draft`."""
    session = create_session
    folder_id = folder_factory("draftparam")
    wf = workflow_factory(folder=folder_id, draft=draft_param)

    row = _row(_list_items(session, base_url, folder=folder_id), wf["id"])
    assert row is not None, f"workflow created with draft={draft_param} is not listed"
    assert row.get("is_draft") is expected_is_draft


# --------------------------------------------------------------------------- WFF-API-14..18
# Draft-specific folder behaviour. Drafts are folder-scoped like published workflows but
# follow a different code path everywhere: a separate table, a separate listing call, and
# no move support at all — so each of these is a hole the published-workflow tests cannot cover.


def test_moving_a_draft_is_rejected(create_session, base_url, folder_factory, workflow_factory):
    """WFF-API-14 — the move endpoint only knows published workflows, and must say so.

    `folder_pks_by_ids` queries the workflows table alone, so a draft id resolves to
    nothing. The danger is not the refusal but a silent success: the UPDATE would match
    no rows and the caller would be told the draft moved.
    """
    session = create_session
    folder_a, folder_b = folder_factory("a"), folder_factory("b")
    draft = workflow_factory(folder=folder_a, draft="true")

    resp = _move(session, base_url, [draft["id"]], folder_b)
    assert resp.status_code != 200, f"moving a draft reported success: {resp.text[:300]}"

    # It must still be where it started, still a draft.
    row = _row(_list_items(session, base_url, folder=folder_a), draft["id"])
    assert row is not None, "the draft vanished from its folder after a rejected move"
    assert row.get("is_draft") is True
    assert draft["id"] not in _ids(_list_items(session, base_url, folder=folder_b))


def test_draft_appears_in_the_cross_folder_listing(
    create_session, base_url, folder_factory, workflow_factory
):
    """WFF-API-15 — all_folders=true spans drafts too, carrying their own folder identity.

    Drafts are fetched by a second call inside the list handler, so a folder filter that
    works for published rows can still be wrong for drafts.
    """
    session = create_session
    folder_a = folder_factory("a")
    draft = workflow_factory(folder=folder_a, draft="true")

    row = _row(_list_items(session, base_url, all_folders="true"), draft["id"])
    assert row is not None, "draft missing from the cross-folder listing"
    assert row.get("is_draft") is True
    assert row.get("folder_id") == folder_a, "draft reported the wrong folder across folders"


def test_promote_leaves_exactly_one_row(
    create_session, base_url, folder_factory, workflow_factory
):
    """WFF-API-16 — promotion moves the row between tables; it must not leave a copy in both.

    `promote_draft` writes the workflow then fires `notify_draft_delete`. If the delete is
    skipped the id appears twice in one listing — once as a draft, once published.
    """
    session = create_session
    folder_a = folder_factory("promote-once")
    draft = workflow_factory(folder=folder_a, draft="true")

    resp = _promote(session, base_url, draft["id"])
    assert resp.status_code == 201, f"promote failed: {resp.status_code} {resp.text[:300]}"

    rows = [w for w in _list_items(session, base_url, folder=folder_a) if w.get("id") == draft["id"]]
    assert len(rows) == 1, f"expected exactly one row after promote, got {len(rows)}"
    assert rows[0].get("is_draft") is False


def test_cross_folder_promote_moves_the_draft_out_of_its_folder(
    create_session, base_url, folder_factory, workflow_factory
):
    """WFF-API-17 — promoting into another folder is the ONLY way a draft changes folder.

    The move endpoint refuses drafts (WFF-API-14), so this path carries the whole feature.
    It must leave nothing behind in the source folder.
    """
    session = create_session
    folder_a, folder_b = folder_factory("a"), folder_factory("b")
    draft = workflow_factory(folder=folder_a, draft="true")

    resp = _promote(session, base_url, draft["id"], folder=folder_b)
    assert resp.status_code == 201, (
        f"cross-folder promote failed: {resp.status_code} {resp.text[:300]}"
    )

    assert draft["id"] not in _ids(_list_items(session, base_url, folder=folder_a)), (
        "the promoted workflow is still listed under the folder it was drafted in"
    )
    row = _row(_list_items(session, base_url, folder=folder_b), draft["id"])
    assert row is not None, "the promoted workflow is not in the destination folder"
    assert row.get("is_draft") is False


def test_drafts_only_folder_becomes_deletable_once_the_draft_goes(
    create_session, base_url, folder_factory, workflow_factory
):
    """WFF-API-18 — completes WFF-API-09: the guard must LIFT, not just fire.

    A count that never reaches zero would block the folder forever, which reads exactly
    like the guard working.
    """
    session = create_session
    folder_id = folder_factory("draftonly-lift")
    draft = workflow_factory(folder=folder_id, draft="true")

    assert _delete_folder(session, base_url, folder_id).status_code == 400

    resp = _delete_workflow(session, base_url, draft["id"], draft=True)
    assert resp.status_code == 200, f"draft delete failed: {resp.status_code} {resp.text[:300]}"

    resp = _delete_folder(session, base_url, folder_id)
    assert resp.status_code == 200, (
        f"folder still undeletable after its only draft was removed: "
        f"{resp.status_code} {resp.text[:300]}"
    )
