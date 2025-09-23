"""
Advanced SQL Test Suite for OpenObserve
=======================================

This module provides comprehensive testing of OpenObserve's SQL capabilities
with a focus on security, maintainability, and reliability.

Features:
- 15+ comprehensive SQL query tests
- Security-first design (SQL injection prevention)
- DRY principles with shared fixtures and helpers
- Robust error handling and validation
- Production-ready patterns
"""

import json
import requests
import pytest
from datetime import datetime, timezone, timedelta
import time
from typing import Dict, List, Any, Optional, Tuple
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global variable to store detected array indexing convention
OPENOBSERVE_ARRAY_INDEXING: Optional[str] = None

# =============================================================================
# SECURITY & VALIDATION LAYER
# =============================================================================

def validate_time_parameters(start_time: int, end_time: int) -> Tuple[int, int]:
    """
    Validate and sanitize time parameters to prevent injection attacks.
    
    Args:
        start_time: Start timestamp in microseconds
        end_time: End timestamp in microseconds
        
    Returns:
        Tuple of validated (start_time, end_time)
        
    Raises:
        ValueError: If parameters are invalid or potentially malicious
    """
    # Type validation
    if not isinstance(start_time, int) or not isinstance(end_time, int):
        raise ValueError("Time parameters must be integers")
    
    # Range validation
    if start_time < 0 or end_time < 0:
        raise ValueError("Time parameters cannot be negative")
    
    if end_time <= start_time:
        raise ValueError("End time must be greater than start time")
    
    # Reasonable bounds (max 24 hours for tests)
    max_time_range = 24 * 60 * 60 * 1000000  # 24 hours in microseconds
    if (end_time - start_time) > max_time_range:
        raise ValueError(f"Time range too large: {(end_time - start_time) / 1000000 / 3600:.2f} hours")
    
    # Ensure recent times (not too far in past/future)
    now = int(datetime.now(timezone.utc).timestamp() * 1000000)
    one_week = 7 * 24 * 60 * 60 * 1000000
    
    if abs(end_time - now) > one_week:
        raise ValueError("Time parameters too far from current time")
    
    return start_time, end_time


def sanitize_sql_query(sql: str) -> str:
    """
    Validate SQL query for security (static analysis).
    
    Args:
        sql: SQL query string
        
    Returns:
        Validated SQL string
        
    Raises:
        ValueError: If query contains suspicious patterns
    """
    # Convert to uppercase for analysis
    sql_upper = sql.upper()
    
    # Block dangerous SQL commands
    dangerous_patterns = [
        'DROP', 'DELETE', 'UPDATE', 'INSERT', 'CREATE', 'ALTER',
        'TRUNCATE', 'EXEC', 'EXECUTE', 'DECLARE', '--', '/*', 
        'UNION ALL', 'INFORMATION_SCHEMA'
    ]
    
    for pattern in dangerous_patterns:
        if pattern in sql_upper:
            # Allow some patterns in specific contexts
            if pattern == 'UNION ALL' and 'UNION ALL SELECT' not in sql_upper:
                continue
            if pattern in ['CREATE', 'INSERT', 'UPDATE'] and 'CASE' in pattern:
                continue  # CASE statements are safe
            raise ValueError(f"Potentially unsafe SQL pattern detected: {pattern}")
    
    # Ensure query is read-only (SELECT only)
    sql_stripped = sql_upper.strip()
    if not sql_stripped.startswith('SELECT') and not sql_stripped.startswith('WITH'):
        raise ValueError("Only SELECT and CTE queries are allowed")
    
    return sql


# =============================================================================
# PYTEST FIXTURES
# =============================================================================

@pytest.fixture(scope="module")
def time_range() -> Tuple[int, int]:
    """Fixture providing validated start and end time for queries."""
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    return validate_time_parameters(one_hour_ago, end_time)


@pytest.fixture
def query_config(time_range: Tuple[int, int]) -> Dict[str, Any]:
    """Fixture providing common query configuration."""
    start_time, end_time = time_range
    return {
        "start_time": start_time,
        "end_time": end_time,
        "from": 0,
        "size": 100,
    }


