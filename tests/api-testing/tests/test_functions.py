def test_e2e_folder(create_session, base_url):
    """Running an E2E test for all xfunctions."""

    session = create_session
    org_id = "default"

    resp_get_allfunctions = session.get(f"{base_url}api/{org_id}/functions")

    print(resp_get_allfunctions.content)
    assert (
        resp_get_allfunctions.status_code == 200
    ), f"Get all functions list 200, but got {resp_get_allfunctions.status_code} {resp_get_allfunctions.content}"


def test_e2e_createdeletefunction(create_session, base_url):
    """Running an E2E test for create and delete functions."""

    session = create_session
    # Create a function
    org_id = "default"
    payload = {
        "function": ".a=190025552",
        "name": "pytestfunction",
        "params": "row",
        "transType": 0,
    }

    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload
    )

    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 200
    ), f"Expected 200, but got {resp_create_function.status_code} {resp_create_function.content}"
    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunction"
    )
    assert (
        resp_delete_function.status_code == 200
    ), f"Deleting this function, but got {resp_delete_function.status_code} {resp_delete_function.content}"


def test_e2e_invalidfunction(create_session, base_url):
    """Running an E2E test for invalid function creation"""

    session = create_session
    # Create a function
    org_id = "default"
    payload = {"name": "...", "function": "...",
               "params": "row", "transType": 0}

    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload
    )

    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 400
    ), f"Invalid function creation, but got {resp_create_function.status_code} {resp_create_function.content}"


def test_e2e_updatingfunction(create_session, base_url):
    """Running an E2E test for update and delete an existing function."""

    session = create_session
    # Create a function
    org_id = "default"
    payload = {
        "name": "pytestfunctions",
        "function": ".a=190022",
        "params": "row",
        "transType": 0,
    }

    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload
    )

    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 200
    ), f"Expected 200, but got {resp_create_function.status_code} {resp_create_function.content}"
    session = create_session
    # Create a function
    org_id = "default"
    payload = {
        "name": "pytestfunctions",
        "function": ".a=1900",
        "params": "row",
        "transType": 0,
    }
    resp_update_function = session.put(
        f"{base_url}api/{org_id}/functions/pytestfunctions",
        json=payload,
    )
    print(resp_create_function.content)
    assert (
        resp_update_function.status_code == 200
    ), f"Updating this function, but got {resp_update_function.status_code} {resp_update_function.content}"
    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunctions"
    )
    assert (
        resp_delete_function.status_code == 200
    ), f"Deleting this function, but got {resp_delete_function.status_code} {resp_delete_function.content}"


def test_e2e_duplicatefunction(create_session, base_url):
    """Running an E2E test for function already exists."""

    session = create_session
    # Create a function
    org_id = "default"
    payload = {
        "name": "pytestfunctions",
        "function": ".a=190022",
        "params": "row",
        "transType": 0,
    }

    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload
    )

    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 200
    ), f"Expected 200, but got {resp_create_function.status_code} {resp_create_function.content}"
    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunction"
    )
    session = create_session
    # Create a function
    org_id = "default"
    payload = {
        "name": "pytestfunctions",
        "function": ".a=190022",
        "params": "row",
        "transType": 0,
    }

    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload
    )

    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 400
    ), f"Expected 400 function already exists, but got {resp_create_function.status_code} {resp_create_function.content}"
    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunctions"
    )
    assert (
        resp_delete_function.status_code == 200
    ), f"Deleting this function, but got {resp_delete_function.status_code} {resp_delete_function.content}"


def test_e2e_functionnotfound(create_session, base_url):
    """Running an E2E test for function not found."""

    session = create_session
    # Create a function
    org_id = "default"

    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunctionsss"
    )
    assert (
        resp_delete_function.status_code == 404
    ), f"Function not found, but got {resp_delete_function.status_code} {resp_delete_function.content}"


