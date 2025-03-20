import base64
from pathlib import Path
import random
from requests.auth import HTTPBasicAuth
import pytest

class ActionPage:
    # Make Unique_value_action a class variable
    Unique_value_action = f"d4m20_{random.randint(100000, 999999)}"
    root_dir = Path(__file__).parent.parent.parent
    BOUNDARY = "----WebKitFormBoundaryaQgmYHuE6dQrlLss"

    def __init__(self, session, base_url, org_id):
        """Initialize ActionPage with session, base_url, and org_id"""
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_multipart_data(self, fields, boundary):
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

    def create_action(self, user_email, user_password, service_account, action_name):
        """create action"""
        self.session.auth = HTTPBasicAuth(user_email, user_password)
        URL_ACTION = f"{self.base_url}api/{self.org_id}/actions/upload"
        print(f"Constructed URL: {URL_ACTION}")

        # Open the ZIP file and prepare the multipart/form-data request
        zip_file_path = self.root_dir / "tests/test-data/test1234_py.zip"
        print(f"Looking for file at: {zip_file_path}")

        # Ensure the file exists
        with open(zip_file_path, 'rb') as f:
            fields = {
                'name': action_name,
                'description': '',  # Empty description as shown in curl
                'execution_details': 'once',  # Changed from 'Once' to 'once'
                'service_account': service_account,
                'owner': user_email,
                'environment_variables': '{}',
                'file': ('test1234_py.zip', f, 'application/zip'),
                'filename': 'test1234_py.zip'
            }

            # Create the multipart form data
            multipart_data = self.create_multipart_data(fields, self.BOUNDARY)

        # Define the headers for the request
        HEADERS = {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9',
            'Content-Type': f'multipart/form-data; boundary={self.BOUNDARY}',
            'origin': self.base_url.rstrip('/'),
            'referer': f"{self.base_url}web/actions?action=add&org_identifier={self.org_id}",
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
        }

        # Perform the API request
        response = self.session.post(URL_ACTION, headers=HEADERS, data=multipart_data)

        # Check if the response is successful
        if response.status_code != 200:
            print(f"Response content: {response.content}")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"

        # Return the response JSON
        response_json = response.json()
        assert 'uuid' in response_json, "Response does not contain 'uuid' key"
        print(f"Extracted UUID: {response_json['uuid']}")
        print(f"Created action  : {action_name}")
        return response_json['uuid']



# def retrive_actions(create_session, base_url):
#     """Running an E2E test for getting all the actions list."""
#     session = create_session
#     resp_get_allactions = session.get(f"{base_url}api/{org_id}/actions")

#     print("Actions all: ", resp_get_allactions.content)
#     assert (
#         resp_get_allactions.status_code == 200
#     ), f"Expected 200, but got {resp_get_allactions.status_code} {resp_get_allactions.content}"




    if __name__ == "__main__":
        pytest.main()


