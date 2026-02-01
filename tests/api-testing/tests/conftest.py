import requests
import pytest
import os
import random
import string
import logging
from pathlib import Path
import base64

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

BASE_URL = os.environ["ZO_BASE_URL"]
DEFAULT_ORG_ID = os.environ.get("TEST_ORG_ID", "default")
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


@pytest.fixture(scope="module")
def org_id():
    """Return the organization ID for testing.

    Can be overridden via TEST_ORG_ID environment variable.
    """
    return DEFAULT_ORG_ID


@pytest.fixture(scope="session", autouse=True)
def ingest_data():
    """Ingest data into the openobserve running instance."""
    import time

    # Use v2 session for consistent auth header
    session = _create_session_inner_v2()

    # Ingest main test data
    with open(root_dir / "test-data/logs_data.json") as f:
        data = f.read()

    stream_name = "stream_pytest_data"
    org = DEFAULT_ORG_ID
    url = f"{BASE_URL}api/{org}/{stream_name}/_json"
    resp1 = session.post(url, data=data, headers={"Content-Type": "application/json"})
    logging.info("Main data ingested successfully, status code: %s", resp1.status_code)
    assert resp1.status_code == 200, \
        f"Failed to ingest main test data: {resp1.status_code} - {resp1.text[:500]}"

    # Ingest camel case test data
    with open(root_dir / "test-data/match_all.json") as f:
        camel_data = f.read()

    resp2 = session.post(url, data=camel_data, headers={"Content-Type": "application/json"})
    logging.info("Camel case data ingested successfully, status code: %s", resp2.status_code)
    assert resp2.status_code == 200, \
        f"Failed to ingest camel case test data: {resp2.status_code} - {resp2.text[:500]}"

    # Flush data to ensure it's indexed
    flush_url = f"{BASE_URL}node/flush"
    logging.info("Flushing data to ensure indexing...")
    flush_resp = session.put(flush_url)

    if flush_resp.status_code == 200:
        logging.info("Data flushed successfully")
    elif flush_resp.status_code == 404:
        # Node is not an ingester in local mode, data will be indexed automatically
        logging.info("Flush not needed (local mode), waiting for auto-indexing...")
        time.sleep(3)
    else:
        logging.warning("Flush request returned status %s: %s", flush_resp.status_code, flush_resp.text[:200])

    # Give a small buffer for flush to complete
    time.sleep(2)

    return True