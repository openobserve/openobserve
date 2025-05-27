import random
from requests.auth import HTTPBasicAuth

class AlertV2Page:
    # Make Unique_value_alert a class variable
    Unique_value_alert = f"a14_{random.randint(100000, 999999)}"

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_scheduled_sql_alert(self, session, base_url, user_email, user_password, org_id, stream_name, destination_name, folder_id, alert_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        payload = {
                    "name": alert_name,
                    "stream_type": "logs",
                    "stream_name": stream_name,
                    "is_real_time": False,
                    "query_condition": {
                    "conditions": [],
                    "sql": f"select code from {stream_name}",
                    "promql": "",
                    "type": "sql",
                    "aggregation": None,
                    "promql_condition": None,
                    "vrl_function": None,
                    "multi_time_range": []
                    },
                    "trigger_condition": {
                    "period": 1440,
                    "operator": ">=",
                    "frequency": 1,
                    "cron": "",
                    "threshold": 3,
                    "silence": 10,
                    "frequency_type": "minutes",
                    "timezone": "UTC"
                    },
                    "destinations": [
                    destination_name
                    ],
                    "context_attributes": {},
                    "enabled": True,
                    "description": "",
                    "updatedAt": "",
                    "owner": user_email,
                    "lastEditedBy": user_email,
                    "folder_id": folder_id
                }
        response = session.post(f"{base_url}api/v2/{org_id}/alerts?folder={folder_id}", json=payload, headers=headers)
        if response.status_code == 409:
            # Handle alert already exists scenario
            print(f"Alert already exists: {payload['name']}.")
            return False  # Indicate that creation failed due to existing alert
        assert response.status_code == 200, f"Failed to create alert: {response.content}"
        return True  # Indicate successful creation
    
    def create_scheduled_sql_alert_vrl_no_trigger(self, session, base_url, user_email, user_password, org_id, stream_name, destination_name, folder_id, alert_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        payload = {
                    "name": alert_name,
                    "stream_type": "logs",
                    "stream_name": stream_name,
                    "is_real_time": False,
                    "query_condition": {
                    "conditions": [],
                    "sql": f"select code from {stream_name}",
                    "promql": "",
                    "type": "sql",
                    "aggregation": None,
                    "promql_condition": None,
                    "vrl_function":"I1Jlc3VsdEFycmF5IwouID0gW10KLg..",
                    "multi_time_range": []
                    },
                    "trigger_condition": {
                    "period": 1440,
                    "operator": ">=",
                    "frequency": 1,
                    "cron": "",
                    "threshold": 3,
                    "silence": 10,
                    "frequency_type": "minutes",
                    "timezone": "UTC"
                    },
                    "destinations": [
                    destination_name
                    ],
                    "context_attributes": {},
                    "enabled": True,
                    "description": "",
                    "updatedAt": "",
                    "owner": user_email,
                    "lastEditedBy": user_email,
                    "folder_id": folder_id
                }
        response = session.post(f"{base_url}api/v2/{org_id}/alerts?folder={folder_id}", json=payload, headers=headers)
        if response.status_code == 409:
            # Handle alert already exists scenario
            print(f"Alert already exists: {payload['name']}.")
            return False  # Indicate that creation failed due to existing alert
        assert response.status_code == 200, f"Failed to create alert: {response.content}"
        return True  # Indicate successful creation
    
    def create_scheduled_sql_alert_vrl_trigger(self, session, base_url, user_email, user_password, org_id, stream_name, destination_name, folder_id, alert_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
        payload = {
                    "name": alert_name,
                    "stream_type": "logs",
                    "stream_name": stream_name,
                    "is_real_time": False,
                    "query_condition": {
                    "conditions": [],
                    "sql": f"select code from {stream_name}",
                    "promql": "",
                    "type": "sql",
                    "aggregation": None,
                    "promql_condition": None,
                    "vrl_function":"I1Jlc3VsdEFycmF5IwouID0gW3t9LCB7fV0KLg..",
                    "multi_time_range": []
                    },
                    "trigger_condition": {
                    "period": 1440,
                    "operator": ">=",
                    "frequency": 1,
                    "cron": "",
                    "threshold": 3,
                    "silence": 10,
                    "frequency_type": "minutes",
                    "timezone": "UTC"
                    },
                    "destinations": [
                    destination_name
                    ],
                    "context_attributes": {},
                    "enabled": True,
                    "description": "",
                    "updatedAt": "",
                    "owner": user_email,
                    "lastEditedBy": user_email,
                    "folder_id": folder_id
                }
        response = session.post(f"{base_url}api/v2/{org_id}/alerts?folder={folder_id}", json=payload, headers=headers)
        if response.status_code == 409:
            # Handle alert already exists scenario
            print(f"Alert already exists: {payload['name']}.")
            return False  # Indicate that creation failed due to existing alert
        assert response.status_code == 200, f"Failed to create alert: {response.content}"
        return True  # Indicate successful creation


    