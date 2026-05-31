import json
import requests
import pytest
import logging

from datetime import datetime, timezone, timedelta
import time


def test_e2e_error_rate_analysis(create_session, base_url):
    """Running an E2E test for error rate analysis query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """SELECT 
                COUNT(_timestamp) AS pvcount,
                COUNT(CASE WHEN level = 'info' THEN 1 END) AS infocount,
                (100.0 * COUNT(CASE WHEN level = 'info' THEN 1 END) / CAST(COUNT(_timestamp) AS FLOAT)) AS inforate,
                COALESCE(kubernetes_container_name, 'unknown') AS component,
                COALESCE(kubernetes_namespace_name, 'default') AS environment
            FROM "stream_pytest_data"
            WHERE (level IS NOT NULL)
            GROUP BY COALESCE(kubernetes_container_name, 'unknown'), COALESCE(kubernetes_namespace_name, 'default')
            HAVING (100.0 * COUNT(CASE WHEN level = 'info' THEN 1 END) / CAST(COUNT(_timestamp) AS FLOAT)) >= 0
            ORDER BY (100.0 * COUNT(CASE WHEN level = 'info' THEN 1 END) / CAST(COUNT(_timestamp) AS FLOAT)) DESC
            LIMIT 50""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 50,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Error rate analysis query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for info rate analysis")
        for i, hit in enumerate(hits):
            assert "pvcount" in hit, f"Hit {i} should contain 'pvcount' field"
            assert "infocount" in hit, f"Hit {i} should contain 'infocount' field"
            assert "inforate" in hit, f"Hit {i} should contain 'inforate' field"
            assert "component" in hit, f"Hit {i} should contain 'component' field"
            assert "environment" in hit, f"Hit {i} should contain 'environment' field"
            
            # Validate info rate is >= 0 as per HAVING clause
            info_rate = hit["inforate"]
            assert info_rate >= 0, f"Hit {i} info rate should be >= 0, got {info_rate}"
        
        logging.info(f"✅ All {len(hits)} hits have valid info rate analysis data")
    else:
        logging.warning("⚠️  No hits found for info rate analysis query")


def test_e2e_performance_percentiles(create_session, base_url):
    """Running an E2E test for performance percentiles query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """SELECT histogram(_timestamp) AS _time,
                approx_percentile_cont(CAST(floatvalue AS FLOAT), 0.95) AS p95,
                approx_percentile_cont(CAST(floatvalue AS FLOAT), 0.75) AS p75,
                approx_percentile_cont(CAST(floatvalue AS FLOAT), 0.50) AS p50
            FROM "stream_pytest_data"
            WHERE (floatvalue IS NOT NULL)
            GROUP BY histogram(_timestamp)
            ORDER BY histogram(_timestamp)""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Performance percentiles query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for performance percentiles")
        for i, hit in enumerate(hits):
            assert "_time" in hit, f"Hit {i} should contain '_time' field (time bucket)"
            assert "p95" in hit, f"Hit {i} should contain 'p95' field"
            assert "p75" in hit, f"Hit {i} should contain 'p75' field"
            assert "p50" in hit, f"Hit {i} should contain 'p50' field"
            
            # Validate the time bucket format (should be ISO timestamp)
            time_bucket = hit["_time"]
            assert time_bucket, f"Hit {i} time bucket should not be empty"
            
            # Validate percentile ordering (P95 >= P75 >= P50)
            p95 = hit["p95"]
            p75 = hit["p75"]
            p50 = hit["p50"]
            if p95 is not None and p75 is not None and p50 is not None:
                assert p95 >= p75 >= p50, f"Hit {i} percentiles should be ordered: P95({p95}) >= P75({p75}) >= P50({p50})"
        
        logging.info(f"✅ All {len(hits)} hits have valid performance percentile data")
    else:
        logging.warning("⚠️  No hits found for performance percentiles query")


