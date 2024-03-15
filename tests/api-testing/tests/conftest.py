import requests
import pytest
import os
import random
import string


BASE_URL = os.environ["ZO_BASE_URL"]

def random_string(length: int):
    # ascii_letters consist of alphabets for 'a' to 'z' and 'A' to 'Z'
    # digits consist of '0' to '9'
    characters = string.ascii_letters + string.digits
    return ''.join(random.choices(characters, k=length))

def _create_session_inner():
    s = requests.Session()
    username = os.environ["ZO_ROOT_USER_EMAIL"]
    password = os.environ["ZO_ROOT_USER_PASSWORD"]
    s.auth = (username, password)
    s.post(BASE_URL)
    return s

@pytest.fixture
def create_session():
    """Create a session and return it."""
    return _create_session_inner()


@pytest.fixture
def base_url():
    """Return the base URL."""
    return BASE_URL


@pytest.fixture(scope="session", autouse=True)
def ingest_data():
    """Ingest data into the openobserve running instance."""

    session = _create_session_inner()
    # Open the json data file and read it
    with open("tests/test-data/logs_data.json") as f:
        data = f.read()

    
    stream_name = "stream_pytest_data"
    org = "org_pytest_data"
    url = f"{BASE_URL}api/{org}/{stream_name}/_json"
    resp = session.post(url, data=data, headers={"Content-Type": "application/json"})
    return resp.status_code == 200
