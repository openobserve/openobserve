import json
import requests
import pytest

from datetime import datetime, timezone, timedelta
import time

def test_e2e_joinlike(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "org_pytest_data"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT \"a\".kubernetes_namespace_name, \"b\".kubernetes_pod_name FROM \"stream_pytest_data\" AS \"a\" INNER JOIN \"stream_pytest_data\" AS \"b\" ON \"a\".kubernetes_pod_name = \"b\".kubernetes_pod_name WHERE \"a\".kubernetes_pod_name LIKE '%ziox%' LIMIT 1",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 1,
            "quick_mode": False,
            "sql_mode": "full"
        }
        }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Sql mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"




def test_e2e_joinbasic(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "org_pytest_data"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data =  {
        "query": {
            "sql": "SELECT \"a\".kubernetes_namespace_name, \"b\".kubernetes_pod_name FROM \"stream_pytest_data\" AS \"a\" INNER JOIN \"stream_pytest_data\" AS \"b\" ON \"a\".kubernetes_pod_name = \"b\".kubernetes_pod_name LIMIT 10",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 10,
            "quick_mode": False,
            "sql_mode": "full"
        }
        }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Sql mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"

def test_e2e_joinin(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "org_pytest_data"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data =  {
        "query": {
            "sql": "SELECT \"a\".kubernetes_namespace_name, \"b\".kubernetes_pod_name FROM \"stream_pytest_data\" AS \"a\" INNER JOIN \"stream_pytest_data\" AS \"b\" ON \"a\".kubernetes_pod_name = \"b\".kubernetes_pod_name WHERE \"a\".kubernetes_pod_name IN ('prometheus-k8s-1') LIMIT 1",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 1,
            "quick_mode": False,
            "sql_mode": "full"
        }
        }

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Sql mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"


def test_e2e_leftjoin(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "org_pytest_data"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT a.kubernetes_namespace_name, b.kubernetes_pod_name\nFROM \"stream_pytest_data\" as a\nLEFT JOIN \"stream_pytest_data\" as b ON a.kubernetes_pod_name = b.kubernetes_pod_name",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False,
            "sql_mode": "full"
        }
}

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Sql mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"


def test_e2e_rightjoin(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "org_pytest_data"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT a.kubernetes_namespace_name, b.kubernetes_pod_name\nFROM \"stream_pytest_data\" as a\nRIGHT JOIN \"stream_pytest_data\" as b ON a.kubernetes_pod_name = b.kubernetes_pod_name",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False,
            "sql_mode": "full"
        }
}

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Sql mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"



def test_e2e_fulljoin(create_session, base_url):
    """Running an E2E test for valid sql query."""

    session = create_session
    url = base_url
    org_id = "org_pytest_data"
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
    json_data = {
        "query": {
            "sql": "SELECT a.kubernetes_namespace_name, b.kubernetes_pod_name\nFROM \"stream_pytest_data\" as a\nFULL JOIN \"stream_pytest_data\" as b ON a.kubernetes_pod_name = b.kubernetes_pod_name",
            "start_time": one_min_ago,
            "end_time": end_time,
            "from": 0,
            "size": 100,
            "quick_mode": False,
            "sql_mode": "full"
        }
}

    resp_get_allsearch = session.post(f"{url}api/{org_id}/_search?type=logs", json=json_data)
   
    assert (
        resp_get_allsearch.status_code == 200
    ), f"Sql mode added 200, but got {resp_get_allsearch.status_code} {resp_get_allsearch.content}"











   