import os
import pytest
import random
import uuid
from datetime import datetime
import json
from pathlib import Path
import base64
import requests
import io

# Constants for WebSocket URL and user credentials
ZO_BASE_URL = os.environ.get("ZO_BASE_URL")  # Use environment variable
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable

root_dir = Path(__file__).parent.parent.parent

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

def create_savedView(session, base_url, org_id, savedview_name, stream_name):
    """Create a saved view."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
            "organizationIdentifier": org_id,
            "runQuery": False,
            "loading": False,
            "loadingHistogram": False,
            "loadingCounter": False,
            "loadingStream": False,
            "loadingSavedView": False,
            "shouldIgnoreWatcher": False,
            "communicationMethod": "http",
            "config": {
                "splitterModel": 20,
                "lastSplitterPosition": 0,
                "splitterLimit": [0, 40],
                "fnSplitterModel": 60,
                "fnLastSplitterPosition": 0,
                "fnSplitterLimit": [40, 100],
                "refreshTimes": [
                    [{"label": "5 sec", "value": 5}, {"label": "1 min", "value": 60}, {"label": "1 hr", "value": 3600}],
                    [{"label": "10 sec", "value": 10}, {"label": "5 min", "value": 300}, {"label": "2 hr", "value": 7200}],
                    [{"label": "15 sec", "value": 15}, {"label": "15 min", "value": 900}, {"label": "1 day", "value": 86400}],
                    [{"label": "30 sec", "value": 30}, {"label": "30 min", "value": 1800}]
                ]
            },
            "meta": {
                # Include the rest of the meta fields as needed
                "logsVisualizeToggle": "logs",
                "refreshInterval": 0,
                "refreshIntervalLabel": "Off",
                "refreshHistogram": False,
                "showFields": True,
                "showQuery": True,
                "showHistogram": True,
                "showDetailTab": False,
                "toggleFunction": True,
                "searchApplied": True,
                "toggleSourceWrap": False,
                "histogramDirtyFlag": False,
                "sqlMode": True,
                "quickMode": False,
                "queryEditorPlaceholderFlag": True,
                "functionEditorPlaceholderFlag": True,
                "resultGrid": {
                    "rowsPerPage": 50,
                    "wrapCells": False,
                    "manualRemoveFields": False,
                    "chartInterval": "30 second",
                    "chartKeyFormat": "HH:mm:ss",
                    "navigation": {"currentRowIndex": 0},
                    "showPagination": True
                },
                "jobId": "",
                "jobRecords": "100",
                "pageType": "logs",
                "regions": [],
                "clusters": [],
                "useUserDefinedSchemas": "user_defined_schema",
                "hasUserDefinedSchemas": False,
                "selectedTraceStream": "",
                "showSearchScheduler": False
            },
            "data": {
                "query": f"SELECT * FROM \"{stream_name}\"",
                # Add the rest of the data fields as needed
            },
            "view_name": savedview_name
        }
    
    response = session.post(f"{base_url}api/{org_id}/savedviews", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create saved view: {response.content}"
    return response

def create_folder(session, base_url, org_id, folder_name):
    """Create a folder."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "description": folder_name,
        "folderId": "",
        "name": folder_name
    }

    response = session.post(f"{base_url}api/{org_id}/folders", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create folder: {response.content}"
    folder_id = response.json()["folderId"]
    return folder_id

def create_dashboard(session, base_url, org_id, dashboard_name, folder_id):
    """Create a dashboard."""
    headers = {
        "Content-Type": "application/json", 
        "Custom-Header": "value"
    }
    # created_time = datetime.now().isoformat()   
    payload = {
        "title": dashboard_name,
        "dashboardId": "",
        "description": "",
        "variables": {
            "list": [],
            "showDynamicFilters": True
        },
        "defaultDatetimeDuration": {
            "startTime": None,
            "endTime": None,
            "relativeTimePeriod": "15m",
            "type": "relative"
        },
        "role": "",
        "owner": ZO_ROOT_USER_EMAIL,
    #    "created": created_time + "Z",  # Append "Z" to indicate UTC
        "tabs": [
            {
                "panels": [],
                "name": "Default",
                "tabId": "default"
            }
        ],
        "version": 3
    }
    
    # print("Payload:", json.dumps(payload, indent=2))
    # print("Headers:", headers)

    response = session.post(f"{base_url}api/{org_id}/dashboards?folder={folder_id}", json=payload, headers=headers)
    
    # Improved error handling
    assert response.status_code == 200, f"Failed to create dashboard: {response.content.decode()}"
    # Extract the dashboardId from the correct location in the response
    dashboard_id = response.json()["v3"]["dashboardId"]
    return dashboard_id

def create_function(session, base_url, org_id, function_name):
    """Create a dashboard."""
    headers = {
        "Content-Type": "application/json", 
        "Custom-Header": "value"
    }
    # created_time = datetime.now().isoformat()   
    payload = {
        "function": ".a=190025552",
        "name": function_name,
        "params": "row",
        "transType": 0,
    }
    response = session.post(f"{base_url}api/{org_id}/functions", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create function: {response.content.decode()}"
    return response


# Define the boundary as a constant
BOUNDARY = "----WebKitFormBoundaryaQgmYHuE6dQrlLss"

def create_multipart_data(fields, boundary):
    """Create multipart form data with a specified boundary."""
    boundary_str = f"--{boundary}"
    lines = []

    # Add the fields to the multipart data
    for key, value in fields.items():
        if isinstance(value, tuple):
            # This is the file field
            filename, file_obj, content_type = value
            lines.append(f"{boundary_str}")
            lines.append(f'Content-Disposition: form-data; name="{key}"; filename="{filename}"')
            lines.append(f'Content-Type: {content_type}')
            lines.append("")
            # Read the file content as binary
            lines.append(file_obj.read())  # Read as binary data
        else:
            # Regular fields
            lines.append(f"{boundary_str}")
            lines.append(f'Content-Disposition: form-data; name="{key}"')
            lines.append("")
            lines.append(value)

    # End the multipart data
    lines.append(f"{boundary_str}--")
    
    return b"\r\n".join(line.encode('utf-8') if isinstance(line, str) else line for line in lines)



def create_enrichment_table(session, base_url, org_id, enrichment_table_name):
    """Create an enrichment table."""
    # Define headers
    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': f'multipart/form-data; boundary={BOUNDARY}',
        'Pragma': 'no-cache',
        'Custom-Header': 'value'
    }

    # Define cookies
    cookies = {
        'auth_ext': '{"auth_ext":"","refresh_token":"","request_time":0,"expires_in":0}',
        'auth_tokens': f'{{"access_token":"Basic {base64.b64encode((ZO_ROOT_USER_EMAIL + ":" + ZO_ROOT_USER_PASSWORD).encode()).decode()}","refresh_token":""}}'
        }

    # Open the json data file and read it
    with open(root_dir / "test-data/protocols.csv") as f:
        data = f.read()

    # Prepare the fields for multipart data
    with open(root_dir / "test-data/protocols.csv", 'rb') as file_obj:
        file_content = file_obj.read()  # Read the content into memory
        file_like_object = io.BytesIO(file_content)  # Create an in-memory file-like object

    fields = {
        'file': ('protocols.csv', file_like_object, 'text/csv')  # Pass the in-memory object
    }
    
    # Now call your function that uses fields
    multipart_data = create_multipart_data(fields, BOUNDARY)

    url = f"{base_url}api/{org_id}/enrichment_tables/{enrichment_table_name}?append=false"

    # Make the POST request
    response = session.post(url, headers=headers, cookies=cookies, data=multipart_data)

    # Check the response
    assert response.status_code == 200, f"Failed to enrich table: {response.content.decode()}"
    # print("Response:", response.json())  # Print the response for debugging

    return response

def create_realTime_pipeline(session, base_url, org_id, realTime_pipeline_name, stream_name):
    """Create a realTime pipeline."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "name": realTime_pipeline_name,
        "description": "",
        "source": {"source_type": "realtime"},
        "nodes": [
            {
                "id": "1e1fa129-cfbd-4082-8d39-c4dc418a670f",
                "type": "input",
                "data": {
                    "node_type": "stream",
                    "stream_name": stream_name,
                    "stream_type": "logs",
                    "org_id": org_id,
                },
                "position": {"x": 169.83333, "y": 55},
                "io_type": "input",
            },
            {
                "id": "8e0ed123-7737-4801-9466-bd909c425c72",
                "type": "output",
                "data": {
                    "node_type": "stream",
                    "stream_name": stream_name,
                    "stream_type": "logs",
                    "org_id": org_id,
                },
                "position": {"x": 305.33334, "y": 276},
                "io_type": "output",
            },
        ],
        "edges": [
            {
                "id": "e1e1fa129-cfbd-4082-8d39-c4dc418a670f-8e0ed123-7737-4801-9466-bd909c425c72",
                "source": "1e1fa129-cfbd-4082-8d39-c4dc418a670f",
                "target": "8e0ed123-7737-4801-9466-bd909c425c72",
            }
        ],
        "org": org_id,
    }
    
    response = session.post(f"{base_url}api/{org_id}/pipelines", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create scheduled pipeline: {response.content.decode()}"
    return response
    
        
def create_scheduled_pipeline(session, base_url, org_id, scheduled_pipeline_name, stream_name):
    """Create a scheduled pipeline."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "name": scheduled_pipeline_name,
        "description": "",
        "source": {"source_type": "scheduled"},
        "nodes": [
            {
                "id": "8b03771c-2e94-4c2f-b902-8fb8b8e66df2",
                "type": "input",
                "dimensions": {"width": 140, "height": 42},
                "computedPosition": {"x": 212.1047849020086, "y": 93.00563781047852, "z": 0},
                "handleBounds": {
                    "source": [{"id": "output", "position": "bottom", "x": 55.03916432328342, "y": 36.00006521998462, "width": 30, "height": 10}],
                    "target": []
                },
                "position": {"x": 212.1047849020086, "y": 93.00563781047852},
                "data": {
                    "label": "8b03771c-2e94-4c2f-b902-8fb8b8e66df2",
                    "node_type": "query",
                    "stream_type": "logs",
                    "org_id": org_id,
                    "query_condition": {
                        "type": "sql",
                        "conditions": None,
                        "sql": "select * from default",
                        "promql": None,
                        "promql_condition": None,
                        "aggregation": None,
                        "vrl_function": None,
                        "search_event_type": "DerivedStream"
                    },
                    "trigger_condition": {
                        "period": 15,
                        "operator": "=",
                        "threshold": 0,
                        "frequency": 15,
                        "cron": "",
                        "frequency_type": "minutes",
                        "silence": 0
                    }
                },
                "io_type": "input"
            },
            {
                "id": "cfa476a0-24f3-4ca3-a14f-b56b04729922",
                "type": "output",
                "dimensions": {"width": 250, "height": 42},
                "computedPosition": {"x": 269.2781219770897, "y": 161.6932759313432, "z": 0},
                "handleBounds": {
                    "source": [],
                    "target": [{"id": "input", "position": "top", "x": 110.11741720560622, "y": -4.000002219844093, "width": 30, "height": 10}]
                },
                "position": {"x": 269.2781219770897, "y": 161.6932759313432},
                "data": {
                    "label": "cfa476a0-24f3-4ca3-a14f-b56b04729922",
                    "node_type": "stream",
                    "stream_type": "logs",
                    "stream_name": stream_name,
                    "org_id": org_id
                },
                "io_type": "output"
            }
        ],
        "edges": [
            {
                "id": "e8b03771c-2e94-4c2f-b902-8fb8b8e66df2-cfa476a0-24f3-4ca3-a14f-b56b04729922",
                "type": "custom",
                "source": "8b03771c-2e94-4c2f-b902-8fb8b8e66df2",
                "target": "cfa476a0-24f3-4ca3-a14f-b56b04729922",
                "data": {},
                "markerEnd": {"type": "arrowclosed", "width": 20, "height": 20},
                "style": {"strokeWidth": 2},
                "animated": True
            }
        ],
        "org": org_id,
        "schedule": {
            "enabled": True,
            "frequency": "daily",  # Example frequency, adjust as needed
            "time": "02:00",       # Example time, adjust as needed
        }
    }

    response = session.post(f"{base_url}api/{org_id}/pipelines", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create scheduled pipeline: {response.content.decode()}"
    return response

def create_scheduled_report(session, base_url, org_id, scheduled_report_name, dashboard_id, folder_id):
    """Create a scheduled report."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
    "dashboards": [
        {
            "folder": folder_id,                        
            "dashboard": dashboard_id,
            "tabs": ["default"],
            "variables": [],
            "timerange": {
                "type": "relative",
                "period": "30m",
                "from": 1741687525799000,
                "to": 1741689325799000
            }
        }
    ],
    "description": "",
    "destinations": [
        {
            "email": ZO_ROOT_USER_EMAIL
        }
    ],
    "enabled": True,
    "media_type": "Pdf",
    "name": scheduled_report_name,
    "title": scheduled_report_name,
    "message": "hi",
    "orgId": org_id,
    "start": 1741689360000000,
    "frequency": {
        "interval": 1,
        "type": "once",
        "cron": ""
    },
    "user": "",
    "password": "",
    "timezone": "Asia/Calcutta",
    "timezoneOffset": 330,
    "owner": ZO_ROOT_USER_EMAIL,
    "lastEditedBy": ZO_ROOT_USER_EMAIL,
    "report_type": "PDF"
}

    response = session.post(f"{base_url}api/{org_id}/reports", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create scheduled report: {response.content.decode()}"
    return response

def create_cached_report(session, base_url, org_id, cached_report_name, dashboard_id, folder_id):
    """Create a cached report."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
    "dashboards": [
        {
            "folder": folder_id,
            "dashboard": dashboard_id,
            "tabs": ["default"],
            "variables": [],
            "timerange": {
                "type": "relative",
                "period": "30m",
                "from": 1741687525799000,
                "to": 1741689325799000
            }
        }
    ],
    "description": "",
    "destinations": [
        
    ],
    "enabled": True,
    "media_type": "Pdf",
    "name": cached_report_name,
    "title": cached_report_name,
    "message": "hi",
    "orgId": org_id,
    "start": 1741689360000000,
    "frequency": {
        "interval": 1,
        "type": "once",
        "cron": ""
    },
    "user": "",
    "password": "",
    "timezone": "Asia/Calcutta",
    "timezoneOffset": 330,
    "owner": ZO_ROOT_USER_EMAIL,
    "lastEditedBy": ZO_ROOT_USER_EMAIL,
    "report_type": "PDF"
}

    response = session.post(f"{base_url}api/{org_id}/reports", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create cached report: {response.content.decode()}"
    return response

def create_user(session, base_url, org_id, email_address):
    """Create a cached report."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "organization": org_id,
        "email": email_address,
        "password": "12345678",
        "first_name": "Shyam",
        "last_name": "P",
        "role": "admin",
    }

    response = session.post(f"{base_url}api/{org_id}/users", json=payload, headers=headers)


    assert (
        response.status_code == 200
    ), f"Creating a user 200, but got {response.status_code} {response.content}"

def test_create_workflow(create_session, base_url):
    session = create_session
    base_url = ZO_BASE_URL
    org_id = "org_pytest_data"
    stream_name = "stream_pytest_data"

    

   # Loop to create 500 templates, destinations, and alerts
    for i in range(2):
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

        savedview_name = f"savedview_{i + 1}_{random.randint(100000, 999999)}"      
        create_savedView(session, base_url, org_id, savedview_name, stream_name)

        folder_name = f"folder_{i + 1}_{random.randint(100000, 999999)}"
        folder_id = create_folder(session, base_url, org_id, folder_name)

        dashboard_name = f"dashboard_{i + 1}_{random.randint(100000, 999999)}"
        dashboard_id = create_dashboard(session, base_url, org_id, dashboard_name, folder_id)

        function_name = f"function_{i + 1}_{random.randint(100000, 999999)}"
        create_function(session, base_url, org_id, function_name)   

        enrichment_table_name = f"enrichment_{i + 1}_{random.randint(100000, 999999)}"
        create_enrichment_table(session, base_url, org_id, enrichment_table_name)

        realTime_pipeline_name = f"realTime_pipeline_{i + 1}_{random.randint(100000, 999999)}"
        create_realTime_pipeline(session, base_url, org_id, realTime_pipeline_name, stream_name)  

        scheduled_pipeline_name = f"scheduled_pipeline_{i + 1}_{random.randint(100000, 999999)}"
        create_scheduled_pipeline(session, base_url, org_id, scheduled_pipeline_name, stream_name)    

        scheduled_report_name = f"scheduled_report_{i + 1}_{random.randint(100000, 999999)}"
        create_scheduled_report(session, base_url, org_id, scheduled_report_name, dashboard_id, folder_id)  

        cached_report_name = f"cached_report_{i + 1}_{random.randint(100000, 999999)}"
        create_cached_report(session, base_url, org_id, cached_report_name, dashboard_id, folder_id)  

        email_address = f"user_email_{i + 1}_{random.randint(100000, 999999)}@gmail.com"
        create_user(session, base_url, org_id, email_address)



        # Ingest logs
        ingest_logs(session, base_url, org_id, stream_name)
    