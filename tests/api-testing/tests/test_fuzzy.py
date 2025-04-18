import json
import requests
import pytest
import time
from datetime import datetime, timezone, timedelta
from requests.auth import HTTPBasicAuth
import os


def ingest_test_data(session, base_url, org_id, stream_name):
    """Ingest test data with kubernetes_namespace_name field."""
    url = f"{base_url}api/{org_id}/{stream_name}/_json"
    test_data = [
        {"kubernetes_namespace_name": "zinc", "message": "test1"},
        {"kubernetes_namespace_name": "zinx", "message": "test2"},
        {"kubernetes_namespace_name": "zync", "message": "test3"},
        {"kubernetes_namespace_name": "zin", "message": "test4"}
    ]
    
    response = session.post(url, json=test_data)
    assert response.status_code == 200, f"Failed to ingest test data: {response.content}"
    print("Test data ingested successfully")
    
    # Wait longer for indexing
    print("Waiting for data to be indexed...")
    time.sleep(10)  # Increased wait time

def post_query(session, base_url, org_id, query, user_email, user_password, retries=5, delay=5, timeout=30):
    """Helper function to post SQL query with retries and return the response."""
    url = f"{base_url}api/{org_id}/_search?type=logs"
    


    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    
    session.auth = HTTPBasicAuth(user_email, user_password)

    for attempt in range(retries):
        try:
            response = session.post(
                url, 
                json={"query": query}, 
                timeout=timeout,
                headers=headers
            )
            print(f"Attempt {attempt + 1}: Status code {response.status_code}")
            
            if response.status_code == 200:
                response_data = response.json()
                if "hits" in response_data and len(response_data["hits"]) > 0:
                    print(f"Found {len(response_data['hits'])} hits")
                    return response_data
                print(f"No hits found in response: {response_data}")
            
            print(f"Response content: {response.content.decode()}")
            time.sleep(delay * (2 ** attempt))
            
        except requests.exceptions.RequestException as e:
            print(f"Request failed: {str(e)}")
            time.sleep(delay * (2 ** attempt))

    return {"error": "All attempts failed"}

def get_dynamic_timestamps():
    """Generate dynamic timestamps for the query."""
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    return one_min_ago, end_time

@pytest.mark.parametrize(
    "sql_query",
    [
        "SELECT * FROM \"stream_pytest_data_fuzzy\" WHERE fuzzy_match(kubernetes_namespace_name, 'ZINC', 4)",
        "SELECT * FROM \"stream_pytest_data_fuzzy\" WHERE fuzzy_match(kubernetes_namespace_name, 'Z', 4)",
        "SELECT * FROM \"stream_pytest_data_fuzzy\" WHERE kubernetes_namespace_name IS NOT NULL AND fuzzy_match(kubernetes_namespace_name, 'Z', 4)",
        "SELECT * FROM \"stream_pytest_data_fuzzy\" WHERE kubernetes_namespace_name LIKE '%zinc%' AND fuzzy_match(kubernetes_namespace_name, 'zinc', 4)",
    ],
)
def test_e2e_fuzzy(create_session, base_url, sql_query):
    """Running E2E tests for various SQL queries with retries."""
    session = create_session
    org_id = "org_pytest_data"
    stream_name = "stream_pytest_data_fuzzy"
    
    # Get credentials
    user_email = os.environ.get("ZO_ROOT_USER_EMAIL")
    user_password = os.environ.get("ZO_ROOT_USER_PASSWORD")
    
    
    # Ingest test data
    ingest_test_data(session, base_url, org_id, stream_name)
    
    one_min_ago, end_time = get_dynamic_timestamps()
    query = {
        "sql": sql_query,
        "start_time": one_min_ago,
        "end_time": end_time,
        "from": 0,
        "size": 150,
        "sql_mode": "full",
    }

    response_data = post_query(session, base_url, org_id, query, user_email, user_password)
    
    # Additional Assertions on the response data
    assert "hits" in response_data, f"Response does not contain 'hits'. Full response: {json.dumps(response_data, indent=2)}"
    assert len(response_data["hits"]) > 0, f"No logs found in the response. Full response: {json.dumps(response_data, indent=2)}"