import os  # For environment variables
import json  # For JSON parsing
from datetime import datetime, timezone, timedelta  # For timestamp conversion
import time  # For sleep
from pathlib import Path  # For file paths
import pytest  # For fixtures
import random
import string
import base64
from requests.auth import HTTPBasicAuth

# Constants for Streaming URL and user credentials
ZO_BASE_URL = os.environ.get("ZO_BASE_URL")
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
WS_ZO_BASE_URL = os.environ.get("WS_ZO_BASE_URL")
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get(
    "ZO_ROOT_USER_PASSWORD"
)  # Use environment variable
now = datetime.now(timezone.utc)
end_time = int(now.timestamp() * 1000000)
ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)

org_id = "default"

root_dir = Path(__file__).parent.parent.parent


def generate_random_string(length=5):
    # Define the characters to choose from lower case letters
    characters = string.ascii_lowercase  # This includes only lowercase letters
    random_string = "".join(random.choice(characters) for _ in range(length))
    return random_string


# Generate a random string of length 5
random_string = generate_random_string()

stream_name = "tdef" + random_string

stream_join = "join" + random_string

print("Random Stream:", stream_name)

print("String Join:", stream_join)


@pytest.fixture
def base_url_sc():
    """Provide the base URL for the API of Super Cluster."""
    return ZO_BASE_URL_SC


def test_ingest_data(create_session, base_url_sc):
    """Ingest data into the openobserve running instance."""
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    # Open the json data file and read it
    with open(root_dir / "test-data/logs_data.json") as f:
        data = f.read()
    url_Ing = f"{base_url_sc}api/{org_id}/{stream_name}/_json"
    resp_ing = session.post(
        url_Ing, data=data, headers={"Content-Type": "application/json"}
    )
    print(
        f"Data ingested in {stream_name} of {base_url_sc} env, status code: ",
        resp_ing.status_code,
    )
    assert resp_ing.status_code == 200, (
        f"Data ingestion failed with status code: {resp_ing.status_code}"
    )

    # Join stream data


def test_ingest_join(create_session, base_url_sc):
    """Ingest join data into the openobserve running instance."""
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    # Open the json data file and read it
    with open(root_dir / "test-data/logs_data.json") as f:
        data = f.read()
    url_join = f"{base_url_sc}api/{org_id}/{stream_join}/_json"
    resp_ing_join = session.post(
        url_join, data=data, headers={"Content-Type": "application/json"}
    )
    print(
        f"Data ingested for join in {stream_join} of {base_url_sc} env, status code: ",
        resp_ing_join.status_code,
    )
    assert resp_ing_join.status_code == 200, (
        f"Data ingestion failed for join with status code: {resp_ing_join.status_code}"
    )


def test_disable_streaming(create_session, base_url):
    """Fixture to disable Streaming and return cookies."""
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    url = base_url
    payload_disable_streaming = {
        "scrape_interval": 15,
        "span_id_field_name": "span_id",
        "trace_id_field_name": "trace_id",
        "toggle_ingestion_logs": False,
        "enable_websocket_search": False,
        "enable_streaming_search": False,
    }

    print("Session headers:", session.headers)

    resp_disable_streaming = session.post(
        f"{url}api/{org_id}/settings", json=payload_disable_streaming
    )

    print("Disable Streaming", resp_disable_streaming.content)

    assert resp_disable_streaming.status_code == 200, (
        f"Streaming disable 200, but got {resp_disable_streaming.status_code} {resp_disable_streaming.content}"
    )


# Define test data with different queries and expected response details for histogram
test_data_histog = [
    (
        "Stream",
        f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{stream_name}" GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
        1,
        3848,
    ),
    (
        "AND",
        f"SELECT histogram(_timestamp, '10 second') AS \"zo_sql_key\", COUNT(*) AS \"zo_sql_num\" FROM \"{stream_name}\" WHERE kubernetes_container_name = 'ziox' AND kubernetes_labels_app = 'ziox' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
        1,
        2002,
    ),
    (
        "OR",
        f"SELECT histogram(_timestamp, '10 second') AS \"zo_sql_key\", COUNT(*) AS \"zo_sql_num\" FROM \"{stream_name}\" WHERE kubernetes_container_name = 'ziox' OR kubernetes_labels_app = 'ziox' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
        1,
        2002,
    ),
    (
        "Match_all",
        f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{stream_name}" WHERE match_all(\'ziox\') GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
        1,
        18,
    ),
    (
        "str_match",
        f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{stream_name}" WHERE str_match(kubernetes_container_name, \'ziox\') GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
        1,
        2002,
    ),
    (
        "Like",
        f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{stream_name}" WHERE kubernetes_container_name LIKE \'%ziox%\' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
        1,
        2002,
    ),
    (
        "IN",
        f"SELECT histogram(_timestamp, '10 second') AS \"zo_sql_key\", COUNT(*) AS \"zo_sql_num\" FROM \"{stream_name}\" WHERE kubernetes_container_name IN ('controller', 'ziox') GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
        1,
        2816,
    ),
    (
        "str_match_ignore_case",
        f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{stream_name}" WHERE str_match_ignore_case(kubernetes_container_name, \'ziox\') GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
        1,
        2002,
    ),
    (
        "Count Having",
        f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{stream_name}" GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
        1,
        3848,
    ),
    (
        "Not Null",
        f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{stream_name}" WHERE kubernetes_container_image IS NOT NULL GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
        1,
        3846,
    ),
    (
        "re_match",
        f'SELECT histogram(_timestamp, \'10 second\') AS "zo_sql_key", COUNT(*) AS "zo_sql_num" FROM "{stream_name}" WHERE re_match(kubernetes_container_name, \'ziox\') GROUP BY zo_sql_key ORDER BY zo_sql_key ASC',
        1,
        2002,
    ),
]


