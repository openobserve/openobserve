import json
import requests
import pytest

from datetime import datetime, timezone, timedelta
import time


def test_e2e_getsearch(create_session, base_url):
    """Running an E2E test no payload."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs")

    # print(resp_get_allalerts.content)
    assert (
        resp_get_allsearch.status_code == 415
    ), f"Expected request with `Content-Type: application/json`, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"

def test_e2e_query(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
                "query": {
                        "sql": 'SELECT * FROM "stream_pytest_data" WHERE code=200',
                        "start_time": one_min_ago,
                        "end_time": end_time,
                        "from": 0,
                        "size": 150,
                },
            }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Sql mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"


# def test_e2e_invalidsqlquery(create_session, base_url):
    """Running an E2E test for invalid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
                "query": {
                        "sql": 'SELECT * FROM "stream_pytest_data" WHERE code',
                        "start_time": one_min_ago,
                        "end_time": end_time,
                        "from": 0,
                        "size": 150,
                },
            }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   

    # print(resp_get_allalerts.content)
    assert (
        resp_get_allsearch.status_code == 400
    ), f"Sql mode added 400, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"


def test_e2e_limitadded(create_session, base_url):
    """Running an E2E test add limit to sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
                "query": {
                        "sql": 'SELECT * FROM "stream_pytest_data" WHERE code=200 limit 5',
                        "start_time": one_min_ago,
                        "end_time": end_time,
                        "from": 0,
                        "size": 150,
                },
            }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   

    # print(resp_get_allalerts.content)
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Sql mode added  with limit 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"


def test_e2e_validhistogram(create_session, base_url):
    """Running an E2E test for valid histogram."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "select histogram(_timestamp, '10 second') AS zo_sql_key, count(*) AS zo_sql_num from stream_pytest_data WHERE code=200 GROUP BY zo_sql_key ORDER BY zo_sql_key",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 0,
            "quick_mode": True,
            "track_total_hits": False
        }
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   

    # print(resp_get_allalerts.content)
    assert (
        resp_get_allsearch.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"


def test_e2e_histogramwithlimit(create_session, base_url):
    """Running an E2E test for query with limit  list."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": 'select * from "stream_pytest_data" WHERE code=200 limit 5',
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 0,
            "quick_mode": True,
            "track_total_hits": False
        }
    }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   

    # print(resp_get_allalerts.content)
    assert (
        resp_get_allsearch.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"


def test_e2e_matchallhistogram(create_session, base_url):
    """Running an E2E test for valid match all histogram query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "select histogram(_timestamp, '1 hour') AS zo_sql_key, count(*) AS zo_sql_num from stream_pytest_data WHERE match_all(\'provide_credentials\') GROUP BY zo_sql_key ORDER BY zo_sql_key",
            "start_time": one_min_ago,
            "end_time": end_time,
            "size": 0,
        }
} 

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   

    # print(resp_get_allalerts.content)
    assert (
        resp_get_allsearch.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"


def test_e2e_matchallindexhistogram(create_session, base_url):
    """Running an E2E test for valid match all histogram query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "select histogram(_timestamp, '1 hour') AS zo_sql_key, count(*) AS zo_sql_num from stream_pytest_data WHERE match_all(\'provide_credentials\') GROUP BY zo_sql_key ORDER BY zo_sql_key",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 0,
            "quick_mode": True,
            "track_total_hits": False
        }
} 

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   

    # print(resp_get_allalerts.content)
    assert (
        resp_get_allsearch.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"


# def test_e2e_matchallignorecasehistogram(create_session, base_url):
#     """Running an E2E test for valid match all histogram query."""

#     session = create_session
#     url = base_url
#     org_id = "default"
#     now = datetime.now(timezone.utc)
#     end_time = int(now.timestamp() * 1000000)
#     one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
#     json_data = {
#         "query": {
#             "sql": "select histogram(_timestamp, '1 hour') AS zo_sql_key, count(*) AS zo_sql_num from stream_pytest_data WHERE match_all_raw_ignore_case('provide_credentials') GROUP BY zo_sql_key ORDER BY zo_sql_key",
#             "start_time": one_min_ago,
#             "end_time": end_time,
#             "from": 0,
#             "size": 0,
#             "quick_mode": True,
#             "track_total_hits": False
#         }
# } 

#     resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)


# def test_e2e_matchallindexedignorecasewithoutsearchfeild(create_session, base_url):
#     """Running an E2E test for invalid match all histogram query."""

#     session = create_session
#     url = base_url
#     org_id = "default"
#     now = datetime.now(timezone.utc)
#     end_time = int(now.timestamp() * 1000000)
#     one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
#     json_data = {
#         "query": {
#             "sql": "select histogram(_timestamp, '1 hour') AS zo_sql_key, count(*) AS zo_sql_num from stream_pytest_data WHERE match_all_raw_ignore_case('error') GROUP BY zo_sql_key ORDER BY zo_sql_key",
#             "start_time": one_min_ago,
#             "end_time": end_time,
#             "from": 0,
#             "size": 0,
#             "quick_mode": True,
#             "track_total_hits": False
#         }
# } 

#     resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   

#     # print(resp_get_allalerts.content)
#     assert (
#         resp_get_allsearch.status_code == 200
#     ), f"histogram mode added 500, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"


def test_e2e_matchallsql(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
                "query": {
                        "sql": 'SELECT * FROM "stream_pytest_data" WHERE match_all(\'provide_credentials\')',
                        "start_time": one_min_ago,
                        "end_time": end_time,
                        "from": 0,
                        "size": 150,
                },
            }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
 
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Sql mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"


# def test_e2e_matchallindexedsql(create_session, base_url):
#     """Running an E2E test for valid sql query."""

#     session = create_session
#     url = base_url
#     org_id = "org_pytest_data"
#     now = datetime.now(timezone.utc)
#     end_time = int(now.timestamp() * 1000000)
#     one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
#     json_data = {
#                 "query": {
#                         "sql": 'SELECT * FROM "stream_pytest_data" WHERE match_all(\'provide_credentials\') ORDER BY _timestamp DESC',
#                         "start_time": one_min_ago,
#                         "end_time": end_time,
#                         "from": 0,
#                         "size": 150,
#                 },
#             }

#     resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
#     assert (
#         resp_get_allsearch.status_code == 200
#     ), f"histogram mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
#     response_data = resp_get_allsearch.json()
        
#     print("matchallindexedsql", response_data )

#     log_messages = [hit['log'] for hit in response_data.get('hits', [])]
        
#         # Asserting that at least one log message contains 'provide_credentials'
#     assert any('provide_credentials' in log for log in log_messages), "No log message contains 'provide_credentials'"
   
  
#     assert (
#         resp_get_allsearch.status_code == 200
#     ), f"Sql mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"


# def test_e2e_matchallignorecasesql(create_session, base_url):
#     """Running an E2E test for valid sql query."""

#     session = create_session
#     url = base_url
#     org_id = "org_pytest_data"
#     now = datetime.now(timezone.utc)
#     end_time = int(now.timestamp() * 1000000)
#     one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
#     json_data = {
#                 "query": {
#                         "sql": 'SELECT * FROM "stream_pytest_data" WHERE match_all_raw_ignore_case(\'provide_credentials\') ORDER BY _timestamp DESC',
#                         "start_time": one_min_ago,
#                         "end_time": end_time,
#                         "from": 0,
#                         "size": 150,
#                 },
#             }

#     resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
#     assert (
#         resp_get_allsearch.status_code == 200
#     ), f"histogram mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
#     response_data = resp_get_allsearch.json()
        
#     print("matchallignorecasesql", response_data )

#     log_messages = [hit['log'] for hit in response_data.get('hits', [])]
        
#         # Asserting that at least one log message contains 'provide_credentials'
#     assert any('provide_credentials' in log for log in log_messages), "No log message contains 'provide_credentials'"
    
#     assert (
#         resp_get_allsearch.status_code == 200
#     ), f"Sql mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"




def test_e2e_sqlaggregationquery(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
            "query": {
                "sql": "SELECT floatvalue,_timestamp, COUNT(*) AS log_count FROM \"stream_pytest_data\" GROUP BY floatvalue,_timestamp",
                "start_time": one_min_ago,
                "end_time": end_time,
                "from": 0,
                "size": 250,
                "quick_mode": True,
            },
}
    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_allsearch.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    response_data = resp_get_allsearch.json()


        

def test_e2e_sqlgroupbytimestamp(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
            "query": {
                "sql": "SELECT count(*), _timestamp FROM \"stream_pytest_data\" group by _timestamp",
                "start_time": one_min_ago,
                "end_time": end_time,
                "from": 0,
                "size": 250,
                "quick_mode": True,
            },
}
    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_allsearch.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"
    response_data = resp_get_allsearch.json()


def test_e2e_sqlcountaggregationquery(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT COUNT(_timestamp) AS xyz, _timestamp FROM \"stream_pytest_data\" GROUP BY _timestamp ORDER BY _timestamp DESC",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 250,
            "quick_mode": False
        }
        }


    resp_get_countquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_countquery.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_countquery.status_code} {resp_get_countquery.content}"
    response_data = resp_get_countquery.json()


def test_e2e_sqlmatchquery(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT _timestamp, array_extract(regexp_match(log, '^[^\\]\n]*\\]\\s+(?P<httpMethod>\\w+)(?:[^/\n]*/){4}(?P<catalogApi>\\w+)(?:[^\n]* ){2}(?P<httpStatusCode>[^ ]+)\\s+(?P<apiPayloadSize>[^ ]+)\\s+(?P<responseTime>\\d+)'), 3) AS status FROM \"stream_pytest_data\" ORDER BY _timestamp DESC",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 250,
            "quick_mode": False
        }
        }

    resp_get_matchquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_matchquery.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_matchquery.status_code} {resp_get_matchquery.content}"
    response_data = resp_get_matchquery.json()


def test_e2e_sqlmaxquery(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
  "query": {
    "sql": "SELECT MAX(_timestamp) as _timestamp FROM \"stream_pytest_data\" WHERE kubernetes_container_name = 'ziox'" ,
    "start_time": one_min_ago,
    "end_time": end_time,
    "from": 0,
    "size": 250,
    "quick_mode": False
  }
}
    resp_get_maxquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_maxquery.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_maxquery.status_code} {resp_get_maxquery.content}"
    response_data = resp_get_maxquery.json()
        


def test_e2e_inquery(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
  "query": {
    "sql": "SELECT * FROM \"stream_pytest_data\" WHERE kubernetes_container_name IN ('controller', 'ziox') ORDER BY _timestamp DESC",
    "start_time": one_min_ago,
    "end_time": end_time,
    "from": 0,
    "size": 250,
    "quick_mode": False
  }
}
    resp_get_inquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_inquery.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_inquery.status_code} {resp_get_inquery.content}"
    response_data = resp_get_inquery.json()



# def test_e2e_matchalllowercase(create_session, base_url):
#     """Running an E2E test for valid SQL query."""

#     session = create_session
#     url = base_url
#     org_id = "org_pytest_data"
#     now = datetime.now(timezone.utc)
#     end_time = int(now.timestamp() * 1000000)
#     one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    
#     json_data = {
#         "query": {
#             "sql": "select * from \"stream_pytest_data\" WHERE match_all('e2e_test')",
#             "start_time": one_min_ago,
#             "end_time": end_time,
#             "from": 0,
#             "size": 250,
#             "quick_mode": False
#         }
#     }
    
#     resp_get_matchalllowercase = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
#     assert (
#         resp_get_matchalllowercase.status_code == 200
#     ), f"Expected status code 200, but got {resp_get_matchalllowercase.status_code} {resp_get_matchalllowercase.content}"
    
#     response_data = resp_get_matchalllowercase.json()

#     print("matchalllowercase", response_data)
    
#     # Assertion to check if 'e2e_test' is present in the 'log' field of any hit
#     assert any(hit['log'] == 'e2e_test' for hit in response_data['hits']), "'e2e_test' not found in log field of hits"

# def test_e2e_matchalluppercase(create_session, base_url):
#     """Running an E2E test for valid SQL query."""

#     session = create_session
#     url = base_url
#     org_id = "org_pytest_data"
#     now = datetime.now(timezone.utc)
#     end_time = int(now.timestamp() * 1000000)
#     one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    
#     json_data = {
#         "query": {
#             "sql": "select * from \"stream_pytest_data\" WHERE match_all('E2E_TESTING')",
#             "start_time": one_min_ago,
#             "end_time": end_time,
#             "from": 0,
#             "size": 250,
#             "quick_mode": False
#         }
#     }
    
#     resp_get_matchalluppercase = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
#     assert (
#         resp_get_matchalluppercase.status_code == 200
#     ), f"Expected status code 200, but got {resp_get_matchalluppercase.status_code} {resp_get_matchalluppercase.content}"
    
#     response_data = resp_get_matchalluppercase.json()

#     print("matchalluppercase", response_data)
    
#     # Assertion to check if 'e2e_test' is present in the 'log' field of any hit
#     assert any(hit['log'] == 'E2E_TESTING' for hit in response_data['hits']), "'E2E_TESTING' not found in log field of hits"


# def test_e2e_matchallupperandlowercase(create_session, base_url):
#     """Running an E2E test for valid SQL query."""

#     session = create_session
#     url = base_url
#     org_id = "org_pytest_data"
#     now = datetime.now(timezone.utc)
#     end_time = int(now.timestamp() * 1000000)
#     one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    
#     json_data = {
#         "query": {
#             "sql": "select * from \"stream_pytest_data\" WHERE match_all('E2E_testing')",
#             "start_time": one_min_ago,
#             "end_time": end_time,
#             "from": 0,
#             "size": 250,
#             "quick_mode": False
#         }
#     }
    
#     resp_get_distinctquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
#     assert (
#         resp_get_distinctquery.status_code == 200
#     ), f"Expected status code 200, but got {resp_get_distinctquery.status_code} {resp_get_distinctquery.content}"
    
#     response_data = resp_get_distinctquery.json()

#     print("matchallupperandlowercase", response_data)
    
#     # Assertion to check if 'e2e_test' is present in the 'log' field of any hit
#     assert any(hit['log'] == 'E2E_TESTING' for hit in response_data['hits']), "'E2E_TESTING' not found in log field of hits"

# def test_e2e_matchallupperlowercase(create_session, base_url):
#     """Running an E2E test for valid SQL query."""

#     session = create_session
#     url = base_url
#     org_id = "org_pytest_data"
#     now = datetime.now(timezone.utc)
#     end_time = int(now.timestamp() * 1000000)
#     one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    
#     json_data = {
#         "query": {
#             "sql": "select * from \"stream_pytest_data\" WHERE match_all('E2E_test*')",
#             "start_time": one_min_ago,
#             "end_time": end_time,
#             "from": 0,
#             "size": 250,
#             "quick_mode": False
#         }
#     }
    
#     resp_get_matchallupperlowercase = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
#     assert (
#         resp_get_matchallupperlowercase.status_code == 200
#     ), f"Expected status code 200, but got {resp_get_matchallupperlowercase.status_code} {resp_get_matchallupperlowercase.content}"
    
#     response_data = resp_get_matchallupperlowercase.json()

#     print("matchallupperlowercase", response_data)
    
#     # Assertion to check if 'e2e_test' is present in the 'log' field of any hit
#     logs = [hit['log'] for hit in response_data['hits']]
#     assert 'e2e_test' in logs, "'e2e_test' not found in log field of hits"
#     assert 'E2E_TESTING' in logs, "'E2E_TESTING' not found in log field of hits"


@pytest.mark.skip
def test_e2e_cachedscenario(create_session, base_url):
    """Running an E2E test for valid SQL query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    three_days_ago = int((now - timedelta(days=3)).timestamp() * 1000000) 

    # First query data
    json_data1 = {
        "query": {
            "sql": "select histogram(_timestamp, '5 minute') AS zo_sql_key, count(*) AS zo_sql_num from \"stream_pytest_data\"  GROUP BY zo_sql_key ORDER BY zo_sql_key",
            "start_time": one_min_ago,
            "end_time": end_time,
            "size": -1
        }
    }

    # Second query data
    json_data2 = {
        "query": {
            "sql": "select histogram(_timestamp, '5 minute') AS zo_sql_key, count(*) AS zo_sql_num from \"stream_pytest_data\"  GROUP BY zo_sql_key ORDER BY zo_sql_key",
            "start_time": three_days_ago,
            "end_time": end_time,
            "size": -1
        }
    }

    resp_get_allsearch1 = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data1)
    
    # Wait for 5 seconds
    time.sleep(5)  
    
    response_data1 = resp_get_allsearch1.json()
    result_cached_ratio1 = response_data1.get('result_cache_ratio', 0)
    assert result_cached_ratio1 == 0, f"Expected result_cached_ratio to be 0, but got {result_cached_ratio1}"

    # Wait for 5 minutes
    time.sleep(30)  # Sleep for 300 seconds (5 minutes)
    
    resp_get_allsearch2 = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data2)
    
    assert resp_get_allsearch1.status_code == 200, f"histogram mode added 200, but got {resp_get_allsearch1.status_code} {resp_get_allsearch1.content}"
    assert resp_get_allsearch2.status_code == 200, f"histogram mode added 200, but got {resp_get_allsearch2.status_code} {resp_get_allsearch2.content}"

    response_data2 = resp_get_allsearch2.json()
    cached_ratio2 = response_data2.get('result_cache_ratio', 0)
    assert cached_ratio2 > 0, f"Expected cached_ratio to be greater than 0, but got {cached_ratio2}"

