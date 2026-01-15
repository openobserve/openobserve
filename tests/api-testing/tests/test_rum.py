import json
import requests
import uuid
from datetime import datetime, timezone, timedelta
import time


def parse_json(input_str):
    return json.loads(input_str)


def test_e2e_rumtoken(create_session, base_url):
    """Running an E2E test for get rum token."""

    session = create_session
    org_id = "default"

    resp_get_rumtoken = session.get(f"{base_url}api/{org_id}/rumtoken")

    # get rumtoken
    print(resp_get_rumtoken.content)
    assert (
        resp_get_rumtoken.status_code == 200
    ), f"Get all functions list 200, but got {resp_get_rumtoken.status_code} {resp_get_rumtoken.content}"


def test_e2e_invalidrumtoken(create_session, base_url):
    """Running an E2E test for get rum token."""

    rum_org = "e2e"
    logs_url = f"{base_url}rum/v1/{rum_org}/logs"
    rum_api_token = "rumxJwgUyIx3U"
    params = {
        "oosource": "browser",
        "ootags": "sdk_version:0.2.7,api:fetch,env:production,service:my-web-application,version:0.0.1",
        "oo-api-key": rum_api_token,
        "oo-request-id": "44004cf7-7149-4d9d-8e43-ca238d8afbe8",
        "oo-evp-origin": "browser",
    }
    unique_test_identifier = f"pytest-{uuid.uuid4()}"
    print(unique_test_identifier)

    logs_payload = """{"service":""}"""
    logs_payload_json = parse_json(logs_payload)
    logs_payload_json["message"] = unique_test_identifier

    resp_post_rum_logs = requests.post(logs_url, params=params, json=logs_payload_json)
    expected = 403
    got = resp_post_rum_logs.status_code

    assert (
        expected == got
    ), f"Failed to post to rum-logs, expected={expected} got={got}, {resp_post_rum_logs.content}"


def test_e2e_rumdataingestioninvalidtoken(create_session, base_url):
    """Running an E2E test for rum data with invalid rum token."""

    session = create_session
    rum_org = "e2e"
    rumdata_url = f"{base_url}rum/v1/{rum_org}/rum"
    rum_api_token = "rumv7T"
    params = {
        "oosource": "browser",
        "ootags": "sdk_version:0.2.7,api:fetch,env:production,service:my-web-application,version:0.0.1",
        "oo-api-key": rum_api_token,
        "oo-request-id": "44004cf7-7149-4d9d-8e43-ca238d8afbe8",
        "oo-evp-origin": "browser",
    }
    unique_test_identifier = f"pytest-{uuid.uuid4()}"
    print(unique_test_identifier)

    rumdata_payload = """{"_oo":{"format_version":2,"drift":0,"session":{"plan":2},"configuration":{"session_sample_rate":100,"session_replay_sample_rate":100},"discarded":false},"application":{"id":"1"},"date":1698048457936,"service":"my-web-application","version":"0.0.1","source":"browser","session":{"id":"30e6488a-3c60-4ffa-8549-468da66f6512","type":"user"},"view":{"id":"105d0f30-ea01-4cd9-96ff-dfbbafd8f7c3","url":"http://127.0.0.1:5173/","referrer":""},"display":{"viewport":{"width":1920,"height":941}},"resource":{"id":"42c413d1-2863-45ce-830c-68a3699ca98f","type":"image","url":"http://127.0.0.1:5173/src/assets/logo.svg?import","duration":16900000,"size":37,"download":{"duration":3200000,"start":13700000},"first_byte":{"duration":2800000,"start":10900000},"connect":{"duration":0,"start":10700000},"dns":{"duration":100000,"start":10600000}},"type":"resource"}"""
    rumdata_payload_json = parse_json(rumdata_payload)
    rumdata_payload_json["type"] = unique_test_identifier

    resp_post_rumdata = session.post(
        rumdata_url, params=params, json=rumdata_payload_json
    )
    expected = 403
    got = resp_post_rumdata.status_code

    assert (
        expected == got
    ), f"Failed to post to rum-data, expected={expected} got={got}, {resp_post_rumdata.content}"
    print(resp_post_rumdata)


