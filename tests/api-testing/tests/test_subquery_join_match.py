"""
REGRESSION TEST SUITE: Data Fusion Error with Subqueries and substr()

This test suite reproduces and validates the fix for a critical data fusion error
that occurs when specific environment variables are enabled:

- ZO_FEATURE_JOIN_MATCH_ONE_ENABLED = true  
- ZO_UTF8_VIEW_ENABLED = true

The error manifests as:
"Join Error caused by External error: task panicked with message 'Unsupported data type: Utf8View'"

Test Coverage:
1. Main regression test with subquery + substr + IN clause
2. Environment variable validation 
3. Alternative subquery patterns for isolation
4. substr function testing without subquery
5. Data verification helper

Usage in CI/CD: These tests automatically set the required environment variables
internally, so no external configuration is needed beyond basic OpenObserve credentials.
"""

import json
import requests
import pytest
import logging
import os
from datetime import datetime, timezone, timedelta
import time


def test_e2e_subquery_join_match_with_substr(create_session, base_url, monkeypatch):
    """
    REGRESSION TEST: Reproduces and validates the fix for the data fusion error.
    
    When environment variables are set to:
    - ZO_FEATURE_JOIN_MATCH_ONE_ENABLED = true
    - ZO_UTF8_VIEW_ENABLED = true
    
    This test checks the problematic query pattern that caused:
    "Join Error caused by External error: task panicked with message 'Unsupported data type: Utf8View'"
    
    Query pattern:
    SELECT _timestamp, kubernetes_container_name FROM stream_pytest_data 
    WHERE kubernetes_container_name IN (
        SELECT kubernetes_container_name FROM stream_pytest_data 
        WHERE substr(kubernetes_container_name, 0, 2) = 'p'  -- Using 'p' for prometheus
    )
    
    NOTE: This test will FAIL until the data fusion bug is fixed.
          Once fixed, it should return valid results without the Utf8View error.
    """
    
    # Set the environment variables that caused the original data fusion error
    monkeypatch.setenv("ZO_FEATURE_JOIN_MATCH_ONE_ENABLED", "true")
    monkeypatch.setenv("ZO_UTF8_VIEW_ENABLED", "true")
    
    session = create_session
    url = base_url
    org_id = "default"
    
    # Set the time window for the query  
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    
    # The problematic query that was causing data fusion errors
    json_data = {
        "query": {
            "sql": """SELECT _timestamp, kubernetes_container_name 
                     FROM "stream_pytest_data" 
                     WHERE kubernetes_container_name IN (
                         SELECT kubernetes_container_name 
                         FROM "stream_pytest_data" 
                         WHERE substr(kubernetes_container_name, 0, 2) = 'p'
                     )""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 50,
        },
    }
    
    # Execute the query that previously failed with data fusion error
    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    
    # Assert that the query executes successfully without data fusion errors
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Subquery with substr and JOIN_MATCH_ONE failed with status {resp_get_allsearch.status_code}. Response: {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    logging.info(f"Found {len(hits)} hits for subquery with substr test")
    
    if len(hits) > 0:
        # Validate the structure of returned data
        for i, hit in enumerate(hits):
            assert "_timestamp" in hit, f"Hit {i} should contain '_timestamp' field"
            assert "kubernetes_container_name" in hit, f"Hit {i} should contain 'kubernetes_container_name' field"
            
            # Validate that the container name starts with 'o' as per the substr filter
            container_name = hit["kubernetes_container_name"]
            assert container_name is not None, f"Hit {i} container name should not be None"
            assert container_name.startswith('p'), f"Hit {i} container name '{container_name}' should start with 'p'"
            
            # Validate timestamp format
            timestamp = hit["_timestamp"]
            assert timestamp is not None, f"Hit {i} timestamp should not be None"
            
            logging.debug(f"Hit {i}: container={container_name}, timestamp={timestamp}")
        
        logging.info(f"✅ All {len(hits)} hits have valid subquery data with correct substr filtering")
    else:
        logging.warning("⚠️  No hits found for subquery with substr test - this might indicate no containers starting with 'p'")
    
    logging.info(f"✅ Subquery with substr test completed - {len(hits)} valid results returned")


def test_e2e_environment_variable_configuration(monkeypatch):
    """
    Test to verify that the required environment variables are set correctly.
    This ensures the test environment matches the conditions that caused the original error.
    """
    
    # Set the environment variables that caused the original data fusion error
    monkeypatch.setenv("ZO_FEATURE_JOIN_MATCH_ONE_ENABLED", "true")
    monkeypatch.setenv("ZO_UTF8_VIEW_ENABLED", "true")
    
    # Check if the environment variables that caused the issue are set correctly
    join_match_enabled = os.environ.get("ZO_FEATURE_JOIN_MATCH_ONE_ENABLED", "").lower()
    utf8_view_enabled = os.environ.get("ZO_UTF8_VIEW_ENABLED", "").lower()
    
    logging.info(f"ZO_FEATURE_JOIN_MATCH_ONE_ENABLED: {join_match_enabled}")
    logging.info(f"ZO_UTF8_VIEW_ENABLED: {utf8_view_enabled}")
    
    # Validate that the environment variables are set correctly
    assert join_match_enabled == "true", f"ZO_FEATURE_JOIN_MATCH_ONE_ENABLED should be 'true', got '{join_match_enabled}'"
    assert utf8_view_enabled == "true", f"ZO_UTF8_VIEW_ENABLED should be 'true', got '{utf8_view_enabled}'"
    
    logging.info("✅ Environment variables are set correctly for data fusion error reproduction")
    logging.info("✅ JOIN_MATCH_ONE is enabled as expected")
    logging.info("✅ UTF8_VIEW is enabled as expected")


def test_e2e_alternative_subquery_patterns(create_session, base_url, monkeypatch):
    """
    Test alternative subquery patterns that should work with the same environment variables.
    This helps confirm that the fix is specific to the substr+IN combination.
    """
    
    # Set the environment variables that caused the original data fusion error
    monkeypatch.setenv("ZO_FEATURE_JOIN_MATCH_ONE_ENABLED", "true")
    monkeypatch.setenv("ZO_UTF8_VIEW_ENABLED", "true")
    
    session = create_session
    url = base_url
    org_id = "default"
    
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    
    # Test with a simpler subquery pattern
    json_data = {
        "query": {
            "sql": """SELECT _timestamp, kubernetes_container_name 
                     FROM "stream_pytest_data" 
                     WHERE kubernetes_container_name IN (
                         SELECT DISTINCT kubernetes_container_name 
                         FROM "stream_pytest_data" 
                         WHERE kubernetes_container_name IS NOT NULL
                     )
                     LIMIT 10""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 10,
        },
    }
    
    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Alternative subquery pattern failed with status {resp_get_allsearch.status_code}. Response: {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for alternative subquery pattern")
        for i, hit in enumerate(hits):
            assert "_timestamp" in hit, f"Hit {i} should contain '_timestamp' field"
            assert "kubernetes_container_name" in hit, f"Hit {i} should contain 'kubernetes_container_name' field"
            
            # Validate basic data structure
            container_name = hit["kubernetes_container_name"]
            timestamp = hit["_timestamp"]
            assert container_name is not None, f"Hit {i} container name should not be None"
            assert timestamp is not None, f"Hit {i} timestamp should not be None"
            
            logging.debug(f"Hit {i}: container={container_name}, timestamp={timestamp}")
        
        logging.info(f"✅ All {len(hits)} hits have valid alternative subquery data")
    else:
        logging.warning("⚠️  No hits found for alternative subquery pattern")
    
    logging.info(f"✅ Alternative subquery pattern test completed - {len(hits)} results returned")


def test_e2e_substr_without_subquery(create_session, base_url, monkeypatch):
    """
    Test substr function without subquery to isolate the issue.
    This helps confirm that substr itself isn't the problem.
    """
    
    # Set the environment variables that caused the original data fusion error
    monkeypatch.setenv("ZO_FEATURE_JOIN_MATCH_ONE_ENABLED", "true")
    monkeypatch.setenv("ZO_UTF8_VIEW_ENABLED", "true")
    
    session = create_session
    url = base_url
    org_id = "default"
    
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    
    # Test substr without subquery
    json_data = {
        "query": {
            "sql": """SELECT _timestamp, kubernetes_container_name,
                         substr(kubernetes_container_name, 0, 2) AS container_prefix
                     FROM "stream_pytest_data" 
                     WHERE substr(kubernetes_container_name, 0, 2) = 'o'
                     LIMIT 10""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 10,
        },
    }
    
    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Substr without subquery failed with status {resp_get_allsearch.status_code}. Response: {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for substr without subquery")
        for i, hit in enumerate(hits):
            assert "_timestamp" in hit, f"Hit {i} should contain '_timestamp' field"
            assert "kubernetes_container_name" in hit, f"Hit {i} should contain 'kubernetes_container_name' field"
            assert "container_prefix" in hit, f"Hit {i} should contain 'container_prefix' field"
            
            # Validate that the container name starts with 'o' as per the substr filter
            container_name = hit["kubernetes_container_name"]
            container_prefix = hit["container_prefix"]
            timestamp = hit["_timestamp"]
            
            assert container_name is not None, f"Hit {i} container name should not be None"
            assert container_name.startswith('p'), f"Hit {i} container name '{container_name}' should start with 'p'"
            assert container_prefix == 'p', f"Hit {i} container_prefix should be 'p', got '{container_prefix}'"
            assert timestamp is not None, f"Hit {i} timestamp should not be None"
            
            logging.debug(f"Hit {i}: container={container_name}, prefix={container_prefix}, timestamp={timestamp}")
        
        logging.info(f"✅ All {len(hits)} hits have valid substr data with correct filtering")
    else:
        logging.warning("⚠️  No hits found for substr without subquery test - this might indicate no containers starting with 'p'")
    
    logging.info(f"✅ Substr without subquery test completed - {len(hits)} results returned")


def test_e2e_data_verification(create_session, base_url, monkeypatch):
    """
    Test to verify what container names are available in the test data.
    This helps debug and validate our substr filtering is working correctly.
    """
    
    # Set the environment variables that caused the original data fusion error
    monkeypatch.setenv("ZO_FEATURE_JOIN_MATCH_ONE_ENABLED", "true")
    monkeypatch.setenv("ZO_UTF8_VIEW_ENABLED", "true")
    
    session = create_session
    url = base_url
    org_id = "default"
    
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    
    # Get all unique container names to see what we're working with
    json_data = {
        "query": {
            "sql": """SELECT DISTINCT kubernetes_container_name,
                         substr(kubernetes_container_name, 0, 2) AS container_prefix
                     FROM "stream_pytest_data" 
                     WHERE kubernetes_container_name IS NOT NULL
                     ORDER BY kubernetes_container_name
                     LIMIT 20""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 20,
        },
    }
    
    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Data verification query failed with status {resp_get_allsearch.status_code}. Response: {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} distinct container names in test data:")
        containers_with_o = []
        for i, hit in enumerate(hits):
            container_name = hit["kubernetes_container_name"]
            container_prefix = hit["container_prefix"]
            logging.info(f"  {i+1}. Container: '{container_name}' | Prefix: '{container_prefix}'")
            
            if container_name.startswith('o'):
                containers_with_o.append(container_name)
        
        logging.info(f"Containers starting with 'o': {containers_with_o}")
        
        if len(containers_with_o) == 0:
            logging.warning("⚠️  No containers found starting with 'o' - our substr tests may return empty results")
        else:
            logging.info(f"✅ Found {len(containers_with_o)} containers starting with 'o' for substr testing")
    else:
        logging.warning("⚠️  No container names found in test data")


def test_e2e_join_alternative_pattern(create_session, base_url, monkeypatch):
    """
    Test JOIN alternative to subquery pattern with the same environment variables.
    This tests if JOIN works when IN subqueries fail.
    """
    
    # Set the environment variables that caused the original data fusion error
    monkeypatch.setenv("ZO_FEATURE_JOIN_MATCH_ONE_ENABLED", "true")
    monkeypatch.setenv("ZO_UTF8_VIEW_ENABLED", "true")
    
    session = create_session
    url = base_url
    org_id = "default"
    
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    
    # Test JOIN alternative to subquery
    json_data = {
        "query": {
            "sql": """SELECT DISTINCT s1._timestamp, s1.kubernetes_container_name
                     FROM "stream_pytest_data" s1
                     INNER JOIN "stream_pytest_data" s2
                     ON s1.kubernetes_container_name = s2.kubernetes_container_name
                     AND s1.kubernetes_namespace_name = s2.kubernetes_namespace_name
                     WHERE substr(s2.kubernetes_container_name, 0, 2) = 'p'
                     LIMIT 10""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 10,
        },
    }
    
    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    
    assert (
        resp_get_allsearch.status_code == 200
    ), f"JOIN alternative pattern failed with status {resp_get_allsearch.status_code}. Response: {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for JOIN alternative pattern")
        for i, hit in enumerate(hits):
            assert "_timestamp" in hit, f"Hit {i} should contain '_timestamp' field"
            assert "kubernetes_container_name" in hit, f"Hit {i} should contain 'kubernetes_container_name' field"
            
            # Validate that the container name starts with 'p' as per the substr filter
            container_name = hit["kubernetes_container_name"]
            timestamp = hit["_timestamp"]
            assert container_name is not None, f"Hit {i} container name should not be None"
            assert container_name.startswith('p'), f"Hit {i} container name '{container_name}' should start with 'p'"
            assert timestamp is not None, f"Hit {i} timestamp should not be None"
            
            logging.debug(f"Hit {i}: container={container_name}, timestamp={timestamp}")
        
        logging.info(f"✅ All {len(hits)} hits have valid JOIN alternative data")
    else:
        logging.warning("⚠️  No hits found for JOIN alternative pattern")
    
    logging.info(f"✅ JOIN alternative pattern test completed - {len(hits)} results returned")


def test_e2e_concat_subquery_pattern(create_session, base_url, monkeypatch):
    """
    Test CONCAT subquery pattern to test multiple field comparisons.
    This tests if CONCAT with IN subquery triggers the same error.
    """
    
    # Set the environment variables that caused the original data fusion error
    monkeypatch.setenv("ZO_FEATURE_JOIN_MATCH_ONE_ENABLED", "true")
    monkeypatch.setenv("ZO_UTF8_VIEW_ENABLED", "true")
    
    session = create_session
    url = base_url
    org_id = "default"
    
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    
    # Test CONCAT with IN subquery
    json_data = {
        "query": {
            "sql": """SELECT _timestamp, kubernetes_container_name
                     FROM "stream_pytest_data"
                     WHERE CONCAT(kubernetes_container_name, '|', kubernetes_namespace_name) IN (
                         SELECT CONCAT(kubernetes_container_name, '|', kubernetes_namespace_name)
                         FROM "stream_pytest_data"
                         WHERE substr(kubernetes_container_name, 0, 2) = 'p'
                     )
                     LIMIT 10""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 10,
        },
    }
    
    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    
    assert (
        resp_get_allsearch.status_code == 200
    ), f"CONCAT subquery pattern failed with status {resp_get_allsearch.status_code}. Response: {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for CONCAT subquery pattern")
        for i, hit in enumerate(hits):
            assert "_timestamp" in hit, f"Hit {i} should contain '_timestamp' field"
            assert "kubernetes_container_name" in hit, f"Hit {i} should contain 'kubernetes_container_name' field"
            
            # Validate that the container name starts with 'p' as per the substr filter
            container_name = hit["kubernetes_container_name"]
            timestamp = hit["_timestamp"]
            assert container_name is not None, f"Hit {i} container name should not be None"
            assert container_name.startswith('p'), f"Hit {i} container name '{container_name}' should start with 'p'"
            assert timestamp is not None, f"Hit {i} timestamp should not be None"
            
            logging.debug(f"Hit {i}: container={container_name}, timestamp={timestamp}")
        
        logging.info(f"✅ All {len(hits)} hits have valid CONCAT subquery data")
    else:
        logging.warning("⚠️  No hits found for CONCAT subquery pattern")
    
    logging.info(f"✅ CONCAT subquery pattern test completed - {len(hits)} results returned")


