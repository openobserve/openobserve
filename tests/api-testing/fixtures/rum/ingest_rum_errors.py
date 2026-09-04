"""
Ingest synthetic RUM error data for sourcemap UI testing.

This script injects RUM error events with minified stacktraces that can be
resolved using uploaded sourcemaps. This allows UI tests to run without
needing to build and serve the test app.
"""

import requests
import base64
import time
import json
import os

# Get config from environment
BASE_URL = os.getenv('ZO_BASE_URL', 'http://localhost:5080')
EMAIL = os.getenv('ZO_ROOT_USER_EMAIL', 'root@example.com')
PASSWORD = os.getenv('ZO_ROOT_USER_PASSWORD', 'Complexpass#123')
ORG_ID = os.getenv('ORGNAME', 'default')


def ingest_rum_errors():
    """Ingest RUM error events to OpenObserve."""

    # Create session with Basic Auth for API calls
    api_session = requests.Session()
    basic_auth = base64.b64encode(f"{EMAIL}:{PASSWORD}".encode()).decode()
    api_session.headers.update({"Authorization": f"Basic {basic_auth}"})

    # Fetch RUM token for ingestion
    print("Fetching RUM token...")
    rum_token_response = api_session.get(f"{BASE_URL}/api/{ORG_ID}/rumtoken")
    if rum_token_response.status_code != 200:
        print(f"❌ Failed to fetch RUM token: {rum_token_response.status_code}")
        rum_token = None
    else:
        rum_token_data = rum_token_response.json()
        rum_token = rum_token_data.get('data', {}).get('rum_token') or rum_token_data.get('rum_token')
        if rum_token:
            print(f"✅ RUM token fetched successfully")
        else:
            print(f"⚠️  RUM token is empty, response: {rum_token_data}")

    # Create RUM ingestion session with RUM token
    session = requests.Session()
    if rum_token:
        # RUM token goes in Authorization header as Bearer token
        session.headers.update({"Authorization": f"Bearer {rum_token}"})

    # Current timestamp
    now = int(time.time() * 1000)

    # Sample RUM error events with minified stacktraces
    # These match the format that the RUM SDK sends
    rum_errors = [
        {
            "date": now - 60000,  # 1 minute ago
            "type": "error",
            "error": {
                "message": "TypeError: Cannot read property 'name' of undefined",
                "type": "TypeError",
                "stack": "TypeError: Cannot read property 'name' of undefined\n    at Ht @ http://localhost:8089/assets/main.87e94092.js:1:2345\n    at onClick @ http://localhost:8089/assets/main.87e94092.js:1:3456",
                "source": "source",
                "is_crash": False,
                "resource": {
                    "url": "http://localhost:8089/"
                }
            },
            "service": "o2-sourcemap-test-app",
            "version": "1.0.0-api-test",
            "session": {
                "id": "test-session-001"
            },
            "view": {
                "id": "test-view-001",
                "referrer": "",
                "url": "http://localhost:8089/"
            },
            "application": {
                "id": "o2-sourcemap-test-app"
            },
            "context": {
                "browser": {
                    "name": "Chrome",
                    "version": "120.0.0"
                },
                "os": {
                    "name": "Mac OS",
                    "version": "14.0"
                }
            }
        },
        {
            "date": now - 120000,  # 2 minutes ago
            "type": "error",
            "error": {
                "message": "ReferenceError: undefinedVariable is not defined",
                "type": "ReferenceError",
                "stack": "ReferenceError: undefinedVariable is not defined\n    at triggerReferenceError @ http://localhost:8089/assets/main.87e94092.js:1:4567\n    at onClick @ http://localhost:8089/assets/main.87e94092.js:1:5678",
                "source": "source",
                "is_crash": False,
                "resource": {
                    "url": "http://localhost:8089/"
                }
            },
            "service": "o2-sourcemap-test-app",
            "version": "1.0.0-api-test",
            "session": {
                "id": "test-session-002"
            },
            "view": {
                "id": "test-view-002",
                "referrer": "",
                "url": "http://localhost:8089/"
            },
            "application": {
                "id": "o2-sourcemap-test-app"
            },
            "context": {
                "browser": {
                    "name": "Firefox",
                    "version": "119.0"
                },
                "os": {
                    "name": "Windows",
                    "version": "11"
                }
            }
        },
        {
            "date": now - 180000,  # 3 minutes ago
            "type": "error",
            "error": {
                "message": "RangeError: Maximum call stack size exceeded",
                "type": "RangeError",
                "stack": "RangeError: Maximum call stack size exceeded\n    at recursiveFunction @ http://localhost:8089/assets/main.87e94092.js:1:6789\n    at recursiveFunction @ http://localhost:8089/assets/main.87e94092.js:1:6789",
                "source": "source",
                "is_crash": False,
                "resource": {
                    "url": "http://localhost:8089/"
                }
            },
            "service": "o2-sourcemap-test-app",
            "version": "1.0.0-api-test",
            "session": {
                "id": "test-session-003"
            },
            "view": {
                "id": "test-view-003",
                "referrer": "",
                "url": "http://localhost:8089/"
            },
            "application": {
                "id": "o2-sourcemap-test-app"
            },
            "context": {
                "browser": {
                    "name": "Safari",
                    "version": "17.0"
                },
                "os": {
                    "name": "Mac OS",
                    "version": "14.0"
                }
            }
        }
    ]

    print(f"\nIngesting {len(rum_errors)} RUM error events to {BASE_URL}")

    # Use _rumdata stream (not _rumlog) because the UI queries _rumdata for errors
    # The UI looks for records where type='error' in _rumdata stream
    url = f"{BASE_URL}/api/{ORG_ID}/_rumdata/_json"

    # Send as JSON array
    response = api_session.post(
        url,
        json=rum_errors,
        headers={'Content-Type': 'application/json'}
    )

    if response.status_code in [200, 201]:
        print(f"✅ Successfully ingested {len(rum_errors)} RUM errors")
        print(f"   Status: {response.status_code}")
        print(f"   Stream: _rumdata (errors with type='error')")
        print(f"   Errors can be viewed in RUM Error Tracking page")
        return True
    else:
        print(f"❌ Failed to ingest RUM errors")
        print(f"   Status: {response.status_code}")
        print(f"   Response: {response.text}")
        return False


if __name__ == "__main__":
    success = ingest_rum_errors()
    exit(0 if success else 1)