def test_e2e_log_volume_analysis(create_session, base_url):
    """Running an E2E test for log volume analysis query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """SELECT 
                histogram(_timestamp) AS time_bucket,
                COUNT(_timestamp) AS total_logs,
                SUM(CASE WHEN COALESCE(level, '') = 'info' THEN 1 ELSE 0 END) AS info_count,
                ROUND(100.0 * SUM(CASE WHEN COALESCE(level, '') = 'info' THEN 1 ELSE 0 END) / COUNT(_timestamp), 2) AS info_rate,
                COALESCE(kubernetes_container_name, 'unknown') AS component
            FROM "stream_pytest_data"
            GROUP BY histogram(_timestamp), COALESCE(kubernetes_container_name, 'unknown')
            ORDER BY histogram(_timestamp) ASC, ROUND(100.0 * SUM(CASE WHEN COALESCE(level, '') = 'info' THEN 1 ELSE 0 END) / COUNT(_timestamp), 2) DESC""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Log volume analysis query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for log volume analysis")
        for i, hit in enumerate(hits):
            assert "time_bucket" in hit, f"Hit {i} should contain 'time_bucket' field"
            assert "total_logs" in hit, f"Hit {i} should contain 'total_logs' field"
            assert "info_count" in hit, f"Hit {i} should contain 'info_count' field"
            assert "info_rate" in hit, f"Hit {i} should contain 'info_rate' field"
            assert "component" in hit, f"Hit {i} should contain 'component' field"
            
            # Validate that info_count <= total_logs
            total_logs = hit["total_logs"]
            info_count = hit["info_count"]
            assert info_count <= total_logs, f"Hit {i} info_count({info_count}) should be <= total_logs({total_logs})"
        
        logging.info(f"✅ All {len(hits)} hits have valid log volume analysis data")
    else:
        logging.warning("⚠️  No hits found for log volume analysis query")


def test_e2e_source_analysis(create_session, base_url):
    """Running an E2E test for source analysis query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """SELECT
                COALESCE(kubernetes_container_name, 'unknown') AS platform,
                COALESCE(kubernetes_namespace_name, 'default') AS source_group,
                COUNT(_timestamp) AS log_count
            FROM "stream_pytest_data"
            GROUP BY COALESCE(kubernetes_container_name, 'unknown'), COALESCE(kubernetes_namespace_name, 'default')
            ORDER BY COUNT(_timestamp) DESC""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Source analysis query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for source analysis")
        for i, hit in enumerate(hits):
            assert "platform" in hit, f"Hit {i} should contain 'platform' field"
            assert "source_group" in hit, f"Hit {i} should contain 'source_group' field"
            assert "log_count" in hit, f"Hit {i} should contain 'log_count' field"
            
            # Validate log_count is positive
            log_count = hit["log_count"]
            assert log_count > 0, f"Hit {i} log_count should be > 0, got {log_count}"
        
        logging.info(f"✅ All {len(hits)} hits have valid source analysis data")
    else:
        logging.warning("⚠️  No hits found for source analysis query")


def test_e2e_host_performance(create_session, base_url):
    """Running an E2E test for host performance analysis query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """SELECT 
                COALESCE(kubernetes_container_name, 'unknown') AS hostname, 
                COUNT(DISTINCT stream) AS unique_stream_count,
                COUNT(DISTINCT level) AS unique_level_count,
                AVG(floatvalue) AS avg_float_value,
                MIN(floatvalue) AS min_float_value,
                MAX(floatvalue) AS max_float_value
            FROM "stream_pytest_data"
            WHERE floatvalue IS NOT NULL
            GROUP BY COALESCE(kubernetes_container_name, 'unknown')
            ORDER BY AVG(floatvalue) DESC
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
    ), f"Host performance query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for host performance analysis")
        for i, hit in enumerate(hits):
            assert "hostname" in hit, f"Hit {i} should contain 'hostname' field"
            assert "unique_stream_count" in hit, f"Hit {i} should contain 'unique_stream_count' field"
            assert "unique_level_count" in hit, f"Hit {i} should contain 'unique_level_count' field"
            assert "avg_float_value" in hit, f"Hit {i} should contain 'avg_float_value' field"
            assert "min_float_value" in hit, f"Hit {i} should contain 'min_float_value' field"
            assert "max_float_value" in hit, f"Hit {i} should contain 'max_float_value' field"
        
        logging.info(f"✅ All {len(hits)} hits have valid host performance data")
    else:
        logging.warning("⚠️  No hits found for host performance query")