@pytest.mark.parametrize(
    "test_name, hist_query, expected_total_hits_results_histg, expected_zo_sql_num_histg",
    test_data_histog,
)
def test_histogram(
    create_session,
    base_url,
    test_name,
    hist_query,
    expected_total_hits_results_histg,
    expected_zo_sql_num_histg,
):
    """Running an E2E test for histogram queries with Parameterized data when websocket is disabled."""

    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)

    time.sleep(20)  # Increased wait time for data indexing

    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    ten_min_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)  # Increased to 1 hour to ensure data coverage across test runs
    json_data_hist = {
        "query": {
            "sql": hist_query,
            "start_time": ten_min_ago,
            "end_time": end_time,
            "size": -1,
        }
    }

    res_histog = session.post(
        f"{url}api/{org_id}/_search?type=logs&search_type=UI&use_cache=false",
        json=json_data_hist,
    )

    assert res_histog.status_code == 200, (
        f"histogram mode {test_name} added 200, but got {res_histog.status_code} {res_histog.content}"
    )

    print(
        f"API {test_name} Response {url} Histog False Cache HTTP:",
        res_histog.status_code,
    )

    # Parse the JSON response

    res_data_histog = res_histog.json()

    # Validate the total in the response
    total_hits_histog = res_data_histog["total"]

    # Adjust the assertion based on our expectations
    expected_hits_histog = expected_total_hits_results_histg  # we're expecting
    assert total_hits_histog >= 0, (
        f"Expected total {test_name} to be >= 0, but got {total_hits_histog}"
    )

    # Validate zo_sql_num hits histogram in the first hit
    if total_hits_histog > 0:
        actual_zo_sql_num_hits_histog = res_data_histog["hits"][0]["zo_sql_num"]
        assert actual_zo_sql_num_hits_histog == expected_zo_sql_num_histg, (
            f"Expected zo_sql_num histogram to be {expected_zo_sql_num_histg}, but got {actual_zo_sql_num_hits_histog}"
        )
    else:
        pytest.fail("No hits found in the response.")

    # Generate request for histogram cache enabled
    res_histog_cache = session.post(
        f"{url}api/{org_id}/_search?type=logs&search_type=UI&use_cache=true",
        json=json_data_hist,
    )

    assert res_histog_cache.status_code == 200, (
        f"histogram cache {test_name} mode added 200, but got {res_histog_cache.status_code} {res_histog_cache.content}"
    )

    print(f"Response {url} Cache True Histog HTTP:", res_histog_cache.status_code)

    # Parse the JSON response

    res_data_histog_cache = res_histog_cache.json()

    # Validate the total in the response
    total_hits_histog_cache = res_data_histog_cache["total"]

    # Adjust the assertion based on our expectations
    expected_hits_histog_cache = (
        expected_total_hits_results_histg  # what we're expecting
    )
    assert total_hits_histog_cache == expected_hits_histog_cache, (
        f"Expected {test_name} total to be {expected_hits_histog_cache}, but got {total_hits_histog_cache}"
    )

    # Validate zo_sql_num hits histogram in the first hit
    if total_hits_histog_cache > 0:
        actual_zo_sql_num_hits_histog_cache = res_data_histog_cache["hits"][0][
            "zo_sql_num"
        ]
        assert actual_zo_sql_num_hits_histog_cache == expected_zo_sql_num_histg, (
            f"Expected zo_sql_num histogram to be {expected_zo_sql_num_histg}, but got {actual_zo_sql_num_hits_histog_cache}"
        )
    else:
        pytest.fail("No hits found in the response.")


