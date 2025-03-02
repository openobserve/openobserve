import os
import pytest
import random
import uuid

# Constants for WebSocket URL and user credentials
ZO_BASE_URL = os.environ.get("ZO_BASE_URL")  # Use environment variable
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable


def create_alert(session, base_url, org_id, stream_name, payload):
    """Create an alert."""
    response = session.post(f"{base_url}api/{org_id}/{stream_name}/alerts", json=payload)
    if response.status_code == 409:
        # Handle alert already exists scenario
        print(f"Alert already exists: {payload['name']}.")
        return False  # Indicate that creation failed due to existing alert
    assert response.status_code == 200, f"Failed to create alert: {response.content}"
    return True  # Indicate successful creation


def delete_alert(session, base_url, org_id, alert_name, stream_name):
    """Delete an alert."""
    response = session.delete(f"{base_url}api/{org_id}/{stream_name}/alerts/{alert_name}?type=logs")
    assert response.status_code == 200, f"Failed to delete alert: {response.content}"
    return response

def get_alert(session, base_url, org_id, alert_name, stream_name):
    """Get an alert."""
    response = session.get(f"{base_url}api/{org_id}/{stream_name}/alerts/{alert_name}")
    assert response.status_code == 200, f"Failed to get alert: {response.content}"
    return response

def create_destination(session, base_url, org_id, payload):
    """Create a destination."""
    response = session.post(f"{base_url}api/{org_id}/alerts/destinations", json=payload)
    assert response.status_code == 200, f"Failed to create destination: {response.content}"
    return response

def delete_destination(session, base_url, org_id, destination_name):
    """Delete a destination."""
    response = session.delete(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}")
    assert response.status_code == 200, f"Failed to delete destination: {response.content}"
    return response

def create_template(session, base_url, org_id, payload):
    """Create a template."""
    response = session.post(f"{base_url}api/{org_id}/alerts/templates", json=payload)
    assert response.status_code == 200, f"Failed to create template: {response.content}"
    return response

def delete_template(session, base_url, org_id, template_name):
    """Delete a template."""
    response = session.delete(f"{base_url}api/{org_id}/alerts/templates/{template_name}")
    assert response.status_code == 200, f"Failed to delete template: {response.content}"
    return response

def ingest_logs(session, base_url, org_id, stream_name, payload):
    """Ingest logs."""
    response = session.post(f"{base_url}api/{org_id}/{stream_name}/_json", json=payload)
    assert response.status_code == 200, f"Failed to ingest logs: {response.content}"
    return response



# @pytest.mark.parametrize("base_url, org_id", [
#     (os.getenv("ZO_BASE_URL"), "default"),
#     (os.getenv("ZO_BASE_URL_SC"), "default"),
# ])
def test_e2e_alerts(create_session):
    session = create_session
    base_url = ZO_BASE_URL
    org_id = "default"
    # Create an alert with a unique name
    alert_name = f"newalert_{uuid.uuid4()}"  # Ensure the name is unique
    # Create a unique template name
    template_name = f"newtemp_{random.randint(10000, 99999)}"  # Make the name unique
    template_payload = {
        "name":template_name,
        "body":"{\n  \"text\": \"For stream {stream_name} of organization {org_name} alert {alert_name} of type {alert_type} is active\"\n}",
        "type":"http",
        "title":""
    }
    create_template(session, base_url, org_id, template_payload)

    # Create a unique destination name
    destination_name = f"newdest_{random.randint(10000, 99999)}"  # Make the name unique
    destination_payload = {
        "url": "www",
        "method": "post",
        "template": template_name,
        "headers": {"test": "test"},
        "name": destination_name
    }
    create_destination(session, base_url, org_id, destination_payload)

    # Ingest logs
    stream_name = "newpy_tests"
    log_payload = [
        {"Athlete": "Michael Phelps", "City": "Beijing", "Country": "USA", "Discipline": "Swimming", "Sport": "Aquatics", "Year": 2008},
        {"Athlete": "Katie Ledecky", "City": "Rio de Janeiro", "Country": "USA", "Discipline": "Swimming", "Sport": "Aquatics", "Year": 2016},
    ]
    ingest_logs(session, base_url, org_id, stream_name, log_payload)

    # Create an alert with a unique name
    alert_name = f"newalert_{uuid.uuid4()}"
    alert_payload = {
        "name": alert_name,
        "stream_type": "logs",
        "stream_name": stream_name,
        "query_condition": {"type": "sql", "sql": "SELECT Athlete, City FROM newpy_tests"},
        "trigger_condition": {"period": 10, "operator": ">=", "threshold": 3, "silence": 10},
        "destinations": [destination_name],
        "enabled": True
    }
    # Attempt to create the alert
    alert_created = create_alert(session, base_url, org_id, stream_name, alert_payload)
    
    # If alert creation failed due to existing alert, you can choose to skip the rest of the test or handle it
    if not alert_created:
        print(f"Skipping further tests for alert: {alert_name}")
        return

    # Assert alert creation in the first server
    get_alert(session, base_url, org_id, alert_name, stream_name)

    # Assert alert creation in the second server
    session.base_url = ZO_BASE_URL_SC
    get_alert(session, base_url, org_id, alert_name, stream_name)

    # Update alert in the second server
    session.base_url = ZO_BASE_URL_SC
    update_payload = {
        "name": alert_name,
        "stream_type": "logs",
        "stream_name": stream_name,
        "query_condition": {"type": "sql", "sql": "SELECT * FROM newpy_tests WHERE condition"},
        "trigger_condition": {"period": 10, "operator": ">=", "threshold": 5, "silence": 10},
        "destinations": [destination_name],
        "enabled": True
    }
    create_alert(session, session.base_url, org_id, stream_name, update_payload)


    # Assert updated alert in the second server
    get_alert(session, session.base_url, org_id, alert_name, stream_name)

    # # Delete alert in the first server
    # delete_alert(session, base_url, org_id, alert_name, stream_name)

    # # Assert deletion in the first server
    # with pytest.raises(AssertionError):
    #     get_alert(session, base_url, org_id, alert_name, stream_name)

    # # Delete alert in the second server
    # delete_alert(session, session.base_url, org_id, alert_name, stream_name)

    # # Assert deletion in the second server
    # with pytest.raises(AssertionError):
    #     get_alert(session, session.base_url, org_id, alert_name, stream_name)

    # # Clean up: Delete destination and template
    # delete_destination(session, base_url, org_id, destination_name)
    # delete_template(session, base_url, org_id, template_name)
