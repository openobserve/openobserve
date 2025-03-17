import random

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

    def create_destination_email(self, session, base_url, org_id, template_email, destination_name, email_address):
        """Create a destination."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        skip_tls_verify_value = False
        payload = {
            "url": "",
            "type": "email",
            "emails": [email_address],
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

    def retrieve_destinations_webhook(self, session, base_url, org_id):
        """Validate a destination."""
        response = session.get(f"{base_url}api/{org_id}/alerts/destinations")
        assert response.status_code == 200, f"Failed to validate destination: {response.content}"
        destinations = response.json()
        assert len(destinations) > 0, "No destinations found"
        webhook_destinations = [destination for destination in destinations if destination['type'] == 'http']
        assert len(webhook_destinations) > 0, "No webhook destinations found"
        first_webhook_destination = webhook_destinations[0]
        return first_webhook_destination

    def delete_destination(self, session, base_url, org_id, destination_name):
        """Delete a destination."""
        response = session.delete(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}")
        assert response.status_code == 200, f"Failed to delete destination: {response.content}"
        return response
   