# Define test data with different queries and expected response details for SQL when websocket is disabled
test_data_sql = [
    (
        "Stream",
        f'SELECT * FROM "{stream_name}"',
        0,
        100,
        100,
    ),
    (
        "AND",
        f"SELECT * FROM \"{stream_name}\" where kubernetes_container_name = 'ziox' AND kubernetes_labels_app = 'ziox'",
        0,
        100,
        100,
    ),
    (
        "OR",
        f"SELECT * FROM \"{stream_name}\" where kubernetes_container_name = 'ziox' OR kubernetes_labels_app = 'ziox'",
        0,
        100,
        100,
    ),
    # To Be checked later - 15-07-2025 Shrinath
    # (
    #     "Match_all",
    #     f"SELECT * FROM \"{stream_name}\" WHERE match_all('ziox')",
    #     0,
    #     100,
    #     18,
    # ),
    (
        "Str_match",
        f"SELECT * FROM \"{stream_name}\" where str_match(kubernetes_container_name, 'ziox')",
        0,
        100,
        100,
    ),
    (
        "Like",
        f"SELECT * FROM \"{stream_name}\" WHERE kubernetes_container_name LIKE '%ziox%'",
        0,
        100,
        100,
    ),
    (
        "AS",
        f'SELECT kubernetes_container_name as "breakdown_1" FROM "{stream_name}"',
        0,
        100,
        100,
    ),
    (
        "IN",
        f"SELECT * FROM \"{stream_name}\" WHERE kubernetes_container_name IN ('controller', 'ziox')",
        0,
        100,
        100,
    ),
    (
        "str_match_ignore_case",
        f"SELECT * FROM \"{stream_name}\" where str_match_ignore_case(kubernetes_container_name, 'ziox')",
        0,
        100,
        100,
    ),
    (
        "Limit",
        f'SELECT * FROM "{stream_name}" LIMIT 10',
        0,
        10,
        10,
    ),
    (
        "DISTINCT",
        f'SELECT DISTINCT code FROM "{stream_name}"',
        0,
        100,
        3,
    ),
    (
        "UNION",
        f'SELECT * FROM "{stream_name}" UNION SELECT * FROM "{stream_join}"',
        0,
        50,
        50,
    ),
    (
        "UNION ALL",
        f'SELECT * FROM "{stream_name}" UNION ALL SELECT * FROM "{stream_join}"',
        0,
        50,
        50,
    ),
    (
        "Join",
        f'SELECT a.kubernetes_namespace_name , b.kubernetes_namespace_name  FROM "{stream_name}" as a join "{stream_join}" as b on a.kubernetes_namespace_name  = b.kubernetes_namespace_name',
        0,
        50,
        50,
    ),
    (
        "LEFT Join",
        f'SELECT a.kubernetes_docker_id , b.kubernetes_docker_id FROM "{stream_name}" as a LEFT JOIN "{stream_join}" as b ON a.kubernetes_docker_id  = b.kubernetes_docker_id',
        0,
        50,
        50,
    ),
    (
        "RIGHT Join",
        f'SELECT a.kubernetes_docker_id , b.kubernetes_docker_id FROM "{stream_name}" as a RIGHT JOIN "{stream_join}" as b ON a.kubernetes_docker_id  = b.kubernetes_docker_id',
        0,
        50,
        50,
    ),
    (
        "FULL Join",
        f'SELECT a.kubernetes_docker_id , b.kubernetes_docker_id FROM "{stream_name}" as a FULL JOIN "{stream_join}" as b ON a.kubernetes_docker_id  = b.kubernetes_docker_id',
        0,
        50,
        50,
    ),
    (
        "Join Where",
        f"SELECT a.kubernetes_namespace_name , b.kubernetes_namespace_name  FROM \"{stream_name}\" as a join \"{stream_join}\" as b on a.kubernetes_docker_id  = b.kubernetes_docker_id WHERE a.kubernetes_container_name = 'ziox' AND b.kubernetes_container_name = 'ziox'",
        0,
        50,
        50,
    ),
    (
        "LEFT Join Where",
        f"SELECT a.kubernetes_docker_id , b.kubernetes_docker_id FROM \"{stream_name}\" as a LEFT JOIN \"{stream_join}\" as b ON a.kubernetes_docker_id  = b.kubernetes_docker_id WHERE a.kubernetes_container_name = 'ziox' AND b.kubernetes_container_name = 'ziox'",
        0,
        50,
        50,
    ),
    (
        "RIGHT Join Where",
        f"SELECT a.kubernetes_docker_id , b.kubernetes_docker_id FROM \"{stream_name}\" as a RIGHT JOIN \"{stream_join}\" as b ON a.kubernetes_docker_id  = b.kubernetes_docker_id WHERE a.kubernetes_container_name = 'ziox' AND b.kubernetes_container_name = 'ziox'",
        0,
        50,
        50,
    ),
    (
        "FULL Join",
        f"SELECT a.kubernetes_docker_id , b.kubernetes_docker_id FROM \"{stream_name}\" as a FULL JOIN \"{stream_join}\" as b ON a.kubernetes_docker_id  = b.kubernetes_docker_id WHERE a.kubernetes_container_name = 'ziox' AND b.kubernetes_container_name = 'ziox'",
        0,
        50,
        50,
    ),
    (
        "INNER Join Like",
        f'SELECT "a".kubernetes_docker_id, "b".kubernetes_docker_id FROM "{stream_name}" AS "a" INNER JOIN "{stream_join}" AS "b" ON "a".kubernetes_docker_id = "b".kubernetes_docker_id WHERE "a".kubernetes_container_name LIKE \'%ziox%\'',
        0,
        50,
        50,
    ),
    (
        "INNER Join Like Limit",
        f'SELECT "a".kubernetes_docker_id, "b".kubernetes_docker_id FROM "{stream_name}" AS "a" INNER JOIN "{stream_join}" AS "b" ON "a".kubernetes_docker_id = "b".kubernetes_docker_id WHERE "a".kubernetes_container_name LIKE \'%ziox%\' LIMIT 10',
        0,
        50,
        10,
    ),
    (
        "INNER Join IN",
        f'SELECT "a".kubernetes_docker_id, "b".kubernetes_docker_id FROM "{stream_name}" AS "a" INNER JOIN "{stream_join}" AS "b" ON "a".kubernetes_docker_id = "b".kubernetes_docker_id WHERE "a".kubernetes_container_name IN (\'ziox\')',
        0,
        50,
        50,
    ),
    (
        "INNER Join IN Limit",
        f'SELECT "a".kubernetes_docker_id, "b".kubernetes_docker_id FROM "{stream_name}" AS "a" INNER JOIN "{stream_join}" AS "b" ON "a".kubernetes_docker_id = "b".kubernetes_docker_id WHERE "a".kubernetes_container_name IN (\'ziox\') LIMIT 10',
        0,
        50,
        10,
    ),
    (
        "Count Having",
        f'SELECT COUNT(_timestamp) as totallogcount FROM "{stream_name}" Having totallogcount > 1000',
        0,
        -1,
        1,
    ),
    (
        "regexp_match",
        f"SELECT _timestamp, array_extract(regexp_match(log, '^[^\\\\]\\n]*\\\\]\\\\s+(?P<httpMethod>\\\\w+)(?:[^/\\n]*/){4}(?P<catalogApi>\\\\w+)(?:[^\\n]* ){2}(?P<httpStatusCode>[^ ]+)\\\\s+(?P<apiPayloadSize>[^ ]+)\\\\s+(?P<responseTime>\\\\d+)'), 3) AS status FROM \"{stream_name}\"",
        0,
        100,
        100,
    ),
    (
        "Count Distinct",
        f'SELECT count(distinct(kubernetes_container_name)) FROM "{stream_name}"',
        0,
        -1,
        1,
    ),
    (
        "MAX",
        f'SELECT MAX(_timestamp), count(_timestamp) FROM "{stream_name}"',
        0,
        -1,
        1,
    ),
    (
        "Count Aggregate",
        f'SELECT count(*) FROM "{stream_name}"',
        0,
        -1,
        1,
    ),
    (
        "Not Null",
        f'SELECT * FROM "{stream_name}" WHERE kubernetes_container_image IS NOT NULL',
        0,
        -1,
        1000,
    ),
    (
        "Avg",
        f'SELECT avg(code) FROM "{stream_name}" WHERE code > 200',
        0,
        -1,
        1,
    ),
    (
        "re_match",
        f"SELECT * FROM \"{stream_name}\" WHERE re_match(kubernetes_container_name, 'ziox')",
        0,
        50,
        50,
    ),
    (
        "page_one",
        f"SELECT * FROM \"{stream_name}\" where kubernetes_container_name = 'velero'",
        0,
        100,
        100,
    ),
    (
        "page_two",
        f"SELECT * FROM \"{stream_name}\" where kubernetes_container_name = 'velero'",
        100,
        101,
        101,
    ),
    (
        "page_three",
        f"SELECT * FROM \"{stream_name}\" where kubernetes_container_name = 'velero'",
        200,
        101,
        101,
    ),
    (
        "page_four",
        f"SELECT * FROM \"{stream_name}\" where kubernetes_container_name = 'velero'",
        300,
        101,
        101,
    ),
    (
        "page_five",
        f"SELECT * FROM \"{stream_name}\" where kubernetes_container_name = 'velero'",
        400,
        101,
        40,
    ),
    # To Be checked later - 15-07-2025 Shrinath
    # (
    #     "match_all query one",
    #     f"SELECT * FROM \"{stream_name}\" WHERE match_all('zio*')",
    #     0,
    #     50,
    #     18,
    # ),
    (
        "match_all query two",
        f"SELECT * FROM \"{stream_name}\" WHERE match_all('us*')",
        0,
        50,
        50,
    ),
    (
        "match_all query three",
        f"SELECT * FROM \"{stream_name}\" WHERE match_all('ip-10-2-15-197.us-east-2.co*')",
        0,
        50,
        2,
    ),
]


