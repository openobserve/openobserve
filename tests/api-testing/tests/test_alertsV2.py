import time
import random
import uuid
import pytest
import json
import requests
import logging


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
    template_alert = f"newtemp_{random.randint(10000, 99999)}"  # Make the name unique
    destination_alert = f"newdest_{random.randint(10000, 99999)}"  # Make the name unique


    payload_temp_alert = {
        "name":template_alert,
        "body":"{\n  \"text\": \"For stream {stream_name} of organization {org_name} alert {alert_name} of type {alert_type} is active\"\n}",
        "type":"http",
        "title":""
        }
    
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
        "url":"https://jsonplaceholder.typicode.com/todos",
        "method":"get",
        "skip_tls_verify":skip_tls_verify_value,
        "template":template_alert,
        "headers":{},
        "name":destination_alert
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
        "id": str(uuid.uuid4())
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
    "enabled": True,
    "description": "test",
    "folderId": folder_id
 }
    resp_post_alertnew = session.post(
    f"{url}api/v2/{org_id}/alerts",
    json=payload_alert,
    headers=headers,
    )
    print(resp_post_alertnew.content)

    assert ( resp_post_alertnew.status_code == 200  
    ), f"Post alert expected 200, but got {resp_post_alertnew.status_code} {resp_post_alertnew.content}"
    print(f"Alert {alert_name} created successfully")


def test_get_alertnew(create_session, base_url):
    """Running an E2E test for getting particular new alert ID."""

    session = create_session
    url = base_url
    org_id = "default"

    # Make the request to get the list of alerts
    resp_get_allalertsnew = session.get(f"{url}api/v2/{org_id}/alerts")

    # Ensure the response is successful
    assert resp_get_allalertsnew.status_code == 200, f"Failed to fetch alerts: {resp_get_allalertsnew.status_code}"

    # Parse the response JSON
    response_json = resp_get_allalertsnew.json()

    # Check if "list" is in the response and proceed
    assert "list" in response_json, "Response does not contain 'list'"

    # Get the list of alerts from the response
    alerts = response_json["list"]

    # Now you can iterate over the alerts
    for alert in alerts:
        alert_id = alert.get("alert_id")
        assert alert_id, f"Alert ID is missing for alert: {alert}"

        print(f"Extracted alert_id: {alert_id}")

    # Get  request using the extracted alert_id
        resp_get_alertnew = session.get(f"{url}api/v2/{org_id}/alerts/{alert_id}")
        assert resp_get_alertnew.status_code == 200, f"Failed to get details for alert {alert_id}"
        print(f"Successfully fetched details for alert {alert_id}")

