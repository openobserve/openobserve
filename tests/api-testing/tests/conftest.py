import requests
import pytest
import os
import random
import string
from pathlib import Path
import base64

BASE_URL = os.environ["ZO_BASE_URL"]
root_dir = Path(__file__).parent.parent.parent

@pytest.fixture(scope="module")
def random_string():
    """Generate a random string of specified length."""
    def _generate(length=5):
        # ascii_letters consist of alphabets for 'a' to 'z' and 'A' to 'Z'
        # digits consist of '0' to '9'
        characters = string.ascii_letters + string.digits
        return "".join(random.choices(characters, k=length))
    return _generate

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
    # Set Authorization header for all requests
    basic_auth = base64.b64encode(f"{username}:{password}".encode()).decode()
    s.headers.update({"Authorization": f"Basic {basic_auth}"})
    return s


@pytest.fixture(scope="module")
def create_session():
    """Create a session and return it."""
    return _create_session_inner_v2()


@pytest.fixture(scope="module")
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
    org = "default"
    url = f"{BASE_URL}api/{org}/{stream_name}/_json"
    resp = session.post(url, data=data, headers={"Content-Type": "application/json"})
    print("Data ingested successfully, status code: ", resp.status_code)
    return resp.status_code == 200