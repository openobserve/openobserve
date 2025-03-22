import random
import uuid
from requests.auth import HTTPBasicAuth


class AlertPage:
    # Make Unique_value_destination a class variable
    Unique_value_alert = f"d4m21_{random.randint(100000, 999999)}"

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_standard_alert(self, session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, template_name, destination_name, alert_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
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

    def create_standard_alert_sql(self, session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, template_name, destination_name, alert_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
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
            return False
        assert response.status_code == 200, f"Failed to create alert: {response.content}"
        return True

    def create_real_time_alert(self, session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, template_name, destination_name, alert_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
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

    def create_standard_alert_cron(self, session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, template_name, destination_name, alert_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
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


    def delete_alert(self, session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, alert_name, stream_name):
        """Delete an alert."""
        session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
        response = session.delete(f"{base_url}api/{org_id}/{stream_name}/alerts/{alert_name}?type=logs")
        assert response.status_code == 200, f"Failed to delete alert: {response.content}"
        return response

    def validate_alert(self, session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, alert_name, stream_name):
        """Get an alert."""
        session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)
        response = session.get(f"{base_url}api/{org_id}/{stream_name}/alerts/{alert_name}")
        assert response.status_code == 200, f"Failed to get alert: {response.content}"
        return response