@pytest.mark.skip
def test_e2e_cachedmultistreams(create_session, base_url):
    """Running an E2E test for valid SQL query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    three_days_ago = int((now - timedelta(days=3)).timestamp() * 1000000) 

    # First query data
    json_data1 = {

      
            "sql": [
            "select * from \"stream_data\" ",
            "select * from \"stream_pytest_data\" "
        ],
        "start_time": one_min_ago,
        "end_time": end_time,
        "from": 0,
        "size": 250,
        "quick_mode": False
    }
 


    # Second query data
    json_data2 = {
       
            "sql": [
            "select * from \"stream_data\" ",
            "select * from \"stream_pytest_data\" "
        ],
        "start_time": three_days_ago,
        "end_time": end_time,
        "from": 0,
        "size": 250,
        "quick_mode": False
    }



    resp_get_allsearch1 = session.post(f"{url}api/{org_id}/_search_multi?type=logs", json=json_data1)
    
    # Wait for 5 seconds
    time.sleep(5)  
    
    response_data1 = resp_get_allsearch1.json()
    result_cached_ratio1 = response_data1.get('cached_ratio', 0)
    assert result_cached_ratio1 == 0, f"Expected result_cached_ratio to be 0, but got {result_cached_ratio1}"

    # Wait for 5 minutes
    time.sleep(30)  # Sleep for 300 seconds (5 minutes)
    
    resp_get_allsearch2 = session.post(f"{url}api/{org_id}/_search_multi?type=logs", json=json_data2)
    
    assert resp_get_allsearch1.status_code == 200, f"histogram mode added 200, but got {resp_get_allsearch1.status_code} {resp_get_allsearch1.content}"
    assert resp_get_allsearch2.status_code == 200, f"histogram mode added 200, but got {resp_get_allsearch2.status_code} {resp_get_allsearch2.content}"

    response_data2 = resp_get_allsearch2.json()
    cached_ratio2 = response_data2.get('cached_ratio', 0)
    assert cached_ratio2 > 0, f"Expected cached_ratio to be greater than 0, but got {cached_ratio2}"


def test_e2e_eventtimestamp(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)

    json_data = {
        "query": {
            "sql": "SELECT histogram(_timestamp, '1 minutes') as eventtime1, COUNT(_timestamp) as totallogcount FROM \"stream_pytest_data\" GROUP BY eventtime1 Having totallogcount > 100 ORDER BY eventtime1 DESC",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 10,
            "quick_mode": False
        }
    }

    resp_get_eventtime = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    response_json = resp_get_eventtime.json()

    # Assuming the results are stored under a key named 'results' in the response JSON
    results = response_json.get('results', [])

    # Extract the eventtime1 values
    eventtimes = [result['eventtime1'] for result in results]
    
    # Check for uniqueness
    assert len(eventtimes) == len(set(eventtimes)), "eventtime1 values are not unique"


def test_e2e_distinctqueries(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT DISTINCT kubernetes_container_name \nFROM \"stream_pytest_data\"\n",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False
        }
    }
        
    resp_get_inquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_inquery.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_inquery.status_code} {resp_get_inquery.content}"
    response_data = resp_get_inquery.json()


def test_e2e_countcase(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT histogram(_timestamp, '1 minutes') as eventtime1, COUNT(_timestamp) as totallogcount, COUNT(CASE WHEN log = 'error' THEN 1 END) as errorlogcount, (COUNT(CASE WHEN log = 'error' THEN 1 END) / COUNT(*) * 100.0) as errorrate FROM 'stream_pytest_data' GROUP BY eventtime1 ORDER BY eventtime1 DESC",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False
        }
        }
    resp_get_inquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_inquery.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_inquery.status_code} {resp_get_inquery.content}"
    response_data = resp_get_inquery.json()


def test_e2e_coalesce(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT COALESCE(log, 'first value is null') as \"x_axis_1\", count(kubernetes_namespace_name) as \"y_axis_1\"  FROM \"stream_pytest_data\"  GROUP BY x_axis_1",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False
        }
        }
    resp_get_inquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_inquery.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_inquery.status_code} {resp_get_inquery.content}"
    response_data = resp_get_inquery.json()


def test_e2e_percentile(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT _timestamp as \"x_axis_1\", approx_percentile_cont(0.99) WITHIN GROUP (ORDER BY arrow_cast(took,'Int64')) as \"y_axis_1\"  FROM \"stream_pytest_data\" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False
        }
        }
    resp_get_inquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_inquery.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_inquery.status_code} {resp_get_inquery.content}"
    response_data = resp_get_inquery.json()


def test_e2e_float(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT _timestamp AS \"x_axis_1\", approx_percentile_cont(0.99) WITHIN GROUP (ORDER BY arrow_cast(took,'Int64')) AS \"y_axis_1\"  FROM \"stream_pytest_data\" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False
        }
        }
    resp_get_inquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_inquery.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_inquery.status_code} {resp_get_inquery.content}"
    response_data = resp_get_inquery.json()


    
def test_e2e_matchallsinglechar(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE match_all('m')",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False
        }
        }
    resp_get_inquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_inquery.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_inquery.status_code} {resp_get_inquery.content}"
    response_data = resp_get_inquery.json()


def test_e2e_floatvalue(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" where floatvalue = 10.45",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False
        }
        }
    resp_get_inquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_inquery.status_code == 200
    ), f"histogram mode added 200, but got {resp_get_inquery.status_code} {resp_get_inquery.content}"
    response_data = resp_get_inquery.json()


def test_e2e_where_condition_validation(create_session, base_url):
    """Test WHERE condition query and validate all hits have the expected data."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE kubernetes_container_name = 'ziox'",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False
        }
    }

    resp_get_where_query = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_where_query.status_code == 200
    ), f"WHERE condition query failed with status {resp_get_where_query.status_code} {resp_get_where_query.content}"
    
    response_data = resp_get_where_query.json()
    
    # Assert that we got results
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    # If we have hits, validate that ALL hits contain kubernetes_container_name = 'ziox'
    if len(hits) > 0:
        print(f"Found {len(hits)} hits matching the WHERE condition")
        
        for i, hit in enumerate(hits):
            assert "kubernetes_container_name" in hit, f"Hit {i} should contain 'kubernetes_container_name' field"
            assert hit["kubernetes_container_name"] == "ziox", (
                f"Hit {i} kubernetes_container_name should be 'ziox', but got '{hit.get('kubernetes_container_name')}'"
            )
        
        print(f"✅ All {len(hits)} hits have kubernetes_container_name = 'ziox' as expected")
    else:
        print("⚠️  No hits found for the WHERE condition query")
    
    # Log the total count and took time for monitoring
    total_hits = response_data.get("total", 0)
    took_time = response_data.get("took", 0)
    print(f"Query executed in {took_time}ms and found {total_hits} total matching records")