def test_put_alertnew_update(create_session, base_url):
    """Running an E2E test for updating the new alert."""

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
    template_alert = f"newtemp_{random.randint(10000, 99999)}"  # Make the name unique
    destination_alert = f"newdest_{random.randint(10000, 99999)}"  # Make the name unique


    payload_temp_alert = {
        "name":template_alert,
        "body":"{\n  \"text\": \"For stream {stream_name} of organization {org_name} alert {alert_name} of type {alert_type} is active\"\n}",
        "type":"http",
        "title":""
        }
    
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
        "url":"https://jsonplaceholder.typicode.com/todos",
        "method":"get",
        "skip_tls_verify":skip_tls_verify_value,
        "template":template_alert,
        "headers":{},
        "name":destination_alert
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
            "log": "200",  # Match the query condition
            "City": "Athens",
            "Country": "HUN",
            "Discipline": "Swimming",
            "Sport": "Aquatics",
            "Year": 1896,
        },
        {
            "Athlete": "HERSCHMANN",
            "log": "404",  # Add a non-matching record for negative testing
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
        "id": str(uuid.uuid4())
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
    "enabled": True,
    "description": "test",
    "folderId": folder_id
    }
    resp_post_alertnew = session.post(
    f"{url}api/v2/{org_id}/alerts",
    json=payload_alert,
    headers=headers,
    )
    print(resp_post_alertnew.content)
    assert resp_post_alertnew.status_code == 200

    # After creating the alert, wait a moment to ensure it's fully created
    time.sleep(10)  # Increase this time if necessary

    # Make the request to get the list of alerts
    resp_get_allalertsnew = session.get(f"{url}api/v2/{org_id}/alerts")

    # Ensure the response is successful
    assert resp_get_allalertsnew.status_code == 200, f"Failed to fetch alerts: {resp_get_allalertsnew.status_code}"

    # Parse the response JSON
    response_json = resp_get_allalertsnew.json()

    # Check if "list" is in the response and proceed
    assert "list" in response_json, "Response does not contain 'list'"

    # Get the list of alerts from the response
    alerts = response_json["list"]

    # Now you can iterate over the alerts
    for alert in alerts:
        alert_id = alert.get("alert_id")
        assert alert_id, f"Alert ID is missing for alert: {alert}"

        print(f"Extracted alert_id for update: {alert_id}")

    # Validate the alert existence first
        resp_check_alert = session.get(f"{url}api/v2/{org_id}/alerts/{alert_id}")
        assert resp_check_alert.status_code == 200, f"Alert {alert_id} does not exist or cannot be retrieved."
        print(f"Alert {alert_id} exists and is retrievable for update.")
       
    # # Update the alert
        payload_alert_update = {
        "id": alert_id,
        "name": alert_name,
        "org_id": "default",
        "stream_type": "logs",
        "stream_name": "default",
        "is_real_time": False,
        "query_condition": {
        "type": "custom",
        "conditions": [
        {
        "column": "job",
        "operator": "=",
        "value": "test",
        "ignore_case": False,
        "id": str(uuid.uuid4())
        }
        ],
        "sql": None,
        "promql": None,
        "promql_condition": None,
        "aggregation": None,
        "vrl_function": None,
        "search_event_type": None,
        "multi_time_range": []
        },
        "trigger_condition": {
        "period": 10,
        "operator": ">=",
        "threshold": 3,
        "frequency": 1,
        "cron": "",
        "frequency_type": "minutes",
        "silence": 10,
        "timezone": "UTC",
        "tolerance_in_secs": None
        },
        "destinations": [destination_alert],
        "context_attributes": {},
        "row_template": "",
        "description": "Test Updated",
        "enabled": True,
        "tz_offset": 0,
        "last_triggered_at": None,
        "last_satisfied_at": None,
        "updated_at": int(time.time() * 1000),
        "createdAt": int(time.time() * 1000),
        "lastTriggeredAt": int(time.time() * 1000),
        } 
        # Update the alert for description with "Test Updated"
        resp_put_alertnew = session.put(
        f"{url}api/v2/{org_id}/alerts/{alert_id}?type=logs",
        json=payload_alert_update,
        headers=headers,
         )
        print(resp_put_alertnew.content)
        assert ( resp_put_alertnew.status_code == 200  
        ), f"Post alert expected 200, but got {resp_put_alertnew.status_code} {resp_put_alertnew.content}"

        print(f"Alert {alert_name} updated successfully")

        # Get details for the updated alert
        resp_get_updated_alertnew = session.get(f"{url}api/v2/{org_id}/alerts/{alert_id}")
        assert resp_get_updated_alertnew.status_code == 200, f"Failed to get details for updated alert {alert_id}"
        print(f"Successfully fetched details for updated alert {alert_id}")

        # Parse the response JSON
        response_json_updated = resp_get_updated_alertnew.json()

        # Check if the response is a dictionary (which it seems to be)
        if isinstance(response_json_updated, dict):
            alert_description = response_json_updated.get("description", None)
        else:
            raise ValueError("Unexpected response format: Expected a dictionary")

        # Now you can assert or further handle the 'alert_description'
            assert alert_description == "Test Updated", f"Expected 'Test Updated', but got {alert_description}"

