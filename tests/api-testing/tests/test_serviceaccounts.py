import random  # Add this line
# Other imports...

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



def test_e2e_createdeleteserviceaccounts(create_session, base_url):
    """Running an E2E test for create and delete service account."""

    email_id = f"email_{random.randint(1000, 9999)}@gmail.com"  # Make the name unique


    session = create_session
    # Create a service account
    org_id = "default"
    payload = {
        "email":email_id,
        "organization":"default",
        "first_name":"",
        "last_name":""
        }

    resp_create_serviceaccount = session.post(
        f"{base_url}api/{org_id}/service_accounts", json=payload
    )

    print(resp_create_serviceaccount.content)
    assert (
        resp_create_serviceaccount.status_code == 200
    ), f"Expected 200, but got {resp_create_serviceaccount.status_code} {resp_create_serviceaccount.content}"
    resp_delete_serviceaccount = session.delete(
    f"{base_url}api/{org_id}/service_accounts/{email_id}"
    )

    assert (
        resp_delete_serviceaccount.status_code == 200
    ), f"Deleting this service account, but got {resp_delete_serviceaccount.status_code} {resp_delete_serviceaccount.content}"

def test_e2e_creategetdeleteserviceaccounts(create_session, base_url):
    """Running an E2E test for create and delete service account."""

    email_id = f"email_{random.randint(1000, 9999)}@gmail.com"  # Make the name unique


    session = create_session
    # Create a service account
    org_id = "default"
    payload = {
        "email":email_id,
        "organization":"default",
        "first_name":"",
        "last_name":""
        }

    resp_create_serviceaccount = session.post(
        f"{base_url}api/{org_id}/service_accounts", json=payload
    )

    print(resp_create_serviceaccount.content)
    assert (
        resp_create_serviceaccount.status_code == 200
    ), f"Expected 200, but got {resp_create_serviceaccount.status_code} {resp_create_serviceaccount.content}"
    resp_get_serviceaccount = session.get(
    
    f"{base_url}api/{org_id}/service_accounts/{email_id}"
    )

    assert (
        resp_get_serviceaccount.status_code == 200
    ), f"Getting this service account, but got {resp_get_serviceaccount.status_code} {resp_get_serviceaccount.content}"

    resp_delete_serviceaccount = session.delete(
    f"{base_url}api/{org_id}/service_accounts/{email_id}"
    )

    assert (
        resp_delete_serviceaccount.status_code == 200
    ), f"Deleting this service account, but got {resp_delete_serviceaccount.status_code} {resp_delete_serviceaccount.content}"

def test_e2e_creategetupdatedeleteserviceaccounts(create_session, base_url):
    """Running an E2E test for create, get, update and delete service account."""

    email_id = f"email_{random.randint(1000, 9999)}@gmail.com"  # Make the name unique


    session = create_session
    # Create a service account
    org_id = "default"
    payload = {
        "email":email_id,
        "organization":"default",
        "first_name":"",
        "last_name":""
        }

    resp_create_serviceaccount = session.post(
        f"{base_url}api/{org_id}/service_accounts", json=payload
    )

    print(resp_create_serviceaccount.content)
    assert (
        resp_create_serviceaccount.status_code == 200
    ), f"Expected 200, but got {resp_create_serviceaccount.status_code} {resp_create_serviceaccount.content}"
    resp_get_serviceaccount = session.get(
    
    f"{base_url}api/{org_id}/service_accounts/{email_id}"
    )

    assert (
        resp_get_serviceaccount.status_code == 200
    ), f"Getting this service account, but got {resp_get_serviceaccount.status_code} {resp_get_serviceaccount.content}"

    payload = {
        "email":email_id,
        "organization":"default",
        "first_name":"updated",
        "last_name":"updated"
        }
    resp_update_serviceaccount = session.put(
        f"{base_url}api/{org_id}/service_accounts/{email_id}", json=payload
    )
    print(resp_update_serviceaccount.content)
    assert (
        resp_update_serviceaccount.status_code == 200
    ), f"Updating this service account, but got {resp_update_serviceaccount.status_code} {resp_update_serviceaccount.content}"
    

    resp_delete_serviceaccount = session.delete(
    f"{base_url}api/{org_id}/service_accounts/{email_id}"
    )

    assert (
        resp_delete_serviceaccount.status_code == 200
    ), f"Deleting this service account, but got {resp_delete_serviceaccount.status_code} {resp_delete_serviceaccount.content}"

def test_e2e_creategetrefreshdeleteserviceaccounts(create_session, base_url):
    """Running an E2E test for create, get, refresh and delete service account."""

    email_id = f"email_{random.randint(1000, 9999)}@gmail.com"  # Make the name unique


    session = create_session
    # Create a service account
    org_id = "default"
    payload = {
        "email":email_id,
        "organization":"default",
        "first_name":"Get",
        "last_name":"Refreshed"
        }

    resp_create_serviceaccount = session.post(
        f"{base_url}api/{org_id}/service_accounts", json=payload
    )

    print(resp_create_serviceaccount.content)
    assert (
        resp_create_serviceaccount.status_code == 200
    ), f"Expected 200, but got {resp_create_serviceaccount.status_code} {resp_create_serviceaccount.content}"
    resp_get_serviceaccount = session.get(
    
    f"{base_url}api/{org_id}/service_accounts/{email_id}"
    )

    assert (
        resp_get_serviceaccount.status_code == 200
    ), f"Getting this service account, but got {resp_get_serviceaccount.status_code} {resp_get_serviceaccount.content}"

    resp_refresh_serviceaccount = session.put(
        f"{base_url}api/{org_id}/service_accounts/{email_id}?rotateToken=true", json=payload
    )
    print(resp_refresh_serviceaccount.content)
    assert (
        resp_refresh_serviceaccount.status_code == 200
    ), f"Refreshing this service account, but got {resp_refresh_serviceaccount.status_code} {resp_refresh_serviceaccount.content}"
    

    resp_delete_serviceaccount = session.delete(
    f"{base_url}api/{org_id}/service_accounts/{email_id}"
    )

    assert (
        resp_delete_serviceaccount.status_code == 200
    ), f"Deleting this service account, but got {resp_delete_serviceaccount.status_code} {resp_delete_serviceaccount.content}"


