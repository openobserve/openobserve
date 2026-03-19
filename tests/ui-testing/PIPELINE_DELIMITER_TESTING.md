# Pipeline Delimiter (stringSeparated) Testing Guide

This document provides comprehensive test documentation for the **Remote Pipeline Delimiter** feature introduced in PR #10540.

**PR Reference:** https://github.com/openobserve/openobserve/pull/10540
**Feature:** Add `stringSeparated` output format for remote pipeline destinations

---

## Feature Overview

The `stringSeparated` output format allows pipeline destinations to output data with a custom delimiter/separator between records instead of JSON or NDJSON formats.

### Available Output Formats

| Format | Value | Description |
|--------|-------|-------------|
| JSON | `json` | Standard JSON array output |
| NDJSON | `ndjson` | Newline-delimited JSON |
| NestedEvent | `nestedevent` | Splunk nested event format |
| ESBulk | `esbulk` | Elasticsearch bulk format |
| **String Separated** | `stringseparated` | Custom separator between records |

---

## API Endpoints

### Create Pipeline Destination

```
POST /api/{org_id}/alerts/destinations?module=pipeline
```

### Update Pipeline Destination

```
PUT /api/{org_id}/alerts/destinations/{destination_name}?module=pipeline
```

### Get Pipeline Destinations

```
GET /api/{org_id}/alerts/destinations?module=pipeline
```

---

## Request Payloads

### Standard Pipeline Destination (JSON format)

```json
{
    "url": "https://your-endpoint.com/api/default/stream/_json",
    "method": "post",
    "template": "",
    "headers": {
        "Content-Type": "application/json",
        "Authorization": "Basic <base64_encoded_credentials>"
    },
    "name": "my_pipeline_destination",
    "skip_tls_verify": false,
    "type": "http",
    "output_format": "json",
    "destination_type_name": "custom"
}
```

### String Separated Pipeline Destination (Delimiter format)

```json
{
    "url": "https://your-endpoint.com/api/default/stream/_json",
    "method": "post",
    "template": "",
    "headers": {
        "Content-Type": "text/plain",
        "Authorization": "Basic <base64_encoded_credentials>"
    },
    "name": "delimiter_pipeline_destination",
    "skip_tls_verify": false,
    "type": "http",
    "output_format": {
        "stringseparated": {
            "separator": ","
        }
    },
    "destination_type_name": "custom"
}
```

### ESBulk Pipeline Destination

```json
{
    "url": "https://elasticsearch-host:9200",
    "method": "post",
    "template": "",
    "headers": {
        "Content-Type": "application/json"
    },
    "name": "es_pipeline_destination",
    "skip_tls_verify": false,
    "type": "http",
    "output_format": {
        "esbulk": {
            "index": "logs"
        }
    },
    "destination_type_name": "elasticsearch"
}
```

---

## Postman Test Collection

### Test 1: Create Pipeline Destination with String Separator

**Request:**
```
POST {{base_url}}/api/default/alerts/destinations?module=pipeline
Authorization: Basic {{credentials}}
Content-Type: application/json
```

**Body:**
```json
{
    "url": "https://jsonplaceholder.typicode.com/posts",
    "method": "post",
    "template": "",
    "headers": {},
    "name": "test_delimiter_destination_comma",
    "skip_tls_verify": false,
    "type": "http",
    "output_format": {
        "stringseparated": {
            "separator": ","
        }
    },
    "destination_type_name": "custom"
}
```

**Expected Response:**
- Status: `200 OK`
- Destination created successfully

### Test 2: Create Pipeline Destination with Newline Separator

**Body:**
```json
{
    "url": "https://jsonplaceholder.typicode.com/posts",
    "method": "post",
    "template": "",
    "headers": {},
    "name": "test_delimiter_destination_newline",
    "skip_tls_verify": false,
    "type": "http",
    "output_format": {
        "stringseparated": {
            "separator": "\n"
        }
    },
    "destination_type_name": "custom"
}
```

### Test 3: Create Pipeline Destination with Pipe Separator

**Body:**
```json
{
    "url": "https://jsonplaceholder.typicode.com/posts",
    "method": "post",
    "template": "",
    "headers": {},
    "name": "test_delimiter_destination_pipe",
    "skip_tls_verify": false,
    "type": "http",
    "output_format": {
        "stringseparated": {
            "separator": "|"
        }
    },
    "destination_type_name": "custom"
}
```

