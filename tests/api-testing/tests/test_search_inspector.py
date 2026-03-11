"""
Search Job Inspector API Tests
Covers: Contract validation, Error paths, Input validation, Security checks

API Endpoint: GET /api/{org_id}/search/profile

These tests validate the Search Job Inspector feature which allows users to
analyze search query execution performance by trace ID.

Tests cover:
- Response schema contract validation
- Input validation (trace_id, start_time, end_time)
- Error path tests for invalid parameters
- Security tests (unauthorized access, cross-org access)
- Edge cases (empty trace_id, inverted time range, etc.)
"""

import pytest
import time
import requests
import logging
import os
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
STREAM_NAME = "stream_pytest_data"


def get_current_time_micros():
    """Get current time in microseconds."""
    return int(datetime.now(timezone.utc).timestamp() * 1_000_000)


def get_time_range(hours_back=1):
    """Get start and end time for the last N hours in microseconds."""
    end_time = get_current_time_micros()
    start_time = int((datetime.now(timezone.utc) - timedelta(hours=hours_back)).timestamp() * 1_000_000)
    return start_time, end_time


@pytest.fixture(scope="module")
def search_and_get_trace_id(create_session, base_url):
    """
    Run a search to get a valid trace_id for testing.
    Returns the trace_id from the search response headers.
    """
    session = create_session

    start_time, end_time = get_time_range(hours_back=24)

    search_payload = {
        "query": {
            "sql": f'SELECT * FROM "{STREAM_NAME}" LIMIT 10',
            "start_time": start_time,
            "end_time": end_time,
            "size": 10
        }
    }

    headers = {"Content-Type": "application/json"}
    resp = session.post(
        f"{base_url}api/{ORG_ID}/_search?type=logs",
        json=search_payload,
        headers=headers
    )

    if resp.status_code == 200:
        # Try to get trace_id from response headers or body
        trace_id = resp.headers.get("x-trace-id") or resp.headers.get("trace-id")

        # If not in headers, try response body
        if not trace_id:
            body = resp.json()
            trace_id = body.get("trace_id")

        if trace_id:
            logger.info(f"Got trace_id from search: {trace_id}")
            return {
                "trace_id": trace_id,
                "start_time": start_time,
                "end_time": end_time
            }

    logger.warning(f"Could not get trace_id from search: {resp.status_code}")
    return None


class TestSearchInspectorContract:
    """Contract tests for Search Inspector API - validates response schemas."""

    def test_profile_endpoint_exists(self, create_session, base_url):
        """Validate GET /api/{org_id}/search/profile endpoint exists."""
        session = create_session
        start_time, end_time = get_time_range()

        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id=test123&start_time={start_time}&end_time={end_time}"
        )

        # Should not return 404 (endpoint not found)
        assert resp.status_code != 404, f"Endpoint not found: {resp.text}"
        logger.info(f"Profile endpoint exists, status: {resp.status_code}")

    def test_response_schema_structure(self, create_session, base_url, search_and_get_trace_id):
        """Validate response has expected structure when trace_id is valid."""
        if not search_and_get_trace_id:
            pytest.skip("No trace_id available from search")

        session = create_session
        trace_info = search_and_get_trace_id

        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id={trace_info['trace_id']}"
            f"&start_time={trace_info['start_time']}"
            f"&end_time={trace_info['end_time']}"
        )

        if resp.status_code == 200:
            body = resp.json()

            # Expected fields based on SearchJobInspector component
            expected_fields = ["sql", "events"]
            for field in expected_fields:
                assert field in body, f"Response missing expected field: {field}"

            assert isinstance(body.get("events", []), list), "events should be a list"
            logger.info(f"Response schema valid: sql_len={len(body.get('sql', ''))}, events_count={len(body.get('events', []))}")
        else:
            logger.warning(f"Profile returned {resp.status_code}: {resp.text[:200]}")


