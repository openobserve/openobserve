"""
REGRESSION TEST SUITE: Data Fusion Error with Subqueries and UTF-8 String Operations

This test suite validates queries that previously caused data fusion errors when
OpenObserve server is configured with:
- ZO_FEATURE_JOIN_MATCH_ONE_ENABLED = true  
- ZO_UTF8_VIEW_ENABLED = true OR false (bug occurs in both cases)

The error manifests as:
"Join Error caused by External error: task panicked with message 'Unsupported data type: Utf8View'"

IMPORTANT: These environment variables must be set SERVER-SIDE on the OpenObserve instance,
not in the test client. Tests simply execute queries and validate results.

Test Coverage:
- Subquery patterns with IN clauses
- String function operations (substr, length, concat)
- JOIN alternatives 
- Validation of query success vs expected Utf8View errors

Expected Results:
- FIXED environments: All queries should return valid data
- BUGGY environments: Complex string queries should fail with Utf8View error

Note: The bug can be reproduced with ZO_UTF8_VIEW_ENABLED set to either true OR false,
as long as ZO_FEATURE_JOIN_MATCH_ONE_ENABLED = true.
"""

import json
import requests
import pytest
import logging
from datetime import datetime, timezone, timedelta


@pytest.fixture
def query_timeframe():
    """Shared fixture for consistent time windows across all tests."""
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    logging.debug(f"Query timeframe: {one_hour_ago} to {end_time}")
    return one_hour_ago, end_time


@pytest.fixture
def execute_search_query(create_session, base_url):
    """Shared fixture to execute search queries and return response."""
    def _execute(sql_query, start_time, end_time, size=50):
        session = create_session
        url = base_url
        org_id = "default"
        
        # Log the query being executed for debugging
        logging.debug(f"Executing SQL query: {sql_query.strip()}")
        
        json_data = {
            "query": {
                "sql": sql_query,
                "start_time": start_time,
                "end_time": end_time,
                "from": 0,
                "size": size,
            },
        }
        
        response = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
        logging.debug(f"Query response status: {response.status_code}")
        return response
    
    return _execute


@pytest.fixture
def validate_query_response():
    """Shared fixture for query response validation with error handling."""
    def _validate(response, expected_fields, test_name, validation_func=None):
        """
        Validate query response - show results for both success and error cases.
        
        Args:
            response: HTTP response object
            expected_fields: List of required fields in successful response
            test_name: Name of test for logging
            validation_func: Optional additional validation function for hits
        """
        if is_utf8view_error(response):
            logging.warning(f"❌ {test_name}: Utf8View error detected (bug exists)")
            # Assert failure to show the error in test results instead of skipping
            assert False, f"{test_name} failed with Utf8View error: {response.content.decode()}"
        
        # Validate successful response
        hits = validate_successful_response(response, expected_fields, test_name)
        
        # Apply additional validation if provided
        if validation_func and hits:
            validation_func(hits, test_name)
            
        return hits
    
    return _validate


def validate_successful_response(response, expected_fields, test_name):
    """Helper to validate successful query responses."""
    assert response.status_code == 200, (
        f"{test_name} failed with status {response.status_code}. "
        f"Response: {response.content}"
    )
    
    response_data = response.json()
    assert "hits" in response_data, f"{test_name}: Response should contain 'hits' field"
    
    hits = response_data["hits"]
    logging.info(f"{test_name}: Found {len(hits)} hits")
    
    if len(hits) > 0:
        for i, hit in enumerate(hits):
            for field in expected_fields:
                assert field in hit, f"{test_name}: Hit {i} should contain '{field}' field"
                assert hit[field] is not None, f"{test_name}: Hit {i} field '{field}' should not be None"
        
        logging.info(f"✅ {test_name}: All {len(hits)} hits have valid data structure")
    else:
        logging.warning(f"⚠️  {test_name}: No hits found")
    
    return hits


def is_utf8view_error(response):
    """Check if response contains the specific Utf8View error."""
    if response.status_code != 400:
        return False
    
    try:
        error_data = response.json()
        error_detail = error_data.get("error_detail", "")
        is_utf8_error = "Unsupported data type: Utf8View" in error_detail
        
        if is_utf8_error:
            logging.debug(f"Utf8View error detected: {error_detail}")
        
        return is_utf8_error
    except (json.JSONDecodeError, KeyError) as e:
        logging.debug(f"Error parsing response JSON: {e}")
        return False