def test_e2e_rumingestinglogs(create_session, base_url):
    """Running an E2E test for ingest rum logs."""
    session = create_session
    rum_org = "default"
    logs_url = f"{base_url}rum/v1/{rum_org}/logs"
    ip_address = "182.70.14.246"
    resp_get_rumtoken = session.get(f"{base_url}api/{rum_org}/rumtoken")

    # get rumtoken
    print(resp_get_rumtoken.content)
    assert (
        resp_get_rumtoken.status_code == 200
    ), f"Get all functions list 200, but got {resp_get_rumtoken.status_code} {resp_get_rumtoken.content}"

    rum_api_token = resp_get_rumtoken.json()["data"]["rum_token"]

    params = {
        "oosource": "browser",
        "ootags": "sdk_version:0.2.7,api:fetch,env:production,service:my-web-application,version:0.0.1",
        "oo-api-key": rum_api_token,
        "oo-request-id": "44004cf7-7149-4d9d-8e43-ca238d8afbe8",
        "oo-evp-origin": "browser",
    }
    unique_test_identifier = f"pytest-{uuid.uuid4()}"
    print(unique_test_identifier)

    logs_payload = """{"service":"my-web-application","session_id":"30e6488a-3c60-4ffa-8549-468da66f6512","view":{"referrer":"http://127.0.0.1:5173/about","url":"http://127.0.0.1:5173/about","id":"5a6c4bc6-f0cb-49ec-b4fb-460eda745efe"},"application_id":"1","date":1698049336226,"message":"what is happening???","origin":"console","status":"info"}"""
    logs_payload_json = parse_json(logs_payload)
    logs_payload_json["message"] = unique_test_identifier

    ip_headers = {"X-Forwarded-For": ip_address}
    resp_post_rum_logs = requests.post(
        logs_url, params=params, json=logs_payload_json, headers=ip_headers
    )
    expected = 200
    got = resp_post_rum_logs.status_code

    assert (
        expected == got
    ), f"Failed to post to rum-logs, expected={expected} got={got}, {resp_post_rum_logs.content}"

    retries = 3
    while True:
        try:
            params = {
                "type": "logs",
            }

            now = datetime.now(timezone.utc)
            end_time = int(now.timestamp() * 1000000)
            five_min_ago = int((now - timedelta(minutes=5)).timestamp() * 1000000)

            json_data = {
                "query": {
                    "sql": 'select * from "_rumlog" order by _timestamp desc limit 5 ;',
                    "start_time": five_min_ago,
                    "end_time": end_time,
                    "from": 0,
                    "size": 150
                },
            }

            search_url = f"{base_url}api/{rum_org}/_search"
            response_rum_data = session.post(search_url, params=params, json=json_data)

            # First check if the response is 200.
            got = response_rum_data.status_code
            expected = 200
            assert (
                expected == got
            ), f"Failed to retrieve rum-logs, got = {got}, expected = {expected}, {response_rum_data.content}"

            response_payload = response_rum_data.json()
            assert (
                len(response_payload["hits"]) > 0
            ), f"No data found, {response_rum_data.content}"

            response_payload = response_rum_data.json()
            assert (
                len(response_payload["hits"]) > 0
            ), f"Failed to retrieve the rum-log, {response_rum_data.content}"
            assert (
                response_payload["hits"][0]["message"] == unique_test_identifier
            ), f"Failed to retrieve the rum-log, {response_rum_data.content}"
            break
        except Exception as e:
            if retries > 0:
                retries -= 1
                time.sleep(3)
                print("retrying - exception was ", e)
                continue
            else:
                raise e


# This case would never fail, since it is a token generation.
# def test_e2e_generaterumtoken(create_session,base_url):
#     """Running an E2E test for get rum token."""

#     session = create_session
#     url = base_url
#     org_id = "e2e"
#     resp_generate_rumtoken = session.post(f"{base_url}api/{org_id}/rumtoken")
#     print(resp_generate_rumtoken.content)
#     rum_token = resp_generate_rumtoken.json()["data"]["rum_token"]

#     #get rumtoken
#     print(resp_generate_rumtoken.content)
#     assert resp_generate_rumtoken.status_code == 200, f"Get all functions list 200, but got {resp_generate_rumtoken.status_code} {resp_generate_rumtoken.content}"

# def test_e2e_updaterumtoken(create_session,base_url):
#     """Running an E2E test for get rum token."""

#     session = create_session
#     url = base_url
#     org_id = "e2e"
#     resp_update_rumtoken = session.put(f"{base_url}api/{org_id}/rumtoken")
#     print(resp_update_rumtoken.content)
#     rum_token = resp_update_rumtoken.json()["data"]["rum_token"]

