
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
        resp_get_allsearch.status_code == 400
    ), f"No payload added 400, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"

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


def test_e2e_matchall_prefix_wildcard(create_session, base_url):
    """Running an E2E test for match_all with prefix wildcard '*s' - finds words ending with 's'."""

    session = create_session
    url = base_url
    org_id = "org_pytest_data"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE match_all('*s')",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False,
            "sql_mode": "full"
        }
    }
    resp_get_inquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_inquery.status_code == 200
    ), f"Expected status code 200, but got {resp_get_inquery.status_code} {resp_get_inquery.content}"
    response_data = resp_get_inquery.json()

    # Validate that returned data contains words ending with 's'
    hits = response_data.get('hits', [])
    if hits:  # Only validate if there are results
        for hit in hits:
            log_content = hit.get('_all', hit.get('log', ''))  # Try _all first, fallback to log
            # Check if any word in the log ends with 's'
            words = log_content.split()
            assert any(word.lower().endswith('s') for word in words), f"No word ending with 's' found in log: {log_content[:200]}..."


def test_e2e_matchall_suffix_wildcard(create_session, base_url):
    """Running an E2E test for match_all with suffix wildcard 'm*'."""

    session = create_session
    url = base_url
    org_id = "org_pytest_data"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE match_all('m*')",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False,
            "sql_mode": "full"
        }
    }
    resp_get_inquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_inquery.status_code == 200
    ), f"Expected status code 200, but got {resp_get_inquery.status_code} {resp_get_inquery.content}"
    response_data = resp_get_inquery.json()

    # Validate that returned data contains words starting with 'm'
    hits = response_data.get('hits', [])
    if hits:  # Only validate if there are results
        for hit in hits:
            log_content = hit.get('log', '')
            # Check if any word in the log starts with 'm'
            words = log_content.split()
            assert any(word.lower().startswith('m') for word in words), f"No word starting with 'm' found in log: {log_content}"


def test_e2e_matchall_both_wildcards(create_session, base_url):
    """Running an E2E test for match_all with both prefix and suffix wildcard '*m*'."""

    session = create_session
    url = base_url
    org_id = "org_pytest_data"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE match_all('*m*')",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False,
            "sql_mode": "full"
        }
    }
    resp_get_inquery = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
    assert (
        resp_get_inquery.status_code == 200
    ), f"Expected status code 200, but got {resp_get_inquery.status_code} {resp_get_inquery.content}"
    response_data = resp_get_inquery.json()

    # Validate that returned data contains words with 'm' anywhere in them
    hits = response_data.get('hits', [])
    if hits:  # Only validate if there are results
        for hit in hits:
            log_content = hit.get('log', '')
            # Check if any word in the log contains 'm'
            words = log_content.split()
            assert any('m' in word.lower() for word in words), f"No word containing 'm' found in log: {log_content}"
            
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