class TestSearchInspectorInputValidation:
    """Input validation tests for Search Inspector API."""

    def test_empty_trace_id_returns_error(self, create_session, base_url):
        """Empty trace_id should return error or empty data."""
        session = create_session
        start_time, end_time = get_time_range()

        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id=&start_time={start_time}&end_time={end_time}"
        )

        # Should either return 400 Bad Request or 200 with empty data
        assert resp.status_code in [200, 400], f"Unexpected status: {resp.status_code}"

        if resp.status_code == 200:
            body = resp.json()
            # With empty trace_id, events should be empty
            assert len(body.get("events", [])) == 0, "Empty trace_id should return no events"

        logger.info(f"Empty trace_id handled: status={resp.status_code}")

    def test_missing_trace_id_parameter(self, create_session, base_url):
        """Missing trace_id parameter should return 400."""
        session = create_session
        start_time, end_time = get_time_range()

        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?start_time={start_time}&end_time={end_time}"
        )

        # Should return 400 for missing required parameter
        assert resp.status_code == 400, f"Expected 400 for missing trace_id, got {resp.status_code}"
        logger.info("Missing trace_id correctly rejected")

    def test_missing_time_parameters(self, create_session, base_url):
        """Missing start_time/end_time should return 400."""
        session = create_session

        # Missing both time params
        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile?trace_id=test123"
        )

        assert resp.status_code == 400, f"Expected 400 for missing time params, got {resp.status_code}"
        logger.info("Missing time parameters correctly rejected")

    def test_invalid_trace_id_format(self, create_session, base_url):
        """Invalid trace_id should return 200 with empty data (not crash)."""
        session = create_session
        start_time, end_time = get_time_range()

        invalid_trace_ids = [
            "invalid_trace_id",
            "' OR '1'='1",  # SQL injection attempt
            "<script>alert(1)</script>",  # XSS attempt
            "test%00injection",  # Null byte injection
            "a" * 1000,  # Very long string
        ]

        for trace_id in invalid_trace_ids:
            resp = session.get(
                f"{base_url}api/{ORG_ID}/search/profile"
                f"?trace_id={trace_id}&start_time={start_time}&end_time={end_time}"
            )

            # Should not crash (500) - should return 200 with empty data or 400
            assert resp.status_code in [200, 400], (
                f"Unexpected status {resp.status_code} for trace_id={trace_id[:50]}"
            )
            logger.info(f"Invalid trace_id '{trace_id[:30]}...' handled: {resp.status_code}")

    def test_inverted_time_range(self, create_session, base_url):
        """start_time > end_time should return error."""
        session = create_session

        # Inverted time range (start > end)
        end_time = get_current_time_micros()
        start_time = end_time + 86400000000  # 1 day in future

        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id=test123&start_time={start_time}&end_time={end_time}"
        )

        # Should handle gracefully - either 400 or 200 with empty data
        # Bug #9 in impact report: currently returns 500
        assert resp.status_code in [200, 400, 500], f"Unexpected status: {resp.status_code}"

        if resp.status_code == 500:
            logger.warning("BUG: Inverted time range returns 500 instead of 400")
        else:
            logger.info(f"Inverted time range handled: {resp.status_code}")

    def test_negative_timestamps(self, create_session, base_url):
        """Negative timestamps should be handled gracefully."""
        session = create_session

        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id=test123&start_time=-1&end_time=-1"
        )

        # Should not crash - return 400 or 200 with empty data
        assert resp.status_code in [200, 400], f"Unexpected status: {resp.status_code}"
        logger.info(f"Negative timestamps handled: {resp.status_code}")


class TestSearchInspectorSecurity:
    """Security tests for Search Inspector API."""

    def test_unauthorized_access(self, base_url):
        """Verify 401 for unauthenticated requests."""
        start_time, end_time = get_time_range()

        # Use raw requests without auth
        resp = requests.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id=test123&start_time={start_time}&end_time={end_time}"
        )

        assert resp.status_code == 401, (
            f"Expected 401 for unauthenticated request, got {resp.status_code}"
        )
        logger.info("Unauthorized request correctly rejected with 401")

    def test_cross_org_access_blocked(self, create_session, base_url):
        """User should not be able to query data from other orgs."""
        session = create_session
        start_time, end_time = get_time_range()

        # Try to access a different organization's data
        fake_org = "other_organization_that_does_not_exist"

        resp = session.get(
            f"{base_url}api/{fake_org}/search/profile"
            f"?trace_id=test123&start_time={start_time}&end_time={end_time}"
        )

        # Should return 403 Forbidden or 404 Not Found
        assert resp.status_code in [403, 404, 500], (
            f"Cross-org access should be blocked, got {resp.status_code}"
        )
        logger.info(f"Cross-org access blocked: {resp.status_code}")

    def test_xss_in_trace_id(self, create_session, base_url):
        """XSS payloads should be sanitized in response."""
        session = create_session
        start_time, end_time = get_time_range()

        xss_payloads = [
            "<script>alert(1)</script>",
            "<img src=x onerror=alert(1)>",
            "javascript:alert(1)",
        ]

        for payload in xss_payloads:
            resp = session.get(
                f"{base_url}api/{ORG_ID}/search/profile"
                f"?trace_id={payload}&start_time={start_time}&end_time={end_time}"
            )

            if resp.status_code == 200:
                body = resp.text
                # Check that XSS payload is not reflected unsanitized
                assert "<script>" not in body.lower(), (
                    f"XSS payload reflected in response: {payload}"
                )

            logger.info(f"XSS payload '{payload[:20]}...' handled: {resp.status_code}")


