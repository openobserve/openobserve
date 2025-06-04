import requests
import pytest
import os
import random
import string
from pathlib import Path
import base64
import json

BASE_URL = os.environ["ZO_BASE_URL"]
root_dir = Path(__file__).parent.parent.parent


def random_string(length: int):
    # ascii_letters consist of alphabets for 'a' to 'z' and 'A' to 'Z'
    # digits consist of '0' to '9'
    characters = string.ascii_letters + string.digits
    return "".join(random.choices(characters, k=length))

def _create_session_inner():
    s = requests.Session()
    username = os.environ["ZO_ROOT_USER_EMAIL"]
    password = os.environ["ZO_ROOT_USER_PASSWORD"]
    s.auth = (username, password)
    resp = s.post(BASE_URL)
    return s


def _create_session_inner_v2():
    s = requests.Session()
    username = os.environ["ZO_ROOT_USER_EMAIL"]
    password = os.environ["ZO_ROOT_USER_PASSWORD"]
    resp = s.post(f"{BASE_URL}auth/login", json={"name": username, "password": password})
    print("Login response:", resp.text)
    if resp.status_code != 200:
        raise Exception("Invalid username/password")
    
    # Get the auth_tokens cookie
    auth_tokens = None
    for cookie in resp.cookies:
        if cookie.name == "auth_tokens":
            auth_tokens = cookie.value
            break
    
    if not auth_tokens:
        raise Exception("No auth_tokens cookie found")
    
    # Decode the auth_tokens cookie
    try:
        # First try to decode as base64
        decoded = base64.b64decode(auth_tokens)
        # Then try to decode as JSON without assuming UTF-8
        tokens = json.loads(decoded)
        access_token = tokens.get("access_token")
        if not access_token:
            raise Exception("No access token found in auth_tokens")
    except Exception as e:
        # If decoding fails, try to use the raw cookie value
        print(f"Warning: Failed to decode auth_tokens: {e}")
        print(f"Using raw auth_tokens value: {auth_tokens}")
        access_token = auth_tokens
    
    return s, auth_tokens, access_token


@pytest.fixture(scope="session")
def create_session():
    """Create a session and return it."""
    session, _, _ = _create_session_inner_v2()
    return session


@pytest.fixture(scope="session")
def auth_token():
    """Return the authentication token."""
    _, auth_tokens, access_token = _create_session_inner_v2()
    return auth_tokens, access_token


@pytest.fixture(scope="session")
def base_url():
    """Return the base URL."""
    return BASE_URL


@pytest.fixture(scope="session", autouse=True)
def ingest_data():
    """Ingest data into the openobserve running instance."""

    session = _create_session_inner()
    # Open the json data file and read it
    with open(root_dir / "test-data/logs_data.json") as f:
        data = f.read()

    stream_name = "stream_pytest_data"
    org = "org_pytest_data"
    url = f"{BASE_URL}api/{org}/{stream_name}/_json"
    resp = session.post(url, data=data, headers={"Content-Type": "application/json"})
    print("Data ingested successfully, status code: ", resp.status_code)
    return resp.status_code == 200