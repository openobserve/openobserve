import os  # For environment variables
from requests.auth import HTTPBasicAuth
from datetime import datetime, timezone, timedelta
# Constants for  URL and user credentials
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
WS_ZO_BASE_URL = os.environ.get("WS_ZO_BASE_URL")
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable

org_id = "default"



# Expected response details for module list of _meta org
def test_retrieve_module_list(create_session, base_url):
    """Fixture to retrieve module list"""
    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    resp_module_list = session.get(f"{url}api/_meta/ratelimit/module_list?org_id=_meta")
    print("Module List", resp_module_list.content)
    assert (
        resp_module_list.status_code == 200
    ), f"Module List expected 200, but got {resp_module_list.status_code} {resp_module_list.content}"

# Expected response details for api modules list of _meta org
def test_retrieve_api_modules(create_session, base_url):
    """Fixture to retrieve api modules list"""
    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    resp_api_modules = session.get(f"{url}api/_meta/ratelimit/api_modules?org_id=_meta")
    print("API Modules List", resp_api_modules.content)
    assert (
        resp_api_modules.status_code == 200
    ), f"API Modules List expected 200, but got {resp_api_modules.status_code} {resp_api_modules.content}"


# Expected response details for module list of Global Rules
def test_retrieve_module_list_global(create_session, base_url):
    """Fixture to retrieve module list"""
    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    resp_module_list = session.get(f"{url}api/_meta/ratelimit/module_list?org_id=global_rules")
    print("Module List for Global Rules", resp_module_list.content)
    assert (
        resp_module_list.status_code == 200
    ), f"Module List for Global Rules   expected 200, but got {resp_module_list.status_code} {resp_module_list.content}"

# Expected response details for api modules list of Global Rules
def test_retrieve_api_modules_global(create_session, base_url):
    """Fixture to retrieve api modules list"""
    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    resp_api_modules = session.get(f"{url}api/_meta/ratelimit/api_modules?org_id=global_rules")
    print("API Modules List for Global Rules", resp_api_modules.content)
    assert (
        resp_api_modules.status_code == 200
    ), f"API Modules List for Global Rules expected 200, but got {resp_api_modules.status_code} {resp_api_modules.content}"


# Expected response details for module list of specific org
def test_retrieve_module_list_org(create_session, base_url):
    """Fixture to retrieve module list"""
    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    resp_module_list = session.get(f"{url}api/_meta/ratelimit/module_list?org_id={org_id}")
    print("Module List for specific org", resp_module_list.content)
    assert (
        resp_module_list.status_code == 200
    ), f"Module List for specific org expected 200, but got {resp_module_list.status_code} {resp_module_list.content}"

# Expected response details for api modules list of specific org
def test_retrieve_api_modules_org(create_session, base_url):
    """Fixture to retrieve api modules list"""
    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    resp_api_modules = session.get(f"{url}api/_meta/ratelimit/api_modules?org_id={org_id}")
    print("API Modules List for specific org", resp_api_modules.content)
    assert (
        resp_api_modules.status_code == 200
    ), f"API Modules List for specific org expected 200, but got {resp_api_modules.status_code} {resp_api_modules.content}"

# Expected response details for updated module list of _meta org
def test_update_module_list(create_session, base_url):
    """Fixture to retrieve updated module list"""
    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    # Define the payload as per the curl command
    payload = {
        "Search": {
            "get": 1
        }
    }
    resp_module_list_update = session.put(f"{url}api/_meta/ratelimit/update?update_type=module&org_id=_meta", json=payload)

    print("Updated Module List", resp_module_list_update.content)
    assert (
        resp_module_list_update.status_code == 200
    ), f"Updated Module List expected 200, but got {resp_module_list_update.status_code} {resp_module_list_update.content}"

    # Expected response details for updated module list of specific org
def test_update_module_list_global(create_session, base_url):
    """Fixture to retrieve updated module list"""
    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    # Define the payload as per the curl command
    payload = {
        "Search": {
            "get": 1
        }
    }
    resp_module_list_update = session.put(f"{url}api/_meta/ratelimit/update?update_type=module&org_id=global_rules", json=payload)
    

    print("Updated Module List for Global Rules", resp_module_list_update.content)
    assert (
        resp_module_list_update.status_code == 200
    ), f"Updated Module List for Global Rules expected 200, but got {resp_module_list_update.status_code} {resp_module_list_update.content}"

    # Expected response details for updated module list of specific org
def test_update_module_list_org(create_session, base_url):
    """Fixture to retrieve updated module list"""
    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD) 
    # Define the payload as per the curl command
    payload = {
        "Search": {
            "get": 1
        }
    }   
    resp_module_list_update = session.put(f"{url}api/_meta/ratelimit/update?update_type=module&org_id={org_id}", json=payload)

    print("Updated Module List for specific org", resp_module_list_update.content)
    assert (
        resp_module_list_update.status_code == 200
    ), f"Updated Module List for specific org expected 200, but got {resp_module_list_update.status_code} {resp_module_list_update.content}"


def test_partition_search(create_session, base_url):
    """Fixture to retrieve partition search"""

    session = create_session
    URL_PARTITION_SEARCH = f"{base_url}api/{org_id}/_search_partition?type=logs"
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)

    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)
    # Define the payload
    payload = {
        "sql": "SELECT * FROM \"stream_pytest_data\"",
        "start_time": ten_min_ago,
        "end_time": end_time,
        "sql_mode": "full",
        "streaming_output": True
}
    # Send the POST request
    response = session.post(URL_PARTITION_SEARCH, json=payload)

    # Assert the response status code
    assert response.status_code == 200, f"Expected status code 200 but got {response.status_code}"

    # Check the response structure based on actual response format
    response_json = response.json()
    print("Response JSON", response_json)
    assert 'compressed_size' in response_json, "Response JSON does not contain 'compressed_size' key"
    assert 'file_num' in response_json, "Response JSON does not contain 'file_num' key"
    assert isinstance(response_json['compressed_size'], int), "'compressed_size' should be an integer"
    assert isinstance(response_json['file_num'], int), "'file_num' should be an integer"


def test_rate_limit(create_session, base_url):
    """Fixture to test API rate limit"""
    session = create_session
    URL_RATE_LIMIT = f"{base_url}api/{org_id}/_search?type=logs&search_type=ui&use_cache=true"
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)
    # Define the payload
    PAYLOAD = {
            "query": {
                "sql": "SELECT * FROM \"stream_pytest_data\"",
                "start_time": ten_min_ago,
                "end_time": end_time,
                "from": 0,
                "size": 50,
                "quick_mode": False,
                "sql_mode": "full",
                "streaming_output": False,
                "streaming_id": None
                    }
                }
    response = session.post(URL_RATE_LIMIT, json=PAYLOAD)
    
    # Check the response status code
    assert response.status_code == 429, f"Expected status code 429, but got {response.status_code}"
    
    # Check for rate limit error in the response
    response_json = response.json()
    assert "error" in response_json, "Expected 'error' key in response"
    assert response_json["error"] == "rate_limit_exceeded", f"Expected error message 'rate_limit_exceeded', but got {response_json['error']}"
    assert response_json["message"] == "Request limit reached for default/_search. Please try again in a few moments", \
        f"Expected message 'Request limit reached for default/_search. Please try again in a few moments', but got {response_json['message']}"

