"""External alert ingest webhook — POST /api/v2/{org}/alerts/incidents/ingest.

These exercise the paths that unit tests structurally cannot: the migration
having applied, the correlation engine actually grouping alerts, idempotency
resolving against the database, and resolve closing an incident.

Every one of these covers a defect that shipped in this feature's first draft
and was caught only by reading the code afterwards — notably `dedup_key`,
which wrote to a table whose foreign key an externally-ingested alert can
never satisfy, and so silently never deduplicated anything.

KNOWN GAP: the feature's headline claim — that an externally-ingested alert
and a natively-evaluated one correlate into the SAME incident — is not covered
here. Both paths do call `correlate_alert_to_incident`, but proving it end to
end needs a native alert whose evaluated row yields matching dimensions, which
means a stream, ingested data, an alert definition with `creates_incident`,
and a scheduler tick. The manual-trigger shortcut does not help: it builds a
synthetic row of stream/alert metadata carrying none of the identity labels
correlation groups on, so it lands dimensionless and correlates with nothing.
Worth building; deliberately not faked here.
"""
from __future__ import annotations

import uuid

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name
from support.fixtures import client  # noqa: F401


# ----- helpers -----


def _incidents_enabled(client: OpenObserveClient) -> bool:
    """Incidents are enterprise-gated; the endpoint 403s when disabled."""
    try:
        r = client.get("config", prefix="", raise_for_status=True)
        return bool(r.json().get("incidents_enabled", False))
    except Exception:
        return False


@pytest.fixture(scope="module")
def require_incidents(client: OpenObserveClient):  # noqa: F811
    if not _incidents_enabled(client):
        pytest.skip("incidents disabled (needs O2_INCIDENTS_ENABLED=true)")


def external_alert(
    *,
    source: str = "alertmanager",
    alert_name: str | None = None,
    labels: dict[str, str] | None = None,
    status: str = "firing",
    severity: str | None = None,
    dedup_key: str | None = None,
) -> dict:
    """Build a minimal valid external alert payload."""
    payload: dict = {
        "source": source,
        "alert_name": alert_name or unique_name("rule"),
        "status": status,
        "labels": labels if labels is not None else {},
    }
    if severity:
        payload["severity"] = severity
    if dedup_key:
        payload["dedup_key"] = dedup_key
    return payload


def shared_labels() -> dict[str, str]:
    """Identity labels unique to one test, so tests cannot correlate together.

    Correlation matches on label VALUES, so a fixed value like
    service="checkout" would make every test in this file join one incident.

    Note which label actually does the work: on a default install only
    `k8s_namespace_name` resolves to a configured semantic group (it becomes
    the `k8s-namespace` dimension). `service` is carried but contributes no
    dimension, which is why `dimensionless_labels` below can produce an
    incident with no identity at all.
    """
    token = uuid.uuid4().hex[:10]
    return {"service": f"svc_{token}", "k8s_namespace_name": f"ns_{token}"}


def dimensionless_labels() -> dict[str, str]:
    """Labels that carry no dimension the correlation engine recognises.

    Produces an incident with `key_type: alert_id` and `group_values: {}` —
    "identity unknown". Used to pin the regression below.
    """
    return {"service": f"svc_{uuid.uuid4().hex[:10]}"}


# ----- ingest + correlation -----


def test_firing_alert_opens_an_incident(client: OpenObserveClient, require_incidents):  # noqa: F811
    """A firing external alert creates an incident and reports its id."""
    body = client.incidents.ingest_ok(external_alert(labels=shared_labels()))

    assert body["action"] == "incident_created", body
    assert body.get("incident_id"), body
    # Deterministic KSUID-shaped id — a blank one would collapse every
    # external alert onto a single identity.
    assert len(body["alert_id"]) == 27, body


def test_alert_id_is_stable_across_deliveries(client: OpenObserveClient, require_incidents):  # noqa: F811
    """The same (source, alert_name) always maps to the same alert id."""
    name = unique_name("rule")
    first = client.incidents.ingest_ok(external_alert(alert_name=name, labels=shared_labels()))
    second = client.incidents.ingest_ok(external_alert(alert_name=name, labels=shared_labels()))

    assert first["alert_id"] == second["alert_id"], (first, second)


def test_matching_labels_join_one_incident(client: OpenObserveClient, require_incidents):  # noqa: F811
    """Two different alert rules sharing identity labels correlate together."""
    labels = shared_labels()

    first = client.incidents.ingest_ok(external_alert(labels=labels))
    second = client.incidents.ingest_ok(external_alert(labels=labels))

    assert second["incident_id"] == first["incident_id"], (first, second)
    # A new alert type joining is an escalation signal, not a repeat.
    assert second["action"] == "alert_joined", second


