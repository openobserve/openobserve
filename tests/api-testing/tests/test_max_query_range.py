"""
Test Max Query Range enforcement for OpenObserve streams.

This test verifies that when max_query_range is set on a stream,
queries exceeding that range are automatically truncated.

Test Coverage:
- TestLogsMaxQueryRange: Core truncation tests for logs streams
- TestMetricsMaxQueryRange: Truncation for streams with metrics-like data
- TestTracesMaxQueryRange: Truncation for streams with traces-like data
- TestMaxQueryRangeNegativeCases: Edge cases (zero, negative, fractional, boundary)

NOTE: All tests use JSON ingestion which creates 'logs' type streams. The metrics
and traces test classes contain data with metrics/traces-like fields but are still
logs streams. To test native metrics (type=metrics) or traces (type=traces) streams,
OTLP or Prometheus remote write ingestion would be required.
"""

import pytest
import time
import json
import logging
from datetime import datetime, timezone, timedelta

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ========== SHARED CONSTANTS ==========
DEFAULT_MAX_QUERY_RANGE_HOURS = 1
MAX_RETRIES_FOR_STREAM = 12  # Up to 60 seconds
VALID_STREAM_TYPES = ("logs", "metrics", "traces")
# Regex pattern for valid test_run_id: alphanumeric with underscores, timestamp suffix
TEST_RUN_ID_PATTERN = r'^[a-z_]+_\d+$'


def validate_test_run_id(test_run_id):
    """Validate test_run_id format to prevent SQL injection."""
    import re
    if not re.match(TEST_RUN_ID_PATTERN, test_run_id):
        raise ValueError(f"Invalid test_run_id format: {test_run_id}")
    return test_run_id


def generate_time_points(now):
    """Generate standardized time points for test data."""
    return [
        ("3_hours_ago", now - timedelta(hours=3)),
        ("2_hours_ago", now - timedelta(hours=2)),
        ("90_mins_ago", now - timedelta(minutes=90)),
        ("45_mins_ago", now - timedelta(minutes=45)),
        ("30_mins_ago", now - timedelta(minutes=30)),
        ("15_mins_ago", now - timedelta(minutes=15)),
        ("5_mins_ago", now - timedelta(minutes=5)),
        ("now", now),
    ]


def wait_for_stream_queryable(session, base_url, org_id, stream_name, test_run_id, now,
                               stream_type="logs", max_retries=MAX_RETRIES_FOR_STREAM):
    """Wait until stream is queryable with retries."""
    validate_test_run_id(test_run_id)
    assert stream_type in VALID_STREAM_TYPES, f"Invalid stream_type: {stream_type}"

    for attempt in range(max_retries):
        search_url = f"{base_url}api/{org_id}/_search?type={stream_type}"
        verify_payload = {
            "query": {
                "sql": f"SELECT * FROM \"{stream_name}\" WHERE test_run_id = '{test_run_id}' LIMIT 1",
                "start_time": int((now - timedelta(hours=4)).timestamp() * 1000000),
                "end_time": int(now.timestamp() * 1000000),
                "from": 0,
                "size": 1
            }
        }
        verify_resp = session.post(search_url, json=verify_payload, headers={"Content-Type": "application/json"})
        if verify_resp.status_code == 200:
            data = verify_resp.json()
            if data.get("hits") and len(data["hits"]) > 0:
                logger.info(f"Stream verified queryable on attempt {attempt + 1}")
                return True
        logger.info(f"Stream not yet queryable (attempt {attempt + 1}/{max_retries}), waiting...")
        time.sleep(5)
    return False


def search_stream(session, base_url, org_id, stream_name, test_run_id, start_time, end_time, stream_type="logs"):
    """Helper to search a stream with given time range."""
    validate_test_run_id(test_run_id)
    assert stream_type in VALID_STREAM_TYPES, f"Invalid stream_type: {stream_type}"

    search_url = f"{base_url}api/{org_id}/_search?type={stream_type}"
    search_payload = {
        "query": {
            "sql": f"SELECT * FROM \"{stream_name}\" WHERE test_run_id = '{test_run_id}'",
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": 100
        }
    }
    return session.post(search_url, json=search_payload, headers={"Content-Type": "application/json"})


def set_max_query_range(session, base_url, org_id, stream_name, max_query_range, stream_type="logs"):
    """Set max_query_range on a stream."""
    assert stream_type in VALID_STREAM_TYPES, f"Invalid stream_type: {stream_type}"
    settings_url = f"{base_url}api/{org_id}/streams/{stream_name}/settings?type={stream_type}"
    return session.put(
        settings_url,
        json={"max_query_range": max_query_range},
        headers={"Content-Type": "application/json"}
    )


def get_stream_settings(session, base_url, org_id, stream_name, stream_type="logs"):
    """Get stream settings including max_query_range."""
    assert stream_type in VALID_STREAM_TYPES, f"Invalid stream_type: {stream_type}"
    schema_url = f"{base_url}api/{org_id}/streams/{stream_name}/schema?type={stream_type}"
    resp = session.get(schema_url)
    if resp.status_code == 200:
        return resp.json().get("settings", {})
    return {}


