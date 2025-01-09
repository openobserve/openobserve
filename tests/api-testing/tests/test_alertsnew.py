import time
import random
import uuid
import pytest
import json


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
        f"{url}api/v2/{org_id}/folders/alerts", json=payload_folder)

    print(resp_create_folder.content)

    folder_id = resp_create_folder.json()["folderId"]

    assert (
        resp_create_folder.status_code == 200
    ), f"Expected 200, but got {resp_create_folder.status_code} {resp_create_folder.content}"

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
    stream_name = "default"
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
    
    time.sleep(5)  
    payload_alert = {
    "name": alert_name,
    "row_template": template_alert,
    "stream_type": "logs",
    "stream_name": "default",
    "is_real_time": False,
    "context_attributes": {},
    "query_condition": {
        "conditions": [ {
        "column": "log",
        "operator": "=",
        "value": "200",
        "type": None,  # Set it to None or remove it
        "id": "95eb852b-b93b-4cb6-ab17-b7608b4fc741"
        } ],
        "search_event_type": "ui",
        "sql": "",
        "promql": "",
        "type": "custom",
        "promql_condition": None,
        "vrl_function": None,
        "multi_time_range": []
    },
    "trigger_condition": {
        "period": 10,
        "operator": ">=",
        "frequency": 1,
        "cron": "",
        "threshold": 3,
        "silence": 10,
        "frequency_type": "minutes",
        "timezone": "UTC",
        "tolerance_in_secs": 0
    },
    "org_id": "default",
    "destinations": [destination_alert],
    "context_attributes": {},
    "enabled": True,
    "description": "test",
    "owner": "root@example.com",
    "folderId": folder_id
 }
    resp_post_alertnew = session.post(
    f"{url}api/v2/{org_id}/alerts",
    json=payload_alert,
    headers=headers,
    )
    print(resp_post_alertnew.content)
    
    # Ensure the response is successful and contains the expected data
    assert (
    resp_post_alertnew.status_code == 200
    ), f"Get all alerts list 200, but got {resp_post_alertnew.status_code} {resp_post_alertnew.content}"
    
    # Extract the alert ID from the response message
    response_json = resp_post_alertnew.json()
    assert "message" in response_json, "Response should contain a message field"
    assert response_json["message"] == "Alert saved", "Response message is incorrect"
    # assert response_json["alert_id"] is not None, "Alert ID is missing in response"
    # assert response_json["alert_id"] != "", "Alert ID is empty in response"
    # assert response_json["alert_id"] == "alert_id", "Alert ID is incorrect in response"

   
   
    # Extract the alert ID from the response message
    message = response_json["message"]
    alert_id_prefix = "alert_id: "
    assert alert_id_prefix in message, "Alert ID not found in the message"
    alert_id = message.split(alert_id_prefix)[-1].strip()
    assert alert_id, "Extracted Alert ID is empty"

    print(f"Alert ID: {alert_id}")

    # alert_id = resp_post_alertnew.json()["alertId"]

    resp_get_alertnew = session.get(f"{url}api/v2/{org_id}/alerts/{alert_id}")

    print(resp_get_alertnew.content)
    assert (
        resp_get_alertnew.status_code == 200
    ), f"Get all new alerts list 200, but got {resp_get_alertnew.status_code} {resp_get_alertnew.content}"