def test_non_matching_labels_stay_separate(client: OpenObserveClient, require_incidents):  # noqa: F811
    """Alerts with nothing in common get their own incidents.

    This is the documented fallback — an alert that cannot correlate must be
    isolated rather than lumped into an unrelated incident.
    """
    first = client.incidents.ingest_ok(external_alert(labels=shared_labels()))
    second = client.incidents.ingest_ok(external_alert(labels=shared_labels()))

    assert first["incident_id"] != second["incident_id"], (first, second)


def test_repeated_alert_type_is_marked_as_repeat(client: OpenObserveClient, require_incidents):  # noqa: F811
    """The same rule firing twice repeats rather than re-escalating."""
    labels = shared_labels()
    name = unique_name("rule")

    first = client.incidents.ingest_ok(external_alert(alert_name=name, labels=labels))
    second = client.incidents.ingest_ok(external_alert(alert_name=name, labels=labels))

    assert second["incident_id"] == first["incident_id"], (first, second)
    assert second["action"] == "alert_repeated", second


def test_dimensionless_incident_does_not_absorb_unrelated_alerts(
    client: OpenObserveClient, require_incidents  # noqa: F811
):
    """An incident with no dimensions must not act as a catch-all.

    Regression, and the reason this suite exists. `DimensionRelationship::check`
    reports `NewIsSuperset` when the EXISTING incident has no dimensions —
    which reads as "compatible with anything". So the first alert that failed
    to correlate opened a dimensionless incident, and every unrelated alert
    afterwards joined it.

    On a default install that was the common path, not a corner case: it
    silently collapsed every external alert into a single incident.
    """
    magnet = client.incidents.ingest_ok(external_alert(labels=dimensionless_labels()))
    assert magnet["action"] == "incident_created", magnet

    # The magnet incident genuinely has no identity.
    magnet_incident = client.incidents.get_ok(magnet["incident_id"])
    assert magnet_incident.get("group_values") in ({}, None), magnet_incident

    # A completely unrelated alert must get its own incident.
    unrelated = client.incidents.ingest_ok(external_alert(labels=shared_labels()))

    assert unrelated["incident_id"] != magnet["incident_id"], (magnet, unrelated)
    assert unrelated["action"] == "incident_created", unrelated


def test_correlation_ignores_the_internal_source_marker(
    client: OpenObserveClient, require_incidents  # noqa: F811
):
    """The `_o2_external_source` marker must not become a grouping dimension.

    It is injected into the correlation row to carry provenance. If it leaked
    into `group_values`, every alert from the same source would correlate
    together regardless of its real identity labels.
    """
    body = client.incidents.ingest_ok(external_alert(labels=shared_labels()))

    incident = client.incidents.get_ok(body["incident_id"])
    dims = incident.get("group_values") or {}
    assert not any("external_source" in k for k in dims), dims


def test_external_alert_is_visible_on_the_incident(client: OpenObserveClient, require_incidents):  # noqa: F811
    """The incident renders the external alert from its junction row.

    Externally-ingested alerts have no row in `alerts`, so they must surface
    through `triggers` with their source attached — otherwise the incident
    detail view shows an empty alert list.
    """
    name = unique_name("rule")
    body = client.incidents.ingest_ok(external_alert(alert_name=name, labels=shared_labels()))

    triggers = client.incidents.triggers(body["incident_id"])
    mine = [t for t in triggers if t.get("alert_name") == name]

    assert mine, f"alert {name} missing from triggers: {triggers}"
    assert mine[0].get("source") == "alertmanager", mine[0]


# ----- severity -----


@pytest.mark.parametrize(
    "sent,expected",
    [
        ("critical", "P1"),
        ("P1", "P1"),
        ("error", "P2"),
        ("warning", "P3"),
        ("info", "P4"),
    ],
)
def test_reported_severity_reaches_the_incident(
    client: OpenObserveClient, require_incidents, sent: str, expected: str  # noqa: F811
):
    """The sender's severity vocabulary maps onto the incident's severity.

    Regression: severity was parsed, validated and documented, then dropped —
    every external alert opened its incident at the default severity, so
    `critical` produced a P3.
    """
    body = client.incidents.ingest_ok(
        external_alert(labels=shared_labels(), severity=sent)
    )

    incident = client.incidents.get_ok(body["incident_id"])
    assert incident.get("severity") == expected, (sent, incident)