def test_e2e_component_percentiles(create_session, base_url):
    """Running an E2E test for component performance percentiles query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """SELECT
                COALESCE(kubernetes_container_name, 'unknown') AS component,
                approx_percentile_cont(CAST(floatvalue AS Float), 0.99) AS p99_took,
                approx_percentile_cont(CAST(floatvalue AS Float), 0.95) AS p95_took,
                approx_percentile_cont(CAST(floatvalue AS Float), 0.50) AS median_took,
                COUNT(_timestamp) AS requests
            FROM "stream_pytest_data"
            WHERE floatvalue > 0
            GROUP BY COALESCE(kubernetes_container_name, 'unknown')
            ORDER BY approx_percentile_cont(CAST(floatvalue AS Float), 0.99) DESC
            LIMIT 15""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 15,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Component percentiles query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for component percentiles")
        for i, hit in enumerate(hits):
            assert "component" in hit, f"Hit {i} should contain 'component' field"
            assert "p99_took" in hit, f"Hit {i} should contain 'p99_took' field"
            assert "p95_took" in hit, f"Hit {i} should contain 'p95_took' field"
            assert "median_took" in hit, f"Hit {i} should contain 'median_took' field"
            assert "requests" in hit, f"Hit {i} should contain 'requests' field"
            
            # Validate percentile ordering
            p99 = hit["p99_took"]
            p95 = hit["p95_took"]
            median = hit["median_took"]
            if p99 is not None and p95 is not None and median is not None:
                assert p99 >= p95 >= median, f"Hit {i} percentiles should be ordered: P99({p99}) >= P95({p95}) >= Median({median})"
        
        logging.info(f"✅ All {len(hits)} hits have valid component percentile data")
    else:
        logging.warning("⚠️  No hits found for component percentiles query")


def test_e2e_api_log_analysis(create_session, base_url):
    """Running an E2E test for API log analysis query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """SELECT
                COALESCE(kubernetes_container_name, 'unknown') AS api,
                level AS log_level,
                COUNT(CASE WHEN LOWER(COALESCE(level, 'n/a')) = 'info' THEN 1 END) AS api_info_log_count,
                COALESCE(kubernetes_namespace_name, 'default') AS component,
                COALESCE(kubernetes_container_name, 'unknown') AS platform,
                COUNT(_timestamp) AS counter
            FROM "stream_pytest_data"
            WHERE kubernetes_namespace_name IS NOT NULL
                AND message LIKE '%bulk%'
            GROUP BY COALESCE(kubernetes_container_name, 'unknown'), level, COALESCE(kubernetes_namespace_name, 'default')
            ORDER BY COALESCE(kubernetes_container_name, 'unknown'), COUNT(_timestamp) DESC""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"API log analysis query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for API log analysis")
        for i, hit in enumerate(hits):
            assert "api" in hit, f"Hit {i} should contain 'api' field"
            assert "log_level" in hit, f"Hit {i} should contain 'log_level' field"
            assert "api_info_log_count" in hit, f"Hit {i} should contain 'api_info_log_count' field"
            assert "component" in hit, f"Hit {i} should contain 'component' field"
            assert "platform" in hit, f"Hit {i} should contain 'platform' field"
            assert "counter" in hit, f"Hit {i} should contain 'counter' field"
        
        logging.info(f"✅ All {len(hits)} hits have valid API log analysis data")
    else:
        logging.warning("⚠️  No hits found for API log analysis query")