### Test 4: Verify Delimiter Destination Retrieval

**Request:**
```
GET {{base_url}}/api/default/alerts/destinations/test_delimiter_destination_comma?module=pipeline
Authorization: Basic {{credentials}}
```

**Expected Response:**
```json
{
    "name": "test_delimiter_destination_comma",
    "url": "https://jsonplaceholder.typicode.com/posts",
    "method": "post",
    "output_format": {
        "stringseparated": {
            "separator": ","
        }
    },
    ...
}
```

### Test 5: Update Delimiter Destination

**Request:**
```
PUT {{base_url}}/api/default/alerts/destinations/test_delimiter_destination_comma?module=pipeline
Authorization: Basic {{credentials}}
Content-Type: application/json
```

**Body:**
```json
{
    "url": "https://jsonplaceholder.typicode.com/posts",
    "method": "post",
    "template": "",
    "headers": {},
    "name": "test_delimiter_destination_comma",
    "skip_tls_verify": false,
    "type": "http",
    "output_format": {
        "stringseparated": {
            "separator": ";"
        }
    },
    "destination_type_name": "custom"
}
```

### Test 6: Delete Delimiter Destination

**Request:**
```
DELETE {{base_url}}/api/default/alerts/destinations/test_delimiter_destination_comma?module=pipeline
Authorization: Basic {{credentials}}
```

**Expected Response:**
- Status: `200 OK`

---

## Python Test Code

### test_pipeline_delimiter.py

