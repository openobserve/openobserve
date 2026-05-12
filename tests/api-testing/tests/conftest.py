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

@pytest.fixture(scope="session")
def worker_id(request):
    """Return worker id when running under xdist, 'master' otherwise.

    When pytest-xdist distributes tests across worker processes, each worker
    gets a unique id (e.g., 'gw0', 'gw1'). When not using xdist, returns
    'master' so tests use the default org without changes.
    """
    if hasattr(request.config, 'workerinput'):
        return request.config.workerinput['workerid']
    return 'master'

@pytest.fixture(scope="session")
def session_org_id(worker_id):
    """Return isolated org ID per xdist worker for data ingestion scope.

    Each worker gets its own org (e.g., 'pytest_gw0', 'pytest_gw1'),
    ensuring tests running in parallel cannot collide on org-level resources
    like streams, users, alerts, and dashboards.
    """
    if worker_id == "master":
        return DEFAULT_ORG_ID
    return f"pytest_{worker_id}"

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
    """Return the base URL with trailing slash."""
    url = BASE_URL
    return url if url.endswith('/') else url + '/'


@pytest.fixture(scope="module")
def org_id(session_org_id):
    """Return the organization ID for testing.

    Isolated per xdist worker. When running in parallel, each worker
    gets a unique org like 'pytest_gw0'. When running sequentially,
    falls back to DEFAULT_ORG_ID.

    Can be overridden per-test-module by defining a module-scoped
    org_id fixture in the test file.
    """
    return session_org_id


@pytest.fixture(scope="session", autouse=True)
def ingest_data(session_org_id):
    """Ingest data into the openobserve running instance.

    Each xdist worker ingests into its own isolated org ('pytest_gw0',
    'pytest_gw1', etc.), so tests running in parallel cannot interfere
    with each other's data.
    """
    import time

    # Use v2 session for consistent auth header
    session = _create_session_inner_v2()

    # Ingest main test data
    with open(root_dir / "test-data/logs_data.json") as f:
        data = f.read()

    stream_name = "stream_pytest_data"
    org = session_org_id
    base_url_with_slash = BASE_URL if BASE_URL.endswith('/') else BASE_URL + '/'
    url = f"{base_url_with_slash}api/{org}/{stream_name}/_json"
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
    flush_url = f"{base_url_with_slash}node/flush"
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