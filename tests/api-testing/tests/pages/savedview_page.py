import random
from requests.auth import HTTPBasicAuth
class SavedViewPage:
    # Make Unique_value_destination a class variable
    Unique_value_savedview = f"d4m21_{random.randint(100000, 999999)}"

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    def create_savedView(self, session, base_url, user_email, user_password, org_id, stream_name, savedview_name):
        """Create a saved view."""
        headers = {"Content-Type": "application/json", "Custom-Header": "value"}
        session.auth = HTTPBasicAuth(user_email, user_password)  
        payload = {
            "organizationIdentifier": org_id,
            "runQuery": False,
            "loading": False,
            "loadingHistogram": False,
            "loadingCounter": False,
            "loadingStream": False,
            "loadingSavedView": False,
            "shouldIgnoreWatcher": False,
            "communicationMethod": "http",
            "config": {
                "splitterModel": 20,
                "lastSplitterPosition": 0,
                "splitterLimit": [0, 40],
                "fnSplitterModel": 60,
                "fnLastSplitterPosition": 0,
                "fnSplitterLimit": [40, 100],
                "refreshTimes": [
                    [{"label": "5 sec", "value": 5}, {"label": "1 min", "value": 60}, {"label": "1 hr", "value": 3600}],
                    [{"label": "10 sec", "value": 10}, {"label": "5 min", "value": 300}, {"label": "2 hr", "value": 7200}],
                    [{"label": "15 sec", "value": 15}, {"label": "15 min", "value": 900}, {"label": "1 day", "value": 86400}],
                    [{"label": "30 sec", "value": 30}, {"label": "30 min", "value": 1800}]
                ]
            },
            "meta": {
                # Include the rest of the meta fields as needed
                "logsVisualizeToggle": "logs",
                "refreshInterval": 0,
                "refreshIntervalLabel": "Off",
                "refreshHistogram": False,
                "showFields": True,
                "showQuery": True,
                "showHistogram": True,
                "showDetailTab": False,
                "toggleFunction": True,
                "searchApplied": True,
                "toggleSourceWrap": False,
                "histogramDirtyFlag": False,
                "sqlMode": True,
                "quickMode": False,
                "queryEditorPlaceholderFlag": True,
                "functionEditorPlaceholderFlag": True,
                "resultGrid": {
                    "rowsPerPage": 50,
                    "wrapCells": False,
                    "manualRemoveFields": False,
                    "chartInterval": "30 second",
                    "chartKeyFormat": "HH:mm:ss",
                    "navigation": {"currentRowIndex": 0},
                    "showPagination": True
                },
                "jobId": "",
                "jobRecords": "100",
                "pageType": "logs",
                "regions": [],
                "clusters": [],
                "useUserDefinedSchemas": "user_defined_schema",
                "hasUserDefinedSchemas": False,
                "selectedTraceStream": "",
                "showSearchScheduler": False
            },
            "data": {
                "query": f"SELECT * FROM \"{stream_name}\"",
                # Add the rest of the data fields as needed
            },
            "view_name": savedview_name
        }

        response = session.post(f"{base_url}api/{org_id}/savedviews", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create saved view: {response.content}"
        return response