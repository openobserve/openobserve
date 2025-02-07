import os  # For environment variables
import websocket  # For WebSocket connection
import json # For JSON parsing
import base64 # For encoding user credentials
from datetime import datetime, timezone, timedelta # For timestamp conversion
import time # For sleep
from pathlib import Path # For file paths
import uuid # For generating UUIDs
import pytest # For fixtures
import random
import string




# Constants for WebSocket URL and user credentials

WS_ZO_BASE_URL = os.environ.get("WS_ZO_BASE_URL")
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable
now = datetime.now(timezone.utc)
end_time = int(now.timestamp() * 1000000)
ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)
org_id = "default"




root_dir = Path(__file__).parent.parent.parent


def generate_random_string(length=5):
    # Define the characters to choose from
    characters = string.ascii_lowercase  # This includes only lowercase letters
    random_string = ''.join(random.choice(characters) for _ in range(length))
    return random_string

# Generate a random string of length 5
random_string = generate_random_string()
print("Random String:", random_string)

stream_name = "tdef" + random_string

print("Random String:", stream_name)

def test_ingest_data(create_session, base_url):
    """Ingest data into the openobserve running instance."""

    session = create_session
    # Open the json data file and read it
    with open(root_dir / "test-data/logs_data.json") as f:
        data = f.read()

    
    url_Ing = f"{base_url}api/{org_id}/{stream_name}/_json"
    resp_ing = session.post(url_Ing, data=data, headers={"Content-Type": "application/json"})
    print("Data ingested successfully for websocket, status code: ", resp_ing.status_code)
    assert ( resp_ing.status_code == 200), f"Data ingested successfully for websocket, status code: {resp_ing.status_code}"

def test_disable_websocket(create_session, base_url):
    """Fixture to enable WebSocket and return cookies."""
    session = create_session
    url = base_url
    payload_disable_webs = {
        "scrape_interval": 15,
        "span_id_field_name": "span_id",
        "trace_id_field_name": "trace_id",
        "toggle_ingestion_logs": True,
        "enable_websocket_search": False
    }

    print("Session disable Webs headers:", session.headers)

    resp_disable_webs = session.post(f"{url}api/{org_id}/settings", json=payload_disable_webs)

    print("Disable Websocket", resp_disable_webs.content)
    assert (
        resp_disable_webs.status_code == 200
    ), f"Websocket enable 200, but got {resp_disable_webs.status_code} {resp_disable_webs.content}"


# Define test data with different queries and expected response details for histogram
test_data_histog = [
    (
        "logs query",
        f"SELECT histogram(_timestamp, '10 second') AS \"zo_sql_key\", COUNT(*) AS \"zo_sql_num\" FROM \"{stream_name}\" GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
        -1,
    ),

    # (
    #     "logs and query",
    #     f"SELECT histogram(_timestamp, '10 second') AS \"zo_sql_key\", COUNT(*) AS \"zo_sql_num\" FROM \"{stream_name}\" WHERE kubernetes_container_name = 'ziox' AND kubernetes_labels_app = 'ziox' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
    #     -1,
    # ),

    # (
    #     "logs or query",
    #     f"SELECT histogram(_timestamp, '10 second') AS \"zo_sql_key\", COUNT(*) AS \"zo_sql_num\" FROM \"{stream_name}\" WHERE kubernetes_container_name = 'ziox' OR kubernetes_labels_app = 'ziox' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
    #     -1,
    # ),

  
 

 



 
    
  
   

]

