import json
import websocket
import uuid
from datetime import datetime, timezone, timedelta

class WebSocketPage:
    def __init__(self, ws_url, org_id, access_token: str, cookies: dict):
        # Generate a dynamic UUID
        connection_uuid = str(uuid.uuid4())
        # Construct the WebSocket URL
        self.url = f"{ws_url}api/{org_id}/ws/v2/{connection_uuid}"
        self.access_token = access_token
        self.cookies = cookies
        self.ws = None

    def connect(self):
        headers = [
            "Upgrade: websocket",
            "Cache-Control: no-cache",
            "Accept-Language: en-US,en;q=0.9",
            "Pragma: no-cache",
            f"Cookie: auth_tokens={json.dumps(self.cookies['auth_tokens'])}; _oo_s={self.cookies['_oo_s']}",
            "Connection: Upgrade",
            "Sec-WebSocket-Key: str(uuid.uuid4())",
            "Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits"
        ]
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
                        "sql": 'SELECT * FROM "default"',
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
        self.ws.send(json.dumps(payload))

    def send_cancel(self, org_id: str, idTrace: str):
       
        cancel_payload = {
            "type": "cancel",
            "content": {
                "trace_id": idTrace,
                "org_id": org_id
            }
        }
        self.ws.send(json.dumps(cancel_payload))

    def receive(self):
        return self.ws.recv()

    def close(self):
        self.ws.close()
