"""Synthetic check CRUD, list filters, pause/resume, bulk delete and save-time validation."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from support.client import OpenObserveClient
from support.factories import synthetics_check_payload, synthetics_location_id, unique_name

ENTERPRISE_BUILDS = ("enterprise", "cloud")

PROTOCOL_CONFIG_EDITS = {
    "http": {"method": "POST", "timeout_ms": 15000},
    "tcp": {"port": 8443, "timeout_ms": 5000},
    "tls": {"port": 8443, "min_days_until_expiry": 7, "verify_chain": False},
    "ssh": {"port": 2222, "username": "apitest-renamed"},
}


def build_type(client: OpenObserveClient) -> str:
    resp = client.get("config")
    assert resp.status_code == 200, resp.text
    return resp.json()["build_type"]


def create_expecting_refusal(client: OpenObserveClient, created: list[str], payload: dict):
    resp = client.synthetics.create(payload)
    if resp.ok:
        created.append(resp.json()["id"])
    return resp


def listed_ids(client: OpenObserveClient, **params) -> list[str]:
    resp = client.synthetics.list(**params)
    assert resp.status_code == 200, resp.text
    return [c["id"] for c in resp.json()["checks"]]


@pytest.mark.parametrize("check_type", ["http", "tcp", "tls", "ssh"])
def test_check_round_trips_through_create_get_update_and_delete(
    client: OpenObserveClient, make_synthetic, synthetics_location: str, check_type: str
):
    created = make_synthetic(check_type, tags=["apitest"], description="first")
    check_id = created["id"]
    assert created["type"] == check_type
    assert created["locations"] == [synthetics_location]
    assert created["folder_id"] == "default"
    assert created["enabled"] is False
    assert created["owner"] == client.email

    got = client.synthetics.get(check_id)
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["name"] == created["name"]
    assert body["tags"] == ["apitest"]

    body["name"] = unique_name(f"synth_api_{check_type}_renamed")
    body["description"] = "second"
    body["config"].update(PROTOCOL_CONFIG_EDITS[check_type])
    updated = client.synthetics.update(check_id, body)
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == body["name"]

    reread = client.synthetics.get(check_id).json()
    assert reread["name"] == body["name"]
    assert reread["description"] == "second"
    for key, value in PROTOCOL_CONFIG_EDITS[check_type].items():
        assert reread["config"][key] == value, key
    assert reread["created_at"] == created["created_at"]
    assert reread["updated_at"] > created["updated_at"]

    deleted = client.synthetics.delete(check_id)
    assert deleted.status_code == 200, deleted.text
    assert client.synthetics.get(check_id).status_code == 404
    assert client.synthetics.delete(check_id).status_code == 404


def test_update_keeps_the_stored_check_type(client: OpenObserveClient, make_synthetic):
    created = make_synthetic("tcp")
    body = client.synthetics.get(created["id"]).json()
    body["type"] = "tls"

    resp = client.synthetics.update(created["id"], body)

    assert resp.status_code == 200, resp.text
    assert client.synthetics.get(created["id"]).json()["type"] == "tcp"


def test_write_responses_blank_credentials_but_the_edit_read_returns_them(
    client: OpenObserveClient, make_synthetic
):
    ssh_secret = unique_name("ssh-secret")
    header_secret = unique_name("Bearer hdr")
    ssh = make_synthetic(
        "ssh", config={"port": 22, "username": "apitest", "auth": {"type": "password", "secret": ssh_secret}}
    )
    http = make_synthetic(
        "http",
        config={"method": "GET", "headers": [{"name": "Authorization", "value": header_secret}], "assertions": []},
    )
    assert ssh["config"]["auth"]["secret"] == ""
    assert http["config"]["headers"] == [{"name": "Authorization", "value": ""}]

    # The single GET is the edit read: it needs PUT permission and returns the stored value to round-trip.
    ssh_body = client.synthetics.get(ssh["id"]).json()
    assert ssh_body["config"]["auth"]["secret"] == ssh_secret
    assert client.synthetics.get(http["id"]).json()["config"]["headers"][0]["value"] == header_secret

    ssh_body["description"] = "edited"
    updated = client.synthetics.update(ssh["id"], ssh_body)
    assert updated.status_code == 200, updated.text
    assert ssh_secret not in updated.text
    assert client.synthetics.get(ssh["id"]).json()["config"]["auth"]["secret"] == ssh_secret

    listed = client.synthetics.list(location=ssh["locations"][0])
    assert listed.status_code == 200, listed.text
    assert ssh_secret not in listed.text
    assert header_secret not in listed.text
    assert all("config" not in c for c in listed.json()["checks"])


def test_cron_without_a_zone_name_falls_back_to_the_stored_offset(client: OpenObserveClient, make_synthetic):
    created = make_synthetic("tcp", frequency={"type": "cron", "interval": 0, "cron": "0 0 9 * * *"})
    body = client.synthetics.get(created["id"]).json()
    body["tz_offset"] = 330

    resp = client.synthetics.update(created["id"], body)

    assert resp.status_code == 200, resp.text
    stored = client.synthetics.get(created["id"]).json()
    assert "timezone" not in stored["frequency"]
    assert stored["tz_offset"] == 330
    next_run = datetime.fromtimestamp(stored["next_run_at"] / 1_000_000, UTC)
    assert (next_run.hour, next_run.minute) == (3, 30), next_run


def test_list_filters_by_type_location_tag_and_enabled(
    client: OpenObserveClient, make_synthetic, synthetics_location: str
):
    tag = unique_name("tag")
    tcp = make_synthetic("tcp", tags=[tag])
    http = make_synthetic("http", tags=[tag])
    untagged = make_synthetic("tcp")

    assert sorted(listed_ids(client, location=synthetics_location)) == sorted([tcp["id"], http["id"], untagged["id"]])
    assert sorted(listed_ids(client, tag=tag)) == sorted([tcp["id"], http["id"]])
    assert listed_ids(client, tag=tag, type="tcp") == [tcp["id"]]

    enabled = client.synthetics.set_enabled(http["id"], {"enabled": True})
    assert enabled.status_code == 200, enabled.text
    try:
        assert listed_ids(client, tag=tag, enabled="true") == [http["id"]]
        assert listed_ids(client, tag=tag, enabled="false") == [tcp["id"]]
    finally:
        client.synthetics.set_enabled(http["id"], {"enabled": False})


def test_list_pages_are_disjoint_and_report_the_filtered_total(
    client: OpenObserveClient, make_synthetic, synthetics_location: str
):
    tag = unique_name("page")
    ids = {make_synthetic("tcp", tags=[tag])["id"] for _ in range(3)}

    pages = []
    for page in range(4):
        resp = client.synthetics.list(tag=tag, page=page, page_size=2)
        assert resp.status_code == 200, resp.text
        assert resp.json()["total"] == 3
        pages.append([c["id"] for c in resp.json()["checks"]])

    assert [len(p) for p in pages] == [2, 1, 0, 0]
    assert set(pages[0]) | set(pages[1]) == ids


def test_pause_and_resume_flip_enabled_and_reject_a_bad_body(client: OpenObserveClient, make_synthetic):
    check_id = make_synthetic("tcp")["id"]

    try:
        resumed = client.synthetics.set_enabled(check_id, {"enabled": True})
        assert resumed.status_code == 200, resumed.text
        assert resumed.json()["message"] == "check enabled"
        assert client.synthetics.get(check_id).json()["enabled"] is True
    finally:
        paused = client.synthetics.set_enabled(check_id, {"enabled": False})
    assert paused.status_code == 200, paused.text
    assert paused.json()["message"] == "check paused"
    assert client.synthetics.get(check_id).json()["enabled"] is False

    missing = client.synthetics.set_enabled(check_id, {})
    assert missing.status_code == 400, missing.text
    assert missing.json()["message"] == "missing boolean field 'enabled'"
    assert client.synthetics.set_enabled(unique_name("nocheck"), {"enabled": True}).status_code == 404


def test_run_now_is_accepted_for_a_check_and_404_for_an_unknown_id(client: OpenObserveClient, make_synthetic):
    check_id = make_synthetic("tcp")["id"]

    assert client.synthetics.run_now(check_id).status_code == 202
    assert client.synthetics.run_now(unique_name("nocheck")).status_code == 404


def test_bulk_delete_removes_only_the_named_checks(client: OpenObserveClient, make_synthetic):
    first, second, kept = (make_synthetic("tcp")["id"] for _ in range(3))

    resp = client.synthetics.bulk_delete([first, second])

    assert resp.status_code == 200, resp.text
    assert client.synthetics.get(first).status_code == 404
    assert client.synthetics.get(second).status_code == 404
    assert client.synthetics.get(kept).status_code == 200


def test_bulk_delete_with_an_unknown_id_follows_the_edition(client: OpenObserveClient, make_synthetic):
    known = make_synthetic("tcp")["id"]

    resp = client.synthetics.bulk_delete([known, unique_name("nocheck")])

    if build_type(client) in ENTERPRISE_BUILDS:
        # Every id is checked against its stored folder first, so one stale id refuses the whole batch.
        assert resp.status_code == 403, resp.text
        assert client.synthetics.get(known).status_code == 200
    else:
        assert resp.status_code == 200, resp.text
        assert client.synthetics.get(known).status_code == 404


INVALID_CHECKS = [
    pytest.param("tcp", {"frequency": {"type": "minutes", "interval": 0, "cron": ""}},
                 "frequency.interval: must be >= 1, got 0", id="zero-interval"),
    pytest.param("browser", {"frequency": {"type": "seconds", "interval": 30, "cron": ""}},
                 "frequency: interval too short (30s < 60s minimum for Browser checks)", id="browser-interval-under-60s"),
    pytest.param("tcp", {"frequency": {"type": "cron", "interval": 0, "cron": "every day"}},
                 "frequency.cron: invalid expression 'every day'", id="bad-cron"),
    pytest.param("http", {"target": "not a url"}, "target: invalid URL 'not a url'", id="unparseable-url"),
    pytest.param("http", {"target": "ftp://example.com"}, "target: URL scheme must be http or https, got 'ftp'",
                 id="non-http-scheme"),
    pytest.param("http", {"target": "http://127.0.0.1/health"}, "target: URL host is a loopback", id="loopback-url"),
    pytest.param("tcp", {"target": "https://example.com"}, "target: expected host or host:port, got a URL",
                 id="url-as-host"),
    pytest.param("tcp", {"locations": []}, "locations: at least one location is required", id="no-location"),
    pytest.param("tcp", {"retries": 4}, "retries: must be 0..=3 for Tcp checks, got 4", id="too-many-retries"),
    pytest.param("tcp", {"config": {"port": 443, "timeout_ms": 500}}, "config.timeout_ms: must be 1000..=", id="short-timeout"),
    pytest.param("http", {"config": {"method": "FETCH"}}, "config.method: unknown HTTP method 'FETCH'", id="bad-method"),
    pytest.param("ssh", {"config": {"username": "u", "auth": {"type": "kerberos", "secret": ""}}},
                 "config.auth.type: unknown auth type 'kerberos'", id="bad-ssh-auth"),
]


@pytest.mark.parametrize(("check_type", "overrides", "message"), INVALID_CHECKS)
def test_invalid_check_is_refused_with_the_reason_and_not_stored(
    client: OpenObserveClient,
    created_synthetics: list[str],
    synthetics_location: str,
    check_type: str,
    overrides: dict,
    message: str,
):
    payload = synthetics_check_payload(check_type, synthetics_location, **overrides)

    resp = create_expecting_refusal(client, created_synthetics, payload)

    assert resp.status_code == 400, resp.text
    assert resp.json()["message"].startswith(f"validation: {message}"), resp.text
    assert payload["name"] not in client.synthetics.list(location=synthetics_location).text


def test_unknown_or_disabled_location_is_refused(
    client: OpenObserveClient, created_synthetics: list[str], synthetics_location: str
):
    unknown = synthetics_location_id("nowhere")
    resp = create_expecting_refusal(client, created_synthetics, synthetics_check_payload("tcp", unknown))
    assert resp.status_code == 400, resp.text
    assert resp.json()["message"].startswith(f"validation: locations: unknown location '{unknown}'")

    disabled = client.synthetics.update_location(synthetics_location, {"label": "API test location", "enabled": False})
    assert disabled.status_code == 200, disabled.text
    try:
        resp = create_expecting_refusal(client, created_synthetics, synthetics_check_payload("tcp", synthetics_location))
    finally:
        restored = client.synthetics.update_location(synthetics_location, {"label": "API test location", "enabled": True})
    assert restored.status_code == 200, restored.text
    assert resp.status_code == 400, resp.text
    assert resp.json()["message"].startswith(f"validation: locations: unknown location '{synthetics_location}'")
