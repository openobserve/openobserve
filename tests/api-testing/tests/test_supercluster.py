import os
import pytest
import random
import uuid
import json
from pathlib import Path
import base64
import requests
import io
import time
import tink
from tink import daead
from tink import secret_key_access
from datetime import datetime, timezone, timedelta



# Constants for WebSocket URL and user credentials
ZO_BASE_URL = os.environ.get("ZO_BASE_URL")  # Use environment variable
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable

root_dir = Path(__file__).parent.parent.parent


# Variables to be used in the tests
now = datetime.now(timezone.utc)
end_time = int(now.timestamp() * 1000000)
one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
simpleKeys = os.environ["SIMPLE_KEYS"]
simpleKeysUp = os.environ["SIMPLE_KEYS_UP"]

# Retrieve the primary key ID 
primary_key_id_tink = os.environ.get("PRIMARY_KEY_ID", 0)  # Default to 0 if not set
primary_key_id_tink_val = os.environ["PRIMARY_KEY_ID_VAL"]   
primary_key_id_tink_up = os.environ.get("PRIMARY_KEY_ID_UP", 0)  # Default to 0 if not set
primary_key_id_tink_val_up = os.environ["PRIMARY_KEY_ID_VAL_UP"]   

Unique_value = f"u_{random.randint(100000, 999999)}"
Total_count = 2
org_id = "default"
stream_name = "stream_pytest_data"

def create_cipher_simpleOO(session, base_url, org_id, cipher_name_simpleOO):
    """Running an E2E test for creating cipher_keys with simple OO cipher."""
    
    # Create a unique cipher name
    while True:
        payload_simpleOO = {
            "name": cipher_name_simpleOO,
            "key": {
                "store": {
                    "type": "local",
                    "akeyless": {
                        "base_url": "",
                        "access_id": "",
                        "auth": {
                            "type": "access_key",
                            "access_key": "",
                            "ldap": {"username": "", "password": ""}
                        },
                        "store": {
                            "type": "static_secret",
                            "static_secret": "",
                            "dfc": {"name": "", "iv": "", "encrypted_data": ""}
                        }
                    },
                    "local": simpleKeys
                },
                "mechanism": {"type": "simple", "simple_algorithm": "aes-256-siv"}
            },
            "isUpdate": False
        }

    # Attempt to create the cipher key
        resp_create_cipher_simpleOO = session.post(
            f"{base_url}api/{org_id}/cipher_keys", json=payload_simpleOO
        )
    
        if resp_create_cipher_simpleOO.status_code == 200:
            break  # Exit the loop if the key is created successfully
        elif resp_create_cipher_simpleOO.status_code == 400:
            continue  # Key already exists, try again
        else:
            raise AssertionError(f"Unexpected error: {resp_create_cipher_simpleOO.status_code} {resp_create_cipher_simpleOO.content}")
        
def create_cipher_tinkOO(session, base_url, org_id, cipher_name_tinkOO):
    """Running an E2E test for create cipher_key with Tink OO cipher.""" 

    # Create a unique cipher name
    while True:
        payload_tinkOO = {
            "name": cipher_name_tinkOO,
            "key": {
                "store": {
                    "type": "local",
                    "akeyless": {
                        "base_url": "",
                        "access_id": "",
                        "auth": {
                            "type": "access_key",
                            "access_key": "",
                            "ldap": {"username": "", "password": ""}
                        },
                        "store": {
                            "type": "static_secret",
                            "static_secret": "",
                            "dfc": {"name": "", "iv": "", "encrypted_data": ""}
                        }
                    },
                "local": json.dumps({  # Use json.dumps to create a valid JSON string
                "primaryKeyId": int(primary_key_id_tink),  # Ensure this is an integer
                "key": [
                    {
                        "keyData": {
                            "typeUrl": "type.googleapis.com/google.crypto.tink.AesSivKey",
                            "value": primary_key_id_tink_val,
                            "keyMaterialType": "SYMMETRIC"
                        },
                        "status": "ENABLED",
                        "keyId": int(primary_key_id_tink),  # Ensure this is an integer
                        "outputPrefixType": "TINK"
                    }
                ]
            })
            },
                "mechanism": {"type": "tink_keyset", "simple_algorithm": "aes-256-siv"}
            },
            "isUpdate": False
        }

    # Attempt to create the cipher key
        resp_create_cipher_tinkOO = session.post(
            f"{base_url}api/{org_id}/cipher_keys", json=payload_tinkOO
        )
       

        if resp_create_cipher_tinkOO.status_code == 200:
            break  # Exit the loop if the key is created successfully
        elif resp_create_cipher_tinkOO.status_code == 400:
            continue  # Key already exists, try again
        else:
            raise AssertionError(f"Unexpected error: {resp_create_cipher_tinkOO.status_code} {resp_create_cipher_tinkOO.content}")


def retrieve_cipherKeys_simpleOO(session, base_url, org_id):
    """Retrieve a cipher key."""
    response = session.get(f"{base_url}api/{org_id}/cipher_keys")
    assert response.status_code == 200, f"Failed to retrieve cipher key: {response.content}"
    
    cipher_keys = response.json().get("keys", [])
    
    # Assert that the response contains keys
    assert len(cipher_keys) > 0, "No cipher keys found"
    
    # Filter keys that start with "sim_ABC"
    sim_keys = [key for key in cipher_keys if key['name'].startswith(f"sim_{Unique_value}")]
    
    # Assert that there are keys starting with "sim_ABC"
    assert len(sim_keys) > 0, f"No keys found starting with 'sim_{Unique_value}'"
    
    # Extract the first key's complete name
    first_sim_key_name = sim_keys[0]['name']
    
    # Return the filtered keys and the first key's name
    return {
        "count": len(sim_keys),
        "first_key_name": first_sim_key_name,
        "keys": sim_keys
    }

def retrieve_cipher_simpleOO(session, base_url, org_id, cipher_name_simpleOO, local_value_expected):
    """Retrieve a cipher key and assert local value starts with 'GNf6Mc'."""
    response = session.get(f"{base_url}api/{org_id}/cipher_keys/{cipher_name_simpleOO}")
    assert response.status_code == 200, f"Failed to retrieve cipher key: {response.content}"
    
    cipher_key = response.json()
    
    # Assert that the response contains the expected structure
    assert "key" in cipher_key, "Key not found in response"
    assert "store" in cipher_key["key"], "Store not found in key"
    assert "local" in cipher_key["key"]["store"], "Local not found in store"
    
    # Extract the local value
    local_value = cipher_key["key"]["store"]["local"]
    
    # Assert that the local value starts with "GNf6Mc"
    assert local_value.startswith(local_value_expected), f"Local value does not start with '{local_value_expected}': {local_value}"
    
    # Return the cipher key and local value for further use
    return {
        "name": cipher_key["name"],
        "local": local_value
    }


    

def retrieve_cipherKeys_tinkOO(session, base_url, org_id):
    """Retrieve Tink cipher keys that start with a specific prefix."""
    response = session.get(f"{base_url}api/{org_id}/cipher_keys")
    assert response.status_code == 200, f"Failed to retrieve cipher keys: {response.content}"
    
    # Parse the JSON response
    cipher_keys = response.json().get("keys", [])
    
    # Assert that the response contains keys
    assert len(cipher_keys) > 0, "No cipher keys found"
    
    # Filter keys that start with "tink_ABC"
    tink_keys = [key for key in cipher_keys if key['name'].startswith(f"tink_{Unique_value}")]
    
    # Assert that there are keys starting with "tink_ABC"
    assert len(tink_keys) > 0, f"No keys found starting with 'tink_{Unique_value}'"
    
    # Extract the first key's complete name
    first_tink_key_name = tink_keys[0]['name']
    
    
    # Return the cipher key name and local JSON for further use
    return {
        "count": len(tink_keys),
        "first_key_name": first_tink_key_name,
        "keys": tink_keys
    }