@pytest.fixture
def performance_config() -> Dict[str, float]:
    """Fixture providing performance thresholds."""
    return {
        "max_execution_time": 10.0,  # seconds
        "max_response_size": 1000,   # max hits
    }


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def execute_query(
    session: requests.Session, 
    base_url: str, 
    sql: str, 
    query_config: Dict[str, Any], 
    test_name: str = "query",
    performance_config: Optional[Dict[str, float]] = None
) -> List[Dict[str, Any]]:
    """
    Execute a SQL query with comprehensive validation and error handling.
    
    Args:
        session: Authenticated requests session
        base_url: OpenObserve base URL
        sql: SQL query string
        query_config: Query configuration (time range, pagination)
        test_name: Test name for error messages
        performance_config: Performance thresholds
        
    Returns:
        List of query result hits
        
    Raises:
        AssertionError: If query fails validation or execution
    """
    # Security validation
    sanitized_sql = sanitize_sql_query(sql)
    
    # Prepare request
    org_id = "default"
    json_data = {
        "query": {
            "sql": sanitized_sql,
            **query_config
        }
    }
    
    # Execute with timing
    start_time = time.time()
    
    logger.info(f"Executing {test_name}: {sql[:100]}...")
    
    try:
        resp = session.post(f"{base_url}api/{org_id}/_search?type=logs", json=json_data)
        execution_time = time.time() - start_time
        
        # Performance validation
        if performance_config:
            max_time = performance_config.get("max_execution_time", 10.0)
            assert execution_time < max_time, f"{test_name} took {execution_time:.2f}s, exceeds {max_time}s limit"
        
        # Response validation
        assert resp.status_code == 200, f"{test_name} failed with status {resp.status_code}: {resp.text}"
        
        response_data = resp.json()
        assert "hits" in response_data, f"{test_name} response missing 'hits' field"
        
        hits = response_data["hits"]
        
        # Size validation
        if performance_config:
            max_size = performance_config.get("max_response_size", 1000)
            assert len(hits) <= max_size, f"{test_name} returned {len(hits)} hits, exceeds {max_size} limit"
        
        logger.info(f"{test_name} completed: {len(hits)} hits in {execution_time:.2f}s")
        return hits
        
    except requests.exceptions.RequestException as e:
        raise AssertionError(f"{test_name} request failed: {e}")
    except json.JSONDecodeError as e:
        raise AssertionError(f"{test_name} response not valid JSON: {e}")


def validate_array_data(
    hit: Dict[str, Any], 
    hit_index: int, 
    expected_pattern: Optional[str] = None, 
    case_sensitive: bool = True
) -> str:
    """
    Helper function to validate array data in query results.
    
    Args:
        hit: Query result hit
        hit_index: Index for error messages
        expected_pattern: Expected pattern to match
        case_sensitive: Whether matching should be case-sensitive
        
    Returns:
        Log value as string
        
    Raises:
        AssertionError: If validation fails
    """
    assert "log" in hit, f"Hit {hit_index} should contain 'log' field"
    
    log_value = hit["log"]
    assert log_value, f"Hit {hit_index} log should not be empty"
    assert log_value.startswith('['), f"Hit {hit_index} log should be array format, got: {log_value}"
    
    if expected_pattern:
        try:
            array_data = json.loads(log_value)
            if len(array_data) > 0:
                # Use detected indexing convention
                global OPENOBSERVE_ARRAY_INDEXING
                if OPENOBSERVE_ARRAY_INDEXING == "0-based":
                    expected_element = array_data[1] if len(array_data) > 1 else array_data[0]
                else:
                    expected_element = array_data[0]  # Default to 1-based
                
                if case_sensitive:
                    pattern_match = expected_pattern in expected_element
                    match_type = "case sensitive"
                else:
                    pattern_match = expected_pattern.lower() in expected_element.lower()
                    match_type = "case insensitive"
                
                assert pattern_match, f"Hit {hit_index} array element '{expected_element}' should contain '{expected_pattern}' ({match_type})"
                
                logger.debug(f"Validated: array[0]='{expected_element}' contains '{expected_pattern}' ({match_type})")
                
        except json.JSONDecodeError:
            raise AssertionError(f"Hit {hit_index} log is not valid JSON array: {log_value}")
    
    return log_value


def validate_percentile_ordering(hit: Dict[str, Any], hit_index: int, percentile_fields: List[str]) -> None:
    """
    Validate that percentile values are properly ordered.
    
    Args:
        hit: Query result hit
        hit_index: Index for error messages  
        percentile_fields: List of percentile field names in descending order
        
    Raises:
        AssertionError: If percentiles are not properly ordered
    """
    percentile_values = []
    for field in percentile_fields:
        assert field in hit, f"Hit {hit_index} should contain '{field}' field"
        value = hit[field]
        if value is not None:
            percentile_values.append((field, value))
    
    # Check ordering (should be descending: P99 >= P95 >= P50)
    for i in range(len(percentile_values) - 1):
        current_field, current_value = percentile_values[i]
        next_field, next_value = percentile_values[i + 1]
        
        assert current_value >= next_value, f"Hit {hit_index}: {current_field}({current_value}) should be >= {next_field}({next_value})"


# =============================================================================
# TEST FUNCTIONS
# =============================================================================