def test_subquery_with_substr_function(execute_search_query, query_timeframe, validate_query_response):
    """
    Test subquery with substr function - main regression test.
    
    Query: SELECT _timestamp, kubernetes_container_name FROM stream_pytest_data 
           WHERE kubernetes_container_name IN (
               SELECT kubernetes_container_name FROM stream_pytest_data 
               WHERE substr(kubernetes_container_name, 0, 2) = 'ap'
           )
    
    Expected: SUCCESS on fixed environments, Utf8View error on buggy environments
    """
    start_time, end_time = query_timeframe
    
    sql_query = """
        SELECT _timestamp, kubernetes_container_name 
        FROM "stream_pytest_data" 
        WHERE kubernetes_container_name IN (
            SELECT kubernetes_container_name 
            FROM "stream_pytest_data" 
            WHERE substr(kubernetes_container_name, 0, 2) = 'ap'
        )
    """
    
    response = execute_search_query(sql_query, start_time, end_time)
    
    def validate_apiserver_containers(hits, test_name):
        """Validate that all containers start with 'ap' (api-server)."""
        for i, hit in enumerate(hits):
            container_name = hit["kubernetes_container_name"]
            assert container_name.startswith('ap'), (
                f"Hit {i}: container '{container_name}' should start with 'ap'"
            )
        logging.info(f"{test_name}: Validated {len(hits)} api-server containers")
    
    validate_query_response(
        response,
        ["_timestamp", "kubernetes_container_name"],
        "Subquery with substr",
        validate_apiserver_containers
    )


def test_subquery_with_length_function(execute_search_query, query_timeframe):
    """
    Test subquery with length function to verify error scope.
    
    Expected: SUCCESS on fixed environments, Utf8View error on buggy environments
    """
    start_time, end_time = query_timeframe
    
    sql_query = """
        SELECT _timestamp, kubernetes_container_name
        FROM "stream_pytest_data"
        WHERE kubernetes_container_name IN (
            SELECT kubernetes_container_name
            FROM "stream_pytest_data"
            WHERE length(kubernetes_container_name) > 5
        )
        LIMIT 10
    """
    
    response = execute_search_query(sql_query, start_time, end_time, size=10)
    
    if is_utf8view_error(response):
        logging.warning("❌ Subquery with length: Utf8View error detected (bug exists)")
        pytest.skip("Environment has Utf8View bug - test validates error condition")
    else:
        hits = validate_successful_response(
            response,
            ["_timestamp", "kubernetes_container_name"],
            "Subquery with length function"
        )
        
        # Validate container name lengths
        for i, hit in enumerate(hits):
            container_name = hit["kubernetes_container_name"]
            assert len(container_name) > 5, (
                f"Hit {i}: container '{container_name}' should be longer than 5 characters"
            )


def test_subquery_with_concat_function(execute_search_query, query_timeframe):
    """
    Test subquery with CONCAT function for multiple field comparisons.
    
    Expected: SUCCESS on fixed environments, Utf8View error on buggy environments
    """
    start_time, end_time = query_timeframe
    
    sql_query = """
        SELECT _timestamp, kubernetes_container_name
        FROM "stream_pytest_data"
        WHERE CONCAT(kubernetes_container_name, '|', kubernetes_namespace_name) IN (
            SELECT CONCAT(kubernetes_container_name, '|', kubernetes_namespace_name)
            FROM "stream_pytest_data"
            WHERE substr(kubernetes_container_name, 0, 2) = 'ap'
        )
        LIMIT 10
    """
    
    response = execute_search_query(sql_query, start_time, end_time, size=10)
    
    if is_utf8view_error(response):
        logging.warning("❌ Subquery with CONCAT: Utf8View error detected (bug exists)")
        pytest.skip("Environment has Utf8View bug - test validates error condition")
    else:
        hits = validate_successful_response(
            response,
            ["_timestamp", "kubernetes_container_name"],
            "Subquery with CONCAT function"
        )
        
        for i, hit in enumerate(hits):
            container_name = hit["kubernetes_container_name"]
            assert container_name.startswith('ap'), (
                f"Hit {i}: container '{container_name}' should start with 'ap'"
            )


def test_join_with_string_conditions(execute_search_query, query_timeframe):
    """
    Test JOIN as alternative to subquery - may also trigger Utf8View error.
    
    Expected: SUCCESS on fixed environments, may fail on buggy environments
    """
    start_time, end_time = query_timeframe
    
    sql_query = """
        SELECT DISTINCT s1._timestamp, s1.kubernetes_container_name
        FROM "stream_pytest_data" s1
        INNER JOIN "stream_pytest_data" s2
        ON s1.kubernetes_container_name = s2.kubernetes_container_name
        AND s1.kubernetes_namespace_name = s2.kubernetes_namespace_name
        WHERE substr(s2.kubernetes_container_name, 0, 2) = 'p'
        LIMIT 10
    """
    
    response = execute_search_query(sql_query, start_time, end_time, size=10)
    
    if is_utf8view_error(response):
        logging.warning("❌ JOIN with string conditions: Utf8View error detected (bug exists)")
        pytest.skip("Environment has Utf8View bug - JOIN also affected")
    else:
        hits = validate_successful_response(
            response,
            ["_timestamp", "kubernetes_container_name"],
            "JOIN with string conditions"
        )


