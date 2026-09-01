"""
Workflows v1 — Condition-node evaluation matrix.

Extends the CRUD-only test_workflows.py with per-operator + logical-combinator
coverage of the condition node's evaluation via /workflows/test?draft=true. Each
case builds an in-memory graph (Trigger -> Condition -> Destination), fires a
sample payload, and asserts the destination was (or was not) invoked based on
whether the condition matched.

No secrets, no external webhooks: the destination URL is the localhost sink
(same as the CRUD fixture), and pass/drop is derived from the dry-run response's
per-node `inputs` map — no delivery needed. Safe to commit / run in CI.

Enterprise-only feature: the module auto-skips on OSS builds via the same
`_require_workflows` probe used by test_workflows.py.

Semantics documented alongside each case group:
 - Operators: =, !=, >, >=, <, <=, Contains, NotContains
 - Logical combinators: AND, OR, and nested groups
 - V2 gotcha: each ConditionItem carries the `logicalOperator` that combines it
   with the PREVIOUS sibling. Children of an OR group must therefore also carry
   `logicalOperator: "OR"` — the parent group's value is metadata only.
   Enforced by the local `group()` helper below.
 - String semantics: alert `meta_*` fields are exposed as `Utf8` (strings),
   including numeric-looking ones (threshold/count/period). Comparisons are
   lexical, so `"5" >= "10"` is true. This is intentional at the model layer.
"""

import os
import time
import uuid
from typing import Any

import pytest

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
DEST_URL = "http://localhost:8080/sink"  # same fake sink as test_workflows.py


# ── Enterprise gate (mirrors test_workflows.py:36-41) ─────────────────────────
@pytest.fixture(scope="module", autouse=True)
def _require_workflows(create_session, base_url):
    # WORKFLOWS_REQUIRED=1 (set in ent CI) turns the skip into a hard fail so
    # a route-registration regression or accidentally-off feature flag can't
    # slip through as silent skips.
    resp = create_session.get(f"{base_url}api/{ORG_ID}/workflows")
    if resp.status_code in (403, 404):
        msg = f"Workflows feature not available (/workflows returned {resp.status_code})."
        if os.environ.get("WORKFLOWS_REQUIRED") == "1":
            pytest.fail(f"{msg} WORKFLOWS_REQUIRED=1 — expected enabled on this build.")
        pytest.skip(f"{msg} Enterprise-only / not enabled on this build.")


# ── Shared per-module dry-run destination ─────────────────────────────────────
@pytest.fixture(scope="module")
def dry_run_destination(create_session, base_url):
    """One pipeline-module destination reused by every parametrized case; deleted after."""
    session = create_session
    name = f"wf_auto_api_cond_dest_{int(time.time())}{uuid.uuid4().hex[:4]}"
    payload = {"name": name, "url": DEST_URL, "method": "post", "type": "http"}
    resp = session.post(
        f"{base_url}api/{ORG_ID}/alerts/destinations?module=pipeline", json=payload
    )
    assert resp.status_code == 200, f"destination create failed: {resp.status_code} {resp.text[:300]}"
    yield name
    session.delete(f"{base_url}api/{ORG_ID}/alerts/destinations/{name}")


# ── Graph builders ────────────────────────────────────────────────────────────
def _leaf(column: str, op: str, value: str, logical: str = "AND") -> dict[str, Any]:
    return {
        "filterType": "condition",
        "column": column,
        "operator": op,
        "value": value,
        "values": [],
        "logicalOperator": logical,
        "id": str(uuid.uuid4()),
    }


def _group(logical: str, conditions: list[dict[str, Any]]) -> dict[str, Any]:
    """V2 group. Propagates its `logicalOperator` to each child — evaluation walks
    left-to-right applying each child's operator, so the parent's is metadata only."""
    for c in conditions:
        c["logicalOperator"] = logical
    return {
        "filterType": "group",
        "logicalOperator": logical,
        "groupId": str(uuid.uuid4()),
        "conditions": conditions,
    }


def _graph(dest_name: str, cond_group: dict[str, Any] | None) -> dict[str, Any]:
    """Trigger -> [Condition ->] Destination. Passing cond_group=None omits the
    Condition node, exercising the control passthrough case."""
    trig, dest = str(uuid.uuid4()), str(uuid.uuid4())
    nodes = [
        {
            "id": trig,
            "data": {"node_type": "workflow_trigger"},
            "meta": {"trigger_kind": "alert_fired"},
            "position": {"x": 100, "y": 100},
            "io_type": "input",
            "is_disabled": False,
        }
    ]
    edges = []
    prev = trig
    if cond_group is not None:
        cond_id = str(uuid.uuid4())
        nodes.append({
            "id": cond_id,
            "data": {"node_type": "condition", "version": 2, "conditions": cond_group},
            "position": {"x": 300, "y": 100},
            "io_type": "default",
            "is_disabled": False,
        })
        edges.append({"id": f"e{prev}-{cond_id}", "source": prev, "target": cond_id})
        prev = cond_id
    nodes.append({
        "id": dest,
        "data": {
            "node_type": "destination",
            "destination_id": dest_name,
            "template_override": None,
        },
        "position": {"x": 500, "y": 100},
        "io_type": "output",
        "is_disabled": False,
    })
    edges.append({"id": f"e{prev}-{dest}", "source": prev, "target": dest})
    return {
        "id": "", "org_id": "", "created_at": 0, "updated_at": 0, "created_by": "",
        "name": f"wf_auto_api_cond_{int(time.time())}{uuid.uuid4().hex[:4]}",
        "description": "condition-matrix dry-run", "enabled": True,
        "nodes": nodes, "edges": edges,
    }