def test_put_alertnew_disable(create_session, base_url):
    """Running an E2E test for getting the new alert disable."""

    session = create_session
    url = base_url
    org_id = "default"

    # Make the request to get the list of alerts
    resp_get_allalertsnew = session.get(f"{url}api/v2/{org_id}/alerts")

    # Ensure the response is successful
    assert resp_get_allalertsnew.status_code == 200, f"Failed to fetch alerts: {resp_get_allalertsnew.status_code}"

    # Parse the response JSON
    response_json = resp_get_allalertsnew.json()

    # Check if "list" is in the response and proceed
    assert "list" in response_json, "Response does not contain 'list'"

    # Get the list of alerts from the response
    alerts = response_json["list"]

    # Now you can iterate over the alerts
    for alert in alerts:
        alert_id = alert.get("alert_id")
        assert alert_id, f"Alert ID is missing for alert: {alert}"

        print(f"Extracted alert_id: {alert_id}")

    # Validate the alert existence first
        resp_check_alert = session.get(f"{url}api/v2/{org_id}/alerts/{alert_id}")
        assert resp_check_alert.status_code == 200, f"Alert {alert_id} does not exist or cannot be retrieved."
        print(f"Alert {alert_id} exists and is retrievable.")
    
    # Proceed to disable the alert
        resp_alertnew_disable = session.patch(f"{url}api/v2/{org_id}/alerts/{alert_id}/enable?value=false&type=logs")
        print(f"Disable Alert Response: {resp_alertnew_disable.text}")
        assert resp_alertnew_disable.status_code == 200, f"Failed to disable alert {alert_id}"
        print(f"Successfully disabled alert {alert_id}")

        # Get details for the disabled alert
        resp_get_disabled_alertnew = session.get(f"{url}api/v2/{org_id}/alerts/{alert_id}")
        assert resp_get_disabled_alertnew.status_code == 200, f"Failed to get details for disabled alert {alert_id}"
        print(f"Successfully fetched details for disabled alert {alert_id}")

        # Parse the response JSON
        response_json_disabled = resp_get_disabled_alertnew.json()

        # Check if the response is a dictionary (which it seems to be)
        if isinstance(response_json_disabled, dict):
            alert_disabled = response_json_disabled.get("enabled", None)
        else:
            raise ValueError("Unexpected response format: Expected a dictionary")

        # Now you can assert or further handle the 'alert_disabled'
            assert alert_disabled == "False", f"Expected 'False', but got {alert_disabled}"

def test_put_alertnew_enable(create_session, base_url):
    """Running an E2E test for getting the new alert enable."""

    session = create_session
    url = base_url
    org_id = "default"

    # Make the request to get the list of alerts
    resp_get_allalertsnew = session.get(f"{url}api/v2/{org_id}/alerts")

    # Ensure the response is successful
    assert resp_get_allalertsnew.status_code == 200, f"Failed to fetch alerts: {resp_get_allalertsnew.status_code}"

    # Parse the response JSON
    response_json = resp_get_allalertsnew.json()

    # Check if "list" is in the response and proceed
    assert "list" in response_json, "Response does not contain 'list'"

    # Get the list of alerts from the response
    alerts = response_json["list"]

    # Now you can iterate over the alerts
    for alert in alerts:
        alert_id = alert.get("alert_id")
        assert alert_id, f"Alert ID is missing for alert: {alert}"

        print(f"Extracted alert_id: {alert_id}")

    # Validate the alert existence first
        resp_check_alert = session.get(f"{url}api/v2/{org_id}/alerts/{alert_id}")
        assert resp_check_alert.status_code == 200, f"Alert {alert_id} does not exist or cannot be retrieved."
        print(f"Alert {alert_id} exists and is retrievable.")


    # Proceed to enable the alert
        resp_alertnew_enable = session.patch(f"{url}api/v2/{org_id}/alerts/{alert_id}/enable?value=true&type=logs")
        print(f"Enable Alert Response: {resp_alertnew_enable.text}")
        assert resp_alertnew_enable.status_code == 200, f"Failed to enable alert {alert_id}"
        print(f"Successfully enabled alert {alert_id}")
        
        # Get details for the enabled alert
        resp_get_enabled_alertnew = session.get(f"{url}api/v2/{org_id}/alerts/{alert_id}")
        assert resp_get_enabled_alertnew.status_code == 200, f"Failed to get details for enabled alert {alert_id}"
        print(f"Successfully fetched details for enabled alert {alert_id}")

        # Parse the response JSON
        response_json_enabled = resp_get_enabled_alertnew.json()

        # Check if the response is a dictionary (which it seems to be)
        if isinstance(response_json_enabled, dict):
            alert_enabled = response_json_enabled.get("enabled", None)
        else:
            raise ValueError("Unexpected response format: Expected a dictionary")

        # Now you can assert or further handle the 'alert_enabled'
            assert alert_enabled == "True", f"Expected 'True', but got {alert_enabled}"