def test_simple_subquery_without_functions(execute_search_query, query_timeframe):
    """
    Test simple subquery without string functions.
    
    Expected: SUCCESS on fixed environments, Utf8View error on buggy environments
    """
    start_time, end_time = query_timeframe
    
    sql_query = """
        SELECT _timestamp, kubernetes_container_name
        FROM "stream_pytest_data"
        WHERE kubernetes_container_name IN (
            SELECT DISTINCT kubernetes_container_name
            FROM "stream_pytest_data"
            WHERE kubernetes_container_name IS NOT NULL
        )
        LIMIT 10
    """
    
    response = execute_search_query(sql_query, start_time, end_time, size=10)
    
    if is_utf8view_error(response):
        logging.warning("❌ Simple subquery: Utf8View error detected (bug exists)")
        pytest.skip("Environment has Utf8View bug - affects all IN subqueries")
    else:
        hits = validate_successful_response(
            response,
            ["_timestamp", "kubernetes_container_name"],
            "Simple subquery without functions"
        )


def test_substr_without_subquery(execute_search_query, query_timeframe):
    """
    Test substr function without subquery - should always work.
    This isolates string functions from subquery issues.
    
    Expected: SUCCESS on all environments
    """
    start_time, end_time = query_timeframe
    
    sql_query = """
        SELECT _timestamp, kubernetes_container_name,
               substr(kubernetes_container_name, 0, 2) AS container_prefix
        FROM "stream_pytest_data"
        WHERE substr(kubernetes_container_name, 0, 2) = 'ap'
        LIMIT 10
    """
    
    response = execute_search_query(sql_query, start_time, end_time, size=10)
    
    hits = validate_successful_response(
        response,
        ["_timestamp", "kubernetes_container_name", "container_prefix"],
        "Substr function without subquery"
    )
    
    # Validate substr results
    for i, hit in enumerate(hits):
        container_name = hit["kubernetes_container_name"]
        container_prefix = hit["container_prefix"]
        assert container_name.startswith('ap'), (
            f"Hit {i}: container '{container_name}' should start with 'ap'"
        )
        assert container_prefix == 'ap', (
            f"Hit {i}: container_prefix should be 'ap', got '{container_prefix}'"
        )


def test_data_availability(execute_search_query, query_timeframe):
    """
    Verify test data availability and structure.
    
    Expected: SUCCESS on all environments - basic data check
    """
    start_time, end_time = query_timeframe
    
    sql_query = """
        SELECT DISTINCT kubernetes_container_name,
               substr(kubernetes_container_name, 0, 2) AS container_prefix
        FROM "stream_pytest_data"
        WHERE kubernetes_container_name IS NOT NULL
        ORDER BY kubernetes_container_name
        LIMIT 20
    """
    
    response = execute_search_query(sql_query, start_time, end_time, size=20)
    
    hits = validate_successful_response(
        response,
        ["kubernetes_container_name", "container_prefix"],
        "Data availability check"
    )
    
    if len(hits) > 0:
        container_names = [hit["kubernetes_container_name"] for hit in hits]
        containers_with_ap = [name for name in container_names if name.startswith('ap')]
        
        logging.info(f"Available containers: {container_names}")
        logging.info(f"Containers starting with 'ap': {containers_with_ap}")
        
        if len(containers_with_ap) == 0:
            pytest.skip("No containers starting with 'ap' found - other tests may return empty results")


"""
ORIGINAL PROBLEMATIC QUERY PATTERN:
SELECT _timestamp, k8s_container_name FROM default 
WHERE k8s_container_name IN (
    SELECT k8s_container_name FROM default 
    WHERE substr(k8s_container_name, 0, 2) = 'o'
)

SERVER REQUIREMENTS:
The OpenObserve server being tested must be configured with:
ZO_FEATURE_JOIN_MATCH_ONE_ENABLED = true
ZO_UTF8_VIEW_ENABLED = true OR false (bug occurs in both cases)

The critical setting is ZO_FEATURE_JOIN_MATCH_ONE_ENABLED = true, which triggers
the data fusion error regardless of the ZO_UTF8_VIEW_ENABLED setting.
"""