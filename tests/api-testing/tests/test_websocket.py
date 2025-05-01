import pytest
import os
import websocket
import json
import base64
import uuid
from requests.auth import HTTPBasicAuth
import requests

# Constants for WebSocket URL and user credentials
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")
WS_ZO_BASE_URL = os.environ.get("WS_ZO_BASE_URL")
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")

org_id = "org_pytest_data"
stream_name = "stream_pytest_data"

@pytest.fixture(scope="function")
def create_session():
    """Fixture to create a session"""
    session = requests.Session()
    return session

@pytest.fixture(scope="function")
def enable_websocket(create_session, base_url):
    """Fixture to enable WebSocket"""
    session = create_session
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    payload_websocket = {
        "scrape_interval": 15,
        "span_id_field_name": "span_id",
        "trace_id_field_name": "trace_id",
        "toggle_ingestion_logs": True,
        "enable_websocket_search": True
    }

    resp_websocket = session.post(f"{base_url}api/{org_id}/settings", json=payload_websocket)
    assert resp_websocket.status_code == 200, f"Expected status 200 but got {resp_websocket.status_code} {resp_websocket.content}"

@pytest.fixture
def websocket_session(base_url):
    from pages.websocket_page import WebSocketPage
    cookies = f"auth_tokens={{\"access_token\":\"Basic {base64.b64encode((ZO_ROOT_USER_EMAIL + ':' + ZO_ROOT_USER_PASSWORD).encode()).decode()}\",\"refresh_token\":\"\"}}"
    ws_page = WebSocketPage(org_id=org_id, cookies=cookies, base_url=base_url)
    ws_page.connect()
    yield ws_page
    ws_page.close()

def test_websocket_search_cancel(websocket_session, enable_websocket):
    idTrace = str(uuid.uuid4())
    
    # Send search request
    websocket_session.send_search(org_id, idTrace)
    
    # Receive search response
    response = websocket_session.receive()
    print("Response Search", response)
    response_json = json.loads(response)
    assert response_json['type'] == 'event_progress' and response_json['content']['event_type'] == 'search', \
        f"Unexpected response for search: {response_json}"

    # Send cancel request
    websocket_session.send_cancel(org_id, idTrace)
    
    # Receive cancel response
    cancel_response = websocket_session.receive()
    print("Cancel Response", cancel_response)
    cancel_response_json = json.loads(cancel_response)
    assert cancel_response_json['type'] == 'cancel_response' and cancel_response_json['content']['is_success'] == True, \
        f"Unexpected response for cancel: {cancel_response_json}"
