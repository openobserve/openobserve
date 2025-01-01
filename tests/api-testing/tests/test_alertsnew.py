import time
import random
import uuid
import pytest

def test_get_alertsnew(create_session, base_url):
    """Running an E2E test for getting all the new alerts list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_allalertsnew = session.get(f"{url}api/v2/{org_id}/alerts")

    print(resp_get_allalertsnew.content)
    assert (
        resp_get_allalertsnew.status_code == 200
    ), f"Get all new alerts list 200, but got {resp_get_allalertsnew.status_code} {resp_get_allalertsnew.content}"

def test_get_templates(create_session, base_url):
    """Running an E2E test for getting all the alerts templates list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_templates = session.get(f"{url}api/{org_id}/alerts/templates")

    print(resp_get_templates.content)
    assert (
        resp_get_templates.status_code == 200
    ), f"Get all template list 200, but got {resp_get_templates.status_code} {resp_get_templates.content}"


def test_post_templates(create_session, base_url):
    """Running an E2E test for creating template."""
    template_name = f"newtemp_{random.randint(1000, 9999)}"  # Make the name unique
    
    session = create_session
    url = base_url
    org_id = "default"
    payload_temp = {"body": "invalid", "ise2e": True, "name": template_name}
    
    # Create template for alerts
    resp_post_templates = session.post(
        f"{url}api/{org_id}/alerts/templates", json=payload_temp
    )
    
    print(resp_post_templates.content)
    assert (
        resp_post_templates.status_code == 200
    ), f"Create template 200, but got {resp_post_templates.status_code} {resp_post_templates.content}"

