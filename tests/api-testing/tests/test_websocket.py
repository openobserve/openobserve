import pytest
import os  # For environment variables
import websocket  # For WebSocket connection
import json # For JSON parsing
import base64 # For encoding user credentials
import uuid # For generating UUIDs
from requests.auth import HTTPBasicAuth
from datetime import datetime, timezone, timedelta

# Constants for WebSocket URL and user credentials
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")
WS_ZO_BASE_URL = os.environ.get("WS_ZO_BASE_URL")
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")

org_id = "org_pytest_data"
stream_name = "stream_pytest_data"

@pytest.fixture(scope="session")
def enable_websocket(create_session, base_url):
    """Fixture to enable WebSocket"""
    session = create_session
    url = base_url
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
    payload_websocket = {
        "scrape_interval": 15,
        "span_id_field_name": "span_id",
        "trace_id_field_name": "trace_id",
        "toggle_ingestion_logs": True,
        "enable_websocket_search": True
    }

    print("Session Websocket Enabled headers:", session.headers)

    resp_websocket = session.post(f"{url}api/{org_id}/settings", json=payload_websocket)

    print("Enable Websocket", resp_websocket.content)
    assert (
        resp_websocket.status_code == 200
    ), f"Websocket enable 200, but got {resp_websocket.status_code} {resp_websocket.content}"

@pytest.fixture
def websocket_session(enable_websocket, auth_token, base_url):
    from pages.websocket_page import WebSocketPage
    
    auth_tokens, access_token = auth_token
    cookies = {
        "auth_tokens": auth_tokens,  # Use the raw auth_tokens cookie value
        "_oo_s": "test_session"
    }

    ws_page = WebSocketPage(
        org_id=org_id,
        access_token=access_token,  # Pass the actual access token
        cookies=cookies,
        base_url=base_url
    )
    ws_page.connect()
    yield ws_page
    ws_page.close()

def test_websocket_search_cancel(websocket_session):
    idTrace = str(uuid.uuid4())
    websocket_session.send_search(org_id, idTrace)
    response = websocket_session.receive()
    print("Response Search", response)
    assert '"type":"event_progress"' in response and '"event_type":"search"' in response

    websocket_session.send_cancel(org_id, idTrace)
    cancel_response = websocket_session.receive()
    print("Cancel Response", cancel_response)
    assert '"type":"cancel_response"' in cancel_response and '"is_success":true' in cancel_response

