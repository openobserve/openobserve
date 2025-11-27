"""
Pytest configuration and fixtures for DB validation tests.
"""
import os
import time
import pytest
import psycopg2
import requests
from typing import Generator


@pytest.fixture(scope="session")
def openobserve_base_url() -> str:
    """Base URL for OpenObserve API."""
    return os.getenv("ZO_BASE_URL", "http://localhost:5080")


@pytest.fixture(scope="session")
def auth_credentials() -> tuple[str, str]:
    """Authentication credentials for OpenObserve."""
    email = os.getenv("ZO_ROOT_USER_EMAIL", "root@example.com")
    password = os.getenv("ZO_ROOT_USER_PASSWORD", "Complexpass#123")
    return (email, password)


@pytest.fixture(scope="session")
def db_connection() -> Generator:
    """
    Database connection fixture.
    Yields a psycopg2 connection to the metadata database.
    """
    dsn = os.getenv("ZO_META_POSTGRES_DSN", "postgres://postgres:password@localhost:5432/postgres")

    conn = psycopg2.connect(dsn)
    conn.autocommit = True

    yield conn

    conn.close()


@pytest.fixture
def db_cursor(db_connection):
    """
    Database cursor fixture for executing queries.
    """
    cursor = db_connection.cursor()
    yield cursor
    cursor.close()


@pytest.fixture(scope="session")
def test_org() -> str:
    """Test organization name."""
    return "default"


@pytest.fixture(scope="session")
def test_stream() -> str:
    """Test stream name."""
    return "db_test_stream"


def wait_for_ingestion(seconds: int = 5):
    """Helper function to wait for data to be ingested and persisted."""
    time.sleep(seconds)


@pytest.fixture
def ingest_test_data(openobserve_base_url, auth_credentials, test_org, test_stream):
    """
    Fixture to ingest test data into OpenObserve.
    Returns a function that can be called to ingest custom data.
    """
    def _ingest(data: list[dict], stream_name: str = None):
        stream = stream_name or test_stream
        url = f"{openobserve_base_url}/api/{test_org}/{stream}/_json"

        response = requests.post(
            url,
            json=data,
            auth=auth_credentials,
            headers={"Content-Type": "application/json"}
        )

        assert response.status_code == 200, f"Ingestion failed: {response.text}"

        # Wait for data to be processed
        wait_for_ingestion()

        return response.json()

    return _ingest


@pytest.fixture
def query_api(openobserve_base_url, auth_credentials, test_org):
    """
    Fixture to query OpenObserve via API.
    """
    def _query(sql: str, stream_name: str):
        url = f"{openobserve_base_url}/api/{test_org}/_search"

        # Use a wider time range - last 24 hours to now + 1 hour
        now_micros = int(time.time() * 1000000)
        start_time = now_micros - (24 * 60 * 60 * 1000000)  # 24 hours ago
        end_time = now_micros + (60 * 60 * 1000000)  # 1 hour in the future

        payload = {
            "query": {
                "sql": sql,
                "from": 0,
                "size": 1000,
                "start_time": start_time,
                "end_time": end_time
            }
        }

        response = requests.post(
            url,
            json=payload,
            auth=auth_credentials,
            headers={"Content-Type": "application/json"}
        )

        assert response.status_code == 200, f"Query failed: {response.text}"
        return response.json()

    return _query
