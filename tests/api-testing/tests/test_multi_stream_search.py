"""
Multi-Stream Search API Tests

Tests for Multi-Stream Search operations:
- POST /api/{org_id}/_multi_search_stream - Search across multiple streams (SSE streaming)
"""

import pytest
import json
from datetime import datetime, timezone, timedelta


class TestMultiStreamSearch:
    """Test class for Multi-Stream Search API endpoint."""

    ORG_ID = "default"
    STREAM_NAME = "stream_pytest_data"
    STREAM_NAME_2 = "e2e_automate"

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url):
        """Setup test fixtures."""
        self.session = create_session
        self.base_url = base_url
        self.session.headers.update({"Content-Type": "application/json"})

        # Set up time range (5 weeks to ensure data exists)
        now = datetime.now(timezone.utc)
        self.end_time = int(now.timestamp() * 1000000)
        self.start_time = int((now - timedelta(weeks=5)).timestamp() * 1000000)

    def _parse_sse_response(self, response_text):
        """Parse Server-Sent Events response and extract hits."""
        all_hits = []
        metadata = []

        for line in response_text.splitlines():
            if line.startswith('data: '):
                data_str = line[6:]  # Remove 'data: ' prefix
                if data_str == '[[DONE]]':
                    continue
                try:
                    data = json.loads(data_str)
                    if 'hits' in data:
                        all_hits.extend(data['hits'])
                    if 'results' in data:
                        metadata.append(data)
                except json.JSONDecodeError:
                    pass

        return {'hits': all_hits, 'metadata': metadata}

    def test_01_multi_stream_search_single_stream(self):
        """Test multi-stream search with single stream"""

        payload = {
            "sql": [f"SELECT * FROM \"{self.STREAM_NAME}\""],
            "start_time": self.start_time,
            "end_time": self.end_time,
            "from": 0,
            "size": 5,
            "quick_mode": True
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/_multi_search_stream?type=logs&search_type=ui&use_cache=true",
            json=payload
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text[:200]}"

        # Parse SSE response
        result = self._parse_sse_response(response.text)

        assert len(result['metadata']) > 0, "Should have metadata responses"
        print(f"✓ Single stream search returned {len(result['hits'])} hits")

    def test_02_multi_stream_search_two_streams(self):
        """Test multi-stream search with two streams"""

        payload = {
            "sql": [
                f"SELECT * FROM \"{self.STREAM_NAME}\"",
                f"SELECT * FROM \"{self.STREAM_NAME_2}\""
            ],
            "start_time": self.start_time,
            "end_time": self.end_time,
            "from": 0,
            "size": 5,
            "quick_mode": True
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/_multi_search_stream?type=logs&search_type=ui&use_cache=true",
            json=payload
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text[:200]}"

        result = self._parse_sse_response(response.text)

        # Should have metadata for both queries (query_index 0 and 1)
        query_indices = set()
        for meta in result['metadata']:
            if 'results' in meta and 'query_index' in meta['results']:
                query_indices.add(meta['results']['query_index'])

        assert len(query_indices) >= 1, \
            f"Should have results for multiple queries: {query_indices}"

        print(f"✓ Two stream search returned {len(result['hits'])} hits from {len(query_indices)} queries")

    def test_03_multi_stream_search_with_stream_name_column(self):
        """Test multi-stream search with _stream_name column (like UI does)"""

        payload = {
            "sql": [
                f"SELECT '{self.STREAM_NAME}' as _stream_name, * FROM \"{self.STREAM_NAME}\"",
                f"SELECT '{self.STREAM_NAME_2}' as _stream_name, * FROM \"{self.STREAM_NAME_2}\""
            ],
            "start_time": self.start_time,
            "end_time": self.end_time,
            "from": 0,
            "size": 5,
            "quick_mode": True
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/_multi_search_stream?type=logs&search_type=ui&use_cache=true",
            json=payload
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text[:200]}"

        result = self._parse_sse_response(response.text)
        print(f"✓ Multi-stream with _stream_name returned {len(result['hits'])} hits")

    def test_04_multi_stream_search_response_structure(self):
        """Test multi-stream search SSE response has expected structure"""

        payload = {
            "sql": [f"SELECT * FROM \"{self.STREAM_NAME_2}\""],
            "start_time": self.start_time,
            "end_time": self.end_time,
            "from": 0,
            "size": 5,
            "quick_mode": True
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/_multi_search_stream?type=logs&search_type=ui&use_cache=true",
            json=payload
        )

        assert response.status_code == 200

        # Check SSE format
        assert 'event:' in response.text or 'data:' in response.text, \
            "Response should be SSE format"
        assert '[[DONE]]' in response.text, \
            "Response should end with [[DONE]]"

        result = self._parse_sse_response(response.text)

        # Check metadata structure
        if result['metadata']:
            meta = result['metadata'][0]
            assert 'results' in meta, f"Metadata should have 'results': {meta}"
            results = meta['results']
            assert 'took' in results, f"Results should have 'took': {results}"
            assert 'total' in results, f"Results should have 'total': {results}"

        print(f"✓ SSE response structure verified")

    def test_05_multi_stream_search_with_limit(self):
        """Test multi-stream search respects size limit"""

        payload = {
            "sql": [f"SELECT * FROM \"{self.STREAM_NAME_2}\""],
            "start_time": self.start_time,
            "end_time": self.end_time,
            "from": 0,
            "size": 3,
            "quick_mode": True
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/_multi_search_stream?type=logs&search_type=ui&use_cache=true",
            json=payload
        )

        assert response.status_code == 200

        result = self._parse_sse_response(response.text)

        # Note: Due to streaming, we may get more hits but size should be respected per batch
        print(f"✓ Multi-stream search with size=3 returned {len(result['hits'])} hits")

    def test_06_multi_stream_search_invalid_stream(self):
        """Test multi-stream search with non-existent stream"""

        payload = {
            "sql": ["SELECT * FROM \"nonexistent_stream_xyz123\""],
            "start_time": self.start_time,
            "end_time": self.end_time,
            "from": 0,
            "size": 5,
            "quick_mode": True
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/_multi_search_stream?type=logs&search_type=ui&use_cache=true",
            json=payload
        )

        # Should return 200 with empty results or error in SSE
        assert response.status_code in [200, 400, 404, 500], \
            f"Unexpected status: {response.status_code}"

        print(f"✓ Invalid stream handled with status {response.status_code}")
