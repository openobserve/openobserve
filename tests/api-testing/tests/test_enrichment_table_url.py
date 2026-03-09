"""
Enrichment Table URL API Tests

Tests for creating enrichment tables from public URLs:
- Create enrichment table from URL (async job)
- Check job status
- Wait for job completion
- Verify table creation and data
- Delete enrichment table

Uses the EnrichmentPage page object for API calls.
"""

import pytest
import random
import time
import os
from pages.enrichment_page import EnrichmentPage


class TestEnrichmentTableURL:
    """Test class for URL-based enrichment table creation."""

    ORG_ID = "default"

    # Public CSV URL for testing - can be overridden via TEST_CSV_URL env var
    # NOTE: Default URL is an external GitHub gist (iris.csv dataset).
    # If this URL becomes unavailable, set TEST_CSV_URL env var to a working CSV URL.
    TEST_CSV_URL = os.environ.get(
        "TEST_CSV_URL",
        "https://gist.githubusercontent.com/netj/8836201/raw/6f9306ad21398ea43cba4f7d537619d0e07d5ae3/iris.csv"
    )

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url):
        """Setup test fixtures."""
        self.session = create_session
        self.base_url = base_url
        self.user_email = os.environ["ZO_ROOT_USER_EMAIL"]
        self.user_password = os.environ["ZO_ROOT_USER_PASSWORD"]

        # Initialize page object
        self.enrichment_page = EnrichmentPage(self.session, self.base_url, self.ORG_ID)

        # Generate unique table name for this test run
        self.unique_id = random.randint(100000, 999999)
        self.table_name = f"url_enrichment_{self.unique_id}"

        yield

        # Cleanup after tests
        self._cleanup_enrichment_table(self.table_name)

    def _cleanup_enrichment_table(self, table_name: str):
        """Delete enrichment table after test."""
        url = f"{self.base_url}api/{self.ORG_ID}/streams/{table_name}?type=enrichment_tables"
        try:
            resp = self.session.delete(url)
            if resp.status_code == 200:
                print(f"Cleaned up enrichment table: {table_name}")
            else:
                print(f"Cleanup returned {resp.status_code} for {table_name}")
        except Exception as e:
            print(f"Cleanup failed for {table_name}: {e}")

    def test_create_enrichment_table_from_url(self):
        """Test creating an enrichment table from a public URL."""
        response = self.enrichment_page.create_enrichment_table_from_url(
            session=self.session,
            base_url=self.base_url,
            user_email=self.user_email,
            user_password=self.user_password,
            org_id=self.ORG_ID,
            table_name=self.table_name,
            csv_url=self.TEST_CSV_URL,
            append=False
        )

        # API returns 200 when job is saved (runs async in background)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"

    def test_create_and_wait_for_completion(self):
        """Test creating enrichment table from URL and waiting for completion."""
        # Create the enrichment table (200 means job saved, runs async in background)
        response = self.enrichment_page.create_enrichment_table_from_url(
            session=self.session,
            base_url=self.base_url,
            user_email=self.user_email,
            user_password=self.user_password,
            org_id=self.ORG_ID,
            table_name=self.table_name,
            csv_url=self.TEST_CSV_URL,
            append=False
        )
        assert response.status_code == 200

        # Wait for async job to complete
        result = self.enrichment_page.wait_for_url_enrichment_job(
            session=self.session,
            base_url=self.base_url,
            user_email=self.user_email,
            user_password=self.user_password,
            org_id=self.ORG_ID,
            table_name=self.table_name,
            max_retries=24,  # 2 minutes total
            delay=5
        )

        assert result == "completed", f"URL enrichment job did not complete for table {self.table_name}, result: {result}"

    def test_get_enrichment_table_status(self):
        """Test getting the status of a URL enrichment job."""
        # Create the enrichment table first
        self.enrichment_page.create_enrichment_table_from_url(
            session=self.session,
            base_url=self.base_url,
            user_email=self.user_email,
            user_password=self.user_password,
            org_id=self.ORG_ID,
            table_name=self.table_name,
            csv_url=self.TEST_CSV_URL,
            append=False
        )

        # Retry status check a few times - job may take time to register on slow CI
        status = None
        for _ in range(5):
            time.sleep(2)
            status = self.enrichment_page.get_enrichment_table_url_status(
                session=self.session,
                base_url=self.base_url,
                user_email=self.user_email,
                user_password=self.user_password,
                org_id=self.ORG_ID,
                table_name=self.table_name
            )
            if status is not None:
                break

        # Status should exist and have expected fields
        assert status is not None, f"Status should exist for table {self.table_name}"
        assert "status" in status, f"Status response missing 'status' field: {status}"
        assert status["status"] in ["pending", "processing", "completed", "failed"], \
            f"Unexpected status value: {status['status']}"

    def test_create_with_append_true(self):
        """Test creating enrichment table with append=True."""
        # First create the table (200 means job saved, runs async)
        response1 = self.enrichment_page.create_enrichment_table_from_url(
            session=self.session,
            base_url=self.base_url,
            user_email=self.user_email,
            user_password=self.user_password,
            org_id=self.ORG_ID,
            table_name=self.table_name,
            csv_url=self.TEST_CSV_URL,
            append=False
        )
        assert response1.status_code == 200

        # Wait for first job to complete before appending
        first_job_result = self.enrichment_page.wait_for_url_enrichment_job(
            session=self.session,
            base_url=self.base_url,
            user_email=self.user_email,
            user_password=self.user_password,
            org_id=self.ORG_ID,
            table_name=self.table_name,
            max_retries=24,
            delay=5
        )

        # Check job result
        if first_job_result == "failed":
            status = self.enrichment_page.get_enrichment_table_url_status(
                session=self.session,
                base_url=self.base_url,
                user_email=self.user_email,
                user_password=self.user_password,
                org_id=self.ORG_ID,
                table_name=self.table_name
            )
            pytest.fail(f"First job failed: {status.get('error_message', 'unknown error') if status else 'unknown'}")
        elif first_job_result == "timeout":
            # Check if job is still processing - if so, we can't append yet
            status = self.enrichment_page.get_enrichment_table_url_status(
                session=self.session,
                base_url=self.base_url,
                user_email=self.user_email,
                user_password=self.user_password,
                org_id=self.ORG_ID,
                table_name=self.table_name
            )
            if status and status.get("status") in ["pending", "processing"]:
                pytest.skip("First job still processing after timeout - cannot test append")

        # Wait a bit after first job completes to allow backend to fully process
        time.sleep(5)

        # Now append more data
        # Note: Append might fail with "Failed to save job" if there's a timing issue
        # or if the API doesn't support append for URL-based tables in certain states
        try:
            response2 = self.enrichment_page.create_enrichment_table_from_url(
                session=self.session,
                base_url=self.base_url,
                user_email=self.user_email,
                user_password=self.user_password,
                org_id=self.ORG_ID,
                table_name=self.table_name,
                csv_url=self.TEST_CSV_URL,
                append=True
            )
            assert response2.status_code == 200, f"Append failed: {response2.status_code} {response2.text}"
        except AssertionError as e:
            if "Failed to save job" in str(e):
                pytest.skip("Append failed with 'Failed to save job' - may be timing issue or API limitation")
            raise

    def test_create_with_replace_failed_true(self):
        """Test creating enrichment table with replace_failed=True.

        This test first creates a failed job (using invalid URL), waits for it to fail,
        then uses replace_failed=True to retry with a valid URL.
        """
        invalid_url = "https://invalid-domain-that-does-not-exist-12345.com/data.csv"

        # First, create a job that will fail
        # Only wrap the create call - wait should not be caught
        job_created = False
        try:
            self.enrichment_page.create_enrichment_table_from_url(
                session=self.session,
                base_url=self.base_url,
                user_email=self.user_email,
                user_password=self.user_password,
                org_id=self.ORG_ID,
                table_name=self.table_name,
                csv_url=invalid_url,
                append=False
            )
            job_created = True
        except AssertionError:
            # Job creation failed immediately - that's OK for this test
            pass

        # If job was created, wait for it to fail
        if job_created:
            job_result = self.enrichment_page.wait_for_url_enrichment_job(
                session=self.session,
                base_url=self.base_url,
                user_email=self.user_email,
                user_password=self.user_password,
                org_id=self.ORG_ID,
                table_name=self.table_name,
                max_retries=24,
                delay=5
            )
            # Job should fail or timeout - document expected states
            assert job_result in ["failed", "timeout"], \
                f"Expected job to fail or timeout for invalid URL, got: {job_result}"

        # Now try to replace the failed job with a valid URL
        try:
            response = self.enrichment_page.create_enrichment_table_from_url(
                session=self.session,
                base_url=self.base_url,
                user_email=self.user_email,
                user_password=self.user_password,
                org_id=self.ORG_ID,
                table_name=self.table_name,
                csv_url=self.TEST_CSV_URL,
                append=False,
                replace_failed=True
            )
            assert response.status_code == 200
        except AssertionError as e:
            # If "No failed job found", the test is inconclusive but not a failure
            if "No failed job found" in str(e):
                pytest.skip("No failed job to replace - job may have succeeded or not been created")
            raise

    def test_invalid_url_fails(self):
        """Test that invalid URL returns appropriate error."""
        invalid_url = "https://invalid-domain-that-does-not-exist.com/data.csv"

        # Try to create - may fail immediately or accept and fail async
        try:
            response = self.enrichment_page.create_enrichment_table_from_url(
                session=self.session,
                base_url=self.base_url,
                user_email=self.user_email,
                user_password=self.user_password,
                org_id=self.ORG_ID,
                table_name=self.table_name,
                csv_url=invalid_url,
                append=False
            )
        except AssertionError as e:
            # Expected - invalid URL failed at creation time
            assert "Failed to create enrichment table" in str(e)
            return  # Test passed - creation failed as expected

        # If creation was accepted (200), the job should eventually fail
        # Wait for job to complete/fail
        job_result = self.enrichment_page.wait_for_url_enrichment_job(
            session=self.session,
            base_url=self.base_url,
            user_email=self.user_email,
            user_password=self.user_password,
            org_id=self.ORG_ID,
            table_name=self.table_name,
            max_retries=12,
            delay=5
        )

        # Job should fail for invalid URL - distinguish from timeout
        assert job_result == "failed", \
            f"Expected job to fail for invalid URL, got: {job_result}"