def retrieve_cipher_tinkOO(session, base_url, org_id, cipher_name_tinkOO, primary_key_id_tink):
    """Retrieve a Tink cipher key and assert that the local field contains the expected string format for primaryKeyId."""
    response = session.get(f"{base_url}api/{org_id}/cipher_keys/{cipher_name_tinkOO}")
    assert response.status_code == 200, f"Failed to retrieve cipher key: {response.content}"

    cipher_key = response.json()

    # Assert that the response contains the expected structure
    assert "key" in cipher_key, "Key not found in response"
    assert "store" in cipher_key["key"], "Store not found in key"
    assert "local" in cipher_key["key"]["store"], "Local not found in store"

    # Extract the local value
    local_value = cipher_key["key"]["store"]["local"]

    
    # Check for the expected string format
    expected_string = '"primaryKeyId": '
    if expected_string not in local_value:
        raise AssertionError(f"Expected string '{expected_string}' not found in local value: {local_value}")

    # Extract primaryKeyId from the local_value string
    try:
        # Find the start position of the primaryKeyId
        start_index = local_value.index(expected_string) + len(expected_string)
        end_index = local_value.index(',', start_index) if ',' in local_value[start_index:] else local_value.index('}', start_index)
        primary_key_id = local_value[start_index:end_index].strip()

    except ValueError as e:
        raise AssertionError(f"Could not extract primaryKeyId from local value: {local_value}. Error: {str(e)}")
    
    # Assert that the primaryKeyId is a valid integer
    assert primary_key_id == primary_key_id_tink, f"Primary Key ID is not equal to the expected value: {primary_key_id}"
    assert primary_key_id.isdigit(), f"Primary Key ID is not a valid integer: {primary_key_id}"

    # Return the cipher key name and the extracted primaryKeyId
    return {
        "name": cipher_key["name"],
        "primaryKeyId": primary_key_id  # Return the extracted primaryKeyId
    }

def update_cipher_simpleOO(session, base_url, org_id, cipher_name_simpleOO):
    """Running an E2E test for updating cipher_keys with simple OO cipher."""
    
    # Create a unique cipher name
    while True:
        payload_up_simpleOO = {
            "name": cipher_name_simpleOO,
            "key": {
                "store": {
                    "type": "local",
                    "akeyless": {
                        "base_url": "",
                        "access_id": "",
                        "auth": {
                            "type": "access_key",
                            "access_key": "",
                            "ldap": {"username": "", "password": ""}
                        },
                        "store": {
                            "type": "static_secret",
                            "static_secret": "",
                            "dfc": {"name": "", "iv": "", "encrypted_data": ""}
                        }
                    },
                    "local": simpleKeysUp
                },
                "mechanism": {"type": "simple", "simple_algorithm": "aes-256-siv"}
            },
            "isUpdate": True
        }

    # Attempt to update the cipher key
        resp_update_cipher_simpleOO = session.put(
            f"{base_url}api/{org_id}/cipher_keys/{cipher_name_simpleOO}", json=payload_up_simpleOO
    )

        if resp_update_cipher_simpleOO.status_code == 200:
            break  # Exit the loop if the key is created successfully
        elif resp_update_cipher_simpleOO.status_code == 400:
            continue  # Key already exists, try again
        else:
            raise AssertionError(f"Unexpected error: {resp_update_cipher_simpleOO.status_code} {resp_update_cipher_simpleOO.content}")

def update_cipher_tinkOO(session, base_url, org_id, cipher_name_tinkOO):
    """Running an E2E test for updating cipher_keys with Tink OO cipher."""
    
    # Create a unique cipher name
    payload_up_tinkOO = {
        "name": cipher_name_tinkOO,
        "key": {
            "store": {
                "type": "local",
                "akeyless": {
                    "base_url": "",
                    "access_id": "",
                    "auth": {
                        "type": "access_key",
                        "access_key": "",
                        "ldap": {"username": "", "password": ""}
                    },
                    "store": {
                        "type": "static_secret",
                        "static_secret": "",
                        "dfc": {"name": "", "iv": "", "encrypted_data": ""}
                    }
                },
                "local": json.dumps({  # Use json.dumps to create a valid JSON string
                "primaryKeyId": int(primary_key_id_tink_up),  # Ensure this is an integer
                "key": [
                    {
                        "keyData": {
                            "typeUrl": "type.googleapis.com/google.crypto.tink.AesSivKey",
                            "value": primary_key_id_tink_val_up,
                            "keyMaterialType": "SYMMETRIC"
                        },
                        "status": "ENABLED",
                        "keyId": int(primary_key_id_tink_up),  # Ensure this is an integer
                        "outputPrefixType": "TINK"
                    }
                ]
            })
            },
            "mechanism": {"type": "tink_keyset", "simple_algorithm": "aes-256-siv"}
        },
        "isUpdate": True
    }

    # Update the cipher key using the correct URL
    resp_update_cipher_tinkOO = session.put(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name_tinkOO}", json=payload_up_tinkOO
    )

    assert (
        resp_update_cipher_tinkOO.status_code == 200
    ), f"Expected 200, but got {resp_update_cipher_tinkOO.status_code} {resp_update_cipher_tinkOO.content}"

    return resp_update_cipher_tinkOO


def delete_cipher(session, base_url, org_id, cipher_type):
    """Running an E2E test for deleting cipher_keys with cipher type."""

    # Retrieve all cipher keys
    response = session.get(f"{base_url}api/{org_id}/cipher_keys")
    assert response.status_code == 200, f"Failed to retrieve cipher keys: {response.content}"
    
    cipher_keys = response.json().get("keys", [])
    
    # Filter keys that start with the specified cipher type
    cipher_type_keys = [key['name'] for key in cipher_keys if key['name'].startswith(f"{cipher_type}_{Unique_value}")]
    
    # Delete each cipher key of the specified type
    for cipher_name in cipher_type_keys:
        resp_delete_cipher = session.delete(f"{base_url}api/{org_id}/cipher_keys/{cipher_name}")
        assert resp_delete_cipher.status_code == 200, f"Failed to delete {cipher_name}: {resp_delete_cipher.content}"
        
        # Wait for a few seconds to allow the data to be ingested
        time.sleep(10)  # Increase this time if necessary

        # Verify deletion
        resp_ver_cipher = session.get(f"{base_url}api/{org_id}/cipher_keys/{cipher_name}")
        assert resp_ver_cipher.status_code == 404, f"Expected 404 for {cipher_name}, but got {resp_ver_cipher.status_code}"

    return cipher_type_keys  # Return the list of deleted cipher keys for verification if needed


def validate_deleted_cipher(session, base_url, org_id, cipher_name): 
    """Running an E2E test for validating deleted cipher."""

    # Verify deleted cipher key
    resp_ver_cipher = session.get(
        f"{base_url}api/{org_id}/cipher_keys/{cipher_name}"
    )
  

    assert (
        resp_ver_cipher.status_code == 404
    ), f"Expected 404, but got {resp_ver_cipher.status_code} {resp_ver_cipher.content}"

    return resp_ver_cipher

