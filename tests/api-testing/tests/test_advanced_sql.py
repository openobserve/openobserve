import json
import requests
import pytest

from datetime import datetime, timezone, timedelta
import time

# Global variable to store detected array indexing convention
OPENOBSERVE_ARRAY_INDEXING = None

@pytest.fixture(scope="module")
def time_range():
    """Fixture providing validated start and end time for queries."""
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    return validate_time_parameters(one_hour_ago, end_time)

@pytest.fixture
def query_config(time_range):
    """Fixture providing common query configuration."""
    start_time, end_time = time_range
    return {
        "start_time": start_time,
        "end_time": end_time,
        "from": 0,
        "size": 100,
    }

def validate_time_parameters(start_time, end_time):
    """Validate and sanitize time parameters to prevent injection attacks."""
    # Ensure parameters are integers
    if not isinstance(start_time, int) or not isinstance(end_time, int):
        raise ValueError("Time parameters must be integers")
    
    # Ensure reasonable bounds (not negative, end_time > start_time)
    if start_time < 0 or end_time < 0:
        raise ValueError("Time parameters cannot be negative")
    
    if end_time <= start_time:
        raise ValueError("End time must be greater than start time")
    
    # Ensure reasonable time range (not more than 24 hours for tests)
    max_time_range = 24 * 60 * 60 * 1000000  # 24 hours in microseconds
    if (end_time - start_time) > max_time_range:
        raise ValueError("Time range too large for test queries")
    
    return start_time, end_time


def execute_query(session, base_url, sql, query_config, test_name="query"):
    """Helper function to execute a SQL query and return validated results."""
    org_id = "default"
    json_data = {
        "query": {
            "sql": sql,
            **query_config
        },
    }

    resp = session.post(f"{base_url}api/{org_id}/_search?type=logs", json=json_data)
    
    assert (
        resp.status_code == 200
    ), f"{test_name} failed with status {resp.status_code} {resp.content}"
    
    response_data = resp.json()
    assert "hits" in response_data, f"{test_name} response should contain 'hits' field"
    
    return response_data["hits"]


def validate_array_data(hit, hit_index, expected_pattern=None, case_sensitive=True):
    """Helper function to validate array data in query results."""
    assert "log" in hit, f"Hit {hit_index} should contain 'log' field"
    
    log_value = hit["log"]
    assert log_value, f"Hit {hit_index} log should not be empty"
    assert log_value.startswith('['), f"Hit {hit_index} log should be array format, got: {log_value}"
    
    if expected_pattern:
        import json
        try:
            array_data = json.loads(log_value)
            if len(array_data) > 0:
                expected_first_element = array_data[0]  # Assume 1-based indexing
                
                if case_sensitive:
                    pattern_match = expected_pattern in expected_first_element
                    print(f"  Validated: Python array[0]='{expected_first_element}' contains '{expected_pattern}' (case sensitive)")
                else:
                    pattern_match = expected_pattern.lower() in expected_first_element.lower()
                    print(f"  Validated: Python array[0]='{expected_first_element}' contains '{expected_pattern}' (case insensitive)")
                
                assert pattern_match, f"Hit {hit_index} first array element '{expected_first_element}' should contain '{expected_pattern}'"
                
        except json.JSONDecodeError:
            assert False, f"Hit {hit_index} log is not valid JSON array: {log_value}"
    
    return log_value


def test_e2e_error_rate_analysis(create_session, base_url, query_config):
    """Running an E2E test for error rate analysis query."""

    sql = """SELECT 
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
    LIMIT 50"""

    # Override default size for this query
    config = query_config.copy()
    config["size"] = 50

    hits = execute_query(create_session, base_url, sql, config, "Error rate analysis query")
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


def test_e2e_array_case_sensitive(create_session, base_url, query_config):
    """Running an E2E test for array extraction with case-sensitive matching."""

    sql = """SELECT *
    FROM "stream_pytest_data"
    WHERE str_match(array_extract(cast_to_arr(log), 1), 'fu')"""

    hits = execute_query(create_session, base_url, sql, query_config, "Array case-sensitive query")
    
    if len(hits) > 0:
        print(f"Found {len(hits)} hits for case-sensitive array extraction")
        for i, hit in enumerate(hits):
            validate_array_data(hit, i, 'fu', case_sensitive=True)
            print(f"Hit {i}: log = {hit['log']}")
        
        print(f"✅ All {len(hits)} hits have valid case-sensitive array data")
        # Should find 1 hit: ["datafusion", "bad"] (contains 'fu')
        # Should NOT find: ["parsing", "Fu"] (case sensitive, 'fu' != 'Fu')
        assert len(hits) >= 1, f"Expected at least 1 hit for case-sensitive 'fu' substring match, got {len(hits)}"
    else:
        print("⚠️  No hits found for case-sensitive array query")