def test_put_alertnew_trigger(create_session, base_url, caplog):
    """Running an E2E test for getting the new alert trigger."""
    caplog.set_level('INFO')
    session = create_session
    url = base_url
    org_id = "default"

    # Create a logger
    logger = logging.getLogger(__name__)

    # Make the request to get the list of alerts
    resp_get_allalertsnew = session.get(f"{url}api/v2/{org_id}/alerts")

    # Ensure the response is successful
    assert resp_get_allalertsnew.status_code == 200, f"Failed to fetch alerts: {resp_get_allalertsnew.status_code}"

    # Parse the response JSON
    response_json = resp_get_allalertsnew.json()

    # Check if "list" is in the response and proceed
    assert "list" in response_json, "Response does not contain 'list'"

    # Get the list of alerts from the response
    alerts = response_json["list"]

    # Now you can iterate over the alerts
    for alert in alerts:
        alert_id = alert.get("alert_id")
        assert alert_id, f"Alert ID is missing for alert: {alert}"

        print(f"Extracted alert_id: {alert_id}")

    # Validate the alert existence first
        resp_check_alert = session.get(f"{url}api/v2/{org_id}/alerts/{alert_id}")
        assert resp_check_alert.status_code == 200, f"Alert {alert_id} does not exist or cannot be retrieved."
        print(f"Alert {alert_id} exists and is retrievable.")

        time.sleep(5)  # Brief wait for status update

    # Trigger the alert
        # Trigger the alert
        logger.info(f"Attempting to trigger alert with ID: {alert_id}")

        resp_alertnew_trigger = session.patch(f"{url}api/v2/{org_id}/alerts/{alert_id}/trigger?type=logs")

    # Log response details for debugging
        print(f"Trigger Alert Response Status Code: {resp_alertnew_trigger.status_code}")
        print(f"Trigger Alert Response Body: {resp_alertnew_trigger.text}")

        print(f"Alert Trigger URL: {url}api/v2/{org_id}/alerts/{alert_id}/trigger?type=logs")
        print(f"Alert Details: {alert}")


    # Check if the response was successful
        assert resp_alertnew_trigger.status_code == 200, f"Failed to trigger alert {alert_id}"
        print(f"Successfully triggered alert {alert_id}")

        # Verify trigger effects
        time.sleep(2)  # Wait for trigger processing
        resp_check = session.get(f"{url}api/v2/{org_id}/alerts/{alert_id}")
        assert resp_check.status_code == 200
        alert_data = resp_check.json()
        # assert alert_data["last_triggered_at"] is not None, "Alert was not triggered" after resolving issues 5745
    
def test_delete_alertnew(create_session, base_url):
    """Running an E2E test for deleting the new alert."""

    session = create_session
    url = base_url
    org_id = "default"

    # Make the request to get the list of alerts
    resp_get_allalertsnew = session.get(f"{url}api/v2/{org_id}/alerts")

    # Ensure the response is successful
    assert resp_get_allalertsnew.status_code == 200, f"Failed to fetch alerts: {resp_get_allalertsnew.status_code}"

    # Parse the response JSON
    response_json = resp_get_allalertsnew.json()

    # Check if "list" is in the response and proceed
    assert "list" in response_json, "Response does not contain 'list'"

    # Get the list of alerts from the response
    alerts = response_json["list"]

    # Now you can iterate over the alerts
    for alert in alerts:
        alert_id = alert.get("alert_id")
        assert alert_id, f"Alert ID is missing for alert: {alert}"

        print(f"Extracted alert_id: {alert_id}")

    # Validate the alert existence first
        resp_check_alert = session.get(f"{url}api/v2/{org_id}/alerts/{alert_id}")
        assert resp_check_alert.status_code == 200, f"Alert {alert_id} does not exist or cannot be retrieved."
        print(f"Alert {alert_id} exists and is retrievable.")

    # Proceed to delete the alert
        resp_delete_alertnew = session.delete(f"{url}api/v2/{org_id}/alerts/{alert_id}")
        print(f"Deleted Alert Response: {resp_delete_alertnew.text}")
        assert resp_delete_alertnew.status_code == 200, f"Failed to delete alert {alert_id}"
        print(f"Successfully deleted alert {alert_id}")

    # Verify alert is deleted
        resp_verify = session.get(f"{url}api/v2/{org_id}/alerts/{alert_id}")
        assert resp_verify.status_code == 404, f"Expected 404 for deleted alert, got {resp_verify.status_code}"