def test_e2e_addDeleteStreamFunction(create_session, base_url):
    """Running an E2E test for add stream to a function and delete."""

    session = create_session
    org_id = "default"
    stream_name = "test"

    # Create a function
    org_id = "default"
    payload = {
        "function": ".a=190025552",
        "name": "pytestfunction",
        "params": "row",
        "transType": 0,
    }

    resp_create_function = session.post(
        f"{base_url}api/{org_id}/functions", json=payload
    )

    print(resp_create_function.content)
    assert (
        resp_create_function.status_code == 200
    ), f"Expected 200, but got {resp_create_function.status_code} {resp_create_function.content}"

    resp_delete_function = session.delete(
        f"{base_url}api/{org_id}/functions/pytestfunction"
    )
    assert (
        resp_delete_function.status_code == 200
    ), f"Deleting this function, but got {resp_delete_function.status_code} {resp_delete_function.content}"


def test_e2e_testinvalidfunction(create_session, base_url):
    """Running an E2E test for invalid test function"""

    session = create_session
    org_id = "default"
    payload = {
        "function": ".test=2jehwkhhe\n.",
        "events": [
            {
                "_timestamp": 1735128523652186,
                "job": "test",
                "level": "info",
                "log": "test message for openobserve"
            },
            {
                "_timestamp": 1735128522644223,
                "job": "test",
                "level": "info",
                "log": "test message for openobserve"
            }
        ]
    }

    resp_test_function = session.post(
        f"{base_url}api/{org_id}/functions/test", json=payload
    )

    print(resp_test_function.content)
    assert (
        resp_test_function.status_code == 400
    ), f"Invalid function creation, but got {resp_test_function.status_code} {resp_test_function.content}"


def test_e2e_onlytextfunction(create_session, base_url):
    """Running an E2E test for invalid test function"""

    session = create_session
    org_id = "default"
    payload = {
        "function": "test",
        "events": [
            {
            "_timestamp": 1735128523652186,
            "job": "test",
            "level": "info",
            "log": "test message for openobserve"
            },
            {
            "_timestamp": 1735128522644223,
            "job": "test",
            "level": "info",
            "log": "test message for openobserve"
            }
        ]
        }

    resp_test_function = session.post(
        f"{base_url}api/{org_id}/functions/test", json=payload
    )

    print(resp_test_function.content)
    assert (
        resp_test_function.status_code == 400
    ), f"Invalid function creation, but got {resp_test_function.status_code} {resp_test_function.content}"



def test_e2e_testonlyspecialcharfunction(create_session, base_url):
    """Running an E2E test for invalid test function"""

    session = create_session
    org_id = "default"
    payload = {
        "function": "=====",
        "events": [
            {
                "_timestamp": 1735128523652186,
                "job": "test",
                "level": "info",
                "log": "test message for openobserve"
            },
            {
                "_timestamp": 1735128522644223,
                "job": "test",
                "level": "info",
                "log": "test message for openobserve"
            }
        ]
    }

    resp_test_function = session.post(
        f"{base_url}api/{org_id}/functions/test", json=payload
    )

    print(resp_test_function.content)
    assert (
        resp_test_function.status_code == 400
    ), f"Invalid function creation, but got {resp_test_function.status_code} {resp_test_function.content}"

def test_e2e_testfunction(create_session, base_url):
    """Running an E2E test for the test function"""

    session = create_session
    # Define organization ID and payload
    org_id = "default"
    payload = {
        "function": ".test=2\n.",
        "events": [
            {
                "_timestamp": 1735128523652186,
                "job": "test",
                "level": "info",
                "log": "test message for openobserve"
            },
            {
                "_timestamp": 1735128522644223,
                "job": "test",
                "level": "info",
                "log": "test message for openobserve"
            }
        ]
    }

    # Send a POST request to the API
    resp_test_function = session.post(
        f"{base_url}api/{org_id}/functions/test", json=payload
    )

    # Print the response content for debugging
    print(resp_test_function.content)

    # Assert that the response status code is 200
    assert resp_test_function.status_code == 200, (
        f"Expected status code 200, but got {resp_test_function.status_code}. "
        f"Response content: {resp_test_function.content}"
    )

    # Parse the response JSON
    response_json = resp_test_function.json()

    # Assert that `test=2` is present in each event in the response
    for result in response_json.get("results", []):
        assert result["event"].get("test") == 2, (
            f"Expected 'test=2' in the response event, but got {result}."
        )


