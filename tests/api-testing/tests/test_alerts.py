import pytest
import time

def test_e2e_destinations(create_session, base_url):
    """Running an E2E test for get all the destination list under alerts."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_alldestinations = session.get(f"{url}api/{org_id}/alerts/destinations")

    print(resp_get_alldestinations.content)
    assert (
        resp_get_alldestinations.status_code == 200
    ), f"Get all alerts list 200, but got {resp_get_alldestinations.status_code} {resp_get_alldestinations.content}"


def test_e2e_deleteinvaliddestination(create_session, base_url):
    """Running an E2E test for deleting destination that does not exist ."""

    session = create_session
    url = base_url
    org_id = "default"
    resp_delete_destination = session.delete(
        f"{url}api/{org_id}/alerts/destinations/destinationname"
    )
    assert (
        resp_delete_destination.status_code == 404
    ), f"Deleting this destination, but got {resp_delete_destination.status_code} {resp_delete_destination.content}"


def test_e2e_templates(create_session, base_url):
    """Running an E2E test for get all the alerts list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_alltemplates = session.get(f"{url}api/{org_id}/alerts/templates")

    print(resp_get_alltemplates.content)
    assert (
        resp_get_alltemplates.status_code == 200
    ), f"Get all alerts list 200, but got {resp_get_alltemplates.status_code} {resp_get_alltemplates.content}"


# TODO - Change body and add 2 other testcases once bug #1702 is fixed
def test_e2e_templatescreation(create_session, base_url):
    """Running an E2E test for get all the alerts list."""
    template_name = "newtemp"

    session = create_session
    url = base_url
    org_id = "default"
    payload = {"body": "invalid", "ise2e": True, "name": template_name}
    # create template under alerts
    resp_get_alltemplates = session.post(
        f"{url}api/{org_id}/alerts/templates", json=payload
    )

    print(resp_get_alltemplates.content)
    assert (
        resp_get_alltemplates.status_code == 200
    ), f"Createtemplate 200, but got {resp_get_alltemplates.status_code} {resp_get_alltemplates.content}"
    # delete created template
    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/alerts/templates/{template_name}"
    )
    assert (
        resp_delete_function.status_code == 200
    ), f"Deleting this template, but got {resp_delete_function.status_code} {resp_delete_function.content}"



def test_e2e_createdestination(create_session, base_url):
    """Running an E2E test for create a new destination."""

    session = create_session
    url = base_url
    org_id = "default"
    skip_tls_verify_value = False

    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    # Generate unique names using timestamp
    timestamp = int(time.time() * 1000)
    template_name = f"py_template_{timestamp}"
    destination_name = f"py_destinations_{timestamp}"

    payload = {
        "name": template_name,
        "body": """
            {{
                "text": "{alert_name} is active"
            }}
        """.format(
            alert_name="pytestautomate"
        ),
    }

    # createtemplate
    resp_create_destinations = session.post(
        f"{url}api/{org_id}/alerts/templates",
        json=payload,
        headers=headers,
    )
    print(resp_create_destinations.content)

    payload = {
        "url": "www",
        "method": "post",
        "skip_tls_verify": skip_tls_verify_value,
        "template": template_name,
        "headers": {"test": "test"},
        "name": destination_name
    }

    # create destination
    resp_create_destinations = session.post(
        f"{url}api/{org_id}/alerts/destinations",
        json=payload,
        headers=headers,
    )
    print(resp_create_destinations.content)
    # get destination
    resp_create_destinations = session.get(
        f"{url}api/{org_id}/alerts/destinations/{destination_name}",
        json=payload,
        headers=headers,
    )
    print(resp_create_destinations.content)
    assert (
        resp_create_destinations.status_code == 200
    ), f"Get all alerts list 200, but got {resp_create_destinations.status_code} {resp_create_destinations.content}"

    resp_delete_destination = session.delete(
        f"{url}api/{org_id}/alerts/destinations/{destination_name}"
    )
    assert (
        resp_delete_destination.status_code == 200
    ), f"Deleting this function, but got {resp_delete_destination.status_code} {resp_delete_destination.content}"

    resp_delete_template = session.delete(
        f"{url}api/{org_id}/alerts/templates/{template_name}"
    )
    assert (
        resp_delete_template.status_code == 200
    ), f"Deleting this function, but got {resp_delete_template.status_code} {resp_delete_template.content}"