```python
import pytest
import time
from requests.auth import HTTPBasicAuth

@pytest.mark.parametrize(
    "destination_name, separator, expected_status",
    [
        ("delimiter_dest_comma", ",", 200),
        ("delimiter_dest_pipe", "|", 200),
        ("delimiter_dest_semicolon", ";", 200),
        ("delimiter_dest_tab", "\t", 200),
        ("delimiter_dest_newline", "\n", 200),
        ("delimiter_dest_custom", "|||", 200),
    ]
)
def test_create_pipeline_destination_with_delimiter(create_session, base_url, destination_name, separator, expected_status):
    """Test creating pipeline destinations with different string separators."""
    session = create_session
    url = base_url
    org_id = "default"

    # Payload for delimiter pipeline destination
    payload = {
        "url": "https://jsonplaceholder.typicode.com/posts",
        "method": "post",
        "template": "",
        "headers": {},
        "name": destination_name,
        "skip_tls_verify": False,
        "type": "http",
        "output_format": {
            "stringseparated": {
                "separator": separator
            }
        },
        "destination_type_name": "custom"
    }

    # Create destination
    resp_create = session.post(
        f"{url}api/{org_id}/alerts/destinations?module=pipeline",
        json=payload
    )

    assert resp_create.status_code == expected_status, \
        f"Expected {expected_status} but got {resp_create.status_code}: {resp_create.text}"

    print(f"Created delimiter destination: {destination_name} with separator: {repr(separator)}")

    # Verify the destination was created correctly
    resp_get = session.get(f"{url}api/{org_id}/alerts/destinations/{destination_name}?module=pipeline")
    assert resp_get.status_code == 200, f"Failed to retrieve destination: {resp_get.text}"

    destination_data = resp_get.json()

    # Verify output_format structure
    assert "output_format" in destination_data, "output_format not found in response"
    assert isinstance(destination_data["output_format"], dict), "output_format should be a dict for stringseparated"
    assert "stringseparated" in destination_data["output_format"], "stringseparated key not found"
    assert destination_data["output_format"]["stringseparated"]["separator"] == separator, \
        f"Separator mismatch: expected {repr(separator)}, got {repr(destination_data['output_format']['stringseparated']['separator'])}"

    print(f"Verified destination {destination_name} has correct separator: {repr(separator)}")

    # Cleanup
    resp_delete = session.delete(f"{url}api/{org_id}/alerts/destinations/{destination_name}?module=pipeline")
    assert resp_delete.status_code == 200, f"Failed to delete destination: {resp_delete.text}"

    print(f"Cleaned up destination: {destination_name}")


def test_pipeline_with_delimiter_destination_e2e(create_session, base_url):
    """End-to-end test: Create pipeline with delimiter destination and verify data flow."""
    session = create_session
    url = base_url
    org_id = "default"

    # Step 1: Create pipeline destination with delimiter
    destination_name = f"e2e_delimiter_dest_{int(time.time())}"
    destination_payload = {
        "url": "https://your-receiver-endpoint.com/receive",  # Replace with actual endpoint
        "method": "post",
        "template": "",
        "headers": {},
        "name": destination_name,
        "skip_tls_verify": True,
        "type": "http",
        "output_format": {
            "stringseparated": {
                "separator": ","
            }
        },
        "destination_type_name": "custom"
    }

    resp_create_dest = session.post(
        f"{url}api/{org_id}/alerts/destinations?module=pipeline",
        json=destination_payload
    )
    assert resp_create_dest.status_code == 200, f"Failed to create destination: {resp_create_dest.text}"
    print(f"Created destination: {destination_name}")

    # Step 2: Create pipeline using the destination
    pipeline_name = f"e2e_delimiter_pipeline_{int(time.time())}"
    stream_name = "delimiter_test_stream"

    pipeline_payload = {
        "name": pipeline_name,
        "description": "E2E test pipeline with delimiter destination",
        "source": {"source_type": "realtime"},
        "nodes": [
            {
                "id": "input-node",
                "type": "input",
                "data": {
                    "node_type": "stream",
                    "stream_name": stream_name,
                    "stream_type": "logs",
                    "org_id": org_id,
                },
                "position": {"x": 100, "y": 100},
                "io_type": "input",
            },
            {
                "id": "output-node",
                "type": "output",
                "data": {
                    "node_type": "destination",
                    "destination_name": destination_name,
                },
                "position": {"x": 300, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [
            {
                "id": "edge-1",
                "source": "input-node",
                "target": "output-node",
            }
        ],
        "org": org_id,
    }

    resp_create_pipeline = session.post(
        f"{url}api/{org_id}/pipelines",
        json=pipeline_payload
    )
    print(f"Pipeline creation response: {resp_create_pipeline.status_code} - {resp_create_pipeline.text}")

    # Get pipeline ID
    resp_list = session.get(f"{url}api/{org_id}/pipelines")
    pipelines = resp_list.json().get("list", [])
    pipeline_id = next((p["pipeline_id"] for p in pipelines if p["name"] == pipeline_name), None)

    if pipeline_id:
        # Enable pipeline
        resp_enable = session.put(f"{url}api/{org_id}/pipelines/{pipeline_id}/enable?value=true")
        print(f"Pipeline enabled: {resp_enable.status_code}")

        # Step 3: Ingest test data
        test_data = [
            {"message": "Test log 1", "level": "info"},
            {"message": "Test log 2", "level": "warn"},
            {"message": "Test log 3", "level": "error"},
        ]

        resp_ingest = session.post(f"{url}api/{org_id}/{stream_name}/_json", json=test_data)
        print(f"Data ingestion: {resp_ingest.status_code}")

        # Wait for processing
        time.sleep(10)

        # Cleanup
        resp_delete_pipeline = session.delete(f"{url}api/{org_id}/pipelines/{pipeline_id}")
        print(f"Pipeline deleted: {resp_delete_pipeline.status_code}")

    # Cleanup destination
    resp_delete_dest = session.delete(f"{url}api/{org_id}/alerts/destinations/{destination_name}?module=pipeline")
    print(f"Destination deleted: {resp_delete_dest.status_code}")


def test_delimiter_destination_update(create_session, base_url):
    """Test updating a delimiter destination's separator value."""
    session = create_session
    url = base_url
    org_id = "default"

    destination_name = "update_test_delimiter_dest"

    # Create with comma separator
    create_payload = {
        "url": "https://jsonplaceholder.typicode.com/posts",
        "method": "post",
        "template": "",
        "headers": {},
        "name": destination_name,
        "skip_tls_verify": False,
        "type": "http",
        "output_format": {
            "stringseparated": {
                "separator": ","
            }
        },
        "destination_type_name": "custom"
    }

    resp_create = session.post(
        f"{url}api/{org_id}/alerts/destinations?module=pipeline",
        json=create_payload
    )
    assert resp_create.status_code == 200

    # Update to pipe separator
    update_payload = create_payload.copy()
    update_payload["output_format"] = {
        "stringseparated": {
            "separator": "|"
        }
    }

    resp_update = session.put(
        f"{url}api/{org_id}/alerts/destinations/{destination_name}?module=pipeline",
        json=update_payload
    )
    assert resp_update.status_code == 200, f"Update failed: {resp_update.text}"

    # Verify update
    resp_get = session.get(f"{url}api/{org_id}/alerts/destinations/{destination_name}?module=pipeline")
    assert resp_get.status_code == 200

    data = resp_get.json()
    assert data["output_format"]["stringseparated"]["separator"] == "|"
    print("Successfully updated separator from ',' to '|'")

    # Cleanup
    session.delete(f"{url}api/{org_id}/alerts/destinations/{destination_name}?module=pipeline")
```