def test_unrecognised_severity_falls_back_to_the_default(
    client: OpenObserveClient, require_incidents  # noqa: F811
):
    """An unknown vocabulary is not guessed at — the default stands."""
    body = client.incidents.ingest_ok(
        external_alert(labels=shared_labels(), severity="spicy")
    )

    incident = client.incidents.get_ok(body["incident_id"])
    assert incident.get("severity") == "P3", incident


def test_external_metadata_round_trips(client: OpenObserveClient, require_incidents):  # noqa: F811
    """`external_url` and `annotations` survive to the incident view.

    These columns exist so an external alert can be rendered without a row in
    the `alerts` table. If they did not come back, the incident detail view
    would show the alert with no link home and no context.
    """
    name = unique_name("rule")
    payload = external_alert(alert_name=name, labels=shared_labels())
    payload["external_url"] = "https://alertmanager.example.com/#/alerts"
    payload["annotations"] = {"summary": "error rate above 5%", "runbook": "https://rb/x"}

    body = client.incidents.ingest_ok(payload)

    trigger = next(
        t for t in client.incidents.triggers(body["incident_id"]) if t["alert_name"] == name
    )
    assert trigger.get("external_url") == "https://alertmanager.example.com/#/alerts", trigger
    assert (trigger.get("annotations") or {}).get("summary") == "error rate above 5%", trigger
    assert (trigger.get("annotations") or {}).get("runbook") == "https://rb/x", trigger


# ----- idempotency -----


def test_same_dedup_key_is_ignored(client: OpenObserveClient, require_incidents):  # noqa: F811
    """A redelivery carrying the same dedup_key is dropped.

    Regression: dedup state was written to `alert_dedup_state`, whose
    `alert_id` foreign-keys to `alerts`. An externally-ingested alert has no
    such row, so every write failed the constraint and nothing was ever
    deduplicated — while the endpoint still returned 200.
    """
    labels = shared_labels()
    name = unique_name("rule")
    key = uuid.uuid4().hex

    first = client.incidents.ingest_ok(
        external_alert(alert_name=name, labels=labels, dedup_key=key)
    )
    assert first["action"] == "incident_created", first

    second = client.incidents.ingest_ok(
        external_alert(alert_name=name, labels=labels, dedup_key=key)
    )
    assert second["action"] == "duplicate_ignored", second


def test_different_dedup_keys_are_distinct_firings(client: OpenObserveClient, require_incidents):  # noqa: F811
    """Distinct keys are distinct firings, not redeliveries."""
    labels = shared_labels()
    name = unique_name("rule")

    first = client.incidents.ingest_ok(
        external_alert(alert_name=name, labels=labels, dedup_key=uuid.uuid4().hex)
    )
    second = client.incidents.ingest_ok(
        external_alert(alert_name=name, labels=labels, dedup_key=uuid.uuid4().hex)
    )

    assert second["action"] != "duplicate_ignored", second
    assert second["incident_id"] == first["incident_id"], (first, second)


# ----- resolve -----


def test_resolve_closes_the_incident(client: OpenObserveClient, require_incidents):  # noqa: F811
    """Resolving the only alert in an incident closes the incident."""
    labels = shared_labels()
    name = unique_name("rule")

    opened = client.incidents.ingest_ok(external_alert(alert_name=name, labels=labels))

    resolved = client.incidents.ingest_ok(
        external_alert(alert_name=name, labels=labels, status="resolved")
    )
    assert resolved["action"] == "incident_resolved", resolved
    assert resolved["incident_id"] == opened["incident_id"], (opened, resolved)

    incident = client.incidents.get_ok(opened["incident_id"])
    assert incident.get("status") == "resolved", incident


def test_resolve_keeps_incident_open_while_others_fire(
    client: OpenObserveClient, require_incidents  # noqa: F811
):
    """With two alerts in an incident, resolving one leaves it open."""
    labels = shared_labels()
    first_name = unique_name("rule")
    second_name = unique_name("rule")

    opened = client.incidents.ingest_ok(external_alert(alert_name=first_name, labels=labels))
    client.incidents.ingest_ok(external_alert(alert_name=second_name, labels=labels))

    resolved = client.incidents.ingest_ok(
        external_alert(alert_name=first_name, labels=labels, status="resolved")
    )

    assert resolved["action"] == "alert_resolved", resolved
    incident = client.incidents.get_ok(opened["incident_id"])
    assert incident.get("status") != "resolved", incident


