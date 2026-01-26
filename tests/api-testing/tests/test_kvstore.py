"""
KV Store API Tests

Tests for Key-Value Store CRUD operations:
- POST /api/{org_id}/kv/{key} - Set value
- GET /api/{org_id}/kv/{key} - Get value
- GET /api/{org_id}/kv - List keys
- DELETE /api/{org_id}/kv/{key} - Delete value
"""

import pytest
import random
import string
import time


def generate_unique_key():
    """Generate a unique key for test isolation."""
    timestamp = int(time.time() * 1000)
    random_suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"test_key_{timestamp}_{random_suffix}"


class TestKVStore:
    """Test class for KV Store API endpoints."""

    ORG_ID = "default"

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url):
        """Setup test fixtures."""
        self.session = create_session
        self.base_url = base_url
        self.test_key = generate_unique_key()
        self.test_value = "test_value_hello_world"
        self.updated_value = "updated_value_goodbye_world"
        yield
        # Cleanup: Try to delete test key
        try:
            self.session.delete(f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}")
        except (ConnectionError, TimeoutError):
            pass

    def test_01_create_kv_pair(self):
        """Test creating a KV pair - POST /api/{org_id}/kv/{key}"""

        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}",
            data=self.test_value,
            headers={"Content-Type": "text/plain"}
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"
        assert response.text == "OK", \
            f"Expected 'OK', got '{response.text}'"
        print(f"✓ Created KV pair: {self.test_key} = {self.test_value}")

    def test_02_read_kv_pair(self):
        """Test reading a KV pair - GET /api/{org_id}/kv/{key}"""

        # First create the key
        create_resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}",
            data=self.test_value,
            headers={"Content-Type": "text/plain"}
        )
        assert create_resp.status_code == 200

        # Now read it
        response = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}"
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"
        assert response.text == self.test_value, \
            f"Expected '{self.test_value}', got '{response.text}'"
        print(f"✓ Read KV pair: {self.test_key} = {response.text}")

    def test_03_list_kv_keys(self):
        """Test listing all KV keys - GET /api/{org_id}/kv"""

        # First create a key
        create_resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}",
            data=self.test_value,
            headers={"Content-Type": "text/plain"}
        )
        assert create_resp.status_code == 200

        # List all keys
        response = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/kv"
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"

        keys = response.json()
        assert isinstance(keys, list), f"Expected list, got {type(keys)}"
        assert self.test_key in keys, f"Test key '{self.test_key}' not found in keys list"
        print(f"✓ Listed KV keys: Found {len(keys)} keys, including test key")

    def test_04_list_kv_keys_with_prefix(self):
        """Test listing KV keys with prefix filter - GET /api/{org_id}/kv?prefix=test_key"""

        # First create a key
        create_resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}",
            data=self.test_value,
            headers={"Content-Type": "text/plain"}
        )
        assert create_resp.status_code == 200

        # List keys with prefix filter
        response = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/kv?prefix=test_key"
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"

        keys = response.json()
        assert isinstance(keys, list), f"Expected list, got {type(keys)}"
        assert self.test_key in keys, f"Test key '{self.test_key}' not found in filtered keys"

        # Verify all returned keys start with prefix
        for key in keys:
            assert key.startswith("test_key"), f"Key '{key}' doesn't start with 'test_key'"
        print(f"✓ Filtered KV keys: {len(keys)} keys match prefix 'test_key'")

    def test_05_update_kv_pair(self):
        """Test updating a KV pair - POST /api/{org_id}/kv/{key} (overwrite)"""

        # First create the key
        create_resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}",
            data=self.test_value,
            headers={"Content-Type": "text/plain"}
        )
        assert create_resp.status_code == 200

        # Update the key with new value
        update_resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}",
            data=self.updated_value,
            headers={"Content-Type": "text/plain"}
        )

        assert update_resp.status_code == 200, \
            f"Expected 200, got {update_resp.status_code}: {update_resp.text}"

        # Verify the update
        get_resp = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}"
        )
        assert get_resp.text == self.updated_value, \
            f"Expected '{self.updated_value}', got '{get_resp.text}'"
        print(f"✓ Updated KV pair: {self.test_key} = {self.updated_value}")

    def test_06_delete_kv_pair(self):
        """Test deleting a KV pair - DELETE /api/{org_id}/kv/{key}"""

        # First create the key
        create_resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}",
            data=self.test_value,
            headers={"Content-Type": "text/plain"}
        )
        assert create_resp.status_code == 200

        # Delete the key
        response = self.session.delete(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}"
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"
        assert response.text == "OK", \
            f"Expected 'OK', got '{response.text}'"
        print(f"✓ Deleted KV pair: {self.test_key}")

    def test_07_get_deleted_key_returns_404(self):
        """Test that getting a deleted key returns 404"""

        # First create the key
        create_resp = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}",
            data=self.test_value,
            headers={"Content-Type": "text/plain"}
        )
        assert create_resp.status_code == 200

        # Delete the key
        delete_resp = self.session.delete(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}"
        )
        assert delete_resp.status_code == 200

        # Try to get the deleted key
        response = self.session.get(
            f"{self.base_url}api/{self.ORG_ID}/kv/{self.test_key}"
        )

        assert response.status_code == 404, \
            f"Expected 404, got {response.status_code}: {response.text}"
        assert response.text == "Not Found", \
            f"Expected 'Not Found', got '{response.text}'"
        print(f"✓ Deleted key correctly returns 404")

    def test_08_delete_nonexistent_key_is_idempotent(self):
        """Test that deleting a non-existent key is idempotent (returns 200)"""

        non_existent_key = f"non_existent_key_{int(time.time() * 1000)}"

        response = self.session.delete(
            f"{self.base_url}api/{self.ORG_ID}/kv/{non_existent_key}"
        )

        # API is idempotent - deleting non-existent key returns 200 OK
        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"
        assert response.text == "OK", \
            f"Expected 'OK', got '{response.text}'"
        print(f"✓ Non-existent key delete is idempotent (returns 200 OK)")
