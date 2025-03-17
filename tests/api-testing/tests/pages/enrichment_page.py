import random
import uuid
import base64
import io
from pathlib import Path
import os
from requests.auth import HTTPBasicAuth
# Add configuration imports or define variables
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable
root_dir = Path(__file__).parent.parent.parent  # Navigate up to the root directory

class EnrichmentPage:
    Unique_value_enrichment = f"uEnrichment_{random.randint(100000, 999999)}"

    BOUNDARY = "----WebKitFormBoundaryaQgmYHuE6dQrlLss"

    def __init__(self, session, base_url, org_id):
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

    def create_enrichment_table(self, session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, enrichment_table_name):
        """Create an enrichment table."""
        session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD) 
        # Define headers
        headers = {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Content-Type': f'multipart/form-data; boundary={self.BOUNDARY}',
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
        multipart_data = self.create_multipart_data(fields, self.BOUNDARY)

        url = f"{base_url}api/{org_id}/enrichment_tables/{enrichment_table_name}?append=false"

        # Make the POST request
        response = session.post(url, headers=headers, cookies=cookies, data=multipart_data)

        # Check the response
        assert response.status_code == 200, f"Failed to enrich table: {response.content.decode()}"
        # print("Response:", response.json())  # Print the response for debugging

        return response