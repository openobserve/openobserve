import random
from requests.auth import HTTPBasicAuth


class DestinationPage:
    # Make Unique_value_destination a class variable
    Unique_value_destination = f"d4m21_{random.randint(100000, 999999)}"

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_destination_webhook(self, session, base_url, org_id, user_email, user_password, template_name, destination_name):
        """Create a webhook destination."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        skip_tls_verify_value = False

        payload = {
            "url": "https://jsonplaceholder.typicode.com/todos",
            "method": "get",
            "template": template_name,
            "headers": {},
            "name": destination_name,
            "skip_tls_verify": skip_tls_verify_value
        }

        response = session.post(f"{base_url}api/{org_id}/alerts/destinations", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create destination: {response.content}"
        return response

    def create_destination_email(self, session, base_url, org_id, user_email, user_password, email_address_admin, template_email, destination_name):
        """Create a email destination."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        skip_tls_verify_value = False
        payload = {
            "url": "",
            "type": "email",
            "emails": [email_address_admin],
            "method": "post",
            "template": template_email,
            "headers": {},
            "name": destination_name,
            "skip_tls_verify": skip_tls_verify_value
        }
        response = session.post(f"{base_url}api/{org_id}/alerts/destinations", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create destination: {response.content}"
        return response

    def create_destination_pipeline(self, session, base_url, org_id, user_email, user_password, destination_name):
        """Create a pipeline destination."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        skip_tls_verify_value = False  # Define the skip_tls_verify_value
        payload = {
            "url": "https://jsonplaceholder.typicode.com/todos",
            "method": "get",
            "template": "",  
            "headers": {},  # Ensure this is formatted correctly
            "name": destination_name,
            "skip_tls_verify": skip_tls_verify_value
        }
        response = session.post(f"{base_url}api/{org_id}/alerts/destinations", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create destination: {response.content}"
        return response

    def retrieve_destinations_webhook(self, session, base_url, user_email, user_password, org_id):
        """Retrieve a webhook destination."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        
        response = session.get(f"{base_url}api/{org_id}/alerts/destinations")
        assert response.status_code == 200, f"Failed to validate destination: {response.content}"
        destinations = response.json()
        assert len(destinations) > 0, "No destinations found"
        webhook_destinations = [destination for destination in destinations if destination['type'] == 'http']
        assert len(webhook_destinations) > 0, "No webhook destinations found"
        first_webhook_destination = webhook_destinations[0]
        return first_webhook_destination

    def delete_destination(self, session, base_url, org_id, user_email, user_password, destination_id):
        """Delete a destination."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.delete(f"{base_url}api/{org_id}/alerts/destinations/{destination_id}")
        assert response.status_code == 200, f"Failed to delete destination: {response.content}"
        return response




def test_e2e_destinations(create_session, base_url):
    """Running an E2E test for get all the destination list under alerts."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_alldestinations = session.get(f"{url}api/{org_id}/alerts/destinations")

    print(resp_get_alldestinations.content)
    assert (
        resp_get_alldestinations.status_code == 200
    ), f"Get all alerts list 200, but got {resp_get_alldestinations.status_code} {resp_get_alldestinations.content}"


def delete_destination(create_session, base_url):
    """Running an E2E test for deleting destination that does not exist ."""

    session = create_session
    url = base_url
    org_id = "default"
    resp_delete_destination = session.delete(
        f"{url}api/{org_id}/alerts/destinations/destinationname"
    )
    assert (
        resp_delete_destination.status_code == 404
    ), f"Deleting this destination, but got {resp_delete_destination.status_code} {resp_delete_destination.content}"
