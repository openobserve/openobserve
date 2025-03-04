import time
import random
import uuid
import pytest
import requests
import logging
import os
# # Setup logging
# logger = logging.getLogger(__name__)

# Constants for WebSocket URL and user credentials
ZO_BASE_URL = os.environ.get("ZO_BASE_URL")  # Use environment variable
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable


def get_alertsnew(session, base_url, org):
    resp_allalertsnew = session.get(f"{base_url}api/v2/{org}/alerts")
    assert (
        resp_allalertsnew.status_code == 200
    ), f"Get all new alerts list 200, but got {resp_allalertsnew.status_code} {resp_allalertsnew.content}"
    
    response_json = resp_allalertsnew.json()
    assert "list" in response_json, "Response does not contain 'list'"

    alerts = response_json["list"]
    alert_ids = []

    for alert in alerts:
        alert_id = alert.get("alert_id")  # Changed to access 'alert_id'
        assert alert_id, f"Alert ID is missing for alert: {alert}"
        alert_ids.append(alert_id)
    
    return alert_ids



def get_alert(session, base_url, org, alert_id):
    resp_alert = session.get(f"{base_url}api/v2/{org}/alerts/{alert_id}")
    assert (
        resp_alert.status_code == 200
    ), f"Get alert 200, but got {resp_alert.status_code} {resp_alert.content}"
    return resp_alert.json()    

def delete_alert(session, base_url, org, alert_id):
    resp_delete = session.delete(f"{base_url}api/v2/{org}/alerts/{alert_id}")
    assert (
        resp_delete.status_code == 200
    ), f"Delete alert 200, but got {resp_delete.status_code} {resp_delete.content}"
    
    # Verify alert deletion
    resp_verify = session.get(f"{base_url}api/v2/{org}/alerts/{alert_id}")
    assert resp_verify.status_code == 404, f"Expected 404 for deleted alert, got {resp_verify.status_code}"



def create_folder(session, base_url, org, folder_name):
    payload = {"description": "newfoldernvp", "name": folder_name}
    response = session.post(f"{base_url}api/v2/{org}/folders/alerts", json=payload)
    assert response.status_code == 200, f"Failed to create folder: {response.content}"
    folder_id = response.json().get("folderId")
    return folder_id

