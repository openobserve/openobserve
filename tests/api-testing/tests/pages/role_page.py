import random
from requests.auth import HTTPBasicAuth



class RolePage:
    Unique_value_role = f"role{random.randint(100000, 999999)}"  # Class variable

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id


    def create_role(self, session, base_url, user_email, user_password, org_id, role_name):
        """Create a role."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)     
        payload = {
            "name": role_name,
            "description": f"Test role {role_name}",
            "permissions": []  # Add default empty permissions array
        }

        response = session.post(f"{base_url}api/{org_id}/roles", json=payload, headers=headers) 
        assert response.status_code == 200, f"Failed to create role: {response.content.decode()}"
        return response  