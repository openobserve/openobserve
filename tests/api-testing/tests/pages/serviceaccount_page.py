import random
from requests.auth import HTTPBasicAuth



class ServiceAccountPage:
    Unique_value_serviceaccount = f"d4m21_{random.randint(100000, 999999)}"  # Class variable

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_service_account(self, session, base_url, user_email, user_password, org_id, email_address):

        """Create a service account."""

        session.auth = HTTPBasicAuth(user_email, user_password)

        headers = {"Content-Type": "application/json", "Custom-Header": "value"}

        payload = {
            "email": email_address,
            "organization": org_id,
            "first_name": "Shyam",
            "last_name": "Panjiyar"
        }
        print("Payload for service account creation:", payload)  # Log the payload
        response = session.post(
            f"{base_url}api/{org_id}/service_accounts", 
            json=payload, 
            headers=headers
        )
        assert response.status_code == 200, f"Failed to create service account: {response.content.decode()}"

        print(f"Service account created successfully: {response.json()}")

        response_get = session.get(
            f"{base_url}api/{org_id}/service_accounts/{email_address}", 
            headers=headers
        )
        assert response_get.status_code == 200, f"Failed to get service account: {response_get.content.decode()}"

        print(f"Service account created successfully: {response_get.json()}")

        token = response_get.json()['token']

        print(f"Token: {token}")

        return token



    # def test_delete_serviceaccount(create_session, base_url):
#     """Running an E2E test for deleting a service account."""
#     session = create_session

#     # Delete the service account
#     resp_delete_serviceaccount = session.delete(
#         f"{base_url}api/{org_id}/service_accounts/{email_id}"
#     )

#     print("Service Account Deleted", resp_delete_serviceaccount.content)

#     assert (
#         resp_delete_serviceaccount.status_code == 200
#     ), f"Expected 200, but got {resp_delete_serviceaccount.status_code} {resp_delete_serviceaccount.content}"
