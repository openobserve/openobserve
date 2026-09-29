"""Anomaly condition surface at the HTTP boundary.

Closes the gap recorded in `/nvpworkflow:anomalies_tests` — File A of the test
manifest. Before this file there were no API tests for anomaly detection at all,
so every rule below was covered only by Rust unit tests (which no pipeline
executes) or not at all.

Scope is the *condition* surface: filter operators, the `filters` payload shape,
the sensitivity primitives, the G4 denominator gate as seen over HTTP, and
parity between the two creation paths. Detection-function validation lives in
`test_anomaly_detection_function.py`.

Deliberately thin on G4: `mod denominator_rule` in `src/core/src/anomaly_detection.rs`
carries 35 unit tests for that logic. The cases here buy the status code, the
message wording, and the fact that the gate is reachable through HTTP at all.

Anomaly detection is enterprise-gated — the routes sit behind
`#[cfg(feature = "enterprise")]`, so an OSS binary 404s and the module skips.
These run for real in o2-enterprise's `api-testing.yml` `oss_in_ent` shard.
"""

from __future__ import annotations

import json
import logging
from http import HTTPStatus

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

logger = logging.getLogger(__name__)

STREAM = "anomaly_conditions"

# Every operator the UI's ANOMALY_FILTER_OPERATORS offers.
UI_OPERATORS = [
    "=", "<>", ">=", "<=", ">", "<", "IN", "NOT IN",
    "str_match", "str_match_ignore_case", "match_all", "re_match", "re_not_match",
    "Contains", "Starts With", "Ends With", "Not Contains", "Is Null", "Is Not Null",
]

# Accepted by SUPPORTED_FILTER_OPERATORS but unreachable from the UI, so this
# file is their only coverage anywhere.
API_ONLY_ALIASES = [
    "equals", "eq", "!=", "not_equals", "neq", "not_contains",
    "starts_with", "ends_with", "is_null", "is_not_null", "not_in",
]


@pytest.fixture(scope="module", autouse=True)
def _require_anomaly_detection(client: OpenObserveClient) -> None:
    resp = client.get("anomaly_detection", raise_for_status=False)
    if resp.status_code == HTTPStatus.NOT_FOUND:
        pytest.skip("anomaly detection is not available on this build (OSS)")


def _config(**over) -> dict:
    body = {
        "name": unique_name("anomcond"),
        "stream_name": STREAM,
        "stream_type": "logs",
        "query_mode": "filters",
        "filters": [],
        "custom_sql": None,
        "detection_function": "avg",
        "detection_function_field": "latency_ms",
        "histogram_interval": "5m",
        "schedule_interval": "5m",
        "detection_window_seconds": 3600,
        "training_window_days": 7,
        "retrain_interval_days": 7,
        "percentile": 97,
        "alert_enabled": False,
        "enabled": True,
    }
    body.update(over)
    return body


def _filter(operator: str, field: str = "service", value: str = "api-gateway") -> list[dict]:
    return [{"field": field, "operator": operator, "value": value}]


def _create(client: OpenObserveClient, body: dict):
    return client.post("anomaly_detection", json=body, raise_for_status=False)


def _create_raw(client: OpenObserveClient, raw: str):
    """Post a hand-built body, for shapes `json=` cannot express."""
    return client.post(
        "anomaly_detection",
        data=raw,
        headers={"Content-Type": "application/json"},
        raise_for_status=False,
    )


def _create_via_alerts(client: OpenObserveClient, body: dict):
    anomaly = {
        k: v for k, v in body.items()
        if k not in {"name", "stream_name", "stream_type", "enabled"}
    }
    payload = {
        "name": body["name"],
        "alert_type": "anomaly_detection",
        "stream_name": body["stream_name"],
        "stream_type": body["stream_type"],
        "enabled": body["enabled"],
        "anomaly_config": anomaly,
    }
    return client.post("alerts", json=payload, prefix="api/v2/", raise_for_status=False)


def _cleanup(client: OpenObserveClient, resp) -> None:
    try:
        anomaly_id = resp.json().get("anomaly_id")
    except (ValueError, AttributeError):
        return
    if anomaly_id:
        client.delete(f"anomaly_detection/{anomaly_id}", raise_for_status=False)