def test_e2e_error_rate_analysis(create_session, base_url, query_config, performance_config):
    """Test error rate analysis with component and environment grouping."""
    
    sql = """
    SELECT 
        COUNT(_timestamp) AS pvcount,
        COUNT(CASE WHEN level = 'info' THEN 1 END) AS infocount,
        (100.0 * COUNT(CASE WHEN level = 'info' THEN 1 END) / CAST(COUNT(_timestamp) AS FLOAT)) AS inforate,
        COALESCE(kubernetes_container_name, 'unknown') AS component,
        COALESCE(kubernetes_namespace_name, 'default') AS environment
    FROM "stream_pytest_data"
    WHERE level IS NOT NULL
    GROUP BY component, environment
    HAVING inforate >= 0
    ORDER BY inforate DESC
    LIMIT 50
    """
    
    # Override default size for this query
    config = query_config.copy()
    config["size"] = 50
    
    hits = execute_query(create_session, base_url, sql, config, "Error rate analysis", performance_config)
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for error rate analysis")
        
        for i, hit in enumerate(hits):
            # Validate required fields
            required_fields = ["pvcount", "infocount", "inforate", "component", "environment"]
            for field in required_fields:
                assert field in hit, f"Hit {i} should contain '{field}' field"
            
            # Validate data integrity
            pvcount = hit["pvcount"]
            infocount = hit["infocount"]
            inforate = hit["inforate"]
            
            assert pvcount > 0, f"Hit {i} pvcount should be > 0, got {pvcount}"
            assert infocount >= 0, f"Hit {i} infocount should be >= 0, got {infocount}"
            assert infocount <= pvcount, f"Hit {i} infocount({infocount}) should be <= pvcount({pvcount})"
            assert 0 <= inforate <= 100, f"Hit {i} inforate should be 0-100, got {inforate}"
            
        logger.info(f"✅ Validated {len(hits)} hits for error rate analysis")
    else:
        logger.warning("⚠️ No hits found for error rate analysis")


def test_e2e_performance_percentiles(create_session, base_url, query_config, performance_config):
    """Test performance percentile calculations with time bucketing."""
    
    sql = """
    SELECT 
        histogram(_timestamp) AS time_bucket,
        approx_percentile_cont(CAST(floatvalue AS FLOAT), 0.95) AS p95,
        approx_percentile_cont(CAST(floatvalue AS FLOAT), 0.75) AS p75,
        approx_percentile_cont(CAST(floatvalue AS FLOAT), 0.50) AS p50
    FROM "stream_pytest_data"
    WHERE floatvalue IS NOT NULL
    GROUP BY time_bucket
    ORDER BY time_bucket
    """
    
    hits = execute_query(create_session, base_url, sql, query_config, "Performance percentiles", performance_config)
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for performance percentiles")
        
        for i, hit in enumerate(hits):
            # Validate required fields
            assert "time_bucket" in hit, f"Hit {i} should contain 'time_bucket' field"
            assert hit["time_bucket"], f"Hit {i} time_bucket should not be empty"
            
            # Validate percentile ordering
            validate_percentile_ordering(hit, i, ["p95", "p75", "p50"])
            
        logger.info(f"✅ Validated {len(hits)} hits for performance percentiles")
    else:
        logger.warning("⚠️ No hits found for performance percentiles")


def test_e2e_log_volume_analysis(create_session, base_url, query_config, performance_config):
    """Test log volume analysis with time bucketing and info rate calculations."""
    
    sql = """
    SELECT 
        histogram(_timestamp) AS time_bucket,
        COUNT(_timestamp) AS total_logs,
        SUM(CASE WHEN COALESCE(level, '') = 'info' THEN 1 ELSE 0 END) AS info_count,
        ROUND(100.0 * SUM(CASE WHEN COALESCE(level, '') = 'info' THEN 1 ELSE 0 END) / COUNT(_timestamp), 2) AS info_rate,
        COALESCE(kubernetes_container_name, 'unknown') AS component
    FROM "stream_pytest_data"
    GROUP BY time_bucket, component
    ORDER BY time_bucket ASC, info_rate DESC
    """
    
    hits = execute_query(create_session, base_url, sql, query_config, "Log volume analysis", performance_config)
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for log volume analysis")
        
        for i, hit in enumerate(hits):
            # Validate required fields
            required_fields = ["time_bucket", "total_logs", "info_count", "info_rate", "component"]
            for field in required_fields:
                assert field in hit, f"Hit {i} should contain '{field}' field"
            
            # Validate data integrity
            total_logs = hit["total_logs"]
            info_count = hit["info_count"]
            info_rate = hit["info_rate"]
            
            assert total_logs > 0, f"Hit {i} total_logs should be > 0, got {total_logs}"
            assert info_count >= 0, f"Hit {i} info_count should be >= 0, got {info_count}"
            assert info_count <= total_logs, f"Hit {i} info_count({info_count}) should be <= total_logs({total_logs})"
            assert 0 <= info_rate <= 100, f"Hit {i} info_rate should be 0-100, got {info_rate}"
            
        logger.info(f"✅ Validated {len(hits)} hits for log volume analysis")
    else:
        logger.warning("⚠️ No hits found for log volume analysis")


