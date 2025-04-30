import random
import base64
import io
from pathlib import Path
import json # For JSON parsing
from requests.auth import HTTPBasicAuth

root_dir = Path(__file__).parent.parent.parent  # Navigate up to the root directory

class EnrichmentPage:
    # Make Unique_value_enrichment a class variable
    Unique_value_enrichment = f"d4m20_{random.randint(100000, 999999)}"

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

    def create_enrichment_table(self, session, base_url, user_email, user_password, org_id, enrichment_table_name):
        """Create an enrichment table."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        headers = {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Content-Type': f'multipart/form-data; boundary={self.BOUNDARY}',
            'Pragma': 'no-cache',
            'Custom-Header': 'value'
        }

        # Build auth_ext cookie
        auth_ext_dict = {
            "auth_ext": "",
            "refresh_token": "",
            "request_time": 0,
            "expires_in": 0
        }
        auth_ext_json = json.dumps(auth_ext_dict)
        auth_ext_b64 = base64.b64encode(auth_ext_json.encode()).decode()

        # Build auth_tokens cookie
        access_token = "Basic " + base64.b64encode((user_email + ":" + user_password).encode()).decode()
        auth_tokens_dict = {
            "access_token": access_token,
            "refresh_token": ""
        }
        auth_tokens_json = json.dumps(auth_tokens_dict)
        auth_tokens_b64 = base64.b64encode(auth_tokens_json.encode()).decode()

        # Final cookies dictionary
        cookies = {
            'auth_ext': auth_ext_b64,
            'auth_tokens': auth_tokens_b64
        }

        # Create sample data directly instead of reading from file
        sample_data = """protocol_number,keyword,protocol_description
                        0,HOPOPT,IPv6 Hop-by-Hop Option
                        1,ICMP,Internet Control Message
                        2,IGMP,Internet Group Management"""

        # Create in-memory file-like object with the sample data
        file_like_object = io.BytesIO(sample_data.encode())

        fields = {
            'file': ('protocols.csv', file_like_object, 'text/csv')
        }

        multipart_data = self.create_multipart_data(fields, self.BOUNDARY)
        url = f"{base_url}api/{org_id}/enrichment_tables/{enrichment_table_name}?append=false"

        response = session.post(url, headers=headers, cookies=cookies, data=multipart_data)
        assert response.status_code == 200, f"Failed to enrich table: {response.content.decode()}"
        return response

    def create_enrichment(self, session, base_url, user_email, user_password, org_id, enrichment_name):
        """Create an enrichment."""
        # First create the enrichment table
        response = self.create_enrichment_table(session, base_url, user_email, user_password, org_id, enrichment_name)

        # Return the enrichment ID if needed
        if response.status_code == 200:
            return enrichment_name  # or response.json()['id'] if the API returns an ID
        return None