def test_get_destinations(create_session, base_url):
    """Running an E2E test for getting all the destination list for alerts."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_destinations = session.get(f"{url}api/{org_id}/alerts/destinations")

    print(resp_get_destinations.content)
    assert (
        resp_get_destinations.status_code == 200
    ), f"Get all destination list 200, but got {resp_get_destinations.status_code} {resp_get_destinations.content}"

def test_post_destination(create_session, base_url):
    """Running an E2E test for creating a new destination."""

    template_dest = f"newtemp_{random.randint(1000, 9999)}"  # Make the name unique
    destination_name = f"newdest_{random.randint(1000, 9999)}"  # Make the name unique

    session = create_session
    url = base_url
    org_id = "default"
    payload_tempd = {"body": "invalid", "ise2e": True, "name": template_dest}

    # Create template for alerts
    resp_create_templates_dest = session.post(
        f"{url}api/{org_id}/alerts/templates", json=payload_tempd
    )

    print(resp_create_templates_dest.content)
    assert (
        resp_create_templates_dest.status_code == 200
    ), f"Create template 200, but got {resp_create_templates_dest.status_code} {resp_create_templates_dest.content}"

    skip_tls_verify_value = False  # Define the skip_tls_verify_value

    payload_dest = {
        "url": "www",
        "method": "post",
        "skip_tls_verify": skip_tls_verify_value,
        "template": template_dest,
        "headers": {"test": "test"},
        "name": destination_name
    }

    # Create destination
    resp_post_destinations = session.post(
        f"{url}api/{org_id}/alerts/destinations",
        json=payload_dest,
    )
    print(resp_post_destinations.content)

    assert (
        resp_post_destinations.status_code == 200
    ), f"Failed to create destination: {resp_post_destinations.status_code} {resp_post_destinations.content}"


def test_new_alert_create(create_session, base_url):
    """Running an E2E test for create a new alert."""

    alert_name = f"newalert_{random.randint(1000, 9999)}"  # Make the name unique
    folder_alert = f"newfloder_{random.randint(1000, 9999)}"  # Make the name unique
    
    session = create_session
    url = base_url
    org_id = "default"


    headers = {"Content-Type": "application/json", "Custom-Header": "value"}


    # create folder

    payload_folder = {"description": "newfoldernvp", "name": folder_alert}
    resp_create_folder = session.post(
        f"{url}api/{org_id}/folders", json=payload_folder)

    print(resp_create_folder.content)

    folder_id = resp_create_folder.json()["folderId"]

    assert (
        resp_create_folder.status_code == 200
    ), f"Expected 200, but got {resp_create_folder.status_code} {resp_create_folder.content}"

    payload_folder = {
        "description": "folderupdated",
        "folderId": folder_id,
        "name": folder_alert,
    }
    folder_id = resp_create_folder.json()["folderId"]


    # createtemplate
    template_alert = f"newtemp_{random.randint(1000, 9999)}"  # Make the name unique
    destination_alert = f"newdest_{random.randint(1000, 9999)}"  # Make the name unique


    payload_temp_alert = {"body": "invalid", "ise2e": True, "name": template_alert}

    # Create template for alerts
    resp_create_templates_alert = session.post(
        f"{url}api/{org_id}/alerts/templates", json=payload_temp_alert
    )

    print(resp_create_templates_alert.content)
    assert (
        resp_create_templates_alert.status_code == 200
    ), f"Create template 200, but got {resp_create_templates_alert.status_code} {resp_create_templates_alert.content}"

    
    skip_tls_verify_value = False  # Define the skip_tls_verify_value

    payload_dest_alert = {
        "url": "www",
        "method": "post",
        "skip_tls_verify": skip_tls_verify_value,
        "template": template_alert,
        "headers": {"test": "test"},
        "name": destination_alert
    }

    # Create destination
    resp_create_destinations_alert = session.post(
        f"{url}api/{org_id}/alerts/destinations",
        json=payload_dest_alert,
    )
    print(resp_create_destinations_alert.content)

    assert (
        resp_create_destinations_alert.status_code == 200
    ), f"Failed to create destination: {resp_create_destinations_alert.status_code} {resp_create_destinations_alert.content}"

    # Get destination
    resp_get_destinations_alert = session.get(
    f"{url}api/{org_id}/alerts/destinations/{destination_alert}"
    )
    print(resp_get_destinations_alert.content)

    assert (
    resp_get_destinations_alert.status_code == 200
    ), f"Get all destinations list 200, but got {resp_get_destinations_alert.status_code} {resp_get_destinations_alert.content}"

    # Check if the destination name matches
    assert (
    resp_get_destinations_alert.json()["name"] == destination_alert
    ), f"Destination {destination_alert} not found in the response"

    time.sleep(5)
    # ingest logs
    stream_name = "newpy_tests"
    payload_logs = [
        {
            "Athlete": "newtemp",
            "City": "Athens",
            "Country": "HUN",
            "Discipline": "Swimming",
            "Sport": "Aquatics",
            "Year": 1896,
        },
        {
            "Athlete": "HERSCHMANN",
            "City": "Athens",
            "Country": "CHN",
            "Discipline": "Swimming",
            "Sport": "Aquatics",
            "Year": 1896,
        },
    ]

    resp_create_logstream = session.post(
        f"{url}api/{org_id}/{stream_name}/_json", json=payload_logs
    )

    print(resp_create_logstream.content)
    assert (
        resp_create_logstream.status_code == 200
    ), f"Get all logs list 200, but got {resp_create_logstream.status_code} {resp_create_logstream.content}"
    
    time.sleep(5)  # Or use a more robust approach like a retry loop

    is_real_time = False
    payload_alert = {
        "name": alert_name,
        "stream_type": "logs",
        "stream_name": "newpy_tests",
        "is_real_time": is_real_time,
        "query_condition": {
            "conditions": [
                {
                    "column": "city",
                    "operator": "=",
                    "value": "200",
                    "id": "ebab5c0f-e78b-46b4-900a-22eb8a1f662c",
                }
            ],
            "sql": "",
            "promql": None,
            "type": "custom",
            "aggregation": None,
        },
        "trigger_condition": {
            "period": 10,
            "operator": ">=",
            "threshold": 3,
            "silence": 10,
        },
        "destinations": [destination_alert], # Updated to a list
        "context_attributes": {},
        "enabled": True,
        "description": "test",
        "folderId": folder_id,
    }
    # Create the alert after ensuring the destination exists
    resp_post_alertnew = session.post(
    f"{url}api/v2/{org_id}/alerts",
    json=payload_alert,
    headers=headers,
    )
    print(resp_post_alertnew.content)

    assert (
    resp_post_alertnew.status_code == 200
    ), f"Get all alerts list 200, but got {resp_post_alertnew.status_code} {resp_post_alertnew.content}"

    