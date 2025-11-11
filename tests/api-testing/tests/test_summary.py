import os  # For environment variables
from requests.auth import HTTPBasicAuth
from datetime import datetime, timezone, timedelta  # For timestamp conversion
import time  # For sleep
from pathlib import Path  # For file paths
import pytest  # For fixtures
import random
import uuid
import string
import requests  # or your HTTP client of choice

# Constants for WebSocket URL and user credentials
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable

# Directory for test data
root_dir = Path(__file__).parent.parent.parent

def generate_random_string(length=5):
    """Generate a random string of lowercase letters."""
    characters = string.ascii_lowercase  # Only lowercase letters
    return ''.join(random.choice(characters) for _ in range(length))

# Generate a random stream name
random_string = generate_random_string()

stream_name = "tdef" + random_string
print("Random Stream:", stream_name)

@pytest.fixture(scope="module")
def org_id(create_session, base_url, random_string):
    """Create a new organization and return its identifier."""
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)

    org_id_new = random_string(5)
    print("Random Org ID:", org_id_new)

    payload = {
        "name": org_id_new
    }

    resp_create_organization = session.post(
        f"{base_url}api/organizations", json=payload
    )

    print(resp_create_organization.content)
    
    assert (
        resp_create_organization.status_code == 200
    ), f"Expected 200, but got {resp_create_organization.status_code} {resp_create_organization.content}"

    assert resp_create_organization.json().get("name") == org_id_new

    org_id = resp_create_organization.json().get("identifier")
    print("Org identifier:", org_id)

    yield org_id

    # Cleanup: Delete the organization after all tests are done
    resp_delete_organization = session.delete(
        f"{base_url}api/organizations/{org_id}"
    )
    print(f"Deleted organization {org_id}")

@pytest.mark.order(1)
def test_data(create_session, base_url, org_id):
    """Ingest data into the OpenObserve running instance."""
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)

    # Open the JSON data file and read it
    with open(root_dir / "test-data/logs_data.json") as f:
        data = f.read()

    url_ing = f"{base_url}api/{org_id}/{stream_name}/_json"

    print("Ingested URL", url_ing)  # Add this for debugging

    resp_ing = session.post(url_ing, data=data, headers={"Content-Type": "application/json"})

    print("Data ingested successfully for Summary, status code:", resp_ing.status_code)
    print("Response content:", resp_ing.text)  
    assert resp_ing.status_code == 200, f"Data ingestion failed, status code: {resp_ing.status_code}"

    # Wait for a few seconds to allow the data to be ingested
    time.sleep(5)  # Increase this time if necessary

    # Payload for pipeline creation
    pipeline_payload = {
        "name": "p12345",
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

    # Create a pipeline
    resp_create_pipeline = session.post(f"{base_url}api/{org_id}/pipelines", json=pipeline_payload)
    assert resp_create_pipeline.status_code == 200, f"Expected status code 200 but got {resp_create_pipeline.status_code}"
    print("Create pipeline response:", resp_create_pipeline.json())

    # Wait for a few seconds to allow the pipeline to be created
    time.sleep(5)  # Increase this time if necessary

    # Create new alert
    alert_name = f"newalert_{random.randint(1000, 9999)}"  # Make the name unique
    folder_alert = f"newfloder_{random.randint(1000, 9999)}"  # Make the name unique
    
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    # create folder
    url=base_url
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

    # Create logs
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

    time.sleep(5)  # Increase this time if necessary

    # Make the request to create function 
    payload_function = {
        "function": ".a=190025552",
        "name": "pytestfunction",
        "params": "row",
        "transType": 0,
    }
    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload_function
    )
    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 200
    ), f"Expected 200, but got {resp_create_function.status_code} {resp_create_function.content}"
    
    time.sleep(5)  # Increase this time if necessary

    # Make the request to create dashboard
    payload_dashboard = {
        "description": "pydashboards", 
        "title": "pytestdashboard",
        "owner": ZO_ROOT_USER_EMAIL,
    }
    resp_create_dashboard = session.post(
        f"{base_url}api/{org_id}/dashboards", json=payload_dashboard
    )
    print(resp_create_dashboard.content)
    assert (
        resp_create_dashboard.status_code == 200
    ), f"Expected 200, but got {resp_create_dashboard.status_code} {resp_create_dashboard.content}"
    print("Dashboard created successfully")

