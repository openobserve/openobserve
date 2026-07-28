"""External alert ingest webhook — POST /api/v2/{org}/alerts/incidents/ingest.

These exercise the paths that unit tests structurally cannot: the migration
having applied, the correlation engine actually grouping alerts, idempotency
resolving against the database, and resolve closing an incident.

Every one of these covers a defect that shipped in this feature's first draft
and was caught only by reading the code afterwards — notably `dedup_key`,
which wrote to a table whose foreign key an externally-ingested alert can
never satisfy, and so silently never deduplicated anything.
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
    """
    token = uuid.uuid4().hex[:10]
    return {"service": f"svc_{token}", "k8s_namespace_name": f"ns_{token}"}


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


def test_reported_severity_reaches_the_incident(client: OpenObserveClient, require_incidents):  # noqa: F811
    """`severity: critical` opens a P1, not the default.

    Regression: severity was parsed, validated and documented, then dropped —
    every external alert opened its incident at the default severity.
    """
    body = client.incidents.ingest_ok(
        external_alert(labels=shared_labels(), severity="critical")
    )

    incident = client.incidents.get_ok(body["incident_id"])
    assert incident.get("severity") == "P1", incident


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


def test_valid_https_external_url_is_accepted(client: OpenObserveClient, require_incidents):  # noqa: F811
    """The URL allowlist must not reject legitimate links."""
    payload = external_alert(labels=shared_labels())
    payload["external_url"] = "https://alertmanager.example.com/#/alerts"

    body = client.incidents.ingest_ok(payload)
    assert body.get("incident_id"), body


def test_alert_with_no_labels_gets_its_own_incident(client: OpenObserveClient, require_incidents):  # noqa: F811
    """An empty label map is valid and isolates the alert."""
    first = client.incidents.ingest_ok(external_alert(labels={}))
    second = client.incidents.ingest_ok(external_alert(labels={}))

    assert first["action"] == "incident_created", first
    assert first["incident_id"] != second["incident_id"], (first, second)
