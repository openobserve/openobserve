"""Module for handling role-related operations in the OpenObserve API."""

import time
import base64
from requests.auth import HTTPBasicAuth
import requests
from requests.adapters import HTTPAdapter, Retry
from requests.exceptions import RequestException


class OpenFGAError(Exception):
    """Custom exception for OpenFGA related errors."""


class RolePage:
    """Class to handle role-related operations in the API."""

    def __init__(self, session, base_url, org_id):
        """Initialize RolePage with session, base URL and organization ID.
        
        Args:
            session: Requests session object
            base_url: Base URL for API endpoints
            org_id: Organization ID
        """
        self.session = session
        self.base_url = base_url
        self.org_id = org_id
        self.unique_value_role = f"a7_{int(time.time() * 1000)}"
        
        # Configure session with retries
        retry_strategy = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=[500, 502, 503, 504],
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        
        # Wait for OpenFGA to be ready
        self._wait_for_openfga()

    def _wait_for_openfga(self, max_attempts=30, delay=5):
        """Wait for OpenFGA to be ready before proceeding.
        
        Args:
            max_attempts: Maximum number of attempts to check OpenFGA readiness
            delay: Delay between attempts in seconds
            
        Returns:
            bool: True if OpenFGA is ready, False otherwise
            
        Raises:
            OpenFGAError: If OpenFGA fails to start or create store
        """
        openfga_url = "http://localhost:8080/healthz"
        
        for attempt in range(max_attempts):
            try:
                response = requests.get(openfga_url, timeout=10)
                if response.status_code == 200:
                    print("OpenFGA server is ready")
                    
                    # Create store if it doesn't exist
                    store_response = requests.post(
                        "http://localhost:8080/stores",
                        headers={"Content-Type": "application/json"},
                        json={"name": "openobserve"},
                        timeout=10
                    )
                    if store_response.status_code in [200, 201, 409]:  # 409 means store already exists
                        print("OpenFGA store is ready")
                        return True
                    else:
                        print(f"Failed to create OpenFGA store: {store_response.content}")
                        raise OpenFGAError(f"Failed to create OpenFGA store: {store_response.content}")
            except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
                print(f"Error waiting for OpenFGA: {str(e)}")
                print(f"Waiting for OpenFGA to be ready (attempt {attempt + 1}/{max_attempts})")
                if attempt == max_attempts - 1:
                    raise OpenFGAError(f"Failed to connect to OpenFGA after {max_attempts} attempts: {str(e)}") from e
            except requests.exceptions.RequestException as e:
                print(f"Error waiting for OpenFGA: {str(e)}")
                raise OpenFGAError(f"Request failed: {str(e)}") from e
            time.sleep(delay)
        return False

    def create_role(self, session, base_url, user_email, user_password, org_id, role_name):
        """Create a role with retries.
        
        Args:
            session: Requests session object
            base_url: Base URL for API endpoints
            user_email: User email for authentication
            user_password: User password for authentication
            org_id: Organization ID
            role_name: Name of the role to create
            
        Returns:
            Response object from the API call
            
        Raises:
            OpenFGAError: If role creation fails after all retries
        """
        headers = {
            'Content-Type': 'application/json',
            'Custom-Header': 'value',
            'Authorization': f'Basic {base64.b64encode(f"{user_email}:{user_password}".encode()).decode()}'
        }
        session.auth = HTTPBasicAuth(user_email, user_password) 
        payload = {
            "role": role_name
        }
        print(f"Start Creating role with name: {role_name}, org_id: {org_id}")

        max_attempts = 3
        
        for attempt in range(max_attempts):
            try:
                response = session.post(
                    f"{base_url}api/{org_id}/roles",
                    headers=headers,
                    json=payload,
                    timeout=30
                )
                print(f"Role response: {response.content}")
                response.raise_for_status()
                print(f"Role created successfully: {role_name}")
                return response
            except RequestException as e:
                if attempt == max_attempts - 1:
                    raise OpenFGAError(f"Failed to create role after {max_attempts} attempts: {str(e)}") from e
                print(f"Attempt {attempt + 1} failed, retrying...")
                time.sleep(2 ** attempt)  # Exponential backoff

    def add_permissions(self, session, base_url, user_email, user_password, org_id, role_name):
        """Add permissions to a role.
        
        Args:
            session: Requests session object
            base_url: Base URL for API endpoints
            user_email: User email for authentication
            user_password: User password for authentication
            org_id: Organization ID
            role_name: Name of the role to add permissions to
            
        Returns:
            Response object from the API call
            
        Raises:
            OpenFGAError: If adding permissions fails
        """
        headers = {
            "Content-Type": "application/json",
            "Authorization": f'Basic {base64.b64encode(f"{user_email}:{user_password}".encode()).decode()}',
            "Accept": "application/json",
            "Origin": base_url,
            "Referer": f"{base_url}/web/iam/roles/edit/{role_name}"
        }
        session.auth = HTTPBasicAuth(user_email, user_password)

        payload = {
            "add": [
                {"object": "stream:_all_default", "permission": "AllowAll"},
                {"object": "function:_all_default", "permission": "AllowAll"},
                {"object": "dfolder:_all_default", "permission": "AllowAll"},
                {"object": "template:_all_default", "permission": "AllowAll"},
                {"object": "destination:_all_default", "permission": "AllowAll"},
                {"object": "user:_all_default", "permission": "AllowAll"},
                {"object": "role:_all_default", "permission": "AllowAll"},
                {"object": "group:_all_default", "permission": "AllowAll"},
                {"object": "enrichment_table:_all_default", "permission": "AllowAll"},
                {"object": "settings:_all_default", "permission": "AllowAll"},
                {"object": "kv:_all_default", "permission": "AllowAll"},
                {"object": "syslog-route:_all_default", "permission": "AllowAll"},
                {"object": "summary:_all_default", "permission": "AllowAll"},
                {"object": "passcode:_all_default", "permission": "AllowAll"},
                {"object": "rumtoken:_all_default", "permission": "AllowAll"},
                {"object": "savedviews:_all_default", "permission": "AllowAll"},
                {"object": "metadata:_all_default", "permission": "AllowAll"},
                {"object": "report:_all_default", "permission": "AllowAll"},
                {"object": "pipeline:_all_default", "permission": "AllowAll"},
                {"object": "service_accounts:_all_default", "permission": "AllowAll"},
                {"object": "search_jobs:_all_default", "permission": "AllowAll"},
                {"object": "cipher_keys:_all_default", "permission": "AllowAll"},
                {"object": "action_scripts:_all_default", "permission": "AllowAll"},
                {"object": "afolder:_all_default", "permission": "AllowAll"},
                {"object": "ratelimit:_all_default", "permission": "AllowAll"}
            ],
            "remove": [],
            "add_users": [],
            "remove_users": []
        }

        try:
            response = session.put(f"{base_url}api/{org_id}/roles/{role_name}", headers=headers, json=payload)
            response.raise_for_status()
            print(f"Permissions added successfully: {role_name}")
            print(f"Response for add_permissions: {response.content}")
            return response
        except RequestException as e:
            raise OpenFGAError(f"Failed to add permissions: {str(e)}") from e

    def add_service_account_permission(self, session, base_url, user_email, user_password, org_id, serviceaccount_name, role_name):
        """Add service account permissions to a role.
        
        Args:
            session: Requests session object
            base_url: Base URL for API endpoints
            user_email: User email for authentication
            user_password: User password for authentication
            org_id: Organization ID
            serviceaccount_name: Name of the service account
            role_name: Name of the role to add permissions to
            
        Returns:
            Response object from the API call
            
        Raises:
            OpenFGAError: If adding service account permissions fails
        """
        headers = {
            "Content-Type": "application/json",
            "Custom-Header": "value",
            "Authorization": f'Basic {base64.b64encode(f"{user_email}:{user_password}".encode()).decode()}'
        }
        session.auth = HTTPBasicAuth(user_email, user_password) 
        payload = {
            "add": [],
            "remove": [],
            "add_users": [serviceaccount_name],
            "remove_users": []
        }

        try:
            response = session.put(f"{base_url}api/{org_id}/roles/{role_name}", headers=headers, json=payload)
            response.raise_for_status()
            print(f"Service account permissions added successfully: {serviceaccount_name}")
            print(f"Response for add_service_account_permission: {response.content}")
            return response
        except RequestException as e:
            raise OpenFGAError(f"Failed to add service account permissions: {str(e)}") from e