@pytest.fixture
def budget_config(client: OpenObserveClient):
    """A stored config in budget mode. `percentile` is omitted because the two
    are mutually exclusive at create; the row still lands on threshold 97."""
    resp = _create(client, _config(percentile=None, alert_budget_per_day=5))
    assert resp.status_code == HTTPStatus.OK, f"budget create failed: {resp.text}"
    anomaly_id = resp.json()["anomaly_id"]
    yield anomaly_id
    client.delete(f"anomaly_detection/{anomaly_id}", raise_for_status=False)


# ─── A1. Filter operator acceptance ───────────────────────────────────────────


@pytest.mark.parametrize("operator", UI_OPERATORS)
def test_every_ui_operator_is_accepted(client: OpenObserveClient, operator: str):
    """Drift between the UI's list and SUPPORTED_FILTER_OPERATORS, in the
    direction the UI can actually produce."""
    resp = _create(client, _config(filters=_filter(operator)))
    assert resp.status_code == HTTPStatus.OK, \
        f"{operator!r} is offered by the UI: {resp.status_code} {resp.text}"
    _cleanup(client, resp)


@pytest.mark.parametrize("operator", API_ONLY_ALIASES)
def test_every_api_only_alias_is_accepted(client: OpenObserveClient, operator: str):
    """These cannot be reached from the UI, so nothing else covers them."""
    resp = _create(client, _config(filters=_filter(operator)))
    assert resp.status_code == HTTPStatus.OK, \
        f"{operator!r} is in SUPPORTED_FILTER_OPERATORS: {resp.status_code} {resp.text}"
    _cleanup(client, resp)


@pytest.mark.parametrize("operator", ["  STR_MATCH ", "Is Null", "IS NOT NULL", "NOT IN"])
def test_operator_matching_trims_and_lowercases(client: OpenObserveClient, operator: str):
    """Pins `operator.trim().to_lowercase()`. A refactor to exact-match would
    break every word-shaped UI operator at once."""
    resp = _create(client, _config(filters=_filter(operator)))
    assert resp.status_code == HTTPStatus.OK, \
        f"{operator!r} must survive trimming and case folding: {resp.text}"
    _cleanup(client, resp)


@pytest.mark.parametrize("operator", ["LIKE", "~", "between", "=~", ""])
def test_unsupported_operator_is_rejected_by_name(client: OpenObserveClient, operator: str):
    resp = _create(client, _config(filters=_filter(operator)))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"{operator!r} must be refused: {resp.status_code} {resp.text}"
    assert "unsupported filter operator" in resp.text, resp.text


def test_an_operator_on_any_row_is_validated_not_just_the_first(client: OpenObserveClient):
    """`validate_filter_operators` loops. A short-circuit on row 0 would pass
    every test above and still store an unbuildable filter."""
    filters = _filter("=") + [{"field": "level", "operator": "LIKE", "value": "err"}]
    resp = _create(client, _config(filters=filters))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"a bad operator on the second row must still be caught: {resp.text}"
    assert "unsupported filter operator" in resp.text, resp.text


def test_a_row_without_an_operator_key_is_skipped_not_rejected(client: OpenObserveClient):
    """The `continue` arm: the UI's row schema has no per-field rules, so a
    partial row is tolerated rather than refused."""
    resp = _create(client, _config(filters=[{"field": "service", "value": "api-gateway"}]))
    assert resp.status_code == HTTPStatus.OK, \
        f"a row with no operator must not be rejected: {resp.status_code} {resp.text}"
    _cleanup(client, resp)


def test_filters_round_trip_through_get_unchanged(client: OpenObserveClient):
    """What the edit form rehydrates from. `anomalyDetectionConfigDefaults`
    falls back to `=` on a missing operator, so a dropped row degrades silently
    into a different filter rather than failing."""
    filters = [
        {"field": "service", "operator": "=", "value": "api-gateway"},
        {"field": "message", "operator": "str_match", "value": "timeout"},
        {"field": "service", "operator": "Starts With", "value": "api"},
        {"field": "status", "operator": "IN", "value": "500,503"},
        {"field": "region", "operator": "Is Null", "value": ""},
    ]
    resp = _create(client, _config(filters=filters))
    assert resp.status_code == HTTPStatus.OK, resp.text
    anomaly_id = resp.json()["anomaly_id"]
    try:
        stored = client.get(f"anomaly_detection/{anomaly_id}").json()
        stored = stored.get("data", stored)
        got = stored["filters"]
        assert len(got) == len(filters), f"row count changed: {got}"
        for sent, back in zip(filters, got):
            assert back["field"] == sent["field"], f"{sent} -> {back}"
            assert back["operator"] == sent["operator"], f"{sent} -> {back}"
            assert str(back["value"]) == sent["value"], f"{sent} -> {back}"
    finally:
        client.delete(f"anomaly_detection/{anomaly_id}", raise_for_status=False)