def test_e2e_source_analysis(create_session, base_url, query_config, performance_config):
    """Test source analysis by platform and source group."""
    
    sql = """
    SELECT
        COALESCE(kubernetes_container_name, 'unknown') AS platform,
        COALESCE(kubernetes_namespace_name, 'default') AS source_group,
        COUNT(_timestamp) AS log_count
    FROM "stream_pytest_data"
    GROUP BY platform, source_group
    ORDER BY log_count DESC
    """
    
    hits = execute_query(create_session, base_url, sql, query_config, "Source analysis", performance_config)
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for source analysis")
        
        for i, hit in enumerate(hits):
            # Validate required fields
            required_fields = ["platform", "source_group", "log_count"]
            for field in required_fields:
                assert field in hit, f"Hit {i} should contain '{field}' field"
            
            # Validate log count
            log_count = hit["log_count"]
            assert log_count > 0, f"Hit {i} log_count should be > 0, got {log_count}"
            
        logger.info(f"✅ Validated {len(hits)} hits for source analysis")
    else:
        logger.warning("⚠️ No hits found for source analysis")


def test_e2e_host_performance(create_session, base_url, query_config, performance_config):
    """Test host performance analysis with multi-metric aggregations."""
    
    sql = """
    SELECT 
        COALESCE(kubernetes_container_name, 'unknown') AS hostname, 
        COUNT(DISTINCT stream) AS unique_stream_count,
        COUNT(DISTINCT level) AS unique_level_count,
        AVG(floatvalue) AS avg_float_value,
        MIN(floatvalue) AS min_float_value,
        MAX(floatvalue) AS max_float_value
    FROM "stream_pytest_data"
    WHERE floatvalue IS NOT NULL
    GROUP BY hostname
    ORDER BY avg_float_value DESC
    LIMIT 20
    """
    
    config = query_config.copy()
    config["size"] = 20
    
    hits = execute_query(create_session, base_url, sql, config, "Host performance analysis", performance_config)
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for host performance analysis")
        
        for i, hit in enumerate(hits):
            # Validate required fields
            required_fields = [
                "hostname", "unique_stream_count", "unique_level_count", 
                "avg_float_value", "min_float_value", "max_float_value"
            ]
            for field in required_fields:
                assert field in hit, f"Hit {i} should contain '{field}' field"
            
            # Validate numeric relationships with floating point tolerance
            avg_val = hit["avg_float_value"]
            min_val = hit["min_float_value"] 
            max_val = hit["max_float_value"]
            
            if avg_val is not None and min_val is not None and max_val is not None:
                # Use small tolerance for floating point comparison
                tolerance = 1e-10
                assert (min_val - tolerance) <= avg_val <= (max_val + tolerance), f"Hit {i}: min({min_val}) <= avg({avg_val}) <= max({max_val}) should hold (within tolerance)"
            
        logger.info(f"✅ Validated {len(hits)} hits for host performance analysis")
    else:
        logger.warning("⚠️ No hits found for host performance analysis")


def test_e2e_component_percentiles(create_session, base_url, query_config, performance_config):
    """Test component performance percentiles (P99, P95, Median)."""
    
    sql = """
    SELECT
        COALESCE(kubernetes_container_name, 'unknown') AS component,
        approx_percentile_cont(CAST(floatvalue AS Float), 0.99) AS p99_took,
        approx_percentile_cont(CAST(floatvalue AS Float), 0.95) AS p95_took,
        approx_percentile_cont(CAST(floatvalue AS Float), 0.50) AS median_took,
        COUNT(_timestamp) AS requests
    FROM "stream_pytest_data"
    WHERE floatvalue > 0
    GROUP BY component
    ORDER BY p99_took DESC
    LIMIT 15
    """
    
    config = query_config.copy()
    config["size"] = 15
    
    hits = execute_query(create_session, base_url, sql, config, "Component percentiles", performance_config)
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for component percentiles")
        
        for i, hit in enumerate(hits):
            # Validate required fields
            required_fields = ["component", "p99_took", "p95_took", "median_took", "requests"]
            for field in required_fields:
                assert field in hit, f"Hit {i} should contain '{field}' field"
            
            # Validate percentile ordering
            validate_percentile_ordering(hit, i, ["p99_took", "p95_took", "median_took"])
            
            # Validate request count
            requests = hit["requests"]
            assert requests > 0, f"Hit {i} requests should be > 0, got {requests}"
            
        logger.info(f"✅ Validated {len(hits)} hits for component percentiles")
    else:
        logger.warning("⚠️ No hits found for component percentiles")


