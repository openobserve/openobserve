#!/usr/bin/env python3
"""
HTTP/2 Streaming Test Client for OpenObserve

This script connects to the OpenObserve HTTP/2 streaming endpoint and
processes the streaming response in real-time.

Requirements:
- Python 3.7+
- requests package: pip install requests
- requests-toolbelt package: pip install requests-toolbelt

Usage:
python test_http2_stream.py [org_id] [host]

Example:
python test_http2_stream.py default http://localhost:5080
"""

import json
import sys
import time
from datetime import datetime
import requests
from requests.exceptions import RequestException
from requests_toolbelt.utils import dump

# Default values
DEFAULT_ORG_ID = "default"
DEFAULT_HOST = "http://localhost:5080"
DEFAULT_AUTH_TOKEN = "Basic cm9vdEBleGFtcGxlLmNvbTpDb21wbGV4cGFzcyMxMjM="  # root@example.com:Complexpass#123 in base64

# ANSI color codes for pretty output
COLORS = {
    "RESET": "\033[0m",
    "RED": "\033[31m",
    "GREEN": "\033[32m",
    "YELLOW": "\033[33m",
    "BLUE": "\033[34m",
    "MAGENTA": "\033[35m",
    "CYAN": "\033[36m",
    "WHITE": "\033[37m",
    "BOLD": "\033[1m",
}

def color(text, color_name):
    """Add color to text"""
    return f"{COLORS.get(color_name, '')}{text}{COLORS['RESET']}"

def get_timestamp():
    """Return current timestamp in readable format"""
    return datetime.now().strftime("%H:%M:%S.%f")[:-3]

def make_request(org_id, host, auth_token):
    """Make an HTTP/2 streaming request to the test endpoint"""
    
    url = f"{host}/api/{org_id}/_test_http2_stream"
    
    # Prepare headers
    headers = {
        "Content-Type": "application/json",
    }
    
    if auth_token:
        headers["Authorization"] = auth_token
    
    # Prepare payload
    payload = {
        "sql": "select * from logs limit 10",
        "start_time": int(time.time()) * 1000000,
        "end_time": int(time.time()) * 1000000 + 3600000000  # 1 hour range
    }
    
    print(f"\n{color('Request Details:', 'BOLD')}")
    print(f"URL: {color(url, 'CYAN')}")
    print(f"Payload: {color(json.dumps(payload, indent=2), 'CYAN')}")
    
    try:
        # Make the streaming request
        print(f"\n{color('Connecting to streaming endpoint...', 'BOLD')}")
        
        # Stream the response
        with requests.post(url, json=payload, headers=headers, stream=True) as response:
            # Check if request was successful
            response.raise_for_status()
            
            # Process the response stream
            print(f"{color('Connected!', 'GREEN')} Starting to receive data...\n")
            print(f"{color('Timestamp', 'BOLD')} | {color('Event Type', 'BOLD')} | {color('Data', 'BOLD')}")
            print("-" * 100)
            
            total_messages = 0
            
            # Process each chunk as it arrives
            for chunk in response.iter_lines():
                if chunk:
                    total_messages += 1
                    try:
                        # Parse the JSON message
                        message = json.loads(chunk)
                        
                        # Extract relevant fields
                        event_type = message.get("event", "unknown")
                        timestamp = message.get("timestamp", 0)
                        data = message.get("data", {})
                        
                        # Determine color based on event type
                        event_color = "GREEN"
                        if event_type == "progress":
                            event_color = "BLUE"
                        elif event_type == "search_result":
                            event_color = "YELLOW"
                        elif event_type == "end":
                            event_color = "MAGENTA"
                        elif event_type == "error":
                            event_color = "RED"
                        
                        # Print the message in a readable format
                        local_time = get_timestamp()
                        print(f"{color(local_time, 'WHITE')} | " +
                              f"{color(event_type.ljust(12), event_color)} | " +
                              f"{json.dumps(data)[:80]}...")
                        
                        # Add special handling for the end event
                        if event_type == "end":
                            print(f"\n{color('Stream completed', 'MAGENTA')}")
                            break
                            
                    except json.JSONDecodeError:
                        print(f"{color(get_timestamp(), 'WHITE')} | " +
                              f"{color('ERROR'.ljust(12), 'RED')} | " +
                              f"Failed to parse JSON: {chunk}")
            
            print(f"\n{color('Summary:', 'BOLD')}")
            print(f"Total messages received: {color(str(total_messages), 'GREEN')}")
            print(f"Connection closed: {color('True', 'GREEN')}")
                
    except RequestException as e:
        print(f"\n{color('Error:', 'RED')} {e}")
        if hasattr(e, 'response') and e.response:
            print(f"Response: {e.response.text}")
        return False
        
    return True

def main():
    """Main function"""
    # Parse command line arguments
    org_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_ORG_ID
    host = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_HOST
    auth_token = DEFAULT_AUTH_TOKEN
    
    print(color("HTTP/2 Streaming Test Client for OpenObserve", "BOLD"))
    print(f"Organization ID: {color(org_id, 'CYAN')}")
    print(f"Host: {color(host, 'CYAN')}")
    
    # Make the request
    make_request(org_id, host, auth_token)

if __name__ == "__main__":
    main() 