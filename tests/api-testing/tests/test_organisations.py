def test_e2e_organisations(create_session, base_url):
    """Running an E2E test for get all the organisations list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_allorgs = session.get(f"{url}api/organizations")

    print(resp_get_allorgs.content)
    assert (
        resp_get_allorgs.status_code == 200
    ), f"Get all organisations list 200, but got {resp_get_allorgs.status_code} {resp_get_allorgs.content}"


def test_e2e_org_settings(create_session, base_url):
    """Running an E2E test for get all the organisations settings list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_orgsettings = session.get(f"{url}api/{org_id}/settings")

    print(resp_get_orgsettings.content)
    assert (
        resp_get_orgsettings.status_code == 200
    ), f"Get all organisations settings list 200, but got {resp_get_orgsettings.status_code} {resp_get_orgsettings.content}"


def test_e2e_org_summary(create_session, base_url):
    """Running an E2E test for get all the organisations summary list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_orgsummary = session.get(f"{url}api/{org_id}/summary")

    print(resp_get_orgsummary.content)
    assert (
        resp_get_orgsummary.status_code == 200
    ), f"Get all organisations summary list 200, but got {resp_get_orgsummary.status_code} {resp_get_orgsummary.content}"


def test_e2e_passcode(create_session, base_url):
    """Running an E2E test for get all the passcode list."""

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

def test_add_organisation(create_session, base_url):
    """Running an E2E test for adding the organisation """

    session = create_session
    url = base_url
    org_id = "default"

    headers = {"Content-Type": "application/json"}

    payload = {
        "name": "autop",
    }

    resp_post_addorg = session.post(f"{url}api/organizations", headers=headers, json=payload)

    print(resp_post_addorg.content)
    assert (
        resp_post_addorg.status_code == 200
    ), f"Get all organisations list 200, but got {resp_post_addorg.status_code} {resp_post_addorg.content}"