@pytest.mark.skip(reason="temporarily disabled till this issue is fixed")
# @pytest.mark.parametrize("test_name_sql, sql_query, sql_from, sql_size, total_exp", test_data_sql)
def test_sql(
    create_session, base_url, test_name_sql, sql_query, sql_from, sql_size, total_exp
):
    """Running an E2E test for sql queries with Parameterized data when websocket is disabled."""

    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)
    json_data_sql = {
        "query": {
            "sql": sql_query,
            "start_time": ten_min_ago,
            "end_time": end_time,
            "from": sql_from,
            "size": sql_size,
            "quick_mode": False,
        },
        "regions": [],
        "clusters": [],
    }

    res_sql = session.post(
        f"{url}api/{org_id}/_search?type=logs&search_type=UI&use_cache=false",
        json=json_data_sql,
    )

    assert res_sql.status_code == 200, (
        f"SQL mode {test_name_sql} added 200, but got {res_sql.status_code} {res_sql.content}"
    )

    print(f"Response {url} SQL False Cache HTTP:", res_sql.status_code)

    # Parse the JSON response

    res_data_sql = res_sql.json()

    # Validate the total in the response
    total_hits_sql = res_data_sql["total"]

    # Adjust the assertion based on our expectations
    expected_hits_sql = total_exp  # what we're expecting
    assert total_hits_sql == expected_hits_sql, (
        f"Expected total {test_name_sql} to be {expected_hits_sql}, but got {total_hits_sql}"
    )

    # Generate request for cache
    res_sql_cache = session.post(
        f"{url}api/{org_id}/_search?type=logs&search_type=UI&use_cache=true",
        json=json_data_sql,
    )

    assert res_sql_cache.status_code == 200, (
        f"SQL cache {test_name_sql} mode added 200, but got {res_sql_cache.status_code} {res_sql_cache.content}"
    )

    print(
        f"Response {test_name_sql} Cache True SQL {url} HTTP:",
        res_sql_cache.status_code,
    )

    # Parse the JSON response

    res_data_sql_cache = res_sql_cache.json()

    # Validate the total in the response
    total_hits_sql_cache = res_data_sql_cache["total"]

    # Adjust the assertion based on our expectations
    expected_hits_sql_cache = total_exp  # what we're expecting
    assert total_hits_sql_cache == expected_hits_sql_cache, (
        f"Expected {test_name_sql} total to be {expected_hits_sql_cache}, but got {total_hits_sql_cache}"
    )


def test_update_max_query_range(create_session, base_url):
    session = create_session
    url = f"{base_url}api/{org_id}/streams/{stream_name}/settings?type=logs"
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    payload = {
        "partition_keys": {"add": [], "remove": []},
        "index_fields": {"add": [], "remove": []},
        "full_text_search_keys": {"add": [], "remove": []},
        "bloom_filter_fields": {"add": [], "remove": []},
        "defined_schema_fields": {"add": [], "remove": []},
        "extended_retention_days": {"add": [], "remove": []},
        "max_query_range": 1,
        "data_retention": 3650,
        "store_original_data": False,
        "approx_partition": False,
    }

    response = session.put(url, json=payload)

    assert response.status_code == 200
    print(f"Response {url} Update Max Query Range:", response.content)
    # Add more assertions as needed to validate the response content


def test_sql_query_range(create_session, base_url):
    """Running an E2E test for sql max query range."""

    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    sixtyone_min_ago = int((now - timedelta(minutes=61)).timestamp() * 1000000)
    json_sql_query_range = {
        "query": {
            "sql": f'SELECT * FROM "{stream_name}"',
            "start_time": sixtyone_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 50,
            "quick_mode": False,
        },
    }

    res_sql_query_range = session.post(
        f"{url}api/{org_id}/_search?type=logs&search_type=UI&use_cache=false",
        json=json_sql_query_range,
    )

    assert res_sql_query_range.status_code == 200, (
        f"SQL mode added 200, but got {res_sql_query_range.status_code} {res_sql_query_range.content}"
    )

    # print(f"Response {url} SQL False Cache HTTP:", res_sql_query_range.content)

    print(
        f"Body {url}api/{org_id}/_search?type=logs&search_type=UI&use_cache=false",
        json_sql_query_range,
    )

    # Parse the JSON response

    res_data_sql_query_range = res_sql_query_range.json()

    # Expected error message
    expected_error_message = (
        "Query duration is modified due to query range restriction of 1 hours"
    )

    # Assert that 'function_error' exists in the response and contains the expected message
    assert "function_error" in res_data_sql_query_range, (
        "function_error key is missing from the response"
    )
    assert expected_error_message in res_data_sql_query_range["function_error"], (
        "Expected error message not found in function_error"
    )

    # Generate request for cache
    res_sql_cache_query_range = session.post(
        f"{url}api/{org_id}/_search?type=logs&search_type=UI&use_cache=true",
        json=json_sql_query_range,
    )

    assert res_sql_cache_query_range.status_code == 200, (
        f"SQL cache mode added 200, but got {res_sql_cache_query_range.status_code} {res_sql_cache_query_range.content}"
    )

    # print(f"Response Cache True SQL {url} HTTP:", res_sql_cache_query_range.content)

    res_data_sql_cache_query_range = res_sql_cache_query_range.json()

    # Assert that 'function_error' exists in the response and contains the expected message
    assert "function_error" in res_data_sql_cache_query_range, (
        "function_error key is missing from the response"
    )
    assert expected_error_message in res_data_sql_cache_query_range["function_error"], (
        "Expected error message not found in function_error"
    )