def test_e2e_enterprise_mmdb_uk_ip(create_session, base_url):
    """Test Enterprise MMDB enrichment with UK IP (2.125.160.216 - Boxford)"""

    session = create_session
    org_id = "default"

    # Test with UK IP from the test database
    payload = {
        "function": '.ip = "2.125.160.216"\n.geo_city, err = get_enrichment_table_record("maxmind_enterprise", { "ip": .ip })\n.',
        "events": [
            {
                "_timestamp": 1735128523652186,
                "job": "test",
                "level": "info",
                "log": "test message for openobserve"
            },
            {
                "_timestamp": 1735128522644223,
                "job": "test",
                "level": "info",
                "log": "test message for openobserve"
            }
        ]
    }

    resp_test_function = session.post(
        f"{base_url}api/{org_id}/functions/test", json=payload
    )

    print(resp_test_function.content)

    assert resp_test_function.status_code == 200, (
        f"Expected status code 200, but got {resp_test_function.status_code}. "
        f"Response content: {resp_test_function.content}"
    )

    response_json = resp_test_function.json()

    # Verify geo_city enrichment data is present in all events
    for result in response_json.get("results", []):
        event = result["event"]

        # Check that IP was set
        assert event.get("ip") == "2.125.160.216", (
            f"Expected IP '2.125.160.216', but got {event.get('ip')}"
        )

        # Check that geo_city enrichment data exists
        assert event.get("geo_city") is not None, (
            f"Expected 'geo_city' enrichment data, but got None. Event: {event}"
        )

        # Verify basic location fields if geo_city is present
        geo_city = event.get("geo_city", {})
        if isinstance(geo_city, dict):
            # UK IP should have city name
            assert geo_city.get("city_name") is not None, (
                f"Expected 'city_name' in geo_city data, but got {geo_city}"
            )
            # Should have country code
            assert geo_city.get("country_code") is not None, (
                f"Expected 'country_code' in geo_city data, but got {geo_city}"
            )


def test_e2e_enterprise_mmdb_us_ip(create_session, base_url):
    """Test Enterprise MMDB enrichment with US IP (74.209.24.1 - Chatham, NY)"""

    session = create_session
    org_id = "default"

    # Test with US IP that has full enterprise data
    payload = {
        "function": '.ip = "74.209.24.1"\n.geo_city, err = get_enrichment_table_record("maxmind_enterprise", { "ip": .ip })\n.',
        "events": [
            {
                "_timestamp": 1735128523652186,
                "job": "test",
                "level": "info",
                "log": "test message with US IP"
            }
        ]
    }

    resp_test_function = session.post(
        f"{base_url}api/{org_id}/functions/test", json=payload
    )

    print(resp_test_function.content)

    assert resp_test_function.status_code == 200, (
        f"Expected status code 200, but got {resp_test_function.status_code}. "
        f"Response content: {resp_test_function.content}"
    )

    response_json = resp_test_function.json()

    # Verify enterprise-specific fields
    for result in response_json.get("results", []):
        event = result["event"]

        assert event.get("ip") == "74.209.24.1", (
            f"Expected IP '74.209.24.1', but got {event.get('ip')}"
        )

        geo_city = event.get("geo_city", {})
        assert geo_city is not None and isinstance(geo_city, dict), (
            f"Expected valid geo_city enrichment data, but got {geo_city}"
        )

        # Verify enterprise-specific fields are present
        # ISP and organization info
        assert "isp" in geo_city or "organization" in geo_city, (
            f"Expected enterprise fields (isp/organization) in geo_city, but got {geo_city}"
        )


