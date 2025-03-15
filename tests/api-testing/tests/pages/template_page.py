
import random
import os
import random
import uuid
import time


class TemplatePage:
    Unique_value_temp = f"uT_{random.randint(100000, 999999)}"  # Class variable

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_template_webhook(self, session, base_url, org_id, template_name):
        """Create a Webhook template."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}

        payload = {
            "name": template_name,
            "body": '{\n  \"text\": \"{alert_name} is active\"\n}',
            "type": "http",
            "title": ""
        }      
        response = session.post(f"{base_url}api/{org_id}/alerts/templates", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create template: {response.content}"
        return response

    def create_template_email(self, session, base_url, org_id, template_name):
        """Create an Email template."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}

        payload = {
            "name": template_name,
            "body": '{"text": "For stream {stream_name} of organization {org} alert {alert_name} of type {alert_type} is active"}',
            "type": "email",
            "title": "email_title"
        }      
        response = session.post(f"{base_url}api/{org_id}/alerts/templates", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create template: {response.content}"
        return response 

    def retrieve_templates_webhook(self, session, base_url, org_id):
        """Retrieve templates and extract information about the first template matching the specified name."""
        
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
        
        # Extract the first template's complete name
        first_template_name_webhook = webhook_templates[0]['name']
        
        # Return structured data
        return {
            "count": len(webhook_templates),
            "first_template_webhook": first_template_name_webhook,
            "templates": webhook_templates
        }


    def retrieve_template_webhook(self, session, base_url, org_id, template_name):
        """Retrieve the template webhook and assert the body."""
        
        response = session.get(f"{base_url}api/{org_id}/alerts/templates/{template_name}")
        assert response.status_code == 200, f"Failed to validate template: {response.content}"
        
        template_webhook = response.json()  # Assuming the response is a single template, not a list.
        
        # Assert that the response is a valid template object
        assert isinstance(template_webhook, dict), "Response is not a valid template object"
        
        
        return {
            "name_template_webhook": template_webhook["name"],
            "body_template_webhook": template_webhook["body"]
        }





    def retrieve_templates_email(self, session, base_url, org_id):
        """Retrieve templates and extract the first template name containing 'template_email' with title 'email_title'."""
        response = session.get(f"{base_url}api/{org_id}/alerts/templates")
        assert response.status_code == 200, f"Failed to validate templates: {response.content}"
        
        templates = response.json()
        assert len(templates) > 0, "No templates found"
        
        # Variable to store the first matching template name
        first_template_name = None
        
        email_templates = [
            template for template in templates 
             if template["name"].startswith(f"template_email_{TemplatePage.Unique_value_temp}")
    ] 
        
        # Assert that there are templates matching the criteria
        assert len(email_templates) > 0, f"No templates found containing 'template_email' with title 'template_email_{TemplatePage.Unique_value_temp}'"
        
        # Extract the first template's complete name
        first_template_name_email = email_templates[0]['name']
        
        # Return structured data
        return {
            "count": len(email_templates),
            "first_template_email": first_template_name_email,
            "templates": email_templates
        }

    def retrieve_template_email(self, session, base_url, org_id, template_name):
        """Retrieve the template email and assert the title."""
        response = session.get(f"{base_url}api/{org_id}/alerts/templates/{template_name}")
        assert response.status_code == 200, f"Failed to validate template: {response.content}"
        
        template_email = response.json()  # Assuming the response is a single template, not a list.
        assert isinstance(template_email, dict), "Response is not a valid template object"
        
       
        return {
            "name_template_email": template_email["name"],
            "title_template_email": template_email["title"]
        }

    def update_template_webhook(self, session, base_url, org_id, template_name):
        """Update an Webhook template."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}

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
        
        

    def update_template_email(self, session, base_url, org_id, template_name):
        """Update an Email template."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}

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

        


    def delete_template(self, session, base_url, org_id, template_type):
        """Delete templates of a specified type."""
        
        # Retrieve all templates
        response = session.get(f"{base_url}api/{org_id}/alerts/templates")
        assert response.status_code == 200, f"Failed to retrieve templates: {response.content}"
        
        templates = response.json()
        
        # Filter templates that match the specified template type
        template_names_to_delete = [
            template['name'] for template in templates 
               if template["name"].startswith(f"{template_type}_{TemplatePage.Unique_value_temp}")
        ]
        
        # Delete each template of the specified type
        for template_name in template_names_to_delete:
            resp_delete_template = session.delete(f"{base_url}api/{org_id}/alerts/templates/{template_name}")
            assert resp_delete_template.status_code == 200, f"Failed to delete template {template_name}: {resp_delete_template.content}"
            
            # Wait for a few seconds to allow the data to be ingested
            time.sleep(10)  # Increase this time if necessary

            # Verify deletion
            resp_ver_template = session.get(f"{base_url}api/{org_id}/alerts/templates/{template_name}")
            assert resp_ver_template.status_code == 404, f"Expected 404 for {template_name}, but got {resp_ver_template.status_code}"

        return template_names_to_delete  # Return the list of deleted template names for verification if needed


    def validate_deleted_template(self, session, base_url, org_id, template_name):
        """Running an E2E test for validating deleted template."""

        # Verify deleted template
        resp_ver_template = session.get(f"{base_url}api/{org_id}/alerts/templates/{template_name}")

        assert (
            resp_ver_template.status_code == 404
        ), f"Expected 404 for deleted template '{template_name}', but got {resp_ver_template.status_code}: {resp_ver_template.content}"

        return resp_ver_template


    def validate_deleted_template_SC(self, session, base_url, org_id, template_type):
        """Running an E2E test for validating deleted templates in SC."""

        # Retrieve all templates
        response = session.get(f"{base_url}api/{org_id}/alerts/templates")
        assert response.status_code == 200, f"Failed to retrieve templates: {response.content}"

        templates = response.json()

        # Filter templates that match the specified template type
        template_type_names = [template for template in templates if template['type'] == template_type]

        # Check if any templates of the specified type exist
        if len(template_type_names) == 0:
            print(f"No templates found of type '{template_type}'")
            # Optionally, you can choose to skip the assertion or handle it differently
        else:
            assert len(template_type_names) > 0, f"No templates found of type '{template_type}'"
            print(f"Templates found of type '{template_type}': {[template['name'] for template in template_type_names]}")

        return template_type_names


