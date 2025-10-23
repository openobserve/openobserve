import pytest
import json
import uuid
from datetime import datetime, timezone, timedelta


@pytest.mark.parametrize(
    "source_stream, destination_stream, condition_field, condition_value, expected_status",
    [
        ("e2e_automate4", "default_logs_monitoring_test", "kubernetes.namespace_name", "monitoring", 200),
        ("e2e_automate5", "default_logs_zinc_cp1_test", "kubernetes.namespace_name", "zinc-cp1", 200), 
        ("e2e_automate6", "default_logs_monitoring_test", "kubernetes.namespace_name", "monitoring", 200),
    ]
)
def test_pipeline_dynamic_namespace_routing(create_session, base_url, source_stream, destination_stream, condition_field, condition_value, expected_status):
    """Test pipeline creation with kubernetes namespace-based dynamic routing."""
    session = create_session
    url = base_url
    org_id = "default"
    
    # Generate unique pipeline name
    pipeline_name = f"pipeline_{source_stream}_to_{destination_stream}"
    
    # Generate unique node IDs
    input_node_id = str(uuid.uuid4())
    condition_node_id = str(uuid.uuid4())
    output_node_id = str(uuid.uuid4())
    
    # Load test data for later ingestion
    with open("../test-data/logs_data.json") as f:
        logs_data = json.load(f)

    # Pipeline payload with dynamic routing based on kubernetes namespace
    pipeline_payload = {
        "name": pipeline_name,
        "description": f"Dynamic routing from {source_stream} to {destination_stream} based on {condition_field}={condition_value}",
        "source": {"source_type": "realtime"},
        "nodes": [
            {
                "id": input_node_id,
                "type": "input",
                "data": {
                    "node_type": "stream",
                    "stream_name": source_stream,
                    "stream_type": "logs",
                    "org_id": org_id,
                },
                "position": {"x": 100, "y": 100},
                "io_type": "input",
            },
            {
                "id": condition_node_id,
                "type": "condition",
                "data": {
                    "node_type": "condition",
                    "conditions": [
                        {
                            "column": condition_field,
                            "operator": "Contains",
                            "value": condition_value,
                            "ignore_case": False
                        }
                    ]
                },
                "position": {"x": 300, "y": 100},
                "io_type": "condition",
            },
            {
                "id": output_node_id,
                "type": "output",
                "data": {
                    "node_type": "stream",
                    "stream_name": destination_stream,
                    "stream_type": "logs",
                    "org_id": org_id,
                },
                "position": {"x": 500, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [
            {
                "id": f"e{input_node_id}-{condition_node_id}",
                "source": input_node_id,
                "target": condition_node_id,
            },
            {
                "id": f"e{condition_node_id}-{output_node_id}",
                "source": condition_node_id,
                "target": output_node_id,
            }
        ],
        "org": org_id,
    }

    # Create the pipeline
    print(f"Creating pipeline: {pipeline_name}")
    resp_create_pipeline = session.post(f"{url}api/{org_id}/pipelines", json=pipeline_payload)
    
    if resp_create_pipeline.status_code != expected_status:
        print(f"Pipeline creation failed. Response: {resp_create_pipeline.json()}")
    
    assert resp_create_pipeline.status_code == expected_status, f"Expected status code {expected_status} but got {resp_create_pipeline.status_code}"
    print(f"✅ Pipeline created successfully: {pipeline_name}")

    # Get pipeline list to verify creation and get pipeline_id
    resp_list_pipelines = session.get(f"{url}api/{org_id}/pipelines")
    assert resp_list_pipelines.status_code == 200, f"Expected status code 200 but got {resp_list_pipelines.status_code}"
    
    pipelines_list = resp_list_pipelines.json().get("list", [])
    pipeline_id = None
    for pipeline in pipelines_list:
        if pipeline["name"] == pipeline_name:
            pipeline_id = pipeline["pipeline_id"]
            break

    assert pipeline_id, f"Pipeline ID not found for the created pipeline: {pipeline_name}"
    print(f"Pipeline ID: {pipeline_id}")

    # Enable the pipeline
    resp_enable_pipeline = session.put(f"{url}api/{org_id}/pipelines/{pipeline_id}/enable?value=true")
    assert resp_enable_pipeline.status_code == 200, f"Failed to enable pipeline. Status: {resp_enable_pipeline.status_code}"
    print(f"✅ Pipeline enabled: {pipeline_name}")
    
    # NOW ingest data after pipeline is created and enabled
    ingest_url = f"{url}api/{org_id}/{source_stream}/_json"
    resp_ingest = session.post(ingest_url, json=logs_data)
    print(f"📊 Data ingestion to {source_stream} AFTER pipeline creation: Status {resp_ingest.status_code}")
    assert resp_ingest.status_code == 200, f"Data ingestion failed with status {resp_ingest.status_code}"
    
    # Wait for pipeline to process the newly ingested data
    import time
    print(f"⏳ Waiting 10 seconds for pipeline to process data...")
    time.sleep(10)
    
    # Verify the pipeline is running and enabled
    resp_verify = session.get(f"{url}api/{org_id}/pipelines")
    assert resp_verify.status_code == 200
    pipeline_state = next((p for p in resp_verify.json()["list"] if p["pipeline_id"] == pipeline_id), None)
    assert pipeline_state is not None, f"Pipeline {pipeline_id} not found"
    assert pipeline_state["enabled"] is True, f"Pipeline {pipeline_id} is not enabled"
    
    print(f"✅ Pipeline verification successful:")
    print(f"   Name: {pipeline_name}")
    print(f"   Source: {source_stream}")
    print(f"   Destination: {destination_stream}")
    print(f"   Condition: {condition_field} contains '{condition_value}'")
    print(f"   Status: Enabled")
    
    # Check if destination stream was created and has matching records
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    start_time = int((now - timedelta(minutes=5)).timestamp() * 1000000)
    
    # First check if destination stream exists and count records
    search_payload = {
        "query": {
            "sql": f'SELECT COUNT(*) as count FROM "{destination_stream}"',
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": 1,
        }
    }
    
    resp_search = session.post(f"{url}api/{org_id}/_search?type=logs", json=search_payload)
    if resp_search.status_code == 200:
        search_result = resp_search.json()
        if search_result.get("hits", []):
            count = search_result["hits"][0].get("count", 0) 
            print(f"✅ Destination stream '{destination_stream}' has {count} records")
        else:
            print(f"⚠️  Destination stream '{destination_stream}' exists but no records found yet")
    else:
        print(f"⚠️  Destination stream '{destination_stream}' may not exist yet (Status: {resp_search.status_code})")
    
    # Also check source stream to verify the condition matches exist in original data
    source_condition_payload = {
        "query": {
            "sql": f'SELECT COUNT(*) as matching_records FROM "{source_stream}" WHERE "{condition_field}" = \'{condition_value}\'',
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": 1,
        }
    }
    
    resp_source_check = session.post(f"{url}api/{org_id}/_search?type=logs", json=source_condition_payload)
    if resp_source_check.status_code == 200:
        source_result = resp_source_check.json()
        if source_result.get("hits", []):
            matching_count = source_result["hits"][0].get("matching_records", 0)
            print(f"📊 Source stream '{source_stream}' has {matching_count} records matching {condition_field}='{condition_value}'")
            if matching_count > 0:
                print(f"✅ Pipeline should route {matching_count} records to destination stream")
            else:
                print(f"⚠️  No matching records found in source - pipeline may not route any data")
        else:
            print(f"⚠️  Could not count matching records in source stream")
    else:
        print(f"⚠️  Could not query source stream (Status: {resp_source_check.status_code})")

    # Keep pipeline running - don't delete it so it can be seen on monitor
    print(f"✅ Pipeline '{pipeline_name}' will remain active for monitoring")


@pytest.mark.parametrize(
    "pipeline_name",
    [
        "pipeline_e2e_automate4_to_default_logs_monitoring_test",
        "pipeline_e2e_automate5_to_default_logs_zinc_cp1_test", 
        "pipeline_e2e_automate6_to_default_logs_monitoring_test",
    ]
)
def test_cleanup_dynamic_pipelines(create_session, base_url, pipeline_name):
    """Optional cleanup test to remove created pipelines."""
    session = create_session
    url = base_url
    org_id = "default"
    
    # Get pipeline list
    resp_list_pipelines = session.get(f"{url}api/{org_id}/pipelines")
    if resp_list_pipelines.status_code != 200:
        print(f"Could not get pipeline list: {resp_list_pipelines.status_code}")
        return
        
    pipelines_list = resp_list_pipelines.json().get("list", [])
    pipeline_id = None
    for pipeline in pipelines_list:
        if pipeline["name"] == pipeline_name:
            pipeline_id = pipeline["pipeline_id"]
            break
    
    if not pipeline_id:
        print(f"Pipeline '{pipeline_name}' not found for cleanup")
        return
        
    # Delete the pipeline
    resp_delete = session.delete(f"{url}api/{org_id}/pipelines/{pipeline_id}")
    if resp_delete.status_code == 200:
        print(f"✅ Pipeline '{pipeline_name}' deleted successfully")
    else:
        print(f"⚠️  Failed to delete pipeline '{pipeline_name}': Status {resp_delete.status_code}")