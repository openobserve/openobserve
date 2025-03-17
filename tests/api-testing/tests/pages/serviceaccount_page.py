import random
from requests.auth import HTTPBasicAuth
import time


class ServiceAccountPage:
    Unique_value_serviceaccount = f"uServiceAccount_{random.randint(100000, 999999)}"  # Class variable

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_service_account(self, session, base_url, user_email, user_password, org_id, email_address):
        """Create a service account.
        
        session.auth = HTTPBasicAuth(user_email, user_password) 

        Args:
            email_address (str): Email address for the service account
            
        Returns:
            Response: API response object
        """
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}

        payload = {
            "email": email_address,
            "organization": self.org_id,
            "first_name": "Shyam",
            "last_name": "Panjiyar"
        }

        response = session.post(
            f"{base_url}api/{org_id}/service_accounts", 
            json=payload, 
            headers=headers
        )
        assert response.status_code == 200, f"Failed to create service account: {response.content.decode()}"
        return response