"""
Ingest minimal RUM performance data to create _rumdata stream.

This enables the RUM feature in the UI so that /rum/errors page can load.
"""

import requests
import base64
import time
import os

# Get config from environment
BASE_URL = os.getenv('ZO_BASE_URL', 'http://localhost:5080')
EMAIL = os.getenv('ZO_ROOT_USER_EMAIL', 'root@example.com')
PASSWORD = os.getenv('ZO_ROOT_USER_PASSWORD', 'Complexpass#123')
ORG_ID = os.getenv('ORGNAME', 'default')

# Create session with Basic Auth
api_session = requests.Session()
basic_auth = base64.b64encode(f"{EMAIL}:{PASSWORD}".encode()).decode()
api_session.headers.update({"Authorization": f"Basic {basic_auth}"})

now = int(time.time() * 1000)

# Minimal RUM performance data
rum_performance = [
    {
        "date": now,
        "type": "view",
        "view": {
            "id": "init-view-001",
            "url": "http://localhost:8089/",
            "name": "Initial View",
            "loading_time": 100,
            "time_spent": 1000
        },
        "service": "o2-sourcemap-test-app",
        "version": "1.0.0-init",
        "session": {
            "id": "init-session-001",
            "type": "user"
        },
        "application": {
            "id": "o2-sourcemap-test-app"
        }
    }
]

def ingest_rum_performance():
    """Ingest RUM performance data to create _rumdata stream."""

    print(f"Ingesting RUM performance data to {BASE_URL}")

    url = f"{BASE_URL}/api/{ORG_ID}/_rumdata/_json"

    response = api_session.post(
        url,
        json=rum_performance,
        headers={'Content-Type': 'application/json'}
    )

    if response.status_code in [200, 201]:
        print(f"✅ Successfully ingested RUM performance data")
        print(f"   Status: {response.status_code}")
        print(f"   Stream: _rumdata")
        print(f"   RUM feature should now be enabled in UI")
        return True
    else:
        print(f"❌ Failed to ingest RUM performance data")
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.text}")
        return False

if __name__ == "__main__":
    success = ingest_rum_performance()
    exit(0 if success else 1)
