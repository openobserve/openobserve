"""Anomaly `detection_function` validation at the HTTP boundary.

Guards o2-enterprise#2687: both creation endpoints accepted any string as
`detection_function`, so `p75`, `p90`, `median`, a field-less `avg` and an
arbitrary name saved with a 200 and then failed every training run with
`unknown variant`, leaving a config that could never train.

The Rust unit tests in `src/core/src/anomaly_detection.rs` cover the rule
itself. These cover what only a live server can: that the rule is actually
reached over HTTP, on BOTH creation paths, and answers 400 rather than 500.

Anomaly detection is enterprise-gated — the routes are registered behind
`#[cfg(feature = "enterprise")]`, so an OSS binary 404s on every endpoint here
and the whole module skips. It runs for real in the enterprise CI's
`oss_in_ent` shard, which is the only place this fix is exercised in CI.
"""

from __future__ import annotations

import logging
from http import HTTPStatus

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

logger = logging.getLogger(__name__)

STREAM = "anomaly_fn_validation"

# The trainer's `DetectionFunction` variants, which is what the gate mirrors.
SUPPORTED = ["count", "avg", "sum", "min", "max", "p50", "p95", "p99"]


@pytest.fixture(scope="module", autouse=True)
def _require_anomaly_detection(client: OpenObserveClient) -> None:
    """Skip the module unless this build exposes the anomaly API."""
    resp = client.get("anomaly_detection", raise_for_status=False)
    if resp.status_code == HTTPStatus.NOT_FOUND:
        pytest.skip("anomaly detection is not available on this build (OSS)")