def test_refiring_after_resolve_opens_a_new_incident(
    client: OpenObserveClient, require_incidents  # noqa: F811
):
    """A rule that fires again after resolving must not reopen the closed one.

    Previously only reasoned about: the candidate lookups filter on
    `status != resolved`, so the re-fire should land in a fresh incident rather
    than resurrecting a closed one.
    """
    labels = shared_labels()
    name = unique_name("rule")

    opened = client.incidents.ingest_ok(external_alert(alert_name=name, labels=labels))
    closed = client.incidents.ingest_ok(
        external_alert(alert_name=name, labels=labels, status="resolved")
    )
    assert closed["action"] == "incident_resolved", closed

    refired = client.incidents.ingest_ok(external_alert(alert_name=name, labels=labels))

    assert refired["incident_id"] != opened["incident_id"], (opened, refired)
    assert refired["action"] == "incident_created", refired

    # The original stays closed.
    original = client.incidents.get_ok(opened["incident_id"])
    assert original.get("status") == "resolved", original


def test_repeated_firings_advance_the_alert_count(
    client: OpenObserveClient, require_incidents  # noqa: F811
):
    """Each firing is counted, even when notification is suppressed."""
    labels = shared_labels()
    name = unique_name("rule")

    opened = client.incidents.ingest_ok(external_alert(alert_name=name, labels=labels))
    client.incidents.ingest_ok(external_alert(alert_name=name, labels=labels))

    incident = client.incidents.get_ok(opened["incident_id"])
    assert incident.get("alert_count", 0) >= 2, incident


def test_resolve_for_unknown_alert_is_a_no_op(client: OpenObserveClient, require_incidents):  # noqa: F811
    """Resolving something never ingested reports nothing to do."""
    body = client.incidents.ingest_ok(
        external_alert(alert_name=unique_name("never"), status="resolved")
    )

    assert body["action"] == "nothing_to_resolve", body


# ----- validation -----


@pytest.mark.parametrize(
    "mutation,reason",
    [
        ({"source": "  "}, "blank source"),
        ({"alert_name": ""}, "blank alert_name"),
        ({"external_url": "javascript:alert(1)"}, "non-http url is stored XSS"),
        ({"external_url": "data:text/html,x"}, "data url is stored XSS"),
        ({"timestamp": 1753612800}, "seconds instead of microseconds"),
        ({"timestamp": 0}, "epoch zero"),
    ],
)
def test_invalid_payloads_are_rejected(
    client: OpenObserveClient, require_incidents, mutation: dict, reason: str  # noqa: F811
):
    """Bad payloads get a 400, not a 200 or a 500.

    The timestamp cases matter most: a seconds-precision value used to be
    accepted, placing the incident in 1970 where the auto-resolve sweep closed
    it immediately — the caller saw 200 and the alert vanished.
    """
    payload = external_alert(labels=shared_labels())
    payload.update(mutation)

    r = client.incidents.ingest(payload)
    assert r.status_code == 400, f"{reason}: expected 400, got {r.status_code} {r.text}"


@pytest.mark.parametrize(
    "url",
    [
        "https://alertmanager.example.com/#/alerts",
        "http://localhost:9093/#/alerts",
        "HTTPS://UPPER.example.com/x",
    ],
)
def test_valid_http_external_urls_are_accepted(
    client: OpenObserveClient, require_incidents, url: str  # noqa: F811
):
    """The allowlist must not reject legitimate links, including uppercase."""
    name = unique_name("rule")
    payload = external_alert(alert_name=name, labels=shared_labels())
    payload["external_url"] = url

    body = client.incidents.ingest_ok(payload)

    trigger = next(
        t for t in client.incidents.triggers(body["incident_id"]) if t["alert_name"] == name
    )
    assert trigger.get("external_url") == url, trigger


def test_micros_timestamp_is_honoured(client: OpenObserveClient, require_incidents):  # noqa: F811
    """A valid microsecond timestamp is accepted and used as the fire time."""
    name = unique_name("rule")
    # A fixed, plausible instant well inside the accepted 2000..2100 window.
    fired_at = 1_753_612_800_000_000

    payload = external_alert(alert_name=name, labels=shared_labels())
    payload["timestamp"] = fired_at

    body = client.incidents.ingest_ok(payload)

    trigger = next(
        t for t in client.incidents.triggers(body["incident_id"]) if t["alert_name"] == name
    )
    assert trigger.get("alert_fired_at") == fired_at, trigger


def test_alert_with_no_labels_gets_its_own_incident(client: OpenObserveClient, require_incidents):  # noqa: F811
    """An empty label map is valid and isolates the alert."""
    first = client.incidents.ingest_ok(external_alert(labels={}))
    second = client.incidents.ingest_ok(external_alert(labels={}))

    assert first["action"] == "incident_created", first
    assert first["incident_id"] != second["incident_id"], (first, second)