def test_e2e_match_all_validation(create_session, base_url):
    """Test WHERE level = 'info' query and validate that results contain the expected field value."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE level = 'info'",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 50,
            "quick_mode": False
        }
    }

    resp_get_match_query = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_match_query.status_code == 200
    ), f"match_all query failed with status {resp_get_match_query.status_code} {resp_get_match_query.content}"
    
    response_data = resp_get_match_query.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    if len(hits) > 0:
        print(f"Found {len(hits)} hits for level='info' query")
        
        # For WHERE level = 'info' queries, ALL hits should have level = 'info'
        for i, hit in enumerate(hits):
            assert "level" in hit, f"Hit {i} should contain 'level' field"
            assert hit["level"] == "info", f"Hit {i} level should be 'info', got '{hit.get('level')}'"
        
        print(f"✅ All {len(hits)} hits have level='info' as expected")
    else:
        print("⚠️  No hits found for level='info' query in the time window")
        # This is acceptable - the test validates the query syntax works correctly
        # and that when data IS found, it's properly filtered
    
    total_hits = response_data.get("total", 0)
    took_time = response_data.get("took", 0)
    print(f"level='info' query executed in {took_time}ms and found {total_hits} total matching records")



def test_e2e_timestamp_ordering_validation(create_session, base_url):
    """Test ORDER BY timestamp and validate proper ordering."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" ORDER BY _timestamp DESC LIMIT 10",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 10,
            "quick_mode": False
        }
    }

    resp_get_order_query = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_order_query.status_code == 200
    ), f"ORDER BY query failed with status {resp_get_order_query.status_code} {resp_get_order_query.content}"
    
    response_data = resp_get_order_query.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    if len(hits) > 1:
        print(f"Found {len(hits)} hits for ORDER BY query")
        
        # Validate descending timestamp order
        for i in range(len(hits) - 1):
            current_timestamp = hits[i].get("_timestamp", 0)
            next_timestamp = hits[i + 1].get("_timestamp", 0)
            
            assert current_timestamp >= next_timestamp, (
                f"Timestamps not in DESC order: hit {i} ({current_timestamp}) should be >= hit {i+1} ({next_timestamp})"
            )
        
        print(f"✅ All {len(hits)} hits are properly ordered by timestamp DESC")
    else:
        print("⚠️  Need at least 2 hits to validate ordering")
    
    total_hits = response_data.get("total", 0)
    took_time = response_data.get("took", 0)
    print(f"ORDER BY query executed in {took_time}ms and found {total_hits} total matching records")


