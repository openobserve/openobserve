import random
from requests.auth import HTTPBasicAuth



class UserPage:
    Unique_value_user = f"d4m21_{random.randint(100000, 999999)}"  # Class variable

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_user_admin(self, session, base_url, user_email, user_password, org_id, email_address):
        """Create a user as admin."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)

        payload = {
            "organization": org_id,
            "email": email_address,
            "password": "Complexpass#123",
            # Standard convention: all automated-test users use the
            # same display name so they're identifiable as test-created
            # in the IAM users page (and safe to clean up).
            "first_name": "Automation",
            "last_name": "TestUser",
            "role": "admin",
        }

        print("Payload for user creation:", payload)  # Log the payload
        response = session.post(f"{base_url}api/{org_id}/users", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create user as admin: {response.content.decode()}"
        return response