# ─── A2. Filters payload shape ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "filters,type_name",
    [({"a": 1}, "object"), ("a string", "string"), (42, "number"), (True, "boolean")],
)
def test_non_array_filters_are_rejected_by_type_name(
    client: OpenObserveClient, filters, type_name: str
):
    resp = _create(client, _config(filters=filters))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"{type_name} filters must be refused: {resp.status_code} {resp.text}"
    assert "filters must be a JSON array" in resp.text, resp.text
    assert type_name in resp.text, f"the error must name the type it got: {resp.text}"


def test_the_rejection_never_echoes_the_callers_filters_value(client: OpenObserveClient):
    """Deliberate — `json_type` exists so caller-controlled JSON is named by
    type, never quoted back. A 'more helpful error' refactor regresses it."""
    marker = "zzmarkerzz"
    resp = _create(client, _config(filters={"secret": marker}))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, resp.text
    assert marker not in resp.text, \
        f"the caller's value must not be echoed: {resp.text}"


def test_an_empty_object_of_filters_normalises_to_an_empty_array(client: OpenObserveClient):
    """The legacy `{}` shape means 'no filters' and is collapsed on the way in."""
    resp = _create(client, _config(filters={}))
    assert resp.status_code == HTTPStatus.OK, \
        f"{{}} must normalise, not fail: {resp.status_code} {resp.text}"
    anomaly_id = resp.json()["anomaly_id"]
    try:
        stored = client.get(f"anomaly_detection/{anomaly_id}").json()
        stored = stored.get("data", stored)
        assert stored["filters"] == [], f"expected [], got {stored['filters']!r}"
    finally:
        client.delete(f"anomaly_detection/{anomaly_id}", raise_for_status=False)


def test_an_explicit_null_of_filters_is_rejected_not_normalised(client: OpenObserveClient):
    """`null` does NOT behave like `{}`, despite `normalize_request_filters`
    carrying a `Value::Null` arm that collapses it to `[]`.

    That arm is unreachable from here: `filters` is `Option<serde_json::Value>`,
    and serde turns a JSON `null` into the OUTER `None` rather than
    `Some(Value::Null)`. So the field reads as absent and the filters-mode
    requirement rejects it first. Measured, not assumed — pinned so the arm is
    not mistaken for live behaviour."""
    resp = _create(client, _config(filters=None))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"null filters read as absent: {resp.status_code} {resp.text}"
    assert "filters required when query_mode is 'filters'" in resp.text, resp.text


def test_filters_mode_without_filters_is_rejected(client: OpenObserveClient):
    body = _config()
    del body["filters"]
    resp = _create(client, body)
    assert resp.status_code == HTTPStatus.BAD_REQUEST, resp.text
    assert "filters required when query_mode is 'filters'" in resp.text, resp.text


def test_custom_sql_mode_without_sql_is_rejected(client: OpenObserveClient):
    body = _config(query_mode="custom_sql", filters=None)
    del body["custom_sql"]
    resp = _create(client, body)
    assert resp.status_code == HTTPStatus.BAD_REQUEST, resp.text
    assert "custom_sql required when query_mode is 'custom_sql'" in resp.text, resp.text


@pytest.mark.parametrize("query_mode", ["sql", "FILTERS", ""])
def test_invalid_query_mode_is_rejected(client: OpenObserveClient, query_mode: str):
    """`FILTERS` is refused too: unlike the operator check, this comparison is
    case-SENSITIVE. The asymmetry is pinned here on purpose."""
    resp = _create(client, _config(query_mode=query_mode))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"{query_mode!r} must be refused: {resp.status_code} {resp.text}"
    assert "query_mode must be 'filters' or 'custom_sql'" in resp.text, resp.text


# ─── A3. Budget vs percentile ─────────────────────────────────────────────────


def test_create_with_both_percentile_and_budget_is_rejected(client: OpenObserveClient):
    resp = _create(client, _config(percentile=97, alert_budget_per_day=5))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, resp.text
    assert "not both" in resp.text, resp.text


