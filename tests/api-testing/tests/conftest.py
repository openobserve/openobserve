import fcntl
import requests
import pytest
import os
import random
import string
import logging
from pathlib import Path
import base64

# Make the new framework fixtures available to all tests (Phase 4+).
# Legacy tests still use create_session/base_url/org_id below.
from support.fixtures import client, temp_stream_name, temp_user_email, temp_dashboard_id  # noqa: F401

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
    """Return the base URL with trailing slash."""
    url = BASE_URL
    return url if url.endswith('/') else url + '/'


@pytest.fixture(scope="module")
def org_id():
    """Return the organization ID for testing.

    Can be overridden via TEST_ORG_ID environment variable.
    """
    return DEFAULT_ORG_ID


@pytest.fixture(scope="session", autouse=True)
def ingest_data(tmp_path_factory):
    """Ingest the shared seed data once per server, even across xdist workers and repeated sessions."""
    # The basetemp parent is shared by every xdist worker of a run, so the lock serialises them.
    lock_path = tmp_path_factory.getbasetemp().parent / "ingest_data.lock"
    with open(lock_path, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        _ingest_seed_data_once()
    return True


def _ingest_seed_data_once():
    from datetime import UTC, datetime, timedelta

    from support.wait import wait_until

    # Use v2 session for consistent auth header
    session = _create_session_inner_v2()
    stream_name = "stream_pytest_data"
    org = DEFAULT_ORG_ID
    base_url_with_slash = BASE_URL if BASE_URL.endswith('/') else BASE_URL + '/'

    def _data_is_searchable():
        search_url = f"{base_url_with_slash}api/{org}/_search?type=logs"
        # Wide window: data fixtures may have older timestamps.
        now = datetime.now(UTC)
        end_us = int(now.timestamp() * 1_000_000)
        start_us = int((now - timedelta(weeks=2)).timestamp() * 1_000_000)
        payload = {
            "query": {
                "sql": f'SELECT COUNT(*) AS c FROM "{stream_name}"',
                "start_time": start_us,
                "end_time": end_us,
                "from": 0,
                "size": 1,
            }
        }
        r = session.post(search_url, json=payload)
        if r.status_code != 200:
            return False
        hits = r.json().get("hits", [])
        return bool(hits and hits[0].get("c", 0) > 0)

    # A second ingest would double every count that tests assert on this stream.
    if _data_is_searchable():
        logging.info("Seed data already present in %s", stream_name)
        return

    url = f"{base_url_with_slash}api/{org}/{stream_name}/_json"
    with open(root_dir / "test-data/logs_data.json") as f:
        data = f.read()
    resp1 = session.post(url, data=data, headers={"Content-Type": "application/json"})
    logging.info("Main data ingested successfully, status code: %s", resp1.status_code)
    assert resp1.status_code == 200, \
        f"Failed to ingest main test data: {resp1.status_code} - {resp1.text[:500]}"

    with open(root_dir / "test-data/match_all.json") as f:
        camel_data = f.read()
    resp2 = session.post(url, data=camel_data, headers={"Content-Type": "application/json"})
    logging.info("Camel case data ingested successfully, status code: %s", resp2.status_code)
    assert resp2.status_code == 200, \
        f"Failed to ingest camel case test data: {resp2.status_code} - {resp2.text[:500]}"

    # Flush data to ensure it's indexed (no-op in local mode; returns 404)
    flush_resp = session.put(f"{base_url_with_slash}node/flush")
    if flush_resp.status_code == 200:
        logging.info("Data flushed successfully")
    elif flush_resp.status_code == 404:
        logging.info("Flush not needed (local mode), polling for auto-indexing...")
    else:
        logging.warning("Flush request returned status %s: %s", flush_resp.status_code, flush_resp.text[:200])

    wait_until(_data_is_searchable, timeout=30, interval=0.5, msg="ingested data not searchable")
    logging.info("Ingested data is searchable")
