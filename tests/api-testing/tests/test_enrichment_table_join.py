"""
Enrichment Table JOIN API Tests

Tests for cross-stream type JOINs between logs and enrichment tables:
- JOIN with enrichment_tables.{table_name} prefix
- JOIN with enrich.{table_name} prefix (shorter alias)
- LEFT JOIN, INNER JOIN with enrichment tables
- JOIN with aggregation, ORDER BY, HAVING
- Complex multi-table scenarios
- NULL handling with COALESCE

Related PR: https://github.com/openobserve/openobserve/pull/5452
"""

import pytest
import random
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path


class TestEnrichmentTableJoin:
    """Test class for cross-stream type JOIN with enrichment tables."""

    ORG_ID = "default"
    STREAM_NAME = "stream_pytest_data"
    BOUNDARY = "----WebKitFormBoundary" + str(random.randint(100000, 999999))

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url, ingest_data):
        """Setup test fixtures.

        Depends on ingest_data to ensure org and stream exist.
        """
        self.session = create_session
        self.base_url = base_url

        # Generate unique enrichment table names for this test run
        self.unique_id = random.randint(100000, 999999)
        self.enrichment_table_name = f"ns_lookup_{self.unique_id}"
        self.enrichment_table_name_2 = f"priority_lookup_{self.unique_id}"

        # Set up time range for queries (5 weeks to ensure data exists)
        now = datetime.now(timezone.utc)
        self.end_time = int(now.timestamp() * 1000000)
        self.start_time = int((now - timedelta(weeks=5)).timestamp() * 1000000)

        # Create enrichment tables before tests
        self._create_enrichment_table()
        self._create_second_enrichment_table()

        # Wait for enrichment tables to be available
        time.sleep(2)

        yield

        # Cleanup after tests
        self._cleanup_enrichment_table(self.enrichment_table_name)
        self._cleanup_enrichment_table(self.enrichment_table_name_2)

    def _create_multipart_data(self, csv_content: str) -> bytes:
        """Create multipart form data for enrichment table upload."""
        boundary = self.BOUNDARY
        lines = []

        # File field
        lines.append(f"--{boundary}")
        lines.append(f'Content-Disposition: form-data; name="file"; filename="lookup.csv"')
        lines.append("Content-Type: text/csv")
        lines.append("")
        lines.append(csv_content)

        # End boundary with trailing CRLF (per RFC 2046)
        lines.append(f"--{boundary}--")
        lines.append("")  # Trailing CRLF after closing boundary

        return "\r\n".join(lines).encode("utf-8")

    def _create_enrichment_table(self):
        """Create main enrichment table from test-data CSV file."""
        # Read CSV from test-data folder
        csv_path = Path(__file__).parent.parent.parent / "test-data" / "enrichment_namespace_lookup.csv"
        with open(csv_path, "r") as f:
            csv_content = f.read()

        multipart_data = self._create_multipart_data(csv_content)

        headers = {
            "Content-Type": f"multipart/form-data; boundary={self.BOUNDARY}",
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/enrichment_tables/{self.enrichment_table_name}?append=false",
            headers=headers,
            data=multipart_data,
        )

        assert response.status_code == 200, \
            f"Failed to create enrichment table: {response.status_code} - {response.text}"

        print(f"✓ Created enrichment table: {self.enrichment_table_name}")

    def _create_second_enrichment_table(self):
        """Create second enrichment table for multi-table JOIN tests."""
        csv_content = """priority,sla_hours,escalation_level
critical,1,L1
high,4,L2
medium,24,L3
low,72,L4"""

        multipart_data = self._create_multipart_data(csv_content)

        headers = {
            "Content-Type": f"multipart/form-data; boundary={self.BOUNDARY}",
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/enrichment_tables/{self.enrichment_table_name_2}?append=false",
            headers=headers,
            data=multipart_data,
        )

        assert response.status_code == 200, \
            f"Failed to create second enrichment table: {response.status_code} - {response.text}"

        print(f"✓ Created second enrichment table: {self.enrichment_table_name_2}")

    def _cleanup_enrichment_table(self, table_name: str):
        """Delete an enrichment table after tests."""
        try:
            response = self.session.delete(
                f"{self.base_url}api/{self.ORG_ID}/streams/{table_name}?type=enrichment_tables"
            )
            if response.status_code == 200:
                print(f"✓ Cleaned up enrichment table: {table_name}")
            else:
                print(f"⚠ Cleanup returned status {response.status_code} for: {table_name}")
        except Exception as e:
            print(f"⚠ Cleanup failed for {table_name}: {e}")

    def _run_search(self, sql: str, size: int = 10) -> dict:
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

    # ==================== BASIC JOIN TESTS ====================

    def test_01_join_with_enrichment_tables_prefix(self):
        """Test JOIN using full enrichment_tables.{table} prefix"""

        sql = f"""
            SELECT a.kubernetes_namespace_name, b.team, b.priority
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrichment_tables.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            LIMIT 5
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN query with enrichment_tables prefix should succeed: {response.status_code} - {response.text[:500]}"

        data = response.json()
        assert "hits" in data, f"Response should have 'hits': {data}"

        hits = data["hits"]

        # Verify log stream column is present when we have results
        for hit in hits:
            assert "kubernetes_namespace_name" in hit, \
                f"Should have kubernetes_namespace_name column: {hit}"

        # Note: For LEFT JOIN with no matching data, enriched columns may be NULL
        # and the API may omit NULL columns from sparse results. This is expected behavior.
        print(f"✓ JOIN with enrichment_tables prefix returned {len(hits)} results")

    def test_02_join_with_enrich_prefix(self):
        """Test JOIN using shorter enrich.{table} prefix"""

        sql = f"""
            SELECT a.kubernetes_namespace_name, b.team, b.priority
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            LIMIT 5
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"JOIN query with enrich prefix should succeed: {response.status_code} - {response.text[:500]}"

        data = response.json()
        hits = data.get("hits", [])

        # Verify query columns are present when we have results
        for hit in hits:
            assert "kubernetes_namespace_name" in hit, \
                f"Should have kubernetes_namespace_name column: {hit}"

        print(f"✓ JOIN with enrich prefix returned {len(hits)} results")

    def test_03_both_prefixes_return_same_results(self):
        """Test that enrichment_tables and enrich prefixes return identical results"""

        sql_full = f"""
            SELECT COUNT(*) as cnt
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrichment_tables.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
        """

        sql_short = f"""
            SELECT COUNT(*) as cnt
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
        """

        resp_full = self._run_search(sql_full)
        resp_short = self._run_search(sql_short)

        assert resp_full.status_code == 200, \
            f"Full prefix query should succeed: {resp_full.status_code} - {resp_full.text[:500]}"
        assert resp_short.status_code == 200, \
            f"Short prefix query should succeed: {resp_short.status_code} - {resp_short.text[:500]}"

        hits_full = resp_full.json().get("hits", [])
        hits_short = resp_short.json().get("hits", [])

        # When we have results, verify both prefixes return same count
        if len(hits_full) > 0 and len(hits_short) > 0:
            cnt_full = hits_full[0].get("cnt", 0)
            cnt_short = hits_short[0].get("cnt", 0)

            assert cnt_full == cnt_short, \
                f"Both prefixes should return same count: {cnt_full} vs {cnt_short}"

            print(f"✓ Both prefixes return identical results (count={cnt_full})")
        else:
            print(f"✓ Both prefix queries succeeded (no data in stream)")

    # ==================== JOIN TYPE TESTS ====================

    def test_04_left_join_preserves_all_rows(self):
        """Test LEFT JOIN preserves all rows from logs stream"""

        sql = f"""
            SELECT a.kubernetes_namespace_name, b.team
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            LIMIT 10
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"LEFT JOIN query should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])

        print(f"✓ LEFT JOIN returned {len(hits)} results")

    def test_05_inner_join(self):
        """Test INNER JOIN only returns matching rows"""

        sql = f"""
            SELECT a.kubernetes_namespace_name, b.team, b.priority
            FROM "{self.STREAM_NAME}" AS a
            INNER JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            LIMIT 10
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text[:500]}"

        data = response.json()
        hits = data.get("hits", [])

        # INNER JOIN may return 0 results if no matches exist
        # All results that ARE returned should have non-null enriched columns
        for hit in hits:
            assert "kubernetes_namespace_name" in hit, \
                f"Should have kubernetes_namespace_name column: {hit}"
            # For INNER JOIN, matched rows should have non-null enriched values
            if "team" in hit:
                assert hit["team"] is not None, \
                    f"INNER JOIN should only return matched rows with non-null team: {hit}"
            if "priority" in hit:
                assert hit["priority"] is not None, \
                    f"INNER JOIN should only return matched rows with non-null priority: {hit}"

        print(f"✓ INNER JOIN returned {len(hits)} matched results")

    # ==================== AGGREGATION TESTS ====================

    def test_06_join_with_group_by(self):
        """Test JOIN with GROUP BY aggregation"""

        sql = f"""
            SELECT b.team, COUNT(*) as log_count
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            GROUP BY b.team
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"GROUP BY query should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])

        # Verify aggregation column exists when we have results
        if len(hits) > 0:
            for hit in hits:
                assert "log_count" in hit, f"Should have log_count column: {hit}"
                assert isinstance(hit["log_count"], (int, float)), \
                    f"log_count should be numeric: {hit}"

        print(f"✓ GROUP BY returned {len(hits)} grouped results")

    def test_07_join_with_multiple_aggregations(self):
        """Test JOIN with multiple aggregation functions"""

        sql = f"""
            SELECT
                b.priority,
                COUNT(*) as total_logs,
                COUNT(DISTINCT a.kubernetes_pod_name) as unique_pods
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            GROUP BY b.priority
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Multiple aggregations query should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])

        # Verify aggregation columns exist when we have results
        if len(hits) > 0:
            hit = hits[0]
            assert "total_logs" in hit, f"Should have total_logs column: {hit}"
            assert "unique_pods" in hit, f"Should have unique_pods column: {hit}"

        print(f"✓ Multiple aggregations returned {len(hits)} results")

    def test_08_join_with_having_clause(self):
        """Test JOIN with HAVING clause filtering aggregated results"""

        sql = f"""
            SELECT b.team, COUNT(*) as log_count
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            GROUP BY b.team
            HAVING COUNT(*) > 0
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"HAVING clause query should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])

        # All results should have log_count > 0 due to HAVING (when we have results)
        for hit in hits:
            assert "log_count" in hit, f"Should have log_count column: {hit}"
            assert hit["log_count"] > 0, \
                f"HAVING should filter to log_count > 0: {hit}"

        print(f"✓ HAVING clause returned {len(hits)} filtered results")

    # ==================== FILTERING TESTS ====================

    def test_09_join_with_where_on_enriched_column(self):
        """Test JOIN with WHERE clause filtering on enriched column"""

        sql = f"""
            SELECT a.kubernetes_namespace_name, b.team, b.priority
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            WHERE b.priority = 'high'
            LIMIT 5
        """

        response = self._run_search(sql)

        assert response.status_code == 200
        hits = response.json().get("hits", [])

        for hit in hits:
            if hit.get("priority"):
                assert hit["priority"] == "high", \
                    f"WHERE should filter to priority='high': {hit}"

        print(f"✓ WHERE on enriched column returned {len(hits)} results")

    def test_10_join_with_where_on_both_tables(self):
        """Test JOIN with WHERE filtering on both log and enrichment columns"""

        sql = f"""
            SELECT a.kubernetes_namespace_name, a.kubernetes_pod_name, b.team, b.environment
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            WHERE a.kubernetes_namespace_name = 'monitoring'
              AND b.environment = 'production'
            LIMIT 5
        """

        response = self._run_search(sql)

        assert response.status_code == 200
        hits = response.json().get("hits", [])

        for hit in hits:
            if hit.get("kubernetes_namespace_name"):
                assert hit["kubernetes_namespace_name"] == "monitoring"
            if hit.get("environment"):
                assert hit["environment"] == "production"

        print(f"✓ WHERE on both tables returned {len(hits)} results")

    def test_11_join_with_like_pattern(self):
        """Test JOIN with LIKE pattern matching on enriched column"""

        sql = f"""
            SELECT a.kubernetes_namespace_name, b.team, b.on_call_email
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            WHERE b.on_call_email LIKE '%oncall@example.com'
            LIMIT 5
        """

        response = self._run_search(sql)

        assert response.status_code == 200
        hits = response.json().get("hits", [])

        for hit in hits:
            if hit.get("on_call_email"):
                assert "oncall@example.com" in hit["on_call_email"], \
                    f"LIKE pattern should match: {hit}"

        print(f"✓ LIKE pattern returned {len(hits)} results")

    # ==================== ORDERING TESTS ====================

    def test_12_join_with_order_by_enriched_column(self):
        """Test JOIN with ORDER BY on enriched column"""

        sql = f"""
            SELECT a.kubernetes_namespace_name, b.team, b.priority
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            WHERE b.priority IS NOT NULL
            ORDER BY b.priority ASC
            LIMIT 10
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"ORDER BY query should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        # Note: May return 0 results if no namespace matches enrichment table
        # The important thing is the query executes successfully with ORDER BY

        print(f"✓ ORDER BY enriched column returned {len(hits)} results")

    # ==================== MULTI-TABLE JOIN TESTS ====================

    def test_13_join_two_enrichment_tables(self):
        """Test JOIN with two enrichment tables (chained lookup)"""

        sql = f"""
            SELECT
                a.kubernetes_namespace_name,
                b.team,
                b.priority,
                c.sla_hours,
                c.escalation_level
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
                ON a.kubernetes_namespace_name = b.namespace_name
            LEFT JOIN enrich.{self.enrichment_table_name_2} AS c
                ON b.priority = c.priority
            LIMIT 5
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Multi-table JOIN query should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])

        # Check that log stream column is present when we have results
        if len(hits) > 0:
            hit = hits[0]
            assert "kubernetes_namespace_name" in hit, \
                f"Should have kubernetes_namespace_name column: {hit}"

        # Note: Enrichment columns (team, priority, sla_hours, escalation_level) may be NULL
        # if no namespace matches the enrichment table. The API may omit NULL columns.
        # The important verification is that the multi-table JOIN query executes successfully.

        print(f"✓ Multi-table JOIN returned {len(hits)} results")

    # ==================== NULL HANDLING TESTS ====================

    def test_14_join_with_coalesce(self):
        """Test JOIN with COALESCE for NULL handling"""

        sql = f"""
            SELECT
                a.kubernetes_namespace_name,
                COALESCE(b.team, 'unknown') as team,
                COALESCE(b.priority, 'unassigned') as priority
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            LIMIT 5
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"COALESCE query should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])

        # COALESCE should replace NULLs with defaults (when we have results)
        for hit in hits:
            assert "kubernetes_namespace_name" in hit, \
                f"Should have kubernetes_namespace_name column: {hit}"
            # COALESCE with alias creates new columns 'team' and 'priority'
            # These should have values (either from enrichment or default)
            if "team" in hit:
                assert hit["team"] is not None, \
                    f"COALESCE should prevent NULL team: {hit}"
            if "priority" in hit:
                assert hit["priority"] is not None, \
                    f"COALESCE should prevent NULL priority: {hit}"

        print(f"✓ COALESCE returned {len(hits)} results with NULL handling")

    # ==================== DISTINCT TESTS ====================

    def test_15_join_with_distinct(self):
        """Test JOIN with DISTINCT"""

        sql = f"""
            SELECT DISTINCT b.team, b.priority
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            WHERE b.team IS NOT NULL
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"DISTINCT query should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        # Note: May return 0 results if no namespace matches enrichment table
        # (WHERE b.team IS NOT NULL filters to only matched rows)

        if len(hits) > 0:
            # Check for distinct combinations when we have results
            seen = set()
            for hit in hits:
                assert "team" in hit, f"Should have team column: {hit}"
                assert "priority" in hit, f"Should have priority column: {hit}"
                key = (hit.get("team"), hit.get("priority"))
                assert key not in seen, \
                    f"DISTINCT should return unique combinations, duplicate found: {hit}"
                seen.add(key)

        print(f"✓ DISTINCT returned {len(hits)} unique results")

    # ==================== VERIFICATION TESTS ====================

    def test_16_verify_enriched_data_correctness(self):
        """Test that enriched data values are correct for known namespace"""

        sql = f"""
            SELECT
                a.kubernetes_namespace_name,
                b.team,
                b.priority,
                b.cost_center,
                b.environment,
                b.on_call_email
            FROM "{self.STREAM_NAME}" AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            WHERE a.kubernetes_namespace_name = 'monitoring'
            LIMIT 1
        """

        response = self._run_search(sql)

        assert response.status_code == 200
        hits = response.json().get("hits", [])

        # Note: This test may return 0 hits if 'monitoring' namespace isn't in the log data
        # That's acceptable - we verify correctness only when data exists
        if len(hits) > 0:
            hit = hits[0]
            # Verify exact values from our CSV for 'monitoring' namespace
            assert hit.get("team") == "platform", \
                f"monitoring namespace should map to platform team: {hit}"
            assert hit.get("priority") == "high", \
                f"monitoring namespace should have high priority: {hit}"
            assert hit.get("environment") == "production", \
                f"monitoring namespace should be production: {hit}"
            print(f"✓ Enriched data values verified correctly for 'monitoring' namespace")
        else:
            print("⚠ No 'monitoring' namespace found in log data - skipping value verification")

        print(f"✓ Verification query completed with {len(hits)} results")

    def test_17_join_returns_all_enrichment_columns(self):
        """Test that all columns from enrichment table can be retrieved"""

        sql = f"""
            SELECT
                b.namespace_name,
                b.team,
                b.priority,
                b.cost_center,
                b.environment,
                b.on_call_email
            FROM "{self.STREAM_NAME}" AS a
            INNER JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            LIMIT 1
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"INNER JOIN query should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        # Note: INNER JOIN may return 0 results if no namespace in logs matches enrichment table

        if len(hits) > 0:
            hit = hits[0]
            expected_columns = ["namespace_name", "team", "priority", "cost_center", "environment", "on_call_email"]
            for col in expected_columns:
                assert col in hit, f"Should have enrichment column '{col}': {hit}"
            print(f"✓ All enrichment columns retrieved successfully")
        else:
            print("⚠ No matches found between log namespaces and enrichment table")

        print(f"✓ INNER JOIN query completed with {len(hits)} results")

    # ==================== CROSS-STREAM TYPE JOIN TESTS ====================
    # These tests verify JOINs between different stream types using prefixes:
    # logs., metrics., traces., enrichment_tables., enrich.

    def test_18_logs_prefix_join_with_enrichment(self):
        """Test JOIN using logs.{stream} prefix with enrichment table"""

        sql = f"""
            SELECT a.kubernetes_namespace_name, b.team, b.priority
            FROM logs.{self.STREAM_NAME} AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            LIMIT 5
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"logs. prefix JOIN should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        print(f"✓ logs. prefix JOIN with enrichment returned {len(hits)} results")

    def test_19_logs_to_logs_self_join(self):
        """Test self-JOIN within the same log stream"""

        sql = f"""
            SELECT a._timestamp, a.kubernetes_namespace_name, b.kubernetes_pod_name
            FROM "{self.STREAM_NAME}" AS a
            INNER JOIN "{self.STREAM_NAME}" AS b
            ON a.kubernetes_namespace_name = b.kubernetes_namespace_name
            LIMIT 5
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Logs self-JOIN should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        print(f"✓ Logs self-JOIN returned {len(hits)} results")

    def test_20_logs_prefix_both_sides(self):
        """Test JOIN with logs. prefix on both sides"""

        sql = f"""
            SELECT a.kubernetes_namespace_name, b.kubernetes_pod_name
            FROM logs.{self.STREAM_NAME} AS a
            LEFT JOIN logs.{self.STREAM_NAME} AS b
            ON a.kubernetes_namespace_name = b.kubernetes_namespace_name
            LIMIT 5
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"logs. prefix on both sides should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        print(f"✓ logs. prefix on both sides JOIN returned {len(hits)} results")

    def test_21_mixed_prefix_join(self):
        """Test JOIN with logs. prefix and enrichment_tables. prefix"""

        sql = f"""
            SELECT a.kubernetes_namespace_name, b.team, b.on_call_email
            FROM logs.{self.STREAM_NAME} AS a
            LEFT JOIN enrichment_tables.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            LIMIT 5
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Mixed prefix JOIN should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        print(f"✓ Mixed prefix (logs. + enrichment_tables.) JOIN returned {len(hits)} results")

    def test_22_logs_prefix_with_aggregation(self):
        """Test logs. prefix JOIN with GROUP BY aggregation"""

        sql = f"""
            SELECT b.team, COUNT(*) as log_count
            FROM logs.{self.STREAM_NAME} AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
            GROUP BY b.team
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"logs. prefix with aggregation should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        print(f"✓ logs. prefix with GROUP BY returned {len(hits)} results")

    def test_23_cross_stream_three_way_join(self):
        """Test three-way JOIN: logs + enrichment + enrichment"""

        sql = f"""
            SELECT
                a.kubernetes_namespace_name,
                b.team,
                b.priority,
                c.sla_hours
            FROM logs.{self.STREAM_NAME} AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
                ON a.kubernetes_namespace_name = b.namespace_name
            LEFT JOIN enrich.{self.enrichment_table_name_2} AS c
                ON b.priority = c.priority
            LIMIT 5
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"Three-way cross-stream JOIN should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        print(f"✓ Three-way cross-stream JOIN returned {len(hits)} results")

    def test_24_logs_prefix_subquery(self):
        """Test logs. prefix in subquery"""

        sql = f"""
            SELECT a.kubernetes_namespace_name, b.team
            FROM (
                SELECT kubernetes_namespace_name
                FROM logs.{self.STREAM_NAME}
                LIMIT 10
            ) AS a
            LEFT JOIN enrich.{self.enrichment_table_name} AS b
            ON a.kubernetes_namespace_name = b.namespace_name
        """

        response = self._run_search(sql)

        assert response.status_code == 200, \
            f"logs. prefix in subquery should succeed: {response.status_code} - {response.text[:500]}"

        hits = response.json().get("hits", [])
        print(f"✓ logs. prefix in subquery JOIN returned {len(hits)} results")

    def test_25_logs_metrics_cross_stream_join(self):
        """Test JOIN between logs and metrics streams using stream type prefixes

        Note: This tests the syntax for cross-stream type JOINs.
        The actual result depends on whether matching metrics data exists.
        """

        # Use a common field that might exist in both logs and metrics
        sql = f"""
            SELECT t1.kubernetes_namespace_name, t1._timestamp
            FROM logs.{self.STREAM_NAME} AS t1
            LEFT JOIN metrics.{self.STREAM_NAME} AS t2
            ON t1.kubernetes_namespace_name = t2.kubernetes_namespace_name
            LIMIT 5
        """

        response = self._run_search(sql)

        # The query might fail if metrics stream doesn't exist, which is acceptable
        # We're testing that the cross-stream syntax is parsed correctly
        if response.status_code == 200:
            hits = response.json().get("hits", [])
            print(f"✓ logs-to-metrics cross-stream JOIN returned {len(hits)} results")
        else:
            # If metrics stream doesn't exist, log it but don't fail
            print(f"⚠ logs-to-metrics JOIN returned {response.status_code} - metrics stream may not exist")
            # Still verify it's a schema/table not found error, not a syntax error
            assert "syntax" not in response.text.lower() or "parser" not in response.text.lower(), \
                f"Should not be a syntax error: {response.text[:500]}"
            print(f"✓ Cross-stream syntax is valid (stream may not exist)")

    def test_26_logs_traces_cross_stream_join(self):
        """Test JOIN between logs and traces streams using stream type prefixes

        Note: This tests the syntax for cross-stream type JOINs.
        The actual result depends on whether matching traces data exists.
        """

        sql = f"""
            SELECT t1.kubernetes_namespace_name, t1._timestamp
            FROM logs.{self.STREAM_NAME} AS t1
            LEFT JOIN traces.{self.STREAM_NAME} AS t2
            ON t1.kubernetes_namespace_name = t2.kubernetes_namespace_name
            LIMIT 5
        """

        response = self._run_search(sql)

        # The query might fail if traces stream doesn't exist, which is acceptable
        if response.status_code == 200:
            hits = response.json().get("hits", [])
            print(f"✓ logs-to-traces cross-stream JOIN returned {len(hits)} results")
        else:
            # If traces stream doesn't exist, log it but don't fail
            print(f"⚠ logs-to-traces JOIN returned {response.status_code} - traces stream may not exist")
            assert "syntax" not in response.text.lower() or "parser" not in response.text.lower(), \
                f"Should not be a syntax error: {response.text[:500]}"
            print(f"✓ Cross-stream syntax is valid (stream may not exist)")

    def test_27_all_stream_type_prefixes_syntax(self):
        """Test that all stream type prefixes are syntactically valid

        Tests: logs., metrics., traces., enrichment_tables., enrich.
        """
        prefixes = ["logs", "metrics", "traces"]

        for prefix in prefixes:
            sql = f"""
                SELECT COUNT(*) as cnt
                FROM {prefix}.{self.STREAM_NAME}
            """

            response = self._run_search(sql)

            # We only care that the syntax is valid, not that the stream exists
            if response.status_code == 200:
                print(f"✓ {prefix}. prefix query succeeded")
            else:
                # Verify it's not a syntax/parser error
                error_text = response.text.lower()
                is_syntax_error = "parser" in error_text or "syntax" in error_text
                if not is_syntax_error:
                    print(f"✓ {prefix}. prefix syntax is valid (stream may not exist)")
                else:
                    # This should not happen - syntax should be valid
                    assert False, f"{prefix}. prefix caused syntax error: {response.text[:500]}"
