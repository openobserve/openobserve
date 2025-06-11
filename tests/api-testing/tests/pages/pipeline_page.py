import random
from requests.auth import HTTPBasicAuth

class PipelinePage:
    # Make Unique_value_destination a class variable
    Unique_value_pipeline = f"d4m23_{random.randint(100000, 999999)}"

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_realTime_pipeline(self, session, base_url, user_email, user_password, org_id, stream_name, realTime_pipeline_name):
        """Create a realTime pipeline."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)

        payload = {
            "name": realTime_pipeline_name,
            "description": "",
            "source": {"source_type": "realtime"},
            "nodes": [
                {
                    "id": "1e1fa129-cfbd-4082-8d39-c4dc418a670f",
                    "type": "input",
                    "data": {
                        "node_type": "stream",
                        "stream_name": stream_name,
                        "stream_type": "logs",
                        "org_id": org_id,
                    },
                    "position": {"x": 169.83333, "y": 55},
                    "io_type": "input",
                },
                {
                    "id": "8e0ed123-7737-4801-9466-bd909c425c72",
                    "type": "output",
                    "data": {
                        "node_type": "stream",
                        "stream_name": stream_name,
                        "stream_type": "logs",
                        "org_id": org_id,
                    },
                    "position": {"x": 305.33334, "y": 276},
                    "io_type": "output",
                },
            ],
            "edges": [
                {
                    "id": "e1e1fa129-cfbd-4082-8d39-c4dc418a670f-8e0ed123-7737-4801-9466-bd909c425c72",
                    "source": "1e1fa129-cfbd-4082-8d39-c4dc418a670f",
                    "target": "8e0ed123-7737-4801-9466-bd909c425c72",
                }
            ],
            "org": org_id,
        }

        response = session.post(f"{base_url}api/{org_id}/pipelines", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create scheduled pipeline: {response.content.decode()}"
        return response


    def create_scheduled_pipeline(self, session, base_url, user_email, user_password, org_id, stream_name, scheduled_pipeline_name):
        """Create a scheduled pipeline."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)

        payload = {
            "name": scheduled_pipeline_name,
            "description": "",
            "source": {"source_type": "scheduled"},
            "nodes": [
                {
                    "id": "8b03771c-2e94-4c2f-b902-8fb8b8e66df2",
                    "type": "input",
                    "dimensions": {"width": 140, "height": 42},
                    "computedPosition": {"x": 212.1047849020086, "y": 93.00563781047852, "z": 0},
                    "handleBounds": {
                        "source": [{"id": "output", "position": "bottom", "x": 55.03916432328342, "y": 36.00006521998462, "width": 30, "height": 10}],
                        "target": []
                    },
                    "position": {"x": 212.1047849020086, "y": 93.00563781047852},
                    "data": {
                        "label": "8b03771c-2e94-4c2f-b902-8fb8b8e66df2",
                        "node_type": "query",
                        "stream_type": "logs",
                        "org_id": org_id,
                        "query_condition": {
                            "type": "sql",
                            "conditions": None,
                            "sql": f"select * from {stream_name}",
                            "promql": None,
                            "promql_condition": None,
                            "aggregation": None,
                            "vrl_function": None,
                            "search_event_type": "DerivedStream"
                        },
                        "trigger_condition": {
                            "period": 15,
                            "operator": "=",
                            "threshold": 0,
                            "frequency": 15,
                            "cron": "",
                            "frequency_type": "minutes",
                            "silence": 0
                        }
                    },
                    "io_type": "input"
                },
                {
                    "id": "cfa476a0-24f3-4ca3-a14f-b56b04729922",
                    "type": "output",
                    "dimensions": {"width": 250, "height": 42},
                    "computedPosition": {"x": 269.2781219770897, "y": 161.6932759313432, "z": 0},
                    "handleBounds": {
                        "source": [],
                        "target": [{"id": "input", "position": "top", "x": 110.11741720560622, "y": -4.000002219844093, "width": 30, "height": 10}]
                    },
                    "position": {"x": 269.2781219770897, "y": 161.6932759313432},
                    "data": {
                        "label": "cfa476a0-24f3-4ca3-a14f-b56b04729922",
                        "node_type": "stream",
                        "stream_type": "logs",
                        "stream_name": stream_name,
                        "org_id": org_id
                    },
                    "io_type": "output"
                }
            ],
            "edges": [
                {
                    "id": "e8b03771c-2e94-4c2f-b902-8fb8b8e66df2-cfa476a0-24f3-4ca3-a14f-b56b04729922",
                    "type": "custom",
                    "source": "8b03771c-2e94-4c2f-b902-8fb8b8e66df2",
                    "target": "cfa476a0-24f3-4ca3-a14f-b56b04729922",
                    "data": {},
                    "markerEnd": {"type": "arrowclosed", "width": 20, "height": 20},
                    "style": {"strokeWidth": 2},
                    "animated": True
                }
            ],
            "org": org_id,
            "schedule": {
                "enabled": True,
                "frequency": "daily",  # Example frequency, adjust as needed
                "time": "02:00",       # Example time, adjust as needed
            }
        }

        response = session.post(f"{base_url}api/{org_id}/pipelines", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create scheduled pipeline: {response.content.decode()}"
        return response