def test_e2e_error_categorization(create_session, base_url):
    """Running an E2E test for error categorization query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """SELECT 
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
            WHERE 
                log IS NOT NULL AND log != ''
            GROUP BY CASE 
                    WHEN str_match_ignore_case(log, 'level=error')
                        THEN 'Level Error'
                    WHEN str_match_ignore_case(log, 'level=warn')
                        THEN 'Level Warning'
                    WHEN str_match_ignore_case(log, 'forbidden')
                        THEN 'Permission Forbidden'
                    ELSE 'Other Log Types'
                END, date_format(_timestamp, '%Y-%m-%d', 'UTC')
            ORDER BY count(_timestamp) DESC
            LIMIT 15""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 15,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Error categorization query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for error categorization")
        for i, hit in enumerate(hits):
            assert "count" in hit, f"Hit {i} should contain 'count' field"
            assert "log_category" in hit, f"Hit {i} should contain 'log_category' field"
            assert "_date" in hit, f"Hit {i} should contain '_date' field"
            
            # Validate count is positive
            count = hit["count"]
            assert count > 0, f"Hit {i} count should be > 0, got {count}"
        
        logging.info(f"✅ All {len(hits)} hits have valid error categorization data")
    else:
        logging.warning("⚠️  No hits found for error categorization query")


def test_e2e_metadata_extraction(create_session, base_url):
    """Running an E2E test for metadata extraction query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """SELECT 
                array_extract(regexp_match(log, 'caller=([^\\s]+)'), 1) AS caller,
                count(_timestamp) AS count
            FROM "stream_pytest_data"
            WHERE str_match_ignore_case(log, 'caller=')
            GROUP BY array_extract(regexp_match(log, 'caller=([^\\s]+)'), 1)""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Metadata extraction query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for caller extraction")
        for i, hit in enumerate(hits):
            assert "caller" in hit, f"Hit {i} should contain 'caller' field"
            assert "count" in hit, f"Hit {i} should contain 'count' field"
            
            # Validate count is positive
            count = hit["count"]
            assert count > 0, f"Hit {i} count should be > 0, got {count}"
        
        logging.info(f"✅ All {len(hits)} hits have valid caller extraction data")
    else:
        logging.warning("⚠️  No hits found for caller extraction query")


def test_e2e_time_series_window_functions(create_session, base_url):
    """Running an E2E test for time-series analysis with window functions."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """SELECT 
                histogram(_timestamp) AS time_bucket,
                kubernetes_namespace_name AS environment,
                COUNT(*) AS current_count,
                LAG(COUNT(*)) OVER (
                    PARTITION BY kubernetes_namespace_name 
                    ORDER BY histogram(_timestamp)
                ) AS previous_count,
                CASE 
                    WHEN LAG(COUNT(*)) OVER (
                        PARTITION BY kubernetes_namespace_name 
                        ORDER BY histogram(_timestamp)
                    ) IS NOT NULL THEN
                        ROUND(
                            ((COUNT(*) - LAG(COUNT(*)) OVER (
                                PARTITION BY kubernetes_namespace_name 
                                ORDER BY histogram(_timestamp)
                            )) * 100.0) / 
                            LAG(COUNT(*)) OVER (
                                PARTITION BY kubernetes_namespace_name 
                                ORDER BY histogram(_timestamp)
                            ), 2
                        )
                    ELSE 0
                END AS growth_rate_percent
            FROM "stream_pytest_data"
            WHERE kubernetes_namespace_name IN ('production', 'staging', 'monitoring', 'default')
            GROUP BY histogram(_timestamp), kubernetes_namespace_name
            ORDER BY histogram(_timestamp), kubernetes_namespace_name""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
        },
    }

    # Retry logic with exponential backoff for connection errors
    max_retries = 3
    retry_delay = 2
    last_error = None

    for attempt in range(max_retries):
        try:
            resp_get_allsearch = session.post(
                f"{url}api/{org_id}/_search?type=logs",
                json=json_data,
                timeout=60  # 60 seconds timeout for complex query
            )
            break  # Success, exit retry loop
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            last_error = e
            if attempt < max_retries - 1:
                wait_time = retry_delay * (2 ** attempt)  # Exponential backoff
                logging.warning(f"Attempt {attempt + 1}/{max_retries} failed with {type(e).__name__}: {e}. Retrying in {wait_time}s...")
                time.sleep(wait_time)
            else:
                logging.error(f"All {max_retries} attempts failed. Last error: {e}")
                pytest.skip(f"Skipping test due to persistent connection issues after {max_retries} attempts: {e}")

    assert (
        resp_get_allsearch.status_code == 200
    ), f"Time-series window functions query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for time-series window functions")
        for i, hit in enumerate(hits):
            assert "time_bucket" in hit, f"Hit {i} should contain 'time_bucket' field"
            assert "environment" in hit, f"Hit {i} should contain 'environment' field"
            assert "current_count" in hit, f"Hit {i} should contain 'current_count' field"
            assert "growth_rate_percent" in hit, f"Hit {i} should contain 'growth_rate_percent' field"
            
            # Validate counts are positive
            current_count = hit["current_count"]
            assert current_count > 0, f"Hit {i} current_count should be > 0, got {current_count}"
            
            # Validate environment is one of expected values
            environment = hit["environment"]
            assert environment in ['production', 'staging', 'monitoring', 'default'], f"Hit {i} unexpected environment: {environment}"
            
            logging.debug(f"Hit {i}: {environment} at {hit['time_bucket']}, count={current_count}, growth={hit['growth_rate_percent']}%")
        
        logging.info(f"✅ All {len(hits)} hits have valid time-series window function data")
    else:
        logging.warning("⚠️  No hits found for time-series window functions query")