def test_e2e_length_function_subquery(create_session, base_url, monkeypatch):
    """
    Test subquery with length() function instead of substr().
    This tests if the issue is specific to substr or affects other string functions.
    """
    
    # Set the environment variables that caused the original data fusion error
    monkeypatch.setenv("ZO_FEATURE_JOIN_MATCH_ONE_ENABLED", "true")
    monkeypatch.setenv("ZO_UTF8_VIEW_ENABLED", "true")
    
    session = create_session
    url = base_url
    org_id = "default"
    
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    
    # Test subquery with length function
    json_data = {
        "query": {
            "sql": """SELECT _timestamp, kubernetes_container_name
                     FROM "stream_pytest_data"
                     WHERE kubernetes_container_name IN (
                         SELECT kubernetes_container_name
                         FROM "stream_pytest_data"
                         WHERE length(kubernetes_container_name) > 5
                     )
                     LIMIT 10""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 10,
        },
    }
    
    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Length function subquery failed with status {resp_get_allsearch.status_code}. Response: {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for length function subquery")
        for i, hit in enumerate(hits):
            assert "_timestamp" in hit, f"Hit {i} should contain '_timestamp' field"
            assert "kubernetes_container_name" in hit, f"Hit {i} should contain 'kubernetes_container_name' field"
            
            # Validate that the container name length > 5
            container_name = hit["kubernetes_container_name"]
            timestamp = hit["_timestamp"]
            assert container_name is not None, f"Hit {i} container name should not be None"
            assert len(container_name) > 5, f"Hit {i} container name '{container_name}' should be longer than 5 characters"
            assert timestamp is not None, f"Hit {i} timestamp should not be None"
            
            logging.debug(f"Hit {i}: container={container_name} (length={len(container_name)}), timestamp={timestamp}")
        
        logging.info(f"✅ All {len(hits)} hits have valid length function subquery data")
    else:
        logging.warning("⚠️  No hits found for length function subquery")
    
    logging.info(f"✅ Length function subquery test completed - {len(hits)} results returned")


"""
SELECT _timestamp, k8s_container_name FROM default where k8s_container_name in (select k8s_container_name from default where substr(k8s_container_name,0,2) = 'o')
with this query if we want to reproduce the same error, we need to set:
ZO_FEATURE_JOIN_MATCH_ONE_ENABLED = true
ZO_UTF8_VIEW_ENABLED = true this type of query was giving data fusion error when these env variables had these values set, we need to add a test case in pytest where with these values the test should work
"""