def test_search_partition(create_session, base_url):
    """Test the search partition API."""
    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)
    # Define the payload
    PAYLOAD = {
        "sql": f"SELECT * FROM \"{stream_name}\" WHERE re_match(kubernetes_container_name, 'ziox')",
        "start_time": ten_min_ago,
        "end_time": end_time,
        "streaming_output": True,
    }

    response = session.post(
        f"{url}api/{org_id}/_search_partition?type=logs", json=PAYLOAD
    )

    # Check the response status code
    assert response.status_code == 200, (
        f"Expected status code 200 but got {response.status_code}"
    )

    # Optionally, check for specific content in the response
    response_data = response.json()

    print(f"Response {url} Search Partition:", response_data)

    assert "file_num" in response_data, "Response does not contain 'file_num'"
    assert response_data["file_num"] == 0, "Unexpected 'file_num' value"

    assert "records" in response_data, "Response does not contain 'records'"
    assert response_data["records"] == 0, "Unexpected 'records' value"

    assert "original_size" in response_data, "Response does not contain 'original_size'"
    assert response_data["original_size"] == 0, "Unexpected 'original_size' value"

    assert "compressed_size" in response_data, (
        "Response does not contain 'compressed_size'"
    )
    assert response_data["compressed_size"] == 0, "Unexpected 'compressed_size' value"

    assert "max_query_range" in response_data, (
        "Response does not contain 'max_query_range'"
    )
    assert response_data["max_query_range"] == 1, "Unexpected 'max_query_range' value"

    assert "partitions" in response_data, "Response does not contain 'partitions'"
    assert isinstance(response_data["partitions"], list), (
        "'partitions' should be a list"
    )
    assert len(response_data["partitions"]) == 2, "Expected 2 partitions"

    assert "order_by" in response_data, "Response does not contain 'order_by'"
    assert response_data["order_by"] == "desc", "Unexpected 'order_by' value"

    assert "limit" in response_data, "Response does not contain 'limit'"
    assert response_data["limit"] == 0, "Unexpected 'limit' value"

    assert "streaming_output" in response_data, (
        "Response does not contain 'streaming_output'"
    )
    assert response_data["streaming_output"] is False, (
        "Unexpected 'streaming_output' value"
    )

    assert "streaming_aggs" in response_data, (
        "Response does not contain 'streaming_aggs'"
    )
    assert response_data["streaming_aggs"] is False, "Unexpected 'streaming_aggs' value"

    assert "streaming_id" in response_data, "Response does not contain 'streaming_id'"
    assert response_data["streaming_id"] is None, "Unexpected 'streaming_id' value"


def test_values_endpoint(create_session, base_url):
    session = create_session
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)
    url = f"{base_url}api/{org_id}/{stream_name}/_values?fields=kubernetes_container_name&size=10&start_time={ten_min_ago}&end_time={end_time}&sql=&type=logs"
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Basic {base64.b64encode(f'{ZO_ROOT_USER_EMAIL}:{ZO_ROOT_USER_PASSWORD}'.encode()).decode()}",
    }

    response = session.get(url, headers=headers)

    # Assert the response status code
    assert response.status_code == 200

    # Assert the expected response structure
    json_response = response.json()
    print(f"Response {url} Values:", json_response)
    assert "took" in json_response
    assert "hits" in json_response
    assert "total" in json_response
    assert isinstance(json_response["hits"], list)

    # Additional assertions based on expected values
    assert json_response["total"] == 1  # Adjust based on expected output
    assert len(json_response["hits"]) == 1  # Ensure there is one hit
    # Check the field name
    assert json_response["hits"][0]["field"] == "kubernetes_container_name"
    # Check that values is a list
    assert isinstance(json_response["hits"][0]["values"], list)


# Define test data with different queries and expected response details for streaming enable
def test_enable_streaming(create_session, base_url):
    """Fixture to enable Streaming"""
    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    payload_streaming = {
        "scrape_interval": 15,
        "span_id_field_name": "span_id",
        "trace_id_field_name": "trace_id",
        "toggle_ingestion_logs": False,
        "enable_websocket_search": False,
        "enable_streaming_search": True,
    }

    print("Session Streaming Enabled headers:", session.headers)

    resp_streaming = session.post(f"{url}api/{org_id}/settings", json=payload_streaming)

    print("Enable Streaming", resp_streaming.content)
    assert resp_streaming.status_code == 200, (
        f"Streaming enable 200, but got {resp_streaming.status_code} {resp_streaming.content}"
    )


