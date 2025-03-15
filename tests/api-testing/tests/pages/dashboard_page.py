import random

class DashboardPage:
    # Make Unique_value_destination a class variable
    Unique_value_dashboard = f"uDashboard_{random.randint(100000, 999999)}"

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_dashboard(self, session, base_url, org_id, dashboard_name, folder_id, ZO_ROOT_USER_EMAIL):
        """Create a dashboard."""
        headers = {
            "Content-Type": "application/json", 
            "Custom-Header": "value"
        }
        
        payload = {
            "title": dashboard_name,
            "dashboardId": "",
            "description": "",
            "variables": {
                "list": [],
                "showDynamicFilters": True
            },
            "defaultDatetimeDuration": {
                "startTime": None,
                "endTime": None,
                "relativeTimePeriod": "15m",
                "type": "relative"
            },
            "role": "",
            "owner": ZO_ROOT_USER_EMAIL,
            "tabs": [
                {
                    "panels": [],
                    "name": "Default",
                    "tabId": "default"
                }
            ],
            "version": 3
        }

        response = session.post(f"{base_url}api/{org_id}/dashboards?folder={folder_id}", json=payload, headers=headers)

        # Improved error handling
        assert response.status_code == 200, f"Failed to create dashboard: {response.content.decode()}"
        dashboard_id = response.json()["v3"]["dashboardId"]
        return dashboard_id