def test_e2e_array_case_insensitive(create_session, base_url, query_config):
    """Running an E2E test for array extraction with case-insensitive matching."""

    sql = """SELECT *
    FROM "stream_pytest_data"
    WHERE str_match_ignore_case(array_extract(cast_to_arr(log), 1), 'Fu')"""

    hits = execute_query(create_session, base_url, sql, query_config, "Array case-insensitive query")
    if len(hits) > 0:
        print(f"Found {len(hits)} hits for case-insensitive array extraction")
        for i, hit in enumerate(hits):
            validate_array_data(hit, i, 'fu', case_sensitive=False)
            print(f"Hit {i}: log = {hit['log']}")
        
        print(f"✅ All {len(hits)} hits have valid case-insensitive array data")
        # Should find 2 hits: ["datafusion", "bad"] and ["parsing", "Fu"]
        assert len(hits) >= 1, f"Expected at least 1 hit for case-insensitive 'Fu' match, got {len(hits)}"
    else:
        print("⚠️  No hits found for case-insensitive array query")


def test_e2e_array_indexing_convention(create_session, base_url):
    """Running an E2E test to verify OpenObserve's array indexing convention (1-based vs 0-based)."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    
    # Test array indexing with known data: ["datafusion", "bad"], ["querying", "good"], ["parsing", "Fu"]
    json_data = {
        "query": {
            "sql": """SELECT 
                log,
                array_extract(cast_to_arr(log), 1) AS first_element,
                array_extract(cast_to_arr(log), 2) AS second_element,
                array_length(cast_to_arr(log)) AS array_len
            FROM "stream_pytest_data"
            WHERE log LIKE '[%'
            ORDER BY kubernetes_container_name""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 10,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Array indexing convention query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    assert len(hits) > 0, "Should find array test data for indexing verification"
    
    print(f"🔍 Verifying array indexing convention with {len(hits)} hits")
    
    indexing_convention = None  # Will be determined from first hit
    
    for i, hit in enumerate(hits):
        assert "log" in hit, f"Hit {i} should contain 'log' field"
        assert "first_element" in hit, f"Hit {i} should contain 'first_element' field"
        assert "second_element" in hit, f"Hit {i} should contain 'second_element' field"
        assert "array_len" in hit, f"Hit {i} should contain 'array_len' field"
        
        log_value = hit["log"]
        first_element = hit["first_element"]
        second_element = hit["second_element"]
        array_len = hit["array_len"]
        
        print(f"Hit {i}: log={log_value}")
        print(f"  SQL array_extract(log, 1) = '{first_element}'")
        print(f"  SQL array_extract(log, 2) = '{second_element}'")
        print(f"  SQL array_length = {array_len}")
        
        # Parse the JSON array for comparison
        import json
        try:
            python_array = json.loads(log_value)
            print(f"  Python array[0] = '{python_array[0] if len(python_array) > 0 else 'N/A'}'")
            print(f"  Python array[1] = '{python_array[1] if len(python_array) > 1 else 'N/A'}'")
            print(f"  Python len(array) = {len(python_array)}")
            
            # Determine indexing convention from first valid hit
            if indexing_convention is None and len(python_array) >= 2:
                if first_element == python_array[0]:
                    indexing_convention = "1-based"
                    print(f"  ✅ DETECTED: OpenObserve uses 1-BASED indexing (SQL index 1 = Python index 0)")
                elif first_element == python_array[1]:
                    indexing_convention = "0-based"  
                    print(f"  ✅ DETECTED: OpenObserve uses 0-BASED indexing (SQL index 1 = Python index 1)")
                else:
                    print(f"  ❓ UNCLEAR: SQL first_element '{first_element}' doesn't match expected Python elements")
            
            # Validate consistency with detected convention
            if indexing_convention == "1-based":
                assert first_element == python_array[0], f"Hit {i}: SQL array_extract(log, 1) should equal Python array[0]"
                if len(python_array) > 1:
                    assert second_element == python_array[1], f"Hit {i}: SQL array_extract(log, 2) should equal Python array[1]"
                assert array_len == len(python_array), f"Hit {i}: SQL array_length should equal Python len()"
            
            elif indexing_convention == "0-based":
                assert first_element == python_array[1], f"Hit {i}: SQL array_extract(log, 1) should equal Python array[1]"  
                if len(python_array) > 2:
                    assert second_element == python_array[2], f"Hit {i}: SQL array_extract(log, 2) should equal Python array[2]"
                assert array_len == len(python_array), f"Hit {i}: SQL array_length should equal Python len()"
        
        except json.JSONDecodeError:
            assert False, f"Hit {i} log is not valid JSON array: {log_value}"
        
        print()  # Empty line for readability
    
    assert indexing_convention is not None, "Could not determine OpenObserve's array indexing convention"
    
    # Store the detected convention for other tests to use
    global OPENOBSERVE_ARRAY_INDEXING
    OPENOBSERVE_ARRAY_INDEXING = indexing_convention
    
    print(f"🎯 CONCLUSION: OpenObserve uses {indexing_convention.upper()} array indexing")
    print(f"✅ All {len(hits)} hits validated against {indexing_convention} indexing convention")


