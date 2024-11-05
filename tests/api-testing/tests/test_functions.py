def test_e2e_folder(create_session, base_url):
    """Running an E2E test for all xfunctions."""

    session = create_session
    org_id = "default"

    resp_get_allfunctions = session.get(f"{base_url}api/{org_id}/functions")

    print(resp_get_allfunctions.content)
    assert (
        resp_get_allfunctions.status_code == 200
    ), f"Get all functions list 200, but got {resp_get_allfunctions.status_code} {resp_get_allfunctions.content}"


def test_e2e_createdeletefunction(create_session, base_url):
    """Running an E2E test for create and delete functions."""

    session = create_session
    # Create a function
    org_id = "default"
    payload = {
        "function": ".a=190025552",
        "name": "pytestfunction",
        "params": "row",
        "transType": 0,
    }

    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload
    )

    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 200
    ), f"Expected 200, but got {resp_create_function.status_code} {resp_create_function.content}"
    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunction"
    )
    assert (
        resp_delete_function.status_code == 200
    ), f"Deleting this function, but got {resp_delete_function.status_code} {resp_delete_function.content}"


def test_e2e_invalidfunction(create_session, base_url):
    """Running an E2E test for invalid function creation"""

    session = create_session
    # Create a function
    org_id = "default"
    payload = {"name": "...", "function": "...",
               "params": "row", "transType": 0}

    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload
    )

    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 400
    ), f"Invalid function creation, but got {resp_create_function.status_code} {resp_create_function.content}"


def test_e2e_updatingfunction(create_session, base_url):
    """Running an E2E test for update and delete an existing function."""

    session = create_session
    # Create a function
    org_id = "default"
    payload = {
        "name": "pytestfunctions",
        "function": ".a=190022",
        "params": "row",
        "transType": 0,
    }

    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload
    )

    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 200
    ), f"Expected 200, but got {resp_create_function.status_code} {resp_create_function.content}"
    session = create_session
    # Create a function
    org_id = "default"
    payload = {
        "name": "pytestfunctions",
        "function": ".a=1900",
        "params": "row",
        "transType": 0,
    }
    resp_update_function = session.put(
        f"{base_url}api/{org_id}/functions/pytestfunctions",
        json=payload,
    )
    print(resp_create_function.content)
    assert (
        resp_update_function.status_code == 200
    ), f"Updating this function, but got {resp_update_function.status_code} {resp_update_function.content}"
    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunctions"
    )
    assert (
        resp_delete_function.status_code == 200
    ), f"Deleting this function, but got {resp_delete_function.status_code} {resp_delete_function.content}"


def test_e2e_duplicatefunction(create_session, base_url):
    """Running an E2E test for function already exists."""

    session = create_session
    # Create a function
    org_id = "default"
    payload = {
        "name": "pytestfunctions",
        "function": ".a=190022",
        "params": "row",
        "transType": 0,
    }

    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload
    )

    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 200
    ), f"Expected 200, but got {resp_create_function.status_code} {resp_create_function.content}"
    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunction"
    )
    session = create_session
    # Create a function
    org_id = "default"
    payload = {
        "name": "pytestfunctions",
        "function": ".a=190022",
        "params": "row",
        "transType": 0,
    }

    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload
    )

    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 400
    ), f"Expected 400 function already exists, but got {resp_create_function.status_code} {resp_create_function.content}"
    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunctions"
    )
    assert (
        resp_delete_function.status_code == 200
    ), f"Deleting this function, but got {resp_delete_function.status_code} {resp_delete_function.content}"


def test_e2e_functionnotfound(create_session, base_url):
    """Running an E2E test for function not found."""

    session = create_session
    # Create a function
    org_id = "default"

    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunctionsss"
    )
    assert (
        resp_delete_function.status_code == 404
    ), f"Function not found, but got {resp_delete_function.status_code} {resp_delete_function.content}"


def test_e2e_addDeleteStreamFunction(create_session, base_url):
    """Running an E2E test for add stream to a function and delete."""

    session = create_session
    org_id = "default"
    stream_name = "test"

    # Create a function
    org_id = "default"
    payload = {
        "function": ".a=190025552",
        "name": "pytestfunction",
        "params": "row",
        "transType": 0,
    }

    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload
    )

    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 200
    ), f"Expected 200, but got {resp_create_function.status_code} {resp_create_function.content}"

    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunction"
    )
    assert (
        resp_delete_function.status_code == 200
    ), f"Deleting this function, but got {resp_delete_function.status_code} {resp_delete_function.content}"
