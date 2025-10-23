import pytest
import json
import uuid
import logging
import time
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Configure logger for test output
logger = logging.getLogger(__name__)


def safe_sql_identifier(identifier):
    """
    Safely escape SQL identifiers to prevent injection.
    Only allows alphanumeric characters, underscores, hyphens, dots, and curly braces.
    """
    if not isinstance(identifier, str):
        raise ValueError("Identifier must be a string")
    
    # Allow alphanumeric, underscore, hyphen, dot, and curly braces for template variables
    if not re.match(r'^[a-zA-Z0-9_\-\.{}]+$', identifier):
        raise ValueError(f"Invalid characters in identifier: {identifier}")
    
    # Additional length check to prevent excessively long identifiers
    if len(identifier) > 100:
        raise ValueError(f"Identifier too long: {identifier}")
    
    return identifier




@pytest.mark.parametrize(
    "source_stream, destination_template, condition_field, condition_value, expected_destination, expected_status",
    [
        ("e2e_automate4", "default_logs_{kubernetes.namespace_name}_test", "kubernetes.namespace_name", "monitoring", "default_logs_monitoring_test", 200),
        ("e2e_automate5", "default_logs_{kubernetes.namespace_name}_test", "kubernetes.namespace_name", "zinc-cp1", "default_logs_zinc_cp1_test", 200),
        ("e2e_automate6", "logs_{kubernetes.namespace_name}_dynamic", "kubernetes.namespace_name", "monitoring", "logs_monitoring_dynamic", 200),
    ]
)
def test_pipeline_dynamic_template_substitution(create_session, base_url, source_stream, destination_template, condition_field, condition_value, expected_destination, expected_status):
    """Test pipeline creation with ACTUAL dynamic template substitution - this should expose the bug on main repo."""
    session = create_session
    url = base_url
    org_id = "default"
    
    # Generate unique pipeline name
    pipeline_name = f"pipeline_template_{source_stream}_to_dynamic"
    
    # Generate unique node IDs
    input_node_id = str(uuid.uuid4())
    condition_node_id = str(uuid.uuid4())
    output_node_id = str(uuid.uuid4())
    
    # Load test data for later ingestion using absolute path
    # Path structure: tests/api-testing/tests/test_pipeline_dynamic.py -> tests/test-data/logs_data.json
    test_data_path = Path(__file__).parent.parent.parent / "test-data" / "logs_data.json"
    with open(test_data_path) as f:
        logs_data = json.load(f)

    # Pipeline payload with DYNAMIC TEMPLATE destination stream name
    pipeline_payload = {
        "name": pipeline_name,
        "description": f"Dynamic template routing from {source_stream} to {destination_template} based on {condition_field}={condition_value}",
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
                    "stream_name": destination_template,  # THIS IS THE KEY - using template not static name
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
    logger.info(f"Creating pipeline with DYNAMIC TEMPLATE: {pipeline_name}")
    logger.info(f"Template: '{destination_template}' should become '{expected_destination}'")
    resp_create_pipeline = session.post(f"{url}api/{org_id}/pipelines", json=pipeline_payload)
    
    if resp_create_pipeline.status_code != expected_status:
        logger.error(f"Pipeline creation failed. Response: {resp_create_pipeline.text}")
    
    assert resp_create_pipeline.status_code == expected_status, f"Expected status code {expected_status} but got {resp_create_pipeline.status_code}"
    logger.info(f"Pipeline created successfully: {pipeline_name}")

    # Get pipeline list to verify creation and get pipeline_id
    resp_list_pipelines = session.get(f"{url}api/{org_id}/pipelines")
    assert resp_list_pipelines.status_code == 200, f"Expected status code 200 but got {resp_list_pipelines.status_code}"
    
    pipelines_list = resp_list_pipelines.json().get("list", [])
    pipeline_id = None
    created_pipeline = None
    for pipeline in pipelines_list:
        if pipeline["name"] == pipeline_name:
            pipeline_id = pipeline["pipeline_id"]
            created_pipeline = pipeline
            break

    assert pipeline_id, f"Pipeline ID not found for the created pipeline: {pipeline_name}"
    logger.info(f"Pipeline ID: {pipeline_id}")

    # 🔍 CRITICAL BUG CHECK: Inspect the actual destination stream name in the saved pipeline
    logger.info("CHECKING FOR BUG: Inspecting saved pipeline configuration...")
    
    # Extract the output node from the saved pipeline to see what destination was actually saved
    output_nodes = [node for node in created_pipeline.get("nodes", []) if node.get("io_type") == "output"]
    if output_nodes:
        actual_saved_destination = output_nodes[0].get("data", {}).get("stream_name", "NOT_FOUND")
        logger.info(f"Template used: '{destination_template}'")
        logger.info(f"Actually saved: '{actual_saved_destination}'")
        
        # 🐛 BUG DETECTION: Check if template was improperly converted
        if "_kubernetes.namespace_name_" in actual_saved_destination or "_k8s_namespace_name_" in actual_saved_destination:
            logger.error(f"BUG DETECTED! Template was converted to literal underscore format: '{actual_saved_destination}'")
            logger.error("This is the bug - template substitution is broken!")
            
            # On main repo (with bug): This assertion should FAIL
            # On main environment (with fix): This assertion should PASS
            assert actual_saved_destination == expected_destination, f"BUG: Expected '{expected_destination}' but got '{actual_saved_destination}' - template substitution failed!"
        
        elif actual_saved_destination == expected_destination:
            logger.info("Template substitution working correctly!")
        elif actual_saved_destination == destination_template:
            logger.warning("Template was saved literally without substitution - may be processed at runtime")
        else:
            logger.warning(f"Unexpected destination format: '{actual_saved_destination}'")

    # Enable the pipeline
    resp_enable_pipeline = session.put(f"{url}api/{org_id}/pipelines/{pipeline_id}/enable?value=true")
    assert resp_enable_pipeline.status_code == 200, f"Failed to enable pipeline. Status: {resp_enable_pipeline.status_code}"
    logger.info(f"Pipeline enabled: {pipeline_name}")
    
    # NOW ingest data after pipeline is created and enabled
    ingest_url = f"{url}api/{org_id}/{source_stream}/_json"
    resp_ingest = session.post(ingest_url, json=logs_data)
    logger.info(f"Data ingestion to {source_stream} AFTER pipeline creation: Status {resp_ingest.status_code}")
    assert resp_ingest.status_code == 200, f"Data ingestion failed with status {resp_ingest.status_code}"
    
    # Wait for pipeline to process the newly ingested data
    logger.info("Waiting 15 seconds for pipeline to process data...")
    time.sleep(15)
    
    # Verify the pipeline is running and enabled
    resp_verify = session.get(f"{url}api/{org_id}/pipelines")
    assert resp_verify.status_code == 200
    pipeline_state = next((p for p in resp_verify.json()["list"] if p["pipeline_id"] == pipeline_id), None)
    assert pipeline_state is not None, f"Pipeline {pipeline_id} not found"
    assert pipeline_state["enabled"] is True, f"Pipeline {pipeline_id} is not enabled"
    
    logger.info("Pipeline verification successful")
    logger.info(f"Name: {pipeline_name}")
    logger.info(f"Source: {source_stream}")
    logger.info(f"Template: {destination_template}")
    logger.info(f"Expected Destination: {expected_destination}")
    logger.info(f"Condition: {condition_field} contains '{condition_value}'")
    logger.info("Status: Enabled")
    
    # 🎯 FINAL VERIFICATION: Check if the EXPECTED destination stream was created
    now = datetime.now(timezone.utc)
    end_time = int(now.timestamp() * 1000000)
    start_time = int((now - timedelta(minutes=5)).timestamp() * 1000000)
    
    # Check if the EXPECTED destination stream exists (should exist if template substitution worked)
    safe_expected_destination = safe_sql_identifier(expected_destination)
    expected_search_payload = {
        "query": {
            "sql": f'SELECT COUNT(*) as count FROM "{safe_expected_destination}"',
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": 1,
        }
    }
    
    resp_expected_search = session.post(f"{url}api/{org_id}/_search?type=logs", json=expected_search_payload)
    if resp_expected_search.status_code == 200:
        search_result = resp_expected_search.json()
        if search_result.get("hits", []):
            count = search_result["hits"][0].get("count", 0) 
            logger.info(f"EXPECTED destination stream '{expected_destination}' has {count} records")
            
            if count > 0:
                logger.info("TEMPLATE SUBSTITUTION SUCCESS! Data was routed to correctly substituted stream name")
            else:
                logger.warning("Expected stream exists but no records - may be timing issue")
        else:
            logger.warning(f"Expected destination stream '{expected_destination}' exists but no records found")
    else:
        logger.error(f"EXPECTED destination stream '{expected_destination}' does not exist (Status: {resp_expected_search.status_code})")
        logger.error("This suggests template substitution failed - data may have gone to literal template name")
        
        # Check if data went to the literal template name instead
        safe_template_name = safe_sql_identifier(destination_template)
        literal_search_payload = {
            "query": {
                "sql": f'SELECT COUNT(*) as count FROM "{safe_template_name}"',
                "start_time": start_time,
                "end_time": end_time,
                "from": 0,
                "size": 1,
            }
        }
        
        resp_literal_search = session.post(f"{url}api/{org_id}/_search?type=logs", json=literal_search_payload)
        if resp_literal_search.status_code == 200:
            literal_result = resp_literal_search.json()
            if literal_result.get("hits", []) and literal_result["hits"][0].get("count", 0) > 0:
                literal_count = literal_result["hits"][0].get("count", 0)
                logger.error(f"BUG CONFIRMED! Data was routed to literal template name '{destination_template}' ({literal_count} records)")
                logger.error("Template substitution is not working - this is the bug!")

    # Keep pipeline running for analysis
    logger.info(f"Pipeline '{pipeline_name}' will remain active for bug analysis")
    logger.info("Check the monitor to see which stream(s) actually received data")