import os
import pytest
import random
import uuid

# Constants for WebSocket URL and user credentials
ZO_BASE_URL = os.environ.get("ZO_BASE_URL")  # Use environment variable
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable

 
def create_template_webhook(session, base_url, org_id, template_name):
    """Create a Webhook template."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "name": template_name,
        "body": '{\n  \"text\": \"{alert_name} is active\"\n}',
        "type": "http",
        "title": ""
    }      
    response = session.post(f"{base_url}api/{org_id}/alerts/templates", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create template: {response.content}"
    return response

def create_template_email(session, base_url, org_id, template_name):
    """Create an Email template."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "name": template_name,
        "body": '{"text": "For stream {stream_name} of organization {org} alert {alert_name} of type {alert_type} is active"}',
        "type": "email",
        "title": "email_title"
    }      
    response = session.post(f"{base_url}api/{org_id}/alerts/templates", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create template: {response.content}"
    return response 

def validate_template(session, base_url, org_id, template_name):
    """Validate a template."""
    response = session.get(f"{base_url}api/{org_id}/alerts/templates")
    assert response.status_code == 200, f"Failed to validate template: {response.content}"
    templates = response.json()     
    assert len(templates) > 0, "No templates found"
    for template in templates:
        assert template["name"] == template_name, f"Template name {template['name']} does not match {template_name}"
    return templates



def delete_template(session, base_url, org_id, template_name):
    """Delete a template."""
    response = session.delete(f"{base_url}api/{org_id}/alerts/templates/{template_name}")
    assert response.status_code == 200, f"Failed to delete template: {response.content}"
    return response



def create_destination_webhook(session, base_url, org_id, template_name, destination_name):
    """Create a destination."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    skip_tls_verify_value = False  # Define the skip_tls_verify_value
    payload = {
        "url": "https://jsonplaceholder.typicode.com/todos",
        "method": "get",
        "template": template_name,  
        "headers": {},  # Ensure this is formatted correctly
        "name": destination_name,
        "skip_tls_verify": skip_tls_verify_value
    }
    response = session.post(f"{base_url}api/{org_id}/alerts/destinations", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create destination: {response.content}"
    return response

def create_destination_email(session, base_url, org_id, template_email, destination_name, email_address):
    """Create a destination."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    skip_tls_verify_value = False  # Define the skip_tls_verify_value
    payload = {
        "url": "",
        "type": "email",
        "emails": [email_address],
        "method": "post",
        "template": template_email,
        "headers": {},
        "name": destination_name,
        "skip_tls_verify": skip_tls_verify_value
    }
    response = session.post(f"{base_url}api/{org_id}/alerts/destinations", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create destination: {response.content}"
    return response 

def create_destination_pipeline(session, base_url, org_id, destination_name):
    """Create a destination."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    skip_tls_verify_value = False  # Define the skip_tls_verify_value
    payload = {
        "url": "https://jsonplaceholder.typicode.com/todos",
        "method": "get",
        "template": "",  
        "headers": {},  # Ensure this is formatted correctly
        "name": destination_name,
        "skip_tls_verify": skip_tls_verify_value
    }
    response = session.post(f"{base_url}api/{org_id}/alerts/destinations", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create destination: {response.content}"
    return response

def validate_destination(session, base_url, org_id, destination_name):
    """Validate a destination."""
    response = session.get(f"{base_url}api/{org_id}/alerts/destinations")
    assert response.status_code == 200, f"Failed to validate destination: {response.content}"
    destinations = response.json()
    assert len(destinations) > 0, "No destinations found"
    for destination in destinations:
        assert destination["name"] == destination_name, f"Destination name {destination['name']} does not match {destination_name}"
    return destinations 

def delete_destination(session, base_url, org_id, destination_name):
    """Delete a destination."""
    response = session.delete(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}")
    assert response.status_code == 200, f"Failed to delete destination: {response.content}"
    return response

def create_standard_alert(session, base_url, org_id, alert_name, template_name, stream_name, destination_name):
    
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
    "org_id": org_id,
    "destinations": [destination_name],
    "enabled": True,
    "description": "test"
 }

    response = session.post(f"{base_url}api/{org_id}/{stream_name}/alerts?type=logs", json=payload)
    if response.status_code == 409:
        # Handle alert already exists scenario
        print(f"Alert already exists: {payload['name']}.")
        return False  # Indicate that creation failed due to existing alert
    assert response.status_code == 200, f"Failed to create alert: {response.content}"
    return True  # Indicate successful creation

def create_standard_alert_sql(session, base_url, org_id, alert_name, template_name, stream_name, destination_name):
    
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
        "sql": f"select log from \"{stream_name}\" where log = 200",
        "promql": "",
        "type": "sql",
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
    "org_id": org_id,
    "destinations": [destination_name],
    "enabled": True,
    "description": "test"
 }

    response = session.post(f"{base_url}api/{org_id}/{stream_name}/alerts?type=logs", json=payload)
    if response.status_code == 409:
        # Handle alert already exists scenario
        print(f"Alert already exists: {payload['name']}.")
        return False  # Indicate that creation failed due to existing alert
    assert response.status_code == 200, f"Failed to create alert: {response.content}"
    return True  # Indicate successful creation

def create_real_time_alert(session, base_url, org_id, alert_name, template_name, stream_name, destination_name):
    
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
  
    payload = {
    "name": alert_name,
    "row_template": template_name,
    "stream_type": "logs",
    "stream_name": stream_name,
    "is_real_time": True,
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
    "org_id": org_id,
    "destinations": [destination_name],
    "enabled": True,
    "description": "test"
 }

    response = session.post(f"{base_url}api/{org_id}/{stream_name}/alerts?type=logs", json=payload)
    if response.status_code == 409:
        # Handle alert already exists scenario
        print(f"Alert already exists: {payload['name']}.")
        return False  # Indicate that creation failed due to existing alert
    assert response.status_code == 200, f"Failed to create alert: {response.content}"
    return True  # Indicate successful creation


def create_standard_alert_cron(session, base_url, org_id, alert_name, template_name, stream_name, destination_name):
    
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
        "cron": "1 40 * * * *",
        "threshold": 3,
        "silence": 10,
        "frequency_type": "cron",
        "timezone": "UTC",
        "tz_offset": 0
    },
    "org_id": org_id,
    "destinations": [destination_name],
    "enabled": True,
    "description": "test"
 }

    response = session.post(f"{base_url}api/{org_id}/{stream_name}/alerts?type=logs", json=payload)
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

def validate_alert(session, base_url, org_id, alert_name, stream_name):
    """Get an alert."""
    response = session.get(f"{base_url}api/{org_id}/{stream_name}/alerts/{alert_name}")
    assert response.status_code == 200, f"Failed to get alert: {response.content}"
    return response



def ingest_logs(session, base_url, org_id, stream_name):
    """Ingest logs."""
    payload = [
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
    response = session.post(f"{base_url}api/{org_id}/{stream_name}/_json", json=payload)
    assert response.status_code == 200, f"Failed to ingest logs: {response.content}"
    return response




def test_create_workflow_old(create_session, base_url):
    session = create_session
    base_url = ZO_BASE_URL
    org_id = "org_pytest_data"
    stream_name = "stream_pytest_data"

    

   # Loop to create 500 templates, destinations, and alerts
    for i in range(5):
        # Create unique template names
        template_name_webhook = f"template_webhook_{i + 1}_{random.randint(100000, 999999)}"
        template_name_email = f"template_email_{i + 1}_{random.randint(100000, 999999)}"

        # Create templates
        create_template_webhook(session, base_url, org_id, template_name_webhook)
        create_template_email(session, base_url, org_id, template_name_email)

        # Create unique destination names
        destination_name_webhook = f"destination_webhook_{i + 1}_{random.randint(100000, 999999)}"
        destination_name_email = f"destination_email_{i + 1}_{random.randint(100000, 999999)}"
        destination_name_pipeline = f"destination_pipeline_{i + 1}_{random.randint(100000, 999999)}"

        # Create destinations
        create_destination_webhook(session, base_url, org_id, template_name_webhook, destination_name_webhook)
        create_destination_email(session, base_url, org_id, template_name_email, destination_name_email, ZO_ROOT_USER_EMAIL)
        create_destination_pipeline(session, base_url, org_id, destination_name_pipeline)

        # Create alerts with unique names
        alert_webhook = f"alert_webhook_{i + 1}_{random.randint(100000, 999999)}"
        alert_webhook_created = create_standard_alert(session, base_url, org_id, alert_webhook, template_name_webhook, stream_name, destination_name_webhook)

        alert_email = f"alert_email_{i + 1}_{random.randint(100000, 999999)}"
        alert_email_created = create_standard_alert(session, base_url, org_id, alert_email, template_name_email, stream_name, destination_name_email)

        alert_cron = f"alert_cron_{i + 1}_{random.randint(100000, 999999)}"
        alert_cron_created = create_standard_alert_cron(session, base_url, org_id, alert_cron, template_name_email, stream_name, destination_name_email)

        alert_real_time = f"alert_real_time_{i + 1}_{random.randint(100000, 999999)}"
        alert_real_time_created = create_real_time_alert(session, base_url, org_id, alert_real_time, template_name_email, stream_name, destination_name_email)

        alert_sql = f"alert_sql_{i + 1}_{random.randint(100000, 999999)}"
        alert_sql_created = create_standard_alert_sql(session, base_url, org_id, alert_sql, template_name_email, stream_name, destination_name_email)

        # Optionally print or log the created names for tracking
        print(f"Created: {template_name_webhook}, {template_name_email}, {destination_name_webhook}, {destination_name_email}, {destination_name_pipeline}, {alert_webhook}, {alert_email}, {alert_cron}, {alert_real_time}, {alert_sql}")

    # Ingest logs
    
   
    ingest_logs(session, base_url, org_id, stream_name)

# def test_validate_workflow(create_session, base_url):
#     session = create_session
#     base_url = ZO_BASE_URL
#     org_id = "org_pytest_data"
#     stream_name = "stream_pytest_data"


    # # If alert creation failed due to existing alert, you can choose to skip the rest of the test or handle it
    # if not alert_created:
    #     print(f"Skipping further tests for alert: {alert_name}")
    #     return

    # # Assert alert creation in the first server
    # get_alert(session, base_url, org_id, alert_name, stream_name)

    # # Assert alert creation in the second server
    # session.base_url = ZO_BASE_URL_SC
    # get_alert(session, base_url, org_id, alert_name, stream_name)

    # # Update alert in the second server
    # session.base_url = ZO_BASE_URL_SC
    # update_payload = {
    #     "name": alert_name,
    #     "stream_type": "logs",
    #     "stream_name": stream_name,
    #     "query_condition": {"type": "sql", "sql": "SELECT * FROM newpy_tests WHERE condition"},
    #     "trigger_condition": {"period": 10, "operator": ">=", "threshold": 5, "silence": 10},
    #     "destinations": [destination_name],
    #     "enabled": True
    # }
    # create_alert(session, session.base_url, org_id, stream_name, update_payload)


    # # Assert updated alert in the second server
    # get_alert(session, session.base_url, org_id, alert_name, stream_name)

    # # # Delete alert in the first server
    # # delete_alert(session, base_url, org_id, alert_name, stream_name)

    # # # Assert deletion in the first server
    # # with pytest.raises(AssertionError):
    # #     get_alert(session, base_url, org_id, alert_name, stream_name)

    # # # Delete alert in the second server
    # # delete_alert(session, session.base_url, org_id, alert_name, stream_name)

    # # # Assert deletion in the second server
    # # with pytest.raises(AssertionError):
    # #     get_alert(session, session.base_url, org_id, alert_name, stream_name)

    # # # Clean up: Delete destination and template
    # # delete_destination(session, base_url, org_id, destination_name)
    # # delete_template(session, base_url, org_id, template_name)