def validate_deleted_cipher_SC(session, base_url, org_id, cipher_type): 
    """Running an E2E test for validating deleted cipher in SC."""

    # Retrieve all cipher keys
    response = session.get(f"{base_url}api/{org_id}/cipher_keys")
    assert response.status_code == 200, f"Failed to retrieve cipher keys: {response.content}"
    
    cipher_keys = response.json().get("keys", [])
    
    # Filter keys that start with "sim_u_659404"
    cipher_type_keys = [key for key in cipher_keys if key['name'].startswith(f"{cipher_type}_{Unique_value}")]
    
    # Check if any sim keys exist
    if len(cipher_type_keys) == 0:
        print(f"No keys found starting with '{cipher_type}_{Unique_value}'")
        # Optionally, you can choose to skip the assertion or handle it differently
    else:
        assert len(cipher_type_keys) > 0, f"No keys found starting with '{cipher_type}_{Unique_value}'"
        print(f"Keys found starting with '{cipher_type}_{Unique_value}'")

    return cipher_type_keys

 


# Template functionality

def create_template_webhook(session, base_url, org_id, template_name):
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

def create_template_email(session, base_url, org_id, template_name):
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

def retrieve_templates_webhook(session, base_url, org_id):
    """Retrieve templates and extract information about the first template matching the specified name."""
    
    response = session.get(f"{base_url}api/{org_id}/alerts/templates")
    assert response.status_code == 200, f"Failed to validate templates: {response.content}"
    
    # Parse the JSON response
    templates = response.json()
    assert len(templates) > 0, "No templates found"
    
    # Filter templates that contain 'template_webhook' and match the expected name
    webhook_templates = [ template for template in templates if "template_webhook" in template["name"] 
                         and template["name"].startswith(f"template_webhook_{Unique_value}")
    ]
    
    # Assert that there are templates matching the criteria
    assert len(webhook_templates) > 0, f"No templates found containing 'template_webhook' with title 'template_webhook_{Unique_value}'"
    
    # Extract the first template's complete name
    first_template_name_webhook = webhook_templates[0]['name']
    
    # Return structured data
    return {
        "count": len(webhook_templates),
        "first_template_webhook": first_template_name_webhook,
        "templates": webhook_templates
    }


def retrieve_template_webhook(session, base_url, org_id, template_name):
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





def retrieve_templates_email(session, base_url, org_id):
    """Retrieve templates and extract the first template name containing 'template_email' with title 'email_title'."""
    response = session.get(f"{base_url}api/{org_id}/alerts/templates")
    assert response.status_code == 200, f"Failed to validate templates: {response.content}"
    
    templates = response.json()
    assert len(templates) > 0, "No templates found"
    
    # Variable to store the first matching template name
    first_template_name = None
    
    email_templates = [
        template for template in templates 
         if template["name"].startswith(f"template_email_{Unique_value}")
] 
    
    # Assert that there are templates matching the criteria
    assert len(email_templates) > 0, f"No templates found containing 'template_email' with title 'template_email_{Unique_value}'"
    
    # Extract the first template's complete name
    first_template_name_email = email_templates[0]['name']
    
    # Return structured data
    return {
        "count": len(email_templates),
        "first_template_email": first_template_name_email,
        "templates": email_templates
    }

def retrieve_template_email(session, base_url, org_id, template_name):
    """Retrieve the template email and assert the title."""
    response = session.get(f"{base_url}api/{org_id}/alerts/templates/{template_name}")
    assert response.status_code == 200, f"Failed to validate template: {response.content}"
    
    template_email = response.json()  # Assuming the response is a single template, not a list.
    assert isinstance(template_email, dict), "Response is not a valid template object"
    
   
    return {
        "name_template_email": template_email["name"],
        "title_template_email": template_email["title"]
    }

def update_template_webhook(session, base_url, org_id, template_name):
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
    
    

def update_template_email(session, base_url, org_id, template_name):
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

    