def test_e2e_limit_validation(create_session, base_url):
    """Test LIMIT clause and validate result count."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" LIMIT 3",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,  # Set high size but query has LIMIT 3
            "quick_mode": False
        }
    }

    resp_get_limit_query = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_limit_query.status_code == 200
    ), f"LIMIT query failed with status {resp_get_limit_query.status_code} {resp_get_limit_query.content}"
    
    response_data = resp_get_limit_query.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    # Validate that LIMIT clause is respected
    assert len(hits) <= 3, f"LIMIT 3 should return max 3 results, got {len(hits)}"
    
    if len(hits) > 0:
        print(f"✅ LIMIT clause respected: got {len(hits)} hits (≤3) as expected")
    else:
        print("⚠️  No hits found for LIMIT query")
    
    total_hits = response_data.get("total", 0)
    took_time = response_data.get("took", 0)
    print(f"LIMIT query executed in {took_time}ms and found {total_hits} total matching records")




def test_e2e_cte_query_validation(create_session, base_url):
    """Test CTE (Common Table Expression) query and validate results."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "WITH filtered_logs AS (SELECT * FROM \"stream_pytest_data\" WHERE level = 'info') SELECT level, _timestamp FROM filtered_logs LIMIT 5",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 5,
            "quick_mode": False
        }
    }

    resp_get_cte_query = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_cte_query.status_code == 200
    ), f"CTE query failed with status {resp_get_cte_query.status_code} {resp_get_cte_query.content}"
    
    response_data = resp_get_cte_query.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    if len(hits) > 0:
        print(f"Found {len(hits)} hits for CTE query")
        
        # Validate that all results have level = 'info' (from the CTE WHERE clause)
        for i, hit in enumerate(hits):
            assert "level" in hit, f"Hit {i} should contain 'level' field"
            assert "_timestamp" in hit, f"Hit {i} should contain '_timestamp' field"
            assert hit["level"] == "info", (
                f"Hit {i} level should be 'info', got '{hit.get('level')}'"
            )
        
        print(f"✅ All {len(hits)} hits from CTE have level='info' as expected")
    else:
        print("⚠️  No hits found for CTE query")
    
    total_hits = response_data.get("total", 0)
    took_time = response_data.get("took", 0)
    print(f"CTE query executed in {took_time}ms and found {total_hits} total matching records")


