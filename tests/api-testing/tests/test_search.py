
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
    """Test match_all query and validate all hits contain the search term."""

    session = create_session
    url = base_url
    org_id = "default"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT * FROM \"stream_pytest_data\" WHERE match_all('level=info')",
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
        print(f"Found {len(hits)} hits for match_all query")
        
        matching_hits = 0
        for i, hit in enumerate(hits):
            # Convert hit to string and check if it contains 'level=info'
            hit_str = str(hit).lower()
            if 'level=info' in hit_str or 'level":"info' in hit_str:
                matching_hits += 1
            else:
                print(f"Hit {i} does not contain 'level=info': {hit}")
        
        # For match_all queries, we expect at least some hits to contain the term
        assert matching_hits > 0, f"Expected some hits to contain 'level=info', but found {matching_hits}/{len(hits)}"
        print(f"✅ {matching_hits}/{len(hits)} hits contain 'level=info' as expected")
    else:
        print("⚠️  No hits found for match_all query")
    
    total_hits = response_data.get("total", 0)
    took_time = response_data.get("took", 0)
    print(f"match_all query executed in {took_time}ms and found {total_hits} total matching records")



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
