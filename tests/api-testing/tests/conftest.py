import requests
import pytest
import os
import random
import string
from pathlib import Path
import time
BASE_URL = os.environ["ZO_BASE_URL"]
BASE_URL_SC = os.environ["ZO_BASE_URL_SC"]
BASE_URL_SC2 = os.environ["ZO_BASE_URL_SC2"]

root_dir = Path(__file__).parent.parent.parent

unique_value = f"u_{random.randint(100000, 999999)}"

def random_string(length: int):
    # ascii_letters consist of alphabets for 'a' to 'z' and 'A' to 'Z'
    # digits consist of '0' to '9'
    characters = string.ascii_letters + string.digits
    return "".join(random.choices(characters, k=length))

def generate_random_string(length=5):
    """Generate a random string of lowercase letters."""
    characters = string.ascii_lowercase  # Only lowercase letters
    return ''.join(random.choice(characters) for _ in range(length))

# Generate a random stream name
random_string = generate_random_string()
# Organization ID
org_id = random_string
stream_name = "tdef" + random_string
print("Random Org ID:", org_id)
print("Random Stream:", stream_name)

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
    # s.auth = (username, password)
    # resp = s.post(BASE_URL)
    resp = s.post(f"{BASE_URL}auth/login", json={"name": username, "password": password})
    print (resp.status_code)
    if resp.status_code != 200:
        raise Exception("Invalid username/password")
    return s


@pytest.fixture
def create_session():
    """Create a session and return it."""
    return _create_session_inner()


@pytest.fixture
def base_url():
    """Return the base URL."""
    return BASE_URL

@pytest.fixture
def supercluster_base_urls():
    """Return the base URL."""
    return [BASE_URL_SC, BASE_URL_SC2]




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