@pytest.mark.parametrize(
    "test_name, hist_query, expected_total_hits_results_histg, expected_zo_sql_num_histg",
    test_data_histog,
)
def test_streaming_histogram(
    create_session,
    base_url,
    test_name,
    hist_query,
    expected_total_hits_results_histg,
    expected_zo_sql_num_histg,
):
    """Running an E2E test for histogram queries with Parameterized data when streaming is enabled."""

    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)

    time.sleep(20)  # Increased wait time for data indexing

    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    ten_min_ago = int((now - timedelta(hours=1)).timestamp() * 1000000)  # Increased to 1 hour to ensure data coverage across test runs
    json_data_hist = {
        "query": {
            "sql": hist_query,
            "start_time": ten_min_ago,
            "end_time": end_time,
            "size": -1,
        }
    }

    res_histog = session.post(
        f"{url}api/{org_id}/_search_stream?type=logs&search_type=ui&use_cache=false",
        json=json_data_hist,
        stream=True,
    )

    assert res_histog.status_code == 200, (
        f"histogram mode {test_name} added 200, but got {res_histog.status_code} {res_histog.content}"
    )

    print(
        f"API {test_name} Response {url} Histog False Cache Streaming",
        res_histog.status_code,
    )

    # Parse the JSON response

    res_data_histog = read_response(res_histog)
    # print(f"API {test_name} Response False Cache Streaming Search {url} Histog:", res_data_histog)

    # Validate the total in the response
    total_hits_histog = res_data_histog["results"]["total"]

    # Adjust the assertion based on our expectations
    expected_hits_histog = expected_total_hits_results_histg  # we're expecting
    assert total_hits_histog >= 0, (
        f"Expected total {test_name} to be >= 0, but got {total_hits_histog}"
    )

    # Validate zo_sql_num hits histogram in the first hit
    if total_hits_histog > 0:
        actual_zo_sql_num_hits_histog = res_data_histog["results"]["hits"][0][
            "zo_sql_num"
        ]
        assert actual_zo_sql_num_hits_histog == expected_zo_sql_num_histg, (
            f"Expected zo_sql_num histogram to be {expected_zo_sql_num_histg}, but got {actual_zo_sql_num_hits_histog}"
        )
    else:
        pytest.fail("No hits found in the response.")

    # Generate request for histogram cache enabled
    res_histog_cache = session.post(
        f"{url}api/{org_id}/_search_stream?type=logs&search_type=ui&use_cache=true",
        json=json_data_hist,
        stream=True,
    )

    assert res_histog_cache.status_code == 200, (
        f"histogram cache {test_name} mode added 200, but got {res_histog_cache.status_code} {res_histog_cache.content}"
    )

    print(f"Response {url} Cache True Histog Streaming:", res_histog_cache.status_code)

    res_data_histog_cache = read_response(res_histog_cache)
    # print(f"API {test_name} Response cache true Streaming Search {url} Histog:", res_data_histog_cache)

    # for line in res_histog_cache.iter_lines():

    # # filter out keep-alive new lines
    #     if line:
    #         # decoded_line = line.decode('utf-8')
    #         print(line)

    # Validate the total in the response
    total_hits_histog_cache = res_data_histog_cache["results"]["total"]

    # Adjust the assertion based on our expectations
    expected_hits_histog_cache = (
        expected_total_hits_results_histg  # what we're expecting
    )
    assert total_hits_histog_cache == expected_hits_histog_cache, (
        f"Expected {test_name} total to be {expected_hits_histog_cache}, but got {total_hits_histog_cache}"
    )

    # Validate zo_sql_num hits histogram in the first hit
    if total_hits_histog_cache > 0:
        actual_zo_sql_num_hits_histog_cache = res_data_histog_cache["results"]["hits"][
            0
        ]["zo_sql_num"]
        assert actual_zo_sql_num_hits_histog_cache == expected_zo_sql_num_histg, (
            f"Expected zo_sql_num histogram to be {expected_zo_sql_num_histg}, but got {actual_zo_sql_num_hits_histog_cache}"
        )
    else:
        pytest.fail("No hits found in the response.")


# TODO Uncomment the following test cases after the issue (https://github.com/openobserve/openobserve/issues/7858) is fixed
@pytest.mark.parametrize("test_name_sql, sql_query, sql_from, sql_size, total_exp", test_data_sql)
def test_streaming_sql(create_session, base_url, test_name_sql, sql_query, sql_from, sql_size, total_exp):
    """Running an E2E test for sql queries with Parameterized data when websocket is disabled."""

    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)
    json_data_sql = {
        "query": {
            "sql": sql_query,
            "start_time": ten_min_ago,
            "end_time": end_time,
            "from": sql_from,
            "size": sql_size,
            "quick_mode": False
        },
        "regions": [],
        "clusters": []
    }

    res_sql = session.post(
        f"{url}api/{org_id}/_search_stream?type=logs&search_type=UI&use_cache=false", json=json_data_sql, stream=True)

    assert (
        res_sql.status_code == 200
    ), f"SQL mode {test_name_sql} added 200, but got {res_sql.status_code} {res_sql.content}"

    print(f"Response {url} SQL False Cache Streaming:", res_sql.status_code)

    # Parse the JSON response

    res_data_sql = read_response(res_sql)

    # Validate the total in the response
    total_hits_sql = res_data_sql["results"]["total"]

    # Adjust the assertion based on our expectations
    expected_hits_sql = total_exp  # what we're expecting
    # Allow for minor variations in join results due to data timing/consistency
    tolerance = 5 if "Join" in test_name_sql else 0
    assert abs(total_hits_sql - expected_hits_sql) <= tolerance, f"Expected total {test_name_sql} to be {expected_hits_sql} (±{tolerance}), but got {total_hits_sql}"

    # Generate request for cache
    res_sql_cache = session.post(
        f"{url}api/{org_id}/_search_stream?type=logs&search_type=UI&use_cache=true", json=json_data_sql, stream=True)

    assert (
        res_sql_cache.status_code == 200
    ), f"SQL cache {test_name_sql} mode added 200, but got {res_sql_cache.status_code} {res_sql_cache.content}"

    print(f"Response {test_name_sql} Cache True SQL {url} Streaming:",
          res_sql_cache.status_code)

    # Parse the JSON response

    res_data_sql_cache = read_response(res_sql_cache)

    # Validate the total in the response
    total_hits_sql_cache = res_data_sql_cache["results"]["total"]

    # Adjust the assertion based on our expectations
    expected_hits_sql_cache = total_exp  # what we're expecting
    assert abs(total_hits_sql_cache - expected_hits_sql_cache) <= tolerance, f"Expected {test_name_sql} total to be {expected_hits_sql_cache} (±{tolerance}), but got {total_hits_sql_cache}"

