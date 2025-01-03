def retrieve_new_dashboard(session, base_url, org_id, folder_id):
    resp_get_dashboard = session.get(
        f"{base_url}api/v2/{org_id}/folders/dashboards/{folder_id}")
    print(resp_get_dashboard.content)
    assert (
        resp_get_dashboard.status_code == 200
    ), f"Retrieve these dashboards: Expected 200, but got {resp_get_dashboard.status_code} {resp_get_dashboard.content}"

def delete_new_dashboard(session, base_url, org_id, folder_id):
    resp_delete_dashboard = session.delete(
        f"{base_url}api/v2/{org_id}/folders/dashboards/{folder_id}")
    assert (
        resp_delete_dashboard.status_code == 200
    ), f"Deleting these dashboards: Expected 200, but got {resp_delete_dashboard.status_code} {resp_delete_dashboard.content}"

def test_new_all_dashboards(create_session, base_url):
    """Running an E2E test for all new dashboards."""

    session = create_session
    org_id = "default"

    resp_new_all_dashboards = session.get(f"{base_url}api/v2/{org_id}/folders/dashboards")

    print(resp_new_all_dashboards.content)
    assert (
        resp_new_all_dashboards.status_code == 200
    ), f"Retrieve all functions list 200, but got {resp_new_all_dashboards.status_code} {resp_new_all_dashboards.content}"

    


def test_new_create_dashboards_delete(create_session, base_url):
    """Running an E2E test for create and delete dashboards folder."""

    session = create_session
    # Create a dashboards folder
    org_id = "default"
    url = base_url
    payload = {"description": "newfoldernvp", "name": "pytest-automationtests"}
    resp_create_new_dashboards = session.post(
        f"{url}api/v2/{org_id}/folders/dashboards", json=payload)

    print(resp_create_new_dashboards.content)

    folder_id = resp_create_new_dashboards.json()["folderId"]

    assert (
        resp_create_new_dashboards.status_code == 200
    ), f"Expected 200 dashboards, but got {resp_create_new_dashboards.status_code} {resp_create_new_dashboards.content}"
    
    payload = {
        "description": "folderupdated",
        "folderId": folder_id,
        "name": "pytest-automation",
    }
    folder_id = resp_create_new_dashboards.json()["folderId"]
    # Update folder
    resp_update_new_dashboards = session.put(
        f"{base_url}api/v2/{org_id}/folders/dashboards/{folder_id}", json=payload
    )
    assert (
        resp_update_new_dashboards.status_code == 200
    ), f"updating this dashboard folder, but got {resp_update_new_dashboards.status_code} {resp_update_new_dashboards.content}"
    print(resp_update_new_dashboards.content)
    # Delete Dashboard Folder
    resp_delete_new_dashboards = session.delete(
        f"{base_url}api/v2/{org_id}/folders/dashboards/{folder_id}")
    assert (
        resp_delete_new_dashboards.status_code == 200
    ), f"Deleting this Dashboards folder, but got {resp_delete_new_dashboards.status_code} {resp_delete_new_dashboards.content}"

def retrieve_new_alert(session, base_url, org_id, folder_id):
    resp_get_alert = session.get(
        f"{base_url}api/v2/{org_id}/folders/alerts/{folder_id}")
    print(resp_get_alert.content)
    assert (
        resp_get_alert.status_code == 200
    ), f"Retrieve this folder alert: Expected 200, but got {resp_get_alert.status_code} {resp_get_alert.content}"


def test_new_alertsall(create_session, base_url):
    """Running an E2E test for all new alerts."""

    session = create_session
    org_id = "default"

    resp_new_all_alerts = session.get(f"{base_url}api/v2/{org_id}/folders/alerts")

    print(resp_new_all_alerts.content)
    assert (
        resp_new_all_alerts.status_code == 200
    ), f"Retrieve all functions list 200, but got {resp_new_all_alerts.status_code} {resp_new_all_alerts.content}"

def test_new_create_alerts_update_delete(create_session, base_url):
    """Running an E2E test for create and delete alerts folder."""

    session = create_session
    # Create a alerts folder
    org_id = "default"
    url = base_url
    payload = {"description": "newfoldernvp", "name": "pytest-automationtests"}
    resp_create_new_alerts = session.post(
        f"{url}api/v2/{org_id}/folders/alerts", json=payload)

    print(resp_create_new_alerts.content)

    folder_id = resp_create_new_alerts.json()["folderId"]

    assert (
        resp_create_new_alerts.status_code == 200
    ), f"Expected 200 alerts, but got {resp_create_new_alerts.status_code} {resp_create_new_alerts.content}"
    
    payload = {
        "description": "folderupdated",
        "folderId": folder_id,
        "name": "pytest-automation",
    }
    folder_id = resp_create_new_alerts.json()["folderId"]
    # Update alerts folder
    resp_update_new_alerts = session.put(
        f"{base_url}api/v2/{org_id}/folders/alerts/{folder_id}", json=payload
    )
    assert (
        resp_update_new_alerts.status_code == 200
    ), f"updating this alerts folder, but got {resp_update_new_alerts.status_code} {resp_update_new_alerts.content}"
    print(resp_update_new_alerts.content)
    # Delete Dashboard Folder
    resp_delete_new_alerts = session.delete(
        f"{base_url}api/v2/{org_id}/folders/alerts/{folder_id}")
    assert (
        resp_delete_new_alerts.status_code == 200
    ), f"Deleting this Alerts folder, but got {resp_delete_new_alerts.status_code} {resp_delete_new_alerts.content}"

def delete_new_alerts(session, base_url, org_id, folder_id):
    resp_delete_alerts = session.delete(
        f"{base_url}api/v2/{org_id}/folders/alerts/{folder_id}")
    assert (
        resp_delete_alerts.status_code == 200
    ), f"Deleting this folder alerts: Expected 200, but got {resp_delete_alerts.status_code} {resp_delete_alerts.content}"



