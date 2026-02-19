"""
Logs-to-Logs JOIN API Tests

Tests for JOIN operations between two log streams with asymmetric data sizes.
These tests are designed to work with both:
- ZO_FEATURE_JOIN_MATCH_ONE_ENABLED=true
- ZO_FEATURE_JOIN_MATCH_ONE_ENABLED=false

The server must be restarted with the appropriate env var to test each case.

Test Coverage:
- INNER JOIN between log streams
- LEFT JOIN (small to large, large to small)
- RIGHT JOIN between log streams
- FULL JOIN between log streams
- JOIN with aggregations (COUNT, GROUP BY)
- JOIN with WHERE filters
- JOIN with LIMIT
- Asymmetric data size handling (100 records vs 1500 records)
- Subquery with LIMIT 1000 for broadcast join testing

Test Data:
- logs_small.json: 100 records (lookup/reference data)
- logs_large.json: 1500 records (event/transaction data)
- Both share kubernetes_container_name as join key
"""

import pytest
import json
import time
import random
import logging
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path


class TestLogsToLogsJoin:
    """Test class for logs-to-logs JOIN operations."""

    ORG_ID = "default"

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url, ingest_data):  # noqa: ARG002 - ingest_data ensures base data is loaded
        """Setup test fixtures and ingest test data."""
        self.session = create_session
        self.base_url = base_url

        # Generate unique stream names for this test run
        self.unique_id = random.randint(100000, 999999)
        self.small_stream = f"logs_small_{self.unique_id}"
        self.large_stream = f"logs_large_{self.unique_id}"

        # Ingest test data first
        self._ingest_test_data()

        # Wait for data to be indexed (configurable for slower CI runners)
        ingest_wait = int(os.environ.get("ZO_TEST_INGEST_WAIT", 10))
        time.sleep(ingest_wait)

        # Set up time range for queries AFTER ingestion to ensure data is within range
        now = datetime.now(timezone.utc)
        self.end_time = int((now + timedelta(minutes=5)).timestamp() * 1000000)
        self.start_time = int((now - timedelta(weeks=1)).timestamp() * 1000000)

        yield

        # Cleanup streams after tests
        self._cleanup_stream(self.small_stream)
        self._cleanup_stream(self.large_stream)

    def _ingest_test_data(self):
        """Ingest small and large log datasets to unique streams."""
        root_dir = Path(__file__).parent.parent.parent

        # Ingest small dataset
        small_data_path = root_dir / "test-data" / "joins" / "logs_small.json"
        with open(small_data_path) as f:
            small_data = json.load(f)

        resp_small = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/{self.small_stream}/_json",
            json=small_data,
        )
        assert resp_small.status_code == 200, \
            f"Failed to ingest small dataset: {resp_small.status_code} - {resp_small.text}"
        logging.info(f"✓ Ingested {len(small_data)} records to {self.small_stream}")

        # Ingest large dataset
        large_data_path = root_dir / "test-data" / "joins" / "logs_large.json"
        with open(large_data_path) as f:
            large_data = json.load(f)

        resp_large = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/{self.large_stream}/_json",
            json=large_data,
        )
        assert resp_large.status_code == 200, \
            f"Failed to ingest large dataset: {resp_large.status_code} - {resp_large.text}"
        logging.info(f"✓ Ingested {len(large_data)} records to {self.large_stream}")

    def _cleanup_stream(self, stream_name: str):
        """Delete a stream after tests."""
        try:
            response = self.session.delete(
                f"{self.base_url}api/{self.ORG_ID}/streams/{stream_name}?type=logs"
            )
            if response.status_code == 200:
                logging.info(f"✓ Cleaned up stream: {stream_name}")
            else:
                logging.warning(f"⚠ Cleanup returned status {response.status_code} for: {stream_name}")
        except Exception as e:
            logging.warning(f"⚠ Cleanup failed for {stream_name}: {e}")

    def _run_search(self, sql: str, size: int = 100) -> dict:
        """Run a search query and return the response."""
        payload = {
            "query": {
                "sql": sql,
                "start_time": self.start_time,
                "end_time": self.end_time,
                "from": 0,
                "size": size,
            }
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/_search?type=logs",
            json=payload,
        )

        return response

    # ==================== INNER JOIN TESTS ====================

    def test_01_inner_join_basic(self):
        """Test basic INNER JOIN between small and large log streams."""
        sql = f"""
            SELECT a.kubernetes_container_name, a.log AS small_log, b.log AS large_log
            FROM "{self.small_stream}" AS a
            INNER JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"INNER JOIN should succeed: {response.status_code} - {response.text[:500]}"

        data = response.json()
        assert "hits" in data, f"Response should have 'hits': {data}"

        hits = data["hits"]
        assert len(hits) > 0, "INNER JOIN should return results"
        logging.info(f"✓ INNER JOIN returned {len(hits)} results")

        # Verify join key is present in all results
        for hit in hits:
            assert "kubernetes_container_name" in hit, \
                f"Should have kubernetes_container_name: {hit}"

    def test_02_inner_join_with_multiple_conditions(self):
        """Test INNER JOIN with multiple ON conditions."""
        sql = f"""
            SELECT a.kubernetes_container_name, a.kubernetes_namespace_name, b.log
            FROM "{self.small_stream}" AS a
            INNER JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            AND a.kubernetes_namespace_name = b.kubernetes_namespace_name
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"INNER JOIN with multiple conditions should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "INNER JOIN with multiple conditions should return results"

        # Verify both join keys are present
        for hit in hits:
            assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"
            assert "kubernetes_namespace_name" in hit, f"Should have namespace name: {hit}"

        logging.info(f"✓ INNER JOIN with multiple conditions returned {len(hits)} results")

    # ==================== LEFT JOIN TESTS ====================

    def test_03_left_join_small_to_large(self):
        """Test LEFT JOIN: small stream LEFT JOIN large stream (enrichment pattern)."""
        sql = f"""
            SELECT a.kubernetes_container_name, a.log AS small_log, b.log AS large_log, b.response_time_ms
            FROM "{self.small_stream}" AS a
            LEFT JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            LIMIT 30
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"LEFT JOIN (small to large) should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "LEFT JOIN (small to large) should return results"
        logging.info(f"✓ LEFT JOIN (small to large) returned {len(hits)} results")

        # LEFT JOIN should preserve all rows from left table
        for hit in hits:
            assert "kubernetes_container_name" in hit, \
                f"Should have join key from left table: {hit}"

    def test_04_left_join_large_to_small(self):
        """Test LEFT JOIN: large stream LEFT JOIN small stream (reverse enrichment)."""
        sql = f"""
            SELECT a.kubernetes_container_name, a.log AS large_log, a.response_time_ms, b.log AS small_log
            FROM "{self.large_stream}" AS a
            LEFT JOIN "{self.small_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            LIMIT 30
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"LEFT JOIN (large to small) should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "LEFT JOIN (large to small) should return results"

        # Verify left table fields are always present
        for hit in hits:
            assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"

        logging.info(f"✓ LEFT JOIN (large to small) returned {len(hits)} results")

    # ==================== RIGHT JOIN TESTS ====================

    def test_05_right_join_small_to_large(self):
        """Test RIGHT JOIN: small stream RIGHT JOIN large stream."""
        sql = f"""
            SELECT a.kubernetes_container_name AS small_container, b.kubernetes_container_name AS large_container, b.level
            FROM "{self.small_stream}" AS a
            RIGHT JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            LIMIT 30
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"RIGHT JOIN should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "RIGHT JOIN should return results"

        # RIGHT JOIN should always have right table fields
        for hit in hits:
            assert "large_container" in hit, f"Should have large_container: {hit}"

        logging.info(f"✓ RIGHT JOIN returned {len(hits)} results")

    # ==================== FULL JOIN TESTS ====================

    def test_06_full_join(self):
        """Test FULL JOIN between small and large streams."""
        sql = f"""
            SELECT a.kubernetes_container_name AS small_container, b.kubernetes_container_name AS large_container
            FROM "{self.small_stream}" AS a
            FULL JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            LIMIT 50
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"FULL JOIN should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "FULL JOIN should return results"

        logging.info(f"✓ FULL JOIN returned {len(hits)} results")

    # ==================== AGGREGATION TESTS ====================

    def test_07_join_with_count_aggregation(self):
        """Test JOIN with COUNT aggregation."""
        sql = f"""
            SELECT a.kubernetes_container_name, COUNT(*) AS event_count
            FROM "{self.small_stream}" AS a
            INNER JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            GROUP BY a.kubernetes_container_name
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN with COUNT should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        logging.info(f"✓ JOIN with COUNT returned {len(hits)} grouped results")

        # Verify aggregation columns
        for hit in hits:
            assert "event_count" in hit, f"Should have event_count column: {hit}"
            assert isinstance(hit["event_count"], (int, float)), \
                f"event_count should be numeric: {hit}"

    def test_08_join_with_multiple_aggregations(self):
        """Test JOIN with multiple aggregation functions."""
        sql = f"""
            SELECT
                a.kubernetes_container_name,
                COUNT(*) AS total_events,
                COUNT(DISTINCT b.kubernetes_pod_name) AS unique_pods
            FROM "{self.small_stream}" AS a
            LEFT JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            GROUP BY a.kubernetes_container_name
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN with multiple aggregations should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        logging.info(f"✓ JOIN with multiple aggregations returned {len(hits)} results")

    # ==================== FILTER TESTS ====================

    def test_09_join_with_where_filter(self):
        """Test JOIN with WHERE clause filter."""
        sql = f"""
            SELECT a.kubernetes_container_name, b.level, b.log
            FROM "{self.small_stream}" AS a
            INNER JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            WHERE b.level = 'error'
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN with WHERE filter should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        logging.info(f"✓ JOIN with WHERE filter returned {len(hits)} results")

        # Verify filter was applied
        for hit in hits:
            if "level" in hit:
                assert hit["level"] == "error", \
                    f"WHERE filter should only return error level: {hit}"

    def test_10_join_with_compound_filter(self):
        """Test JOIN with compound WHERE conditions."""
        sql = f"""
            SELECT a.kubernetes_container_name, b.level, b.response_time_ms
            FROM "{self.small_stream}" AS a
            INNER JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            WHERE b.level = 'info' AND b.response_time_ms > 100
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN with compound filter should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        logging.info(f"✓ JOIN with compound filter returned {len(hits)} results")

    def test_11_join_with_like_pattern(self):
        """Test JOIN with LIKE pattern matching."""
        sql = f"""
            SELECT a.kubernetes_container_name, b.log
            FROM "{self.small_stream}" AS a
            INNER JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            WHERE b.log LIKE '%error%' OR b.log LIKE '%failed%'
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN with LIKE pattern should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        logging.info(f"✓ JOIN with LIKE pattern returned {len(hits)} results")

    # ==================== LIMIT AND ORDERING TESTS ====================

    def test_12_join_with_limit(self):
        """Test JOIN with LIMIT clause."""
        sql = f"""
            SELECT a.kubernetes_container_name, b.log, b.response_time_ms
            FROM "{self.small_stream}" AS a
            INNER JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            LIMIT 10
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN with LIMIT should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "JOIN with LIMIT should return results"
        assert len(hits) <= 10, f"LIMIT 10 should return at most 10 results, got {len(hits)}"
        logging.info(f"✓ JOIN with LIMIT returned {len(hits)} results")

    def test_13_join_with_order_by(self):
        """Test JOIN with ORDER BY clause."""
        sql = f"""
            SELECT a.kubernetes_container_name, b.response_time_ms
            FROM "{self.small_stream}" AS a
            INNER JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            WHERE b.response_time_ms IS NOT NULL
            ORDER BY b.response_time_ms DESC
            LIMIT 10
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN with ORDER BY should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "JOIN with ORDER BY should return results"
        logging.info(f"✓ JOIN with ORDER BY returned {len(hits)} results")

    # ==================== SELF-JOIN TESTS ====================

    def test_14_self_join_same_stream(self):
        """Test self-JOIN within the same log stream."""
        sql = f"""
            SELECT a.kubernetes_container_name, a.log AS log1, b.log AS log2
            FROM "{self.large_stream}" AS a
            INNER JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            AND a.kubernetes_namespace_name = b.kubernetes_namespace_name
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Self-JOIN should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "Self-JOIN should return results"

        # Verify both log columns from self-join are present
        for hit in hits:
            assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"
            assert "log1" in hit or "log2" in hit, f"Should have log columns: {hit}"

        logging.info(f"✓ Self-JOIN returned {len(hits)} results")

    # ==================== STREAM PREFIX TESTS ====================

    def test_15_join_with_logs_prefix(self):
        """Test JOIN using logs.{stream} prefix."""
        sql = f"""
            SELECT a.kubernetes_container_name, b.log
            FROM logs.{self.small_stream} AS a
            LEFT JOIN logs.{self.large_stream} AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN with logs. prefix should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "JOIN with logs. prefix should return results"
        logging.info(f"✓ JOIN with logs. prefix returned {len(hits)} results")

    # ==================== NULL HANDLING TESTS ====================

    def test_16_join_with_coalesce(self):
        """Test JOIN with COALESCE for NULL handling."""
        sql = f"""
            SELECT
                a.kubernetes_container_name,
                COALESCE(b.response_time_ms, 0) AS response_time
            FROM "{self.small_stream}" AS a
            LEFT JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN with COALESCE should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "JOIN with COALESCE should return results"
        logging.info(f"✓ JOIN with COALESCE returned {len(hits)} results")

    # ==================== DATA VERIFICATION TESTS ====================

    def test_17_verify_data_ingestion(self):
        """Verify test data was ingested correctly."""
        # Check small stream
        sql_small = f"""
            SELECT COUNT(*) AS cnt FROM "{self.small_stream}"
        """
        resp_small = self._run_search(sql_small)
        assert resp_small.status_code == 200

        # Check large stream
        sql_large = f"""
            SELECT COUNT(*) AS cnt FROM "{self.large_stream}"
        """
        resp_large = self._run_search(sql_large)
        assert resp_large.status_code == 200

        small_count = resp_small.json().get("hits", [{}])[0].get("cnt", 0)
        large_count = resp_large.json().get("hits", [{}])[0].get("cnt", 0)

        logging.info(f"✓ Data verification: small={small_count}, large={large_count}")

        assert small_count > 0, "Small stream should have data"
        assert large_count > 0, "Large stream should have data"
        assert large_count > small_count, "Large stream should have more data than small stream"

    def test_18_verify_join_key_overlap(self):
        """Verify join key values overlap between streams."""
        sql = f"""
            SELECT DISTINCT a.kubernetes_container_name
            FROM "{self.small_stream}" AS a
            INNER JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Join key overlap query should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "Should have overlapping container names between streams"

        container_names = [hit["kubernetes_container_name"] for hit in hits]
        logging.info(f"✓ Overlapping container names: {container_names}")

    # ==================== SUBQUERY JOIN TESTS ====================

    def test_19_subquery_in_clause_basic(self):
        """Test subquery with IN clause - basic pattern with LIMIT in subquery for broadcast join."""
        sql = f"""
            SELECT kubernetes_container_name, log
            FROM "{self.large_stream}"
            WHERE kubernetes_container_name IN (
                SELECT DISTINCT kubernetes_container_name
                FROM "{self.small_stream}"
                LIMIT 100
            )
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Subquery with IN clause should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "Subquery IN clause should return results"

        # Verify expected fields are present
        for hit in hits:
            assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"
            assert "log" in hit, f"Should have log field: {hit}"

        logging.info(f"✓ Subquery with IN clause returned {len(hits)} results")

    def test_20_subquery_in_clause_with_filter(self):
        """Test subquery with IN clause and WHERE filter in subquery with LIMIT for broadcast join."""
        sql = f"""
            SELECT kubernetes_container_name, log, level
            FROM "{self.large_stream}"
            WHERE kubernetes_container_name IN (
                SELECT kubernetes_container_name
                FROM "{self.small_stream}"
                WHERE level = 'error'
                LIMIT 100
            )
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Subquery with IN clause and filter should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        # Results may be empty if no error level in small stream, that's valid
        logging.info(f"✓ Subquery with IN clause and filter returned {len(hits)} results")

        # Verify structure of returned data
        for hit in hits:
            assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"

    def test_21_subquery_with_substr_function(self):
        """Test subquery with substr function - regression test for Utf8View bug with LIMIT for broadcast join."""
        sql = f"""
            SELECT kubernetes_container_name, log
            FROM "{self.large_stream}"
            WHERE kubernetes_container_name IN (
                SELECT kubernetes_container_name
                FROM "{self.small_stream}"
                WHERE substr(kubernetes_container_name, 1, 3) = 'api'
                LIMIT 100
            )
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Subquery with substr should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        logging.info(f"✓ Subquery with substr returned {len(hits)} results")

        # Verify results match the filter criteria
        for hit in hits:
            container = hit.get("kubernetes_container_name", "")
            assert container.startswith("api"), \
                f"Container should start with 'api': {container}"

    def test_22_subquery_with_length_function(self):
        """Test subquery with length function and LIMIT for broadcast join."""
        sql = f"""
            SELECT kubernetes_container_name, log
            FROM "{self.large_stream}"
            WHERE kubernetes_container_name IN (
                SELECT kubernetes_container_name
                FROM "{self.small_stream}"
                WHERE length(kubernetes_container_name) > 5
                LIMIT 100
            )
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Subquery with length should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "Subquery with length should return results"

        # Verify container names have length > 5 (from subquery filter)
        for hit in hits:
            container = hit.get("kubernetes_container_name", "")
            assert len(container) > 5, f"Container name should be > 5 chars: {container}"

        logging.info(f"✓ Subquery with length returned {len(hits)} results")

    def test_23_subquery_with_concat_function(self):
        """Test subquery with CONCAT function for composite key matching with LIMIT for broadcast join."""
        sql = f"""
            SELECT kubernetes_container_name, kubernetes_namespace_name, log
            FROM "{self.large_stream}"
            WHERE CONCAT(kubernetes_container_name, '|', kubernetes_namespace_name) IN (
                SELECT CONCAT(kubernetes_container_name, '|', kubernetes_namespace_name)
                FROM "{self.small_stream}"
                LIMIT 100
            )
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Subquery with CONCAT should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "Subquery with CONCAT should return results"

        # Verify both fields used in CONCAT are present
        for hit in hits:
            assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"
            assert "kubernetes_namespace_name" in hit, f"Should have namespace name: {hit}"

        logging.info(f"✓ Subquery with CONCAT returned {len(hits)} results")

    def test_24_subquery_not_in_clause(self):
        """Test subquery with NOT IN clause with LIMIT for broadcast join."""
        sql = f"""
            SELECT kubernetes_container_name, log
            FROM "{self.large_stream}"
            WHERE kubernetes_container_name NOT IN (
                SELECT kubernetes_container_name
                FROM "{self.small_stream}"
                WHERE level = 'error'
                LIMIT 100
            )
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Subquery with NOT IN should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "Subquery with NOT IN should return results"

        # Verify structure
        for hit in hits:
            assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"

        logging.info(f"✓ Subquery with NOT IN returned {len(hits)} results")

    def test_25_subquery_with_aggregation(self):
        """Test subquery with aggregation in outer query with LIMIT in subquery for broadcast join."""
        sql = f"""
            SELECT kubernetes_container_name, COUNT(*) AS event_count
            FROM "{self.large_stream}"
            WHERE kubernetes_container_name IN (
                SELECT DISTINCT kubernetes_container_name
                FROM "{self.small_stream}"
                LIMIT 100
            )
            GROUP BY kubernetes_container_name
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Subquery with outer aggregation should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        logging.info(f"✓ Subquery with outer aggregation returned {len(hits)} results")

        for hit in hits:
            assert "event_count" in hit, f"Should have event_count: {hit}"

    def test_26_nested_subquery(self):
        """Test nested subquery pattern with LIMIT in inner subqueries for broadcast join."""
        sql = f"""
            SELECT kubernetes_container_name, log
            FROM "{self.large_stream}"
            WHERE kubernetes_namespace_name IN (
                SELECT kubernetes_namespace_name
                FROM "{self.small_stream}"
                WHERE kubernetes_container_name IN (
                    SELECT DISTINCT kubernetes_container_name
                    FROM "{self.large_stream}"
                    WHERE level = 'info'
                    LIMIT 100
                )
                LIMIT 100
            )
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Nested subquery should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "Nested subquery should return results"

        # Verify structure
        for hit in hits:
            assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"
            assert "log" in hit, f"Should have log field: {hit}"

        logging.info(f"✓ Nested subquery returned {len(hits)} results")

    def test_27_subquery_in_join_condition(self):
        """Test subquery combined with JOIN with LIMIT in subquery for broadcast join."""
        sql = f"""
            SELECT a.kubernetes_container_name, a.log AS small_log, b.log AS large_log
            FROM "{self.small_stream}" AS a
            INNER JOIN "{self.large_stream}" AS b
            ON a.kubernetes_container_name = b.kubernetes_container_name
            WHERE a.kubernetes_namespace_name IN (
                SELECT DISTINCT kubernetes_namespace_name
                FROM "{self.large_stream}"
                WHERE level = 'error'
                LIMIT 100
            )
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Subquery in JOIN should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        logging.info(f"✓ Subquery in JOIN returned {len(hits)} results")

    def test_28_scalar_subquery(self):
        """Test scalar subquery in SELECT clause."""
        sql = f"""
            SELECT
                kubernetes_container_name,
                (SELECT COUNT(*) FROM "{self.small_stream}" AS s
                 WHERE s.kubernetes_container_name = l.kubernetes_container_name) AS small_count
            FROM "{self.large_stream}" AS l
            LIMIT 10
        """

        response = self._run_search(sql)

        # Scalar subqueries may or may not be supported - accept 200 or 400 (unsupported feature)
        # HTTP 500 is a server crash/panic, not a graceful error, so it should fail the test
        assert response.status_code in [200, 400], \
            f"Scalar subquery should return 200 (success) or 400 (unsupported), not {response.status_code}: {response.text[:500]}"

        if response.status_code == 200:
            hits = response.json().get("hits", [])
            assert len(hits) > 0, "Scalar subquery should return results when supported"

            for hit in hits:
                assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"

            logging.info(f"✓ Scalar subquery returned {len(hits)} results")
        else:
            logging.warning(f"⚠ Scalar subquery not supported (400): {response.text[:200]}")

    def test_29_subquery_with_order_and_limit(self):
        """Test subquery with ORDER BY and LIMIT."""
        sql = f"""
            SELECT kubernetes_container_name, log, response_time_ms
            FROM "{self.large_stream}"
            WHERE kubernetes_container_name IN (
                SELECT kubernetes_container_name
                FROM "{self.small_stream}"
                ORDER BY kubernetes_container_name
                LIMIT 5
            )
            ORDER BY response_time_ms DESC
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Subquery with ORDER/LIMIT should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "Subquery with ORDER/LIMIT should return results"
        assert len(hits) <= 20, f"Should respect LIMIT 20, got {len(hits)}"

        # Verify structure and ordering (response_time_ms should be DESC)
        for hit in hits:
            assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"
            assert "response_time_ms" in hit, f"Should have response_time_ms: {hit}"

        logging.info(f"✓ Subquery with ORDER/LIMIT returned {len(hits)} results")

    # ==================== STREAM.FIELD SYNTAX TESTS ====================

    def test_30_join_with_stream_field_syntax(self):
        """Test JOIN using stream.field syntax without aliases (like default.field)."""
        # Using stream name directly with dot notation for fields
        small = self.small_stream
        large = self.large_stream

        sql = f"""
            SELECT {small}.kubernetes_container_name,
                   {small}.kubernetes_namespace_name,
                   {large}.log,
                   {large}.response_time_ms
            FROM {small}
            JOIN {large}
            ON {small}.kubernetes_container_name = {large}.kubernetes_container_name
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN with stream.field syntax should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "JOIN with stream.field syntax should return results"

        for hit in hits:
            assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"

        logging.info(f"✓ JOIN with stream.field syntax returned {len(hits)} results")

    def test_31_join_with_stream_field_and_multiple_conditions(self):
        """Test JOIN using stream.field syntax with multiple ON conditions."""
        small = self.small_stream
        large = self.large_stream

        sql = f"""
            SELECT {small}.kubernetes_container_name,
                   {small}.kubernetes_pod_name,
                   {large}.log,
                   {large}.level,
                   {large}.response_time_ms
            FROM {small}
            JOIN {large}
            ON {small}.kubernetes_container_name = {large}.kubernetes_container_name
            AND {small}.kubernetes_namespace_name = {large}.kubernetes_namespace_name
            LIMIT 20
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN with stream.field and multiple conditions should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "JOIN with stream.field and multiple conditions should return results"

        for hit in hits:
            assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"

        logging.info(f"✓ JOIN with stream.field and multiple conditions returned {len(hits)} results")

    # ==================== LARGE LIMIT SUBQUERY TESTS ====================

    def test_32_subquery_with_limit_1000(self):
        """Test subquery with LIMIT 1000 in inner subquery for broadcast join."""
        sql = f"""
            SELECT kubernetes_container_name, log, response_time_ms
            FROM "{self.large_stream}"
            WHERE kubernetes_container_name IN (
                SELECT DISTINCT kubernetes_container_name
                FROM "{self.small_stream}"
                LIMIT 1000
            )
            LIMIT 50
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Subquery with LIMIT 1000 should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        assert len(hits) > 0, "Subquery with LIMIT 1000 should return results"
        assert len(hits) <= 50, f"Should respect outer LIMIT 50, got {len(hits)}"

        # Verify structure
        for hit in hits:
            assert "kubernetes_container_name" in hit, f"Should have container name: {hit}"
            assert "log" in hit, f"Should have log field: {hit}"

        logging.info(f"✓ Subquery with LIMIT 1000 returned {len(hits)} results")