@pytest.mark.parametrize("test_name, hist_query, expected_size", test_data_histog)
def test_histogram(create_session, base_url, test_name, hist_query, expected_size):
    """Running an E2E test for histogram queries with Parameterized data when websocket is disabled."""

    session = create_session
    url = base_url

    time.sleep(15)  # Increase this time if necessary

    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data_hist = {
        "query": {
                "sql": hist_query,
                "start_time": one_min_ago,
                "end_time": end_time,
                "size": expected_size,
                "sql_mode": "full"
        }
    }

    res_histog = session.post(f"{url}api/{org_id}/_search?type=logs&search_type=UI&use_cache=false", json=json_data_hist)
   
    assert (
        res_histog.status_code == 200
    ), f"histogram mode {test_name} added 200, but got {res_histog.status_code} {res_histog.content}"

    print("Response Histog:", res_histog.content) 

    # Parse the JSON response
    
    res_data_histog = res_histog.json()

    # Validate the total in the response
    total_hits_histog = res_data_histog["total"]

    # Adjust the assertion based on our expectations
    expected_hits_histog = 1  # Change this to 100 if that's what we're expecting
    assert total_hits_histog == expected_hits_histog, f"Expected total {test_name} to be {expected_hits_histog}, but got {total_hits_histog}"

    # Generate request for histogram cache enabled
    res_histog_cache = session.post(f"{url}api/{org_id}/_search?type=logs&search_type=UI&use_cache=true", json=json_data_hist)
   
    assert (
        res_histog_cache.status_code == 200
    ), f"histogram cache {test_name} mode added 200, but got {res_histog_cache.status_code} {res_histog_cache.content}"

    print("Response Cache Histog:", res_histog_cache.content) 

    # Parse the JSON response
    
    res_data_histog_cache = res_histog_cache.json()

    # Validate the total in the response
    total_hits_histog_cache = res_data_histog_cache["total"]

    # Adjust the assertion based on your expectations
    expected_hits_histog_cache = 1  # Change this to 100 if that's what you're expecting
    assert total_hits_histog_cache == expected_hits_histog_cache, f"Expected {test_name} total to be {expected_hits_histog_cache}, but got {total_hits_histog_cache}"


# Define test data with different queries and expected response details for SQL when websocket is disabled
test_data_sql = [
    (
        "logs query",
        f"SELECT * FROM \"{stream_name}\"",
        10,
    ),

    # (
    #     "logs and query",
    #     f"SELECT * FROM \"{stream_name}\" where kubernetes_container_name = 'ziox' AND kubernetes_labels_app = 'ziox'",
    #     10,
    # ),

    # (

    #     "logs or query",
    #     f"SELECT * FROM \"{stream_name}\" where kubernetes_container_name = 'ziox' OR kubernetes_labels_app = 'ziox'",
    #     10,
    # ),

  
 

 



 
    
  
   

]

@pytest.mark.parametrize("test_name_sql, sql_query, sql_size", test_data_sql)
def test_sql(create_session, base_url, test_name_sql, sql_query, sql_size):
    """Running an E2E test for sql queries with Parameterized data when websocket is disabled."""

    session = create_session
    url = base_url
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data_sql = {
    "query": {
        "sql": sql_query,
        "start_time": one_min_ago,
        "end_time": end_time,
        "from": 0,
        "size": sql_size,
        "quick_mode": False,
        "sql_mode": "full"
    },
    "regions": [],
    "clusters": []
    }
    
    res_sql = session.post(f"{url}api/{org_id}/_search?type=logs&search_type=UI&use_cache=false", json=json_data_sql)
   
    assert (
        res_sql.status_code == 200
    ), f"SQL mode {test_name_sql} added 200, but got {res_sql.status_code} {res_sql.content}"

    print("Response SQL:", res_sql.content) 

    # Parse the JSON response
    
    res_data_sql = res_sql.json()

    # Validate the total in the response
    total_hits_sql = res_data_sql["total"]

    # Adjust the assertion based on our expectations
    expected_hits_sql = sql_size  # Change this to 100 if that's what we're expecting
    assert total_hits_sql == expected_hits_sql, f"Expected total {test_name_sql} to be {expected_hits_sql}, but got {total_hits_sql}"

    # Generate request for cache
    res_sql_cache = session.post(f"{url}api/{org_id}/_search?type=logs&search_type=UI&use_cache=true", json=json_data_sql)
   
    assert (
        res_sql_cache.status_code == 200
    ), f"SQL cache {test_name_sql} mode added 200, but got {res_sql_cache.status_code} {res_sql_cache.content}"

    print("Response Cache SQL:", res_sql_cache.content) 

    # Parse the JSON response
    
    res_data_sql_cache = res_sql_cache.json()

    # Validate the total in the response
    total_hits_sql_cache = res_data_sql_cache["total"]

    # Adjust the assertion based on your expectations
    expected_hits_sql_cache = sql_size  # Change this to 100 if that's what you're expecting
    assert total_hits_sql_cache == expected_hits_sql_cache, f"Expected {test_name_sql} total to be {expected_hits_sql_cache}, but got {total_hits_sql_cache}"