#     #get rumtoken
#     print(resp_update_rumtoken.content)
#     assert resp_update_rumtoken.status_code == 200, f"Get all functions list 200, but got {resp_update_rumtoken.status_code} {resp_update_rumtoken.content}"

# Ingesting rum data and using search query to validate if data ingested is correct


# def test_e2e_rumdataingestandsearch(create_session, base_url):
#     """Running an E2E test for rum data ingest."""
#     session = create_session
#     rum_org = "default"
#     ip_address = "182.70.14.246"
#     headers = {"X-Forwarded-For": ip_address, "Content-Type": "application/json"}
#     resp_get_rumtoken = session.get(f"{base_url}api/{rum_org}/rumtoken")

#     # get rumtoken
#     print(resp_get_rumtoken.content)
#     assert (
#         resp_get_rumtoken.status_code == 200
#     ), f"Get all functions list 200, but got {resp_get_rumtoken.status_code} {resp_get_rumtoken.content}"

#     rum_api_token = resp_get_rumtoken.json()["data"]["rum_token"]
#     rumdata_url = f"{base_url}rum/v1/{rum_org}/rum"
#     params = {
#         "oosource": "browser",
#         "ootags": "sdk_version:0.2.7,api:fetch,env:production,service:my-web-application,version:0.0.1",
#         "oo-api-key": rum_api_token,
#         "oo-request-id": "44004cf7-7149-4d9d-8e43-ca238d8afbe8",
#         "oo-evp-origin": "browser",
#     }
#     unique_test_identifier = f"pytest-{uuid.uuid4()}"
#     print(unique_test_identifier)

#     rumdata_payload = """{"_oo":{"format_version":2,"drift":0,"session":{"plan":2},"configuration":{"session_sample_rate":100,"session_replay_sample_rate":100},"discarded":false},"application":{"id":"1"},"date":1698048457936,"service":"my-web-application","version":"0.0.1","source":"browser","session":{"id":"30e6488a-3c60-4ffa-8549-468da66f6512","type":"user"},"view":{"id":"105d0f30-ea01-4cd9-96ff-dfbbafd8f7c3","url":"http://127.0.0.1:5173/","referrer":""},"display":{"viewport":{"width":1920,"height":941}},"resource":{"id":"42c413d1-2863-45ce-830c-68a3699ca98f","type":"image","url":"http://127.0.0.1:5173/src/assets/logo.svg?import","duration":16900000,"size":37,"download":{"duration":3200000,"start":13700000},"first_byte":{"duration":2800000,"start":10900000},"connect":{"duration":0,"start":10700000},"dns":{"duration":100000,"start":10600000}},"type":"resource"}"""
#     rumdata_payload_json = parse_json(rumdata_payload)
#     rumdata_payload_json["type"] = unique_test_identifier

#     resp_post_rumdata = session.post(
#         rumdata_url, params=params, json=rumdata_payload_json, headers=headers
#     )
#     expected = 200
#     got = resp_post_rumdata.status_code

#     assert (
#         expected == got
#     ), f"Failed to post to rum-data, expected={expected} got={got}, {resp_post_rumdata.content}"
#     print(resp_post_rumdata)

#     retries = 3
#     while True:
#         try:
#             params = {
#                 "type": "logs",
#             }

#             now = datetime.now(timezone.utc)
#             end_time = int(now.timestamp() * 1000000)
#             five_min_ago = int((now - timedelta(minutes=5)).timestamp() * 1000000)

#             json_data = {
#                 "query": {
#                     "sql": 'select * from "_rumdata" order by _timestamp desc limit 5 ;',
#                     "start_time": five_min_ago,
#                     "end_time": end_time,
#                     "from": 0,
#                     "size": 150
#                 },
#             }

#             search_url = f"{base_url}api/{rum_org}/_search"
#             response_rum_data = session.post(search_url, params=params, json=json_data)

#             # First check if the response is 200.
#             got = response_rum_data.status_code
#             expected = 200
#             assert (
#                 expected == got
#             ), f"Failed to retrieve rum-data, got = {got}, expected = {expected}, {response_rum_data.content}"

#             response_payload = response_rum_data.json()

#             print("RUM rumdataingestandsearch verified geo data", response_payload)