@pytest.mark.parametrize("budget", [0, -1])
def test_a_non_positive_budget_is_rejected(client: OpenObserveClient, budget):
    resp = _create(client, _config(percentile=None, alert_budget_per_day=budget))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"budget {budget} must be refused: {resp.status_code} {resp.text}"
    assert "greater than 0" in resp.text, resp.text


def test_a_non_finite_budget_is_rejected(client: OpenObserveClient):
    """`1e400` is the only non-finite value reachable over JSON — bare `NaN`
    and `Infinity` are not valid JSON and die in the deserializer first. Which
    layer answers is not the point; that it is a 400 and not a 500 is."""
    body = _config(percentile=None)
    raw = json.dumps(body)[:-1] + ', "alert_budget_per_day": 1e400}'
    resp = _create_raw(client, raw)
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"a non-finite budget must not be stored: {resp.status_code} {resp.text}"


def test_changing_the_percentile_while_a_budget_is_set_is_rejected(
    client: OpenObserveClient, budget_config: str
):
    resp = client.put(
        f"anomaly_detection/{budget_config}", json={"percentile": 90}, raise_for_status=False
    )
    assert resp.status_code == HTTPStatus.BAD_REQUEST, resp.text
    assert "percentile is derived" in resp.text, resp.text


def test_resending_the_same_percentile_while_a_budget_is_set_is_accepted(
    client: OpenObserveClient, budget_config: str
):
    """Only a *change* is rejected. A full-body replay resends the stored
    percentile and must not be refused for it."""
    resp = client.put(
        f"anomaly_detection/{budget_config}", json={"percentile": 97}, raise_for_status=False
    )
    assert resp.status_code == HTTPStatus.OK, \
        f"an unchanged percentile is not a change: {resp.status_code} {resp.text}"


def test_a_percentile_that_clamps_to_the_stored_threshold_is_not_a_change(
    client: OpenObserveClient, budget_config: str
):
    """`clamped_threshold` truncates via `as i32`, so 97.4 and 97 are the same
    stored value. A 'tidy up the float comparison' refactor silently starts
    rejecting valid updates here and nowhere else."""
    resp = client.put(
        f"anomaly_detection/{budget_config}", json={"percentile": 97.4}, raise_for_status=False
    )
    assert resp.status_code == HTTPStatus.OK, \
        f"97.4 clamps to the stored 97: {resp.status_code} {resp.text}"


def test_clearing_a_budget_requires_the_direct_anomaly_api(
    client: OpenObserveClient, budget_config: str
):
    """The alerts path maps `Option<f64>.map(Some)`, which can never produce
    `Some(None)` — so clearing is expressible only on the direct endpoint."""
    via_alerts = client.put(
        f"alerts/{budget_config}",
        json={"name": unique_name("anomcond"), "alert_type": "anomaly_detection",
              "anomaly_config": {"alert_budget_per_day": None}},
        prefix="api/v2/",
        raise_for_status=False,
    )
    stored = client.get(f"anomaly_detection/{budget_config}").json()
    stored = stored.get("data", stored)
    assert stored["alert_budget_per_day"] is not None, \
        f"the alerts path is set-only; the budget should survive it " \
        f"(PUT answered {via_alerts.status_code})"

    direct = client.put(
        f"anomaly_detection/{budget_config}",
        json={"alert_budget_per_day": None},
        raise_for_status=False,
    )
    assert direct.status_code == HTTPStatus.OK, direct.text
    cleared = client.get(f"anomaly_detection/{budget_config}").json()
    cleared = cleared.get("data", cleared)
    assert cleared["alert_budget_per_day"] is None, \
        f"the direct endpoint must clear it, got {cleared['alert_budget_per_day']!r}"


# ─── A4. The G4 denominator gate, over HTTP ───────────────────────────────────


def test_the_nginx_5xx_count_is_rejected_with_the_repair_named(client: OpenObserveClient):
    """The shape that missed. The wording is the deliverable here — the logic
    already has 35 unit tests."""
    resp = _create(client, _config(
        stream_name="nginx_access",
        detection_function="count",
        detection_function_field=None,
        filters=_filter(">=", field="status", value="500"),
    ))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, resp.text
    assert "carries no denominator" in resp.text, resp.text
    assert "divide the error count by the total count" in resp.text, \
        f"the refusal must name the repair: {resp.text}"


def test_an_error_named_stream_with_no_filter_is_rejected(client: OpenObserveClient):
    resp = _create(client, _config(
        stream_name="app_errors", detection_function="count", detection_function_field=None
    ))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, resp.text
    assert "carries no denominator" in resp.text, resp.text