@pytest.fixture
def base_url_sc():
    """Provide the base URL for the API of Super Cluster."""
    return ZO_BASE_URL_SC

@pytest.mark.skip(reason="Skipped due to leftover resources from previous test runs causing failures. See MD Files/test_summary_failures.md for details.")
@pytest.mark.order(2)
def test_summary(create_session, base_url, base_url_sc, org_id):
    """Run an E2E test for summary mode."""
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)  # Add this line
    # Use base_url_sc if available, otherwise fall back to base_url
    url_sc = base_url_sc if base_url_sc is not None else base_url
    print("URL for super cluster:", url_sc) 
    time.sleep(5)  # Increase this time if necessary
    res_summary_sc = session.get(f"{url_sc}api/{org_id}/summary")
    print("Summary SC response:", res_summary_sc.content)  # Add this for debugging
    assert res_summary_sc.status_code == 200, f"Summary failed, status code: {res_summary_sc.status_code}"
    res_data_summary_sc = res_summary_sc.json()
    print("Summary SC data:", res_data_summary_sc)  # Add this for debugging

    # Validate the number of streams
    actual_num_streams_sc= res_data_summary_sc["streams"]["num_streams"]
    expected_num_streams_sc = 1  # Adjust based on our expectations
    assert actual_num_streams_sc == expected_num_streams_sc, f"Expected to be {expected_num_streams_sc}, but got {actual_num_streams_sc}"
 
    # Validate the number of pipelines
    pipelines_data_sc = res_data_summary_sc.get("pipelines", {})
    actual_num_pipelines_sc = pipelines_data_sc.get("num_realtime", 0)  # Default to 0 if not found
    expected_num_pipelines_sc = 1  # Adjust based on your expectations
    assert actual_num_pipelines_sc == expected_num_pipelines_sc, f"Expected to be {expected_num_pipelines_sc}, but got {actual_num_pipelines_sc}"
    
    # Validate the number of alerts
    alerts_data_sc = res_data_summary_sc.get("alerts", {})
    # Validate the number of scheduled alerts
    actual_num_scheduled_alerts_sc = alerts_data_sc.get("num_scheduled", 0)  # Default to 0 if not found
    expected_num_scheduled_alerts_sc = 1  # Adjust based on your expectations
    assert actual_num_scheduled_alerts_sc == expected_num_scheduled_alerts_sc, (
        f"Expected {expected_num_scheduled_alerts_sc} scheduled alerts, "
        f"but got {actual_num_scheduled_alerts_sc}"
    )

    # Validate the total number of functions
    actual_num_functions_sc = res_data_summary_sc.get("total_functions", 0)  # Directly get the value
    expected_num_functions_sc = 1  # Adjust based on your expectations
    assert actual_num_functions_sc == expected_num_functions_sc, (
    f"Expected total_functions to be {expected_num_functions_sc}, "
    f"but got {actual_num_functions_sc}"
    )

    # Validate the number of dashboards
    actual_num_dashboards_sc = res_data_summary_sc.get("total_dashboards", 0)  # Directly get the value
    expected_num_dashboards_sc = 1  # Adjust based on your expectations
    assert actual_num_dashboards_sc == expected_num_dashboards_sc, (
        f"Expected to be {expected_num_dashboards_sc}, but got {actual_num_dashboards_sc}"
    )

    # Retrieve the pipeline list (use base_url since it was created there)
    resp_list_pipelines = session.get(f"{base_url}api/{org_id}/pipelines")
    assert resp_list_pipelines.status_code == 200, f"Expected status code 200 but got {resp_list_pipelines.status_code}"

    # Parse the pipeline list response
    pipelines_list = resp_list_pipelines.json().get("list", [])
    assert pipelines_list, "No pipelines found in the list response."

    # Extract the pipeline_id for the created pipeline
    pipeline_id = None
    for pipeline in pipelines_list:
        if pipeline["name"] == "p12345":
            pipeline_id = pipeline["pipeline_id"]
            break

    assert pipeline_id, "Pipeline ID not found for the created pipeline."
    print(f"Pipeline ID: {pipeline_id}")
    resp_get_pipeline = session.get(f"{base_url}api/{org_id}/pipelines")
    print(resp_get_pipeline.json())
    assert resp_get_pipeline.status_code == 200
    pipeline_list = resp_get_pipeline.json()["list"]
    target_pipeline = next((p for p in pipeline_list if p["pipeline_id"] == pipeline_id), None)
    assert target_pipeline is not None, f"Pipeline {pipeline_id} not found in the list"

    # Delete the pipeline
    resp_delete_pipeline = session.delete(f"{base_url}api/{org_id}/pipelines/{pipeline_id}")
    assert resp_delete_pipeline.status_code == 200, f"Expected status code 200 but got {resp_delete_pipeline.status_code}"
    print(f"Deleted pipeline {pipeline_id}")

    # Make the request to get the list of alerts (use base_url since they were created there)
    resp_get_allalertsnew = session.get(f"{base_url}api/v2/{org_id}/alerts")
    # Ensure the response is successful
    assert resp_get_allalertsnew.status_code == 200, f"Failed to fetch alerts: {resp_get_allalertsnew.status_code}"
    # Parse the response JSON
    response_json = resp_get_allalertsnew.json()
    # Check if "list" is in the response and proceed
    assert "list" in response_json, "Response does not contain 'list'"
    # Get the list of alerts from the response
    alerts = response_json["list"]
    # Store destination and folder info before deleting alerts
    destinations_to_delete = set()
    folders_to_delete = set()
    # Now you can iterate over the alerts
    for alert in alerts:
        alert_id = alert.get("alert_id")
        assert alert_id, f"Alert ID is missing for alert: {alert}"
        print(f"Extracted alert_id: {alert_id}")
        # Store destinations and folder for cleanup
        if alert.get("destinations"):
            destinations_to_delete.update(alert["destinations"])
        if alert.get("folderId"):
            folders_to_delete.add(alert["folderId"])
            # Validate the alert existence first
        resp_check_alert = session.get(f"{base_url}api/v2/{org_id}/alerts/{alert_id}")
        assert resp_check_alert.status_code == 200, f"Alert {alert_id} does not exist or cannot be retrieved."
        print(f"Alert {alert_id} exists and is retrievable.")
            # Proceed to delete the alert
        resp_delete_alertnew = session.delete(f"{base_url}api/v2/{org_id}/alerts/{alert_id}")
        print(f"Deleted Alert Response: {resp_delete_alertnew.text}")
        assert resp_delete_alertnew.status_code == 200, f"Failed to delete alert {alert_id}"
        print(f"Successfully deleted alert {alert_id}")

    # Clean up alert destinations
    for destination_name in destinations_to_delete:
        resp_delete_dest = session.delete(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}")
        print(f"Deleted destination {destination_name}: {resp_delete_dest.status_code}")

    # Clean up alert templates (get list and delete all)
    resp_get_templates = session.get(f"{base_url}api/{org_id}/alerts/templates")
    if resp_get_templates.status_code == 200:
        templates_data = resp_get_templates.json()
        # Handle both list and dict response formats
        templates = templates_data if isinstance(templates_data, list) else templates_data.get("list", [])
        for template in templates:
            template_name = template.get("name")
            if template_name:
                resp_delete_template = session.delete(f"{base_url}api/{org_id}/alerts/templates/{template_name}")
                print(f"Deleted template {template_name}: {resp_delete_template.status_code}")

    # Clean up alert folders
    for folder_id in folders_to_delete:
        resp_delete_folder = session.delete(f"{base_url}api/v2/{org_id}/folders/{folder_id}")
        print(f"Deleted folder {folder_id}: {resp_delete_folder.status_code}")

    # Proceed to delete the function (use base_url since it was created there)
    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunction"
    )
    assert (
        resp_delete_function.status_code == 200
    ), f"Deleting this function, but got {resp_delete_function.status_code} {resp_delete_function.content}"
    print(f"Function deleted successfully")

    # Proceed to delete the dashboard (use base_url since it was created there)
    resp_get_alldashboards = session.get(f"{base_url}api/{org_id}/dashboards")
    assert resp_get_alldashboards.status_code == 200, f"Expected status code 200 but got {resp_get_alldashboards.status_code}"
    # Parse the response JSON
    dashboards_response = resp_get_alldashboards.json()
    print(f"Dashboard list response: {dashboards_response}")
    # Extract the dashboard ID - handle both v5 and v6 schemas
    dashboards = dashboards_response.get('dashboards', [])
    if dashboards:
        dashboard = dashboards[0]
        # Try v7 first, then v6, then v5
        dashboard_id = None
        if dashboard.get('v8'):
            dashboard_id = dashboard['v8']['dashboardId']
        elif dashboard.get('v6'):
            dashboard_id = dashboard['v6']['dashboardId']
        elif dashboard.get('v5'):
            dashboard_id = dashboard['v5']['dashboardId']
        else:
            raise AssertionError(f"Dashboard schema version not supported: {dashboard}")

        print(f"Extracted Dashboard ID: {dashboard_id}")
        # Now you can delete the dashboard using the extracted ID
        resp_delete_dashboard = session.delete(
            f"{base_url}api/{org_id}/dashboards/{dashboard_id}"
        )
        # Assert that the deletion was successful
        assert resp_delete_dashboard.status_code == 200, f"Failed to delete dashboard, status code: {resp_delete_dashboard.status_code}"
        print(f"Successfully deleted dashboard with ID: {dashboard_id}")
    else:
        print("No dashboards found to delete")

    # Wait for deletion to propagate
    time.sleep(3)

    # Proceed to delete the stream (use base_url since it was created there)
    resp_delete_stream= session.delete(f"{base_url}api/{org_id}/streams/{stream_name}?type=logs")
    print(f"Deleted Stream Response: {resp_delete_stream.text}")
    assert resp_delete_stream.status_code == 200, f"Failed to delete  {stream_name}"
    print(f"Successfully deleted stream {stream_name}")