def _sample(overrides: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Baseline flattened alert-firing payload. Overrides merge on top."""
    ev = {
        "meta_org_id": "default",
        "meta_stream_type": "logs",
        "meta_stream_name": "default",
        "meta_alert_name": "cpu_high",
        "meta_alert_type": "scheduled",
        "meta_alert_operator": ">=",
        "meta_alert_period": "5",
        "meta_alert_threshold": "5",
        "meta_alert_count": "7",
    }
    if overrides:
        ev.update(overrides)
    return [ev]


# ── Case table ────────────────────────────────────────────────────────────────
# (case_id, condition_group_builder, sample_overrides, expect_dest_invoked)
CASES: list[tuple[str, Any, dict[str, Any] | None, bool]] = [
    # ── Per-operator smoke ────────────────────────────────────────────────────
    ("eq_match",
     lambda: _group("AND", [_leaf("meta_alert_name", "=", "cpu_high")]),
     None, True),
    ("eq_no_match",
     lambda: _group("AND", [_leaf("meta_alert_name", "=", "does_not_match")]),
     None, False),
    ("neq_match",
     lambda: _group("AND", [_leaf("meta_alert_name", "!=", "something_else")]),
     None, True),
    ("neq_no_match",
     lambda: _group("AND", [_leaf("meta_alert_name", "!=", "cpu_high")]),
     None, False),
    ("contains_match",
     lambda: _group("AND", [_leaf("meta_alert_name", "Contains", "cpu")]),
     None, True),
    ("notcontains_match",
     lambda: _group("AND", [_leaf("meta_alert_name", "NotContains", "zzz")]),
     None, True),
    # ── Numeric-comparator behaviour (lexical, by design) ─────────────────────
    ("gt_boundary_drop",
     lambda: _group("AND", [_leaf("meta_alert_threshold", ">", "5")]),
     None, False),
    ("gte_boundary_ok",
     lambda: _group("AND", [_leaf("meta_alert_threshold", ">=", "5")]),
     None, True),
    ("lt_lexical_ok",
     lambda: _group("AND", [_leaf("meta_alert_count", "<", "9")]),
     None, True),
    ("lex_gte_multichar_matches_by_design",
     lambda: _group("AND", [_leaf("meta_alert_threshold", ">=", "10")]),
     None, True),  # "5" >= "10" is true lexically (Utf8 columns, intended).
    # ── Logical combinators ───────────────────────────────────────────────────
    ("and_all_true",
     lambda: _group("AND", [
         _leaf("meta_alert_name", "=", "cpu_high"),
         _leaf("meta_stream_name", "=", "default"),
     ]),
     None, True),
    ("and_one_false",
     lambda: _group("AND", [
         _leaf("meta_alert_name", "=", "cpu_high"),
         _leaf("meta_stream_name", "=", "does_not_exist"),
     ]),
     None, False),
    ("or_one_true",
     lambda: _group("OR", [
         _leaf("meta_alert_name", "=", "no_match"),
         _leaf("meta_stream_name", "=", "default"),
     ]),
     None, True),
    ("or_all_false",
     lambda: _group("OR", [
         _leaf("meta_alert_name", "=", "no_match"),
         _leaf("meta_stream_name", "=", "no_match_stream"),
     ]),
     None, False),
    # ── Nested groups ─────────────────────────────────────────────────────────
    ("nested_and_in_or",
     lambda: _group("OR", [
         _group("AND", [
             _leaf("meta_alert_name", "=", "wrong"),
             _leaf("meta_stream_name", "=", "wrong"),
         ]),
         _leaf("meta_alert_operator", "=", ">="),
     ]),
     None, True),  # outer OR matches on the leaf sibling
    ("nested_or_in_and",
     lambda: _group("AND", [
         _group("OR", [
             _leaf("meta_alert_name", "=", "cpu_high"),
             _leaf("meta_stream_name", "=", "wrong"),
         ]),
         _leaf("meta_alert_operator", "=", "wrong"),
     ]),
     None, False),  # outer AND fails on second leaf
    # ── Control: no condition node -> unconditional passthrough ──────────────
    ("no_condition_passthrough", lambda: None, None, True),
]


@pytest.mark.parametrize(
    "case_id,cond_builder,sample_overrides,expect_dest_invoked",
    CASES,
    ids=[c[0] for c in CASES],
)
def test_condition_eval(
    create_session, base_url, dry_run_destination,
    case_id, cond_builder, sample_overrides, expect_dest_invoked,
):
    """Fire a single-case graph through /workflows/test?draft=true and assert
    the destination node was (or was not) reached according to `expect_dest_invoked`.
    Ground truth is the response's per-node `inputs` map: a destination that
    received records is guaranteed to have been invoked; an empty/missing entry
    means an upstream condition dropped the payload."""
    cond_group = cond_builder()
    wf = _graph(dry_run_destination, cond_group)
    dest_node_id = wf["nodes"][-1]["id"]

    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/workflows/test?draft=true",
        json={"workflow": wf, "inputs": _sample(sample_overrides), "from_node": None},
    )
    assert resp.status_code == 200, f"test-run failed: {resp.status_code} {resp.text[:300]}"

    body = resp.json()
    dest_inputs = (body.get("inputs") or {}).get(dest_node_id) or []
    dest_errors = (body.get("errors") or {}).get(dest_node_id)
    # An error on the destination still implies the record REACHED the
    # destination (condition matched). Localhost:0/sink will 5xx; treat that
    # as "invoked". Empty inputs + no error means the upstream condition dropped.
    invoked = bool(dest_inputs) or dest_errors is not None
    assert invoked is expect_dest_invoked, (
        f"{case_id}: expected invoked={expect_dest_invoked}, got invoked={invoked}\n"
        f"  inputs={dest_inputs!r}\n"
        f"  errors={dest_errors!r}"
    )
