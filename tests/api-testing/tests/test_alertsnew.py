import time
import random
import uuid
import pytest
import requests
import logging
import os
import json
# # Setup logging
# logger = logging.getLogger(__name__)

# Constants for WebSocket URL and user credentials
ZO_BASE_URL = os.environ.get("ZO_BASE_URL")  # Use environment variable
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable



# Folders
def create_user(session, base_url, org, email_address):
    payload = {"organization": org,"email": email_address,"password":"12345678","role":"admin"}
    response = session.post(f"{base_url}api/{org}/users", json=payload)
    assert response.status_code == 200, f"Failed to create folder: {response.content}"
    

def create_folder(session, base_url, org, folder_name):
    payload = {"description": "newfoldernvp", "name": folder_name}
    response = session.post(f"{base_url}api/v2/{org}/folders/alerts", json=payload)
    assert response.status_code == 200, f"Failed to create folder: {response.content}"
    folder_id = response.json().get("folderId")
    return folder_id

def create_template_webhook(session, base_url, org, template_name):
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "name": template_name,
        "body": '{"text": "For stream {stream_name} of organization {org} alert {alert_name} of type {alert_type} is active"}',
        "type": "http",
        "title": ""
    }
    response = session.post(f"{base_url}api/{org}/alerts/templates", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create template: {response.content}"
    return response.json()

def create_template_email(session, base_url, org, template_name):
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    payload = {
        "name": template_name,
        "body": '{"text": "For stream {stream_name} of organization {org} alert {alert_name} of type {alert_type} is active"}', 
        "type": "email",
        "title": "Email Alert"
    }
    response = session.post(f"{base_url}api/{org}/alerts/templates", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create template: {response.content}"
    return response.json()

def get_template(session, base_url, org):
    resp_template = session.get(f"{base_url}api/{org}/alerts/templates")
    assert (
        resp_template.status_code == 200
    ), f"Get template 200, but got {resp_template.status_code} {resp_template.content}"
    return resp_template.json()    

def update_template_webhook(session, base_url, org, template_name):
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "name": template_name,
        "body": '{\n  \"text\": \"{alert_name} is active\"\n}',
        "type": "http",
        "title": ""
    }         
    resp_template = session.put(f"{base_url}api/{org}/alerts/templates/{template_name}", json=payload, headers=headers)
    assert (
        resp_template.status_code == 200
    ), f"Update template 200, but got {resp_template.status_code} {resp_template.content}"
    return resp_template.json()    

def update_template_email(session, base_url, org, template_name):
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    payload = {
        "name": template_name,
        "body": '{"text": "For stream {stream_name} of organization {org} alert {alert_name} of type {alert_type} is active"}',
        "type": "email",
        "title": "Email Alert Updated"
    }         
    resp_template = session.put(f"{base_url}api/{org}/alerts/templates/{template_name}", json=payload, headers=headers)
    assert (
        resp_template.status_code == 200
    ), f"Update template 200, but got {resp_template.status_code} {resp_template.content}"
    return resp_template.json()    

def create_destination_webhook(session, base_url, org, destination_name, template_alert):
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    skip_tls_verify_value = False  # Define the skip_tls_verify_value
    payload = {
        "url": "https://jsonplaceholder.typicode.com/todos",
        "method": "get",
        "template": template_alert,  
        "headers": {},  # Ensure this is formatted correctly
        "name": destination_name,
        "skip_tls_verify": skip_tls_verify_value
    }
    response = session.post(f"{base_url}api/{org}/alerts/destinations", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create destination: {response.content}"
    return response.json()

def create_destination_email(session, base_url, org, destination_name, template_alert, email_address):
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    skip_tls_verify_value = False  # Define the skip_tls_verify_value
    payload = {
        "url": "",
        "type": "email",
        "emails": [email_address],
        "method": "post",
        "template": template_alert,
        "headers": {},
        "name": destination_name,
        "skip_tls_verify": skip_tls_verify_value
    }
    response = session.post(f"{base_url}api/{org}/alerts/destinations", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create destination: {response.content}"
    return response.json()


def get_destination(session, base_url, org):
    response = session.get(f"{base_url}api/{org}/alerts/destinations")
    assert response.status_code == 200, f"Failed to get destination: {response.content}"
    return response.json()

def update_destination_webhook(session, base_url, org, destination_name):
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    payload = {
        "name": destination_name,
        "url": "https://jsonplaceholder.typicode.com/todos",
        "method": "get",
    }   
    response = session.put(f"{base_url}api/{org}/alerts/destinations/{destination_name}", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to update destination: {response.content}"
    return response.json()

def update_destination_email(session, base_url, org, destination_name):
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    payload = {
        "name": destination_name,
        "url": "https://jsonplaceholder.typicode.com/todos",
        "type": "email",
        "emails": ["test@example.com"],
        "method": "post",
    }
    response = session.put(f"{base_url}api/{org}/alerts/destinations/{destination_name}", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to update destination: {response.content}"
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
    # alert_id = str(uuid.uuid4())
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
    return response.json()

def get_alertsnew(session, base_url, org):
    # Make the GET request to fetch alerts
    resp_allalertsnew = session.get(f"{base_url}api/v2/{org}/alerts")
    
    # Assert that the response status code is 200
    assert (
        resp_allalertsnew.status_code == 200
    ), f"Expected status code 200, but got {resp_allalertsnew.status_code} {resp_allalertsnew.content}"
    
    # Parse the JSON response
    response_json = resp_allalertsnew.json()
    
    # Assert that the response contains the 'list' key
    assert "list" in response_json, "Response does not contain 'list'"
    
    # Extract the alerts from the response
    alerts = response_json["list"]
    alert_details = []

    # Iterate through each alert and extract relevant information
    for alert in alerts:
        alert_detail = {
            "alert_id": alert.get("alert_id"),  # Ensure to use the correct key
            "name": alert.get("name"),
            "org_id": alert.get("org_id"),
            "stream_type": alert.get("stream_type"),
            "stream_name": alert.get("stream_name"),
            "enabled": alert.get("enabled"),
            "description": alert.get("description"),
            "destinations": alert.get("destinations"),
            "query_condition": alert.get("query_condition"),
            "trigger_condition": alert.get("trigger_condition"),
            "owner": alert.get("owner"),
            "updated_at": alert.get("updated_at"),
            # Add any other fields you may need
        }

        # Ensure that alert_id is present
        assert alert_detail["alert_id"] is not None, f"Alert ID is missing for alert: {alert}"
        
        alert_details.append(alert_detail)
    
    return alert_details  # Return the list of structured alert details






def get_alert(session, base_url, org, alert_id):
    resp_alert = session.get(f"{base_url}api/v2/{org}/alerts/{alert_id}")
    assert (
        resp_alert.status_code == 200
    ), f"Get alert 200, but got {resp_alert.status_code} {resp_alert.content}"
    return resp_alert.json()  
    


def update_alert(session, base_url, org, alert_id, alert_name, template_name, stream_name, destination_name):
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        
        "Custom-Header": "value",
        # Add more headers from the curl command here, if needed
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
                    "id": str(uuid.uuid4())  # Ensure this matches the expected format
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
        "last_edited_by": "root@example.com",  # Ensure this is included if necessary
    }

    # Log the payload to see what is being sent
    print(f"Payload for updating alert: {payload_alert_update}")

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
    resp_delete = session.delete(f"{base_url}api/v2/{org}/alerts/{alert_id}")
    assert (
        resp_delete.status_code == 200
    ), f"Delete alert 200, but got {resp_delete.status_code} {resp_delete.content}"
    
def delete_alert_verify(session, base_url, org, alert_id):       # Verify alert deletion
    resp_verify = session.get(f"{base_url}api/v2/{org}/alerts/{alert_id}")
    assert resp_verify.status_code == 404, f"Expected 404 for deleted alert, got {resp_verify.status_code}"



def test_create_workflow(create_session, base_url):
    session = create_session
    stream_name = "stream_pytest_data"
    org = "org_pytest_data"

    base_url = ZO_BASE_URL
    
    # Create folder
    folder_name = f"newfolder_{random.randint(1000, 9999)}"

    folder_id = create_folder(session, base_url, org, folder_name)
    email_id = f"email_{random.randint(1000, 9999)}@gmail.com"  # Make the name unique
   
    create_user(session, base_url, org, email_id)
    # Create template
    template_name_webhook = f"template_webhook_{random.randint(10000, 99999)}"
    template_name_email = f"template_email_{random.randint(10000, 99999)}"  
    template_webhook = create_template_webhook(session, base_url, org, template_name_webhook)
    template_email = create_template_email(session, base_url, org, template_name_email)
    time.sleep(5)

    # Create destination
    destination_name_webhook = f"newdest_{random.randint(10000, 99999)}"
    destination_name_email = f"newdest_{random.randint(10000, 99999)}"

    destination_webhook = create_destination_webhook(session, base_url, org, destination_name_webhook, template_name_webhook)
    destination_email = create_destination_email(session, base_url, org, destination_name_email, template_name_email, email_id)
    time.sleep(5)

    # Now create the alert
    alert_name_webhook = f"newalert_{random.randint(1000, 9999)}"
    alert_name_email = f"newalert_{random.randint(1000, 9999)}"

    alert_webhook = create_alert(session, base_url, org, folder_id, alert_name_webhook, template_name_webhook, stream_name, destination_name_webhook)
    alert_email =  create_alert(session, base_url, org, folder_id, alert_name_email, template_name_email, stream_name, destination_name_email)
    time.sleep(5)
    
    
# def test_validate_workflow(create_session, base_url):
#     session = create_session
#     stream_name = "stream_pytest_data"
#     org = "org_pytest_data"

#     base_url = ZO_BASE_URL_SC
#     time.sleep(5)
#     templates = get_template(session, base_url, org)
#     # print("Templates in the response", templates)
#     assert templates is not None, "Templates are not found"
#     assert len(templates) > 0, "Templates are empty"
#     assert isinstance(templates, list), "Templates are not a list"
#     assert isinstance(templates[0], dict), "Templates are not a list of dictionaries"
#     assert "name" in templates[0], "Templates do not contain 'name' key"
#     assert "body" in templates[0], "Templates do not contain 'body' key"
#     assert "type" in templates[0], "Templates do not contain 'type' key"    
    
#     destinations = get_destination(session, base_url, org)
#     # print("Destinations in the response", destinations)
#     assert destinations is not None, "Destinations are not found"
#     assert len(destinations) > 0, "Destinations are empty"
#     assert isinstance(destinations, list), "Destinations are not a list"
#     assert isinstance(destinations[0], dict), "Destinations are not a list of dictionaries" 
#     assert "name" in destinations[0], "Destinations do not contain 'name' key"
   
#     alerts = get_alertsnew(session, base_url, org)
#     print("Alerts in the response", alerts)
#     assert alerts is not None, "Alerts are not found"
#     assert len(alerts) > 0, "Alerts are empty"
#     assert isinstance(alerts, list), "Alerts are not a list"
   
#     assert "alert_id" in alerts[0], "Alerts do not contain 'alert_id' key"
#     assert "name" in alerts[0], "Alerts do not contain 'name' key"
#     assert "description" in alerts[0], "Alerts do not contain 'description' key"
#     assert "enabled" in alerts[0], "Alerts do not contain 'enabled' key"
   
    
#     alert_id = alerts[0].get("alert_id")
#     alert_data = get_alert(session, base_url, org, alert_id)
#     print("Alert data in the response", alert_data)
#     assert alert_data is not None, "Alert data is not found"
#     assert "name" in alert_data, "Alert data does not contain 'name' key"
#     assert "description" in alert_data, "Alert data does not contain 'description' key" 
#     assert "enabled" in alert_data, "Alert data does not contain 'enabled' key"
#     assert "destinations" in alert_data, "Alert data does not contain 'destinations' key"
#     assert "context_attributes" in alert_data, "Alert data does not contain 'context_attributes' key"
#     assert "row_template" in alert_data, "Alert data does not contain 'row_template' key"   
#     assert "stream_type" in alert_data, "Alert data does not contain 'stream_type' key"
#     assert "stream_name" in alert_data, "Alert data does not contain 'stream_name' key"
#     assert "is_real_time" in alert_data, "Alert data does not contain 'is_real_time' key"
#     assert "query_condition" in alert_data, "Alert data does not contain 'query_condition' key"
#     assert "trigger_condition" in alert_data, "Alert data does not contain 'trigger_condition' key"     
#     assert "org_id" in alert_data, "Alert data does not contain 'org_id' key"
#     assert "updated_at" in alert_data, "Alert data does not contain 'updatedAt' key"
#     assert "last_triggered_at" in alert_data, "Alert data does not contain 'lastTriggeredAt' key"
#     assert "last_satisfied_at" in alert_data, "Alert data does not contain 'lastSatisfiedAt' key" 
#     assert "last_edited_by" in alert_data, "Alert data does not contain 'lastTriggeredAt' key"
   
# def test_update_workflow(create_session, base_url):
#     session = create_session
#     stream_name = "stream_pytest_data"
#     org = "org_pytest_data"

#     base_url = ZO_BASE_URL_SC
#     time.sleep(5)
    
#     # Get templates
#     templates = get_template(session, base_url, org)
    
#     # Extract template names
#     template_names = [template['name'] for template in templates if 'name' in template]
    
#     # Update templates using the names retrieved
#     if template_names:
#         template_name_webhook = template_names[0]  # Use the first template name for webhook
#         template_name_email = template_names[1] if len(template_names) > 1 else template_names[0]  # Use the second if it exists, otherwise fallback
        
#         update_template_webhook(session, base_url, org, template_name_webhook)
#         update_template_email(session, base_url, org, template_name_email)
    
#     time.sleep(5)
    
#     # Get destinations
#     destinations = get_destination(session, base_url, org)
    
#     # Extract destination names
#     destination_names = [destination['name'] for destination in destinations if 'name' in destination]
    
#     # Update destinations using the names retrieved
#     if destination_names:
#         destination_name_webhook = destination_names[0]
#         destination_name_email = destination_names[1] if len(destination_names) > 1 else destination_names[0]
        
#         update_destination_webhook(session, base_url, org, destination_name_webhook)
#         update_destination_email(session, base_url, org, destination_name_email)
    
#     time.sleep(5)

#     # Get alerts
#     alerts = get_alertsnew(session, base_url, org)
#     print("Alerts in the response", alerts)
    
#     # Assertions to ensure alerts are valid
#     assert alerts is not None, "Alerts are not found"
#     assert len(alerts) > 0, "Alerts are empty"
#     assert isinstance(alerts, list), "Alerts are not a list"
#     assert "alert_id" in alerts[0], "Alerts do not contain 'alert_id' key"
    
#     # Extract alert names and IDs
#     alert_names = [alert['name'] for alert in alerts if 'name' in alert]
#     alert_ids = [alert['alert_id'] for alert in alerts if 'alert_id' in alert]
    
#     # Assuming you want to update the first alert as an example
#     if alert_ids and alert_names:
#         alert_id = alert_ids[0]  # Use the first alert ID
#         alert_name_webhook = alert_names[0]  # Use the first alert name for webhook
#         alert_name_email = alert_names[1] if len(alert_names) > 1 else alert_names[0]  # Use the second if it exists, otherwise fallback
        
#         # Get alert details
#         alert_data = get_alert(session, base_url, org, alert_id)
#         print("Alert data in the response", alert_data)
        
#         time.sleep(5)
        
#         # Update alerts using the names and IDs retrieved
#         update_alert(session, base_url, org, alert_id, alert_name_webhook, template_name_webhook, stream_name, destination_name_webhook)
#         update_alert(session, base_url, org, alert_id, alert_name_email, template_name_email, stream_name, destination_name_email)
    
#     time.sleep(5)
