import os  
import pytest
import requests
import websocket
import json
import base64
from datetime import datetime, timezone, timedelta
import time
from pathlib import Path
import uuid


# Constants for WebSocket URL and user credentials

WS_ZO_BASE_URL = os.environ.get("WS_ZO_BASE_URL")
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable
now = datetime.now(timezone.utc)
end_time = int(now.timestamp() * 1000000)
one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
org_id = "default"
stream_name = "default"


root_dir = Path(__file__).parent.parent.parent

@pytest.fixture
def ingest_data(create_session, base_url):
    """Ingest data into the openobserve running instance."""

    session = create_session
    # Open the json data file and read it
    with open(root_dir / "test-data/logs_data.json") as f:
        data = f.read()

    
    url_Ing = f"{base_url}api/{org_id}/{stream_name}/_json"
    resp_ing = session.post(url_Ing, data=data, headers={"Content-Type": "application/json"})
    print("Data ingested successfully for websocket, status code: ", resp_ing.status_code)
    return resp_ing.status_code == 200

@pytest.fixture
def cookies(create_session, base_url):
    """Fixture to enable WebSocket and return cookies."""
    session = create_session
    url = base_url
    payload_websocket = {
        "scrape_interval": 15,
        "span_id_field_name": "span_id",
        "trace_id_field_name": "trace_id",
        "toggle_ingestion_logs": True,
        "enable_websocket_search": True
    }

    print("Session headers:", session.headers)

    resp_websocket = session.post(f"{url}api/{org_id}/settings", json=payload_websocket)

    print(resp_websocket.content)
    assert (
        resp_websocket.status_code == 200
    ), f"Websocket enable 200, but got {resp_websocket.status_code} {resp_websocket.content}"
    print("Websocket enable 200", resp_websocket.cookies)
    return resp_websocket.cookies  # Return cookies for the next request

def test_websocket_connection(cookies):
    """Test WebSocket connection."""
    # Prepare headers with cookies
    cookie_header = f"auth_ext={{\"auth_ext\":\"\",\"refresh_token\":\"\",\"request_time\":0,\"expires_in\":0}}; " \
                    f"auth_tokens={{\"access_token\":\"Basic {base64.b64encode((ZO_ROOT_USER_EMAIL + ':' + ZO_ROOT_USER_PASSWORD).encode()).decode()}\",\"refresh_token\":\"\"}}; " \
                    f"_ga=GA1.1.1388396574.1737697562; _ga_89WN60ZK2E=GS1.1.1738658735.34.1.1738659900.0.0.0"


    # Generate a dynamic UUID
    dynamic_uuid = str(uuid.uuid4())  # Generates a new UUID

    # Construct the WebSocket URL
    WS_URL = f"{WS_ZO_BASE_URL}api/{org_id}/ws/{dynamic_uuid}"

    # Example of using the WS_URL
    print("WebSocket URL:", WS_URL)

    # Now you can use WS_URL in your WebSocket connection

    ws = websocket.create_connection(WS_URL, header={"Cookie": cookie_header})

    print("WebSocket connection established")

    # Generate a dynamic trace_id
    dynamic_trace_id = str(uuid.uuid4())

    # Prepare the message to send
    message = {
        "type": "search",
        "content": {
            "trace_id": dynamic_trace_id,  # Use dynamic trace_id
            "payload": {
                "query": {
                    "sql": "SELECT histogram(_timestamp, '10 second') AS \"zo_sql_key\", COUNT(*) AS \"zo_sql_num\" FROM \"default\" GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
                    "start_time": one_min_ago,
                    "end_time": end_time,
                    "size": -1,
                    "sql_mode": "full"
                },
                "regions": [],
                "clusters": ["dev4"]
            },
            "stream_type": "logs",
            "search_type": "ui",
            "use_cache": True
        }
    }

    # Send the message
    ws.send(json.dumps(message))

    # Receive the response
    response = ws.recv()

    print("WebSocket response:", response) 

    # Parse the JSON response
    response_data = json.loads(response)

    # Validate the total in the response
    total_hits = response_data["content"]["results"]["total"]
    assert total_hits == 0, f"Expected total to be 0, but got {total_hits}"


    ws.close()


# def test_api_and_websocket(cookies):
#     """Test API and WebSocket interaction."""
#     test_websocket_connection(cookies)  # Call the WebSocket test

def test_websocket_with_specific_message(cookies):
    """Test WebSocket with specific message."""
    # Prepare headers with cookies
    cookie_header = f"auth_ext={{\"auth_ext\":\"\",\"refresh_token\":\"\",\"request_time\":0,\"expires_in\":0}}; " \
                    f"auth_tokens={{\"access_token\":\"Basic {base64.b64encode((ZO_ROOT_USER_EMAIL + ':' + ZO_ROOT_USER_PASSWORD).encode()).decode()}\",\"refresh_token\":\"\"}}; " \
                    f"_ga=GA1.1.1388396574.1737697562; _ga_89WN60ZK2E=GS1.1.1738658735.34.1.1738659900.0.0.0"

    
    # Generate a dynamic UUID
    dynamic_uuid = str(uuid.uuid4())  # Generates a new UUID

    # Construct the WebSocket URL
    WS_URL = f"{WS_ZO_BASE_URL}api/{org_id}/ws/{dynamic_uuid}"

    # Example of using the WS_URL
    print("WebSocket URL:", WS_URL)

    # Now you can use WS_URL in your WebSocket connection

    ws = websocket.create_connection(WS_URL, header={"Cookie": cookie_header})

    print("WebSocket connection established")

    # Generate a dynamic trace_id
    dynamic_trace_id = str(uuid.uuid4())


    # Prepare the specific message to send
    specific_message = {
        "type": "search",
        "content": {
            "trace_id": dynamic_trace_id,  # Use dynamic trace_id
            "payload": {
                "query": {
                    "sql": "SELECT * FROM \"default\"",
                    "start_time": one_min_ago,
                    "end_time": end_time,
                    "from": 0,
                    "size": 10,
                    "quick_mode": False,
                    "sql_mode": "full"
                },
                "regions": [],
                "clusters": ["dev4"]
            },
            "stream_type": "logs",
            "search_type": "ui",
            "use_cache": True
        }
    }

    # Send the specific message
    ws.send(json.dumps(specific_message))

    # Receive the response
    response = ws.recv()

    print("WebSocket response for specific message:", response)

    # Parse the JSON response
    response_data = json.loads(response)

    # Validate the total in the response
    total_hits = response_data["content"]["results"]["total"]

    # Adjust the assertion based on your expectations
    expected_hits = 10  # Change this to 100 if that's what you're expecting
    assert total_hits == expected_hits, f"Expected total to be {expected_hits}, but got {total_hits}"
    
    # print("Response Data:", response_data)


    ws.close()


