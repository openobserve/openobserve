import os
import random




class RolePage:
    Unique_value_role = f"uRole_{random.randint(100000, 999999)}"  # Class variable

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id


    def create_role(self, session, base_url, org_id, role_name):
        """Create a role."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}

        payload = {
            "name": role_name,
        }

        response = session.post(f"{base_url}/api/{org_id}/roles", json=payload, headers=headers) 
        assert response.status_code == 200, f"Failed to create role: {response.content.decode()}"
        return response  