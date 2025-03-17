
import random

from pathlib import Path

from requests.auth import HTTPBasicAuth
class FolderPage:
    # Make Unique_value_destination a class variable
    Unique_value_folder = f"uFolder_{random.randint(100000, 999999)}"

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_folder(self, session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, folder_name):
        """Create a folder."""  
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)

        payload = {
            "description": folder_name,
            "folderId": "",
            "name": folder_name
        }

        response = session.post(f"{base_url}api/{org_id}/folders", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create folder: {response.content}"
        folder_id = response.json()["folderId"]
        return folder_id