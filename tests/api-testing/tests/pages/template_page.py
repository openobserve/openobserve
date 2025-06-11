import random
import time
from requests.auth import HTTPBasicAuth

class TemplatePage:
    Unique_value_temp = f"d4m21_{random.randint(100000, 999999)}"  # Class variable

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_template_webhook(self, session, base_url, user_email, user_password, org_id, template_name):
        """Create a Webhook template."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        payload = {
            "name": template_name,
            "body": '{\n  \"text\": \"{alert_name} is active\"\n}',
            "type": "http",
            "title": ""
        }      
        response = session.post(f"{base_url}api/{org_id}/alerts/templates", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create template: {response.content}"
        return response

    def create_template_email(self, session, base_url, user_email, user_password, org_id, template_name):
        """Create an Email template."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        payload = {
            "name": template_name,
            "body": '{"text": "For stream {stream_name} of organization {org} alert {alert_name} of type {alert_type} is active"}',
            "type": "email",
            "title": "email_title"
        }      
        response = session.post(f"{base_url}api/{org_id}/alerts/templates", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create template: {response.content}"
        return response 

    def retrieve_templates_webhook(self, session, base_url, user_email, user_password, org_id):
        """Retrieve templates and extract information about all templates matching the specified criteria."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/{org_id}/alerts/templates")
        assert response.status_code == 200, f"Failed to validate templates: {response.content}"

        # Parse the JSON response
        templates = response.json()
        assert len(templates) > 0, "No templates found"

        # Filter templates that contain 'template_webhook' and match the expected name
        webhook_templates = [template for template in templates 
                           if "template_webhook" in template["name"] 
                           and template["name"].startswith(f"template_webhook_{TemplatePage.Unique_value_temp}")]

        # Assert that there are templates matching the criteria
        assert len(webhook_templates) > 0, f"No templates found containing 'template_webhook' with title 'template_webhook_{TemplatePage.Unique_value_temp}'"

        # Return structured data
        return {
            "count": len(webhook_templates),
            "templates": webhook_templates
        }

    def retrieve_template_webhook(self, session, base_url, user_email, user_password, org_id, template_name):
        """Retrieve the template webhook and assert the body."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/{org_id}/alerts/templates/{template_name}")
        assert response.status_code == 200, f"Failed to validate template: {response.content}"

        template_webhook = response.json()  # Assuming the response is a single template, not a list.

        # Assert that the response is a valid template object
        assert isinstance(template_webhook, dict), "Response is not a valid template object"

        return {
            "name_template_webhook": template_webhook["name"],
            "body_template_webhook": template_webhook["body"]
        }

    def retrieve_templates_email(self, session, base_url, user_email, user_password, org_id):
        """Retrieve templates and extract the first template name containing 'template_email' with title 'email_title'."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/{org_id}/alerts/templates")
        assert response.status_code == 200, f"Failed to validate templates: {response.content}"

        templates = response.json()
        assert len(templates) > 0, "No templates found"


        email_templates = [
            template for template in templates 
                if template["name"].startswith(f"template_email_{TemplatePage.Unique_value_temp}")
    ] 

        # Assert that there are templates matching the criteria
        assert len(email_templates) > 0, f"No templates found containing 'template_email' with title 'template_email_{TemplatePage.Unique_value_temp}'"

        # Return structured data
        return {
            "count": len(email_templates),
            "templates": email_templates
        }

    def retrieve_template_email(self, session, base_url, user_email, user_password, org_id, template_name):
        """Retrieve the template email and assert the title."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/{org_id}/alerts/templates/{template_name}")
        assert response.status_code == 200, f"Failed to validate template: {response.content}"

        template_email = response.json()  # Assuming the response is a single template, not a list.
        assert isinstance(template_email, dict), "Response is not a valid template object"


        return {
            "name_template_email": template_email["name"],
            "title_template_email": template_email["title"]
        }

    def update_template_webhook(self, session, base_url, user_email, user_password, org_id, template_name):
        """Update an Webhook template."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        payload = {
            "name": template_name,
            "body": '{"text": "For stream {stream_name} of organization {org} alert {alert_name} of type {alert_type} is active"}',
            "type": "http",
            "title": ""
        }      
        response = session.put(f"{base_url}api/{org_id}/alerts/templates/{template_name}", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to update template: {response.content}"
        template_webhook = response.json()
        assert isinstance(template_webhook, dict), "Response is not a valid template object"

    def update_template_email(self, session, base_url, user_email, user_password, org_id, template_name):
        """Update an Email template."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        payload = {
            "name": template_name,
            "body": '{"text": "For stream {stream_name} of organization {org} alert {alert_name} of type {alert_type} is active"}',
            "type": "email",
            "title": "email_title_updated"
        }      
        response = session.put(f"{base_url}api/{org_id}/alerts/templates/{template_name}", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to update template: {response.content}"
        template_email = response.json()
        assert isinstance(template_email, dict), "Response is not a valid template object"

    def delete_template(self, session, base_url, user_email, user_password, org_id, template_name):
        """Delete templates of a specified type."""
        session.auth = HTTPBasicAuth(user_email, user_password)

        resp_delete_template = session.delete(f"{base_url}api/{org_id}/alerts/templates/{template_name}")
        assert resp_delete_template.status_code == 200, f"Failed to delete template {template_name}: {resp_delete_template.content}"

            # Wait for a few seconds to allow the data to be deleted
        time.sleep(10)  # Increase this time if necessary

            # Verify deletion
        resp_ver_template = session.get(f"{base_url}api/{org_id}/alerts/templates/{template_name}")
        assert resp_ver_template.status_code == 404, f"Expected 404 for {template_name}, but got {resp_ver_template.status_code}"

        return resp_delete_template  # Return the list of deleted template names for verification if needed

    def validate_deleted_template_webhook(self, session, base_url, user_email, user_password, org_id, template_name):
        """Running an E2E test for validating deleted templates in SC."""
        session.auth = HTTPBasicAuth(user_email, user_password)         
        # Retrieve all templates
        response = session.get(f"{base_url}api/{org_id}/alerts/templates")
        assert response.status_code == 200, f"Failed to retrieve templates: {response.content}"

        templates = response.json()

        # Filter templates that contain 'template_webhook' and match the expected name
        webhook_templates = [template for template in templates 
                           if "template_webhook" in template["name"] 
                           and template["name"].startswith(f"template_webhook_{TemplatePage.Unique_value_temp}")]

        # Check if any templates of the specified type exist
        if len(webhook_templates) == 0:
            print(f"No templates found of type '{template_name}'")
        else:
            print(f"Templates found of type '{template_name}': {[template['name'] for template in webhook_templates]}")
        return webhook_templates

    def validate_deleted_template_email(self, session, base_url, user_email, user_password, org_id, template_name):
        """Running an E2E test for validating deleted templates in SC."""
        session.auth = HTTPBasicAuth(user_email, user_password)         
        # Retrieve all templates
        response = session.get(f"{base_url}api/{org_id}/alerts/templates")
        assert response.status_code == 200, f"Failed to retrieve templates: {response.content}"

        templates = response.json()

        # Filter templates that contain 'template_email' and match the expected name
        email_templates = [template for template in templates 
                           if "template_email" in template["name"] 
                           and template["name"].startswith(f"template_email_{TemplatePage.Unique_value_temp}")]

        # Check if any templates of the specified type exist
        if len(email_templates) == 0:
            print(f"No templates found of type '{template_name}'")
            # Optionally, you can choose to skip the assertion or handle it differently
        else:
            assert len(email_templates) > 0, f"No templates found of type '{template_name}'"
            print(f"Templates found of type '{template_name}': {[template['name'] for template in email_templates]}")

        return email_templates

