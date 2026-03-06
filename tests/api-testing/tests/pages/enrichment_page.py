import random
import base64
import io
import time
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

    def create_enrichment_table_from_url(self, session, base_url, user_email, user_password, org_id, table_name, csv_url, append=False, replace_failed=False):
        """Create an enrichment table from a public URL.

        Args:
            session: requests session
            base_url: API base URL
            user_email: user email for auth
            user_password: user password for auth
            org_id: organization ID
            table_name: name of the enrichment table
            csv_url: public URL to CSV file (must start with http:// or https://)
            append: whether to append data to existing table (default: False)
            replace_failed: whether to replace failed records (default: False)

        Returns:
            response object (status 200 on success - job saved, runs async in background)
        """
        session.auth = HTTPBasicAuth(user_email, user_password)
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }

        payload = {
            "url": csv_url,
            "replace_failed": replace_failed
        }

        url = f"{base_url}api/{org_id}/enrichment_tables/{table_name}/url?append={str(append).lower()}"

        response = session.post(url, headers=headers, json=payload)
        assert response.status_code == 200, f"Failed to create enrichment table from URL: {response.status_code} {response.content.decode()}"
        return response

    def get_enrichment_table_url_status(self, session, base_url, user_email, user_password, org_id, table_name):
        """Get the status of a URL-based enrichment table job.

        Args:
            session: requests session
            base_url: API base URL
            user_email: user email for auth
            user_password: user password for auth
            org_id: organization ID
            table_name: name of the enrichment table

        Returns:
            dict with job status info
        """
        session.auth = HTTPBasicAuth(user_email, user_password)
        headers = {'Accept': 'application/json'}

        url = f"{base_url}api/{org_id}/enrichment_tables/status"
        response = session.get(url, headers=headers)
        assert response.status_code == 200, f"Failed to get enrichment table status: {response.status_code} {response.content.decode()}"

        data = response.json()
        # API may return:
        # 1. Dict keyed by table_name: {"table1": {...}, "table2": {...}}
        # 2. Dict with table_name as value: {"table_name": "...", "status": "..."}
        # 3. List of status objects: [{"table_name": "...", "status": "..."}, ...]
        if isinstance(data, dict):
            # Check if it's keyed by table_name
            if table_name in data:
                result = data.get(table_name)
                # Result could be a list of jobs for this table
                if isinstance(result, list) and len(result) > 0:
                    return result[0]  # Return most recent job
                return result
            # Check if it's a single status object
            if data.get("table_name") == table_name:
                return data
        # Handle list format
        if isinstance(data, list):
            for status in data:
                if isinstance(status, dict) and status.get("table_name") == table_name:
                    return status
        return None

    def wait_for_url_enrichment_job(self, session, base_url, user_email, user_password, org_id, table_name, max_retries=12, delay=5):
        """Wait for URL enrichment job to complete.

        Args:
            session: requests session
            base_url: API base URL
            user_email: user email for auth
            user_password: user password for auth
            org_id: organization ID
            table_name: name of the enrichment table
            max_retries: max number of status checks (default: 12)
            delay: seconds between checks (default: 5)

        Returns:
            str: "completed" if job succeeded, "failed" if job failed, "timeout" if max retries exceeded
        """
        for _ in range(max_retries):
            status = self.get_enrichment_table_url_status(session, base_url, user_email, user_password, org_id, table_name)
            if status:
                job_status = status.get("status", "")
                if job_status == "completed":
                    return "completed"
                elif job_status == "failed":
                    return "failed"
            time.sleep(delay)

        return "timeout"