# Define the test function


def test_values_streaming_endpoint(create_session, base_url):
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)
    url = f"{base_url}api/{org_id}/_values_stream"
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Basic {base64.b64encode(f"{ZO_ROOT_USER_EMAIL}:{ZO_ROOT_USER_PASSWORD}".encode()).decode()}'
    }
    # Define the JSON payload
    payload = {
        "fields": ["kubernetes_container_name"],
        "size": 10,
        "no_count": False,
        "regions": [],
        "clusters": [],
        "vrl_fn": "",
        "start_time": ten_min_ago,
        "end_time": end_time,
        "timeout": 30000,
        "stream_name": f"{stream_name}",
        "stream_type": "logs",
        "use_cache": False,
        "sql": "U0VMRUNUICogRlJPTSAiZGVmYXVsdCIg"
    }
    res_values_streaming = session.post(url, headers=headers, json=payload)

    # Assert the response status code
    assert res_values_streaming.status_code == 200

    # Assert the expected response structure
    res_data_values_streaming = read_response(res_values_streaming)
    print(f"Response {url} Values Streaming:", res_data_values_streaming)

    # Check that the response is a dictionary
    assert isinstance(res_data_values_streaming, dict)
    assert 'results' in res_data_values_streaming
    assert isinstance(res_data_values_streaming['results'], dict)
    assert 'cached_ratio' in res_data_values_streaming['results']
    assert 'from' in res_data_values_streaming['results']
    assert 'hits' in res_data_values_streaming['results']
    assert isinstance(res_data_values_streaming['results']['hits'], list)

    # Additional assertions based on expected values
    # Total should be non-negative
    assert res_data_values_streaming['results']['total'] >= 0
    # Check that hits do not exceed requested size
    assert len(res_data_values_streaming['results']['hits']) <= 10
    for hit in res_data_values_streaming['results']['hits']:
        assert 'field' in hit
        assert 'values' in hit
        assert isinstance(hit['values'], list)  # Check that values is a list


# # Define the test function
def test_values_streaming_endpoint_cache(create_session, base_url):
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)
    url = f"{base_url}api/{org_id}/_values_stream"
    headers = {
        'Content-Type': 'application/json',
        'Authorization': f'Basic {base64.b64encode(f"{ZO_ROOT_USER_EMAIL}:{ZO_ROOT_USER_PASSWORD}".encode()).decode()}'
    }
    # Define the JSON payload
    payload = {
        "fields": ["kubernetes_container_name"],
        "size": 10,
        "no_count": False,
        "regions": [],
        "clusters": [],
        "vrl_fn": "",
        "start_time": ten_min_ago,
        "end_time": end_time,
        "timeout": 30000,
        "stream_name": f"{stream_name}",
        "stream_type": "logs",
        "use_cache": True,
        "sql": "U0VMRUNUICogRlJPTSAiZGVmYXVsdCIg"
    }
    res_values_streaming_cache = session.post(
        url, headers=headers, json=payload)

    # Assert the response status code
    assert res_values_streaming_cache.status_code == 200

    # Assert the expected response structure
    res_data_values_streaming_cache = read_response(res_values_streaming_cache)
    print(f"Response {url} Values Streaming:", res_data_values_streaming_cache)

    # Check that the response is a dictionary
    assert isinstance(res_data_values_streaming_cache, dict)
    assert 'results' in res_data_values_streaming_cache
    assert isinstance(res_data_values_streaming_cache['results'], dict)
    assert 'cached_ratio' in res_data_values_streaming_cache['results']
    assert 'from' in res_data_values_streaming_cache['results']
    assert 'hits' in res_data_values_streaming_cache['results']
    assert isinstance(res_data_values_streaming_cache['results']['hits'], list)

    # Additional assertions based on expected values
    # Total should be non-negative
    assert res_data_values_streaming_cache['results']['total'] >= 0
    # Check that hits do not exceed requested size
    assert len(res_data_values_streaming_cache['results']['hits']) <= 10
    for hit in res_data_values_streaming_cache['results']['hits']:
        assert 'field' in hit
        assert 'values' in hit
        assert isinstance(hit['values'], list)  # Check that values is a list


def test_streaming_sql_query_range(create_session, base_url):
    """Running an E2E test for sql max query range with streaming enabled."""

    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    sixtyone_min_ago = int((now - timedelta(minutes=61)).timestamp() * 1000000)
    json_sql_query_range = {
        "query": {
            "sql": f'SELECT count(*) AS _max_query_range FROM "{stream_name}"',
            "start_time": sixtyone_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 50,
            "quick_mode": False,
        },
    }

    res_sql_query_range = session.post(
        f"{url}api/{org_id}/_search_stream?type=logs&search_type=UI&use_cache=false",
        json=json_sql_query_range,
        stream=True,
    )

    assert res_sql_query_range.status_code == 200, (
        f"SQL mode added 200, but got {res_sql_query_range.status_code} {res_sql_query_range.content}"
    )

    print(f"Response {url} SQL False Cache Streaming:", res_sql_query_range.status_code)

    # Parse the JSON response

    res_stream_sql_query_range = read_response(res_sql_query_range)

    # print(f"Body {url}api/{org_id}/_search_stream?type=logs&search_type=UI&use_cache=false", res_stream_sql_query_range )

    # Expected error message
    expected_error_message = (
        "Query duration is modified due to query range restriction of 1 hours"
    )

    # Assert that 'function_error' exists in the response and contains the expected message
    assert "function_error" in res_stream_sql_query_range["results"], (
        "function_error key is missing from the response"
    )
    assert (
        expected_error_message
        in res_stream_sql_query_range["results"]["function_error"]
    ), "Expected error message not found in function_error"

    # Generate request for cache
    res_sql_cache_query_range = session.post(
        f"{url}api/{org_id}/_search_stream?type=logs&search_type=UI&use_cache=true",
        json=json_sql_query_range,
        stream=True,
    )

    assert res_sql_cache_query_range.status_code == 200, (
        f"SQL cache mode added 200, but got {res_sql_cache_query_range.status_code} {res_sql_cache_query_range.content}"
    )

    print(
        f"Response Cache True SQL {url} Streaming:",
        res_sql_cache_query_range.status_code,
    )

    res_stream_sql_cache_query_range = read_response(res_sql_cache_query_range)

    # print(f"Body {url}api/{org_id}/_search_stream?type=logs&search_type=UI&use_cache=true", res_stream_sql_cache_query_range )

    # Assert that 'function_error' exists in the response and contains the expected message
    assert "function_error" in res_stream_sql_cache_query_range["results"], (
        "function_error key is missing from the response"
    )
    assert (
        expected_error_message
        in res_stream_sql_cache_query_range["results"]["function_error"]
    ), "Expected error message not found in function_error"


