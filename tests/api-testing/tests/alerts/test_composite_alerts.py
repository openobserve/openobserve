"""Black-box contracts for Composite Alerts.

These tests intentionally describe the public v2 API before the implementation
exists.  They must not be xfailed or skipped when the endpoint is absent: a 404
is a real contract failure during the TDD implementation phase.

The suite keeps composites disabled unless a lifecycle assertion specifically
needs an enabled definition.  This avoids depending on a child query run and
keeps the API contracts deterministic.
"""
from __future__ import annotations

import logging
from copy import deepcopy
from collections.abc import Generator
from typing import Any

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

from .test_v2 import _alert_payload, _destination_payload, _template_payload

logger = logging.getLogger(__name__)


def _list(client: OpenObserveClient, query: str = "") -> list[dict[str, Any]]:
    response = client.get(f"alerts{query}", prefix="api/v2/")
    assert response.status_code == 200, response.text
    body = response.json()
    assert isinstance(body.get("list"), list), body
    return body["list"]


def _find_by_name(client: OpenObserveClient, name: str) -> dict[str, Any]:
    row = next((item for item in _list(client) if item.get("name") == name), None)
    assert row is not None, f"{name!r} missing from the unified alert list"
    return row


def _composite_payload(
    *,
    name: str,
    child_ids: list[str],
    expression: str | None = None,
    enabled: bool = False,
    priority: int = 2,
    tags: list[str] | None = None,
    description: str = "composite API contract",
    stale_child_policy: str = "use_last_state",
    warning_counts_as_firing: bool = True,
    destination: str | None = None,
    template: str | None = None,
) -> dict[str, Any]:
    assert len(child_ids) >= 2
    expression = expression or " && ".join(f"{{{child_id}}}" for child_id in child_ids)
    return {
        "alert_type": "composite",
        "name": name,
        "description": description,
        "enabled": enabled,
        "destinations": [destination] if destination else [],
        "template": template,
        "context_attributes": {"service": "pytest-composite"},
        "trigger_condition": {"silence": 15},
        "creates_incident": False,
        "workflows": [],
        "priority": priority,
        "tags": tags if tags is not None else ["env:test", "kind:composite"],
        "composite_condition": {
            "expression": expression,
            "warning_counts_as_firing": warning_counts_as_firing,
            "stale_child_policy": stale_child_policy,
        },
    }


def _create_composite(
    client: OpenObserveClient,
    folder_id: str,
    payload: dict[str, Any],
) -> str:
    response = client.post(
        f"alerts?folder={folder_id}", prefix="api/v2/", json=payload
    )
    assert response.status_code == 200, response.text
    row = _find_by_name(client, payload["name"])
    assert row["alert_type"] == "composite", row
    return row["alert_id"]


def _delete_best_effort(client: OpenObserveClient, alert_id: str) -> None:
    try:
        client.delete(f"alerts/{alert_id}", prefix="api/v2/")
    except Exception as exc:  # cleanup must not hide the assertion that failed
        logger.warning("composite fixture cleanup failed for %s: %s", alert_id, exc)


@pytest.fixture
def composite_prereqs(client: OpenObserveClient) -> Generator[dict[str, Any], None, None]:
    """Three ordinary child alerts plus normal alert delivery prerequisites."""
    folder_name = unique_name("cmp_folder")
    template_name = unique_name("cmp_tmpl")
    destination_name = unique_name("cmp_dest")

    response = client.post(
        "folders/alerts",
        prefix="api/v2/",
        json={"name": folder_name, "description": "composite contracts"},
    )
    assert response.status_code == 200, response.text
    folder_id = response.json()["folderId"]

    response = client.post("alerts/templates", json=_template_payload(template_name))
    assert response.status_code == 200, response.text
    response = client.post(
        "alerts/destinations",
        json=_destination_payload(destination_name, template_name),
    )
    assert response.status_code == 200, response.text

    child_ids: list[str] = []
    child_payloads: dict[str, dict[str, Any]] = {}
    for index in range(3):
        child_name = unique_name(f"cmp_child_{index}")
        payload = _alert_payload(
            name=child_name,
            folder_id=folder_id,
            template=template_name,
            destination=destination_name,
            enabled=False,
        )
        response = client.post(
            f"alerts?folder={folder_id}", prefix="api/v2/", json=payload
        )
        assert response.status_code == 200, response.text
        child_id = _find_by_name(client, child_name)["alert_id"]
        child_ids.append(child_id)
        child_payloads[child_id] = payload

    created_composites: list[str] = []
    yield {
        "folder_id": folder_id,
        "child_ids": child_ids,
        "child_payloads": child_payloads,
        "destination": destination_name,
        "template": template_name,
        "created_composites": created_composites,
    }

    # Delete parents before children so the reverse-reference guard remains a
    # useful invariant even during fixture teardown.
    for alert_id in reversed(created_composites):
        _delete_best_effort(client, alert_id)
    for alert_id in child_ids:
        _delete_best_effort(client, alert_id)
    client.delete(f"alerts/destinations/{destination_name}")
    client.delete(f"alerts/templates/{template_name}")
    client.delete(f"folders/alerts/{folder_id}", prefix="api/v2/")