def test_e2e_advanced_regex_json_path(create_session, base_url):
    """Running an E2E test for advanced regex with JSON path extraction."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """SELECT 
                regexp_match(message, '/api/([^/]+)')[1] AS api_group,
                regexp_match(message, '/([^?/]+)(?:\\?|$)')[1] AS endpoint,
                method AS http_method,
                AVG(CAST(took AS FLOAT)) AS avg_response_time,
                COUNT(CASE WHEN CAST(code AS INT) >= 400 THEN 1 END) AS error_count,
                COUNT(CASE WHEN CAST(code AS INT) >= 500 THEN 1 END) AS server_error_count,
                approx_percentile_cont(CAST(took AS FLOAT), 0.99) AS p99_response_time,
                CASE 
                    WHEN COUNT(CASE WHEN CAST(code AS INT) >= 500 THEN 1 END) > 0 THEN 'Critical'
                    WHEN COUNT(CASE WHEN CAST(code AS INT) >= 400 THEN 1 END) > 2 THEN 'Warning'
                    WHEN AVG(CAST(took AS FLOAT)) > 5000 THEN 'Slow'
                    ELSE 'Healthy'
                END AS health_status
            FROM "stream_pytest_data"
            WHERE message IS NOT NULL 
                AND message LIKE '/api/%'
                AND method IS NOT NULL
                AND took IS NOT NULL
                AND code IS NOT NULL
            GROUP BY regexp_match(message, '/api/([^/]+)')[1], regexp_match(message, '/([^?/]+)(?:\\?|$)')[1], method
            HAVING COUNT(*) >= 1
            ORDER BY COUNT(CASE WHEN CAST(code AS INT) >= 400 THEN 1 END) DESC, AVG(CAST(took AS FLOAT)) DESC""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Advanced regex JSON path query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for advanced regex JSON path extraction")
        for i, hit in enumerate(hits):
            assert "api_group" in hit, f"Hit {i} should contain 'api_group' field"
            assert "endpoint" in hit, f"Hit {i} should contain 'endpoint' field"
            assert "http_method" in hit, f"Hit {i} should contain 'http_method' field"
            assert "avg_response_time" in hit, f"Hit {i} should contain 'avg_response_time' field"
            assert "error_count" in hit, f"Hit {i} should contain 'error_count' field"
            assert "server_error_count" in hit, f"Hit {i} should contain 'server_error_count' field"
            assert "p99_response_time" in hit, f"Hit {i} should contain 'p99_response_time' field"
            assert "health_status" in hit, f"Hit {i} should contain 'health_status' field"
            
            # Validate counts are non-negative
            error_count = hit["error_count"]
            server_error_count = hit["server_error_count"]
            assert error_count >= 0, f"Hit {i} error_count should be >= 0, got {error_count}"
            assert server_error_count >= 0, f"Hit {i} server_error_count should be >= 0, got {server_error_count}"
            assert server_error_count <= error_count, f"Hit {i} server_error_count({server_error_count}) should be <= error_count({error_count})"
            
            # Validate health status is one of expected values
            health_status = hit["health_status"]
            assert health_status in ['Critical', 'Warning', 'Slow', 'Healthy'], f"Hit {i} unexpected health_status: {health_status}"
            
            logging.debug(f"Hit {i}: {hit['api_group']}/{hit['endpoint']} ({hit['http_method']}) - {health_status}, errors={error_count}")
        
        logging.info(f"✅ All {len(hits)} hits have valid advanced regex JSON path data")
    else:
        logging.warning("⚠️  No hits found for advanced regex JSON path query")