---

## Test Scenarios Checklist

### Positive Test Cases

- [ ] Create delimiter destination with comma separator
- [ ] Create delimiter destination with pipe separator
- [ ] Create delimiter destination with semicolon separator
- [ ] Create delimiter destination with tab separator
- [ ] Create delimiter destination with newline separator
- [ ] Create delimiter destination with multi-character separator
- [ ] Update delimiter destination separator value
- [ ] Retrieve delimiter destination and verify output_format structure
- [ ] Delete delimiter destination
- [ ] Create pipeline using delimiter destination
- [ ] Verify data flows through pipeline with correct delimiter formatting

### Negative Test Cases

- [ ] Create delimiter destination with empty separator (should fail or use default)
- [ ] Create delimiter destination without stringseparated object (should fail validation)
- [ ] Update destination from json format to stringseparated
- [ ] Verify error handling for invalid separator values

### Edge Cases

- [ ] Very long separator string
- [ ] Unicode characters in separator
- [ ] Special characters (quotes, backslashes) in separator
- [ ] Switching between output formats (json -> stringseparated -> json)

---

## Environment Variables for Testing

```bash
# Main environment
export BASE_URL="https://main.openobserve.ai/"
export ZO_ROOT_USER_EMAIL="your_email@example.com"
export ZO_ROOT_USER_PASSWORD="your_password"
export ORG_ID="default"
```

---

## Verification Steps

1. **Deploy PR #10540 to main environment**
2. **Run API tests** using Postman collection or pytest
3. **Verify UI** - Check that destination form shows "String Separated" option
4. **Verify output format** - Ensure separator field appears when stringseparated is selected
5. **Test pipeline execution** - Verify data is formatted with correct delimiter
6. **Update ENV_TESTING_TRACKER.md** - Mark feature as verified

---

## Related Files

| File | Description |
|------|-------------|
| `web/src/components/pipeline/NodeForm/CreateDestinationForm.vue` | UI form for creating destinations |
| `src/config/src/meta/destinations.rs` | Backend destination configuration |
| `tests/api-testing/tests/pages/destination_page.py` | Python test helpers |
| `tests/api-testing/tests/test_pipeline.py` | Existing pipeline tests |

---

## Notes

- The `stringseparated` output format is only available for `custom` destination type
- When `output_format` is `stringseparated`, the payload structure changes from a string to an object
- The separator field is required when using stringseparated format
- PR also includes cherry-pick to main: PR #10555

---

---

## Automated Testing

### Quick Test Script

Location: `tests/api-testing/tests/test_pipeline_output_formats.py`

**Run on any environment:**

```bash
# Set environment variables
export ZO_ROOT_USER_EMAIL="your_email"
export ZO_ROOT_USER_PASSWORD="your_password"
export ZO_BASE_URL="https://your-env.zinclabs.dev/"
export ORGNAME="default"

# Run quick test (creates webhook, tests all 5 formats, shows results)
python tests/api-testing/tests/test_pipeline_output_formats.py

# Run with pytest (individual test per format)
python tests/api-testing/tests/test_pipeline_output_formats.py --pytest
```

**What the test does:**
1. Creates a webhook.site token for capturing output
2. Creates 5 streams with test data (one per format)
3. Creates 5 destinations with different output formats
4. Creates 5 scheduled pipelines (1 min frequency)
5. Waits for all pipelines to trigger
6. Displays all output formats side-by-side
7. Verifies each format is correct
8. Cleans up all test resources

**Supported formats:**
- `json` - JSON array `[{...},{...}]`
- `ndjson` - Newline-delimited `{...}\n{...}`
- `pipe` - Pipe-separated `{...}|{...}`
- `comma` - Comma-separated `{...},{...}`
- `semicolon` - Semicolon-separated `{...};{...}`

---

*Last Updated: 2025-03-02*