def test_e2e_enterprise_mmdb_bhutan_ip(create_session, base_url):
    """Test Enterprise MMDB enrichment with Bhutan IP (67.43.156.1)"""

    session = create_session
    org_id = "default"

    # Test with Bhutan IP that has ISP, ASN, domain, user_type
    payload = {
        "function": '.ip = "67.43.156.1"\n.geo_city, err = get_enrichment_table_record("maxmind_enterprise", { "ip": .ip })\n.',
        "events": [
            {
                "_timestamp": 1735128523652186,
                "job": "test",
                "level": "info",
                "log": "test message with Bhutan IP"
            }
        ]
    }

    resp_test_function = session.post(
        f"{base_url}api/{org_id}/functions/test", json=payload
    )

    print(resp_test_function.content)

    assert resp_test_function.status_code == 200, (
        f"Expected status code 200, but got {resp_test_function.status_code}. "
        f"Response content: {resp_test_function.content}"
    )

    response_json = resp_test_function.json()

    for result in response_json.get("results", []):
        event = result["event"]

        assert event.get("ip") == "67.43.156.1", (
            f"Expected IP '67.43.156.1', but got {event.get('ip')}"
        )

        geo_city = event.get("geo_city", {})
        assert geo_city is not None, (
            f"Expected geo_city enrichment data for Bhutan IP, but got None"
        )


def test_e2e_enterprise_mmdb_invalid_ip(create_session, base_url):
    """Test Enterprise MMDB enrichment with an IP not in the test database"""

    session = create_session
    org_id = "default"

    # Test with IP that's NOT in the test database (8.8.8.8)
    payload = {
        "function": '.ip = "8.8.8.8"\n.geo_city, err = get_enrichment_table_record("maxmind_enterprise", { "ip": .ip })\n.',
        "events": [
            {
                "_timestamp": 1735128523652186,
                "job": "test",
                "level": "info",
                "log": "test message with invalid IP"
            }
        ]
    }

    resp_test_function = session.post(
        f"{base_url}api/{org_id}/functions/test", json=payload
    )

    print(resp_test_function.content)

    assert resp_test_function.status_code == 200, (
        f"Expected status code 200, but got {resp_test_function.status_code}. "
        f"Response content: {resp_test_function.content}"
    )

    response_json = resp_test_function.json()

    # For IP not in database, geo_city should be empty or just return the IP
    for result in response_json.get("results", []):
        event = result["event"]

        assert event.get("ip") == "8.8.8.8", (
            f"Expected IP '8.8.8.8', but got {event.get('ip')}"
        )

        # geo_city might be None, empty dict, or only contain the IP
        geo_city = event.get("geo_city")
        if geo_city and isinstance(geo_city, dict):
            # Should not have rich location data for unknown IP
            assert len(geo_city) == 0 or list(geo_city.keys()) == ["ip"], (
                f"Expected no enrichment data for unknown IP, but got {geo_city}"
            )


def test_e2e_enterprise_mmdb_ipv6(create_session, base_url):
    """Test Enterprise MMDB enrichment with IPv6 address (2001:480::1)"""

    session = create_session
    org_id = "default"

    # Test with IPv6 from test database
    payload = {
        "function": '.ip = "2001:480::1"\n.geo_city, err = get_enrichment_table_record("maxmind_enterprise", { "ip": .ip })\n.',
        "events": [
            {
                "_timestamp": 1735128523652186,
                "job": "test",
                "level": "info",
                "log": "test message with IPv6"
            }
        ]
    }

    resp_test_function = session.post(
        f"{base_url}api/{org_id}/functions/test", json=payload
    )

    print(resp_test_function.content)

    assert resp_test_function.status_code == 200, (
        f"Expected status code 200, but got {resp_test_function.status_code}. "
        f"Response content: {resp_test_function.content}"
    )

    response_json = resp_test_function.json()

    for result in response_json.get("results", []):
        event = result["event"]

        assert event.get("ip") == "2001:480::1", (
            f"Expected IP '2001:480::1', but got {event.get('ip')}"
        )

        # IPv6 should also work with the enrichment table
        assert event.get("geo_city") is not None, (
            f"Expected geo_city enrichment data for IPv6, but got None"
        )
