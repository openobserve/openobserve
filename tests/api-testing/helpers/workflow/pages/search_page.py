import random

from requests.auth import HTTPBasicAuth
from datetime import datetime, timedelta, timezone

class SearchPage:
    # Make Unique_value_destination a class variable
    Unique_value_search = f"d4m20_{random.randint(100000, 999999)}"

    @property
    def now(self):
        return datetime.now(timezone.utc)
    @property
    def one_min_ago(self):
        return int((self.now - timedelta(minutes=1)).timestamp() * 1000000)
    @property
    def one_hour_ago(self):
        return int((self.now - timedelta(hours=1)).timestamp() * 1000000)
    @property
    def one_day_ago(self):
        return int((self.now - timedelta(days=1)).timestamp() * 1000000)
    @property
    def two_hours_ago(self):
        return int((self.now - timedelta(hours=2)).timestamp() * 1000000)
    @property
    def two_days_ago(self):
        return int((self.now - timedelta(days=2)).timestamp() * 1000000)
    
    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def search_partition_logs_query_2_hours_stream(self, session, base_url, user_email, user_password, org_id, stream_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)

        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        payload = {
            "sql": f"SELECT * FROM \"{stream_name}\"",
            "start_time": self.two_hours_ago,
            "end_time": end_time
        }
        response = session.post(f"{base_url}api/{org_id}/_search_partition?type=logs", headers=headers, json=payload)
        assert response.status_code == 200, f"Failed to search logs: {response.content}"
        print(f"Search Partition Logs {user_email} Response: {response.content}")
        return response


    def search_cache_logs_query_2_hours_stream(self, session, base_url, user_email, user_password, org_id, stream_name):
        """Search logs with caching enabled."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)

        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)

        payload = {
            "query": {
                "sql": f"SELECT * FROM \"{stream_name}\"",
                "start_time": self.two_hours_ago,
                "end_time": end_time,
                "from": 0,
                "size": 50,
                "quick_mode": False
            }
        }

        response = session.post(
            f"{base_url}api/{org_id}/_search?type=logs&search_type=ui&use_cache=true",
            headers=headers,
            json=payload
        )
        assert response.status_code == 200, f"Failed to search logs: {response.content}"
        print(f"Search Cache Logs {user_email} Response: {response.content}")
        return response

    def search_histogram_logs_query_2_hours_stream(self, session, base_url, user_email, user_password, org_id, stream_name):
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)

        now = datetime.now(timezone.utc)
        end_time = int(now.timestamp() * 1000000)
        payload = {
            "query": {
                "sql": f"SELECT histogram(_timestamp, '1 minute') AS \"zo_sql_key\", COUNT(*) AS \"zo_sql_num\" FROM \"{stream_name}\" GROUP BY zo_sql_key ORDER BY zo_sql_key ASC",
                "start_time": self.two_hours_ago,
                "end_time": end_time,
                "size": -1
            }
        }
        response = session.post(f"{base_url}api/{org_id}/_search?type=logs&search_type=ui&use_cache=true", headers=headers, json=payload)
        assert response.status_code == 200, f"Failed to search logs: {response.content}"
        print(f"Search Histogram Logs {user_email} Response: {response.content}")
        return response

    