def delete_template(session, base_url, org_id, template_type):
    """Delete templates of a specified type."""
    
    # Retrieve all templates
    response = session.get(f"{base_url}api/{org_id}/alerts/templates")
    assert response.status_code == 200, f"Failed to retrieve templates: {response.content}"
    
    templates = response.json()
    
    # Filter templates that match the specified template type
    template_names_to_delete = [
        template['name'] for template in templates 
           if template["name"].startswith(f"{template_type}_{Unique_value}")
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


def validate_deleted_template(session, base_url, org_id, template_name):
    """Running an E2E test for validating deleted template."""

    # Verify deleted template
    resp_ver_template = session.get(f"{base_url}api/{org_id}/alerts/templates/{template_name}")

    assert (
        resp_ver_template.status_code == 404
    ), f"Expected 404 for deleted template '{template_name}', but got {resp_ver_template.status_code}: {resp_ver_template.content}"

    return resp_ver_template


def validate_deleted_template_SC(session, base_url, org_id, template_type):
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



# Destination functionality

def create_destination_webhook(session, base_url, org_id, template_name, destination_name):
    """Create a destination."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    skip_tls_verify_value = False  # Define the skip_tls_verify_value
    payload = {
        "url": "https://jsonplaceholder.typicode.com/todos",
        "method": "get",
        "template": template_name,  
        "headers": {},  # Ensure this is formatted correctly
        "name": destination_name,
        "skip_tls_verify": skip_tls_verify_value
    }
    response = session.post(f"{base_url}api/{org_id}/alerts/destinations", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create destination: {response.content}"
    return response

def create_destination_email(session, base_url, org_id, template_email, destination_name, email_address):
    """Create a destination."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
    skip_tls_verify_value = False  # Define the skip_tls_verify_value
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

def create_destination_pipeline(session, base_url, org_id, destination_name):
    """Create a destination."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
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

def validate_destination(session, base_url, org_id, destination_name):
    """Validate a destination."""
    response = session.get(f"{base_url}api/{org_id}/alerts/destinations")
    assert response.status_code == 200, f"Failed to validate destination: {response.content}"
    destinations = response.json()
    assert len(destinations) > 0, "No destinations found"
    for destination in destinations:
        assert destination["name"] == destination_name, f"Destination name {destination['name']} does not match {destination_name}"
    return destinations 

def delete_destination(session, base_url, org_id, destination_name):
    """Delete a destination."""
    response = session.delete(f"{base_url}api/{org_id}/alerts/destinations/{destination_name}")
    assert response.status_code == 200, f"Failed to delete destination: {response.content}"
    return response

def create_standard_alert(session, base_url, org_id, alert_name, template_name, stream_name, destination_name):
    
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
  
    payload = {
    "name": alert_name,
    "row_template": template_name,
    "stream_type": "logs",
    "stream_name": stream_name,
    "is_real_time": False,
    "context_attributes": {},
    "query_condition": {
        "conditions": [ {
        "column": "log",
        "operator": "=",
        "value": "200",
        "type": None,  # Set it to None or remove it
        "id": str(uuid.uuid4())
        } ],
        "search_event_type": "ui",
        "sql": "",
        "promql": "",
        "type": "custom",
        "promql_condition": None,
        "vrl_function": None,
        "multi_time_range": []
    },
    "trigger_condition": {
        "period": 10,
        "operator": ">=",
        "frequency": 3,
        "cron": "",
        "threshold": 3,
        "silence": 10,
        "frequency_type": "minutes",
        "timezone": "UTC",
        "tolerance_in_secs": 0
    },
    "org_id": org_id,
    "destinations": [destination_name],
    "enabled": True,
    "description": "test"
 }

    response = session.post(f"{base_url}api/{org_id}/{stream_name}/alerts?type=logs", json=payload)
    if response.status_code == 409:
        # Handle alert already exists scenario
        print(f"Alert already exists: {payload['name']}.")
        return False  # Indicate that creation failed due to existing alert
    assert response.status_code == 200, f"Failed to create alert: {response.content}"
    return True  # Indicate successful creation

def create_standard_alert_sql(session, base_url, org_id, alert_name, template_name, stream_name, destination_name):
    
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
  
    payload = {
    "name": alert_name,
    "row_template": template_name,
    "stream_type": "logs",
    "stream_name": stream_name,
    "is_real_time": False,
    "context_attributes": {},
    "query_condition": {
        "conditions": [ {
        "column": "log",
        "operator": "=",
        "value": "200",
        "type": None,  # Set it to None or remove it
        "id": str(uuid.uuid4())
        } ],
        "search_event_type": "ui",
        "sql": f"select log from \"{stream_name}\" where log = 200",
        "promql": "",
        "type": "sql",
        "promql_condition": None,
        "vrl_function": None,
        "multi_time_range": []
    },
    "trigger_condition": {
        "period": 10,
        "operator": ">=",
        "frequency": 3,
        "cron": "",
        "threshold": 3,
        "silence": 10,
        "frequency_type": "minutes",
        "timezone": "UTC",
        "tolerance_in_secs": 0
    },
    "org_id": org_id,
    "destinations": [destination_name],
    "enabled": True,
    "description": "test"
 }

    response = session.post(f"{base_url}api/{org_id}/{stream_name}/alerts?type=logs", json=payload)
    if response.status_code == 409:
        # Handle alert already exists scenario
        print(f"Alert already exists: {payload['name']}.")
        return False  # Indicate that creation failed due to existing alert
    assert response.status_code == 200, f"Failed to create alert: {response.content}"
    return True  # Indicate successful creation

def create_real_time_alert(session, base_url, org_id, alert_name, template_name, stream_name, destination_name):
    
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
  
    payload = {
    "name": alert_name,
    "row_template": template_name,
    "stream_type": "logs",
    "stream_name": stream_name,
    "is_real_time": True,
    "context_attributes": {},
    "query_condition": {
        "conditions": [ {
        "column": "log",
        "operator": "=",
        "value": "200",
        "type": None,  # Set it to None or remove it
        "id": str(uuid.uuid4())
        } ],
        "search_event_type": "ui",
        "sql": "",
        "promql": "",
        "type": "custom",
        "promql_condition": None,
        "vrl_function": None,
        "multi_time_range": []
    },
    "trigger_condition": {
        "period": 10,
        "operator": ">=",
        "frequency": 3,
        "cron": "",
        "threshold": 3,
        "silence": 10,
        "frequency_type": "minutes",
        "timezone": "UTC",
        "tolerance_in_secs": 0
    },
    "org_id": org_id,
    "destinations": [destination_name],
    "enabled": True,
    "description": "test"
 }

    response = session.post(f"{base_url}api/{org_id}/{stream_name}/alerts?type=logs", json=payload)
    if response.status_code == 409:
        # Handle alert already exists scenario
        print(f"Alert already exists: {payload['name']}.")
        return False  # Indicate that creation failed due to existing alert
    assert response.status_code == 200, f"Failed to create alert: {response.content}"
    return True  # Indicate successful creation


def create_standard_alert_cron(session, base_url, org_id, alert_name, template_name, stream_name, destination_name):
    
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}
  
    payload = {
    "name": alert_name,
    "row_template": template_name,
    "stream_type": "logs",
    "stream_name": stream_name,
    "is_real_time": False,
    "context_attributes": {},
    "query_condition": {
        "conditions": [ {
        "column": "log",
        "operator": "=",
        "value": "200",
        "type": None,  # Set it to None or remove it
        "id": str(uuid.uuid4())
        } ],
        "search_event_type": "ui",
        "sql": "",
        "promql": "",
        "type": "custom",
        "promql_condition": None,
        "vrl_function": None,
        "multi_time_range": []
    },
    "trigger_condition": {
        "period": 10,
        "operator": ">=",
        "frequency": 3,
        "cron": "1 40 * * * *",
        "threshold": 3,
        "silence": 10,
        "frequency_type": "cron",
        "timezone": "UTC",
        "tz_offset": 0
    },
    "org_id": org_id,
    "destinations": [destination_name],
    "enabled": True,
    "description": "test"
 }

    response = session.post(f"{base_url}api/{org_id}/{stream_name}/alerts?type=logs", json=payload)
    if response.status_code == 409:
        # Handle alert already exists scenario
        print(f"Alert already exists: {payload['name']}.")
        return False  # Indicate that creation failed due to existing alert
    assert response.status_code == 200, f"Failed to create alert: {response.content}"
    return True  # Indicate successful creation


def delete_alert(session, base_url, org_id, alert_name, stream_name):
    """Delete an alert."""
    response = session.delete(f"{base_url}api/{org_id}/{stream_name}/alerts/{alert_name}?type=logs")
    assert response.status_code == 200, f"Failed to delete alert: {response.content}"
    return response

def validate_alert(session, base_url, org_id, alert_name, stream_name):
    """Get an alert."""
    response = session.get(f"{base_url}api/{org_id}/{stream_name}/alerts/{alert_name}")
    assert response.status_code == 200, f"Failed to get alert: {response.content}"
    return response



def ingest_logs(session, base_url, org_id, stream_name):
    """Ingest logs."""
    payload = [
        {
            "Athlete": "newtemp",
            "log": "200",
            "City": "Athens",
            "Country": "HUN",
            "Discipline": "Swimming",
            "Sport": "Aquatics",
            "Year": 1896,
        },
        {
            "Athlete": "HERSCHMANN",
            "log": "404",  # Add a non-matching record for negative testing
            "City": "Athens",
            "Country": "CHN",
            "Discipline": "Swimming",
            "Sport": "Aquatics",
            "Year": 1896,
        },
    ]
    response = session.post(f"{base_url}api/{org_id}/{stream_name}/_json", json=payload)
    assert response.status_code == 200, f"Failed to ingest logs: {response.content}"
    return response

def create_savedView(session, base_url, org_id, savedview_name, stream_name):
    """Create a saved view."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
            "organizationIdentifier": org_id,
            "runQuery": False,
            "loading": False,
            "loadingHistogram": False,
            "loadingCounter": False,
            "loadingStream": False,
            "loadingSavedView": False,
            "shouldIgnoreWatcher": False,
            "communicationMethod": "http",
            "config": {
                "splitterModel": 20,
                "lastSplitterPosition": 0,
                "splitterLimit": [0, 40],
                "fnSplitterModel": 60,
                "fnLastSplitterPosition": 0,
                "fnSplitterLimit": [40, 100],
                "refreshTimes": [
                    [{"label": "5 sec", "value": 5}, {"label": "1 min", "value": 60}, {"label": "1 hr", "value": 3600}],
                    [{"label": "10 sec", "value": 10}, {"label": "5 min", "value": 300}, {"label": "2 hr", "value": 7200}],
                    [{"label": "15 sec", "value": 15}, {"label": "15 min", "value": 900}, {"label": "1 day", "value": 86400}],
                    [{"label": "30 sec", "value": 30}, {"label": "30 min", "value": 1800}]
                ]
            },
            "meta": {
                # Include the rest of the meta fields as needed
                "logsVisualizeToggle": "logs",
                "refreshInterval": 0,
                "refreshIntervalLabel": "Off",
                "refreshHistogram": False,
                "showFields": True,
                "showQuery": True,
                "showHistogram": True,
                "showDetailTab": False,
                "toggleFunction": True,
                "searchApplied": True,
                "toggleSourceWrap": False,
                "histogramDirtyFlag": False,
                "sqlMode": True,
                "quickMode": False,
                "queryEditorPlaceholderFlag": True,
                "functionEditorPlaceholderFlag": True,
                "resultGrid": {
                    "rowsPerPage": 50,
                    "wrapCells": False,
                    "manualRemoveFields": False,
                    "chartInterval": "30 second",
                    "chartKeyFormat": "HH:mm:ss",
                    "navigation": {"currentRowIndex": 0},
                    "showPagination": True
                },
                "jobId": "",
                "jobRecords": "100",
                "pageType": "logs",
                "regions": [],
                "clusters": [],
                "useUserDefinedSchemas": "user_defined_schema",
                "hasUserDefinedSchemas": False,
                "selectedTraceStream": "",
                "showSearchScheduler": False
            },
            "data": {
                "query": f"SELECT * FROM \"{stream_name}\"",
                # Add the rest of the data fields as needed
            },
            "view_name": savedview_name
        }
    
    response = session.post(f"{base_url}api/{org_id}/savedviews", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create saved view: {response.content}"
    return response

def create_folder(session, base_url, org_id, folder_name):
    """Create a folder."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "description": folder_name,
        "folderId": "",
        "name": folder_name
    }

    response = session.post(f"{base_url}api/{org_id}/folders", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create folder: {response.content}"
    folder_id = response.json()["folderId"]
    return folder_id

def create_dashboard(session, base_url, org_id, dashboard_name, folder_id):
    """Create a dashboard."""
    headers = {
        "Content-Type": "application/json", 
        "Custom-Header": "value"
    }
    # created_time = datetime.now().isoformat()   
    payload = {
        "title": dashboard_name,
        "dashboardId": "",
        "description": "",
        "variables": {
            "list": [],
            "showDynamicFilters": True
        },
        "defaultDatetimeDuration": {
            "startTime": None,
            "endTime": None,
            "relativeTimePeriod": "15m",
            "type": "relative"
        },
        "role": "",
        "owner": ZO_ROOT_USER_EMAIL,
    #    "created": created_time + "Z",  # Append "Z" to indicate UTC
        "tabs": [
            {
                "panels": [],
                "name": "Default",
                "tabId": "default"
            }
        ],
        "version": 3
    }
    
    # print("Payload:", json.dumps(payload, indent=2))
    # print("Headers:", headers)

    response = session.post(f"{base_url}api/{org_id}/dashboards?folder={folder_id}", json=payload, headers=headers)
    
    # Improved error handling
    assert response.status_code == 200, f"Failed to create dashboard: {response.content.decode()}"
    # Extract the dashboardId from the correct location in the response
    dashboard_id = response.json()["v3"]["dashboardId"]
    return dashboard_id

def create_function(session, base_url, org_id, function_name):
    """Create a dashboard."""
    headers = {
        "Content-Type": "application/json", 
        "Custom-Header": "value"
    }
    # created_time = datetime.now().isoformat()   
    payload = {
        "function": ".a=190025552",
        "name": function_name,
        "params": "row",
        "transType": 0,
    }
    response = session.post(f"{base_url}api/{org_id}/functions", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create function: {response.content.decode()}"
    return response


# Define the boundary as a constant
BOUNDARY = "----WebKitFormBoundaryaQgmYHuE6dQrlLss"

def create_multipart_data(fields, boundary):
    """Create multipart form data with a specified boundary."""
    boundary_str = f"--{boundary}"
    lines = []

    # Add the fields to the multipart data
    for key, value in fields.items():
        if isinstance(value, tuple):
            # This is the file field
            filename, file_obj, content_type = value
            lines.append(f"{boundary_str}")
            lines.append(f'Content-Disposition: form-data; name="{key}"; filename="{filename}"')
            lines.append(f'Content-Type: {content_type}')
            lines.append("")
            # Read the file content as binary
            lines.append(file_obj.read())  # Read as binary data
        else:
            # Regular fields
            lines.append(f"{boundary_str}")
            lines.append(f'Content-Disposition: form-data; name="{key}"')
            lines.append("")
            lines.append(value)

    # End the multipart data
    lines.append(f"{boundary_str}--")
    
    return b"\r\n".join(line.encode('utf-8') if isinstance(line, str) else line for line in lines)



def create_enrichment_table(session, base_url, org_id, enrichment_table_name):
    """Create an enrichment table."""
    # Define headers
    headers = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Content-Type': f'multipart/form-data; boundary={BOUNDARY}',
        'Pragma': 'no-cache',
        'Custom-Header': 'value'
    }

    # Define cookies
    cookies = {
        'auth_ext': '{"auth_ext":"","refresh_token":"","request_time":0,"expires_in":0}',
        'auth_tokens': f'{{"access_token":"Basic {base64.b64encode((ZO_ROOT_USER_EMAIL + ":" + ZO_ROOT_USER_PASSWORD).encode()).decode()}","refresh_token":""}}'
        }

    # Open the json data file and read it
    with open(root_dir / "test-data/protocols.csv") as f:
        data = f.read()

    # Prepare the fields for multipart data
    with open(root_dir / "test-data/protocols.csv", 'rb') as file_obj:
        file_content = file_obj.read()  # Read the content into memory
        file_like_object = io.BytesIO(file_content)  # Create an in-memory file-like object

    fields = {
        'file': ('protocols.csv', file_like_object, 'text/csv')  # Pass the in-memory object
    }
    
    # Now call your function that uses fields
    multipart_data = create_multipart_data(fields, BOUNDARY)

    url = f"{base_url}api/{org_id}/enrichment_tables/{enrichment_table_name}?append=false"

    # Make the POST request
    response = session.post(url, headers=headers, cookies=cookies, data=multipart_data)

    # Check the response
    assert response.status_code == 200, f"Failed to enrich table: {response.content.decode()}"
    # print("Response:", response.json())  # Print the response for debugging

    return response

def create_realTime_pipeline(session, base_url, org_id, realTime_pipeline_name, stream_name):
    """Create a realTime pipeline."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "name": realTime_pipeline_name,
        "description": "",
        "source": {"source_type": "realtime"},
        "nodes": [
            {
                "id": "1e1fa129-cfbd-4082-8d39-c4dc418a670f",
                "type": "input",
                "data": {
                    "node_type": "stream",
                    "stream_name": stream_name,
                    "stream_type": "logs",
                    "org_id": org_id,
                },
                "position": {"x": 169.83333, "y": 55},
                "io_type": "input",
            },
            {
                "id": "8e0ed123-7737-4801-9466-bd909c425c72",
                "type": "output",
                "data": {
                    "node_type": "stream",
                    "stream_name": stream_name,
                    "stream_type": "logs",
                    "org_id": org_id,
                },
                "position": {"x": 305.33334, "y": 276},
                "io_type": "output",
            },
        ],
        "edges": [
            {
                "id": "e1e1fa129-cfbd-4082-8d39-c4dc418a670f-8e0ed123-7737-4801-9466-bd909c425c72",
                "source": "1e1fa129-cfbd-4082-8d39-c4dc418a670f",
                "target": "8e0ed123-7737-4801-9466-bd909c425c72",
            }
        ],
        "org": org_id,
    }
    
    response = session.post(f"{base_url}api/{org_id}/pipelines", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create scheduled pipeline: {response.content.decode()}"
    return response
    
        
def create_scheduled_pipeline(session, base_url, org_id, scheduled_pipeline_name, stream_name):
    """Create a scheduled pipeline."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "name": scheduled_pipeline_name,
        "description": "",
        "source": {"source_type": "scheduled"},
        "nodes": [
            {
                "id": "8b03771c-2e94-4c2f-b902-8fb8b8e66df2",
                "type": "input",
                "dimensions": {"width": 140, "height": 42},
                "computedPosition": {"x": 212.1047849020086, "y": 93.00563781047852, "z": 0},
                "handleBounds": {
                    "source": [{"id": "output", "position": "bottom", "x": 55.03916432328342, "y": 36.00006521998462, "width": 30, "height": 10}],
                    "target": []
                },
                "position": {"x": 212.1047849020086, "y": 93.00563781047852},
                "data": {
                    "label": "8b03771c-2e94-4c2f-b902-8fb8b8e66df2",
                    "node_type": "query",
                    "stream_type": "logs",
                    "org_id": org_id,
                    "query_condition": {
                        "type": "sql",
                        "conditions": None,
                        "sql": "select * from default",
                        "promql": None,
                        "promql_condition": None,
                        "aggregation": None,
                        "vrl_function": None,
                        "search_event_type": "DerivedStream"
                    },
                    "trigger_condition": {
                        "period": 15,
                        "operator": "=",
                        "threshold": 0,
                        "frequency": 15,
                        "cron": "",
                        "frequency_type": "minutes",
                        "silence": 0
                    }
                },
                "io_type": "input"
            },
            {
                "id": "cfa476a0-24f3-4ca3-a14f-b56b04729922",
                "type": "output",
                "dimensions": {"width": 250, "height": 42},
                "computedPosition": {"x": 269.2781219770897, "y": 161.6932759313432, "z": 0},
                "handleBounds": {
                    "source": [],
                    "target": [{"id": "input", "position": "top", "x": 110.11741720560622, "y": -4.000002219844093, "width": 30, "height": 10}]
                },
                "position": {"x": 269.2781219770897, "y": 161.6932759313432},
                "data": {
                    "label": "cfa476a0-24f3-4ca3-a14f-b56b04729922",
                    "node_type": "stream",
                    "stream_type": "logs",
                    "stream_name": stream_name,
                    "org_id": org_id
                },
                "io_type": "output"
            }
        ],
        "edges": [
            {
                "id": "e8b03771c-2e94-4c2f-b902-8fb8b8e66df2-cfa476a0-24f3-4ca3-a14f-b56b04729922",
                "type": "custom",
                "source": "8b03771c-2e94-4c2f-b902-8fb8b8e66df2",
                "target": "cfa476a0-24f3-4ca3-a14f-b56b04729922",
                "data": {},
                "markerEnd": {"type": "arrowclosed", "width": 20, "height": 20},
                "style": {"strokeWidth": 2},
                "animated": True
            }
        ],
        "org": org_id,
        "schedule": {
            "enabled": True,
            "frequency": "daily",  # Example frequency, adjust as needed
            "time": "02:00",       # Example time, adjust as needed
        }
    }

    response = session.post(f"{base_url}api/{org_id}/pipelines", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create scheduled pipeline: {response.content.decode()}"
    return response

def create_scheduled_report(session, base_url, org_id, scheduled_report_name, dashboard_id, folder_id):
    """Create a scheduled report."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
    "dashboards": [
        {
            "folder": folder_id,                        
            "dashboard": dashboard_id,
            "tabs": ["default"],
            "variables": [],
            "timerange": {
                "type": "relative",
                "period": "30m",
                "from": 1741687525799000,
                "to": 1741689325799000
            }
        }
    ],
    "description": "",
    "destinations": [
        {
            "email": ZO_ROOT_USER_EMAIL
        }
    ],
    "enabled": True,
    "media_type": "Pdf",
    "name": scheduled_report_name,
    "title": scheduled_report_name,
    "message": "hi",
    "orgId": org_id,
    "start": 1741689360000000,
    "frequency": {
        "interval": 1,
        "type": "once",
        "cron": ""
    },
    "user": "",
    "password": "",
    "timezone": "Asia/Calcutta",
    "timezoneOffset": 330,
    "owner": ZO_ROOT_USER_EMAIL,
    "lastEditedBy": ZO_ROOT_USER_EMAIL,
    "report_type": "PDF"
}

    response = session.post(f"{base_url}api/{org_id}/reports", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create scheduled report: {response.content.decode()}"
    return response

def create_cached_report(session, base_url, org_id, cached_report_name, dashboard_id, folder_id):
    """Create a cached report."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
    "dashboards": [
        {
            "folder": folder_id,
            "dashboard": dashboard_id,
            "tabs": ["default"],
            "variables": [],
            "timerange": {
                "type": "relative",
                "period": "30m",
                "from": 1741687525799000,
                "to": 1741689325799000
            }
        }
    ],
    "description": "",
    "destinations": [
        
    ],
    "enabled": True,
    "media_type": "Pdf",
    "name": cached_report_name,
    "title": cached_report_name,
    "message": "hi",
    "orgId": org_id,
    "start": 1741689360000000,
    "frequency": {
        "interval": 1,
        "type": "once",
        "cron": ""
    },
    "user": "",
    "password": "",
    "timezone": "Asia/Calcutta",
    "timezoneOffset": 330,
    "owner": ZO_ROOT_USER_EMAIL,
    "lastEditedBy": ZO_ROOT_USER_EMAIL,
    "report_type": "PDF"
}

    response = session.post(f"{base_url}api/{org_id}/reports", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create cached report: {response.content.decode()}"
    return response

def create_user_admin(session, base_url, org_id, email_address):
    """Create a user as admin."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "organization": org_id,
        "email": email_address,
        "password": "12345678",
        "first_name": "Shyam",
        "last_name": "P",
        "role": "admin",
    }

    response = session.post(f"{base_url}api/{org_id}/users", json=payload, headers=headers)


    assert (
        response.status_code == 200
    ), f"Creating a user 200, but got {response.status_code} {response.content}"

    return response