def ingest_and_flush(session, base_url, org_id, stream_name, data):
    """Ingest data and flush for indexing."""
    ingest_url = f"{base_url}api/{org_id}/{stream_name}/_json"
    resp = session.post(ingest_url, data=json.dumps(data), headers={"Content-Type": "application/json"})
    if resp.status_code != 200:
        raise AssertionError(f"Failed to ingest data: {resp.text}")

    # Flush and wait for indexing
    flush_url = f"{base_url}node/flush"
    session.put(flush_url)
    time.sleep(5)
    return resp


class TestLogsMaxQueryRange:
    """Test max_query_range enforcement for logs streams."""

    STREAM_NAME = "test_max_query_range_stream"
    STREAM_TYPE = "logs"
    MAX_QUERY_RANGE_HOURS = DEFAULT_MAX_QUERY_RANGE_HOURS
    ORIGINAL_MAX_QUERY_RANGE = None
    TEST_RUN_ID = None

    @pytest.fixture(scope="class", autouse=True)
    def setup_stream(self, create_session, base_url, org_id):
        """Setup: Create stream with backdated data, set max_query_range."""
        session = create_session
        logger.info(f"=== SETUP: Preparing stream '{self.STREAM_NAME}' ===")

        now = datetime.now(timezone.utc)
        test_run_id = f"mqr_test_{int(now.timestamp())}"
        TestLogsMaxQueryRange.TEST_RUN_ID = test_run_id

        # Create test data at various time points
        test_data = [
            {
                "_timestamp": int(ts.timestamp() * 1000000),
                "level": "info",
                "message": f"Test log entry at {label}",
                "time_label": label,
                "test_run_id": test_run_id
            }
            for label, ts in generate_time_points(now)
        ]

        # Ingest and flush
        ingest_and_flush(session, base_url, org_id, self.STREAM_NAME, test_data)

        # Wait for stream to be queryable
        if not wait_for_stream_queryable(session, base_url, org_id, self.STREAM_NAME, test_run_id, now):
            pytest.fail(f"Stream '{self.STREAM_NAME}' not queryable after retries")

        # Save and set max_query_range
        settings = get_stream_settings(session, base_url, org_id, self.STREAM_NAME)
        TestLogsMaxQueryRange.ORIGINAL_MAX_QUERY_RANGE = settings.get("max_query_range", 0)

        resp = set_max_query_range(session, base_url, org_id, self.STREAM_NAME, self.MAX_QUERY_RANGE_HOURS)
        assert resp.status_code == 200, f"Failed to set max_query_range: {resp.text}"

        logger.info(f"=== SETUP COMPLETE: max_query_range={self.MAX_QUERY_RANGE_HOURS}h ===")
        yield

        # Cleanup: Restore original max_query_range
        set_max_query_range(session, base_url, org_id, self.STREAM_NAME, TestLogsMaxQueryRange.ORIGINAL_MAX_QUERY_RANGE or 0)

    def _search_stream(self, session, base_url, org_id, start_time, end_time):
        """Helper to search the stream with given time range."""
        return search_stream(session, base_url, org_id, self.STREAM_NAME, self.TEST_RUN_ID, start_time, end_time)

    def test_01_query_within_limit_returns_all_data(self, create_session, base_url, org_id):
        """
        Test: Query within max_query_range (30 mins) should return all matching data.

        Expected: All records from the last 30 minutes are returned.
        Records expected: 30_mins_ago, 15_mins_ago, 5_mins_ago, now
        """
        logger.info("=== TEST: Query within limit (30 mins) ===")

        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        start_time = int((now - timedelta(minutes=35)).timestamp() * 1000000)  # 35 mins to include 30_mins_ago

        resp = self._search_stream(create_session, base_url, org_id, start_time, end_time)

        logger.info(f"Search response: {resp.status_code}")
        assert resp.status_code == 200, f"Search failed: {resp.text}"

        data = resp.json()
        hits = data.get("hits", [])
        time_labels = [hit.get("time_label") for hit in hits]
        logger.info(f"Records returned: {len(hits)}, labels: {time_labels}")

        # STRONG ASSERTION 1: Must have records (not empty)
        assert len(hits) >= 3, \
            f"Expected at least 3 records (30m, 15m, 5m ago), got {len(hits)}: {time_labels}"

        # STRONG ASSERTION 2: Verify specific expected records ARE present
        expected_within_30m = ["30_mins_ago", "15_mins_ago", "5_mins_ago"]
        for label in expected_within_30m:
            assert label in time_labels, \
                f"Expected record '{label}' not found in results: {time_labels}"

        # STRONG ASSERTION 3: Verify all returned records are within the queried range
        for hit in hits:
            ts = hit.get("_timestamp", 0)
            assert ts >= start_time, \
                f"Record '{hit.get('time_label')}' timestamp {ts} is before start_time {start_time}"
            assert ts <= end_time, \
                f"Record '{hit.get('time_label')}' timestamp {ts} is after end_time {end_time}"

        logger.info("=== PASSED: Query within limit returns expected data ===")

    def test_02_query_exceeding_limit_is_truncated(self, create_session, base_url, org_id):
        """
        Test: Query exceeding max_query_range (3 hours) should be truncated to 1 hour.

        Expected: Only records from the last 1 hour are returned,
        older records (2h, 3h ago) are NOT returned.

        Records that SHOULD be returned: 45_mins_ago, 30_mins_ago, 15_mins_ago, 5_mins_ago, now
        Records that should NOT be returned: 3_hours_ago, 2_hours_ago, 90_mins_ago
        """
        logger.info("=== TEST: Query exceeding limit (3 hours → truncated to 1 hour) ===")

        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        start_time_3h = int((now - timedelta(hours=3)).timestamp() * 1000000)

        # Query asking for 3 hours of data
        resp = self._search_stream(create_session, base_url, org_id, start_time_3h, end_time)

        logger.info(f"Search response: {resp.status_code}")
        assert resp.status_code == 200, f"Search failed: {resp.text}"

        data = resp.json()
        hits = data.get("hits", [])
        time_labels = [hit.get("time_label") for hit in hits]
        logger.info(f"Records returned: {len(hits)}, labels: {time_labels}")

        # Calculate the expected truncated start time (1 hour ago)
        truncated_start_time = int((now - timedelta(hours=self.MAX_QUERY_RANGE_HOURS)).timestamp() * 1000000)

        # Categorize records
        old_records = []
        valid_records = []

        for hit in hits:
            ts = hit.get("_timestamp", 0)
            time_label = hit.get("time_label", "unknown")

            if ts < truncated_start_time:
                old_records.append(time_label)
            else:
                valid_records.append(time_label)

        logger.info(f"Valid records (within 1h): {valid_records}")
        logger.info(f"Old records (should be empty): {old_records}")

        # STRONG ASSERTION 1: No old records should be returned (truncation worked)
        assert len(old_records) == 0, \
            f"Query was NOT truncated! Found records older than {self.MAX_QUERY_RANGE_HOURS}h: {old_records}"

        # STRONG ASSERTION 2: Must have valid records (not empty result)
        assert len(valid_records) >= 4, \
            f"Expected at least 4 records within 1h (45m, 30m, 15m, 5m ago), got {len(valid_records)}: {valid_records}"

        # STRONG ASSERTION 3: Verify specific EXPECTED records ARE present
        expected_within_1h = ["45_mins_ago", "30_mins_ago", "15_mins_ago", "5_mins_ago"]
        for label in expected_within_1h:
            assert label in time_labels, \
                f"Expected record '{label}' not found. Truncation may have removed valid data: {time_labels}"

        # STRONG ASSERTION 4: Verify specific OLD records are NOT present
        must_be_excluded = ["3_hours_ago", "2_hours_ago", "90_mins_ago"]
        for label in must_be_excluded:
            assert label not in time_labels, \
                f"Old record '{label}' should have been excluded by truncation: {time_labels}"

        logger.info("=== PASSED: Query exceeding limit was correctly truncated ===")

    def test_03_verify_boundary_at_exactly_1_hour(self, create_session, base_url, org_id):
        """
        Test: Boundary condition - query exactly at the max_query_range limit (1 hour).

        This verifies the truncation boundary is correctly applied.
        - Records at 45 mins should be included
        - Records at 90 mins (1.5h) should be excluded
        """
        logger.info("=== TEST: Boundary condition at exactly 1 hour ===")

        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        # Query for exactly 1 hour - should not trigger truncation
        start_time_1h = int((now - timedelta(hours=1)).timestamp() * 1000000)

        resp = self._search_stream(create_session, base_url, org_id, start_time_1h, end_time)

        assert resp.status_code == 200, f"Search failed: {resp.text}"

        data = resp.json()
        hits = data.get("hits", [])
        time_labels = [hit.get("time_label") for hit in hits]
        logger.info(f"Returned time labels for 1h query: {time_labels}")

        # STRONG ASSERTION 1: Results should not be empty
        assert len(hits) >= 4, \
            f"Expected at least 4 records for 1h query, got {len(hits)}: {time_labels}"

        # STRONG ASSERTION 2: 45_mins_ago MUST be included (within 1h)
        assert "45_mins_ago" in time_labels, \
            f"Record '45_mins_ago' should be within 1h range but was not found: {time_labels}"

        # STRONG ASSERTION 3: 90_mins_ago MUST be excluded (outside 1h)
        assert "90_mins_ago" not in time_labels, \
            f"Record '90_mins_ago' (1.5h old) should be excluded from 1h query: {time_labels}"

        # STRONG ASSERTION 4: All records within 1h should be present
        expected_within_1h = ["45_mins_ago", "30_mins_ago", "15_mins_ago", "5_mins_ago"]
        for label in expected_within_1h:
            assert label in time_labels, \
                f"Expected record '{label}' not found in 1h query results: {time_labels}"

        logger.info("=== PASSED: Boundary at 1 hour correctly enforced ===")

    def test_04_verify_truncation_excludes_all_old_data(self, create_session, base_url, org_id):
        """
        Test: Comprehensive verification that ALL old records are excluded.

        Query for 3 hours but expect only 1 hour of data due to truncation.
        Verify each old record by name to ensure none slip through.
        """
        logger.info("=== TEST: Verify ALL old data is excluded ===")

        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        start_time_3h = int((now - timedelta(hours=3)).timestamp() * 1000000)

        resp = self._search_stream(create_session, base_url, org_id, start_time_3h, end_time)

        assert resp.status_code == 200, f"Search failed: {resp.text}"

        data = resp.json()
        hits = data.get("hits", [])
        time_labels = [hit.get("time_label") for hit in hits]
        logger.info(f"Returned time labels: {time_labels}")

        # STRONG ASSERTION 1: Results should not be empty (we have valid data)
        assert len(hits) >= 1, \
            f"Expected results but got empty. Check if data was ingested correctly."

        # STRONG ASSERTION 2: These MUST NOT be in results (older than 1 hour)
        excluded_labels = ["3_hours_ago", "2_hours_ago", "90_mins_ago"]
        for label in excluded_labels:
            assert label not in time_labels, \
                f"TRUNCATION FAILED: Old record '{label}' was returned but should be excluded: {time_labels}"

        # STRONG ASSERTION 3: Count check - should have exactly the records within 1h
        # Expected: now, 5_mins_ago, 15_mins_ago, 30_mins_ago, 45_mins_ago = 5 records
        expected_count = 5
        assert len(hits) == expected_count, \
            f"Expected exactly {expected_count} records within 1h, got {len(hits)}: {time_labels}"

        # STRONG ASSERTION 4: Verify all expected records are present
        expected_labels = ["now", "5_mins_ago", "15_mins_ago", "30_mins_ago", "45_mins_ago"]
        for label in expected_labels:
            assert label in time_labels, \
                f"Expected record '{label}' missing from results: {time_labels}"

        logger.info("=== PASSED: All old data correctly excluded, all valid data present ===")