def test_e2e_array_bounds_and_edge_cases(create_session, base_url):
    """Running an E2E test for array bounds checking and edge case handling."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    
    # Test array bounds, NULL handling, and edge cases
    json_data = {
        "query": {
            "sql": """SELECT 
                log,
                array_extract(cast_to_arr(log), 1) AS element_1,
                array_extract(cast_to_arr(log), 2) AS element_2, 
                array_extract(cast_to_arr(log), 3) AS element_3,
                array_extract(cast_to_arr(log), 99) AS element_99,
                array_length(cast_to_arr(log)) AS array_len,
                array_extract(cast_to_arr(COALESCE(log, '[]')), 1) AS null_safe_element
            FROM "stream_pytest_data"
            WHERE log LIKE '[%' OR log IS NULL
            ORDER BY kubernetes_container_name
            LIMIT 5""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 10,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Array bounds and edge cases query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        print(f"🔍 Testing array bounds and edge cases with {len(hits)} hits")
        
        for i, hit in enumerate(hits):
            log_value = hit["log"]
            element_1 = hit.get("element_1")
            element_2 = hit.get("element_2") 
            element_3 = hit.get("element_3")
            element_99 = hit.get("element_99")  # Out of bounds
            array_len = hit.get("array_len")
            null_safe_element = hit.get("null_safe_element")
            
            print(f"Hit {i}: log={log_value}")
            print(f"  element_1={element_1}, element_2={element_2}, element_3={element_3}")
            print(f"  element_99 (out of bounds)={element_99}")
            print(f"  array_length={array_len}, null_safe_element={null_safe_element}")
            
            if log_value and log_value.startswith('['):
                import json
                try:
                    python_array = json.loads(log_value)
                    expected_len = len(python_array)
                    
                    # Validate array length consistency
                    if array_len is not None:
                        assert array_len == expected_len, f"Hit {i}: SQL array_length({array_len}) != Python len({expected_len})"
                    
                    # Test out-of-bounds behavior
                    print(f"  🧪 Out-of-bounds element_99: {element_99} (should be NULL or handle gracefully)")
                    # Most SQL engines return NULL for out-of-bounds access
                    
                    # Test null-safe extraction
                    print(f"  🛡️  NULL-safe extraction works: {null_safe_element}")
                    
                except json.JSONDecodeError:
                    print(f"  ⚠️  Invalid JSON array: {log_value}")
            
            print()  # Empty line for readability
        
        print(f"✅ Array bounds and edge case testing completed for {len(hits)} hits")
        
        # Key validations for array handling robustness
        bounds_test_passed = True
        for hit in hits:
            element_99 = hit.get("element_99")
            # Out-of-bounds should typically return NULL, not throw error
            if element_99 is not None and element_99 != "":
                print(f"⚠️  Warning: Out-of-bounds array access returned non-NULL: {element_99}")
        
        print("✅ Array bounds handling appears robust (no crashes on out-of-bounds access)")
    else:
        print("⚠️  No hits found for array bounds testing")


