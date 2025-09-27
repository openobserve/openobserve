"""
Cache Testing Fixtures - DRY Implementation
Centralized fixtures using the new DRY architecture.
"""
import pytest
import os
import time
import requests
import json
import base64
from pathlib import Path
from typing import Dict, Any

from .core.cache_client import create_cache_client
from .mock.cache_mock import create_cache_mock

# Legacy support for existing tests
BASE_URL = os.environ.get("ZO_BASE_URL", "http://localhost:5080")


@pytest.fixture(scope="session")
def cache_config():
    """Cache testing configuration."""
    return {
        "base_url": os.getenv("ZO_BASE_URL", "http://localhost:5080"),
        "org": os.getenv("ZO_ORG", "default"),
        "username": os.getenv("ZO_ROOT_USER_EMAIL", "root@example.com"),
        "password": os.getenv("ZO_ROOT_USER_PASSWORD", "Complexpass#123"),
        "use_mock": os.getenv('MOCK_CACHE_TESTS', 'true').lower() == 'true',
        "query_cache": {
            "enabled": True,
            "ttl": 300,  # 5 minutes
            "max_size": "100MB"
        },
        "file_cache": {
            "enabled": True,
            "ttl": 3600,  # 1 hour
            "max_size": "500MB"
        },
        "metadata_cache": {
            "enabled": True,
            "ttl": 1800,  # 30 minutes
            "max_entries": 10000
        }
    }


@pytest.fixture(scope="session")
def cache_session(cache_config):
    """Authenticated session for cache testing."""
    session = requests.Session()
    
    if not cache_config["use_mock"]:
        # Only authenticate for real API calls
        auth_data = {
            "name": cache_config["username"],
            "password": cache_config["password"]
        }
        
        auth_url = f"{cache_config['base_url']}/auth/login"
        response = session.post(auth_url, json=auth_data)
        
        if response.status_code == 200:
            # Session is now authenticated
            pass
        else:
            # Fallback to basic auth for legacy support
            basic_auth = base64.b64encode(f"{cache_config['username']}:{cache_config['password']}".encode()).decode()
            session.headers.update({"Authorization": f"Basic {basic_auth}"})
    
    return session


# Legacy fixtures for backward compatibility
@pytest.fixture(scope="session")
def cache_base_url(cache_config):
    """Return the base URL for cache testing."""
    return cache_config["base_url"]


@pytest.fixture(scope="session")
def cache_org(cache_config):
    """Default organization for cache testing."""
    return cache_config["org"]


@pytest.fixture(scope="module")
def test_stream():
    """Test stream name for cache operations."""
    return "cache_test_stream"


@pytest.fixture(scope="function")
def cache_test_data():
    """Generate test data for cache operations."""
    return {
        "timestamp": int(time.time() * 1000000),  # microseconds
        "level": "INFO",
        "message": "Cache test message",
        "service": "cache-testing",
        "request_id": f"cache-test-{int(time.time())}"
    }


@pytest.fixture(scope="function", autouse=True)
def cache_cleanup(cache_session, cache_config):
    """Clean up cache state before and after each test."""
    yield
    # Cleanup logic would go here - for now just a placeholder
    # In real implementation, this would clear cache entries
    pass


