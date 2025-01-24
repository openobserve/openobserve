def test_get_actions(create_session, base_url):
    """Running an E2E test for get all the actions list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_allactions = session.get(f"{url}api/{org_id}/actions")

    print(resp_get_allactions.content)
    assert (
        resp_get_allactions.status_code == 200
    ), f"Get all alerts list 200, but got {resp_get_allactions.status_code} {resp_get_allactions.content}"

def test_get_service_accounts(create_session, base_url):
    """Running an E2E test for get all the service_accounts list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_service_accounts = session.get(f"{url}api/{org_id}/service_accounts")

    print(resp_get_service_accounts.content)
    assert (
        resp_get_service_accounts.status_code == 200
    ), f"Get all service accounts list 200, but got {resp_get_service_accounts.status_code} {resp_get_service_accounts.content}"