def _tracked_create(
    client: OpenObserveClient,
    prereqs: dict[str, Any],
    payload: dict[str, Any],
) -> str:
    alert_id = _create_composite(client, prereqs["folder_id"], payload)
    prereqs["created_composites"].append(alert_id)
    return alert_id


def test_composite_crud_get_and_live_scheduler_diagnostic(
    client: OpenObserveClient, composite_prereqs: dict[str, Any]
):
    payload = _composite_payload(
        name=unique_name("cmp_crud"),
        child_ids=composite_prereqs["child_ids"][:2],
        destination=composite_prereqs["destination"],
        template=composite_prereqs["template"],
    )
    alert_id = _tracked_create(client, composite_prereqs, payload)

    response = client.get(f"alerts/{alert_id}", prefix="api/v2/")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["alert_type"] == "composite"
    assert body["name"] == payload["name"]
    assert body["enabled"] is False
    assert body["scheduler_job_present"] is False
    assert body["composite_condition"] == {
        **payload["composite_condition"],
        "expression": "(" + payload["composite_condition"]["expression"] + ")",
    }
    assert [child["alert_id"] for child in body["children"]] == composite_prereqs[
        "child_ids"
    ][:2]
    for child in body["children"]:
        assert child["accessible"] is True
        assert set(("stale", "truth", "stale_deadline")) <= child.keys()

    updated = _composite_payload(
        name=payload["name"],
        child_ids=composite_prereqs["child_ids"][:2],
        description="updated composite",
        stale_child_policy="treat_as_true",
        warning_counts_as_firing=False,
        destination=composite_prereqs["destination"],
        template=composite_prereqs["template"],
    )
    response = client.put(
        f"alerts/{alert_id}?folder={composite_prereqs['folder_id']}",
        prefix="api/v2/",
        json=updated,
    )
    assert response.status_code == 200, response.text
    detail = client.get(f"alerts/{alert_id}", prefix="api/v2/").json()
    assert detail["description"] == "updated composite"
    assert detail["composite_condition"]["stale_child_policy"] == "treat_as_true"
    assert detail["composite_condition"]["warning_counts_as_firing"] is False


def test_composite_create_rejects_a_client_supplied_id(
    client: OpenObserveClient, composite_prereqs: dict[str, Any]
):
    supplied = "3YwZJgJ0fK5JYQvSz5mK8YzLq8A"
    payload = _composite_payload(
        name=unique_name("cmp_client_id"),
        child_ids=composite_prereqs["child_ids"][:2],
    )
    payload["id"] = supplied

    response = client.post(
        f"alerts?folder={composite_prereqs['folder_id']}",
        prefix="api/v2/",
        json=payload,
    )

    assert response.status_code == 400, response.text
    assert response.json()["code"] == "composite_unsupported_field"
    assert response.json()["field"] == "id"
    assert client.get(f"alerts/{supplied}", prefix="api/v2/").status_code == 404


