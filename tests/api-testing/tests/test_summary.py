import os  # For environment variables
from requests.auth import HTTPBasicAuth
import json  # For JSON parsing
import base64  # For encoding user credentials
from datetime import datetime, timezone, timedelta  # For timestamp conversion
import time  # For sleep
from pathlib import Path  # For file paths
import uuid  # For generating UUIDs
import pytest  # For fixtures
import random
import string

# Constants for WebSocket URL and user credentials
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable

# Organization ID
org_id = "default"

# Directory for test data
root_dir = Path(__file__).parent.parent.parent

def generate_random_string(length=5):
    """Generate a random string of lowercase letters."""
    characters = string.ascii_lowercase  # Only lowercase letters
    return ''.join(random.choice(characters) for _ in range(length))

# Generate a random stream name
random_string = generate_random_string()
# Organization ID
org_id = random_string
stream_name = "tdef" + random_string
print("Random Stream:", stream_name)

import requests  # or your HTTP client of choice

@pytest.fixture
def create_session():
    """Create a session for API requests."""
    session = requests.Session()  # Create a new session
    # Optionally, set up any headers or authentication here
    yield session  # This will make the session available to tests
    session.close()  # Clean up after tests


# @pytest.fixture
# def base_url():
#     """Provide the base URL for the API."""
#     return ZO_BASE_URL_SC

def test_ingest_data(create_session, base_url):
    """Ingest data into the OpenObserve running instance."""
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)

    # Open the JSON data file and read it
    with open(root_dir / "test-data/logs_data.json") as f:
        data = f.read()

    url_ing = f"{base_url}api/{org_id}/{stream_name}/_json"
    resp_ing = session.post(url_ing, data=data, headers={"Content-Type": "application/json"})

    print("Data ingested successfully for Summary, status code:", resp_ing.status_code)
    print("Response content:", resp_ing.text)  # Add this for debugging
    assert resp_ing.status_code == 200, f"Data ingestion failed, status code: {resp_ing.status_code}"

def test_disable_websocket(create_session, base_url):
    """Disable WebSocket ingestion for the instance."""
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)

    url = base_url
    payload_disable_webs = {
        "scrape_interval": 15,
        "span_id_field_name": "span_id",
        "trace_id_field_name": "trace_id",
        "toggle_ingestion_logs": True,
        "enable_websocket_search": False
    }

    resp_disable_webs = session.post(f"{url}api/{org_id}/settings", json=payload_disable_webs)

    print("Disable Websocket response:", resp_disable_webs.content) 
     # Add this for debugging
    assert resp_disable_webs.status_code == 200, f"WebSocket disable failed, status code: {resp_disable_webs.status_code}"


@pytest.fixture
def base_url():
    """Provide the base URL for the API."""
    return ZO_BASE_URL_SC

def test_summary(create_session, base_url):
    """Run an E2E test for summary mode."""
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)  # Add this line

    url = base_url

    print("URL for super cluster:", url) 
    time.sleep(5)  # Increase this time if necessary

    res_summary = session.get(f"{url}api/{org_id}/summary")

    print("Summary response:", res_summary.content)  # Add this for debugging
    assert res_summary.status_code == 200, f"Summary failed, status code: {res_summary.status_code}"

    res_data_summary = res_summary.json()

    # Validate the number of streams
    actual_num_streams= res_data_summary["streams"]["num_streams"]
    expected_num_streams = 1  # Adjust based on our expectations

    assert actual_num_streams == expected_num_streams, f"Expected to be {expected_num_streams}, but got {actual_num_streams}"

    