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

    

    