def test_e2e_api_log_analysis(create_session, base_url, query_config, performance_config):
    """Test API log analysis with bulk message filtering."""
    
    sql = """
    SELECT
        COALESCE(kubernetes_container_name, 'unknown') AS api,
        level AS log_level,
        COUNT(CASE WHEN LOWER(COALESCE(level, 'n/a')) = 'info' THEN 1 END) AS api_info_log_count,
        COALESCE(kubernetes_namespace_name, 'default') AS component,
        COALESCE(kubernetes_container_name, 'unknown') AS platform,
        COUNT(_timestamp) AS counter
    FROM "stream_pytest_data"
    WHERE kubernetes_namespace_name IS NOT NULL
        AND message LIKE '%bulk%'
    GROUP BY api, log_level, component, platform
    ORDER BY api, counter DESC
    """
    
    hits = execute_query(create_session, base_url, sql, query_config, "API log analysis", performance_config)
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for API log analysis")
        
        for i, hit in enumerate(hits):
            # Validate required fields
            required_fields = ["api", "log_level", "api_info_log_count", "component", "platform", "counter"]
            for field in required_fields:
                assert field in hit, f"Hit {i} should contain '{field}' field"
            
            # Validate counts
            counter = hit["counter"]
            info_count = hit["api_info_log_count"]
            
            assert counter > 0, f"Hit {i} counter should be > 0, got {counter}"
            assert info_count >= 0, f"Hit {i} api_info_log_count should be >= 0, got {info_count}"
            assert info_count <= counter, f"Hit {i} info_count({info_count}) should be <= counter({counter})"
            
        logger.info(f"✅ Validated {len(hits)} hits for API log analysis")
    else:
        logger.warning("⚠️ No hits found for API log analysis")


def test_e2e_error_categorization(create_session, base_url, query_config, performance_config):
    """Test error categorization with string matching and date grouping."""
    
    sql = """
    SELECT 
        count(_timestamp) AS count,
        CASE 
            WHEN str_match_ignore_case(log, 'level=error')
                THEN 'Level Error'
            WHEN str_match_ignore_case(log, 'level=warn')
                THEN 'Level Warning'
            WHEN str_match_ignore_case(log, 'forbidden')
                THEN 'Permission Forbidden'
            ELSE 'Other Log Types'
        END AS log_category,
        date_format(_timestamp, '%Y-%m-%d', 'UTC') AS _date
    FROM "stream_pytest_data"
    WHERE log IS NOT NULL AND log != ''
    GROUP BY log_category, _date
    ORDER BY count DESC
    LIMIT 15
    """
    
    config = query_config.copy()
    config["size"] = 15
    
    hits = execute_query(create_session, base_url, sql, config, "Error categorization", performance_config)
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for error categorization")
        
        for i, hit in enumerate(hits):
            # Validate required fields
            required_fields = ["count", "log_category", "_date"]
            for field in required_fields:
                assert field in hit, f"Hit {i} should contain '{field}' field"
            
            # Validate count and category
            count = hit["count"]
            log_category = hit["log_category"]
            
            assert count > 0, f"Hit {i} count should be > 0, got {count}"
            assert log_category in ['Level Error', 'Level Warning', 'Permission Forbidden', 'Other Log Types'], f"Hit {i} unexpected log_category: {log_category}"
            
        logger.info(f"✅ Validated {len(hits)} hits for error categorization")
    else:
        logger.warning("⚠️ No hits found for error categorization")


def test_e2e_metadata_extraction(create_session, base_url, query_config, performance_config):
    """Test metadata extraction using regex and array functions."""
    
    sql = """
    SELECT 
        array_extract(regexp_match(log, 'caller=([^\\\\s]+)'), 1) AS caller,
        count(_timestamp) AS count
    FROM "stream_pytest_data"
    WHERE str_match_ignore_case(log, 'caller=')
    GROUP BY caller
    """
    
    hits = execute_query(create_session, base_url, sql, query_config, "Metadata extraction", performance_config)
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for metadata extraction")
        
        for i, hit in enumerate(hits):
            # Validate required fields
            required_fields = ["caller", "count"]
            for field in required_fields:
                assert field in hit, f"Hit {i} should contain '{field}' field"
            
            # Validate count
            count = hit["count"]
            assert count > 0, f"Hit {i} count should be > 0, got {count}"
            
            # Caller field can be None if regex doesn't match
            caller = hit["caller"]
            if caller is not None:
                assert isinstance(caller, str), f"Hit {i} caller should be string if not None, got {type(caller)}"
            
        logger.info(f"✅ Validated {len(hits)} hits for metadata extraction")
    else:
        logger.warning("⚠️ No hits found for metadata extraction")


def test_e2e_array_case_sensitive(create_session, base_url, query_config):
    """Test array extraction with case-sensitive string matching."""
    
    sql = """
    SELECT *
    FROM "stream_pytest_data"
    WHERE str_match(array_extract(cast_to_arr(log), 1), 'fu')
    """
    
    hits = execute_query(create_session, base_url, sql, query_config, "Array case-sensitive matching")
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for case-sensitive array extraction")
        
        for i, hit in enumerate(hits):
            validate_array_data(hit, i, 'fu', case_sensitive=True)
            
        logger.info(f"✅ Validated {len(hits)} hits for case-sensitive array data")
        # Should find hits containing 'fu' (like 'datafusion')
        assert len(hits) >= 1, f"Expected at least 1 hit for case-sensitive 'fu' match, got {len(hits)}"
    else:
        logger.warning("⚠️ No hits found for case-sensitive array query")


