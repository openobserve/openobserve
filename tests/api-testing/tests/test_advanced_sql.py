import json
import requests
import pytest

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
            GROUP BY component, environment
            HAVING inforate >= 0
            ORDER BY inforate DESC
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
        print(f"Found {len(hits)} hits for info rate analysis")
        for i, hit in enumerate(hits):
            assert "pvcount" in hit, f"Hit {i} should contain 'pvcount' field"
            assert "infocount" in hit, f"Hit {i} should contain 'infocount' field"
            assert "inforate" in hit, f"Hit {i} should contain 'inforate' field"
            assert "component" in hit, f"Hit {i} should contain 'component' field"
            assert "environment" in hit, f"Hit {i} should contain 'environment' field"
            
            # Validate info rate is >= 0 as per HAVING clause
            info_rate = hit["inforate"]
            assert info_rate >= 0, f"Hit {i} info rate should be >= 0, got {info_rate}"
        
        print(f"✅ All {len(hits)} hits have valid info rate analysis data")
    else:
        print("⚠️  No hits found for info rate analysis query")


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
            GROUP BY _time
            ORDER BY _time""",
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
        print(f"Found {len(hits)} hits for performance percentiles")
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
        
        print(f"✅ All {len(hits)} hits have valid performance percentile data")
    else:
        print("⚠️  No hits found for performance percentiles query")


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
            GROUP BY time_bucket, component
            ORDER BY time_bucket ASC, info_rate DESC""",
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
        print(f"Found {len(hits)} hits for log volume analysis")
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
        
        print(f"✅ All {len(hits)} hits have valid log volume analysis data")
    else:
        print("⚠️  No hits found for log volume analysis query")


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
            GROUP BY platform, source_group
            ORDER BY log_count DESC""",
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
        print(f"Found {len(hits)} hits for source analysis")
        for i, hit in enumerate(hits):
            assert "platform" in hit, f"Hit {i} should contain 'platform' field"
            assert "source_group" in hit, f"Hit {i} should contain 'source_group' field"
            assert "log_count" in hit, f"Hit {i} should contain 'log_count' field"
            
            # Validate log_count is positive
            log_count = hit["log_count"]
            assert log_count > 0, f"Hit {i} log_count should be > 0, got {log_count}"
        
        print(f"✅ All {len(hits)} hits have valid source analysis data")
    else:
        print("⚠️  No hits found for source analysis query")


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
            GROUP BY hostname
            ORDER BY avg_float_value DESC
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
        print(f"Found {len(hits)} hits for host performance analysis")
        for i, hit in enumerate(hits):
            assert "hostname" in hit, f"Hit {i} should contain 'hostname' field"
            assert "unique_stream_count" in hit, f"Hit {i} should contain 'unique_stream_count' field"
            assert "unique_level_count" in hit, f"Hit {i} should contain 'unique_level_count' field"
            assert "avg_float_value" in hit, f"Hit {i} should contain 'avg_float_value' field"
            assert "min_float_value" in hit, f"Hit {i} should contain 'min_float_value' field"
            assert "max_float_value" in hit, f"Hit {i} should contain 'max_float_value' field"
        
        print(f"✅ All {len(hits)} hits have valid host performance data")
    else:
        print("⚠️  No hits found for host performance query")


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
            GROUP BY component
            ORDER BY p99_took DESC
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
        print(f"Found {len(hits)} hits for component percentiles")
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
        
        print(f"✅ All {len(hits)} hits have valid component percentile data")
    else:
        print("⚠️  No hits found for component percentiles query")


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
            GROUP BY api, log_level, component, platform
            ORDER BY api, counter DESC""",
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
        print(f"Found {len(hits)} hits for API log analysis")
        for i, hit in enumerate(hits):
            assert "api" in hit, f"Hit {i} should contain 'api' field"
            assert "log_level" in hit, f"Hit {i} should contain 'log_level' field"
            assert "api_info_log_count" in hit, f"Hit {i} should contain 'api_info_log_count' field"
            assert "component" in hit, f"Hit {i} should contain 'component' field"
            assert "platform" in hit, f"Hit {i} should contain 'platform' field"
            assert "counter" in hit, f"Hit {i} should contain 'counter' field"
        
        print(f"✅ All {len(hits)} hits have valid API log analysis data")
    else:
        print("⚠️  No hits found for API log analysis query")


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
            GROUP BY log_category, _date
            ORDER BY count DESC
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
        print(f"Found {len(hits)} hits for error categorization")
        for i, hit in enumerate(hits):
            assert "count" in hit, f"Hit {i} should contain 'count' field"
            assert "log_category" in hit, f"Hit {i} should contain 'log_category' field"
            assert "_date" in hit, f"Hit {i} should contain '_date' field"
            
            # Validate count is positive
            count = hit["count"]
            assert count > 0, f"Hit {i} count should be > 0, got {count}"
        
        print(f"✅ All {len(hits)} hits have valid error categorization data")
    else:
        print("⚠️  No hits found for error categorization query")


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
            GROUP BY caller""",
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
        print(f"Found {len(hits)} hits for caller extraction")
        for i, hit in enumerate(hits):
            assert "caller" in hit, f"Hit {i} should contain 'caller' field"
            assert "count" in hit, f"Hit {i} should contain 'count' field"
            
            # Validate count is positive
            count = hit["count"]
            assert count > 0, f"Hit {i} count should be > 0, got {count}"
        
        print(f"✅ All {len(hits)} hits have valid caller extraction data")
    else:
        print("⚠️  No hits found for caller extraction query")