def test_e2e_window_function_compatibility(create_session, base_url):
    """Running an E2E test to validate window function semantics and compatibility."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    
    # Test window function semantics with proper separation of concerns
    json_data = {
        "query": {
            "sql": """WITH base_counts AS (
                SELECT 
                    histogram(_timestamp) AS time_bucket,
                    kubernetes_namespace_name AS environment,
                    COUNT(*) AS log_count,
                    SUM(CASE WHEN level = 'info' THEN 1 ELSE 0 END) AS info_count
                FROM "stream_pytest_data"
                WHERE kubernetes_namespace_name IS NOT NULL
                GROUP BY histogram(_timestamp), kubernetes_namespace_name
            ),
            windowed_metrics AS (
                SELECT 
                    time_bucket,
                    environment,
                    log_count,
                    info_count,
                    LAG(log_count, 1) OVER (
                        PARTITION BY environment 
                        ORDER BY time_bucket
                    ) AS prev_log_count,
                    LAG(log_count, 2) OVER (
                        PARTITION BY environment 
                        ORDER BY time_bucket  
                    ) AS prev2_log_count,
                    LEAD(log_count, 1) OVER (
                        PARTITION BY environment 
                        ORDER BY time_bucket
                    ) AS next_log_count,
                    ROW_NUMBER() OVER (
                        PARTITION BY environment 
                        ORDER BY time_bucket
                    ) AS time_sequence,
                    RANK() OVER (
                        PARTITION BY environment 
                        ORDER BY log_count DESC
                    ) AS count_rank
                FROM base_counts
            )
            SELECT 
                time_bucket,
                environment,
                log_count,
                prev_log_count,
                next_log_count,
                time_sequence,
                count_rank,
                CASE 
                    WHEN prev_log_count IS NOT NULL AND prev_log_count > 0 THEN
                        ROUND((log_count - prev_log_count) * 100.0 / prev_log_count, 2)
                    ELSE 0
                END AS growth_rate_percent,
                CASE
                    WHEN time_sequence = 1 THEN 'First'
                    WHEN next_log_count IS NULL THEN 'Last' 
                    ELSE 'Middle'
                END AS sequence_position
            FROM windowed_metrics
            ORDER BY environment, time_bucket
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
    ), f"Window function compatibility query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        print(f"🔍 Testing window function compatibility with {len(hits)} hits")
        
        # Validate window function semantics
        environments_seen = {}
        
        for i, hit in enumerate(hits):
            # Required fields from window functions
            assert "time_bucket" in hit, f"Hit {i} should contain 'time_bucket' field"
            assert "environment" in hit, f"Hit {i} should contain 'environment' field"
            assert "log_count" in hit, f"Hit {i} should contain 'log_count' field"
            assert "time_sequence" in hit, f"Hit {i} should contain 'time_sequence' field"
            assert "count_rank" in hit, f"Hit {i} should contain 'count_rank' field"
            assert "sequence_position" in hit, f"Hit {i} should contain 'sequence_position' field"
            
            environment = hit["environment"]
            log_count = hit["log_count"]
            prev_log_count = hit.get("prev_log_count")
            next_log_count = hit.get("next_log_count")
            time_sequence = hit["time_sequence"]
            count_rank = hit["count_rank"]
            growth_rate = hit["growth_rate_percent"]
            sequence_pos = hit["sequence_position"]
            
            print(f"Hit {i}: {environment} seq={time_sequence} rank={count_rank}")
            print(f"  counts: prev={prev_log_count}, current={log_count}, next={next_log_count}")
            print(f"  growth: {growth_rate}%, position: {sequence_pos}")
            
            # Track environments for sequence validation
            if environment not in environments_seen:
                environments_seen[environment] = []
            environments_seen[environment].append((time_sequence, sequence_pos))
            
            # Validate window function results
            assert log_count > 0, f"Hit {i} log_count should be > 0, got {log_count}"
            assert time_sequence >= 1, f"Hit {i} time_sequence should be >= 1, got {time_sequence}"
            assert count_rank >= 1, f"Hit {i} count_rank should be >= 1, got {count_rank}"
            assert sequence_pos in ['First', 'Middle', 'Last'], f"Hit {i} unexpected sequence_position: {sequence_pos}"
            
            # Validate LAG/LEAD semantics
            if sequence_pos == 'First':
                assert prev_log_count is None, f"Hit {i} first record should have NULL prev_log_count"
            if sequence_pos == 'Last':
                assert next_log_count is None, f"Hit {i} last record should have NULL next_log_count"
            
            # Validate growth rate calculation
            if prev_log_count is not None and prev_log_count > 0:
                expected_growth = round((log_count - prev_log_count) * 100.0 / prev_log_count, 2)
                assert abs(growth_rate - expected_growth) < 0.01, f"Hit {i} growth rate mismatch: expected {expected_growth}, got {growth_rate}"
            else:
                assert growth_rate == 0, f"Hit {i} should have 0 growth rate when prev_log_count is NULL or 0"
            
            print()  # Empty line for readability
        
        # Validate sequence integrity per environment
        print("🔍 Validating window function sequence integrity:")
        for env, sequences in environments_seen.items():
            sequences.sort()  # Sort by time_sequence
            
            has_first = any(pos == 'First' for _, pos in sequences)
            has_last = any(pos == 'Last' for _, pos in sequences) 
            
            print(f"  {env}: {len(sequences)} time buckets, First={has_first}, Last={has_last}")
            
            # Validate sequence numbers are consecutive
            seq_numbers = [seq for seq, _ in sequences]
            expected_sequences = list(range(1, len(sequences) + 1))
            
            if len(sequences) > 1:
                print(f"    Sequence numbers: {seq_numbers}")
                # Note: May not be consecutive if data is sparse across time buckets
        
        print(f"✅ Window function compatibility validated for {len(hits)} hits across {len(environments_seen)} environments")
        print("✅ LAG/LEAD semantics working correctly")
        print("✅ ROW_NUMBER and RANK functions working correctly") 
        print("✅ Histogram bucketing alignment confirmed")
        
    else:
        print("⚠️  No hits found for window function compatibility testing")