#             assert (
#                 len(response_payload["hits"]) > 0
#             ), f"No data found, {response_rum_data.content}"

#             assert unique_test_identifier in set(
#                 [payload["type"] for payload in response_payload["hits"]]
#             ), f"Failed to retrieve the rum-log, {response_rum_data.content}"
#             break
#         except Exception as e:
#             if retries > 0:
#                 retries -= 1
#                 time.sleep(3)
#                 print("retrying - exception was ", e)
#                 continue
#             else:
#                 raise e


# verify data under rum logs has geo location
# def test_e2e_rumverifygeodata(create_session, base_url):
#     """Running an E2E test for geo data under response."""
#     session = create_session
#     rum_org = "default"
#     logs_url = f"{base_url}rum/v1/{rum_org}/logs"
#     ip_address = "182.70.14.246"
#     headers = {"X-Forwarded-For": ip_address, "Content-Type": "application/json"}
#     resp_get_rumtoken = session.get(f"{base_url}api/{rum_org}/rumtoken")

#     # get rumtoken
#     print(resp_get_rumtoken.content)
#     assert (
#         resp_get_rumtoken.status_code == 200
#     ), f"Get all functions list 200, but got {resp_get_rumtoken.status_code} {resp_get_rumtoken.content}"

#     rum_api_token = resp_get_rumtoken.json()["data"]["rum_token"]

#     params = {
#         "oosource": "browser",
#         "ootags": "sdk_version:0.2.7,api:fetch,env:production,service:my-web-application,version:0.0.1",
#         "oo-api-key": rum_api_token,
#         "oo-request-id": "44004cf7-7149-4d9d-8e43-ca238d8afbe8",
#         "oo-evp-origin": "browser",
#     }
#     unique_test_identifier = f"pytest-{uuid.uuid4()}"
#     print(unique_test_identifier)

#     logs_payload = """{"service":"my-web-application","session_id":"30e6488a-3c60-4ffa-8549-468da66f6512","view":{"referrer":"http://127.0.0.1:5173/about","url":"http://127.0.0.1:5173/about","id":"5a6c4bc6-f0cb-49ec-b4fb-460eda745efe"},"application_id":"1","date":1698049336226,"message":"what is happening???","origin":"console","status":"info"}"""
#     logs_payload_json = parse_json(logs_payload)
#     logs_payload_json["message"] = unique_test_identifier
#     time.sleep(3)

#     resp_post_rum_logs = requests.post(
#         logs_url, params=params, json=logs_payload_json, headers=headers
#     )
#     expected = 200
#     got = resp_post_rum_logs.status_code

#     assert (
#         expected == got
#     ), f"Failed to post to rum-logs, expected={expected} got={got}, {resp_post_rum_logs.content}"

#     retries = 3
#     while True:
#         try:
#             params = {
#                 "type": "logs",
#             }

#             now = datetime.now(timezone.utc)
#             end_time = int(now.timestamp() * 1000000)
#             one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)

#             json_data = {
#                 "query": {
#                     "sql": 'select * from "_rumlog" order by _timestamp desc limit 1 ;',
#                     "start_time": one_min_ago,
#                     "end_time": end_time,
#                     "from": 0,
#                     "size": 150
#                 },
#             }

#             search_url = f"{base_url}api/{rum_org}/_search"
#             response_rum_data = session.post(search_url, params=params, json=json_data)

#             # First check if the response is 200.
#             got = response_rum_data.status_code
#             expected = 200
#             assert (
#                 expected == got
#             ), f"Failed to retrieve rum-logs, got = {got}, expected = {expected}, {response_rum_data.content}"

#             response_payload = response_rum_data.json()

#             print("RUM rumverifygeodata verified geo data", response_payload)

#             assert len(response_payload["hits"]) > 0, "No results found in rum-logs"
#             logs_exist = any(
#                 [
#                     x
#                     for x in response_payload["hits"]
#                     if x["message"] == unique_test_identifier
#                 ]
#             )
#             assert (
#                 logs_exist
#             ), f"Failed to retrieve the rum-log, {response_rum_data.content}"
#             assert response_payload["hits"][0].get("geo_info_country") is not None
#             break
#         except Exception as e:
#             if retries > 0:
#                 retries -= 1
#                 time.sleep(3)
#                 print("retrying - exception was ", e)
#                 continue
#             else:
#                 raise e
