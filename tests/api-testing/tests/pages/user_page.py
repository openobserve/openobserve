import random
from requests.auth import HTTPBasicAuth
import time


class UserPage:
    Unique_value_user = f"uUser_{random.randint(100000, 999999)}"  # Class variable

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_user_admin(self, session, base_url, org_id, email_address):
        """Create a user as admin."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}

        payload = {
            "organization": org_id,
            "email": email_address,
            "password": "12345678",
            "first_name": "Shyam",
            "last_name": "P",
            "role": "admin",
        }

        response = session.post(f"{base_url}api/{org_id}/users", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create user as admin: {response.content.decode()}"
        return response

    def create_user_viewer(session, base_url, org_id, email_address):
        """Create a user as viewer."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}

        payload = {
            "organization": org_id,
            "email": email_address,
            "password": "12345678",
            "first_name": "Shyam",
            "last_name": "P",
            "role": "viewer",
        }   

        response = session.post(f"{base_url}api/{org_id}/users", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create user as viewer: {response.content.decode()}"
        return response

    def create_user_editor(session, base_url, org_id, email_address):
        """Create a user as editor."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}

        payload = {
            "organization": org_id,
            "email": email_address,
            "password": "12345678",
            "first_name": "Shyam",
            "last_name": "P",
            "role": "editor",
        }   

        response = session.post(f"{base_url}api/{org_id}/users", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create user as editor: {response.content.decode()}"
        return response

    def create_user_user(session, base_url, org_id, email_address):
        """Create a user as user."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}

        payload = {
            "organization": org_id,
            "email": email_address,
            "password": "12345678",
            "first_name": "Shyam",
            "last_name": "P",
            "role": "user",
        }   

        response = session.post(f"{base_url}api/{org_id}/users", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create user as user: {response.content.decode()}"
        return response