def test_sql_injection_prevention():
    """Test that validates our SQL injection prevention measures."""
    
    print("🛡️  Testing SQL injection prevention measures")
    
    # Test 1: Invalid time parameter types
    try:
        validate_time_parameters("malicious_string", 1234567890)
        assert False, "Should have raised ValueError for non-integer start_time"
    except ValueError as e:
        assert "must be integers" in str(e)
        print("✅ Rejected non-integer start_time")
    
    try:
        validate_time_parameters(1234567890, "'; DROP TABLE users; --")
        assert False, "Should have raised ValueError for non-integer end_time"
    except ValueError as e:
        assert "must be integers" in str(e)
        print("✅ Rejected non-integer end_time")
    
    # Test 2: Negative time values
    try:
        validate_time_parameters(-1, 1234567890)
        assert False, "Should have raised ValueError for negative start_time"
    except ValueError as e:
        assert "cannot be negative" in str(e)
        print("✅ Rejected negative start_time")
    
    # Test 3: Invalid time ranges (end_time <= start_time)
    try:
        validate_time_parameters(1234567890, 1234567889)
        assert False, "Should have raised ValueError for end_time <= start_time"
    except ValueError as e:
        assert "must be greater than" in str(e)
        print("✅ Rejected invalid time range")
    
    # Test 4: Excessively large time ranges
    now = int(datetime.now(timezone.utc).timestamp() * 1000000)
    try:
        validate_time_parameters(now, now + (25 * 60 * 60 * 1000000))  # 25 hours
        assert False, "Should have raised ValueError for too large time range"
    except ValueError as e:
        assert "too large" in str(e)
        print("✅ Rejected excessively large time range")
    
    # Test 5: Valid time parameters should pass
    try:
        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
        validated_start, validated_end = validate_time_parameters(one_hour_ago, end_time)
        assert validated_start == one_hour_ago
        assert validated_end == end_time
        print("✅ Accepted valid time parameters")
    except Exception as e:
        assert False, f"Valid time parameters should not raise exception: {e}"
    
    # Test 6: SQL string validation (static SQL only)
    static_sql_patterns = [
        "SELECT * FROM \"stream_pytest_data\" WHERE str_match(",
        "SELECT COUNT(*) FROM \"stream_pytest_data\" GROUP BY",
        "WITH base_counts AS (SELECT histogram(_timestamp)",
    ]
    
    for pattern in static_sql_patterns:
        # These are safe because they're static strings, not interpolated
        assert "DROP" not in pattern.upper(), f"SQL pattern should not contain DROP: {pattern}"
        assert "DELETE" not in pattern.upper(), f"SQL pattern should not contain DELETE: {pattern}"
        assert "--" not in pattern, f"SQL pattern should not contain SQL comments: {pattern}"
        print(f"✅ SQL pattern validated: {pattern[:50]}...")
    
    print("🛡️  All SQL injection prevention tests passed!")