def _config(function: str, field: str | None = "latency_ms", **over) -> dict:
    body = {
        "name": unique_name("anomfn"),
        "stream_name": STREAM,
        "stream_type": "logs",
        "query_mode": "filters",
        "filters": [],
        "custom_sql": None,
        "detection_function": function,
        "detection_function_field": field,
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


def _create(client: OpenObserveClient, body: dict):
    return client.post("anomaly_detection", json=body, raise_for_status=False)


def _create_via_alerts(client: OpenObserveClient, body: dict):
    """The v2 alerts path the UI and Terraform use, which delegates here."""
    anomaly = {k: v for k, v in body.items() if k not in {"name", "stream_name", "stream_type", "enabled"}}
    payload = {
        "name": body["name"],
        "alert_type": "anomaly_detection",
        "stream_name": body["stream_name"],
        "stream_type": body["stream_type"],
        "enabled": body["enabled"],
        "anomaly_config": anomaly,
    }
    return client.post(
        "alerts", json=payload, prefix="api/v2/", raise_for_status=False
    )


def _delete(client: OpenObserveClient, resp) -> None:
    try:
        anomaly_id = resp.json().get("anomaly_id")
    except ValueError:
        return
    if anomaly_id:
        client.delete(f"anomaly_detection/{anomaly_id}", raise_for_status=False)


@pytest.mark.parametrize("function", SUPPORTED)
def test_every_supported_function_is_accepted(client: OpenObserveClient, function: str):
    """The allowlist must not have narrowed past what the trainer accepts."""
    field = None if function == "count" else "latency_ms"
    resp = _create(client, _config(function, field))
    assert resp.status_code == HTTPStatus.OK, \
        f"{function} is a supported aggregation: {resp.status_code} {resp.text}"
    _delete(client, resp)


@pytest.mark.parametrize("function", ["p75", "p90", "median", "totally_made_up"])
def test_a_function_the_trainer_cannot_read_is_rejected(client: OpenObserveClient, function: str):
    """Previously 200, then a config stuck in `failed`. `median` is the subtle
    one: its SQL is valid DataFusion, so only the trainer's enum refuses it."""
    resp = _create(client, _config(function))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"{function} must be refused at create, got {resp.status_code}: {resp.text}"
    assert "unsupported detection_function" in resp.text, resp.text
    assert function in resp.text, f"the refusal must name the offender: {resp.text}"


@pytest.mark.parametrize("function", ["AVG", "Avg", "P95", "COUNT", "Sum"])
def test_an_uppercase_spelling_is_rejected_as_a_case_problem(
    client: OpenObserveClient, function: str
):
    """The trainer deserializes the name into a serde enum, which matches
    variants exactly — so `AVG` is as untrainable as `p75`."""
    resp = _create(client, _config(function))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"{function} must be refused, got {resp.status_code}: {resp.text}"
    assert "case-sensitive" in resp.text, \
        f"{function} must be named a case problem, not an unknown function: {resp.text}"
    assert f"'{function.lower()}'" in resp.text, \
        f"the refusal must name the spelling that works: {resp.text}"


def test_a_non_count_function_without_a_field_is_rejected(client: OpenObserveClient):
    """`combine_detection_fn` leaves this bare as `avg`, which the query then
    reads as a column name (`No field named value`)."""
    resp = _create(client, _config("avg", None))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"expected 400, got {resp.status_code}: {resp.text}"
    assert "requires detection_function_field" in resp.text, resp.text


def test_count_needs_no_field(client: OpenObserveClient):
    resp = _create(client, _config("count", None))
    assert resp.status_code == HTTPStatus.OK, f"{resp.status_code}: {resp.text}"
    _delete(client, resp)


def test_the_refusal_lists_the_supported_functions(client: OpenObserveClient):
    resp = _create(client, _config("p75"))
    assert resp.status_code == HTTPStatus.BAD_REQUEST
    for supported in SUPPORTED:
        assert supported in resp.text, f"{supported} missing from: {resp.text}"


def test_the_rule_answers_400_and_not_500(client: OpenObserveClient):
    """`validation_error` exists so these are 400s; a 500 would also be
    'not 200' and would pass a looser assertion."""
    resp = _create(client, _config("p75"))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"a rejected config must not surface as a server error: {resp.status_code} {resp.text}"


@pytest.mark.parametrize("function", ["p75", "AVG", "totally_made_up"])
def test_the_alerts_path_is_gated_too(client: OpenObserveClient, function: str):
    """The UI and Terraform create through /api/v2/{org}/alerts, which reaches
    `create_config` via a separate translation layer."""
    resp = _create_via_alerts(client, _config(function))
    assert resp.status_code == HTTPStatus.BAD_REQUEST, \
        f"{function} must be refused on the alerts path too, got {resp.status_code}: {resp.text}"
    _delete(client, resp)


def test_a_supported_function_still_creates_on_the_alerts_path(client: OpenObserveClient):
    """The negative control: the gate must not have broken the path it guards."""
    resp = _create_via_alerts(client, _config("p95"))
    assert resp.status_code == HTTPStatus.OK, f"{resp.status_code}: {resp.text}"
    _delete(client, resp)


def test_an_unusable_function_cannot_be_introduced_by_update(client: OpenObserveClient):
    created = _create(client, _config("avg"))
    assert created.status_code == HTTPStatus.OK, created.text
    anomaly_id = created.json()["anomaly_id"]
    try:
        resp = client.put(
            f"anomaly_detection/{anomaly_id}",
            json={"detection_function": "p75", "detection_function_field": "latency_ms"},
            raise_for_status=False,
        )
        assert resp.status_code == HTTPStatus.BAD_REQUEST, \
            f"expected 400, got {resp.status_code}: {resp.text}"
    finally:
        client.delete(f"anomaly_detection/{anomaly_id}", raise_for_status=False)


def test_an_unrelated_edit_does_not_re_litigate_the_stored_function(client: OpenObserveClient):
    """The grandfathering half: a row must stay administrable even once the
    gate exists, or configs created by the bug could not be disabled."""
    created = _create(client, _config("avg"))
    assert created.status_code == HTTPStatus.OK, created.text
    anomaly_id = created.json()["anomaly_id"]
    try:
        resp = client.put(
            f"anomaly_detection/{anomaly_id}",
            json={"enabled": False},
            raise_for_status=False,
        )
        assert resp.status_code == HTTPStatus.OK, \
            f"an untouched function must not be re-validated: {resp.status_code} {resp.text}"
    finally:
        client.delete(f"anomaly_detection/{anomaly_id}", raise_for_status=False)