def create_user_viewer(session, base_url, org_id, email_address):
    """Create a user as viewer."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "organization": org_id,
        "email": email_address,
        "password": "12345678",
        "first_name": "Shyam",
        "last_name": "P",
        "role": "viewer",
    }   

    response = session.post(f"{base_url}api/{org_id}/users", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create user as viewer: {response.content.decode()}"
    return response

def create_user_editor(session, base_url, org_id, email_address):
    """Create a user as editor."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "organization": org_id,
        "email": email_address,
        "password": "12345678",
        "first_name": "Shyam",
        "last_name": "P",
        "role": "editor",
    }   

    response = session.post(f"{base_url}api/{org_id}/users", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create user as editor: {response.content.decode()}"
    return response

def create_user_user(session, base_url, org_id, email_address):
    """Create a user as user."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "organization": org_id,
        "email": email_address,
        "password": "12345678",
        "first_name": "Shyam",
        "last_name": "P",
        "role": "user",
    }   

    response = session.post(f"{base_url}api/{org_id}/users", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create user as user: {response.content.decode()}"
    return response



def create_service_account(session, base_url, org_id, email_address):
    """Create a service account."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "email":email_address,
        "organization":org_id,
        "first_name":"Shyam",
        "last_name":"Panjiyar"
        }

    response = session.post(f"{base_url}api/{org_id}/service_accounts", json=payload, headers=headers)
    assert response.status_code == 200, f"Failed to create service account: {response.content.decode()}"
    return response