def test_a_substring_error_stream_is_accepted(client: OpenObserveClient):
    """`terror_logs` contains 'error' but does not carry it as a token. If
    `stream_name_is_error_restricted` ever degrades to a substring test, this
    is the customer-visible break."""
    resp = _create(client, _config(
        stream_name="terror_logs", detection_function="count", detection_function_field=None
    ))
    assert resp.status_code == HTTPStatus.OK, \
        f"terror_logs is not an error stream: {resp.status_code} {resp.text}"
    _cleanup(client, resp)


def test_a_non_count_aggregation_over_an_error_stream_is_accepted(client: OpenObserveClient):
    """The `NotACount` arm — what stops the gate widening to every aggregation."""
    resp = _create(client, _config(stream_name="app_errors", detection_function="avg"))
    assert resp.status_code == HTTPStatus.OK, \
        f"avg over an error stream is normalized already: {resp.status_code} {resp.text}"
    _cleanup(client, resp)


def test_the_rate_form_is_accepted(client: OpenObserveClient):
    """The documented repair path must actually work over HTTP."""
    resp = _create(client, _config(
        query_mode="custom_sql",
        filters=None,
        detection_function="count",
        detection_function_field=None,
        custom_sql=(
            "SELECT histogram(_timestamp,'5m') AS time_bucket, "
            "count(*) / count(*) AS value FROM nginx_access "
            "WHERE status >= 500 GROUP BY time_bucket"
        ),
    ))
    assert resp.status_code == HTTPStatus.OK, \
        f"a rate carries its own denominator: {resp.status_code} {resp.text}"
    _cleanup(client, resp)


def test_a_custom_sql_left_on_a_filters_mode_row_is_ignored_by_the_gate(
    client: OpenObserveClient,
):
    """The mode picks the query that runs, so the other mode's leftover field
    must not decide the verdict."""
    resp = _create(client, _config(
        detection_function="count",
        detection_function_field=None,
        filters=_filter("=", field="service", value="api-gateway"),
        custom_sql="SELECT count(*) FROM nginx_access WHERE status >= 500",
    ))
    assert resp.status_code == HTTPStatus.OK, \
        f"a stale custom_sql must not trip the gate: {resp.status_code} {resp.text}"
    _cleanup(client, resp)


# ─── A5. Creation-path parity ─────────────────────────────────────────────────


def test_the_same_filters_are_stored_identically_through_both_creation_paths(
    client: OpenObserveClient,
):
    """Both reach `create_config`, so the gates are shared — the
    `anomaly_fields()` translation between them is not."""
    filters = [
        {"field": "service", "operator": "Starts With", "value": "api"},
        {"field": "region", "operator": "Is Null", "value": ""},
    ]
    direct = _create(client, _config(filters=filters))
    assert direct.status_code == HTTPStatus.OK, direct.text
    via_alerts = _create_via_alerts(client, _config(filters=filters))
    assert via_alerts.status_code == HTTPStatus.OK, via_alerts.text
    try:
        a = client.get(f"anomaly_detection/{direct.json()['anomaly_id']}").json()
        b = client.get(f"anomaly_detection/{via_alerts.json()['anomaly_id']}").json()
        a, b = a.get("data", a), b.get("data", b)
        assert a["filters"] == b["filters"], f"filters diverged: {a['filters']} vs {b['filters']}"
        assert a["query_mode"] == b["query_mode"]
        assert a["detection_function"] == b["detection_function"], \
            f"combined form diverged: {a['detection_function']} vs {b['detection_function']}"
    finally:
        _cleanup(client, direct)
        _cleanup(client, via_alerts)


def test_the_denominator_gate_fires_on_the_alerts_path_too(client: OpenObserveClient):
    resp = _create_via_alerts(client, _config(
        stream_name="nginx_access",
        detection_function="count",
        detection_function_field=None,
        filters=_filter(">=", field="status", value="500"),
    ))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"the gate must fire on the path the UI uses: {resp.status_code} {resp.text}"
    assert "carries no denominator" in resp.text, resp.text


def test_an_unsupported_operator_is_rejected_on_the_alerts_path_too(client: OpenObserveClient):
    resp = _create_via_alerts(client, _config(filters=_filter("LIKE")))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"expected 400, got {resp.status_code}: {resp.text}"
    assert "unsupported filter operator" in resp.text, resp.text
