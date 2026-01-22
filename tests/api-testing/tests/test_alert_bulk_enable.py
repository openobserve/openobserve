"""
Alert Bulk Enable/Disable API Tests

Tests for Alert Bulk operations:
- POST /api/v2/{org_id}/alerts/bulk/enable?value=true - Bulk enable alerts
- POST /api/v2/{org_id}/alerts/bulk/enable?value=false - Bulk disable alerts

Creates test alerts and cleans them up after tests.
"""

import pytest
import random
import time


class TestAlertBulkEnable:
    """Test class for Alert Bulk Enable/Disable API endpoints."""

    ORG_ID = "default"
    STREAM_NAME = "e2e_automate"

    @pytest.fixture(autouse=True)
    def setup(self, create_session, base_url):
        """Setup test fixtures - create template, destination, folder, and alerts."""
        self.session = create_session
        self.base_url = base_url

        # Generate unique identifiers for this test run
        self.unique_id = f"bulk_test_{random.randint(100000, 999999)}"
        self.template_name = f"template_{self.unique_id}"
        self.destination_name = f"dest_{self.unique_id}"
        self.folder_name = f"folder_{self.unique_id}"
        self.alert_names = [f"alert_{self.unique_id}_1", f"alert_{self.unique_id}_2"]

        # Create resources
        self._create_template()
        self._create_destination()
        self._create_folder()
        self._create_alerts()

        yield

        # Cleanup after tests
        self._cleanup()

    def _create_template(self):
        """Create a webhook template for the destination."""
        payload = {
            "name": self.template_name,
            "body": '{"text": "{alert_name} is active"}',
            "type": "http",
            "title": ""
        }
        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/alerts/templates",
            json=payload
        )
        assert response.status_code == 200, \
            f"Failed to create template: {response.text}"

    def _create_destination(self):
        """Create a webhook destination using the template."""
        payload = {
            "url": "https://jsonplaceholder.typicode.com/posts",
            "method": "post",
            "template": self.template_name,
            "headers": {},
            "name": self.destination_name,
            "skip_tls_verify": False
        }
        response = self.session.post(
            f"{self.base_url}api/{self.ORG_ID}/alerts/destinations",
            json=payload
        )
        assert response.status_code == 200, \
            f"Failed to create destination: {response.text}"

    def _create_folder(self):
        """Create a folder for alerts."""
        payload = {"name": self.folder_name, "description": "Test folder for bulk enable"}
        response = self.session.post(
            f"{self.base_url}api/v2/{self.ORG_ID}/folders/alerts",
            json=payload
        )
        assert response.status_code == 200, \
            f"Failed to create folder: {response.text}"
        folder_data = response.json()
        assert "folderId" in folder_data, f"Response missing folderId: {folder_data}"
        self.folder_id = folder_data["folderId"]

    def _create_alerts(self):
        """Create test alerts."""
        self.alert_ids = []
        for alert_name in self.alert_names:
            payload = {
                "name": alert_name,
                "stream_type": "logs",
                "stream_name": self.STREAM_NAME,
                "is_real_time": False,
                "query_condition": {
                    "conditions": [],
                    "sql": f"SELECT _timestamp, log FROM \"{self.STREAM_NAME}\"",
                    "promql": "",
                    "type": "sql",
                    "aggregation": None,
                    "promql_condition": None,
                    "vrl_function": None,
                    "multi_time_range": []
                },
                "trigger_condition": {
                    "period": 1440,
                    "operator": ">=",
                    "frequency": 60,
                    "cron": "",
                    "threshold": 1,
                    "silence": 10,
                    "frequency_type": "minutes",
                    "timezone": "UTC"
                },
                "destinations": [self.destination_name],
                "context_attributes": {},
                "enabled": True,
                "description": "Test alert for bulk enable/disable",
                "folder_id": self.folder_id
            }
            response = self.session.post(
                f"{self.base_url}api/v2/{self.ORG_ID}/alerts?folder={self.folder_id}",
                json=payload
            )
            assert response.status_code == 200, \
                f"Failed to create alert {alert_name}: {response.text}"

            # Get the alert_id from response or fetch it
            alert_data = response.json()
            if "alert_id" in alert_data:
                self.alert_ids.append(alert_data["alert_id"])
            else:
                # Fetch alert to get its ID
                time.sleep(1)
                alerts_resp = self.session.get(
                    f"{self.base_url}api/v2/{self.ORG_ID}/alerts"
                )
                assert alerts_resp.status_code == 200, \
                    f"Failed to fetch alerts: {alerts_resp.text}"
                alerts_data = alerts_resp.json()
                for alert in alerts_data.get("list", []):
                    if alert["name"] == alert_name:
                        self.alert_ids.append(alert["alert_id"])
                        break

    def _cleanup(self):
        """Clean up all created resources."""
        # Delete alerts
        for alert_id in self.alert_ids:
            self.session.delete(
                f"{self.base_url}api/v2/{self.ORG_ID}/alerts/{alert_id}"
            )

        # Delete folder
        if hasattr(self, 'folder_id'):
            self.session.delete(
                f"{self.base_url}api/v2/{self.ORG_ID}/folders/alerts/{self.folder_id}"
            )

        # Delete destination
        self.session.delete(
            f"{self.base_url}api/{self.ORG_ID}/alerts/destinations/{self.destination_name}"
        )

        # Delete template
        self.session.delete(
            f"{self.base_url}api/{self.ORG_ID}/alerts/templates/{self.template_name}"
        )

    def get_alert(self, alert_id):
        """Helper to get an alert by ID."""
        response = self.session.get(
            f"{self.base_url}api/v2/{self.ORG_ID}/alerts/{alert_id}"
        )
        return response

    def test_01_bulk_disable_single_alert(self):
        """Test bulk disable with a single alert"""

        assert len(self.alert_ids) > 0, "Need at least 1 alert for this test"

        alert_id = self.alert_ids[0]

        # Get current state
        get_resp = self.get_alert(alert_id)
        assert get_resp.status_code == 200

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

        print(f"✓ Successfully bulk disabled alert")

    def test_02_bulk_enable_single_alert(self):
        """Test bulk enable with a single alert"""

        assert len(self.alert_ids) > 0, "Need at least 1 alert for this test"

        alert_id = self.alert_ids[0]

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

        print(f"✓ Successfully bulk enabled alert")

    def test_03_bulk_disable_multiple_alerts(self):
        """Test bulk disable with multiple alerts"""

        assert len(self.alert_ids) >= 2, "Need at least 2 alerts for this test"

        alert_ids = self.alert_ids[:2]

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

        print(f"✓ Successfully bulk disabled {len(alert_ids)} alerts")

    def test_04_bulk_toggle_same_alert_twice(self):
        """Test bulk enable/disable same alert twice (idempotent)"""

        assert len(self.alert_ids) > 0, "Need at least 1 alert for this test"

        alert_id = self.alert_ids[0]

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

        print(f"✓ Bulk operations are idempotent")

    def test_05_bulk_response_structure(self):
        """Test that bulk response has correct structure"""

        assert len(self.alert_ids) > 0, "Need at least 1 alert for this test"

        alert_id = self.alert_ids[0]

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

        print(f"✓ Response structure is correct")
