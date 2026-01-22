"""
Organization Passcode API Tests

Tests for Organization Passcode/Ingestion Token operations:
- GET /api/{org_id}/passcode - Get user's ingestion token
- PUT /api/{org_id}/passcode - Update/regenerate user's ingestion token
"""

import pytest


class TestOrgPasscode:
    """Test class for Organization Passcode API endpoints."""

    ORG_ID = "default"

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url):
        """Setup test fixtures."""
        self.session = create_session
        self.base_url = base_url

    def test_01_get_passcode(self):
        """Test getting user's passcode - GET /api/{org_id}/passcode"""

        response = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/passcode"
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "data" in data, f"Response should contain 'data' field: {data}"
        assert "passcode" in data["data"], f"Response should contain 'passcode': {data}"
        assert "user" in data["data"], f"Response should contain 'user': {data}"

        # Passcode should be a non-empty string
        assert isinstance(data["data"]["passcode"], str), "Passcode should be a string"
        assert len(data["data"]["passcode"]) > 0, "Passcode should not be empty"

        print(f"✓ Got passcode for user: {data['data']['user']}")
        print(f"✓ Passcode length: {len(data['data']['passcode'])} chars")

    def test_02_update_passcode(self):
        """Test updating user's passcode - PUT /api/{org_id}/passcode"""

        # First get the current passcode
        get_resp = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/passcode"
        )
        assert get_resp.status_code == 200
        get_data = get_resp.json()
        assert "data" in get_data and "passcode" in get_data["data"], \
            f"Response missing data/passcode: {get_data}"
        old_passcode = get_data["data"]["passcode"]

        # Update the passcode
        response = self.session.put(
            f"{self.base_url}api/{self.ORG_ID}/passcode"
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert "data" in data, f"Response should contain 'data' field: {data}"
        assert "passcode" in data["data"], f"Response should contain 'passcode': {data}"

        new_passcode = data["data"]["passcode"]
        assert isinstance(new_passcode, str), "Passcode should be a string"
        assert len(new_passcode) > 0, "Passcode should not be empty"

        # New passcode should be different from old one
        assert new_passcode != old_passcode, \
            "New passcode should be different from old passcode"

        print(f"✓ Updated passcode for user: {data['data']['user']}")
        print(f"✓ Passcode was successfully regenerated (old != new)")

    def test_03_verify_updated_passcode_persists(self):
        """Test that updated passcode persists after update"""

        # Update the passcode
        update_resp = self.session.put(
            f"{self.base_url}api/{self.ORG_ID}/passcode"
        )
        assert update_resp.status_code == 200
        update_data = update_resp.json()
        assert "data" in update_data and "passcode" in update_data["data"], \
            f"Response missing data/passcode: {update_data}"
        new_passcode = update_data["data"]["passcode"]

        # Get the passcode again and verify it matches
        get_resp = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/passcode"
        )

        assert get_resp.status_code == 200
        retrieved_passcode = get_resp.json()["data"]["passcode"]

        assert retrieved_passcode == new_passcode, \
            "Retrieved passcode should match the updated passcode"

        print(f"✓ Updated passcode persists correctly")

    def test_04_passcode_response_structure(self):
        """Test that passcode response has correct structure"""

        response = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/passcode"
        )

        assert response.status_code == 200

        data = response.json()

        # Verify structure
        assert isinstance(data, dict), "Response should be a dict"
        assert "data" in data, "Response should have 'data' key"
        assert isinstance(data["data"], dict), "data should be a dict"

        inner_data = data["data"]
        assert "passcode" in inner_data, "Should have 'passcode' field"
        assert "user" in inner_data, "Should have 'user' field"

        # User should be an email format
        user = inner_data["user"]
        assert "@" in user, f"User should be an email, got: {user}"

        print(f"✓ Response structure is correct")
        print(f"✓ User email: {user}")