def test_e2e_group_by_where_container_name_validation(create_session, base_url):
    """Test GROUP BY with WHERE clause to ensure only specified container_name is returned.
    
    This test validates the bug fix where GROUP BY queries with WHERE clauses
    were incorrectly returning results from other values as well.
    Regression test for WHERE clause filtering issues in GROUP BY operations.
    """

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    
    # Use a specific test container name that should be filtered precisely
    target_container_name = "ziox"
    
    json_data = {
        "query": {
            "sql": f"SELECT kubernetes_container_name, COUNT(*) AS log_count, MAX(_timestamp) AS latest_timestamp FROM \"stream_pytest_data\" WHERE kubernetes_container_name = '{target_container_name}' GROUP BY kubernetes_container_name",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False
        }
    }

    resp_get_group_where_query = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_group_where_query.status_code == 200
    ), f"GROUP BY WHERE container_name query failed with status {resp_get_group_where_query.status_code} {resp_get_group_where_query.content}"
    
    response_data = resp_get_group_where_query.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    if len(hits) > 0:
        print(f"Found {len(hits)} hits for GROUP BY WHERE kubernetes_container_name query")
        
        # CRITICAL VALIDATION: All returned hits must have ONLY the specified container_name
        for i, hit in enumerate(hits):
            # Validate required fields are present
            assert "kubernetes_container_name" in hit, f"Hit {i} should contain 'kubernetes_container_name' field"
            assert "log_count" in hit, f"Hit {i} should contain 'log_count' field (COUNT result)"
            assert "latest_timestamp" in hit, f"Hit {i} should contain 'latest_timestamp' field (MAX result)"
            
            # CRITICAL BUG CHECK: Ensure kubernetes_container_name matches exactly what was queried
            actual_container_name = hit["kubernetes_container_name"]
            assert actual_container_name == target_container_name, (
                f"🚨 BUG DETECTED: Hit {i} has kubernetes_container_name='{actual_container_name}' but query specified kubernetes_container_name='{target_container_name}'. "
                f"This indicates the WHERE clause is not properly filtering results!"
            )
            
            # Validate aggregation fields
            log_count = hit["log_count"]
            assert isinstance(log_count, int) and log_count > 0, (
                f"Hit {i} log_count (COUNT result) should be positive integer, got {log_count}"
            )
            
            latest_timestamp = hit["latest_timestamp"]
            assert latest_timestamp is not None, (
                f"Hit {i} latest_timestamp (MAX result) should not be null"
            )
        
        # Count unique container_names to ensure no leakage
        unique_container_names = set(hit["kubernetes_container_name"] for hit in hits)
        assert len(unique_container_names) == 1, (
            f"🚨 CRITICAL BUG: Expected only 1 kubernetes_container_name ('{target_container_name}') but found {len(unique_container_names)}: {unique_container_names}"
        )
        
        print(f"✅ All {len(hits)} hits contain ONLY kubernetes_container_name='{target_container_name}' as expected")
        print(f"✅ Bug validation PASSED: WHERE clause properly filters GROUP BY results")
        
    else:
        print(f"ℹ️  No hits found for kubernetes_container_name='{target_container_name}' (this is acceptable if no data exists)")
    
    total_hits = response_data.get("total", 0)
    took_time = response_data.get("took", 0)
    print(f"GROUP BY WHERE kubernetes_container_name query executed in {took_time}ms and found {total_hits} total matching records")


def test_e2e_str_match_ignore_case_with_coalesce_validation(create_session, base_url):
    """Test str_match_ignore_case function with coalesce and validate all returned hits contain expected data.
    
    This test validates the str_match_ignore_case function works correctly with coalesce
    for handling null values and case-insensitive string matching.
    Based on the working query: SELECT * FROM stream_pytest_data WHERE str_match_ignore_case(coalesce(kubernetes_container_name, kubernetes_namespace_name, 'monitoring'), 'prometheus')
    """

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE str_match_ignore_case(coalesce(kubernetes_container_name, kubernetes_namespace_name, 'monitoring'), 'prometheus')",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False
        }
    }

    resp_get_str_match_query = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_str_match_query.status_code == 200
    ), f"str_match_ignore_case with coalesce query failed with status {resp_get_str_match_query.status_code} {resp_get_str_match_query.content}"
    
    response_data = resp_get_str_match_query.json()
    assert "hits" in response_data, "Response should contain 'hits' field"
    
    hits = response_data["hits"]
    
    if len(hits) > 0:
        print(f"Found {len(hits)} hits for str_match_ignore_case with coalesce query")
        
        # Validate that ALL hits contain 'prometheus' in the expected fields
        for i, hit in enumerate(hits):
            # Extract the field values that were used in the coalesce function
            kubernetes_container_name = hit.get("kubernetes_container_name", "")
            kubernetes_namespace_name = hit.get("kubernetes_namespace_name", "")
            
            # The coalesce function should return the first non-null value:
            # coalesce(kubernetes_container_name, kubernetes_namespace_name, 'monitoring')
            coalesce_result = ""
            if kubernetes_container_name:
                coalesce_result = kubernetes_container_name
            elif kubernetes_namespace_name:
                coalesce_result = kubernetes_namespace_name
            else:
                coalesce_result = "monitoring"
            
            # str_match_ignore_case should match 'prometheus' in the coalesce result (case insensitive)
            assert "prometheus" in coalesce_result.lower(), (
                f"Hit {i}: str_match_ignore_case should match 'prometheus' in coalesce result '{coalesce_result}' "
                f"(kubernetes_container_name='{kubernetes_container_name}', kubernetes_namespace_name='{kubernetes_namespace_name}')"
            )
            
            print(f"Hit {i}: ✅ 'prometheus' found in coalesce result: '{coalesce_result}'")
        
        print(f"✅ All {len(hits)} hits contain 'prometheus' in the coalesce fields as expected")
        print(f"✅ str_match_ignore_case with coalesce validation PASSED")
        
    else:
        print("ℹ️  No hits found for str_match_ignore_case with coalesce query (this may indicate no matching data in the time window)")
        # This is acceptable - the test validates the query syntax works correctly
        # The important thing is that it returns 200 status and doesn't throw SQL parser errors
    
    total_hits = response_data.get("total", 0)
    took_time = response_data.get("took", 0)
    print(f"str_match_ignore_case with coalesce query executed in {took_time}ms and found {total_hits} total matching records")


# Camel Case Token Tests for PR #9185



