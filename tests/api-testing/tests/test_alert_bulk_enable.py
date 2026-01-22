"""
Alert Bulk Enable/Disable API Tests

Tests for Alert Bulk operations:
- POST /api/v2/{org_id}/alerts/bulk/enable?value=true - Bulk enable alerts
- POST /api/v2/{org_id}/alerts/bulk/enable?value=false - Bulk disable alerts

Uses existing alerts from the system to test bulk operations.
"""

import pytest


class TestAlertBulkEnable:
    """Test class for Alert Bulk Enable/Disable API endpoints."""

    ORG_ID = "default"

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url):
        """Setup test fixtures."""
        self.session = create_session
        self.base_url = base_url
        # Get existing alerts to use for testing
        self.existing_alerts = self._get_existing_alerts()

    def _get_existing_alerts(self):
        """Get list of existing alert IDs from the system."""
        response = self.session.get(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts"
        )
        if response.status_code == 200:
            data = response.json()
            alerts = data.get("list", [])
            return [alert["alert_id"] for alert in alerts]
        return []

    def get_alert(self, alert_id):
        """Helper to get an alert by ID."""
        response = self.session.get(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/{alert_id}"
        )
        return response

    def test_01_bulk_disable_single_alert(self):
        """Test bulk disable with a single existing alert"""

        assert len(self.existing_alerts) > 0, \
            "Need at least 1 existing alert for this test"

        alert_id = self.existing_alerts[0]
        print(f"✓ Using existing alert: {alert_id}")

        # Get current state
        get_resp = self.get_alert(alert_id)
        original_enabled = get_resp.json()["enabled"]

        # Bulk disable it
        response = self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/bulk/enable?value=false",
            json={"ids": [alert_id]}
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert alert_id in data.get("successful", []), \
            f"Alert should be in successful list: {data}"

        # Verify alert is disabled
        get_resp = self.get_alert(alert_id)
        assert get_resp.status_code == 200
        alert_data = get_resp.json()
        assert alert_data["enabled"] == False, \
            f"Alert should be disabled, got: {alert_data.get('enabled')}"

        # Restore original state
        self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/bulk/enable?value={str(original_enabled).lower()}",
            json={"ids": [alert_id]}
        )

        print(f"✓ Successfully bulk disabled alert")

    def test_02_bulk_enable_single_alert(self):
        """Test bulk enable with a single existing alert"""

        assert len(self.existing_alerts) > 0, \
            "Need at least 1 existing alert for this test"

        alert_id = self.existing_alerts[0]
        print(f"✓ Using existing alert: {alert_id}")

        # Get current state
        get_resp = self.get_alert(alert_id)
        original_enabled = get_resp.json()["enabled"]

        # First disable it
        self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/bulk/enable?value=false",
            json={"ids": [alert_id]}
        )

        # Bulk enable it
        response = self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/bulk/enable?value=true",
            json={"ids": [alert_id]}
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        assert alert_id in data.get("successful", []), \
            f"Alert should be in successful list: {data}"

        # Verify alert is enabled
        get_resp = self.get_alert(alert_id)
        assert get_resp.status_code == 200
        alert_data = get_resp.json()
        assert alert_data["enabled"] == True, \
            f"Alert should be enabled, got: {alert_data.get('enabled')}"

        # Restore original state
        self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/bulk/enable?value={str(original_enabled).lower()}",
            json={"ids": [alert_id]}
        )

        print(f"✓ Successfully bulk enabled alert")

    def test_03_bulk_disable_multiple_alerts(self):
        """Test bulk disable with multiple existing alerts"""

        assert len(self.existing_alerts) >= 2, \
            "Need at least 2 existing alerts for this test"

        alert_ids = self.existing_alerts[:2]
        print(f"✓ Using {len(alert_ids)} existing alerts")

        # Save original states
        original_states = {}
        for aid in alert_ids:
            resp = self.get_alert(aid)
            original_states[aid] = resp.json()["enabled"]

        # Bulk disable all
        response = self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/bulk/enable?value=false",
            json={"ids": alert_ids}
        )

        assert response.status_code == 200, \
            f"Expected 200, got {response.status_code}: {response.text}"

        data = response.json()
        successful = data.get("successful", [])

        # All alerts should be in successful list
        for alert_id in alert_ids:
            assert alert_id in successful, \
                f"Alert {alert_id} should be in successful list: {data}"

        # Verify all alerts are disabled
        for alert_id in alert_ids:
            get_resp = self.get_alert(alert_id)
            assert get_resp.status_code == 200
            assert get_resp.json()["enabled"] == False

        # Restore original states
        for aid, state in original_states.items():
            self.session.post(
                f"{self.base_url}api/v2/{self.ORG_ID}/alerts/bulk/enable?value={str(state).lower()}",
                json={"ids": [aid]}
            )

        print(f"✓ Successfully bulk disabled {len(alert_ids)} alerts")

    def test_04_bulk_toggle_same_alert_twice(self):
        """Test bulk enable/disable same alert twice (idempotent)"""

        assert len(self.existing_alerts) > 0, \
            "Need at least 1 existing alert for this test"

        alert_id = self.existing_alerts[0]

        # Get original state
        get_resp = self.get_alert(alert_id)
        original_enabled = get_resp.json()["enabled"]

        # Disable twice - should be idempotent
        response1 = self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/bulk/enable?value=false",
            json={"ids": [alert_id]}
        )
        assert response1.status_code == 200

        response2 = self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/bulk/enable?value=false",
            json={"ids": [alert_id]}
        )
        assert response2.status_code == 200, \
            f"Expected 200, got {response2.status_code}: {response2.text}"

        data = response2.json()
        assert alert_id in data.get("successful", []), \
            f"Alert should be in successful list even on repeat: {data}"

        # Restore original state
        self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/bulk/enable?value={str(original_enabled).lower()}",
            json={"ids": [alert_id]}
        )

        print(f"✓ Bulk operations are idempotent")

    def test_05_bulk_response_structure(self):
        """Test that bulk response has correct structure"""

        assert len(self.existing_alerts) > 0, \
            "Need at least 1 existing alert for this test"

        alert_id = self.existing_alerts[0]

        response = self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/bulk/enable?value=true",
            json={"ids": [alert_id]}
        )

        assert response.status_code == 200

        data = response.json()

        # Verify response structure
        assert "successful" in data, "Response should have 'successful' field"
        assert "unsuccessful" in data, "Response should have 'unsuccessful' field"
        assert isinstance(data["successful"], list), "'successful' should be a list"
        assert isinstance(data["unsuccessful"], list), "'unsuccessful' should be a list"

        print(f"✓ Response structure is correct: {data}")
