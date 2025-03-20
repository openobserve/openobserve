import random
from requests.auth import HTTPBasicAuth



class RolePage:
    Unique_value_role = f"d4m20_{random.randint(100000, 999999)}"  # Class variable

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id


    def create_role(self, session, base_url, user_email, user_password, org_id, role_name):
        """Create a role."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)     
        payload = {
            "name": role_name,
            "description": f"Test role {role_name}",
            "permissions": []  # Add default empty permissions array
        }

        response = session.post(f"{base_url}api/{org_id}/roles", json=payload, headers=headers) 
        assert response.status_code == 200, f"Failed to create role: {response.content.decode()}"
        return response  
    
    def permission_list(self, session, base_url, user_email, user_password, org_id, role_name):
        """Get the list of permissions."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        payload = {
    "add": [
        {
            "object": "stream:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "function:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "dfolder:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "template:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "destination:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "org:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "user:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "role:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "group:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "enrichment_table:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "settings:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "kv:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "syslog-route:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "summary:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "passcode:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "rumtoken:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "savedviews:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "report:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "metadata:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "pipeline:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "service_accounts:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "search_jobs:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "cipher_keys:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "action_scripts:_all_default",
            "permission": "AllowAll"
        },
        {
            "object": "afolder:_all_default",
            "permission": "AllowAll"
        }
    ],
    "remove": [],
    "add_users": [],
            "remove_users": []
        }



        response = session.put(f"{base_url}api/{org_id}/roles/{role_name}", headers=headers, json=payload)
        assert response.status_code == 200, f"Failed to get permissions: {response.content.decode()}"
        return response

    def permission_service_account(self, session, base_url, user_email, user_password, org_id, serviceaccount_name, role_name):
        """Get the list of permissions."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        payload = {
    "add": [],
    "remove": [],
    "add_users": [
                serviceaccount_name
            ],
            "remove_users": []
        }

        response = session.put(f"{base_url}api/{org_id}/roles/{role_name}", headers=headers, json=payload)
        assert response.status_code == 200, f"Failed to get permissions: {response.content.decode()}"
        return response