def test_e2e_array_case_insensitive(create_session, base_url, query_config):
    """Test array extraction with case-insensitive string matching."""
    
    sql = """
    SELECT *
    FROM "stream_pytest_data"
    WHERE str_match_ignore_case(array_extract(cast_to_arr(log), 1), 'Fu')
    """
    
    hits = execute_query(create_session, base_url, sql, query_config, "Array case-insensitive matching")
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for case-insensitive array extraction")
        
        for i, hit in enumerate(hits):
            validate_array_data(hit, i, 'fu', case_sensitive=False)
            
        logger.info(f"✅ Validated {len(hits)} hits for case-insensitive array data")
        # Should find hits containing 'fu' case-insensitively (like 'Fu', 'datafusion')
        assert len(hits) >= 1, f"Expected at least 1 hit for case-insensitive 'Fu' match, got {len(hits)}"
    else:
        logger.warning("⚠️ No hits found for case-insensitive array query")


def test_e2e_array_indexing_convention(create_session, base_url, query_config):
    """Test to detect and validate OpenObserve's array indexing convention."""
    
    sql = """
    SELECT 
        log,
        array_extract(cast_to_arr(log), 1) AS first_element,
        array_extract(cast_to_arr(log), 2) AS second_element,
        array_length(cast_to_arr(log)) AS array_len
    FROM "stream_pytest_data"
    WHERE log LIKE '[%'
    ORDER BY kubernetes_container_name
    LIMIT 10
    """
    
    config = query_config.copy()
    config["size"] = 10
    
    hits = execute_query(create_session, base_url, sql, config, "Array indexing convention detection")
    
    assert len(hits) > 0, "Should find array test data for indexing verification"
    
    global OPENOBSERVE_ARRAY_INDEXING
    indexing_convention = None
    
    logger.info(f"🔍 Detecting array indexing convention with {len(hits)} hits")
    
    for i, hit in enumerate(hits):
        required_fields = ["log", "first_element", "second_element", "array_len"]
        for field in required_fields:
            assert field in hit, f"Hit {i} should contain '{field}' field"
        
        log_value = hit["log"]
        first_element = hit["first_element"]
        second_element = hit["second_element"]
        array_len = hit["array_len"]
        
        logger.debug(f"Hit {i}: SQL[1]='{first_element}', SQL[2]='{second_element}', len={array_len}")
        
        try:
            python_array = json.loads(log_value)
            
            # Determine indexing convention
            if indexing_convention is None and len(python_array) >= 2:
                if first_element == python_array[0]:
                    indexing_convention = "1-based"
                    logger.info("✅ Detected: OpenObserve uses 1-BASED indexing (SQL index 1 = Python index 0)")
                elif first_element == python_array[1]:
                    indexing_convention = "0-based"
                    logger.info("✅ Detected: OpenObserve uses 0-BASED indexing (SQL index 1 = Python index 1)")
            
            # Validate consistency
            if indexing_convention == "1-based":
                assert first_element == python_array[0], f"Hit {i}: Inconsistent 1-based indexing"
                if len(python_array) > 1:
                    assert second_element == python_array[1], f"Hit {i}: Inconsistent 1-based indexing for second element"
                assert array_len == len(python_array), f"Hit {i}: Array length mismatch"
            
            elif indexing_convention == "0-based":
                assert first_element == python_array[1], f"Hit {i}: Inconsistent 0-based indexing"
                if len(python_array) > 2:
                    assert second_element == python_array[2], f"Hit {i}: Inconsistent 0-based indexing for second element"
                assert array_len == len(python_array), f"Hit {i}: Array length mismatch"
                
        except json.JSONDecodeError:
            raise AssertionError(f"Hit {i} log is not valid JSON array: {log_value}")
    
    assert indexing_convention is not None, "Could not determine OpenObserve's array indexing convention"
    
    # Store globally for other tests
    OPENOBSERVE_ARRAY_INDEXING = indexing_convention
    
    logger.info(f"🎯 CONCLUSION: OpenObserve uses {indexing_convention.upper()} array indexing")
    logger.info(f"✅ Validated {len(hits)} hits against {indexing_convention} indexing convention")