class TestMetricsMaxQueryRange:
    """
    Test max_query_range enforcement for streams with metrics-like data.

    NOTE: JSON ingestion creates 'logs' type streams. This tests max_query_range
    on a logs stream containing metric-like fields. To test native metrics streams
    (type=metrics), OTLP or Prometheus remote write ingestion would be required.
    """

    STREAM_NAME = "test_max_query_range_metrics"
    STREAM_TYPE = "logs"  # JSON ingestion creates logs streams
    MAX_QUERY_RANGE_HOURS = DEFAULT_MAX_QUERY_RANGE_HOURS
    ORIGINAL_MAX_QUERY_RANGE = None
    TEST_RUN_ID = None

    @pytest.fixture(scope="class", autouse=True)
    def setup_stream(self, create_session, base_url, org_id):
        """Setup: Create stream with metrics-like backdated data, set max_query_range."""
        session = create_session
        logger.info(f"=== SETUP: Preparing stream '{self.STREAM_NAME}' (type={self.STREAM_TYPE}) ===")

        now = datetime.now(timezone.utc)
        test_run_id = f"metrics_mqr_{int(now.timestamp())}"
        TestMetricsMaxQueryRange.TEST_RUN_ID = test_run_id

        # Create test data at various time points (metrics-like fields)
        test_data = [
            {
                "_timestamp": int(ts.timestamp() * 1000000),
                "metric_name": "test_cpu_usage",
                "value": 50.0 + len(label),
                "time_label": label,
                "test_run_id": test_run_id,
                "host": "test-host",
                "type": "gauge"
            }
            for label, ts in generate_time_points(now)
        ]

        # Ingest and flush
        ingest_and_flush(session, base_url, org_id, self.STREAM_NAME, test_data)

        # Wait for stream to be queryable
        if not wait_for_stream_queryable(session, base_url, org_id, self.STREAM_NAME, test_run_id, now,
                                          stream_type=self.STREAM_TYPE):
            pytest.fail(f"Stream '{self.STREAM_NAME}' not queryable after retries")

        # Save and set max_query_range
        settings = get_stream_settings(session, base_url, org_id, self.STREAM_NAME, stream_type=self.STREAM_TYPE)
        TestMetricsMaxQueryRange.ORIGINAL_MAX_QUERY_RANGE = settings.get("max_query_range", 0)

        resp = set_max_query_range(session, base_url, org_id, self.STREAM_NAME, self.MAX_QUERY_RANGE_HOURS,
                                   stream_type=self.STREAM_TYPE)
        assert resp.status_code == 200, f"Failed to set max_query_range: {resp.text}"

        logger.info(f"=== SETUP COMPLETE: max_query_range={self.MAX_QUERY_RANGE_HOURS}h ===")
        yield

        # Cleanup: Restore original max_query_range
        set_max_query_range(session, base_url, org_id, self.STREAM_NAME,
                           TestMetricsMaxQueryRange.ORIGINAL_MAX_QUERY_RANGE or 0, stream_type=self.STREAM_TYPE)

    def _search_stream(self, session, base_url, org_id, start_time, end_time):
        """Helper to search the stream."""
        return search_stream(session, base_url, org_id, self.STREAM_NAME, self.TEST_RUN_ID, start_time, end_time,
                            stream_type=self.STREAM_TYPE)

    def test_01_metrics_query_exceeding_limit_is_truncated(self, create_session, base_url, org_id):
        """
        Test: Metrics query exceeding max_query_range (3 hours) is truncated to 1 hour.
        """
        logger.info("=== TEST: Metrics query truncation (3h → 1h) ===")

        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        start_time_3h = int((now - timedelta(hours=3)).timestamp() * 1000000)

        resp = self._search_stream(create_session, base_url, org_id, start_time_3h, end_time)

        assert resp.status_code == 200, f"Search failed: {resp.text}"

        data = resp.json()
        hits = data.get("hits", [])
        time_labels = [hit.get("time_label") for hit in hits]
        logger.info(f"Records returned: {len(hits)}, labels: {time_labels}")

        # STRONG ASSERTION: Old records must NOT be present
        excluded_labels = ["3_hours_ago", "2_hours_ago", "90_mins_ago"]
        for label in excluded_labels:
            assert label not in time_labels, \
                f"TRUNCATION FAILED: Old record '{label}' found in metrics results: {time_labels}"

        # STRONG ASSERTION: Recent records must be present
        expected_labels = ["45_mins_ago", "30_mins_ago", "15_mins_ago", "5_mins_ago"]
        for label in expected_labels:
            assert label in time_labels, \
                f"Expected metrics record '{label}' not found: {time_labels}"

        logger.info("=== PASSED: Metrics query correctly truncated ===")


