import random
from requests.auth import HTTPBasicAuth

class FolderPage:
    # Make Unique_value_destination a class variable
    Unique_value_folder = f"a14_{random.randint(100000, 999999)}"

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id
    
    def create_folder_alert_v2(self, session, base_url, user_email, user_password, org_id, folder_name):
        """Create alert folder."""  
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)

        payload = {
            "description": folder_name,
            "folderId": "",
            "name": folder_name
        }

        response = session.post(f"{base_url}api/v2/{org_id}/folders/alerts", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create folder: {response.content}"
        folder_id = response.json()["folderId"]
        return folder_id
    
    def create_folder_dashboard_v2(self, session, base_url, user_email, user_password, org_id, folder_name):
        """Create dashboard folder."""  
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)

        payload = {
            "description": folder_name,
            "folderId": "",
            "name": folder_name
        }

        response = session.post(f"{base_url}api/v2/{org_id}/folders/dashboards", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create folder: {response.content}"
        folder_id = response.json()["folderId"]
        return folder_id