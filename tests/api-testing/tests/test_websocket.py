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
ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)
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

    print("Enable Websocket", resp_websocket.content)
    assert (
        resp_websocket.status_code == 200
    ), f"Websocket enable 200, but got {resp_websocket.status_code} {resp_websocket.content}"
    print("Websocket enable 200", resp_websocket.cookies)
    return resp_websocket.cookies  # Return cookies for the next request

def test_websocket_histogram(cookies):
    """Test WebSocket connection and histogram endpoint."""
    # Prepare headers with cookies
    cookie_header_histogram = f"auth_ext={{\"auth_ext\":\"\",\"refresh_token\":\"\",\"request_time\":0,\"expires_in\":0}}; " \
                    f"auth_tokens={{\"access_token\":\"Basic {base64.b64encode((ZO_ROOT_USER_EMAIL + ':' + ZO_ROOT_USER_PASSWORD).encode()).decode()}\",\"refresh_token\":\"\"}}; " \
                    f"_ga=GA1.1.1388396574.1737697562; _ga_89WN60ZK2E=GS1.1.1738658735.34.1.1738659900.0.0.0"


    # Generate a dynamic UUID
    uuid_histogram = str(uuid.uuid4())  # Generates a new UUID

    # Construct the WebSocket URL
    WS_URL_histogram = f"{WS_ZO_BASE_URL}api/{org_id}/ws/{uuid_histogram}"

    # Example of using the WS_URL
    print("WebSocket Histogram URL:", WS_URL_histogram)

    # Now you can use WS_URL in your WebSocket connection

    ws_histogram = websocket.create_connection(WS_URL_histogram, header={"Cookie": cookie_header_histogram})

    print("WebSocket histogram connection established", ws_histogram)

    # Generate a dynamic trace_id
    trace_id_histogram = str(uuid.uuid4())

    # Prepare the message to send
    message_histogram = {
        "type": "search",
        "content": {
            "trace_id": trace_id_histogram,  # Use dynamic trace_id
            "payload": {
                "query": {
                    "sql": "SELECT histogram(_timestamp, '10 second') AS \"zo_sql_key\", COUNT(*) AS \"zo_sql_num\" FROM \"default\" GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
                    "start_time": ten_min_ago,
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
    ws_histogram.send(json.dumps(message_histogram))

    time.sleep(5)  # Increase this time if necessary

    # Receive the response
    response_histogram = ws_histogram.recv()

    print("WebSocket response Histogram:", response_histogram) 

    # Parse the JSON response
    response_data_histogram = json.loads(response_histogram)

    # Validate the total in the response
    total_hits_histogram = response_data_histogram["content"]["results"]["total"]

    # Adjust the assertion based on your expectations
    expected_hits_histogram = 4  # Change this to 100 if that's what you're expecting
    assert total_hits_histogram == expected_hits_histogram, f"Expected total to be {expected_hits_histogram}, but got {total_hits_histogram}"
    
    # print("Response Data:", response_data)


    ws_histogram.close()




def test_websocket_sql(cookies):
    """Test WebSocket with sql."""
    # Prepare headers with cookies
    cookie_header_sql = f"auth_ext={{\"auth_ext\":\"\",\"refresh_token\":\"\",\"request_time\":0,\"expires_in\":0}}; " \
                    f"auth_tokens={{\"access_token\":\"Basic {base64.b64encode((ZO_ROOT_USER_EMAIL + ':' + ZO_ROOT_USER_PASSWORD).encode()).decode()}\",\"refresh_token\":\"\"}}; " \
                    f"_ga=GA1.1.1388396574.1737697562; _ga_89WN60ZK2E=GS1.1.1738658735.34.1.1738659900.0.0.0"

    
    # Generate a dynamic UUID
    uuid_sql = str(uuid.uuid4())  # Generates a new UUID

    # Construct the WebSocket URL
    WS_URL_sql = f"{WS_ZO_BASE_URL}api/{org_id}/ws/{uuid_sql}"

    # Example of using the WS_URL
    print("WebSocket SQL URL:", WS_URL_sql)

    # Now you can use WS_URL in your WebSocket connection

    ws_sql = websocket.create_connection(WS_URL_sql, header={"Cookie": cookie_header_sql})

    print("WebSocket SQL connection established", ws_sql)

    # Generate a dynamic trace_id
    trace_id_sql = str(uuid.uuid4())


    # Prepare the specific message to send
    message_sql = {
        "type": "search",
        "content": {
            "trace_id": trace_id_sql,  # Use dynamic trace_id
            "payload": {
                "query": {
                    "sql": "SELECT * FROM \"default\"",
                    "start_time": ten_min_ago,
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
    ws_sql.send(json.dumps(message_sql))

    # Receive the response
    response_sql = ws_sql.recv()

    print("WebSocket response for SQL:", response_sql)

    # Parse the JSON response
    response_data_sql = json.loads(response_sql)

    # Validate the total in the response
    total_hits_sql = response_data_sql["content"]["results"]["total"]

    # Adjust the assertion based on your expectations
    expected_hits_sql = 10  # Change this to 100 if that's what you're expecting
    assert total_hits_sql == expected_hits_sql, f"Expected total to be {expected_hits_sql}, but got {total_hits_sql}"
    
    # print("Response Data:", response_data)


    ws_sql.close()