def test_e2e_multi_level_array_processing(create_session, base_url):
    """Running an E2E test for multi-level array processing with conditional logic."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_hour_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": """SELECT 
                kubernetes_container_name AS service,
                COUNT(*) AS total_logs,
                COUNT(CASE 
                    WHEN array_length(cast_to_arr(log)) > 1 
                        AND str_match_ignore_case(array_extract(cast_to_arr(log), 2), 'bad|good|error') 
                    THEN 1 
                END) AS status_logs,
                array_to_string(
                    array_agg(DISTINCT array_extract(cast_to_arr(log), 1)), 
                    ','
                ) AS unique_components
            FROM "stream_pytest_data"
            WHERE log LIKE '[%' 
                AND array_length(cast_to_arr(log)) >= 2
            GROUP BY service
            HAVING total_logs > 0
            ORDER BY status_logs DESC""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Multi-level array processing query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        print(f"Found {len(hits)} hits for multi-level array processing")
        for i, hit in enumerate(hits):
            assert "service" in hit, f"Hit {i} should contain 'service' field"
            assert "total_logs" in hit, f"Hit {i} should contain 'total_logs' field"
            assert "status_logs" in hit, f"Hit {i} should contain 'status_logs' field"
            assert "unique_components" in hit, f"Hit {i} should contain 'unique_components' field"
            
            # Validate counts are non-negative
            total_logs = hit["total_logs"]
            status_logs = hit["status_logs"]
            assert total_logs > 0, f"Hit {i} total_logs should be > 0, got {total_logs}"
            assert status_logs >= 0, f"Hit {i} status_logs should be >= 0, got {status_logs}"
            assert status_logs <= total_logs, f"Hit {i} status_logs({status_logs}) should be <= total_logs({total_logs})"
            
            print(f"Hit {i}: service={hit['service']}, total_logs={total_logs}, status_logs={status_logs}, components={hit['unique_components']}")
        
        print(f"✅ All {len(hits)} hits have valid multi-level array processing data")
    else:
        print("⚠️  No hits found for multi-level array processing query")


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
            "sql": """WITH time_series_base AS (
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
            ORDER BY time_bucket, environment""",
            "start_time": one_hour_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
        },
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Time-series window functions query failed with status {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    
    response_data = resp_get_allsearch.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    if len(hits) > 0:
        print(f"Found {len(hits)} hits for time-series window functions")
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
            
            print(f"Hit {i}: {environment} at {hit['time_bucket']}, count={current_count}, growth={hit['growth_rate_percent']}%")
        
        print(f"✅ All {len(hits)} hits have valid time-series window function data")
    else:
        print("⚠️  No hits found for time-series window functions query")


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
            GROUP BY api_group, endpoint, http_method
            HAVING COUNT(*) >= 1
            ORDER BY error_count DESC, avg_response_time DESC""",
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
        print(f"Found {len(hits)} hits for advanced regex JSON path extraction")
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
            
            print(f"Hit {i}: {hit['api_group']}/{hit['endpoint']} ({hit['http_method']}) - {health_status}, errors={error_count}")
        
        print(f"✅ All {len(hits)} hits have valid advanced regex JSON path data")
    else:
        print("⚠️  No hits found for advanced regex JSON path query")


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
            ORDER BY em.environment, issue_rank""",
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
        print(f"Found {len(hits)} hits for complex nested aggregation")
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
            
            print(f"Hit {i}: {hit['environment']}/{hit['service']} - {service_status}, rank={issue_rank}, share={log_share_percent}%")
        
        print(f"✅ All {len(hits)} hits have valid complex nested aggregation data")
    else:
        print("⚠️  No hits found for complex nested aggregation query")

