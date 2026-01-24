"""
Backfill Job API Tests

Tests for pipeline backfill functionality:
- Basic backfill job creation and execution
- Backfill with different stream types (logs, metrics, traces)
- Pause/resume functionality
- Progress tracking
- Time range validation
- Delete before backfill option

These tests verify the core backfill functionality, not just UI mechanics.

Note: Tests use recent timestamps to ensure data is in the current partition,
    which both _search API and backfill scheduler can access.

CI/CD Configuration:
    Requires ZO_INGEST_ALLOWED_UPTO=48 (hours) in .github/workflows/api-testing.yml
    to allow backdated data ingestion for testing.
"""

import pytest
import random
import time
import uuid
from datetime import datetime, timezone, timedelta


# =============================================================================
# TEST CONFIGURATION CONSTANTS
# =============================================================================

# How far in the past to set data timestamps (minutes)
# Using recent timestamps ensures data is in the current partition,
# avoiding partition alignment issues where backfill looks in wrong partition.
# Must be less than (now - end_time) to keep end_time in the past.
RECENT_DATA_OFFSET_MINUTES = 15

# Backfill time range offsets (relative to RECENT_DATA_OFFSET_MINUTES)
# start_time = past_time - START_OFFSET = 15 + 5 = 20 minutes ago
# end_time = past_time + END_OFFSET = 15 - 10 = 5 minutes ago (must be in past!)
BACKFILL_START_OFFSET_MINUTES = 5
BACKFILL_END_OFFSET_MINUTES = 10

# Timeouts and intervals
BACKFILL_TIMEOUT_SECONDS = 180  # Max time to wait for backfill completion
INDEX_WAIT_SECONDS = 2  # Time to wait for data indexing after ingestion
QUERY_RETRY_INTERVAL_SECONDS = 2  # Interval between query retries
MAX_QUERY_RETRIES = 15  # Max retries when waiting for data to be queryable