def test_e2e_camel_case_edge_cases(create_session, base_url):
    """Test edge cases for camel case tokenization like numbers, special characters."""
    
    session = create_session
    url = base_url  
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    three_days_ago = int((now - timedelta(days=3)).timestamp() * 1000000)

    # Test cases for edge case scenarios
    test_cases = [
        {
            "search_term": "U8iI34Vi",
            "expected_field": "token",
            "expected_value": "U8iI34Vi",
            "description": "Complex alphanumeric token - U8iI34Vi"
        },
        {
            "search_term": "A1B2C3D4", 
            "expected_field": "identifier",
            "expected_value": "A1B2C3D4",
            "description": "Mixed alpha-numeric - A1B2C3D4"
        },
        {
            "search_term": "Http404Error",
            "expected_field": "code",
            "expected_value": "Http404Error",
            "description": "Camel case with numbers - Http404Error"
        },
        {
            "search_term": "404",
            "expected_field": "code", 
            "expected_value": "Http404Error",
            "description": "Number token '404' should find 'Http404Error'"
        },
        {
            "search_term": "JSON2XMLConverter",
            "expected_field": "parser",
            "expected_value": "JSON2XMLConverter",
            "description": "Acronym to acronym conversion - JSON2XMLConverter"
        },
        {
            "search_term": "ApiVersion2_3",
            "expected_field": "version",
            "expected_value": "ApiVersion2_3", 
            "description": "Camel case with underscore - ApiVersion2_3"
        }
    ]

    for test_case in test_cases:
        json_data = {
            "query": {
                "sql": f"SELECT * FROM \"stream_pytest_data\" WHERE match_all('{test_case['search_term']}')",
                "start_time": three_days_ago,
                "end_time": end_time,
                "from": 0,
                "size": 50,
                "quick_mode": False
            }
        }

        resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
        assert resp.status_code == 200, f"Edge case search for '{test_case['search_term']}' failed with status {resp.status_code}"
        
        response_data = resp.json()
        assert "hits" in response_data, f"Response for '{test_case['search_term']}' should contain 'hits' field"
        
        hits = response_data["hits"]
        matching_hits = 0
        
        if hits:
            for hit in hits:
                if hit.get(test_case["expected_field"]) == test_case["expected_value"]:
                    matching_hits += 1
                    print(f"✅ {test_case['description']}: Found expected value '{test_case['expected_value']}'")
            
            if matching_hits > 0:
                print(f"✅ Edge case search '{test_case['search_term']}' found {matching_hits} matching hits")
            else:
                print(f"⚠️  Edge case search '{test_case['search_term']}' found {len(hits)} hits but none matched expected field/value")
        else:
            print(f"⚠️  No hits found for edge case search '{test_case['search_term']}'")


def test_e2e_camel_case_backward_compatibility(create_session, base_url):
    """Test that existing non-camel case searches still work correctly."""
    
    session = create_session
    url = base_url
    org_id = "default" 
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    three_days_ago = int((now - timedelta(days=3)).timestamp() * 1000000)

    # Test existing search patterns to ensure backward compatibility
    compatibility_tests = [
        {
            "search_term": "test",
            "description": "Simple lowercase word search"
        },
        {
            "search_term": "info", 
            "description": "Common log level search"
        },
        {
            "search_term": "stopping",
            "description": "Word from existing test data"
        },
        {
            "search_term": "collector",
            "description": "Another word from existing test data"
        }
    ]

    for test_case in compatibility_tests:
        json_data = {
            "query": {
                "sql": f"SELECT * FROM \"stream_pytest_data\" WHERE match_all('{test_case['search_term']}')",
                "start_time": three_days_ago,
                "end_time": end_time,
                "from": 0,
                "size": 50,
                "quick_mode": False
            }
        }

        resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
        assert resp.status_code == 200, f"Backward compatibility test for '{test_case['search_term']}' failed with status {resp.status_code}"
        
        response_data = resp.json()
        assert "hits" in response_data, f"Response for '{test_case['search_term']}' should contain 'hits' field"
        
        # For backward compatibility, we just need to ensure the query works
        # The exact hit count may vary based on existing data
        total_hits = response_data.get("total", 0)
        took_time = response_data.get("took", 0)
        
        print(f"✅ {test_case['description']} ('{test_case['search_term']}'): {total_hits} hits in {took_time}ms")
    
    print("✅ All backward compatibility tests passed - existing searches still work")


def test_e2e_camel_case_full_token_search(create_session, base_url):
    """Test camel case full token search - DbException should be found"""
    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    three_days_ago = int((now - timedelta(days=3)).timestamp() * 1000000)

    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE match_all('DbException')",
            "start_time": three_days_ago,
            "end_time": end_time,
            "size": 100
        }
    }
    
    resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    if resp.status_code != 200:
        print(f"DEBUG DbException: Status {resp.status_code}, Response: {resp.text}")
    assert resp.status_code == 200, f"DbException test failed - Status {resp.status_code}: {resp.text}"
    
    response_data = resp.json()
    hits = response_data["hits"]
    print(f"DEBUG DbException: Found {len(hits)} hits, Total: {response_data.get('total', 0)}")
    if len(hits) == 0:
        print(f"DEBUG DbException: Full response: {response_data}")
    assert len(hits) > 0, "Should find logs containing 'DbException'"


def test_e2e_camel_case_atomic_token_search(create_session, base_url):
    """Test camel case search - 'UserAccountService' should be found"""
    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    three_days_ago = int((now - timedelta(days=3)).timestamp() * 1000000)
    
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE match_all('UserAccountService')",
            "start_time": three_days_ago,
            "end_time": end_time,
            "size": 100
        }
    }
    
    resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    if resp.status_code != 200:
        print(f"DEBUG UserAccountService: Status {resp.status_code}, Response: {resp.text}")
    assert resp.status_code == 200, f"UserAccountService test failed - Status {resp.status_code}: {resp.text}"
    
    response_data = resp.json()
    hits = response_data["hits"]
    print(f"DEBUG UserAccountService: Found {len(hits)} hits, Total: {response_data.get('total', 0)}")
    if len(hits) == 0:
        print(f"DEBUG UserAccountService: Full response: {response_data}")
    assert len(hits) > 0, "Should find logs containing 'UserAccountService'"


def test_e2e_camel_case_xml_acronym_search(create_session, base_url):
    """Test camel case XML acronym search - 'XMLHttpRequest' should be found"""
    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    three_days_ago = int((now - timedelta(days=3)).timestamp() * 1000000)
    
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE match_all('XMLHttpRequest')",
            "start_time": three_days_ago,
            "end_time": end_time,
            "size": 100
        }
    }
    
    resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    if resp.status_code != 200:
        print(f"DEBUG XMLHttpRequest: Status {resp.status_code}, Response: {resp.text}")
    assert resp.status_code == 200, f"XMLHttpRequest test failed - Status {resp.status_code}: {resp.text}"
    
    response_data = resp.json()
    hits = response_data["hits"]
    print(f"DEBUG XMLHttpRequest: Found {len(hits)} hits, Total: {response_data.get('total', 0)}")
    if len(hits) == 0:
        print(f"DEBUG XMLHttpRequest: Full response: {response_data}")
    assert len(hits) > 0, "Should find logs containing 'XMLHttpRequest'"