# New DRY Architecture Fixtures
@pytest.fixture(scope="session")
def test_stream_with_data(cache_session, cache_config):
    """Ensure test stream exists with data."""
    if cache_config["use_mock"]:
        # Return mock stream name
        return "mock_cache_test_stream"
    
    # For real testing, ingest test data
    stream_name = f"cache_test_stream_{int(time.time())}"
    client = create_cache_client(cache_session, cache_config["base_url"], cache_config["org"])
    
    # Generate timestamp 2 days back to avoid cache timing issues
    current_time_us = int(time.time() * 1000000)
    base_time = current_time_us - (2 * 24 * 3600 * 1000000)  # 2 days ago
    
    # Ingest test data
    test_logs = []
    for i in range(1000):  # Generate 1000 records for better cache testing
        log_entry = {
            "_timestamp": base_time + (i * 60 * 1000000),  # 1 minute intervals
            "level": ["INFO", "DEBUG", "WARN", "ERROR"][i % 4],
            "message": f"Cache test log entry {i}",
            "source": "cache_test",
            "test_id": f"cache_test_{int(time.time())}",
            "iteration": i
        }
        test_logs.append(log_entry)
    
    # Ingest data
    ingest_url = f"{cache_config['base_url']}/api/{cache_config['org']}/{stream_name}/_json"
    response = cache_session.post(ingest_url, json=test_logs)
    
    if response.status_code in [200, 201]:
        # Wait for data to be indexed
        time.sleep(5)
        return stream_name
    else:
        pytest.skip(f"Failed to ingest test data: {response.status_code}")


@pytest.fixture
def cache_mock():
    """Cache mock for testing."""
    return create_cache_mock()


@pytest.fixture 
def cache_client(cache_session, cache_config):
    """Cache client for testing."""
    return create_cache_client(cache_session, cache_config["base_url"], cache_config["org"])


# Environment detection fixtures
@pytest.fixture
def is_ci_environment():
    """Detect if running in CI environment."""
    ci_indicators = [
        'CI', 'CONTINUOUS_INTEGRATION', 'GITHUB_ACTIONS', 
        'JENKINS_URL', 'TRAVIS', 'CIRCLECI'
    ]
    return any(os.getenv(indicator) for indicator in ci_indicators)


@pytest.fixture(autouse=True)
def configure_test_mode(cache_config, is_ci_environment):
    """Auto-configure test mode based on environment."""
    if is_ci_environment and not cache_config["use_mock"]:
        pytest.skip("Real cache testing not supported in CI - use MOCK_CACHE_TESTS=true")

@pytest.fixture(scope="session", autouse=True)
def ingest_cache_data(cache_session, cache_base_url, cache_org):
    """Ingest cache test data with timestamps from 2 days ago for real testing."""
    
    # Read cache test data
    cache_data_path = Path(__file__).parent / "fixtures" / "cache_test_data.json"
    with open(cache_data_path) as f:
        original_data = json.load(f)
    
    # Update timestamps to be 2 days ago (spread across 4 hours)
    current_time_us = int(time.time() * 1000000)  # Current time in microseconds
    two_days_ago_us = current_time_us - (2 * 24 * 3600 * 1000000)  # 2 days ago
    
    updated_data = []
    for i, record in enumerate(original_data):
        # Spread records across 4 hours, starting 2 days ago
        # Each record is ~12 minutes apart (4 hours / 20 records = 12 min each)
        record_timestamp = two_days_ago_us + (i * 12 * 60 * 1000000)
        record_copy = record.copy()
        record_copy["timestamp"] = record_timestamp
        updated_data.append(record_copy)
    
    # Convert back to JSON string
    data = json.dumps(updated_data, indent=2)

    stream_name = "cache_pytest_data_2days"  # Different stream name for this test
    url = f"{cache_base_url}api/{cache_org}/{stream_name}/_json"
    resp = cache_session.post(url, data=data, headers={"Content-Type": "application/json"})
    
    # Calculate time range for display
    start_time = two_days_ago_us
    end_time = two_days_ago_us + (4 * 3600 * 1000000)  # 4 hours later
    start_readable = time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(start_time / 1000000))
    end_readable = time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(end_time / 1000000))
    
    # Log cache test data ingestion (keeping essential info for debugging)
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Cache test data ingested: {len(updated_data)} records, stream={stream_name}, status={resp.status_code}, time_range={start_readable} to {end_readable}")
    
    return resp.status_code == 200

@pytest.fixture(scope="module")
def cache_test_stream():
    """Cache test stream name with 2-day-old data."""
    return "cache_pytest_data_2days"