@pytest.mark.skip(reason="Skipped due to dependency on test_summary. See MD Files/test_summary_failures.md for details.")
@pytest.mark.order(3)
def test_summary_validate(create_session, base_url, org_id):
    """Run an E2E test for summary mode."""
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)  # Add this line
    print("Base URL:", base_url) 
    time.sleep(5)  # Increase this time if necessary
    
    # Retrieve the pipeline list
    resp_list_pipelines = session.get(f"{base_url}api/{org_id}/pipelines")
    assert resp_list_pipelines.status_code == 200, f"Expected status code 200 but got {resp_list_pipelines.status_code}"   
    # Parse the pipeline list response
    pipelines_list = resp_list_pipelines.json().get("list", [])
    # Assert that the pipelines_list is either empty or contains elements
    if not pipelines_list:
        print("No pipelines found in the list response.")
    else:
        print(f"Found {len(pipelines_list)} pipelines.")

    # Make the request to get the list of alerts
    resp_get_allalertsnew = session.get(f"{base_url}api/v2/{org_id}/alerts")
    # Ensure the response is successful
    assert resp_get_allalertsnew.status_code == 200, f"Failed to fetch alerts: {resp_get_allalertsnew.status_code}"
    # Parse the response JSON
    response_json = resp_get_allalertsnew.json()
    # Check if "list" is in the response and proceed
    assert "list" in response_json, "Response does not contain 'list'"
    # Get the list of alerts from the response
    alerts = response_json["list"]
    # Check if the alerts list is empty
    if not alerts:
        print("No alerts found.")
    else:
        # Now you can iterate over the alerts
        for alert in alerts:
            alert_id = alert.get("alert_id")
            assert alert_id, f"Alert ID is missing for alert: {alert}"

            print(f"Extracted alert_id: {alert_id}")

    # Fetch the functions
    resp_ver_function = session.get(f"{base_url}api/{org_id}/functions")
    print(f"Function verification response: {resp_ver_function.status_code}, content: {resp_ver_function.content}")
    # Parse the response JSON
    response_json = resp_ver_function.json()
    # Assert that the status code indicates success
    assert resp_ver_function.status_code == 200, f"Expected status code 200 but got {resp_ver_function.status_code}"
    # Check if the "list" is present and assert that it's empty
    assert "list" in response_json, "Response does not contain 'list'"
    assert response_json["list"] == [], "Expected 'list' to be empty, but it contains elements."

    # Fetch the dashboards
    resp_ver_dashboard = session.get(f"{base_url}api/{org_id}/dashboards")
    print(f"Dashboard verification response: {resp_ver_dashboard.status_code}, content: {resp_ver_dashboard.content}")
    # Fetch the list of dashboards after deletion
    assert resp_ver_dashboard.status_code == 200, f"Expected status code 200 but got {resp_ver_dashboard.status_code}"
    # Parse the response JSON
    dashboards_response = resp_ver_dashboard.json()
    print(f"Dashboard list response: {dashboards_response}")
    # Assert that the dashboards list is empty
    assert 'dashboards' in dashboards_response, "Response does not contain 'dashboards'"
    assert dashboards_response['dashboards'] == [], "Expected the dashboards list to be empty after deletion."
    print("Successfully verified that the dashboard list is empty after deletion.")

    res_summary = session.get(f"{base_url}api/{org_id}/summary")
    print("Summary response:", res_summary.content)  # Add this for debugging
    assert res_summary.status_code == 200, f"Summary failed, status code: {res_summary.status_code}"
    res_data_summary = res_summary.json()
    print("Summary data:", res_data_summary)  # Add this for debugging

    # Validate the number of streams
    actual_num_streams= res_data_summary["streams"]["num_streams"]
    expected_num_streams = 0  # Adjust based on our expectations
    assert actual_num_streams == expected_num_streams, f"Expected to be {expected_num_streams}, but got {actual_num_streams}"
    print("Successfully verified that the number of streams is correct after deletion.")

    # Validate the number of pipelines
    pipelines_data = res_data_summary.get("pipelines", {})
    actual_num_pipelines = pipelines_data.get("num_realtime", 0)  # Default to 0 if not found
    expected_num_pipelines = 0  # Adjust based on your expectations
    assert actual_num_pipelines == expected_num_pipelines, f"Expected to be {expected_num_pipelines}, but got {actual_num_pipelines}"
    
    # Validate the number of alerts
    alerts_data = res_data_summary.get("alerts", {})
    # Validate the number of scheduled alerts
    actual_num_scheduled_alerts = alerts_data.get("num_scheduled", 0)  # Default to 0 if not found
    expected_num_scheduled_alerts = 0  # Adjust based on your expectations
    assert actual_num_scheduled_alerts == expected_num_scheduled_alerts, (
        f"Expected {expected_num_scheduled_alerts} scheduled alerts, "
        f"but got {actual_num_scheduled_alerts}"
    )

    # Validate the total number of functions
    actual_num_functions = res_data_summary.get("total_functions", 0)  # Directly get the value
    expected_num_functions = 0 # Adjust based on your expectations
    assert actual_num_functions == expected_num_functions, (
    f"Expected total_functions to be {expected_num_functions}, "
    f"but got {actual_num_functions}"
    )

    # Validate the number of dashboards
    actual_num_dashboards = res_data_summary.get("total_dashboards", 0)  # Directly get the value
    expected_num_dashboards = 0  # Adjust based on your expectations
    assert actual_num_dashboards == expected_num_dashboards, (
        f"Expected to be {expected_num_dashboards}, but got {actual_num_dashboards}"
    )  