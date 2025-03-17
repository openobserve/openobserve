import random
from requests.auth import HTTPBasicAuth



class UdsMqrPage:
    # Unique_value_uds_mqr = f"uds_mqr{random.randint(100000, 999999)}"  # Class variable

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_uds_mqr(self, session, base_url, user_email, user_password, org_id, stream_name, max_query_range_hours):
        """Create a UDS and Max Query Range."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        
        payload = {
            "partition_time_level": "hourly",
            "partition_keys": [],
            "full_text_search_keys": ["log"],
            "index_fields": [],
            "bloom_filter_fields": [],
            "distinct_value_fields": [],
            "data_retention": 3650,
            "max_query_range": int(max_query_range_hours),
            "store_original_data": False,
            "approx_partition": False,
            "extended_retention_days": [],
            "defined_schema_fields": ["code"]
        }

        print("Payload for UDS creation:", payload)  # Log the payload

        url = f"{base_url}api/{org_id}/streams/{stream_name}/settings?type=logs"
        response = session.post(url, json=payload, headers=headers)

        if response.status_code != 200:
            print(f"Request failed with status code: {response.status_code}")
            print(f"Response content: {response.content.decode()}")
            raise Exception(f"Failed to create UDS max query range: {response.content.decode()}")

        print("UDS max query range created successfully, status code:", response.status_code)
        return response