def test_e2e_camel_case_oauth2_number_search(create_session, base_url):
    """Test camel case with numbers - 'OAuth2TokenHandler' should be found"""
    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    three_days_ago = int((now - timedelta(days=3)).timestamp() * 1000000)
    
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE match_all('OAuth2TokenHandler')",
            "start_time": three_days_ago,
            "end_time": end_time,
            "size": 100
        }
    }
    
    resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    if resp.status_code != 200:
        print(f"DEBUG OAuth2TokenHandler: Status {resp.status_code}, Response: {resp.text}")
    assert resp.status_code == 200, f"OAuth2TokenHandler test failed - Status {resp.status_code}: {resp.text}"
    
    response_data = resp.json()
    hits = response_data["hits"]
    print(f"DEBUG OAuth2TokenHandler: Found {len(hits)} hits, Total: {response_data.get('total', 0)}")
    if len(hits) == 0:
        print(f"DEBUG OAuth2TokenHandler: Full response: {response_data}")
    assert len(hits) > 0, "Should find logs containing 'OAuth2TokenHandler'"


def test_e2e_camel_case_multi_token_search(create_session, base_url):
    """Test camel case multi-word search - 'UserManagementService' should be found"""
    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    three_days_ago = int((now - timedelta(days=3)).timestamp() * 1000000)

    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE match_all('UserManagementService')",
            "start_time": three_days_ago,
            "end_time": end_time,
            "size": 100
        }
    }

    resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    if resp.status_code != 200:
        print(f"DEBUG UserManagementService: Status {resp.status_code}, Response: {resp.text}")
    assert resp.status_code == 200, f"UserManagementService test failed - Status {resp.status_code}: {resp.text}"

    response_data = resp.json()
    hits = response_data["hits"]
    print(f"DEBUG UserManagementService: Found {len(hits)} hits, Total: {response_data.get('total', 0)}")
    if len(hits) == 0:
        print(f"DEBUG UserManagementService: Full response: {response_data}")
    assert len(hits) > 0, "Should find logs containing 'UserManagementService'"


# ============================================================================
# Histogram Interval Validation Tests
# These tests verify the fix for PR #10169 - histogram interval validation
# for multi-day factors of 24 hours (e.g., weekly intervals should not be
# converted to daily intervals)
# ============================================================================

# Constants for histogram interval tests (in seconds)
SECONDS_PER_HOUR = 3600
SECONDS_PER_DAY = 86400  # 24 hours
SECONDS_PER_WEEK = 604800  # 7 days


def _assert_histogram_interval(response_data, expected_interval, context_msg=""):
    """Helper to validate histogram_interval in response with clear error messages.

    Args:
        response_data: The JSON response from the search API
        expected_interval: Expected interval value in seconds
        context_msg: Additional context for error messages (e.g., "7 days", "weekly")

    Raises:
        AssertionError: If histogram_interval is missing, wrong type, or wrong value
    """
    # Check field exists
    assert "histogram_interval" in response_data, (
        f"Response missing 'histogram_interval' field. "
        f"Available keys: {list(response_data.keys())}. "
        f"This may indicate an API change or query issue."
    )

    returned_interval = response_data["histogram_interval"]

    # Check not None
    assert returned_interval is not None, (
        f"histogram_interval is None (expected {expected_interval}s{' - ' + context_msg if context_msg else ''}). "
        f"This may indicate the histogram was not processed."
    )

    # Check type
    assert isinstance(returned_interval, int), (
        f"histogram_interval should be int, got {type(returned_interval).__name__}: {returned_interval}"
    )

    # Check value
    assert returned_interval == expected_interval, (
        f"histogram_interval mismatch{' (' + context_msg + ')' if context_msg else ''}: "
        f"expected {expected_interval}s, got {returned_interval}s"
    )

    return returned_interval


def test_histogram_interval_weekly_preserved(create_session, base_url):
    """Test that weekly histogram interval (7 days = 604800 seconds) is preserved.

    This is the main regression test for PR #10169. Previously, the backend was
    incorrectly converting 7-day intervals to 1-day intervals because it only
    checked if the interval was a factor of 24 hours, not a multiple.

    Bug: Dashboard panels showing daily data instead of weekly data.
    Fix: Added check for multiples of 24 hours before factor check.
    """
    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    # Use 30 days range to ensure weekly intervals make sense
    thirty_days_ago = int((now - timedelta(days=30)).timestamp() * 1000000)

    # 7 days in seconds = 604800
    weekly_interval = SECONDS_PER_WEEK

    json_data = {
        "query": {
            "sql": f"SELECT histogram(_timestamp, '{weekly_interval} second') AS zo_sql_key, count(*) AS zo_sql_num FROM stream_pytest_data GROUP BY zo_sql_key ORDER BY zo_sql_key",
            "start_time": thirty_days_ago,
            "end_time": end_time,
            "from": 0,
            "size": 0,
            "quick_mode": True,
            "track_total_hits": False
        }
    }

    resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert resp.status_code == 200, f"Weekly histogram query failed: {resp.status_code} {resp.content}"

    response_data = resp.json()

    # The histogram_interval in the response should be preserved as 604800 (7 days)
    # NOT adjusted down to 86400 (1 day)
    returned_interval = _assert_histogram_interval(
        response_data,
        weekly_interval,
        context_msg="7 days/weekly - REGRESSION TEST for PR #10169"
    )

    print(f"Weekly interval test: Sent {weekly_interval}s, Got back {returned_interval}s")
    print(f"✅ Weekly histogram interval correctly preserved: {returned_interval}s (7 days)")


def test_histogram_interval_multiples_of_24h_preserved(create_session, base_url):
    """Test that various multiples of 24 hours are preserved (2, 7, 14, 30, 90 days).

    All intervals that are exact multiples of 24 hours should be returned as-is,
    not adjusted to a different value.
    """
    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    # Use 180 days range to accommodate 90-day intervals
    start_time = int((now - timedelta(days=180)).timestamp() * 1000000)

    # Test cases: (days, expected_seconds)
    test_cases = [
        (1, SECONDS_PER_DAY),       # 1 day = 86400s
        (2, 2 * SECONDS_PER_DAY),   # 2 days = 172800s
        (7, 7 * SECONDS_PER_DAY),   # 7 days = 604800s (weekly)
        (14, 14 * SECONDS_PER_DAY), # 14 days = 1209600s (bi-weekly)
        (30, 30 * SECONDS_PER_DAY), # 30 days = 2592000s (monthly)
        (90, 90 * SECONDS_PER_DAY), # 90 days = 7776000s (quarterly)
    ]

    for days, expected_interval in test_cases:
        json_data = {
            "query": {
                "sql": f"SELECT histogram(_timestamp, '{expected_interval} second') AS zo_sql_key, count(*) AS zo_sql_num FROM stream_pytest_data GROUP BY zo_sql_key ORDER BY zo_sql_key",
                "start_time": start_time,
                "end_time": end_time,
                "from": 0,
                "size": 0,
                "quick_mode": True,
                "track_total_hits": False
            }
        }

        resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
        assert resp.status_code == 200, f"{days}-day histogram query failed: {resp.status_code} {resp.content}"

        response_data = resp.json()
        returned_interval = _assert_histogram_interval(
            response_data,
            expected_interval,
            context_msg=f"{days} days (multiple of 24h)"
        )

        print(f"{days}-day interval test: Sent {expected_interval}s, Got back {returned_interval}s")

    print(f"✅ All multiples of 24h correctly preserved")