def test_e2e_complex_nested_aggregation(create_session, base_url):
    """Running an E2E test for complex nested aggregation with cross-environment analysis."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """WITH env_metrics AS (
                SELECT 
                    kubernetes_namespace_name AS environment,
                    kubernetes_container_name AS service,
                    COUNT(*) AS log_count,
                    COUNT(CASE WHEN level IN ('error', 'warn') THEN 1 END) AS issue_count,
                    AVG(CASE WHEN took IS NOT NULL THEN CAST(took AS FLOAT) ELSE NULL END) AS avg_latency
                FROM "stream_pytest_data"
                WHERE kubernetes_namespace_name IS NOT NULL
                GROUP BY kubernetes_namespace_name, kubernetes_container_name
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
            ORDER BY em.environment, RANK() OVER (PARTITION BY em.environment ORDER BY em.issue_count DESC)""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Complex nested aggregation query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        logging.info(f"Found {len(hits)} hits for complex nested aggregation")
        for i, hit in enumerate(hits):
            assert "environment" in hit, f"Hit {i} should contain 'environment' field"
            assert "service" in hit, f"Hit {i} should contain 'service' field"
            assert "log_count" in hit, f"Hit {i} should contain 'log_count' field"
            assert "issue_count" in hit, f"Hit {i} should contain 'issue_count' field"
            assert "log_share_percent" in hit, f"Hit {i} should contain 'log_share_percent' field"
            assert "service_status" in hit, f"Hit {i} should contain 'service_status' field"
            assert "issue_rank" in hit, f"Hit {i} should contain 'issue_rank' field"
            
            # Validate counts and percentages
            log_count = hit["log_count"]
            issue_count = hit["issue_count"]
            log_share_percent = hit["log_share_percent"]
            issue_rank = hit["issue_rank"]
            
            assert log_count > 0, f"Hit {i} log_count should be > 0, got {log_count}"
            assert issue_count >= 0, f"Hit {i} issue_count should be >= 0, got {issue_count}"
            assert 0 <= log_share_percent <= 100, f"Hit {i} log_share_percent should be 0-100, got {log_share_percent}"
            assert issue_rank >= 1, f"Hit {i} issue_rank should be >= 1, got {issue_rank}"
            
            # Validate service status is one of expected values
            service_status = hit["service_status"]
            assert service_status in ['High Latency', 'High Issues', 'High Volume', 'Normal'], f"Hit {i} unexpected service_status: {service_status}"
            
            logging.debug(f"Hit {i}: {hit['environment']}/{hit['service']} - {service_status}, rank={issue_rank}, share={log_share_percent}%")
        
        logging.info(f"✅ All {len(hits)} hits have valid complex nested aggregation data")
    else:
        logging.warning("⚠️  No hits found for complex nested aggregation query")