def create_template(session, base_url, org, template_name):
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "name": template_name,
        "body": '{"text": "For stream {stream_name} of organization {org} alert {alert_name} of type {alert_type} is active"}',
        "type": "http",
        "title": ""
    }
    response = session.post(f"{base_url}api/{org}/alerts/templates", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create template: {response.content}"

def create_destination(session, base_url, org, destination_name, template_alert):
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    skip_tls_verify_value = False  # Define the skip_tls_verify_value
    payload = {
        "url": "https://jsonplaceholder.typicode.com/todos",
        "method": "get",
        "template": template_alert,
        "headers": {},
        "name": destination_name,
        "skip_tls_verify": skip_tls_verify_value
    }
    response = session.post(f"{base_url}api/{org}/alerts/destinations", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create destination: {response.content}"
    return response.json()

def get_destination(session, base_url, org, destination_name):
    response = session.get(f"{base_url}api/{org}/alerts/destinations/{destination_name}")
    assert response.status_code == 200, f"Failed to get destination: {response.content}"
    assert (
    response.json()["name"] == destination_name
    ), f"Destination {destination_name} not found in the response"
    return response.json()

def delete_destination(session, base_url, org, destination_name):
    response = session.delete(f"{base_url}api/{org}/alerts/destinations/{destination_name}")
    assert response.status_code == 200, f"Failed to delete destination: {response.content}"
    return response.json()

def ingest_logs(session, base_url, org, stream_name):
    payload_logs = [
        {
            "Athlete": "newtemp",
            "log": "200",
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
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    response = session.post(f"{base_url}api/{org}/{stream_name}/_json", json=payload_logs, headers=headers)
    assert response.status_code == 200, f"Failed to ingest logs: {response.content}"

def create_alert(session, base_url, org, folder_id, alert_name, template_name, stream_name, destination_name):
    alert_id = str(uuid.uuid4())
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
  
    payload = {
    "name": alert_name,
    "row_template": template_name,
    "stream_type": "logs",
    "stream_name": stream_name,
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
        "frequency": 3,
        "cron": "",
        "threshold": 3,
        "silence": 10,
        "frequency_type": "minutes",
        "timezone": "UTC",
        "tolerance_in_secs": 0
    },
    "org": org,
    "destinations": [destination_name],
    "enabled": True,
    "description": "test",
    "folderId": folder_id
 }

    response = session.post(f"{base_url}api/v2/{org}/alerts", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create alert: {response.content}"

def update_alert(session, base_url, org, alert_id, alert_name, template_name, stream_name, destination_name):
    headers = {
        "Content-Type": "application/json",
        "Custom-Header": "value"
        }

    payload_alert_update = {
        "id": alert_id,
        "name": alert_name,
        "org_id": org,
        "stream_type": "logs",
        "stream_name": stream_name,
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
        "frequency": 3,
        "cron": "",
        "frequency_type": "minutes",
        "silence": 10,
        "timezone": "UTC",
        "tolerance_in_secs": None
        },
        "destinations": [destination_name],
        "context_attributes": {},
        "row_template": template_name,
        "description": "Test Updated",
        "enabled": True,
        "tz_offset": 0,
        "last_triggered_at": None,
        "last_satisfied_at": None,
        "updated_at": int(time.time() * 1000),
        "createdAt": int(time.time() * 1000),
        "lastTriggeredAt": int(time.time() * 1000),
        } 

    response = session.put(f"{base_url}api/v2/{org}/alerts/{alert_id}?type=logs", json=payload_alert_update, headers=headers)
    assert response.status_code == 200, f"Failed to update alert: {response.content}"
                # Check if the response is a dictionary (which it seems to be)
    if isinstance(response, dict):
        alert_description = response.get("description", None)
    else:
        raise ValueError("Unexpected response format: Expected a dictionary")
    print(f"Alert description: {alert_description}")

    # Now you can assert or further handle the 'alert_description'
    assert alert_description == "Test Updated", f"Expected 'Test Updated', but got {alert_description}"

def alertnew_disable(session, base_url, org, alert_id):
    # Proceed to disable the alert
    resp_alertnew_disable = session.patch(f"{base_url}api/v2/{org}/alerts/{alert_id}/enable?value=false&type=logs")
    print(f"Disable Alert Response: {resp_alertnew_disable.text}")
    assert resp_alertnew_disable.status_code == 200, f"Failed to disable alert {alert_id}"
    print(f"Successfully disabled alert {alert_id}")
def validate_disable(session, base_url, org, alert_id):
    # Get details for the disabled alert
    resp_get_disabled_alertnew = session.get(f"{base_url}api/v2/{org}/alerts/{alert_id}")
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

def alertnew_enable(session, base_url, org, alert_id):
    # Proceed to enable the alert
    resp_alertnew_enable = session.patch(f"{base_url}api/v2/{org}/alerts/{alert_id}/enable?value=true&type=logs")
    print(f"Enable Alert Response: {resp_alertnew_enable.text}")
    assert resp_alertnew_enable.status_code == 200, f"Failed to enable alert {alert_id}"
    print(f"Successfully enabled alert {alert_id}")

def validate_enable(session, base_url, org, alert_id):
    # Get details for the enabled alert
    resp_get_enabled_alertnew = session.get(f"{base_url}api/v2/{org}/alerts/{alert_id}")
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

def alertnew_trigger(session, base_url, org, alert_id, caplog):
    caplog.set_level('INFO')
    # Trigger the alert
    resp_alertnew_trigger = session.patch(f"{base_url}api/v2/{org}/alerts/{alert_id}/trigger?type=logs")
    print(f"Trigger Alert Response: {resp_alertnew_trigger.text}")
    assert resp_alertnew_trigger.status_code == 200, f"Failed to trigger alert {alert_id}"
    print(f"Successfully triggered alert {alert_id}")

def validate_trigger(session, base_url, org, alert_id):  
    # Verify trigger effects
    time.sleep(2)  # Wait for trigger processing
    resp_check = session.get(f"{base_url}api/v2/{org}/alerts/{alert_id}")
    assert resp_check.status_code == 200
    alert_data = resp_check.json()
    # assert alert_data["last_triggered_at"] is not None, "Alert was not triggered" after resolving issues 5745
    assert alert_data["last_triggered_at"] is not None, "Alert was not triggered"
    print(f"Alert data: {alert_data}")
    return alert_data   


    


def delete_alert(session, base_url, org, alert_id):
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    response = session.delete(f"{base_url}api/v2/{org}/alerts/{alert_id}", headers=headers)
    assert response.status_code == 200, f"Failed to delete alert: {response.content}"

def test_alert_workflow(create_session, base_url):
    session = create_session
    stream_name = "default"
    org = "default"

    base_url = ZO_BASE_URL
    base_url_sc = ZO_BASE_URL_SC
    
    # Create folder
    folder_name = f"newfolder_{random.randint(1000, 9999)}"

    folder_id = create_folder(session, base_url, org, folder_name)

    # Create template
    template_name = f"newtemp_{random.randint(10000, 99999)}"
    create_template(session, base_url, org, template_name)

    # Create destination
    destination_name = f"newdest_{random.randint(10000, 99999)}"
    create_destination(session, base_url, org, destination_name, template_name)

    # Now create the alert
    alert_name = f"newalert_{random.randint(1000, 9999)}"
    create_alert(session, base_url, org, folder_id, alert_name, template_name, stream_name, destination_name)
    time.sleep(5)
    # Ingest logs
    ingest_logs(session, base_url, org, stream_name)

    # Get alert IDs
    alert_ids = get_alertsnew(session, base_url, org)
    alert_ids_sc = get_alertsnew(session, base_url_sc, org)

    # Print the extracted alert IDs
    for alert_id in alert_ids:
        print(f"Extracted alert_id: {alert_id}")

    for alert_id in alert_ids_sc:
        print(f"Extracted alert_id from SC: {alert_id}")

    # Example of using the first alert ID if needed
    if alert_ids:
        first_alert_id = alert_ids[0]  # Accessing the first alert ID
        # Do something with first_alert_id if needed
        print(f"First alert ID: {first_alert_id}")

    # time.sleep(5)
    # # Update alert
    # update_alert(session, base_url_sc, org, first_alert_id, alert_name, template_name, stream_name, destination_name)







    

    # # Trigger alert
    # alertnew_trigger(session, base_url, org, alert_id, caplog)

    # time.sleep(5)
    # # Update alert
    # update_alert(session, base_url, org, alert_id, alert_name, template_name, stream_name, destination_name)

    # # # Delete alert
    # # delete_alert(session, base_url, org, alert_id)

    