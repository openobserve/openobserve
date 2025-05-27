
def test_e2e_organisations(create_session, base_url):
    """Running an E2E test for get all the alerts list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_allorgs = session.get(f"{url}api/organizations")

    # print(resp_get_allorgs.content)
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

    resp_get_passcode = session.get(f"{url}api/{org_id}/passcode")

    print(resp_get_passcode.content)
    assert (
        resp_get_passcode.status_code == 200
    ), f"Get all passcode list 200, but got {resp_get_passcode.status_code} {resp_get_passcode.content}"

    
def test_e2e_reset_passcode(create_session, base_url):
    """Running an E2E test for Reset passcode."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_put_passcode = session.put(f"{url}api/{org_id}/passcode")

    print(resp_put_passcode.content)
    assert (
        resp_put_passcode.status_code == 200
    ), f"Put all passcode list 200, but got {resp_put_passcode.status_code} {resp_put_passcode.content}"

def test_create_organization(create_session, base_url, random_string):
    """Running an E2E test for creating organization."""
    session = create_session
    # Create a new organization

    org_id_new = random_string(5)  # Call the function returned by the fixture

    print("Random Org ID:", org_id_new)

    payload = {
        "name": org_id_new
    }

    # Verify session is authenticated
    resp_auth_check = session.get(f"{base_url}api/organizations")
    assert resp_auth_check.status_code == 200, f"Authentication check failed: {resp_auth_check.status_code} {resp_auth_check.content}"

    resp_create_organization = session.post(
        f"{base_url}api/organizations", json=payload
    )

    print("Create organization response:", resp_create_organization.content)
    
    assert (
        resp_create_organization.status_code == 200
    ), f"Expected 200, but got {resp_create_organization.status_code} {resp_create_organization.content}"

    assert resp_create_organization.json().get("name") == org_id_new

    org_id = resp_create_organization.json().get("identifier")

    print("Org identifier:", org_id)

    yield org_id

    # Cleanup: Delete the organization after all tests are done
    resp_delete_organization = session.delete(
        f"{base_url}api/organizations/{org_id}"
    )
    print(f"Deleted organization {org_id}")