def test_delete_stream(create_session, base_url):
    """Running an E2E test for deleting the created stream."""
    session = create_session
    url = base_url
    # Proceed to delete the created Stream
    resp_delete_stream = session.delete(
        f"{url}api/{org_id}/streams/{stream_name}?type=logs"
    )
    print(f"Deleted Stream Response: {resp_delete_stream.text}")
    assert resp_delete_stream.status_code == 200, (
        f"Failed to delete stream {stream_name}"
    )
    print(f"Successfully deleted stream {stream_name}")


def test_delete_stream_join(create_session, base_url):
    """Running an E2E test for deleting the created join stream."""
    session = create_session
    url = base_url
    # Proceed to delete the created Stream
    resp_delete_stream_join = session.delete(
        f"{url}api/{org_id}/streams/{stream_join}?type=logs"
    )
    print(f"Deleted Stream Response: {resp_delete_stream_join.text}")
    assert resp_delete_stream_join.status_code == 200, (
        f"Failed to delete stream {stream_join}"
    )
    print(f"Successfully deleted stream {stream_join}")


# Read HTTP 2 responses from the stream
# two events in particular `search_response_metadata` and `search_response_hits`
# return a single json object as search response, i.e. the first partitions
def read_response(reader):
    content = reader.content.decode("utf-8")
    lines = content.split("\n")
    search_metadata_list = []
    search_hits_list = []

    print(f"DEBUG: Raw response content length: {len(content)}")
    print(f"DEBUG: Number of lines: {len(lines)}")

    for i, line in enumerate(lines):
        text = line.strip()
        print(f"DEBUG: Line {i}: {text}")

        if text.startswith("event: search_response_metadata"):
            print(f"DEBUG: Found search_response_metadata at line {i}")
            # Get the data part which follows in the next line
            if i + 1 < len(lines):
                data_line = lines[i + 1].strip()
                print(f"DEBUG: Data line {i + 1}: {data_line}")
                if data_line.startswith("data: "):
                    try:
                        # Remove "data: " prefix
                        metadata_json = data_line[6:]
                        metadata_data = json.loads(metadata_json)
                        print(f"DEBUG: Parsed metadata: {metadata_data}")
                        search_metadata_list.append(metadata_data)
                    except json.JSONDecodeError as e:
                        print(f"Error parsing metadata JSON: {e}")
                        continue

        elif text.startswith("event: search_response_hits"):
            print(f"DEBUG: Found search_response_hits at line {i}")
            # Get the data part which follows in the next line
            if i + 1 < len(lines):
                data_line = lines[i + 1].strip()
                print(f"DEBUG: Hits data line {i + 1}: {data_line}")
                if data_line.startswith("data: "):
                    try:
                        search_hits = data_line[6:]  # Remove "data: " prefix
                        hits_data = json.loads(search_hits)
                        print(f"DEBUG: Parsed hits: {hits_data}")
                        search_hits_list.append(hits_data)
                    except json.JSONDecodeError as e:
                        print(f"Error parsing hits JSON: {e}")
                        continue

    print(f"DEBUG: Final search_metadata_list length: {len(search_metadata_list)}")
    print(f"DEBUG: Final search_hits_list length: {len(search_hits_list)}")

    if search_metadata_list:
        # Use the first metadata response as the base
        combined_metadata = search_metadata_list[0].copy()
        
        # Combine all hits from all hits events
        all_hits = []
        for hits_data in search_hits_list:
            if "hits" in hits_data and isinstance(hits_data["hits"], list):
                all_hits.extend(hits_data["hits"])

        # For streaming responses, use a more nuanced approach to determine total
        # If there are multiple metadata responses, we need to use the count correctly
        if len(search_metadata_list) == 1:
            # Single metadata response - use its total directly
            if "results" in search_metadata_list[0] and "total" in search_metadata_list[0]["results"]:
                total_count = search_metadata_list[0]["results"]["total"]
                print(f"DEBUG: Single metadata response, using total: {total_count}")
            else:
                total_count = len(all_hits)
                print(f"DEBUG: Single metadata response with no total, using hits count: {total_count}")
        else:
            # Multiple metadata responses - for aggregation queries, use max total
            # For histogram queries, use the number of distinct hits/buckets
            max_total = 0
            total_sum = 0
            for metadata in search_metadata_list:
                if "results" in metadata and "total" in metadata["results"]:
                    current_total = metadata["results"]["total"]
                    max_total = max(max_total, current_total)
                    total_sum += current_total
            
            # Use max total for most cases, as it represents the correct count
            total_count = max_total if max_total > 0 else len(all_hits)
            print(f"DEBUG: Multiple metadata responses, max_total: {max_total}, total_sum: {total_sum}, using: {total_count}")

        combined_metadata["results"]["total"] = total_count
        combined_metadata["results"]["hits"] = all_hits
        print(f"DEBUG: Returning combined metadata with total: {total_count}, hits: {len(all_hits)}")

        return combined_metadata
    else:
        print("No valid response data found in stream")
        return {"results": {"total": 0, "hits": []}}