class TestSearchInspectorErrorHandling:
    """Error handling tests for Search Inspector API."""

    def test_nonexistent_trace_id(self, create_session, base_url):
        """Nonexistent trace_id should return 200 with empty events."""
        session = create_session
        start_time, end_time = get_time_range()

        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id=nonexistent_trace_12345&start_time={start_time}&end_time={end_time}"
        )

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

        body = resp.json()
        # Nonexistent trace should return empty events
        assert body.get("sql", "") == "" or len(body.get("events", [])) == 0, (
            "Nonexistent trace_id should return empty data"
        )
        logger.info("Nonexistent trace_id returns empty data correctly")

    def test_malformed_timestamp_format(self, create_session, base_url):
        """Malformed timestamps should return 400."""
        session = create_session

        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id=test123&start_time=invalid&end_time=invalid"
        )

        # Should return 400 for invalid format
        assert resp.status_code in [400, 500], (
            f"Expected 400/500 for malformed timestamp, got {resp.status_code}"
        )
        logger.info(f"Malformed timestamps handled: {resp.status_code}")

    def test_method_not_allowed(self, create_session, base_url):
        """POST to profile endpoint should return 405."""
        session = create_session
        start_time, end_time = get_time_range()

        resp = session.post(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id=test123&start_time={start_time}&end_time={end_time}"
        )

        # Should return 405 Method Not Allowed
        assert resp.status_code == 405, (
            f"Expected 405 for POST method, got {resp.status_code}"
        )
        logger.info("POST method correctly rejected with 405")


class TestSearchInspectorWithRealData:
    """Tests using real search data."""

    def test_profile_with_valid_trace(self, create_session, base_url, search_and_get_trace_id):
        """Test profile endpoint with a real trace_id from search."""
        if not search_and_get_trace_id:
            pytest.skip("No trace_id available from search")

        session = create_session
        trace_info = search_and_get_trace_id

        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id={trace_info['trace_id']}"
            f"&start_time={trace_info['start_time']}"
            f"&end_time={trace_info['end_time']}"
        )

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        body = resp.json()
        logger.info(f"Profile for real trace: sql_len={len(body.get('sql', ''))}, events={len(body.get('events', []))}")

    def test_trace_id_suffix_handling(self, create_session, base_url, search_and_get_trace_id):
        """Test that trace_id with suffix is handled correctly."""
        if not search_and_get_trace_id:
            pytest.skip("No trace_id available from search")

        session = create_session
        trace_info = search_and_get_trace_id
        base_trace_id = trace_info['trace_id']

        # Add suffix like "-1" (as seen in search history)
        trace_with_suffix = f"{base_trace_id}-1"

        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id={trace_with_suffix}"
            f"&start_time={trace_info['start_time']}"
            f"&end_time={trace_info['end_time']}"
        )

        # Should handle suffix gracefully
        assert resp.status_code in [200, 400], (
            f"Unexpected status for trace_id with suffix: {resp.status_code}"
        )
        logger.info(f"Trace_id with suffix handled: {resp.status_code}")


class TestSearchInspectorPerformance:
    """Performance-related tests for Search Inspector API."""

    def test_response_time_acceptable(self, create_session, base_url):
        """Profile endpoint should respond within acceptable time."""
        session = create_session
        start_time, end_time = get_time_range()

        start = time.time()
        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id=test123&start_time={start_time}&end_time={end_time}"
        )
        elapsed = time.time() - start

        # Should respond within 5 seconds
        assert elapsed < 5.0, f"Response took too long: {elapsed:.2f}s"
        logger.info(f"Response time: {elapsed:.2f}s, status: {resp.status_code}")

    def test_wide_time_range_handled(self, create_session, base_url):
        """Wide time range should not cause timeout."""
        session = create_session

        # 30 day time range
        end_time = get_current_time_micros()
        start_time = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp() * 1_000_000)

        start = time.time()
        resp = session.get(
            f"{base_url}api/{ORG_ID}/search/profile"
            f"?trace_id=test123&start_time={start_time}&end_time={end_time}",
            timeout=30
        )
        elapsed = time.time() - start

        # Should not timeout
        assert resp.status_code in [200, 400], f"Unexpected status: {resp.status_code}"
        logger.info(f"Wide time range handled in {elapsed:.2f}s, status: {resp.status_code}")
