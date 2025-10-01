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
from typing import Dict, Any, List

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


# DRY Shared Fixtures - Consolidated Setup Code

@pytest.fixture(scope="session")
def cache_timestamp_generator():
    """Generate consistent timestamps for cache testing."""
    def generate_timestamps(days_back: int = 2, duration_hours: int = 4, record_count: int = 1000):
        """Generate timestamps spread over duration."""
        current_time_us = int(time.time() * 1000000)
        base_time = current_time_us - (days_back * 24 * 3600 * 1000000)
        
        if record_count <= 1:
            return [base_time]
        
        interval_us = (duration_hours * 3600 * 1000000) // (record_count - 1)
        return [base_time + (i * interval_us) for i in range(record_count)]
    
    return generate_timestamps


@pytest.fixture(scope="session")
def cache_test_data_factory():
    """Factory for generating consistent test data."""
    def create_test_logs(record_count: int = 1000, timestamps: List[int] = None, test_id_suffix: str = ""):
        """Create standardized test log entries."""
        if timestamps is None:
            current_time_us = int(time.time() * 1000000)
            base_time = current_time_us - (2 * 24 * 3600 * 1000000)
            timestamps = [base_time + (i * 60 * 1000000) for i in range(record_count)]
        
        test_logs = []
        levels = ["INFO", "DEBUG", "WARN", "ERROR"]
        
        for i in range(min(record_count, len(timestamps))):
            log_entry = {
                "_timestamp": timestamps[i],
                "level": levels[i % len(levels)],
                "message": f"Cache test log entry {i}{test_id_suffix}",
                "source": "cache_test",
                "test_id": f"cache_test_{int(time.time())}{test_id_suffix}",
                "iteration": i
            }
            test_logs.append(log_entry)
        
        return test_logs
    
    return create_test_logs


@pytest.fixture(scope="session")
def cache_data_ingester():
    """Consolidated data ingestion logic."""
    def ingest_data(session: requests.Session, base_url: str, org: str, stream_name: str, data: List[Dict], wait_seconds: int = 5):
        """Ingest data and wait for indexing."""
        ingest_url = f"{base_url}/api/{org}/{stream_name}/_json"
        response = session.post(ingest_url, json=data)
        
        if response.status_code in [200, 201]:
            if wait_seconds > 0:
                time.sleep(wait_seconds)
            return True, response.status_code
        else:
            return False, response.status_code
    
    return ingest_data


@pytest.fixture(scope="session")
def test_stream_with_data(cache_session, cache_config, cache_timestamp_generator, cache_test_data_factory, cache_data_ingester):
    """Ensure test stream exists with data - DRY version."""
    if cache_config["use_mock"]:
        return "mock_cache_test_stream"
    
    # Use consolidated fixtures for real testing
    stream_name = f"cache_test_stream_{int(time.time())}"
    
    # Generate timestamps using shared fixture
    timestamps = cache_timestamp_generator(days_back=2, duration_hours=4, record_count=1000)
    
    # Create test data using shared factory
    test_logs = cache_test_data_factory(record_count=1000, timestamps=timestamps)
    
    # Ingest data using shared ingester
    success, status_code = cache_data_ingester(
        cache_session, 
        cache_config["base_url"], 
        cache_config["org"], 
        stream_name, 
        test_logs
    )
    
    if success:
        return stream_name
    else:
        pytest.skip(f"Failed to ingest test data: {status_code}")


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
def ingest_cache_data(cache_session, cache_base_url, cache_org, cache_timestamp_generator, cache_data_ingester):
    """Ingest cache test data with timestamps from 2 days ago - DRY version."""
    
    # Read cache test data
    cache_data_path = Path(__file__).parent / "fixtures" / "cache_test_data.json"
    with open(cache_data_path) as f:
        original_data = json.load(f)
    
    # Use shared timestamp generator
    timestamps = cache_timestamp_generator(days_back=2, duration_hours=4, record_count=len(original_data))
    
    # Update data with new timestamps
    updated_data = []
    for i, record in enumerate(original_data):
        record_copy = record.copy()
        record_copy["timestamp"] = timestamps[i]
        updated_data.append(record_copy)
    
    # Use shared ingester for consistency
    stream_name = "cache_pytest_data_2days"
    success, status_code = cache_data_ingester(
        cache_session, 
        cache_base_url.rstrip('/'), 
        cache_org, 
        stream_name, 
        updated_data, 
        wait_seconds=0  # No wait for autouse fixture
    )
    
    # Log using shared timestamp logic
    start_time, end_time = timestamps[0], timestamps[-1]
    start_readable = time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(start_time / 1000000))
    end_readable = time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(end_time / 1000000))
    
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Cache test data ingested: {len(updated_data)} records, stream={stream_name}, status={status_code}, time_range={start_readable} to {end_readable}")
    
    return success

@pytest.fixture(scope="module")
def cache_test_stream():
    """Cache test stream name with 2-day-old data."""
    return "cache_pytest_data_2days"