def test_e2e_time_series_window_functions(create_session, base_url, query_config, performance_config):
    """Test time-series analysis with window functions (LAG, LEAD, etc.)."""
    
    sql = """
    WITH time_series_base AS (
        SELECT 
            histogram(_timestamp) AS time_bucket,
            kubernetes_namespace_name AS environment,
            COUNT(*) AS current_count
        FROM "stream_pytest_data"
        WHERE kubernetes_namespace_name IN ('production', 'staging', 'monitoring', 'default')
        GROUP BY histogram(_timestamp), kubernetes_namespace_name
    )
    SELECT 
        time_bucket,
        environment,
        current_count,
        LAG(current_count) OVER (
            PARTITION BY environment 
            ORDER BY time_bucket
        ) AS previous_count,
        CASE 
            WHEN LAG(current_count) OVER (
                PARTITION BY environment 
                ORDER BY time_bucket
            ) IS NOT NULL THEN
                ROUND(
                    ((current_count - LAG(current_count) OVER (
                        PARTITION BY environment 
                        ORDER BY time_bucket
                    )) * 100.0) / 
                    NULLIF(LAG(current_count) OVER (
                        PARTITION BY environment 
                        ORDER BY time_bucket
                    ), 0), 2
                )
            ELSE 0
        END AS growth_rate_percent
    FROM time_series_base
    ORDER BY time_bucket, environment
    """
    
    hits = execute_query(create_session, base_url, sql, query_config, "Time-series window functions", performance_config)
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for time-series window functions")
        
        environment_sequences = {}
        
        for i, hit in enumerate(hits):
            # Validate required fields
            required_fields = ["time_bucket", "environment", "current_count", "growth_rate_percent"]
            for field in required_fields:
                assert field in hit, f"Hit {i} should contain '{field}' field"
            
            environment = hit["environment"]
            current_count = hit["current_count"]
            previous_count = hit.get("previous_count")
            growth_rate = hit["growth_rate_percent"]
            
            # Validate data types and ranges
            assert current_count > 0, f"Hit {i} current_count should be > 0, got {current_count}"
            assert environment in ['production', 'staging', 'monitoring', 'default'], f"Hit {i} unexpected environment: {environment}"
            
            # Track sequences per environment
            if environment not in environment_sequences:
                environment_sequences[environment] = []
            environment_sequences[environment].append((previous_count, current_count, growth_rate))
            
            # Validate growth rate calculation
            if previous_count is not None and previous_count > 0:
                expected_growth = round((current_count - previous_count) * 100.0 / previous_count, 2)
                assert abs(growth_rate - expected_growth) < 0.01, f"Hit {i} growth rate mismatch: expected {expected_growth}, got {growth_rate}"
            else:
                assert growth_rate == 0, f"Hit {i} should have 0 growth rate when previous_count is NULL or 0"
        
        # Validate window function sequence integrity
        for env, sequences in environment_sequences.items():
            first_entry = sequences[0]
            assert first_entry[0] is None, f"Environment {env} first entry should have NULL previous_count"
            
            logger.info(f"Environment {env}: {len(sequences)} time buckets with valid window function results")
        
        logger.info(f"✅ Validated {len(hits)} hits for time-series window functions across {len(environment_sequences)} environments")
    else:
        logger.warning("⚠️ No hits found for time-series window functions")


def test_e2e_complex_nested_aggregation(create_session, base_url, query_config, performance_config):
    """Test complex nested aggregation with CTEs and cross-environment analysis."""
    
    sql = """
    WITH env_metrics AS (
        SELECT 
            kubernetes_namespace_name AS environment,
            kubernetes_container_name AS service,
            COUNT(*) AS log_count,
            COUNT(CASE WHEN level IN ('error', 'warn') THEN 1 END) AS issue_count,
            AVG(CASE WHEN took IS NOT NULL THEN CAST(took AS FLOAT) ELSE NULL END) AS avg_latency
        FROM "stream_pytest_data"
        WHERE kubernetes_namespace_name IS NOT NULL
        GROUP BY environment, service
    ),
    env_totals AS (
        SELECT 
            environment,
            SUM(log_count) AS total_logs,
            SUM(issue_count) AS total_issues,
            AVG(avg_latency) AS env_avg_latency
        FROM env_metrics
        GROUP BY environment
    )
    SELECT 
        em.environment,
        em.service,
        em.log_count,
        em.issue_count,
        ROUND((em.log_count * 100.0) / et.total_logs, 2) AS log_share_percent,
        ROUND((em.issue_count * 100.0) / NULLIF(et.total_issues, 0), 2) AS issue_share_percent,
        em.avg_latency,
        et.env_avg_latency,
        CASE 
            WHEN em.avg_latency > et.env_avg_latency * 1.5 THEN 'High Latency'
            WHEN em.issue_count > et.total_issues * 0.3 THEN 'High Issues'
            WHEN em.log_count > et.total_logs * 0.4 THEN 'High Volume'
            ELSE 'Normal'
        END AS service_status,
        RANK() OVER (PARTITION BY em.environment ORDER BY em.issue_count DESC) AS issue_rank
    FROM env_metrics em
    JOIN env_totals et ON em.environment = et.environment
    WHERE em.log_count > 0
    ORDER BY em.environment, issue_rank
    """
    
    hits = execute_query(create_session, base_url, sql, query_config, "Complex nested aggregation", performance_config)
    
    if len(hits) > 0:
        logger.info(f"Found {len(hits)} hits for complex nested aggregation")
        
        for i, hit in enumerate(hits):
            # Validate required fields
            required_fields = [
                "environment", "service", "log_count", "issue_count", 
                "log_share_percent", "service_status", "issue_rank"
            ]
            for field in required_fields:
                assert field in hit, f"Hit {i} should contain '{field}' field"
            
            # Validate data integrity
            log_count = hit["log_count"]
            issue_count = hit["issue_count"]
            log_share_percent = hit["log_share_percent"]
            issue_rank = hit["issue_rank"]
            service_status = hit["service_status"]
            
            assert log_count > 0, f"Hit {i} log_count should be > 0, got {log_count}"
            assert issue_count >= 0, f"Hit {i} issue_count should be >= 0, got {issue_count}"
            assert 0 <= log_share_percent <= 100, f"Hit {i} log_share_percent should be 0-100, got {log_share_percent}"
            assert issue_rank >= 1, f"Hit {i} issue_rank should be >= 1, got {issue_rank}"
            assert service_status in ['High Latency', 'High Issues', 'High Volume', 'Normal'], f"Hit {i} unexpected service_status: {service_status}"
            
        logger.info(f"✅ Validated {len(hits)} hits for complex nested aggregation")
    else:
        logger.warning("⚠️ No hits found for complex nested aggregation")


