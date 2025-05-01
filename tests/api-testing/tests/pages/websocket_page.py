# websocket_page.py
import json
import websocket
import uuid
from datetime import datetime, timezone, timedelta
import os
import re
import base64

ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")

class WebSocketPage:
    def __init__(self, org_id, cookies, base_url: str = None):
        # Get WebSocket URL from base_url or environment
        if base_url:
            # Convert http to ws
            ws_url = base_url.replace('http://', 'ws://').replace('https://', 'wss://')
        else:
            ws_url = os.environ.get("WS_ZO_BASE_URL")
            
        if not ws_url:
            raise ValueError("WebSocket URL is not set. Either provide base_url or set WS_ZO_BASE_URL environment variable")
            
        # Generate a dynamic UUID
        connection_uuid = str(uuid.uuid4())
        # Ensure ws_url ends with a slash
        ws_url = ws_url.rstrip('/') + '/'
        # Construct the WebSocket URL
        self.url = f"{ws_url}api/{org_id}/ws/v2/{connection_uuid}"
        self.cookies = cookies
        self.ws = None

    def connect(self):
        # Extract the Basic auth token from cookies
        match = re.search(r'"access_token":"Basic ([^"]+)"', self.cookies)
        if not match:
            raise ValueError("Invalid cookie format - Basic auth token not found")
        
        basic_auth_token = match.group(1)
        
        headers = {
            "Upgrade": "websocket",
            "Cache-Control": "no-cache",
            "Accept-Language": "en-US,en;q=0.9",
            "Pragma": "no-cache",
            "Connection": "Upgrade",
            "Sec-WebSocket-Key": str(uuid.uuid4()),
            "Sec-WebSocket-Version": "13",
            "Authorization": f"Basic {basic_auth_token}"
        }
        print("WebSocket URL:", self.url)
        print("WebSocket Headers:", headers)
        self.ws = websocket.create_connection(self.url, header=headers)

    def send_search(self, org_id: str, idTrace: str):

        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        ten_min_ago = int((now - timedelta(minutes=10)).timestamp() * 1000000)

        payload = {
            "type": "search",
            "content": {
                "trace_id": idTrace,
                "payload": {
                    "query": {
                        "sql": 'SELECT * FROM "stream_pytest_data"',
                        "start_time": ten_min_ago,
                        "end_time": end_time,
                        "from": 0,
                        "size": 50,
                        "quick_mode": False,
                        "sql_mode": "full"
                    }
                },
                "stream_type": "logs",
                "search_type": "ui",
                "use_cache": True,
                "org_id": org_id
            }
        }
        if self.ws is None:
            raise RuntimeError("WebSocket is not connected. Call connect() first.")
        self.ws.send(json.dumps(payload))

    def send_cancel(self, org_id: str, idTrace: str):
       
        cancel_payload = {
            "type": "cancel",
            "content": {
                "trace_id": idTrace,
                "org_id": org_id
            }
        }
        if self.ws is None:
            raise RuntimeError("WebSocket is not connected. Call connect() first.")
        self.ws.send(json.dumps(cancel_payload))

    def receive(self):
        return self.ws.recv()

    def close(self):
        if self.ws is not None:
            self.ws.close()
