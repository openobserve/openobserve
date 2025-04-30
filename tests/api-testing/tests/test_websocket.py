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

# Validate required environment variables
required_vars = {
    "ZO_BASE_URL_SC": ZO_BASE_URL_SC,
    "WS_ZO_BASE_URL": WS_ZO_BASE_URL,
    "ZO_ROOT_USER_EMAIL": ZO_ROOT_USER_EMAIL,
    "ZO_ROOT_USER_PASSWORD": ZO_ROOT_USER_PASSWORD
}

missing_vars = [var for var, value in required_vars.items() if value is None]
if missing_vars:
    raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")

org_id = "org_pytest_data"
stream_name = "stream_pytest_data"

@pytest.fixture
def websocket_session():
    from pages.websocket_page import WebSocketPage
    access_token = f"Basic {base64.b64encode(f'{ZO_ROOT_USER_EMAIL}:{ZO_ROOT_USER_PASSWORD}'.encode()).decode()}"
    
    cookies = {
        "auth_tokens": {
            "access_token": access_token,
            "refresh_token": ""
        },
        "_oo_s": "test_session"
    }

    ws_page = WebSocketPage(
        ws_url=WS_ZO_BASE_URL,
        org_id=org_id,
        access_token=cookies["auth_tokens"]["access_token"],
        cookies=cookies
    )
    ws_page.connect()
    yield ws_page
    ws_page.close()

# Define test data with different queries and expected response details for websocket enable
def test_enable_websocket(create_session, base_url):
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


def test_websocket_search_cancel(websocket_session):
    idTrace = str(uuid.uuid4())
    websocket_session.send_search(org_id, idTrace)
    response = websocket_session.receive()
    print("Response Search", response)
    assert '"type":"search"' in response or '"type":"response"' in response  # or any specific match

    websocket_session.send_cancel(org_id, idTrace)
    cancel_response = websocket_session.receive()
    print("Cancel Response", cancel_response)
    assert '"type":"cancel"' in cancel_response or "canceled" in cancel_response.lower()

# def handle_websocket_connection(message):
#     """Simple WebSocket handler - just get results and return"""
#     ws = None
#     # Construct the cookie header
#     access_token = f"Basic {base64.b64encode(f'{ZO_ROOT_USER_EMAIL}:{ZO_ROOT_USER_PASSWORD}'.encode()).decode()}"
#     cookie_header = f'auth_tokens={{"access_token":"{access_token}","refresh_token":""}}'

#     # Generate a dynamic UUID
#     connection_uuid = str(uuid.uuid4())
#     # Construct the WebSocket URL
#     WS_URL = f"{WS_ZO_BASE_URL}api/{org_id}/ws/v2/{connection_uuid}"

#     try:
#         # Create WebSocket connection with the cookie header
#         ws = websocket.create_connection(WS_URL, header={
#             "Cookie": cookie_header,
#             "Upgrade": "websocket",
#             "Cache-Control": "no-cache",
#             "Accept-Language": "en-US,en;q=0.9",
#             "Pragma": "no-cache",
#             "Connection": "Upgrade",
#             "Sec-WebSocket-Key": str(uuid.uuid4()),   # Generate or use a consistent key
#             "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits"
#         })
        
#         # Send query
#         ws.send(json.dumps(message))
        
#         # Get results
#         response = ws.recv()
#         res_json = json.loads(response)
#         return res_json

#     except websocket.WebSocketBadStatusException as e:
#         print(f"WebSocket error: {e}")
#         raise   
#     except websocket.WebSocketConnectionClosedException as e:
#         print(f"WebSocket connection closed by server: {e}")
#         raise
#     except websocket.WebSocketTimeoutException as e:
#         print(f"WebSocket timeout: {e}")
#         raise
#     except json.JSONDecodeError as e:
#         print(f"Failed to parse response as JSON: {e}")
#         raise
#     except Exception as e:
#         print(f"Unexpected WebSocket error: {e}")
#         raise
#     finally:
#         if ws:
#             try:
#                 ws.close()
#             except Exception as close_e:
#                 print(f"Error closing WebSocket: {close_e}")  # Log any errors during close



# def test_websocket_cancel(create_session, base_url):
#     """Test WebSocket cancel endpoint."""
#     session = create_session
#     url = base_url
#     session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
#     # Generate a dynamic trace_id
#     trace_id = str(uuid.uuid4())

#     now = datetime.now(timezone.utc)
#     end_time = int(now.timestamp() * 1000000)
#     ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)

#     response = session.get(f"{url}api/{org_id}/settings")
#     print(response.status_code, response.text)

#     # Prepare the message to send
#     message = {
#         "type": "search",
#         "content": {
#             "trace_id": trace_id,  # Use dynamic trace_id
#             "payload": {
#                 "query": {
#                     "sql": f"SELECT * FROM \"{stream_name}\"",
#                     "start_time": ten_min_ago,
#                     "end_time": end_time,
#                     "from": 0,
#                     "size": 50,
#                     "quick_mode": False,
#                     "sql_mode": "full"
#                 }
#             },
#             "stream_type": "logs",
#             "search_type": "ui",
#             "use_cache": True,
#             "org_id": org_id
#         }
#     }

#     # Send the message
#     response_data = handle_websocket_connection(message)

#     print("WebSocket response:", response_data)

#     message_cancel = {
#         "type": "cancel",
#         "content": {
#             "trace_id": trace_id,
#             "org_id": org_id
#         }
#     }

#     response_data_cancel = handle_websocket_connection(message_cancel)

#     print("WebSocket cancel response:", response_data_cancel)

#     # Assert that is_success is True
#     assert response_data_cancel["content"]["is_success"] is True, "Expected is_success to be True"