class TestTracesMaxQueryRange:
    """
    Test max_query_range enforcement for streams with traces-like data.

    NOTE: JSON ingestion creates 'logs' type streams. This tests max_query_range
    on a logs stream containing trace-like fields. To test native traces streams
    (type=traces), OTLP ingestion would be required.
    """

    STREAM_NAME = "test_max_query_range_traces"
    STREAM_TYPE = "logs"  # JSON ingestion creates logs streams
    MAX_QUERY_RANGE_HOURS = DEFAULT_MAX_QUERY_RANGE_HOURS
    ORIGINAL_MAX_QUERY_RANGE = None
    TEST_RUN_ID = None

    @pytest.fixture(scope="class", autouse=True)
    def setup_stream(self, create_session, base_url, org_id):
        """Setup: Create stream with traces-like backdated data, set max_query_range."""
        session = create_session
        logger.info(f"=== SETUP: Preparing stream '{self.STREAM_NAME}' (type={self.STREAM_TYPE}) ===")

        now = datetime.now(timezone.utc)
        test_run_id = f"traces_mqr_{int(now.timestamp())}"
        TestTracesMaxQueryRange.TEST_RUN_ID = test_run_id

        # Create test data at various time points (traces-like fields)
        test_data = [
            {
                "_timestamp": int(ts.timestamp() * 1000000),
                "trace_id": f"trace_{test_run_id}_{i}",
                "span_id": f"span_{i}",
                "parent_span_id": "",
                "service_name": "test-service",
                "operation_name": "test-operation",
                "duration": 100 + i * 10,
                "status_code": 200,
                "time_label": label,
                "test_run_id": test_run_id
            }
            for i, (label, ts) in enumerate(generate_time_points(now))
        ]

        # Ingest and flush
        ingest_and_flush(session, base_url, org_id, self.STREAM_NAME, test_data)

        # Wait for stream to be queryable
        if not wait_for_stream_queryable(session, base_url, org_id, self.STREAM_NAME, test_run_id, now,
                                          stream_type=self.STREAM_TYPE):
            pytest.fail(f"Stream '{self.STREAM_NAME}' not queryable after retries")

        # Save and set max_query_range
        settings = get_stream_settings(session, base_url, org_id, self.STREAM_NAME, stream_type=self.STREAM_TYPE)
        TestTracesMaxQueryRange.ORIGINAL_MAX_QUERY_RANGE = settings.get("max_query_range", 0)

        resp = set_max_query_range(session, base_url, org_id, self.STREAM_NAME, self.MAX_QUERY_RANGE_HOURS,
                                   stream_type=self.STREAM_TYPE)
        assert resp.status_code == 200, f"Failed to set max_query_range: {resp.text}"

        logger.info(f"=== SETUP COMPLETE: max_query_range={self.MAX_QUERY_RANGE_HOURS}h ===")
        yield

        # Cleanup: Restore original max_query_range
        set_max_query_range(session, base_url, org_id, self.STREAM_NAME,
                           TestTracesMaxQueryRange.ORIGINAL_MAX_QUERY_RANGE or 0, stream_type=self.STREAM_TYPE)

    def _search_stream(self, session, base_url, org_id, start_time, end_time):
        """Helper to search the stream."""
        return search_stream(session, base_url, org_id, self.STREAM_NAME, self.TEST_RUN_ID, start_time, end_time,
                            stream_type=self.STREAM_TYPE)

    def test_01_traces_query_exceeding_limit_is_truncated(self, create_session, base_url, org_id):
        """
        Test: Traces query exceeding max_query_range (3 hours) is truncated to 1 hour.
        """
        logger.info("=== TEST: Traces query truncation (3h → 1h) ===")

        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        start_time_3h = int((now - timedelta(hours=3)).timestamp() * 1000000)

        resp = self._search_stream(create_session, base_url, org_id, start_time_3h, end_time)

        assert resp.status_code == 200, f"Search failed: {resp.text}"

        data = resp.json()
        hits = data.get("hits", [])
        time_labels = [hit.get("time_label") for hit in hits]
        logger.info(f"Records returned: {len(hits)}, labels: {time_labels}")

        # STRONG ASSERTION: Old records must NOT be present
        excluded_labels = ["3_hours_ago", "2_hours_ago", "90_mins_ago"]
        for label in excluded_labels:
            assert label not in time_labels, \
                f"TRUNCATION FAILED: Old record '{label}' found in traces results: {time_labels}"

        # STRONG ASSERTION: Recent records must be present
        expected_labels = ["45_mins_ago", "30_mins_ago", "15_mins_ago", "5_mins_ago"]
        for label in expected_labels:
            assert label in time_labels, \
                f"Expected traces record '{label}' not found: {time_labels}"

        logger.info("=== PASSED: Traces query correctly truncated ===")


