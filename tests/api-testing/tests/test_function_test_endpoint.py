"""
Function Test Endpoint API Tests

Tests for Function Test operations:
- POST /api/{org_id}/functions/test - Test a VRL/JS function without saving it
"""

import pytest


class TestFunctionTestEndpoint:
    """Test class for Function Test API endpoint."""

    ORG_ID = "default"

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url):
        """Setup test fixtures."""
        self.session = create_session
        self.base_url = base_url

    def test_01_basic_vrl_function(self):
        """Test a basic VRL function that adds a field"""

        payload = {
            "function": ".test_field = \"added_by_test\"\n.",
            "events": [
                {
                    "_timestamp": 1735128523652186,
                    "job": "pytest",
                    "level": "info",
                    "log": "test message"
                }
            ]
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/functions/test",
            json=payload
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "results" in data, f"Response should have 'results' field: {data}"
        assert len(data["results"]) == 1, f"Should have 1 result: {data}"

        result = data["results"][0]
        assert "event" in result, f"Result should have 'event' field: {result}"
        assert result["event"].get("test_field") == "added_by_test", \
            f"Function should add 'test_field': {result}"

        print(f"✓ VRL function successfully added field")

    def test_02_vrl_function_modifies_value(self):
        """Test a VRL function that modifies an existing value"""

        # Use upcase! (infallible version) to avoid VRL error handling requirements
        payload = {
            "function": ".level = upcase!(.level)\n.",
            "events": [
                {
                    "_timestamp": 1735128523652186,
                    "level": "info"
                }
            ],
            "trans_type": 0  # Explicitly set to VRL
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/functions/test",
            json=payload
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "results" in data and len(data["results"]) > 0, \
            f"Response should have results: {data}"
        result = data["results"][0]
        assert result["event"].get("level") == "INFO", \
            f"Function should uppercase 'level': {result}"

        print(f"✓ VRL function successfully modified field")

    def test_03_vrl_function_with_multiple_events(self):
        """Test a VRL function with multiple events"""

        payload = {
            "function": ".processed = true\n.",
            "events": [
                {"id": 1, "name": "event1"},
                {"id": 2, "name": "event2"},
                {"id": 3, "name": "event3"}
            ]
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/functions/test",
            json=payload
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert len(data["results"]) == 3, \
            f"Should have 3 results for 3 events: {data}"

        # Verify all events have the added field
        for i, result in enumerate(data["results"]):
            assert result["event"].get("processed") is True, \
                f"Event {i} should have 'processed' = true: {result}"

        print(f"✓ VRL function successfully processed {len(data['results'])} events")

    def test_04_vrl_function_with_conditional(self):
        """Test a VRL function with conditional logic"""

        payload = {
            "function": "if .level == \"error\" { .priority = \"high\" } else { .priority = \"normal\" }\n.",
            "events": [
                {"level": "error", "message": "something failed"},
                {"level": "info", "message": "all good"}
            ],
            "trans_type": 0  # Explicitly set to VRL
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/functions/test",
            json=payload
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert data["results"][0]["event"].get("priority") == "high", \
            f"Error event should have high priority: {data['results'][0]}"
        assert data["results"][1]["event"].get("priority") == "normal", \
            f"Info event should have normal priority: {data['results'][1]}"

        print(f"✓ VRL conditional logic works correctly")

    def test_05_invalid_vrl_function(self):
        """Test that invalid VRL syntax returns an error"""

        payload = {
            "function": ".test = invalid syntax here!!!",
            "events": [{"field": "value"}]
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/functions/test",
            json=payload
        )

        # Invalid syntax should return 400 or have error in results
        # The API behavior may vary, so we check both possibilities
        if response.status_code == 400:
            print(f"✓ Invalid VRL correctly returned 400 error")
        else:
            data = response.json()
            # Check if error message is present in results
            has_error = any(
                result.get("message", "") != ""
                for result in data.get("results", [])
            )
            assert has_error or response.status_code == 400, \
                f"Invalid VRL should produce an error: {response.status_code} - {data}"
            print(f"✓ Invalid VRL correctly returned error in results")

    def test_06_response_structure(self):
        """Test that response has correct structure"""

        payload = {
            "function": ".",  # Identity function - returns input unchanged
            "events": [{"test": "value"}]
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/functions/test",
            json=payload
        )

        assert response.status_code == 200

        data = response.json()

        # Verify response structure
        assert "results" in data, "Response should have 'results' field"
        assert isinstance(data["results"], list), "'results' should be a list"

        for result in data["results"]:
            assert "message" in result, "Each result should have 'message' field"
            assert "event" in result, "Each result should have 'event' field"

        print(f"✓ Response structure is correct: {data}")

    def test_07_vrl_delete_field(self):
        """Test a VRL function that deletes a field"""

        payload = {
            "function": "del(.sensitive_data)\n.",
            "events": [
                {
                    "id": 1,
                    "name": "test",
                    "sensitive_data": "secret123"
                }
            ],
            "trans_type": 0  # Explicitly set to VRL
        }

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/functions/test",
            json=payload
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        result = data["results"][0]
        assert "sensitive_data" not in result["event"], \
            f"Field 'sensitive_data' should be deleted: {result}"
        assert result["event"].get("name") == "test", \
            f"Other fields should remain: {result}"

        print(f"✓ VRL function successfully deleted field")
