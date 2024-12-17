import pytest

@pytest.mark.parametrize(
    "pipeline_name, stream_name, action, expected_status",
    [
        ("pipeline12222", "stream_pytest_data", None, 200),  # No action (default behavior)
        ("pipeline12345", "stream_test_data", "enable", 200),  # Action: Enable
        ("pipeline67890", "stream_other_data", "disable", 200),  # Action: Disable
    ]
)
def test_pipeline_creation_and_action(create_session, base_url, pipeline_name, stream_name, action, expected_status):
    """Running an E2E test for pipeline creation and enabling/disabling the pipeline."""
    session = create_session
    url = base_url
    org_id = "org_pytest_data"

    # Payload for pipeline creation
    pipeline_payload = {
        "name": pipeline_name,
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

    # Create a pipeline
    resp_create_pipeline = session.post(f"{url}api/{org_id}/pipelines", json=pipeline_payload)
    assert resp_create_pipeline.status_code == expected_status, f"Expected status code {expected_status} but got {resp_create_pipeline.status_code}"
    print("Create pipeline response:", resp_create_pipeline.json())

    # Retrieve the pipeline list
    resp_list_pipelines = session.get(f"{url}api/{org_id}/pipelines")
    assert resp_list_pipelines.status_code == 200, f"Expected status code 200 but got {resp_list_pipelines.status_code}"
    
    # Parse the pipeline list response
    pipelines_list = resp_list_pipelines.json().get("list", [])
    assert pipelines_list, "No pipelines found in the list response."

    # Extract the pipeline_id for the created pipeline
    pipeline_id = None
    for pipeline in pipelines_list:
        if pipeline["name"] == pipeline_name:
            pipeline_id = pipeline["pipeline_id"]
            break

    assert pipeline_id, "Pipeline ID not found for the created pipeline."
    print(f"Pipeline ID: {pipeline_id}")

    # Enable or disable the pipeline based on the action parameter
    if action == "enable":
        resp_enable_pipeline = session.put(f"{url}api/{org_id}/pipelines/{pipeline_id}/enable?value=true")
        assert resp_enable_pipeline.status_code == expected_status, f"Expected status code {expected_status} but got {resp_enable_pipeline.status_code}"
        print(f"Pipeline {pipeline_id} enabled successfully.")
    elif action == "disable":
        resp_enable_pipeline = session.put(f"{url}api/{org_id}/pipelines/{pipeline_id}/enable?value=false")
        assert resp_enable_pipeline.status_code == expected_status, f"Expected status code {expected_status} but got {resp_enable_pipeline.status_code}"
        print(f"Pipeline {pipeline_id} disabled successfully.")

     
    resp_get_pipeline = session.get(f"{url}api/{org_id}/pipelines")
    print(resp_get_pipeline.json())
    assert resp_get_pipeline.status_code == 200
    if action == "enable":
       assert resp_get_pipeline.json()["list"][0]["enabled"] is True
    if action == "disable":
       assert resp_get_pipeline.json()["list"][0]["enabled"] is False

    # Delete the pipeline
    resp_delete_pipeline = session.delete(f"{url}api/{org_id}/pipelines/{pipeline_id}")
    assert resp_delete_pipeline.status_code == 200, f"Expected status code 200 but got {resp_delete_pipeline.status_code}"
    print(f"Pipeline {pipeline_id} deleted successfully.")