def test_validate_returns_canonical_expression_and_all_child_diagnostics(
    client: OpenObserveClient, composite_prereqs: dict[str, Any]
):
    first, second = composite_prereqs["child_ids"][:2]
    response = client.post(
        "alerts/composites/validate",
        prefix="api/v2/",
        json={
            "folder_id": composite_prereqs["folder_id"],
            "composite_condition": {
                "expression": f"  {{{first}}} || ( {{{second}}} ) ",
                "warning_counts_as_firing": True,
                "stale_child_policy": "use_last_state",
            },
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["valid"] is True
    assert body["canonical_expression"] == f"({{{first}}} || {{{second}}})"
    assert [child["alert_id"] for child in body["children"]] == [first, second]
    assert body["result"] is False
    assert body["result_level"] == "ok"
    assert all(child["stale"] is True for child in body["children"])
    warning_codes = {warning["code"] for warning in body["warnings"]}
    assert {"child_disabled", "child_never_evaluated"} <= warning_codes


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("stream_name",), "must-not-be-stored"),
        (("query_condition",), {"type": "sql", "sql": "select 1"}),
        (("row_template",), "query-only-row-template"),
        (("is_real_time",), True),
        (("trigger_condition", "period"), 10),
        (("trigger_condition", "operator"), ">="),
        (("trigger_condition", "frequency"), 60),
        (("trigger_condition", "frequency_type"), "minutes"),
        (("trigger_condition", "cron"), "* * * * *"),
        (("trigger_condition", "timezone"), "UTC"),
        (("trigger_condition", "threshold"), 1),
        (("trigger_condition", "tolerance_in_secs"), 30),
    ],
)
def test_composite_rejects_query_only_fields_instead_of_silently_ignoring_them(
    client: OpenObserveClient,
    composite_prereqs: dict[str, Any],
    path: tuple[str, ...],
    value: Any,
):
    payload = _composite_payload(
        name=unique_name("cmp_dead_field"),
        child_ids=composite_prereqs["child_ids"][:2],
    )
    target: dict[str, Any] = payload
    for segment in path[:-1]:
        target = target[segment]
    target[path[-1]] = value
    response = client.post(
        f"alerts?folder={composite_prereqs['folder_id']}",
        prefix="api/v2/",
        json=payload,
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "composite_unsupported_field"
    assert response.json()["field"] == ".".join(path)


def test_missing_child_is_non_disclosing_across_create_update_and_validate(
    client: OpenObserveClient, composite_prereqs: dict[str, Any]
):
    existing = composite_prereqs["child_ids"][0]
    # Valid KSUID copied from the format/length of server-generated IDs, but
    # intentionally not present.  It must not be treated as a syntax error.
    missing = "3YwZJgJ0fK5JYQvSz5mK8YzLq8A"
    expression = f"{{{existing}}} && {{{missing}}}"
    payload = _composite_payload(
        name=unique_name("cmp_opaque"),
        child_ids=[existing, missing],
        expression=expression,
    )

    create = client.post(
        f"alerts?folder={composite_prereqs['folder_id']}",
        prefix="api/v2/",
        json=payload,
    )
    validate = client.post(
        "alerts/composites/validate",
        prefix="api/v2/",
        json={
            "folder_id": composite_prereqs["folder_id"],
            "composite_condition": payload["composite_condition"],
        },
    )

    valid_payload = _composite_payload(
        name=unique_name("cmp_update_opaque"),
        child_ids=composite_prereqs["child_ids"][:2],
    )
    alert_id = _tracked_create(client, composite_prereqs, valid_payload)
    payload["name"] = valid_payload["name"]
    update = client.put(
        f"alerts/{alert_id}?folder={composite_prereqs['folder_id']}",
        prefix="api/v2/",
        json=payload,
    )

    bodies = []
    for response in (create, update, validate):
        assert response.status_code == 403, response.text
        body = response.json()
        assert body["code"] == "child_not_accessible"
        assert body["children"] == [{"alert_id": missing, "accessible": False}]
        forbidden_leaks = {"name", "alert_type", "org", "exists", "state", "eligible"}
        assert not (forbidden_leaks & body["children"][0].keys())
        bodies.append(body)
    assert [set(body) for body in bodies] == [set(bodies[0])] * 3


def test_cycle_and_graph_wide_depth_conflicts_have_distinct_stable_codes(
    client: OpenObserveClient, composite_prereqs: dict[str, Any]
):
    child_a, child_b, child_c = composite_prereqs["child_ids"]
    first_name = unique_name("cmp_depth_one")
    first = _tracked_create(
        client,
        composite_prereqs,
        _composite_payload(name=first_name, child_ids=[child_a, child_b]),
    )
    second_name = unique_name("cmp_depth_two")
    second = _tracked_create(
        client,
        composite_prereqs,
        _composite_payload(name=second_name, child_ids=[first, child_c]),
    )

    cycle_payload = _composite_payload(
        name=first_name,
        child_ids=[second, child_a],
    )
    response = client.put(
        f"alerts/{first}?folder={composite_prereqs['folder_id']}",
        prefix="api/v2/",
        json=cycle_payload,
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "composite_cycle"

    # Existing parent(second) is depth 2.  Making its child(first) depth 2
    # makes the existing ancestor depth 3; validation must inspect all nodes,
    # not just the edited subtree in isolation.
    nested_name = unique_name("cmp_new_depth_two")
    nested = _tracked_create(
        client,
        composite_prereqs,
        _composite_payload(name=nested_name, child_ids=[child_a, child_b]),
    )
    too_deep_payload = _composite_payload(
        name=first_name,
        child_ids=[nested, child_c],
    )
    response = client.put(
        f"alerts/{first}?folder={composite_prereqs['folder_id']}",
        prefix="api/v2/",
        json=too_deep_payload,
    )
    assert response.status_code == 409, response.text
    assert response.json()["code"] == "composite_too_deep"


def test_reference_endpoint_and_single_delete_conflict_are_disclosure_bounded(
    client: OpenObserveClient, composite_prereqs: dict[str, Any]
):
    child = composite_prereqs["child_ids"][0]
    parent_name = unique_name("cmp_parent")
    parent = _tracked_create(
        client,
        composite_prereqs,
        _composite_payload(
            name=parent_name, child_ids=composite_prereqs["child_ids"][:2]
        ),
    )

    response = client.get(
        f"alerts/{child}/composite-references", prefix="api/v2/"
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "references": [
            {
                "alert_id": parent,
                "name": parent_name,
                "folder_id": composite_prereqs["folder_id"],
            }
        ],
        "hidden_reference_count": 0,
    }

    response = client.delete(f"alerts/{child}", prefix="api/v2/")
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["code"] == "child_referenced"
    assert body["references"] == [
        {"alert_id": parent, "name": parent_name, "folder_id": composite_prereqs["folder_id"]}
    ]
    assert body["hidden_reference_count"] == 0
    assert client.get(f"alerts/{child}", prefix="api/v2/").status_code == 200


def test_bulk_delete_keeps_partial_success_but_reports_reference_conflict(
    client: OpenObserveClient, composite_prereqs: dict[str, Any]
):
    protected, unprotected = composite_prereqs["child_ids"][:2]
    parent = _tracked_create(
        client,
        composite_prereqs,
        _composite_payload(
            name=unique_name("cmp_bulk_parent"),
            child_ids=[protected, composite_prereqs["child_ids"][2]],
        ),
    )
    response = client.delete(
        "alerts/bulk",
        prefix="api/v2/",
        json={"ids": [protected, unprotected]},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["successful"] == [unprotected]
    assert body["unsuccessful"] == [protected]
    conflict = body["conflicts"][0]
    assert conflict["alert_id"] == protected
    assert conflict["code"] == "child_referenced"
    assert conflict["references"][0]["alert_id"] == parent
    assert client.get(f"alerts/{protected}", prefix="api/v2/").status_code == 200
    assert client.get(f"alerts/{unprotected}", prefix="api/v2/").status_code == 404
    composite_prereqs["child_ids"].remove(unprotected)


def test_mixed_list_filters_sort_page_tags_priority_and_reference_counts(
    client: OpenObserveClient, composite_prereqs: dict[str, Any]
):
    suite_tag = f"suite:{unique_name('composite')}"
    low_tag = f"rank:{unique_name('low')}"
    high_tag = f"rank:{unique_name('high')}"
    low_name = unique_name("cmp_a_low")
    high_name = unique_name("cmp_z_high")
    low = _tracked_create(
        client,
        composite_prereqs,
        _composite_payload(
            name=low_name,
            child_ids=composite_prereqs["child_ids"][:2],
            priority=4,
            tags=[suite_tag, low_tag],
        ),
    )
    high = _tracked_create(
        client,
        composite_prereqs,
        _composite_payload(
            name=high_name,
            child_ids=composite_prereqs["child_ids"][1:],
            priority=1,
            tags=[suite_tag, high_tag],
        ),
    )

    composite_rows = _list(
        client,
        f"?alert_type=composite&tags={suite_tag}&sort_by=priority&sort_order=asc",
    )
    selected = [row for row in composite_rows if row["alert_id"] in {low, high}]
    assert [row["alert_id"] for row in selected] == [high, low]
    assert all(row["condition"] is None for row in selected)
    assert all(row["child_count"] == 2 for row in selected)

    facet_response = client.get("alerts/tags", prefix="api/v2/")
    assert facet_response.status_code == 200, facet_response.text
    facet = {entry["tag"]: entry["count"] for entry in facet_response.json()}
    assert facet[suite_tag] == 2
    assert facet[low_tag] == 1
    assert facet[high_tag] == 1

    scheduled = _list(client, "?alert_type=scheduled")
    assert not any(row["alert_id"] in {low, high} for row in scheduled)
    assert all(row["alert_type"] == "scheduled" for row in scheduled)

    page_zero = _list(
        client,
        f"?alert_type=composite&tags={suite_tag}&sort_by=name&sort_order=asc&page_size=1&page_idx=0",
    )
    page_one = _list(
        client,
        f"?alert_type=composite&tags={suite_tag}&sort_by=name&sort_order=asc&page_size=1&page_idx=1",
    )
    assert page_zero[0]["alert_id"] == low
    assert page_one[0]["alert_id"] == high

    child_rows = {row["alert_id"]: row for row in _list(client)}
    assert child_rows[composite_prereqs["child_ids"][0]][
        "referenced_by_composite_count"
    ] == 1
    assert child_rows[composite_prereqs["child_ids"][1]][
        "referenced_by_composite_count"
    ] == 2
    for child_id in composite_prereqs["child_ids"]:
        assert "hidden_reference_count" not in child_rows[child_id]
        assert "has_hidden_references" not in child_rows[child_id]


def test_clone_move_enable_trigger_and_delete_use_generic_alert_endpoints(
    client: OpenObserveClient, composite_prereqs: dict[str, Any]
):
    source_name = unique_name("cmp_lifecycle")
    source = _tracked_create(
        client,
        composite_prereqs,
        _composite_payload(
            name=source_name, child_ids=composite_prereqs["child_ids"][:2]
        ),
    )
    second_folder_response = client.post(
        "folders/alerts",
        prefix="api/v2/",
        json={"name": unique_name("cmp_dst"), "description": "move target"},
    )
    assert second_folder_response.status_code == 200, second_folder_response.text
    second_folder = second_folder_response.json()["folderId"]
    clone: str | None = None
    try:
        clone_name = unique_name("cmp_clone")
        response = client.post(
            f"alerts/{source}/clone",
            prefix="api/v2/",
            json={"name": clone_name, "folder_id": second_folder},
        )
        assert response.status_code == 200, response.text
        clone = _find_by_name(client, clone_name)["alert_id"]
        composite_prereqs["created_composites"].append(clone)
        clone_detail = client.get(f"alerts/{clone}", prefix="api/v2/").json()
        assert clone_detail["folderId"] == second_folder
        assert clone_detail["composite_condition"] == client.get(
            f"alerts/{source}", prefix="api/v2/"
        ).json()["composite_condition"]

        response = client.patch(
            "alerts/move",
            prefix="api/v2/",
            json={
                "alert_ids": [source],
                "anomaly_config_ids": [],
                "dst_folder_id": second_folder,
            },
        )
        assert response.status_code == 200, response.text
        assert client.get(f"alerts/{source}", prefix="api/v2/").json()[
            "folderId"
        ] == second_folder

        response = client.patch(
            f"alerts/{source}/enable?value=true&folder={second_folder}",
            prefix="api/v2/",
        )
        assert response.status_code == 200, response.text
        detail = client.get(f"alerts/{source}", prefix="api/v2/").json()
        assert detail["enabled"] is True
        assert detail["scheduler_job_present"] is True

        response = client.patch(
            f"alerts/{source}/trigger?folder={second_folder}", prefix="api/v2/"
        )
        assert response.status_code == 200, response.text

        response = client.patch(
            f"alerts/{source}/enable?value=false&folder={second_folder}",
            prefix="api/v2/",
        )
        assert response.status_code == 200, response.text
        detail = client.get(f"alerts/{source}", prefix="api/v2/").json()
        assert detail["enabled"] is False
        assert detail["scheduler_job_present"] is False
    finally:
        # The destination folder cannot be removed while the moved source or
        # clone still lives in it. Delete those definitions here and remove
        # them from the fixture tracker to avoid a misleading double cleanup.
        for alert_id in (clone, source):
            if alert_id is not None:
                response = client.delete(f"alerts/{alert_id}", prefix="api/v2/")
                assert response.status_code == 200, response.text
                composite_prereqs["created_composites"].remove(alert_id)
        client.delete(f"folders/alerts/{second_folder}", prefix="api/v2/")


def test_child_rename_and_move_do_not_rewrite_stored_id_expression(
    client: OpenObserveClient, composite_prereqs: dict[str, Any]
):
    child_ids = composite_prereqs["child_ids"][:2]
    expression = f"{{{child_ids[0]}}} && !{{{child_ids[1]}}}"
    parent = _tracked_create(
        client,
        composite_prereqs,
        _composite_payload(
            name=unique_name("cmp_identity"),
            child_ids=child_ids,
            expression=expression,
        ),
    )

    destination_folder_response = client.post(
        "folders/alerts",
        prefix="api/v2/",
        json={"name": unique_name("cmp_child_dst"), "description": "identity"},
    )
    assert destination_folder_response.status_code == 200
    destination_folder = destination_folder_response.json()["folderId"]
    try:
        response = client.patch(
            "alerts/move",
            prefix="api/v2/",
            json={
                "alert_ids": [child_ids[0]],
                "anomaly_config_ids": [],
                "dst_folder_id": destination_folder,
            },
        )
        assert response.status_code == 200, response.text

        renamed_payload = deepcopy(composite_prereqs["child_payloads"][child_ids[0]])
        renamed_payload["name"] = unique_name("cmp_child_renamed")
        renamed_payload["folderId"] = destination_folder
        response = client.put(
            f"alerts/{child_ids[0]}?type=logs",
            prefix="api/v2/",
            json=renamed_payload,
        )
        assert response.status_code == 200, response.text

        detail = client.get(f"alerts/{parent}", prefix="api/v2/").json()
        assert detail["composite_condition"]["expression"] == (
            f"({{{child_ids[0]}}} && (!{{{child_ids[1]}}}))"
        )
        assert [child["alert_id"] for child in detail["children"]] == child_ids
    finally:
        client.patch(
            "alerts/move",
            prefix="api/v2/",
            json={
                "alert_ids": [child_ids[0]],
                "anomaly_config_ids": [],
                "dst_folder_id": composite_prereqs["folder_id"],
            },
        )
        client.delete(f"folders/alerts/{destination_folder}", prefix="api/v2/")


def test_openapi_exposes_composite_create_validate_preview_and_references(
    client: OpenObserveClient,
):
    response = client.get("api-doc/openapi.json", prefix="")
    assert response.status_code == 200, response.text
    document = response.json()
    paths = document["paths"]
    assert "/api/v2/{org_id}/alerts/composites/validate" in paths
    assert "/api/v2/{org_id}/alerts/{alert_id}/composite-references" in paths
    create_schema = paths["/api/v2/{org_id}/alerts"]["post"]["requestBody"][
        "content"
    ]["application/json"]["schema"]
    # the create request body documents the composite contract directly
    # (alert_type discriminator + composite_condition), not a oneOf union
    serialized_create = str(create_schema)
    assert "alert_type" in serialized_create
    assert "composite_condition" in serialized_create
    serialized = str(document["components"]["schemas"])
    for token in (
        "composite_condition",
        "warning_counts_as_firing",
        "stale_child_policy",
        "scheduler_job_present",
        "referenced_by_composite_count",
    ):
        assert token in serialized
