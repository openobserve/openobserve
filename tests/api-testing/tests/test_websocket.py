
def test_websocket_enable(create_session, base_url):
    """Running an E2E test for websocket enable."""

    session = create_session
    url = base_url
    org_id = "default"
    payload_websocket = {
        "scrape_interval":16,
        "span_id_field_name":"span_id",
        "trace_id_field_name":"trace_id",
        "toggle_ingestion_logs":True,
        "enable_websocket_search":True
        }

    resp_websocket = session.post(f"{url}api/{org_id}/settings", json=payload_websocket)

    print(resp_websocket.content)
    assert (
        resp_websocket.status_code == 200
    ), f"Websocket enable 200, but got {resp_websocket.status_code} {resp_websocket.content}"

import websocket
import json
import time

def on_open(ws):
    print("WebSocket connection opened")
    
    # Prepare the message to send
    message = {
        "type": "search",
        "content": {
            "trace_id": "72049700e3f7442d863e74987abb74d4",
            "payload": {
                "query": {
                    "sql": "SELECT * FROM \"default\"",
                    "start_time": 1738541912128000,
                    "end_time": 1738563512128000,
                    "from": 0,
                    "size": 100,
                    "quick_mode": False,
                    "sql_mode": "full"
                },
                "stream_type": "logs",
                "search_type": "ui",
                "use_cache": True
            }
        }
    }

    # Send the message
    ws.send(json.dumps(message))
    print("Message sent:", message)

def on_message(ws, message):
    print("Received message:", message)

def on_error(ws, error):
    print("Error:", error)

def on_close(ws):
    print("WebSocket connection closed")

if __name__ == "__main__":
    url = "wss://main.dev.zinclabs.dev/api/default/ws/da9a13d5-23e2-4fb5-a57c-25aa79219802"  # Update with your WebSocket URL

    # Create a WebSocket connection
    ws = websocket.WebSocketApp(url,
                                on_open=on_open,
                                on_message=on_message,
                                on_error=on_error,
                                on_close=on_close)

    # Run the WebSocket in a separate thread
    ws.run_forever()

    # Keep the script running for a while to receive messages
    time.sleep(10)  # Adjust as needed
    ws.close()
