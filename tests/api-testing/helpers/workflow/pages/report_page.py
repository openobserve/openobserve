import random
from requests.auth import HTTPBasicAuth



class ReportPage:
    Unique_value_report = f"d4m21_{random.randint(100000, 999999)}"  # Class variable

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_scheduled_report(self, session, base_url, user_email, user_password, org_id, dashboard_id, folder_id, scheduled_report_name):
        """Create a scheduled report."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        payload = {
        "dashboards": [
            {
                "folder": folder_id,                        
                "dashboard": dashboard_id,
                "tabs": ["default"],
                "variables": [],
                "timerange": {
                    "type": "relative",
                    "period": "30m",
                    "from": 1741687525799000,
                    "to": 1741689325799000
                }
            }
        ],
        "description": "",
        "destinations": [
            {
                "email": user_email
            }
        ],
        "enabled": True,
        "media_type": "Pdf",
        "name": scheduled_report_name,
        "title": scheduled_report_name,
        "message": "hi",
        "orgId": org_id,
        "start": 1741689360000000,
        "frequency": {
            "interval": 1,
            "type": "once",
            "cron": ""
        },
        "user": "",
        "password": "",
        "timezone": "Asia/Calcutta",
        "timezoneOffset": 330,
        "owner": user_email,
        "lastEditedBy": user_email,
        "report_type": "PDF"
    }

        response = session.post(f"{base_url}api/{org_id}/reports", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create scheduled report: {response.content.decode()}"
        return response

    def create_cached_report(self, session, base_url, user_email, user_password, org_id, dashboard_id, folder_id, cached_report_name):
        """Create a cached report."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)

        payload = {
        "dashboards": [
            {
                "folder": folder_id,
                "dashboard": dashboard_id,
                "tabs": ["default"],
                "variables": [],
                "timerange": {
                    "type": "relative",
                    "period": "30m",
                    "from": 1741687525799000,
                    "to": 1741689325799000
                }
            }
        ],
        "description": "",
        "destinations": [

        ],
        "enabled": True,
        "media_type": "Pdf",
        "name": cached_report_name,
        "title": cached_report_name,
        "message": "hi",
        "orgId": org_id,
        "start": 1741689360000000,
        "frequency": {
            "interval": 1,
            "type": "once",
            "cron": ""
        },
        "user": "",
        "password": "",
        "timezone": "Asia/Calcutta",
        "timezoneOffset": 330,
        "owner": user_email,
        "lastEditedBy": user_email,
        "report_type": "PDF"
    }

        response = session.post(f"{base_url}api/{org_id}/reports", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create cached report: {response.content.decode()}"
        return response