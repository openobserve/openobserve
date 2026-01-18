import random
import time
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
        response = session.post(f"{base_url}api/{org_id}/alerts/destinations?module=pipeline", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create destination: {response.content}"
        return response

    def retrieve_destinations_webhook(self, session, base_url, user_email, user_password, org_id):
        """Retrieve a webhook destination."""
        session.auth = HTTPBasicAuth(user_email, user_password)

        response = session.get(f"{base_url}api/{org_id}/alerts/destinations")
        assert response.status_code == 200, f"Failed to validate destination: {response.content}"
        destinations = response.json()
        assert len(destinations) > 0, "No destinations found"

        webhook_destinations = [destination for destination in destinations if "destination_webhook" in destination["name"] 
                           and destination["name"].startswith(f"destination_webhook_{self.Unique_value_destination}")]

        assert len(webhook_destinations) > 0, f"No destinations found containing 'destination_webhook' with title 'destination_webhook_{self.Unique_value_destination}'"
        return {
            "count": len(webhook_destinations),
            "destinations": webhook_destinations
        }
    

    def retrieve_destination_webhook(self, session, base_url, user_email, user_password, org_id, destination_name):
        """Retrieve the destination webhook and assert the body."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}")
        assert response.status_code == 200, f"Failed to validate destination: {response.content}"

        destination_webhook = response.json()  # Assuming the response is a single template, not a list.

        # Assert that the response is a valid template object
        assert isinstance(destination_webhook, dict), "Response is not a valid destination object"

        return {
            "name_destination_webhook": destination_webhook["name"]
        }

    def retrieve_destinations_email(self, session, base_url, user_email, user_password, org_id):
        """Retrieve destinations and extract the first destination name containing 'destination_email' with title 'email_title'."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/{org_id}/alerts/destinations")
        assert response.status_code == 200, f"Failed to validate destinations: {response.content}"

        destinations = response.json()
        assert len(destinations) > 0, "No destinations found"


        email_destinations = [
            destination for destination in destinations 
                if destination["name"].startswith(f"destination_email_{DestinationPage.Unique_value_destination}")
    ] 

        # Assert that there are templates matching the criteria
        assert len(email_destinations) > 0, f"No destinations found containing 'destination_email' with title 'destination_email_{DestinationPage.Unique_value_destination}'"

        # Return structured data
        return {
            "count": len(email_destinations),
            "destinations": email_destinations
        }

    def retrieve_destination_email(self, session, base_url, user_email, user_password, org_id, destination_name):
        """Retrieve the destination email and assert the title."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}")
        assert response.status_code == 200, f"Failed to validate destination: {response.content}"

        destination_email = response.json()  # Assuming the response is a single template, not a list.
        assert isinstance(destination_email, dict), "Response is not a valid destination object"


        return {
            "name_destination_email": destination_email["name"]
        }

    def retrieve_destinations_pipeline(self, session, base_url, user_email, user_password, org_id):
        """Retrieve destinations and extract the first destination name containing 'destination_pipeline' with title 'pipeline_title'."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/{org_id}/alerts/destinations?module=pipeline")
        assert response.status_code == 200, f"Failed to validate destinations: {response.content}"

        destinations = response.json()
        assert len(destinations) > 0, "No destinations found"

        pipeline_destinations = [destination for destination in destinations if "destination_pipeline" in destination["name"]
                           and destination["name"].startswith(f"destination_pipeline_{DestinationPage.Unique_value_destination}")]

        assert len(pipeline_destinations) > 0, f"No destinations found containing 'destination_pipeline' with title 'destination_pipeline_{DestinationPage.Unique_value_destination}'"

        return {
            "count": len(pipeline_destinations),
            "destinations": pipeline_destinations
        }   

    def retrieve_destination_pipeline(self, session, base_url, user_email, user_password, org_id, destination_name):
        """Retrieve the destination pipeline and assert the title."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}")
        assert response.status_code == 200, f"Failed to validate destination: {response.content}"

        destination_pipeline = response.json()  # Assuming the response is a single template, not a list.
        assert isinstance(destination_pipeline, dict), "Response is not a valid destination object"

        return {
            "name_destination_pipeline": destination_pipeline["name"]
        }   
    
    def update_destination_webhook(self, session, base_url, user_email, user_password, org_id, template_name, destination_name):
        """Update an Webhook destination."""
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
        response = session.put(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to update destination: {response.content}"
        destination_webhook = response.json()
        assert isinstance(destination_webhook, dict), "Response is not a valid destination object"

    def update_destination_email(self, session, base_url, user_email, user_password, org_id, email_address_admin, template_email, destination_name):
        """Update an Email destination."""

        # Set up authentication
        session.auth = HTTPBasicAuth(user_email, user_password)

        # Define the payload for the PUT request
        payload = {
            "url": "",
            "type": "email",
            "emails": [email_address_admin],
            "method": "post",
            "template": template_email,
            "headers": {},
            "name": destination_name,
            "skip_tls_verify": False
        }

        # Perform the API request to update the destination
        response = session.put(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}", json=payload)

        # Check for a successful response
        if response.status_code != 200:
            print(f"Failed to update destination: {response.content}")  # Log the response content
            response.raise_for_status()  # Raise an exception for HTTP errors

        # For successful updates, we'll verify the update by getting the destination
        verify_response = session.get(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}")
        
        if verify_response.status_code != 200:
            print(f"Failed to verify destination update: {verify_response.content}")
            verify_response.raise_for_status()

        destination_email = verify_response.json()

        # Validate the response structure
        if not isinstance(destination_email, dict):
            raise ValueError("Response is not a valid destination object")

        # Verify the update was successful by checking the name matches
        if destination_email.get('name') != destination_name:
            raise ValueError(f"Updated destination name mismatch. Expected: {destination_name}, Got: {destination_email.get('name')}")

        return {
            "name_destination_email": destination_name
        }

    def update_destination_pipeline(self, session, base_url, user_email, user_password, org_id, destination_name):
        """Update a pipeline destination."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        skip_tls_verify_value = False
        payload = {
            "url": "https://jsonplaceholder.typicode.com/todos",
            "method": "get",
            "template": "",
            "headers": {},
            "name": destination_name,
            "skip_tls_verify": skip_tls_verify_value
        }
        response = session.put(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}?module=pipeline", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to update destination: {response.content}"
        destination_pipeline = response.json()
        assert isinstance(destination_pipeline, dict), "Response is not a valid destination object" 


    def delete_destination(self, session, base_url, user_email, user_password, org_id, destination_name):
        """Delete destinations of a specified type."""
        session.auth = HTTPBasicAuth(user_email, user_password)

        resp_delete_destination = session.delete(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}")
        assert resp_delete_destination.status_code == 200, f"Failed to delete destination {destination_name}: {resp_delete_destination.content}"

            # Wait for a few seconds to allow the data to be deleted
        time.sleep(10)  # Increase this time if necessary

        # Verify deletion
        resp_ver_destination = session.get(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}")
        assert resp_ver_destination.status_code == 404, f"Expected 404 for {destination_name}, but got {resp_ver_destination.status_code}"

        return resp_delete_destination  # Return the list of deleted destination names for verification if needed

    def validate_deleted_destination_webhook(self, session, base_url, user_email, user_password, org_id, destination_name):
        """Running an E2E test for validating deleted destinations in SC."""
        session.auth = HTTPBasicAuth(user_email, user_password)         
        # Retrieve all destinations
        response = session.get(f"{base_url}api/{org_id}/alerts/destinations")
        assert response.status_code == 200, f"Failed to retrieve destinations: {response.content}"

        destinations = response.json()

        # Filter destinations that contain 'destination_webhook' and match the expected name
        webhook_destinations = [destination for destination in destinations 
                           if "destination_webhook" in destination["name"] 
                           and destination["name"].startswith(f"destination_webhook_{DestinationPage.Unique_value_destination}")]

        # Check if any templates of the specified type exist
        if len(webhook_destinations) == 0:
            print(f"No destinations found of type '{destination_name}'")
        else:
            print(f"Destinations found of type '{destination_name}': {[destination['name'] for destination in webhook_destinations]}")
        return webhook_destinations

    def validate_deleted_destination_email(self, session, base_url, user_email, user_password, org_id, destination_name):
        """Running an E2E test for validating deleted destinations in SC."""
        session.auth = HTTPBasicAuth(user_email, user_password)         
        # Retrieve all destinations
        response = session.get(f"{base_url}api/{org_id}/alerts/destinations")
        assert response.status_code == 200, f"Failed to retrieve destinations: {response.content}"

        destinations = response.json()

        # Filter destinations that contain 'destination_email' and match the expected name
        email_destinations = [destination for destination in destinations 
                           if "destination_email" in destination["name"] 
                           and destination["name"].startswith(f"destination_email_{DestinationPage.Unique_value_destination}")]

        # Check if any templates of the specified type exist
        if len(email_destinations) == 0:
            print(f"No destinations found of type '{destination_name}'")
            # Optionally, you can choose to skip the assertion or handle it differently
        else:
            assert len(email_destinations) > 0, f"No destinations found of type '{destination_name}'"
            print(f"Destinations found of type '{destination_name}': {[destination['name'] for destination in email_destinations]}")

            return email_destinations
        
    def validate_deleted_destination_pipeline(self, session, base_url, user_email, user_password, org_id, destination_name):
        """Running an E2E test for validating deleted destinations in SC."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        # Retrieve all pipeline destinations
        response = session.get(f"{base_url}api/{org_id}/alerts/destinations?module=pipeline")
        assert response.status_code == 200, f"Failed to retrieve destinations: {response.content}"

        destinations = response.json()

        # Filter destinations that contain 'destination_pipeline' and match the expected name
        pipeline_destinations = [destination for destination in destinations
                           if "destination_pipeline" in destination["name"]
                           and destination["name"].startswith(f"destination_pipeline_{DestinationPage.Unique_value_destination}")]

        # Check if any templates of the specified type exist
        if len(pipeline_destinations) == 0:
            print(f"No destinations found of type '{destination_name}'")
        else:
            print(f"Destinations found of type '{destination_name}': {[destination['name'] for destination in pipeline_destinations]}")
        return pipeline_destinations    
    

    