import logging
import random
from requests.auth import HTTPBasicAuth

logger = logging.getLogger(__name__)



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
            # Standard convention: all automated-test users / service
            # accounts use the same display name so they're identifiable
            # as test-created in the IAM users page (and safe to clean up).
            "first_name": "Automation",
            "last_name": "TestUser",
        }
        logger.debug("Payload for service account creation: %s", payload)
        response = session.post(
            f"{base_url}api/{org_id}/service_accounts",
            json=payload,
            headers=headers
        )
        assert response.status_code == 200, f"Failed to create service account: {response.content.decode()}"

        response_data = response.json()
        logger.debug("Service account created successfully: %s", response_data)

        # Token is returned in the create response.
        token = response_data['token']

        # Token is a credential — debug-level only so it doesn't surface
        # in default CI output, but still available if someone enables
        # debug logging to chase a service-account auth issue.
        logger.debug("Token: %s", token)

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