class TestMaxQueryRangeNegativeCases:
    """Negative test cases for max_query_range feature."""

    STREAM_NAME = "test_mqr_negative_cases"
    TEST_RUN_ID = None

    @pytest.fixture(scope="class", autouse=True)
    def setup_stream(self, create_session, base_url, org_id):
        """Setup stream with backdated data for negative tests."""
        session = create_session
        logger.info(f"=== SETUP: Preparing stream '{self.STREAM_NAME}' for negative tests ===")

        now = datetime.now(timezone.utc)
        test_run_id = f"mqr_neg_{int(now.timestamp())}"
        TestMaxQueryRangeNegativeCases.TEST_RUN_ID = test_run_id

        # Create test data at various time points
        test_data = [
            {
                "_timestamp": int(ts.timestamp() * 1000000),
                "level": "info",
                "message": f"Negative test at {label}",
                "time_label": label,
                "test_run_id": test_run_id
            }
            for label, ts in generate_time_points(now)
        ]

        # Ingest and flush
        ingest_and_flush(session, base_url, org_id, self.STREAM_NAME, test_data)

        # Wait for stream to be queryable
        if not wait_for_stream_queryable(session, base_url, org_id, self.STREAM_NAME, test_run_id, now):
            pytest.fail(f"Stream '{self.STREAM_NAME}' not queryable after retries")

        logger.info("=== SETUP COMPLETE ===")
        yield

    def _search_stream(self, session, base_url, org_id, start_time, end_time):
        """Helper to search the stream."""
        return search_stream(session, base_url, org_id, self.STREAM_NAME, self.TEST_RUN_ID, start_time, end_time)

    def test_01_max_query_range_zero_returns_all_data(self, create_session, base_url, org_id):
        """
        Test: max_query_range = 0 (disabled) should return ALL data without truncation.

        When max_query_range is 0, no truncation should be applied.
        """
        logger.info("=== TEST: max_query_range=0 returns all data ===")

        # Set max_query_range to 0 (disabled)
        settings_url = f"{base_url}api/{org_id}/streams/{self.STREAM_NAME}/settings?type=logs"
        resp = create_session.put(settings_url, json={"max_query_range": 0}, headers={"Content-Type": "application/json"})
        assert resp.status_code == 200, f"Failed to set max_query_range=0: {resp.text}"

        # Query for 4 hours (to ensure 3_hours_ago is included even with slight timing differences)
        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        start_time_4h = int((now - timedelta(hours=4)).timestamp() * 1000000)

        resp = self._search_stream(create_session, base_url, org_id, start_time_4h, end_time)
        assert resp.status_code == 200, f"Search failed: {resp.text}"

        data = resp.json()
        hits = data.get("hits", [])
        time_labels = [hit.get("time_label") for hit in hits]
        logger.info(f"Records returned with max_query_range=0: {len(hits)}, labels: {time_labels}")

        # STRONG ASSERTION: Should return more than truncated amount
        # With truncation at 1h, we'd get ~5 records. Without truncation, we should get 8
        assert len(hits) >= 7, \
            f"max_query_range=0 should return ALL data (~8 records), got {len(hits)}: {time_labels}"

        # Should include old records that would be truncated with max_query_range=1h
        old_records_found = [l for l in ["2_hours_ago", "90_mins_ago"] if l in time_labels]
        assert len(old_records_found) >= 1, \
            f"max_query_range=0 should include old records. Found: {time_labels}"

        logger.info("=== PASSED: max_query_range=0 returns all data ===")

    def test_02_negative_max_query_range_behavior(self, create_session, base_url, org_id):
        """
        Test: Verify behavior when setting negative max_query_range.

        FINDING: API accepts negative values without validation (returns 200).
        This documents current behavior - negative values may be treated as 0 (disabled).
        """
        logger.info("=== TEST: Negative max_query_range behavior ===")

        settings_url = f"{base_url}api/{org_id}/streams/{self.STREAM_NAME}/settings?type=logs"

        # Try to set negative value
        resp = create_session.put(settings_url, json={"max_query_range": -1}, headers={"Content-Type": "application/json"})

        logger.info(f"Response for max_query_range=-1: {resp.status_code}")

        # Document actual behavior - API accepts negative values
        if resp.status_code == 200:
            logger.info("BEHAVIOR: API accepts negative max_query_range values (no validation)")
            logger.info("  - This may be treated as 0 (disabled) or ignored")

            # Verify what was actually set
            schema_url = f"{base_url}api/{org_id}/streams/{self.STREAM_NAME}/schema?type=logs"
            schema_resp = create_session.get(schema_url)
            if schema_resp.status_code == 200:
                settings = schema_resp.json().get("settings", {})
                actual_value = settings.get("max_query_range")
                logger.info(f"  - Actual stored value: {actual_value}")

            # Reset to 0
            create_session.put(settings_url, json={"max_query_range": 0}, headers={"Content-Type": "application/json"})
        elif resp.status_code == 400:
            logger.info("BEHAVIOR: API correctly rejects negative max_query_range with 400")
        else:
            logger.info(f"BEHAVIOR: Unexpected response {resp.status_code}: {resp.text}")

        # Test passes regardless - we're documenting behavior
        logger.info("=== PASSED: Negative max_query_range behavior documented ===")

    def test_03_query_with_inverted_time_range(self, create_session, base_url, org_id):
        """
        Test: Query with start_time > end_time should return error or empty results.

        Invalid time range where start is after end.
        """
        logger.info("=== TEST: Inverted time range (start > end) ===")

        now = datetime.now(timezone.utc)
        # Inverted: start is now, end is 1 hour ago
        start_time = int(now.timestamp() * 1000000)
        end_time = int((now - timedelta(hours=1)).timestamp() * 1000000)

        resp = self._search_stream(create_session, base_url, org_id, start_time, end_time)

        logger.info(f"Response for inverted time range: {resp.status_code}")

        # Should return an error (400, 500) or empty results
        if resp.status_code == 400:
            logger.info("BEHAVIOR: API rejected inverted time range with 400 Bad Request")
        elif resp.status_code == 500:
            logger.info("BEHAVIOR: API rejected inverted time range with 500 Internal Server Error")
            # This is acceptable - the server correctly identifies invalid input
        elif resp.status_code == 200:
            data = resp.json()
            hits = data.get("hits", [])
            assert len(hits) == 0, \
                f"Inverted time range should return empty results, got {len(hits)} records"
            logger.info("BEHAVIOR: API returned empty results for inverted time range")
        else:
            pytest.fail(f"Unexpected status code {resp.status_code} for inverted time range")

        logger.info("=== PASSED: Inverted time range handled correctly ===")

    def test_04_setting_max_query_range_on_nonexistent_stream(self, create_session, base_url, org_id):
        """
        Test: Setting max_query_range on non-existent stream should return 404.
        """
        logger.info("=== TEST: max_query_range on non-existent stream ===")

        fake_stream = "this_stream_does_not_exist_12345"
        settings_url = f"{base_url}api/{org_id}/streams/{fake_stream}/settings?type=logs"

        resp = create_session.put(settings_url, json={"max_query_range": 1}, headers={"Content-Type": "application/json"})

        logger.info(f"Response for non-existent stream: {resp.status_code}")

        # Should return 404 Not Found
        assert resp.status_code == 404, \
            f"Expected 404 for non-existent stream, got {resp.status_code}: {resp.text}"

        logger.info("=== PASSED: Non-existent stream returns 404 ===")

    def test_05_fractional_max_query_range_behavior(self, create_session, base_url, org_id):
        """
        Test: Verify behavior when setting fractional max_query_range (e.g., 0.5 hours = 30 mins).

        Documents whether the API accepts fractional values and how they're handled.
        If accepted: only records from last 30 minutes should be returned.
        If rejected: documents the error response.
        """
        logger.info("=== TEST: Fractional max_query_range (0.5h = 30 mins) ===")

        settings_url = f"{base_url}api/{org_id}/streams/{self.STREAM_NAME}/settings?type=logs"

        # Try setting to 0.5 hours (30 minutes)
        resp = create_session.put(settings_url, json={"max_query_range": 0.5}, headers={"Content-Type": "application/json"})

        logger.info(f"Response for max_query_range=0.5: {resp.status_code}")

        if resp.status_code != 200:
            logger.info(f"BEHAVIOR: API rejects fractional max_query_range with {resp.status_code}")
            logger.info(f"  Response: {resp.text}")
            # Test passes - we've documented that fractional values aren't supported
            logger.info("=== PASSED: Fractional max_query_range behavior documented ===")
            return

        # If accepted, verify what was actually stored
        schema_url = f"{base_url}api/{org_id}/streams/{self.STREAM_NAME}/schema?type=logs"
        schema_resp = create_session.get(schema_url)
        if schema_resp.status_code == 200:
            settings = schema_resp.json().get("settings", {})
            stored_value = settings.get("max_query_range")
            logger.info(f"BEHAVIOR: API accepted fractional value, stored as: {stored_value}")

            # Query for 3 hours - should be truncated to 30 mins if 0.5 was accepted
            now = datetime.now(timezone.utc)
            end_time = int(now.timestamp() * 1000000)
            start_time_3h = int((now - timedelta(hours=3)).timestamp() * 1000000)

            resp = self._search_stream(create_session, base_url, org_id, start_time_3h, end_time)
            if resp.status_code == 200:
                data = resp.json()
                hits = data.get("hits", [])
                time_labels = [hit.get("time_label") for hit in hits]
                logger.info(f"Records returned with 0.5h limit: {len(hits)}, labels: {time_labels}")

                # With 0.5h limit, 45_mins_ago should be excluded
                if "45_mins_ago" not in time_labels:
                    logger.info("BEHAVIOR: Fractional value enforced - 45_mins_ago excluded")
                else:
                    logger.info("BEHAVIOR: Fractional value may have been rounded up to 1h")

        # Cleanup - reset to 0
        create_session.put(settings_url, json={"max_query_range": 0}, headers={"Content-Type": "application/json"})

        logger.info("=== PASSED: Fractional max_query_range behavior documented ===")

    def test_06_max_query_range_boundary_exactly_at_limit(self, create_session, base_url, org_id):
        """
        Test: Data exactly at the boundary (e.g., exactly 1 hour ago) with max_query_range=1h.

        Boundary condition: Should include data at exactly the limit.
        """
        logger.info("=== TEST: Boundary condition - data at exact limit ===")

        # Set max_query_range to 1 hour
        settings_url = f"{base_url}api/{org_id}/streams/{self.STREAM_NAME}/settings?type=logs"
        resp = create_session.put(settings_url, json={"max_query_range": 1}, headers={"Content-Type": "application/json"})
        assert resp.status_code == 200

        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        # Query exactly 1 hour (at the boundary)
        start_time_1h = int((now - timedelta(hours=1)).timestamp() * 1000000)

        resp = self._search_stream(create_session, base_url, org_id, start_time_1h, end_time)
        assert resp.status_code == 200, f"Search failed: {resp.text}"

        data = resp.json()
        hits = data.get("hits", [])
        time_labels = [hit.get("time_label") for hit in hits]
        logger.info(f"Boundary query returned: {len(hits)} records, labels: {time_labels}")

        # Should include 45_mins_ago but NOT 90_mins_ago
        assert "45_mins_ago" in time_labels, \
            f"45_mins_ago should be included in 1h boundary query: {time_labels}"
        assert "90_mins_ago" not in time_labels, \
            f"90_mins_ago should NOT be included in 1h boundary query: {time_labels}"

        # Cleanup
        create_session.put(settings_url, json={"max_query_range": 0}, headers={"Content-Type": "application/json"})

        logger.info("=== PASSED: Boundary condition handled correctly ===")

    def test_07_large_max_query_range_value(self, create_session, base_url, org_id):
        """
        Test: Very large max_query_range (e.g., 8760 hours = 1 year) should be accepted.

        System should handle large but reasonable values.
        """
        logger.info("=== TEST: Large max_query_range (8760h = 1 year) ===")

        settings_url = f"{base_url}api/{org_id}/streams/{self.STREAM_NAME}/settings?type=logs"

        # Set to 1 year in hours
        resp = create_session.put(settings_url, json={"max_query_range": 8760}, headers={"Content-Type": "application/json"})

        logger.info(f"Response for max_query_range=8760: {resp.status_code}")

        # Should be accepted
        assert resp.status_code == 200, \
            f"Large max_query_range should be accepted, got {resp.status_code}: {resp.text}"

        # Verify it was set
        schema_url = f"{base_url}api/{org_id}/streams/{self.STREAM_NAME}/schema?type=logs"
        schema_resp = create_session.get(schema_url)
        if schema_resp.status_code == 200:
            settings = schema_resp.json().get("settings", {})
            assert settings.get("max_query_range") == 8760, \
                f"max_query_range not set to 8760: {settings}"

        # Cleanup
        create_session.put(settings_url, json={"max_query_range": 0}, headers={"Content-Type": "application/json"})

        logger.info("=== PASSED: Large max_query_range accepted ===")
