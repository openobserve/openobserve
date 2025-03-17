import random
import uuid
from requests.auth import HTTPBasicAuth


class FunctionPage:
    # Make Unique_value_destination a class variable
    Unique_value_function = f"uFunction_{random.randint(100000, 999999)}"

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_function(self, session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, function_name):
        """Create a function."""
        session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
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