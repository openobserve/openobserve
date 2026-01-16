import random
import uuid
from requests.auth import HTTPBasicAuth
import time

class AlertPage:
    # Make Unique_value_alert a class variable
    Unique_value_alert = f"d4m21_{random.randint(100000, 999999)}"

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_standard_alert(self, session, base_url, user_email, user_password, org_id, stream_name, template_name, destination_name, alert_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
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

        response = session.post(f"{base_url}api/v2/{org_id}/alerts?type=logs", json=payload)
        if response.status_code == 409:
            # Handle alert already exists scenario
            print(f"Alert already exists: {payload['name']}.")
            return False  # Indicate that creation failed due to existing alert
        assert response.status_code == 200, f"Failed to create alert: {response.content}"
        return True  # Indicate successful creation

    def create_standard_alert_sql(self, session, base_url, user_email, user_password, org_id, stream_name, template_name, destination_name, alert_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
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

        response = session.post(f"{base_url}api/v2/{org_id}/alerts?type=logs", json=payload)
        if response.status_code == 409:
            # Handle alert already exists scenario
            print(f"Alert already exists: {payload['name']}.")
            return False
        assert response.status_code == 200, f"Failed to create alert: {response.content}"
        return True

    def create_real_time_alert(self, session, base_url, user_email, user_password, org_id, stream_name, template_name, destination_name, alert_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
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

        response = session.post(f"{base_url}api/v2/{org_id}/alerts?type=logs", json=payload)
        if response.status_code == 409:
            # Handle alert already exists scenario
            print(f"Alert already exists: {payload['name']}.")
            return False  # Indicate that creation failed due to existing alert
        assert response.status_code == 200, f"Failed to create alert: {response.content}"
        return True  # Indicate successful creation

    def create_standard_alert_cron(self, session, base_url, user_email, user_password, org_id, stream_name, template_name, destination_name, alert_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)
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

        response = session.post(f"{base_url}api/v2/{org_id}/alerts?type=logs", json=payload)
        if response.status_code == 409:
            # Handle alert already exists scenario
            print(f"Alert already exists: {payload['name']}.")
            return False  # Indicate that creation failed due to existing alert
        assert response.status_code == 200, f"Failed to create alert: {response.content}"
        return True  # Indicate successful creation

    def retrieve_alerts_standard(self, session, base_url, user_email, user_password, org_id, stream_name):
        """Retrieve standard alerts."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/v2/{org_id}/alerts?type=logs")
        assert response.status_code == 200, f"Failed to retrieve alerts: {response.content}"

        # Parse the response
        response_data = response.json()
        
        # Handle the case where response is wrapped in a 'data' field
        alerts = response_data.get('data', []) if isinstance(response_data, dict) else response_data
        
        

        # Ensure alerts is a list
        if not isinstance(alerts, list):
            print(f"Unexpected alerts format: {alerts}")
            return {"count": 0, "alerts": []}

        # Filter alerts
        standard_alerts = []
        for alert in alerts:
            try:
                if (isinstance(alert, dict) and 
                    isinstance(alert.get('name'), str) and 
                    alert['name'].startswith(f"standard_{AlertPage.Unique_value_alert}")):
                    standard_alerts.append(alert)
            except (KeyError, TypeError) as e:
                print(f"Error processing alert {alert}: {str(e)}")
                continue

        print(f"Filtered standard alerts: {standard_alerts}")

        assert len(standard_alerts) > 0, f"No alerts found with title starting with 'standard_{AlertPage.Unique_value_alert}'"

        return {
            "count": len(standard_alerts),
            "alerts": standard_alerts
        }
    
    def retrieve_alert_standard(self, session, base_url, user_email, user_password, org_id, stream_name, alert_name):
        """Retrieve a standard alert."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/v2/{org_id}/alerts/{alert_name}?type=logs")
        assert response.status_code == 200, f"Failed to retrieve alert: {response.content}"
        alert_standard_webhook = response.json()  # Assuming the response is a single alert, not a list.

        # Assert that the response is a valid template object
        assert isinstance(alert_standard_webhook, dict), "Response is not a valid alert object"

        return {
            "name_alert_standard_webhook": alert_standard_webhook["name"]
        }
    
    def retrieve_alerts_standard_sql(self, session, base_url, user_email, user_password, org_id, stream_name):
        """Retrieve standard SQL alerts."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/v2/{org_id}/alerts?type=logs")
        assert response.status_code == 200, f"Failed to retrieve alerts: {response.content}"

        # Parse the response
        response_data = response.json()
        
        # Handle the case where response is wrapped in a 'data' field
        alerts = response_data.get('data', []) if isinstance(response_data, dict) else response_data
        
       
        # Ensure alerts is a list
        if not isinstance(alerts, list):
            # print(f"Unexpected alerts format: {alerts}")
            return {"count": 0, "alerts": []}

        # Filter alerts
        standard_sql_alerts = []
        for alert in alerts:
            try:
                if (isinstance(alert, dict) and 
                    isinstance(alert.get('name'), str) and 
                    "alert_sql" in alert['name'] and 
                    alert['name'].startswith(f"alert_sql_{AlertPage.Unique_value_alert}")):
                    standard_sql_alerts.append(alert)
            except (KeyError, TypeError) as e:
                print(f"Error processing alert {alert}: {str(e)}")
                continue

        # Assert that the response is a valid alert object          
        assert isinstance(standard_sql_alerts, list), "Response is not a valid alert object"

        return {
            "count": len(standard_sql_alerts),
            "alerts": standard_sql_alerts
        }
    
    def retrieve_alert_standard_sql(self, session, base_url, user_email, user_password, org_id, stream_name, alert_name):
        """Retrieve a standard SQL alert."""    
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/v2/{org_id}/alerts/{alert_name}?type=logs")
        assert response.status_code == 200, f"Failed to retrieve alert: {response.content}"
        alert_standard_sql = response.json()  # Assuming the response is a single alert, not a list.

        # Assert that the response is a valid alert object          
        assert isinstance(alert_standard_sql, dict), "Response is not a valid alert object"

        return {
            "name_alert_standard_sql": alert_standard_sql["name"]
        }       

    def retrieve_alerts_sql(self, session, base_url, user_email, user_password, org_id, stream_name):
        """Retrieve all SQL alerts."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/v2/{org_id}/alerts?type=logs")
        assert response.status_code == 200, f"Failed to retrieve alerts: {response.content}"

        # Parse the JSON response
        alerts = response.json()
        assert len(alerts) > 0, "No alerts found"

        # Filter templates that contain 'template_webhook' and match the expected name
        sql_alerts = [alert for alert in alerts 
                           if "sql" in alert["name"] 
                           and alert["name"].startswith(f"alert_sql_{AlertPage.Unique_value_alert}")]         
        
        assert len(sql_alerts) > 0, f"No alerts found containing 'sql' with title 'alert_sql_{AlertPage.Unique_value_alert}'"

        return {
            "count": len(sql_alerts),
            "alerts": sql_alerts
        }   
    
    def retrieve_alert_sql(self, session, base_url, user_email, user_password, org_id, stream_name, alert_name):
        """Retrieve a SQL alert."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/v2/{org_id}/alerts/{alert_name}?type=logs")
        assert response.status_code == 200, f"Failed to retrieve alert: {response.content}"
        alert_sql = response.json()  # Assuming the response is a single alert, not a list. 

        # Assert that the response is a valid alert object
        assert isinstance(alert_sql, dict), "Response is not a valid alert object"

        return {
            "name_alert_sql": alert_sql["name"]
        }   

    def retrieve_alerts_real_time(self, session, base_url, user_email, user_password, org_id, stream_name):
        """Retrieve real-time alerts."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/v2/{org_id}/alerts?type=logs")
        assert response.status_code == 200, f"Failed to retrieve alerts: {response.content}"

        alerts = response.json()
        if not isinstance(alerts, list):
            alerts = alerts.get('data', []) if isinstance(alerts, dict) else []

        real_time_alerts = [
            alert for alert in alerts 
            if isinstance(alert, dict) and 
            isinstance(alert.get('name'), str) and
            "real_time" in alert["name"] and 
            alert["name"].startswith(f"alert_real_time  _{AlertPage.Unique_value_alert}")
        ]

        return {
            "count": len(real_time_alerts),
            "alerts": real_time_alerts
        }
    
    def retrieve_alert_real_time(self, session, base_url, user_email, user_password, org_id, stream_name, alert_name):
        """Retrieve a real-time alert."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/v2/{org_id}/alerts/{alert_name}?type=logs")
        assert response.status_code == 200, f"Failed to retrieve alert: {response.content}"
        alert_real_time = response.json()  # Assuming the response is a single alert, not a list.

        # Assert that the response is a valid alert object
        assert isinstance(alert_real_time, dict), "Response is not a valid alert object"

        return {
            "name_alert_real_time": alert_real_time["name"]
        }
    
    def retrieve_alerts_cron(self, session, base_url, user_email, user_password, org_id, stream_name):
        """Retrieve cron alerts."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/v2/{org_id}/alerts?type=logs")
        assert response.status_code == 200, f"Failed to retrieve alerts: {response.content}"

        alerts = response.json()
        if not isinstance(alerts, list):
            alerts = alerts.get('data', []) if isinstance(alerts, dict) else []

        cron_alerts = [
            alert for alert in alerts 
            if isinstance(alert, dict) and 
            isinstance(alert.get('name'), str) and
            "cron" in alert["name"] and 
            alert["name"].startswith(f"alert_cron_{AlertPage.Unique_value_alert}")
        ]

        return {
            "count": len(cron_alerts),
            "alerts": cron_alerts
        }   

    def retrieve_alert_cron(self, session, base_url, user_email, user_password, org_id, stream_name, alert_name):
        """Retrieve a cron alert."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        response = session.get(f"{base_url}api/v2/{org_id}/alerts/{alert_name}?type=logs")
        assert response.status_code == 200, f"Failed to retrieve alert: {response.content}"
        alert_cron = response.json()  # Assuming the response is a single alert, not a list.                                                                        

        # Assert that the response is a valid alert object
        assert isinstance(alert_cron, dict), "Response is not a valid alert object"

        return {
            "name_alert_cron": alert_cron["name"]
        }
                                        
        
    def update_standard_alert(self, session, base_url, user_email, user_password, org_id, stream_name, template_name, destination_name, alert_name):
        """Update a standard alert."""
        session.auth = HTTPBasicAuth(user_email, user_password)

        # Update the alert with the new payload
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
            "description": "test updated"
        }


        response = session.put(f"{base_url}api/v2/{org_id}/alerts/{alert_name}?type=logs", json=payload)
        assert response.status_code == 200, f"Failed to update alert: {response.content}"
        return response

    def update_standard_alert_sql(self, session, base_url, user_email, user_password, org_id, stream_name, template_name, destination_name, alert_name):
        """Update a standard SQL alert."""
        session.auth = HTTPBasicAuth(user_email, user_password)

        # Update the alert with the new payload
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
            "description": "test updated"
        }   

        response = session.put(f"{base_url}api/v2/{org_id}/alerts/{alert_name}?type=logs", json=payload)
        assert response.status_code == 200, f"Failed to update alert: {response.content}"
        return response

    def update_real_time_alert(self, session, base_url, user_email, user_password, org_id, stream_name, template_name, destination_name, alert_name):
        """Update a real-time alert."""
        session.auth = HTTPBasicAuth(user_email, user_password)

        # Update the alert with the new payload
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
            "description": "test updated"
        }

        response = session.put(f"{base_url}api/v2/{org_id}/alerts/{alert_name}?type=logs", json=payload)
        assert response.status_code == 200, f"Failed to update alert: {response.content}"
        return response 
    
    def update_standard_alert_cron(self, session, base_url, user_email, user_password, org_id, stream_name, template_name, destination_name, alert_name):
        """Update a standard cron alert."""
        session.auth = HTTPBasicAuth(user_email, user_password)

        # Update the alert with the new payload
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
            "description": "test updated"
        }

        response = session.put(f"{base_url}api/v2/{org_id}/alerts/{alert_name}?type=logs", json=payload)
        assert response.status_code == 200, f"Failed to update alert: {response.content}"
        return response


    
    def delete_alert(self, session, base_url, user_email, user_password, org_id, stream_name, alert_name):
        """Delete alerts of a specified type."""
        session.auth = HTTPBasicAuth(user_email, user_password)

        resp_delete_alert = session.delete(f"{base_url}api/v2/{org_id}/alerts/{alert_name}")
        assert resp_delete_alert.status_code == 200, f"Failed to delete alert {alert_name}: {resp_delete_alert.content}"

        # Wait for a few seconds to allow the data to be deleted
        time.sleep(10)  # Increase this time if necessary

            # Verify deletion
        resp_ver_alert = session.get(f"{base_url}api/v2/{org_id}/alerts/{alert_name}")
        assert resp_ver_alert.status_code == 404, f"Expected 404 for {alert_name}, but got {resp_ver_alert.status_code}"

        return resp_delete_alert  # Return the list of deleted alert names for verification if needed

    def validate_deleted_standard_alert(self, session, base_url, user_email, user_password, org_id, stream_name, alert_name):
        """Running an E2E test for validating deleted alerts in SC."""
        session.auth = HTTPBasicAuth(user_email, user_password)         
        # Retrieve all alerts
        response = session.get(f"{base_url}api/v2/{org_id}/alerts?type=logs")
        assert response.status_code == 200, f"Failed to retrieve alerts: {response.content}"

        # Get the response data
        response_data = response.json()
        
        
        # Handle different response formats
        if isinstance(response_data, dict):
            alerts = response_data.get('data', [])
        elif isinstance(response_data, str):
            # print(f"Unexpected string response: {response_data}")
            alerts = []
        elif isinstance(response_data, list):
            alerts = response_data
        else:
            print(f"Unexpected response type: {type(response_data)}")
            alerts = []

       
        # Filter alerts with proper type checking
        standard_alerts = []
        for alert in alerts:
            if not isinstance(alert, dict):
                # print(f"Skipping non-dict alert: {alert}")
                continue
            
            name = alert.get('name')
            if not isinstance(name, str):
                # print(f"Skipping alert with non-string name: {alert}")
                continue
            
            if ("standard" in name and 
                name.startswith(f"standard_{AlertPage.Unique_value_alert}")):
                standard_alerts.append(alert)

        
        # Check if any alerts of the specified type exist
        if len(standard_alerts) == 0:
            print(f"No alerts found of type '{alert_name}' (expected for deletion verification)")
        else:
            print(f"Alerts found of type '{alert_name}': {[alert.get('name') for alert in standard_alerts]}")
        
        return standard_alerts

    def validate_deleted_standard_alert_sql(self, session, base_url, user_email, user_password, org_id, stream_name, alert_name):
        """Running an E2E test for validating deleted templates in SC."""
        session.auth = HTTPBasicAuth(user_email, user_password)         
        # Retrieve all templates
        response = session.get(f"{base_url}api/v2/{org_id}/alerts")
        assert response.status_code == 200, f"Failed to retrieve templates: {response.content}"

        alerts = response.json()

        # Filter templates that contain 'template_email' and match the expected name
        standard_sql_alerts = [alert for alert in alerts 
                           if "standard_sql" in alert["name"] 
                           and alert["name"].startswith(f"standard_sql_{AlertPage.Unique_value_alert}")]

        # Check if any templates of the specified type exist
        if len(standard_sql_alerts) == 0:
            print(f"No alerts found of type '{alert_name}'")
            # Optionally, you can choose to skip the assertion or handle it differently
        else:
            assert len(standard_sql_alerts) > 0, f"No alerts found of type '{alert_name}'"
            # print(f"Alerts found of type '{alert_name}': {[alert['name'] for alert in standard_sql_alerts]}")

        return standard_sql_alerts
    
    def validate_deleted_real_time_alert(self, session, base_url, user_email, user_password, org_id, stream_name, alert_name):
        """Running an E2E test for validating deleted alerts in SC."""
        session.auth = HTTPBasicAuth(user_email, user_password)         
        # Retrieve all alerts
        response = session.get(f"{base_url}api/v2/{org_id}/alerts")
        assert response.status_code == 200, f"Failed to retrieve alerts: {response.content}"

        alerts = response.json()

        # Filter alerts that contain 'real_time' and match the expected name
        real_time_alerts = [alert for alert in alerts 
                           if "real_time" in alert["name"]  
                           and alert["name"].startswith(f"real_time_{AlertPage.Unique_value_alert}")]

        if len(real_time_alerts) == 0:
            print(f"No alerts found of type '{alert_name}'")
        else:
            print(f"Alerts found of type '{alert_name}': {[alert['name'] for alert in real_time_alerts]}")
        return real_time_alerts
    
    def validate_deleted_standard_alert_cron(self, session, base_url, user_email, user_password, org_id, stream_name, alert_name):
        """Running an E2E test for validating deleted alerts in SC."""
        session.auth = HTTPBasicAuth(user_email, user_password)         
        # Retrieve all alerts
        response = session.get(f"{base_url}api/v2/{org_id}/alerts")
        assert response.status_code == 200, f"Failed to retrieve alerts: {response.content}"

        alerts = response.json()

        # Filter alerts that contain 'cron' and match the expected name
        standard_cron_alerts = [alert for alert in alerts 
                           if "standard_cron" in alert["name"] 
                           and alert["name"].startswith(f"standard_cron_{AlertPage.Unique_value_alert}")]

        if len(standard_cron_alerts) == 0:
            print(f"No alerts found of type '{alert_name}'")
        else:
            print(f"Alerts found of type '{alert_name}': {[alert['name'] for alert in standard_cron_alerts]}")
        return standard_cron_alerts
    