# Define test data with different queries and expected response details for websocket enable
def test_enable_websocket(create_session, base_url):
    """Fixture to enable WebSocket"""
    session = create_session
    url = base_url
    payload_websocket = {
        "scrape_interval": 15,
        "span_id_field_name": "span_id",
        "trace_id_field_name": "trace_id",
        "toggle_ingestion_logs": True,
        "enable_websocket_search": True
    }

    print("Session Webs headers:", session.headers)

    resp_websocket = session.post(f"{url}api/{org_id}/settings", json=payload_websocket)

    print("Enable Websocket", resp_websocket.content)
    assert (
        resp_websocket.status_code == 200
    ), f"Websocket enable 200, but got {resp_websocket.status_code} {resp_websocket.content}"
    # print("Websocket enable 200", resp_websocket.cookies)
    # return resp_websocket.cookies  # Return cookies for the next request

@pytest.mark.parametrize("test_name, hist_query, expected_size", test_data_histog)
def test_websocket_histogram(create_session, base_url, test_name, hist_query, expected_size):
    """Test WebSocket connection and histogram endpoint."""
    session = create_session
    url = base_url
    
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

    # Now we can use WS_URL in our WebSocket connection

    ws_histogram = websocket.create_connection(WS_URL_histogram, header={"Cookie": cookie_header_histogram})

    print("WebSocket histogram connection established", ws_histogram)

    # Generate a dynamic trace_id
    trace_id_histogram = str(uuid.uuid4())

    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    # Prepare the message to send
    message_histogram = {
        "type": "search",
        "content": {
            "trace_id": trace_id_histogram,  # Use dynamic trace_id
            "payload": {
                "query": {
                    "sql": hist_query,
                    "start_time": ten_min_ago,
                    "end_time": end_time,
                    "size": expected_size,
                    "sql_mode": "full"
                },
                "regions": [],
                "clusters": []
            },
            "stream_type": "logs",
            "search_type": "ui",
            "use_cache": False
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
    expected_hits_histogram = 1  # Change this to 100 if that's what you're expecting
    assert total_hits_histogram == expected_hits_histogram, f"Expected {test_name} total to be {expected_hits_histogram}, but got {total_hits_histogram}"
    
    # print("Response Data:", response_data)


    ws_histogram.close()

    # Generate a dynamic UUID for cache

    uuid_histogram_cache = str(uuid.uuid4())  # Generates a new UUID

    # Construct the WebSocket URL
    WS_URL_histogram_cache = f"{WS_ZO_BASE_URL}api/{org_id}/ws/{uuid_histogram_cache}"

    # Example of using the WS_URL
    print("WebSocket Histogram URL Cache:", WS_URL_histogram_cache)

    # Now we can use WS_URL in our WebSocket connection for cache

    ws_histogram_cache = websocket.create_connection(WS_URL_histogram_cache, header={"Cookie": cookie_header_histogram})

    print("WebSocket Cache histogram connection established", ws_histogram_cache)

    # Generate a dynamic trace_id
    trace_id_histogram_cache = str(uuid.uuid4())

    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    # Prepare the message to send
    message_histogram_cashe = {
        "type": "search",
        "content": {
            "trace_id": trace_id_histogram_cache,  # Use dynamic trace_id
            "payload": {
                "query": {
                    "sql": hist_query,
                    "start_time": ten_min_ago,
                    "end_time": end_time,
                    "size": expected_size,
                    "sql_mode": "full"
                },
                "regions": [],
                "clusters": []
            },
            "stream_type": "logs",
            "search_type": "ui",
            "use_cache": True
        }
    }

    # Send the message
    ws_histogram_cache.send(json.dumps(message_histogram_cashe))

    time.sleep(5)  # Increase this time if necessary

    # Receive the response
    response_histogram_cache = ws_histogram_cache.recv()

    print("WebSocket cache response Histogram:", response_histogram_cache) 

    # Parse the JSON response
    response_data_histogram_cache = json.loads(response_histogram_cache)

    # Validate the total in the response
    total_hits_histogram_cache = response_data_histogram_cache["content"]["results"]["total"]

    # Adjust the assertion based on your expectations
    expected_hits_histogram_cache = 1  # Change this to 100 if that's what you're expecting
    assert total_hits_histogram_cache == expected_hits_histogram_cache, f"Expected {test_name} cache total to be {expected_hits_histogram_cache}, but got {total_hits_histogram_cache}"
    
    # print("Response Data:", response_data)


    ws_histogram_cache.close()


@pytest.mark.parametrize("test_name_sql, sql_query, sql_size", test_data_sql)


def test_websocket_sql(create_session, base_url, test_name_sql, sql_query, sql_size):
    """Test WebSocket with sql."""
    # Prepare headers with cookies

    session = create_session
    url = base_url

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

    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    # Prepare the specific message to send
    message_sql = {
        "type": "search",
        "content": {
            "trace_id": trace_id_sql,  # Use dynamic trace_id
            "payload": {
                "query": {
                    "sql": sql_query,
                    "start_time": ten_min_ago,
                    "end_time": end_time,
                    "from": 0,
                    "size": sql_size,
                    "quick_mode": False,
                    "sql_mode": "full"
                },
                "regions": [],
                "clusters": []
            },
            "stream_type": "logs",
            "search_type": "ui",
            "use_cache": False
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
    expected_hits_sql = sql_size  # Change this to 100 if that's what you're expecting
    assert total_hits_sql == expected_hits_sql, f"Expected {test_name_sql} total to be {expected_hits_sql}, but got {total_hits_sql}"
    
    # print("Response Data:", response_data)


    ws_sql.close()

    # Generate a dynamic UUID for cache

    uuid_sql_cache = str(uuid.uuid4())  # Generates a new UUID

    # Construct the WebSocket URL
    WS_URL_sql_cache = f"{WS_ZO_BASE_URL}api/{org_id}/ws/{uuid_sql_cache}"

    # Example of using the WS_URL
    print("WebSocket SQL URL Cache:", WS_URL_sql_cache)

    # Now we can use WS_URL in our WebSocket connection for cache


    ws_sql_cache = websocket.create_connection(WS_URL_sql_cache, header={"Cookie": cookie_header_sql})

    print("WebSocket Cache SQL connection established", ws_sql_cache)

    # Generate a dynamic trace_id
    trace_id_sql_cache = str(uuid.uuid4())

    now = datetime.now(timezone.utc)

    # Prepare the specific message to send
    message_sql_cache = {
        "type": "search",
        "content": {
            "trace_id": trace_id_sql_cache,  # Use dynamic trace_id
            "payload": {
                "query": {
                    "sql": sql_query,
                    "start_time": ten_min_ago,
                    "end_time": end_time,
                    "from": 0,
                    "size": sql_size,
                    "quick_mode": False,
                    "sql_mode": "full"
                },
                "regions": [],
                "clusters": []
            },
            "stream_type": "logs",
            "search_type": "ui",
            "use_cache": True
        }
    }

    # Send the specific message
    ws_sql_cache.send(json.dumps(message_sql_cache))


    # Receive the response
    response_sql_cache = ws_sql_cache.recv()

    print("WebSocket cache response for SQL:", response_sql_cache)


    # Parse the JSON response

    response_data_sql_cache = json.loads(response_sql_cache)

    # Validate the total in the response
    total_hits_sql_cache = response_data_sql_cache["content"]["results"]["total"]

    # Adjust the assertion based on your expectations
    expected_hits_sql_cache = sql_size  # Change this to 100 if that's what you're expecting
    assert total_hits_sql_cache == expected_hits_sql_cache, f"Expected cache {test_name_sql} total to be {expected_hits_sql_cache}, but got {total_hits_sql_cache}"

    ws_sql_cache.close()

def test_delete_stream(create_session, base_url):
    """Running an E2E test for deleting the created stream."""

    session = create_session
    url = base_url
  
    # Proceed to delete the created Stream
    resp_delete_stream= session.delete(f"{url}api/{org_id}/streams/{stream_name}?type=logs")
    print(f"Deleted Stream Response: {resp_delete_stream.text}")
    assert resp_delete_stream.status_code == 200, f"Failed to delete stream {stream_name}"
    print(f"Successfully deleted stream {stream_name}")

    # Verify stream is deleted
    resp_verify = session.get(f"{url}api/{org_id}/streams/{stream_name}/schema?type=logs")
    assert resp_verify.status_code == 404, f"Expected 404 for deleted stream, got {resp_verify.status_code}"