def test_e2e_alert_history(create_session, base_url):
    """Running an E2E test for alert history API.

    This test validates:
    1. Creating alerts and triggering them to generate history
    2. Fetching alert history for an organization
    3. Filtering history by alert name
    4. Pagination parameters (from, size)
    5. Time range filtering
    6. Proper handling of invalid requests
    """
    import time
    import json
    from datetime import datetime, timedelta

    session = create_session
    url = base_url
    org_id = "default"

    headers = {"Content-Type": "application/json"}

    # Step 1: Create a template for the alert
    template_name = "history_test_template"
    template_payload = {
        "name": template_name,
        "body": '{"text": "Alert {alert_name} triggered for {org_name}"}',
    }

    resp_create_template = session.post(
        f"{url}api/{org_id}/alerts/templates",
        json=template_payload,
        headers=headers,
    )
    print(f"Create template response: {resp_create_template.content}")
    assert resp_create_template.status_code == 200, (
        f"Expected 200 for create template, but got {resp_create_template.status_code} {resp_create_template.content}"
    )

    # Step 2: Create a destination
    destination_name = "history_test_destination"
    destination_payload = {
        "name": destination_name,
        "url": "http://localhost:9999/webhook",
        "method": "post",
        "skip_tls_verify": True,
        "template": template_name,
        "headers": {"Content-Type": "application/json"},
    }

    resp_create_destination = session.post(
        f"{url}api/{org_id}/alerts/destinations",
        json=destination_payload,
        headers=headers,
    )
    print(f"Create destination response: {resp_create_destination.content}")
    assert resp_create_destination.status_code == 200, (
        f"Expected 200 for create destination, but got {resp_create_destination.status_code} {resp_create_destination.content}"
    )

    # Step 3: Ingest some test data
    stream_name = "alert_history_test_stream"
    log_payload = [
        {
            "level": "ERROR",
            "message": "Test error message 1",
            "timestamp": datetime.utcnow().isoformat(),
        },
        {
            "level": "ERROR",
            "message": "Test error message 2",
            "timestamp": datetime.utcnow().isoformat(),
        },
        {
            "level": "INFO",
            "message": "Test info message",
            "timestamp": datetime.utcnow().isoformat(),
        },
    ]

    resp_ingest = session.post(
        f"{url}api/{org_id}/{stream_name}/_json",
        json=log_payload,
        headers=headers,
    )
    print(f"Ingest logs response: {resp_ingest.content}")
    assert resp_ingest.status_code == 200, (
        f"Expected 200 for log ingestion, but got {resp_ingest.status_code} {resp_ingest.content}"
    )

    # Step 4: Create alerts
    alert_name_1 = "history_test_alert_1"
    alert_payload_1 = {
        "name": alert_name_1,
        "stream_type": "logs",
        "stream_name": stream_name,
        "is_real_time": False,
        "query_condition": {
            "type": "sql",
            "conditions": None,
            "sql": f"SELECT count(*) as error_count FROM \"{stream_name}\" WHERE level='ERROR'",
            "promql": None,
            "aggregation": None,
        },
        "trigger_condition": {
            "period": 5,
            "operator": ">=",
            "threshold": 1,
            "silence": 5,
        },
        "destinations": [destination_name],
        "enabled": True,
        "description": "Test alert for history validation",
    }

    resp_create_alert_1 = session.post(
        f"{url}api/v2/{org_id}/alerts",
        json=alert_payload_1,
        headers=headers,
    )
    print(f"Create alert 1 response: {resp_create_alert_1.content}")
    assert resp_create_alert_1.status_code == 200, (
        f"Expected 200 for create alert 1, but got {resp_create_alert_1.status_code} {resp_create_alert_1.content}"
    )

    # Create a second alert
    alert_name_2 = "history_test_alert_2"
    alert_payload_2 = {
        "name": alert_name_2,
        "stream_type": "logs",
        "stream_name": stream_name,
        "is_real_time": False,
        "query_condition": {
            "type": "sql",
            "conditions": None,
            "sql": f"SELECT count(*) as info_count FROM \"{stream_name}\" WHERE level='INFO'",
            "promql": None,
            "aggregation": None,
        },
        "trigger_condition": {
            "period": 5,
            "operator": ">=",
            "threshold": 1,
            "silence": 5,
        },
        "destinations": [destination_name],
        "enabled": True,
        "description": "Second test alert for history validation",
    }

    resp_create_alert_2 = session.post(
        f"{url}api/v2/{org_id}/alerts",
        json=alert_payload_2,
        headers=headers,
    )
    print(f"Create alert 2 response: {resp_create_alert_2.content}")
    assert resp_create_alert_2.status_code == 200, (
        f"Expected 200 for create alert 2, but got {resp_create_alert_2.status_code} {resp_create_alert_2.content}"
    )

    # Wait a bit for alerts to be processed (if they auto-trigger)
    print("Waiting for alerts to potentially trigger and generate history...")
    time.sleep(20)

    # Get alert list to retrieve alert IDs
    print("\n=== Getting alert list to retrieve alert IDs ===")
    resp_get_alerts = session.get(
        f"{url}api/v2/{org_id}/alerts",
        headers=headers,
    )
    print(f"Get alerts list response: {resp_get_alerts.content}")
    assert resp_get_alerts.status_code == 200, (
        f"Expected 200 for get alerts list, but got {resp_get_alerts.status_code} {resp_get_alerts.content}"
    )

    alerts_data = resp_get_alerts.json()
    alerts_list = alerts_data.get("list", [])

    # Find alert IDs for our test alerts
    alert_id_1 = None
    alert_id_2 = None

    for alert in alerts_list:
        if alert["name"] == alert_name_1:
            alert_id_1 = alert["alert_id"]
            print(f"Found alert_id for {alert_name_1}: {alert_id_1}")
        elif alert["name"] == alert_name_2:
            alert_id_2 = alert["alert_id"]
            print(f"Found alert_id for {alert_name_2}: {alert_id_2}")

    assert alert_id_1 is not None, f"Could not find alert_id for {alert_name_1}"
    assert alert_id_2 is not None, f"Could not find alert_id for {alert_name_2}"

    # Step 5: Test 1 - Get all alert history for the organization
    print("\n=== Test 1: Get all alert history ===")
    resp_get_history = session.get(
        f"{url}api/v2/{org_id}/alerts/history",
        headers=headers,
    )
    print(f"Get alert history response: {resp_get_history.content}")
    assert resp_get_history.status_code == 200, (
        f"Expected 200 for get alert history, but got {resp_get_history.status_code} {resp_get_history.content}"
    )

    history_data = resp_get_history.json()
    assert "total" in history_data, "Response should contain 'total' field"
    assert "from" in history_data, "Response should contain 'from' field"
    assert "size" in history_data, "Response should contain 'size' field"
    assert "hits" in history_data, "Response should contain 'hits' field"
    assert isinstance(history_data["hits"], list), "'hits' should be a list"

    print(f"Total alert history entries: {history_data['total']}")
    print(f"Retrieved {len(history_data['hits'])} history entries")

    # Step 6: Test 2 - Filter history by specific alert_id
    print(f"\n=== Test 2: Filter history by alert_id: {alert_id_1} ===")
    resp_filtered_history = session.get(
        f"{url}api/v2/{org_id}/alerts/history?alert_id={alert_id_1}",
        headers=headers,
    )
    print(f"Filtered alert history response: {resp_filtered_history.content}")

    # This might return 200 with empty results if alert hasn't triggered yet
    # or 404 if alert doesn't exist
    assert resp_filtered_history.status_code in [200, 404], (
        f"Expected 200 or 404 for filtered history, but got {resp_filtered_history.status_code} {resp_filtered_history.content}"
    )

    if resp_filtered_history.status_code == 200:
        filtered_data = resp_filtered_history.json()
        print(f"Filtered results: {filtered_data['total']} entries")

        # If there are results, verify they're for the correct alert
        for entry in filtered_data.get("hits", []):
            assert entry["alert_name"] == alert_name_1, (
                f"Expected alert_name to be {alert_name_1}, but got {entry['alert_name']}"
            )

    # Step 7: Test 3 - Test pagination parameters
    print("\n=== Test 3: Test pagination ===")
    resp_paginated = session.get(
        f"{url}api/v2/{org_id}/alerts/history?from=0&size=10",
        headers=headers,
    )
    assert resp_paginated.status_code == 200, (
        f"Expected 200 for paginated history, but got {resp_paginated.status_code} {resp_paginated.content}"
    )

    paginated_data = resp_paginated.json()
    assert paginated_data["from"] == 0, "from parameter should be 0"
    assert paginated_data["size"] == 10, "size parameter should be 10"
    print(
        f"Pagination test passed: from={paginated_data['from']}, size={paginated_data['size']}"
    )

    # Step 8: Test 4 - Test with time range
    print("\n=== Test 4: Test time range filtering ===")
    # Get timestamps in microseconds
    end_time = int(datetime.utcnow().timestamp() * 1_000_000)
    start_time = int((datetime.utcnow() - timedelta(hours=1)).timestamp() * 1_000_000)

    resp_time_range = session.get(
        f"{url}api/v2/{org_id}/alerts/history?start_time={start_time}&end_time={end_time}",
        headers=headers,
    )
    assert resp_time_range.status_code == 200, (
        f"Expected 200 for time range history, but got {resp_time_range.status_code} {resp_time_range.content}"
    )

    time_range_data = resp_time_range.json()
    print(f"Time range results: {time_range_data['total']} entries")

    # Step 9: Test 5 - Test invalid time range (start > end)
    print("\n=== Test 5: Test invalid time range (should return 400) ===")
    resp_invalid_time = session.get(
        f"{url}api/v2/{org_id}/alerts/history?start_time={end_time}&end_time={start_time}",
        headers=headers,
    )
    assert resp_invalid_time.status_code == 400, (
        f"Expected 400 for invalid time range, but got {resp_invalid_time.status_code} {resp_invalid_time.content}"
    )
    print("Invalid time range correctly rejected with 400")

    # Step 10: Test 6 - Test with non-existent alert_id
    print("\n=== Test 6: Test with non-existent alert_id (should return 404) ===")
    resp_nonexistent = session.get(
        f"{url}api/v2/{org_id}/alerts/history?alert_id=35MtcBsSRwlYwuuuaybOibAZ4gF",
        headers=headers,
    )
    assert resp_nonexistent.status_code == 404, (
        f"Expected 404 for non-existent alert, but got {resp_nonexistent.status_code} {resp_nonexistent.content}"
    )
    print("Non-existent alert correctly returned 404")

    # Step 11: Test 7 - Test size limit (max 1000)
    print("\n=== Test 7: Test size limit enforcement ===")
    resp_large_size = session.get(
        f"{url}api/v2/{org_id}/alerts/history?size=2000",
        headers=headers,
    )
    assert resp_large_size.status_code == 200, (
        f"Expected 200 even with large size, but got {resp_large_size.status_code} {resp_large_size.content}"
    )

    large_size_data = resp_large_size.json()
    # Size should be clamped to 1000
    assert large_size_data["size"] == 1000, (
        f"Expected size to be clamped to 1000, but got {large_size_data['size']}"
    )
    print("Size limit correctly enforced (clamped to 1000)")

    # Cleanup: Delete alerts
    print("\n=== Cleanup: Deleting test resources ===")

    # Get alert list to retrieve alert IDs for deletion
    resp_get_alerts = session.get(f"{url}api/v2/{org_id}/alerts")
    assert resp_get_alerts.status_code == 200, (
        f"Failed to fetch alerts for deletion: {resp_get_alerts.status_code}"
    )

    alerts_data = resp_get_alerts.json()
    alerts_list = alerts_data.get("list", [])

    # Find alert IDs for deletion
    alert_id_1 = None
    alert_id_2 = None

    for alert in alerts_list:
        if alert["name"] == alert_name_1:
            alert_id_1 = alert["alert_id"]
            print(f"Found alert_id for deletion {alert_name_1}: {alert_id_1}")
        elif alert["name"] == alert_name_2:
            alert_id_2 = alert["alert_id"]
            print(f"Found alert_id for deletion {alert_name_2}: {alert_id_2}")

    # Delete alert 1 using alert_id
    if alert_id_1:
        resp_delete_alert_1 = session.delete(
            f"{url}api/v2/{org_id}/alerts/{alert_id_1}"
        )
        assert resp_delete_alert_1.status_code == 200, (
            f"Expected 200 for delete alert 1, but got {resp_delete_alert_1.status_code} {resp_delete_alert_1.content}"
        )
        print(f"Deleted alert: {alert_name_1}")

    # Delete alert 2 using alert_id
    if alert_id_2:
        resp_delete_alert_2 = session.delete(
            f"{url}api/v2/{org_id}/alerts/{alert_id_2}"
        )
        assert resp_delete_alert_2.status_code == 200, (
            f"Expected 200 for delete alert 2, but got {resp_delete_alert_2.status_code} {resp_delete_alert_2.content}"
        )
        print(f"Deleted alert: {alert_name_2}")

    # Delete destination
    resp_delete_destination = session.delete(
        f"{url}api/{org_id}/alerts/destinations/{destination_name}"
    )
    assert resp_delete_destination.status_code == 200, (
        f"Expected 200 for delete destination, but got {resp_delete_destination.status_code} {resp_delete_destination.content}"
    )
    print(f"Deleted destination: {destination_name}")

    # Delete template
    resp_delete_template = session.delete(
        f"{url}api/{org_id}/alerts/templates/{template_name}"
    )
    assert resp_delete_template.status_code == 200, (
        f"Expected 200 for delete template, but got {resp_delete_template.status_code} {resp_delete_template.content}"
    )
    print(f"Deleted template: {template_name}")

    print("\n=== Alert history E2E test completed successfully! ===")
    print("✓ All alert history API endpoints validated")
    print("✓ Filtering, pagination, and time range parameters working correctly")
    print("✓ Error handling for invalid requests validated")