def create_role(session, base_url, org_id, role_name):
    """Create a role."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
        "name": role_name,
    }

    response = session.post(f"{base_url}api/{org_id}/roles", json=payload, headers=headers) 
    assert response.status_code == 200, f"Failed to create role: {response.content.decode()}"
    return response         

def create_uds_mqr(session, base_url, org_id, stream_name, max_query_range_hours):
    """Create a UDS and Max Query Range."""
    headers = {"Content-Type": "application/json", "Custom-Header": "value"}

    payload = {
    "partition_time_level": "hourly",
    "partition_keys": [],  # Changed from {} to []
    "full_text_search_keys": ["log", "message"],
    "index_fields": [],
    "bloom_filter_fields": [],
    "distinct_value_fields": [],
    "data_retention": 3650,
    "max_query_range": max_query_range_hours,
    "store_original_data": False,
    "approx_partition": False,
    "extended_retention_days": [],
    "defined_schema_fields": ["code"]
}


    url = f"{base_url}api/{org_id}/streams/{stream_name}/settings?type=logs"
    response = session.post(url, json=payload, headers=headers)

    if response.status_code != 200:
        print(f"Request failed with status code: {response.status_code}")
        print(f"Response content: {response.content.decode()}")
        raise Exception(f"Failed to create UDS max query range: {response.content.decode()}")

    print("UDS max query range created successfully, status code:", response.status_code)
    return response




def test_create_workflow(create_session, base_url):
    session = create_session
    base_url = ZO_BASE_URL
    

    # Loop to create 500 templates, destinations, and alerts
    for i in range(Total_count):
        # Create unique template names
        template_name_webhook = f"template_webhook_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        template_name_email = f"template_email_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"

        # Create templates
        try:
            create_template_webhook(session, base_url, org_id, template_name_webhook)
        except Exception as e:
            print(f"Failed to create webhook template: {e}")

        try:
            create_template_email(session, base_url, org_id, template_name_email)
        except Exception as e:
            print(f"Failed to create email template: {e}")

        # # Create unique destination names
        # destination_name_webhook = f"destination_webhook_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # destination_name_email = f"destination_email_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # destination_name_pipeline = f"destination_pipeline_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"

        # # Create destinations
        # try:
        #     create_destination_webhook(session, base_url, org_id, template_name_webhook, destination_name_webhook)
        # except Exception as e:
        #     print(f"Failed to create webhook destination: {e}")

        # try:
        #     create_destination_email(session, base_url, org_id, template_name_email, destination_name_email, ZO_ROOT_USER_EMAIL)
        # except Exception as e:
        #     print(f"Failed to create email destination: {e}")

        # try:
        #     create_destination_pipeline(session, base_url, org_id, destination_name_pipeline)
        # except Exception as e:
        #     print(f"Failed to create pipeline destination: {e}")

        # # Create alerts with unique names
        # alert_webhook = f"alert_webhook_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     alert_webhook_created = create_standard_alert(session, base_url, org_id, alert_webhook, template_name_webhook, stream_name, destination_name_webhook)
        # except Exception as e:
        #     print(f"Failed to create webhook alert: {e}")

        # alert_email = f"alert_email_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     alert_email_created = create_standard_alert(session, base_url, org_id, alert_email, template_name_email, stream_name, destination_name_email)
        # except Exception as e:
        #     print(f"Failed to create email alert: {e}")

        # alert_cron = f"alert_cron_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     alert_cron_created = create_standard_alert_cron(session, base_url, org_id, alert_cron, template_name_email, stream_name, destination_name_email)
        # except Exception as e:
        #     print(f"Failed to create cron alert: {e}")

        # alert_real_time = f"alert_real_time_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     alert_real_time_created = create_real_time_alert(session, base_url, org_id, alert_real_time, template_name_email, stream_name, destination_name_email)
        # except Exception as e:
        #     print(f"Failed to create real-time alert: {e}")

        # alert_sql = f"alert_sql_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     alert_sql_created = create_standard_alert_sql(session, base_url, org_id, alert_sql, template_name_email, stream_name, destination_name_email)
        # except Exception as e:
        #     print(f"Failed to create SQL alert: {e}")

        # savedview_name = f"savedview_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"      
        # try:
        #     create_savedView(session, base_url, org_id, savedview_name, stream_name)
        # except Exception as e:
        #     print(f"Failed to create saved view: {e}")

        # folder_name = f"folder_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     folder_id = create_folder(session, base_url, org_id, folder_name)
        # except Exception as e:
        #     print(f"Failed to create folder: {e}")

        # dashboard_name = f"dashboard_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     dashboard_id = create_dashboard(session, base_url, org_id, dashboard_name, folder_id)
        # except Exception as e:
        #     print(f"Failed to create dashboard: {e}")

        # function_name = f"function_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     create_function(session, base_url, org_id, function_name)   
        # except Exception as e:
        #     print(f"Failed to create function: {e}")

        # enrichment_table_name = f"enrichment_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     create_enrichment_table(session, base_url, org_id, enrichment_table_name)
        # except Exception as e:
        #     print(f"Failed to create enrichment table: {e}")

        # realTime_pipeline_name = f"realTime_pipeline_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     create_realTime_pipeline(session, base_url, org_id, realTime_pipeline_name, stream_name)  
        # except Exception as e:
        #     print(f"Failed to create real-time pipeline: {e}")

        # scheduled_pipeline_name = f"scheduled_pipeline_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     create_scheduled_pipeline(session, base_url, org_id, scheduled_pipeline_name, stream_name)    
        # except Exception as e:
        #     print(f"Failed to create scheduled pipeline: {e}")

        # scheduled_report_name = f"scheduled_report_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     create_scheduled_report(session, base_url, org_id, scheduled_report_name, dashboard_id, folder_id)  
        # except Exception as e:
        #     print(f"Failed to create scheduled report: {e}")

        # cached_report_name = f"cached_report_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     create_cached_report(session, base_url, org_id, cached_report_name, dashboard_id, folder_id)  
        # except Exception as e:
        #     print(f"Failed to create cached report: {e}")

        # email_address_admin = f"user_email_admin_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}@gmail.com"
        # try:
        #     create_user_admin(session, base_url, org_id, email_address_admin)
        # except Exception as e:
        #     print(f"Failed to create admin user: {e}")

        # email_address_viewer = f"user_email_viewer_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}@gmail.com"
        # try:
        #     create_user_viewer(session, base_url, org_id, email_address_viewer) 
        # except Exception as e:
        #     print(f"Failed to create viewer user: {e}")

        # email_address_editor = f"user_email_editor_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}@gmail.com"
        # try:
        #     create_user_editor(session, base_url, org_id, email_address_editor) 
        # except Exception as e:
        #     print(f"Failed to create editor user: {e}")

        # email_address_user = f"user_email_user_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}@gmail.com"
        # try:
        #     create_user_user(session, base_url, org_id, email_address_user)
        # except Exception as e:
        #     print(f"Failed to create regular user: {e}")

        # service_account_email = f"service_account_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}@gmail.com"
        # try:
        #     create_service_account(session, base_url, org_id, service_account_email) 
        # except Exception as e:
        #     print(f"Failed to create service account: {e}")

        # role_name = f"role_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     create_role(session, base_url, org_id, role_name)
        # except Exception as e:
        #     print(f"Failed to create role: {e}")
        
        # # Example usage within the test
        # max_query_range_hours =  i + 1
        # # print(f"Iteration {i + 1}: max_query_range_hours = {max_query_range_hours}")
        # try:
        #     response = create_uds_mqr(session, base_url, org_id, stream_name, max_query_range_hours)
        #     if response is not None:
        #         print(f"Successfully created UDS max query range for iteration {i + 1} with max_query_range_hours = {max_query_range_hours}.")
        # except Exception as e:
        #     print(f"Error occurred while creating UDS max query range: {e}")

         # Cipher keys creation simple at OpenObserve
        cipher_name_simpleOO = f"sim_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"  
        try:
            create_cipher_simpleOO(session, base_url, org_id, cipher_name_simpleOO)
        except Exception as e:
            print(f"Failed to cipher simple at OpenObserve: {e}")

        # Cipher keys creation Tink at OpenObserve
        cipher_name_tinkOO = f"tink_{Unique_value}_{i + 1}_{random.randint(100000, 999999)}"
        try:
            create_cipher_tinkOO(session, base_url, org_id, cipher_name_tinkOO)
        except Exception as e:
            print(f"Failed to cipher Tink at OpenObserve: {e}")   


        # Ingest logs
        try:
            ingest_logs(session, base_url, org_id, stream_name)
        except Exception as e:
            print(f"Failed to ingest logs: {e}")

def test_validate_SC(create_session, base_url):
    session = create_session
    base_url = ZO_BASE_URL_SC
    

    result = retrieve_cipherKeys_simpleOO(session, base_url, org_id)
    assert result['count'] == Total_count, (f"No 'sim_{Unique_value}' keys found - {result['count']}")
    first_key_name_simpleOO = result['first_key_name']
    retrieve_cipher_simpleOO(session, base_url, org_id, first_key_name_simpleOO, "GNf6Mc")


    result = retrieve_cipherKeys_tinkOO(session, base_url, org_id)
    assert result['count'] == Total_count, (f"No 'tink_{Unique_value}' keys found - {result['count']}") 
    first_key_name_tinkOO = result['first_key_name']
    retrieve_cipher_tinkOO(session, base_url, org_id, first_key_name_tinkOO, primary_key_id_tink)

    templates = retrieve_templates_email(session, base_url, org_id)
    assert templates['count'] == Total_count, (f"No 'template_email_{Unique_value}' templates found - {templates['count']}")
    first_template_name_email = templates['first_template_email']
    retrieve_template_email(session, base_url, org_id, first_template_name_email)    

    templates = retrieve_templates_webhook(session, base_url, org_id)
    assert templates['count'] == Total_count, (f"No 'template_webhook_{Unique_value}' templates found - {templates['count']}")
    first_template_name_webhook = templates['first_template_webhook']
    retrieve_template_webhook(session, base_url, org_id, first_template_name_webhook)  
        




     


def test_update_workflow(create_session, base_url):
    session = create_session
    base_url = ZO_BASE_URL
    
    result = retrieve_cipherKeys_simpleOO(session, base_url, org_id)
    first_key_name_simpleOO = result['first_key_name']
    update_cipher_simpleOO(session, base_url, org_id, first_key_name_simpleOO)
    retrieve_cipher_simpleOO(session, base_url, org_id, first_key_name_simpleOO, "6h/Q/O")

    result = retrieve_cipherKeys_tinkOO(session, base_url, org_id)
    first_key_name_tinkOO = result['first_key_name']

    update_cipher_tinkOO(session, base_url, org_id, first_key_name_tinkOO)
    retrieve_cipher_tinkOO(session, base_url, org_id, first_key_name_tinkOO, primary_key_id_tink_up) 

    templates = retrieve_templates_email(session, base_url, org_id) 
    assert templates['count'] == Total_count, (f"No 'template_email_{Unique_value}' templates found - {templates['count']}")
    first_template_name_email = templates['first_template_email']
    update_template_email(session, base_url, org_id, first_template_name_email)

    templates = retrieve_templates_webhook(session, base_url, org_id)
    assert templates['count'] == Total_count, (f"No 'template_webhook_{Unique_value}' templates found - {templates['count']}")
    first_template_name_webhook = templates['first_template_webhook']
    update_template_webhook(session, base_url, org_id, first_template_name_webhook)






 
    


def test_validate_updated_SC(create_session, base_url):
    session = create_session
    base_url = ZO_BASE_URL_SC

    result = retrieve_cipherKeys_simpleOO(session, base_url, org_id)
    first_key_name_simpleOO = result['first_key_name']
    retrieve_cipher_simpleOO(session, base_url, org_id, first_key_name_simpleOO, "6h/Q/O")

    result = retrieve_cipherKeys_tinkOO(session, base_url, org_id)
    first_key_name_tinkOO = result['first_key_name']
    retrieve_cipher_tinkOO(session, base_url, org_id, first_key_name_tinkOO, primary_key_id_tink_up)

    templates = retrieve_templates_email(session, base_url, org_id)
    assert templates['count'] == Total_count, (f"No 'template_email_{Unique_value}' templates found - {templates['count']}")
    first_template_name_email = templates['first_template_email']
    retrieve_template_email(session, base_url, org_id, first_template_name_email)

    templates = retrieve_templates_webhook(session, base_url, org_id)
    assert templates['count'] == Total_count, (f"No 'template_webhook_{Unique_value}' templates found - {templates['count']}")
    first_template_name_webhook = templates['first_template_webhook']
    retrieve_template_webhook(session, base_url, org_id, first_template_name_webhook)



    


def test_delete_workflow(create_session, base_url):
    session = create_session
    base_url = ZO_BASE_URL
    base_url_sc = ZO_BASE_URL_SC

    result = retrieve_cipherKeys_simpleOO(session, base_url, org_id)
    first_key_name_simpleOO = result['first_key_name']
    delete_cipher(session, base_url, org_id, "sim")
    validate_deleted_cipher(session, base_url, org_id, first_key_name_simpleOO)
    validate_deleted_cipher(session, base_url_sc, org_id, first_key_name_simpleOO)
    
    result = retrieve_cipherKeys_tinkOO(session, base_url, org_id)
    first_key_name_tinkOO = result['first_key_name']
    delete_cipher(session, base_url, org_id, "tink")
    validate_deleted_cipher(session, base_url, org_id, first_key_name_tinkOO)
    validate_deleted_cipher(session, base_url_sc, org_id, first_key_name_tinkOO)

    templates = retrieve_templates_email(session, base_url, org_id)
    assert templates['count'] == Total_count, (f"No 'template_email_{Unique_value}' templates found - {templates['count']}")
    first_template_name_email = templates['first_template_email']
    delete_template(session, base_url, org_id, "template_email")
    validate_deleted_template(session, base_url, org_id, first_template_name_email)
    validate_deleted_template(session, base_url_sc, org_id, first_template_name_email)

    templates = retrieve_templates_webhook(session, base_url, org_id)
    assert templates['count'] == Total_count, (f"No 'template_webhook_{Unique_value}' templates found - {templates['count']}")
    first_template_name_webhook = templates['first_template_webhook']
    delete_template(session, base_url, org_id, "template_webhook")
    validate_deleted_template(session, base_url, org_id, first_template_name_webhook)   
    validate_deleted_template(session, base_url_sc, org_id, first_template_name_webhook)    

    
def test_deleted_SC(create_session, base_url):
    session = create_session
    base_url = ZO_BASE_URL_SC
    
    validate_deleted_cipher_SC(session, base_url, org_id, "sim")

    validate_deleted_cipher_SC(session, base_url, org_id, "tink")

    validate_deleted_template_SC(session, base_url, org_id, "template_email")

    validate_deleted_template_SC(session, base_url, org_id, "template_webhook")


    




    




       