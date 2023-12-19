import requests
import pytest


def test_e2e_organisations(create_session, base_url):
    """Running an E2E test for get all the alerts list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_allorgs = session.get(f"{url}api/{org_id}/organizations")

    print(resp_get_allorgs.content)
    assert (
        resp_get_allorgs.status_code == 200
    ), f"Get all alerts list 200, but got {resp_get_allorgs.status_code} {resp_get_allorgs.content}"


def test_e2e_org_settings(create_session, base_url):
    """Running an E2E test for get all the alerts list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_orgsettings = session.get(f"{url}api/{org_id}/settings")

    print(resp_get_orgsettings.content)
    assert (
        resp_get_orgsettings.status_code == 200
    ), f"Get all alerts list 200, but got {resp_get_orgsettings.status_code} {resp_get_orgsettings.content}"


def test_e2e_org_summary(create_session, base_url):
    """Running an E2E test for get all the alerts list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_orgsummary = session.get(f"{url}api/{org_id}/summary")

    print(resp_get_orgsummary.content)
    assert (
        resp_get_orgsummary.status_code == 200
    ), f"Get all alerts list 200, but got {resp_get_orgsummary.status_code} {resp_get_orgsummary.content}"


def test_e2e_passcode(create_session, base_url):
    """Running an E2E test for get all the alerts list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_allorgs = session.get(f"{url}api/{org_id}/organizations/passcode")

    print(resp_get_allorgs.content)
    assert (
        resp_get_allorgs.status_code == 200
    ), f"Get all alerts list 200, but got {resp_get_allorgs.status_code} {resp_get_allorgs.content}"