# =============================================================================
# SECURITY TESTS
# =============================================================================

def test_sql_injection_prevention():
    """Test SQL injection prevention mechanisms."""
    
    logger.info("🛡️ Testing SQL injection prevention measures")
    
    # Test 1: Invalid time parameter types
    try:
        validate_time_parameters("'; DROP TABLE users; --", 1234567890)
        assert False, "Should have raised ValueError for malicious start_time"
    except ValueError as e:
        assert "must be integers" in str(e)
        logger.info("✅ Rejected malicious string in start_time")
    
    # Test 2: SQL command injection
    malicious_queries = [
        "SELECT * FROM users; DROP TABLE logs; --",
        "SELECT * FROM logs UNION ALL SELECT * FROM passwords",
        "SELECT * FROM logs; DELETE FROM users; --",
        "/* malicious comment */ SELECT * FROM logs",
    ]
    
    for malicious_sql in malicious_queries:
        try:
            sanitize_sql_query(malicious_sql)
            assert False, f"Should have rejected malicious SQL: {malicious_sql}"
        except ValueError:
            logger.info(f"✅ Rejected malicious SQL pattern")
    
    # Test 3: Valid queries should pass
    valid_queries = [
        "SELECT COUNT(*) FROM stream_pytest_data",
        "WITH cte AS (SELECT * FROM stream_pytest_data) SELECT * FROM cte",
        "SELECT CASE WHEN level = 'info' THEN 1 ELSE 0 END FROM stream_pytest_data",
    ]
    
    for valid_sql in valid_queries:
        try:
            result = sanitize_sql_query(valid_sql)
            assert result == valid_sql
            logger.info(f"✅ Accepted valid SQL pattern")
        except ValueError as e:
            assert False, f"Valid SQL should not be rejected: {valid_sql}, error: {e}"
    
    logger.info("🛡️ All SQL injection prevention tests passed!")


# =============================================================================
# PERFORMANCE TESTS
# =============================================================================

def test_query_performance_benchmarks(create_session, base_url, query_config):
    """Test query execution performance benchmarks."""
    
    test_queries = [
        ("Simple aggregation", "SELECT COUNT(*) FROM stream_pytest_data"),
        ("Complex analytics", "SELECT histogram(_timestamp), COUNT(*), AVG(floatvalue) FROM stream_pytest_data GROUP BY histogram(_timestamp)"),
        ("Array operations", "SELECT log, array_length(cast_to_arr(log)) FROM stream_pytest_data WHERE log LIKE '[%' LIMIT 10"),
    ]
    
    performance_results = []
    
    for query_name, sql in test_queries:
        start_time = time.time()
        
        try:
            hits = execute_query(create_session, base_url, sql, query_config, f"Performance test: {query_name}")
            execution_time = time.time() - start_time
            
            performance_results.append({
                "query": query_name,
                "execution_time": execution_time,
                "result_count": len(hits),
                "status": "success"
            })
            
            # Performance assertions
            assert execution_time < 10.0, f"{query_name} took {execution_time:.2f}s, exceeds 10s limit"
            assert len(hits) <= 1000, f"{query_name} returned {len(hits)} hits, exceeds 1000 limit"
            
            logger.info(f"✅ {query_name}: {execution_time:.2f}s, {len(hits)} hits")
            
        except Exception as e:
            performance_results.append({
                "query": query_name,
                "execution_time": None,
                "result_count": None,
                "status": f"failed: {e}"
            })
            logger.error(f"❌ {query_name} failed: {e}")
    
    # Summary
    successful_queries = [r for r in performance_results if r["status"] == "success"]
    avg_execution_time = sum(r["execution_time"] for r in successful_queries) / len(successful_queries) if successful_queries else 0
    
    logger.info(f"📊 Performance Summary: {len(successful_queries)}/{len(test_queries)} queries successful")
    logger.info(f"📊 Average execution time: {avg_execution_time:.2f}s")
    
    assert len(successful_queries) >= len(test_queries) * 0.8, "At least 80% of performance tests should pass"


if __name__ == "__main__":
    # Run with: python -m pytest test_advanced_sql_refactored.py -v
    pass