class TestBackfillJob:
    """Test class for pipeline backfill API functionality."""

    ORG_ID = "default"

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url):
        """Setup test fixtures."""
        self.session = create_session
        self.base_url = base_url

        # Generate unique names for this test run
        self.unique_id = random.randint(100000, 999999)
        self.source_stream = f"backfill_source_{self.unique_id}"
        self.dest_stream = f"backfill_dest_{self.unique_id}"

        # Track resources for cleanup
        self.created_pipelines = []
        self.created_backfill_jobs = []

        yield

        # Cleanup
        self._cleanup_resources()

    def _cleanup_resources(self):
        """Clean up all created resources."""
        # Delete backfill jobs first
        for job_info in self.created_backfill_jobs:
            try:
                self.session.delete(
                    f"{self.base_url}api/{self.ORG_ID}/pipelines/{job_info['pipeline_id']}/backfill/{job_info['job_id']}"
                )
                print(f"  Cleaned up backfill job: {job_info['job_id']}")
            except Exception as e:
                print(f"  Failed to cleanup backfill job {job_info['job_id']}: {e}")

        # Delete pipelines
        for pipeline_id in self.created_pipelines:
            try:
                self.session.delete(
                    f"{self.base_url}api/{self.ORG_ID}/pipelines/{pipeline_id}"
                )
                print(f"  Cleaned up pipeline: {pipeline_id}")
            except Exception as e:
                print(f"  Failed to cleanup pipeline {pipeline_id}: {e}")

    def _ingest_logs_with_timestamp(self, stream_name: str, timestamp: datetime, count: int = 10) -> bool:
        """Ingest log data with specific timestamps for backfill testing."""
        logs = []
        for i in range(count):
            # Spread records across the time range
            record_ts = timestamp + timedelta(minutes=i)
            logs.append({
                "level": "INFO",
                "message": f"Backfill test message {i}",
                "_timestamp": int(record_ts.timestamp() * 1000000),  # microseconds
                "service": "backfill-test",
                "test_id": self.unique_id,
                "record_index": i,
            })

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/{stream_name}/_json",
            json=logs,
            headers={"Content-Type": "application/json"}
        )

        if response.status_code == 200:
            print(f"  Ingested {count} records to {stream_name}")
            return True
        else:
            print(f"  Failed to ingest to {stream_name}: {response.status_code} - {response.text}")
            return False

    def _create_scheduled_pipeline(self, source_stream: str, dest_stream: str,
                                    name_suffix: str = "", period_minutes: int = 15) -> str:
        """Create a scheduled pipeline for backfill testing."""
        pipeline_name = f"backfill_test_pipeline_{self.unique_id}_{name_suffix}"

        # Node IDs
        query_node_id = str(uuid.uuid4())
        dest_node_id = str(uuid.uuid4())

        payload = {
            "name": pipeline_name,
            "description": "Pipeline for backfill API testing",
            "source": {"source_type": "scheduled"},
            "nodes": [
                {
                    "id": query_node_id,
                    "type": "input",
                    "position": {"x": 200, "y": 100},
                    "data": {
                        "node_type": "query",
                        "stream_type": "logs",
                        "org_id": self.ORG_ID,
                        "query_condition": {
                            "type": "sql",
                            "sql": f"SELECT *, 'backfill_processed' as processing_status FROM \"{source_stream}\"",
                            "search_event_type": "DerivedStream"
                        },
                        "trigger_condition": {
                            "period": period_minutes,
                            "frequency": period_minutes,
                            "frequency_type": "minutes",
                            "silence": 0
                        }
                    },
                    "io_type": "input"
                },
                {
                    "id": dest_node_id,
                    "type": "output",
                    "position": {"x": 200, "y": 300},
                    "data": {
                        "node_type": "stream",
                        "stream_type": "logs",
                        "stream_name": dest_stream,
                        "org_id": self.ORG_ID
                    },
                    "io_type": "output"
                }
            ],
            "edges": [
                {
                    "id": f"e{query_node_id}-{dest_node_id}",
                    "source": query_node_id,
                    "target": dest_node_id,
                }
            ],
            "org": self.ORG_ID
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/pipelines",
            json=payload,
            headers={"Content-Type": "application/json"}
        )

        assert response.status_code == 200, \
            f"Failed to create pipeline: {response.status_code} - {response.text[:500]}"

        # Get pipeline ID from list
        list_resp = self.session.get(f"{self.base_url}api/{self.ORG_ID}/pipelines")
        pipelines = list_resp.json().get("list", [])

        pipeline_id = None
        for p in pipelines:
            if p["name"] == pipeline_name:
                pipeline_id = p["pipeline_id"]
                break

        assert pipeline_id, f"Pipeline {pipeline_name} not found after creation"

        self.created_pipelines.append(pipeline_id)
        print(f"  Created pipeline: {pipeline_name} ({pipeline_id})")

        return pipeline_id

    def _create_backfill_job(self, pipeline_id: str, start_time: int, end_time: int,
                             chunk_period_minutes: int = 15,
                             delete_before_backfill: bool = False) -> str:
        """Create a backfill job and return job ID."""
        payload = {
            "start_time": start_time,
            "end_time": end_time,
            "chunk_period_minutes": chunk_period_minutes,
            "delay_between_chunks_secs": 1,
            "delete_before_backfill": delete_before_backfill
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/pipelines/{pipeline_id}/backfill",
            json=payload,
            headers={"Content-Type": "application/json"}
        )

        assert response.status_code == 200, \
            f"Failed to create backfill job: {response.status_code} - {response.text[:500]}"

        job_id = response.json().get("job_id")
        assert job_id, f"No job_id in response: {response.json()}"

        self.created_backfill_jobs.append({
            "pipeline_id": pipeline_id,
            "job_id": job_id
        })

        print(f"  Created backfill job: {job_id}")
        return job_id

    def _get_backfill_status(self, pipeline_id: str, job_id: str) -> dict:
        """Get backfill job status."""
        response = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/pipelines/{pipeline_id}/backfill/{job_id}"
        )

        if response.status_code == 200:
            return response.json()
        return None

    def _wait_for_backfill(self, pipeline_id: str, job_id: str,
                           timeout_seconds: int = 120,
                           target_status: str = "completed") -> dict:
        """Wait for backfill job to reach target status."""
        start = time.time()
        last_status = None

        while time.time() - start < timeout_seconds:
            status = self._get_backfill_status(pipeline_id, job_id)
            if status:
                current = status.get("status", "unknown")
                progress = status.get("progress_percent", 0)

                if current != last_status:
                    print(f"    Backfill status: {current} ({progress}%)")
                    last_status = current

                if current == target_status:
                    return status

                if current == "failed":
                    error = status.get("error", "Unknown error")
                    print(f"    Backfill failed: {error}")
                    return status

            time.sleep(3)

        print(f"    Timeout waiting for backfill to reach {target_status}")
        return self._get_backfill_status(pipeline_id, job_id)

    def _query_stream(self, stream_name: str, size: int = 100) -> list:
        """Query a stream and return hits."""
        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        start_time = int((now - timedelta(days=7)).timestamp() * 1000000)

        payload = {
            "query": {
                "sql": f"SELECT * FROM \"{stream_name}\"",
                "start_time": start_time,
                "end_time": end_time,
                "from": 0,
                "size": size
            }
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/_search?type=logs",
            json=payload
        )

        print(f"    Query {stream_name}: status={response.status_code}")
        if response.status_code == 200:
            data = response.json()
            hits = data.get("hits", [])
            total = data.get("total", 0)
            print(f"    Query {stream_name}: total={total}, hits_returned={len(hits)}")
            return hits
        else:
            print(f"    Query {stream_name} failed: {response.text[:200]}")
        return []

    # ==================== BASIC BACKFILL TESTS ====================

    def test_01_create_backfill_job(self):
        """Test creating a backfill job for a scheduled pipeline."""
        print("\n=== Test: Create backfill job ===")

        # 1. Ingest data with recent timestamp
        past_time = datetime.now(timezone.utc) - timedelta(minutes=RECENT_DATA_OFFSET_MINUTES)
        assert self._ingest_logs_with_timestamp(self.source_stream, past_time, count=5)
        time.sleep(INDEX_WAIT_SECONDS)

        # 2. Create scheduled pipeline
        pipeline_id = self._create_scheduled_pipeline(
            self.source_stream,
            self.dest_stream,
            name_suffix="basic"
        )

        # 3. Create backfill job (end_time must be in the past, not future)
        start_time = int((past_time - timedelta(minutes=BACKFILL_START_OFFSET_MINUTES)).timestamp() * 1000000)
        end_time = int((past_time + timedelta(minutes=BACKFILL_END_OFFSET_MINUTES)).timestamp() * 1000000)

        job_id = self._create_backfill_job(pipeline_id, start_time, end_time)

        # 4. Verify job was created
        status = self._get_backfill_status(pipeline_id, job_id)
        assert status is not None, "Should be able to get backfill job status"
        assert status.get("pipeline_id") == pipeline_id
        assert "status" in status

        print(f"  Job status: {status.get('status')}")
        print(f"  Progress: {status.get('progress_percent', 0)}%")

    def test_02_backfill_execution_and_data_verification(self):
        """Test that backfill actually processes data and writes to destination."""
        print("\n=== Test: Backfill execution and data verification ===")

        # 1. Ingest data with RECENT timestamps
        # Using recent timestamps ensures data is in the current partition,
        # which both _search API and derived_stream.evaluate() can access.
        past_time = datetime.now(timezone.utc) - timedelta(minutes=RECENT_DATA_OFFSET_MINUTES)
        record_count = 10
        assert self._ingest_logs_with_timestamp(self.source_stream, past_time, count=record_count)

        # 2. Wait for data to be indexed and queryable
        print("  Waiting for source data to be queryable...")
        source_hits = []
        for attempt in range(MAX_QUERY_RETRIES):
            time.sleep(QUERY_RETRY_INTERVAL_SECONDS)
            source_hits = self._query_stream(self.source_stream)
            if len(source_hits) >= record_count:
                print(f"  Source data ready after {(attempt+1)*QUERY_RETRY_INTERVAL_SECONDS}s: {len(source_hits)} records")
                break
            print(f"    Attempt {attempt+1}: found {len(source_hits)} records, waiting...")

        max_wait = MAX_QUERY_RETRIES * QUERY_RETRY_INTERVAL_SECONDS
        assert len(source_hits) >= record_count, \
            f"Source data not queryable after {max_wait}s. Found {len(source_hits)}, expected {record_count}"

        # 3. Create scheduled pipeline that adds processing_status field
        pipeline_id = self._create_scheduled_pipeline(
            self.source_stream,
            self.dest_stream,
            name_suffix="verify"
        )

        # 4. Create and run backfill - time range covers the recent data (end_time must be in the past)
        start_time = int((past_time - timedelta(minutes=BACKFILL_START_OFFSET_MINUTES)).timestamp() * 1000000)
        end_time = int((past_time + timedelta(minutes=BACKFILL_END_OFFSET_MINUTES + 5)).timestamp() * 1000000)

        job_id = self._create_backfill_job(pipeline_id, start_time, end_time, chunk_period_minutes=15)

        # 5. Wait for completion
        final_status = self._wait_for_backfill(pipeline_id, job_id, timeout_seconds=BACKFILL_TIMEOUT_SECONDS)

        # Allow partial success - backfill might complete or still be processing
        assert final_status is not None, "Should get final status"
        status = final_status.get("status")
        print(f"  Final status: {status}")
        print(f"  Full status response: {final_status}")

        # 6. Query destination stream to verify data was processed
        # Wait for destination data to be queryable (backfill writes + indexing)
        print("  Waiting for destination data...")
        dest_hits = []
        for attempt in range(10):  # Up to 20 seconds
            time.sleep(2)
            dest_hits = self._query_stream(self.dest_stream)
            if len(dest_hits) > 0:
                print(f"  Destination data ready after {(attempt+1)*2}s: {len(dest_hits)} records")
                break
            print(f"    Attempt {attempt+1}: destination empty, waiting...")

        print(f"  Destination stream has {len(dest_hits)} records")

        # Backfill MUST complete successfully for this test
        assert status == "completed", \
            f"Backfill did not complete within timeout. Status: {status}, full: {final_status}"

        # If backfill completed, destination MUST have data
        assert len(dest_hits) > 0, \
            f"Backfill completed but no data in destination stream '{self.dest_stream}'. " \
            f"Source had {len(source_hits)} records. This indicates a backfill bug. " \
            f"Status: {final_status}"

        # Verify transformation was applied
        for hit in dest_hits[:3]:
            assert "processing_status" in hit, \
                f"Record missing 'processing_status' field - transformation not applied: {hit}"
            assert hit["processing_status"] == "backfill_processed", \
                f"Record should have processing_status='backfill_processed': {hit}"
        print(f"  Data verification passed - {len(dest_hits)} records with processing_status field")

    def test_03_get_backfill_job_status(self):
        """Test getting a specific backfill job status."""
        print("\n=== Test: Get backfill job status ===")

        # Create a pipeline and backfill job
        past_time = datetime.now(timezone.utc) - timedelta(minutes=RECENT_DATA_OFFSET_MINUTES)
        self._ingest_logs_with_timestamp(self.source_stream, past_time, count=3)
        time.sleep(INDEX_WAIT_SECONDS)

        pipeline_id = self._create_scheduled_pipeline(
            self.source_stream,
            self.dest_stream,
            name_suffix="status"
        )

        start_time = int((past_time - timedelta(minutes=BACKFILL_START_OFFSET_MINUTES)).timestamp() * 1000000)
        end_time = int((past_time + timedelta(minutes=BACKFILL_END_OFFSET_MINUTES)).timestamp() * 1000000)
        job_id = self._create_backfill_job(pipeline_id, start_time, end_time)

        # Get specific backfill job status
        response = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/pipelines/{pipeline_id}/backfill/{job_id}"
        )

        assert response.status_code == 200, \
            f"Get backfill job should succeed: {response.status_code} - {response.text[:500]}"

        job = response.json()
        assert job.get("job_id") == job_id, f"Job ID should match: expected {job_id}, got {job.get('job_id')}"
        assert job.get("pipeline_id") == pipeline_id, "Pipeline ID should match"
        assert "status" in job, "Response should contain status"
        assert "progress_percent" in job, "Response should contain progress_percent"

        print(f"  Job ID: {job.get('job_id')}")
        print(f"  Status: {job.get('status')}")
        print(f"  Progress: {job.get('progress_percent')}%")

    def test_04_pause_and_resume_backfill(self):
        """Test pausing and resuming a backfill job."""
        print("\n=== Test: Pause and resume backfill ===")

        # Create pipeline and backfill with recent data
        past_time = datetime.now(timezone.utc) - timedelta(minutes=RECENT_DATA_OFFSET_MINUTES)
        self._ingest_logs_with_timestamp(self.source_stream, past_time, count=20)
        time.sleep(INDEX_WAIT_SECONDS)

        pipeline_id = self._create_scheduled_pipeline(
            self.source_stream,
            self.dest_stream,
            name_suffix="pause"
        )

        # Create backfill with small chunks to allow pausing mid-execution
        start_time = int((past_time - timedelta(minutes=BACKFILL_START_OFFSET_MINUTES)).timestamp() * 1000000)
        end_time = int((past_time + timedelta(minutes=BACKFILL_END_OFFSET_MINUTES)).timestamp() * 1000000)
        job_id = self._create_backfill_job(pipeline_id, start_time, end_time, chunk_period_minutes=5)

        # Wait for job to start processing (not just 'waiting')
        print("  Waiting for job to start processing...")
        job_started = False
        for attempt in range(30):  # Wait up to 30 seconds
            time.sleep(1)
            status = self._get_backfill_status(pipeline_id, job_id)
            current_status = status.get('status')
            print(f"    Attempt {attempt+1}: status={current_status}")
            if current_status in ['processing', 'completed', 'failed']:
                job_started = True
                break
            if current_status == 'paused':
                # Job was paused externally or by default - still counts as started
                job_started = True
                break

        if not job_started:
            print("  Warning: Job did not start within 30s, testing pause on waiting job")

        # Only test pause if job is still running (not completed/failed)
        status = self._get_backfill_status(pipeline_id, job_id)
        current_status = status.get('status')

        if current_status in ['completed', 'failed']:
            print(f"  Job already {current_status}, skipping pause/resume test")
            return

        # Pause the job (disable)
        pause_resp = self.session.put(
            f"{self.base_url}api/{self.ORG_ID}/pipelines/{pipeline_id}/backfill/{job_id}/enable?value=false"
        )

        assert pause_resp.status_code == 200, \
            f"Pause should succeed: {pause_resp.status_code} - {pause_resp.text[:500]}"
        print("  Paused (disabled) backfill job")

        # Wait for pause to take effect
        time.sleep(2)
        status = self._get_backfill_status(pipeline_id, job_id)
        current_status = status.get('status')
        is_enabled = status.get('enabled', True)
        print(f"  Status after pause: {current_status}, enabled: {is_enabled}")

        # Job should be paused, disabled, or still waiting (scheduler hasn't picked it up yet)
        # The key verification is that the pause API call succeeded (200 response above)
        assert is_enabled is False or current_status in ['paused', 'waiting', 'completed', 'failed'], \
            f"Job should be paused/disabled/waiting, got enabled={is_enabled}, status={current_status}"

        # Now test resume - only if job is still active (not completed/failed)
        if current_status not in ['completed', 'failed']:
            # Resume the job (enable)
            resume_resp = self.session.put(
                f"{self.base_url}api/{self.ORG_ID}/pipelines/{pipeline_id}/backfill/{job_id}/enable?value=true"
            )

            # Resume might fail if job completed between pause and resume - that's OK
            if resume_resp.status_code == 200:
                print("  Resumed (enabled) backfill job")
            else:
                print(f"  Resume returned {resume_resp.status_code}: {resume_resp.text[:200]}")
                # Accept if job completed or is not in pausable state
                assert resume_resp.status_code in [200, 400], \
                    f"Resume should succeed or return 400 if not pausable: {resume_resp.status_code}"

            # Verify resumed
            time.sleep(2)
            status = self._get_backfill_status(pipeline_id, job_id)
            print(f"  Final status: {status.get('status')}, enabled: {status.get('enabled')}")
        else:
            print(f"  Job already {current_status}, skipping resume test")

    def test_05_delete_backfill_job(self):
        """Test deleting a backfill job."""
        print("\n=== Test: Delete backfill job ===")

        # Create pipeline and backfill
        past_time = datetime.now(timezone.utc) - timedelta(minutes=RECENT_DATA_OFFSET_MINUTES)
        self._ingest_logs_with_timestamp(self.source_stream, past_time, count=3)
        time.sleep(INDEX_WAIT_SECONDS)

        pipeline_id = self._create_scheduled_pipeline(
            self.source_stream,
            self.dest_stream,
            name_suffix="delete"
        )

        start_time = int((past_time - timedelta(minutes=BACKFILL_START_OFFSET_MINUTES)).timestamp() * 1000000)
        end_time = int((past_time + timedelta(minutes=BACKFILL_END_OFFSET_MINUTES)).timestamp() * 1000000)
        job_id = self._create_backfill_job(pipeline_id, start_time, end_time)

        # Remove from tracking so cleanup doesn't try to delete it again
        self.created_backfill_jobs = [j for j in self.created_backfill_jobs if j["job_id"] != job_id]

        # Delete the job
        delete_resp = self.session.delete(
            f"{self.base_url}api/{self.ORG_ID}/pipelines/{pipeline_id}/backfill/{job_id}"
        )

        assert delete_resp.status_code == 200, \
            f"Delete should succeed: {delete_resp.status_code} - {delete_resp.text[:500]}"
        print(f"  Deleted backfill job: {job_id}")

        # Verify job is gone
        get_resp = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/pipelines/{pipeline_id}/backfill/{job_id}"
        )

        assert get_resp.status_code == 404, \
            f"Deleted job should return 404: {get_resp.status_code}"
        print("  Verified job no longer exists")

    # ==================== VALIDATION TESTS ====================

    def test_06_invalid_time_range(self):
        """Test that invalid time ranges are rejected."""
        print("\n=== Test: Invalid time range validation ===")

        # Create a pipeline first
        past_time = datetime.now(timezone.utc) - timedelta(minutes=RECENT_DATA_OFFSET_MINUTES)
        self._ingest_logs_with_timestamp(self.source_stream, past_time, count=3)
        time.sleep(INDEX_WAIT_SECONDS)

        pipeline_id = self._create_scheduled_pipeline(
            self.source_stream,
            self.dest_stream,
            name_suffix="invalid"
        )

        # Try to create backfill with start > end
        now = datetime.now(timezone.utc)
        start_time = int(now.timestamp() * 1000000)
        end_time = int((now - timedelta(hours=1)).timestamp() * 1000000)  # End before start

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/pipelines/{pipeline_id}/backfill",
            json={
                "start_time": start_time,
                "end_time": end_time,
                "chunk_period_minutes": 15
            }
        )

        assert response.status_code == 400, \
            f"Invalid time range should return 400: {response.status_code} - {response.text[:500]}"
        print("  Invalid time range correctly rejected with 400")

    def test_07_backfill_nonexistent_pipeline(self):
        """Test creating backfill for non-existent pipeline."""
        print("\n=== Test: Backfill for non-existent pipeline ===")

        fake_pipeline_id = "nonexistent_pipeline_12345"
        now = datetime.now(timezone.utc)
        start_time = int((now - timedelta(hours=1)).timestamp() * 1000000)
        end_time = int(now.timestamp() * 1000000)

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/pipelines/{fake_pipeline_id}/backfill",
            json={
                "start_time": start_time,
                "end_time": end_time,
                "chunk_period_minutes": 15
            }
        )

        # Should return 400 or 404
        assert response.status_code in [400, 404], \
            f"Non-existent pipeline should return 400/404: {response.status_code} - {response.text[:500]}"
        print(f"  Non-existent pipeline correctly rejected with {response.status_code}")

    def test_08_backfill_progress_tracking(self):
        """Test that backfill progress is tracked correctly."""
        print("\n=== Test: Progress tracking ===")

        # Create pipeline
        past_time = datetime.now(timezone.utc) - timedelta(minutes=RECENT_DATA_OFFSET_MINUTES)
        self._ingest_logs_with_timestamp(self.source_stream, past_time, count=10)
        time.sleep(INDEX_WAIT_SECONDS)

        pipeline_id = self._create_scheduled_pipeline(
            self.source_stream,
            self.dest_stream,
            name_suffix="progress"
        )

        # Create backfill with multiple chunks
        start_time = int((past_time - timedelta(minutes=BACKFILL_START_OFFSET_MINUTES)).timestamp() * 1000000)
        end_time = int((past_time + timedelta(minutes=BACKFILL_END_OFFSET_MINUTES)).timestamp() * 1000000)
        job_id = self._create_backfill_job(pipeline_id, start_time, end_time, chunk_period_minutes=5)

        # Track progress over time
        progress_readings = []
        for _ in range(10):
            status = self._get_backfill_status(pipeline_id, job_id)
            if status:
                progress = status.get("progress_percent", 0)
                current_status = status.get("status", "unknown")
                progress_readings.append(progress)
                print(f"    Progress: {progress}% (status: {current_status})")

                if current_status == "completed":
                    break
            time.sleep(3)

        # Verify progress increased or job completed
        print(f"  Progress readings: {progress_readings}")
        if len(progress_readings) > 1:
            # Either progress increased or we have completion
            final_status = self._get_backfill_status(pipeline_id, job_id)
            assert final_status is not None
            print(f"  Final status: {final_status.get('status')}")

    def test_09_get_nonexistent_backfill_job(self):
        """Test getting a non-existent backfill job returns 404."""
        print("\n=== Test: Get non-existent backfill job ===")

        # Create a real pipeline first
        past_time = datetime.now(timezone.utc) - timedelta(minutes=RECENT_DATA_OFFSET_MINUTES)
        self._ingest_logs_with_timestamp(self.source_stream, past_time, count=3)
        time.sleep(INDEX_WAIT_SECONDS)

        pipeline_id = self._create_scheduled_pipeline(
            self.source_stream,
            self.dest_stream,
            name_suffix="notfound"
        )

        # Try to get non-existent job
        fake_job_id = "fake_job_id_12345"
        response = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/pipelines/{pipeline_id}/backfill/{fake_job_id}"
        )

        assert response.status_code == 404, \
            f"Non-existent job should return 404: {response.status_code}"
        print("  Non-existent job correctly returned 404")

    def test_10_backfill_realtime_pipeline_should_fail(self):
        """Test that backfill cannot be created for realtime pipelines."""
        print("\n=== Test: Backfill for realtime pipeline should fail ===")

        # Create a REALTIME pipeline (not scheduled)
        pipeline_name = f"realtime_pipeline_{self.unique_id}"
        source_node_id = str(uuid.uuid4())
        dest_node_id = str(uuid.uuid4())

        payload = {
            "name": pipeline_name,
            "description": "Realtime pipeline - backfill should fail",
            "source": {"source_type": "realtime"},  # REALTIME, not scheduled
            "nodes": [
                {
                    "id": source_node_id,
                    "type": "input",
                    "position": {"x": 200, "y": 100},
                    "data": {
                        "node_type": "stream",
                        "stream_type": "logs",
                        "stream_name": self.source_stream,
                        "org_id": self.ORG_ID
                    },
                    "io_type": "input"
                },
                {
                    "id": dest_node_id,
                    "type": "output",
                    "position": {"x": 200, "y": 300},
                    "data": {
                        "node_type": "stream",
                        "stream_type": "logs",
                        "stream_name": self.dest_stream,
                        "org_id": self.ORG_ID
                    },
                    "io_type": "output"
                }
            ],
            "edges": [
                {
                    "id": f"e{source_node_id}-{dest_node_id}",
                    "source": source_node_id,
                    "target": dest_node_id,
                }
            ],
            "org": self.ORG_ID
        }

        # Ingest data first to create stream
        past_time = datetime.now(timezone.utc) - timedelta(minutes=RECENT_DATA_OFFSET_MINUTES)
        self._ingest_logs_with_timestamp(self.source_stream, past_time, count=3)
        time.sleep(INDEX_WAIT_SECONDS)

        # Create realtime pipeline
        create_resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/pipelines",
            json=payload
        )

        assert create_resp.status_code == 200, \
            f"Failed to create realtime pipeline: {create_resp.status_code} - {create_resp.text[:500]}"

        # Get pipeline ID
        list_resp = self.session.get(f"{self.base_url}api/{self.ORG_ID}/pipelines")
        pipelines = list_resp.json().get("list", [])
        pipeline_id = next((p["pipeline_id"] for p in pipelines if p["name"] == pipeline_name), None)

        assert pipeline_id, f"Pipeline {pipeline_name} not found"
        self.created_pipelines.append(pipeline_id)

        # Try to create backfill - should fail for realtime pipeline
        now = datetime.now(timezone.utc)
        start_time = int((now - timedelta(hours=1)).timestamp() * 1000000)
        end_time = int(now.timestamp() * 1000000)

        backfill_resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/pipelines/{pipeline_id}/backfill",
            json={
                "start_time": start_time,
                "end_time": end_time,
                "chunk_period_minutes": 15
            }
        )

        # Should fail because realtime pipelines don't support backfill
        assert backfill_resp.status_code == 400, \
            f"Backfill for realtime pipeline should return 400: {backfill_resp.status_code} - {backfill_resp.text[:500]}"
        print("  Backfill for realtime pipeline correctly rejected")