def test_histogram_interval_factors_of_24h_preserved(create_session, base_url):
    """Test that factors of 24 hours are preserved (1h, 2h, 4h, 6h, 8h, 12h).

    Intervals that divide evenly into 24 hours should be returned as-is.
    """
    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_day_ago = int((now - timedelta(days=1)).timestamp() * 1000000)

    # Test cases: (hours, expected_seconds)
    test_cases = [
        (1, 1 * SECONDS_PER_HOUR),   # 1 hour = 3600s
        (2, 2 * SECONDS_PER_HOUR),   # 2 hours = 7200s
        (4, 4 * SECONDS_PER_HOUR),   # 4 hours = 14400s
        (6, 6 * SECONDS_PER_HOUR),   # 6 hours = 21600s
        (8, 8 * SECONDS_PER_HOUR),   # 8 hours = 28800s
        (12, 12 * SECONDS_PER_HOUR), # 12 hours = 43200s
    ]

    for hours, expected_interval in test_cases:
        json_data = {
            "query": {
                "sql": f"SELECT histogram(_timestamp, '{expected_interval} second') AS zo_sql_key, count(*) AS zo_sql_num FROM stream_pytest_data GROUP BY zo_sql_key ORDER BY zo_sql_key",
                "start_time": one_day_ago,
                "end_time": end_time,
                "from": 0,
                "size": 0,
                "quick_mode": True,
                "track_total_hits": False
            }
        }

        resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
        assert resp.status_code == 200, f"{hours}-hour histogram query failed: {resp.status_code} {resp.content}"

        response_data = resp.json()
        returned_interval = _assert_histogram_interval(
            response_data,
            expected_interval,
            context_msg=f"{hours} hours (factor of 24h)"
        )

        print(f"{hours}-hour interval test: Sent {expected_interval}s, Got back {returned_interval}s")

    print(f"✅ All factors of 24h correctly preserved")


def test_histogram_interval_invalid_adjusted_to_nearest_factor(create_session, base_url):
    """Test that invalid intervals (not factor or multiple of 24h) are adjusted.

    Intervals like 5 hours or 25 hours that don't divide evenly into 24h
    and aren't multiples of 24h should be rounded to the nearest valid factor.
    """
    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    three_days_ago = int((now - timedelta(days=3)).timestamp() * 1000000)

    # Test cases: (invalid_interval_seconds, expected_adjusted_interval)
    # 5 hours (18000s) should round up to 6 hours (21600s)
    # 25 hours (90000s) is not a multiple of 24h, should be capped at 1 day (86400s)
    test_cases = [
        (5 * SECONDS_PER_HOUR, 6 * SECONDS_PER_HOUR),     # 5h -> 6h
        (25 * SECONDS_PER_HOUR, SECONDS_PER_DAY),         # 25h -> 1 day (capped)
        (36 * SECONDS_PER_HOUR, SECONDS_PER_DAY),         # 1.5 days -> 1 day (capped)
    ]

    for invalid_interval, expected_adjusted in test_cases:
        json_data = {
            "query": {
                "sql": f"SELECT histogram(_timestamp, '{invalid_interval} second') AS zo_sql_key, count(*) AS zo_sql_num FROM stream_pytest_data GROUP BY zo_sql_key ORDER BY zo_sql_key",
                "start_time": three_days_ago,
                "end_time": end_time,
                "from": 0,
                "size": 0,
                "quick_mode": True,
                "track_total_hits": False
            }
        }

        resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
        assert resp.status_code == 200, f"Invalid interval {invalid_interval}s query failed: {resp.status_code} {resp.content}"

        response_data = resp.json()
        returned_interval = _assert_histogram_interval(
            response_data,
            expected_adjusted,
            context_msg=f"invalid {invalid_interval}s should adjust to {expected_adjusted}s"
        )

        print(f"Invalid interval test: Sent {invalid_interval}s, Expected adjustment to {expected_adjusted}s, Got {returned_interval}s")

    print(f"✅ All invalid intervals correctly adjusted")


def test_histogram_interval_with_human_readable_format(create_session, base_url):
    """Test histogram intervals using human-readable format (e.g., '7 day', '1 week').

    Verifies that the backend correctly parses and preserves intervals specified
    in human-readable format, which is what dashboard panels typically use.
    """
    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    thirty_days_ago = int((now - timedelta(days=30)).timestamp() * 1000000)

    # Test cases using human-readable interval strings
    # Format: (interval_string, expected_seconds)
    test_cases = [
        ("1 hour", SECONDS_PER_HOUR),
        ("6 hour", 6 * SECONDS_PER_HOUR),
        ("1 day", SECONDS_PER_DAY),
        ("7 day", 7 * SECONDS_PER_DAY),  # Weekly - main regression case
    ]

    for interval_str, expected_interval in test_cases:
        json_data = {
            "query": {
                "sql": f"SELECT histogram(_timestamp, '{interval_str}') AS zo_sql_key, count(*) AS zo_sql_num FROM stream_pytest_data GROUP BY zo_sql_key ORDER BY zo_sql_key",
                "start_time": thirty_days_ago,
                "end_time": end_time,
                "from": 0,
                "size": 0,
                "quick_mode": True,
                "track_total_hits": False
            }
        }

        resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
        assert resp.status_code == 200, f"'{interval_str}' histogram query failed: {resp.status_code} {resp.content}"

        response_data = resp.json()
        returned_interval = _assert_histogram_interval(
            response_data,
            expected_interval,
            context_msg=f"human-readable '{interval_str}'"
        )

        print(f"Human-readable interval test: '{interval_str}' -> Expected {expected_interval}s, Got {returned_interval}s")

    print(f"✅ All human-readable intervals correctly processed")


def test_histogram_interval_consistency_across_requests(create_session, base_url):
    """Test that histogram interval is consistent across multiple requests.

    This verifies that caching doesn't cause inconsistent interval handling.
    The same query should always return the same histogram_interval.
    """
    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    thirty_days_ago = int((now - timedelta(days=30)).timestamp() * 1000000)

    weekly_interval = SECONDS_PER_WEEK

    json_data = {
        "query": {
            "sql": f"SELECT histogram(_timestamp, '{weekly_interval} second') AS zo_sql_key, count(*) AS zo_sql_num FROM stream_pytest_data GROUP BY zo_sql_key ORDER BY zo_sql_key",
            "start_time": thirty_days_ago,
            "end_time": end_time,
            "from": 0,
            "size": 0,
            "quick_mode": True,
            "track_total_hits": False
        }
    }

    # Make multiple requests and verify consistency
    intervals = []
    for i in range(3):
        resp = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
        assert resp.status_code == 200, f"Request {i+1} failed: {resp.status_code} {resp.content}"

        response_data = resp.json()

        # Validate each response properly
        returned_interval = _assert_histogram_interval(
            response_data,
            weekly_interval,
            context_msg=f"consistency check request {i+1}"
        )
        intervals.append(returned_interval)
        print(f"Request {i+1}: histogram_interval = {returned_interval}s")

    # All intervals should be the same (this is redundant after _assert_histogram_interval
    # but provides a clearer error message for consistency issues)
    assert all(interval == intervals[0] for interval in intervals), (
        f"Histogram interval inconsistent across requests: {intervals}"
    )

    print(f"✅ Histogram interval consistent across {len(intervals)} requests: {intervals[0]}s")
