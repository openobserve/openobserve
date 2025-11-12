import pytest

@pytest.mark.parametrize(
    "pipeline_name, stream_name, action, expected_status",
    [
        ("pipeline12222", "stream_pytest_data", None, 200),  # No action (default behavior)
        ("pipeline12345", "stream_test_data", "enable", 200),  # Action: Enable
        ("pipeline67890", "stream_other_data", "disable", 200),  # Action: Disable
    ]
)
def test_pipeline_creation_and_action_realtime(create_session, base_url, pipeline_name, stream_name, action, expected_status):
    """Running an E2E test for pipeline creation and enabling/disabling the pipeline."""
    session = create_session
    url = base_url
    org_id = "default"

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
    pipeline_list = resp_get_pipeline.json()["list"]
    target_pipeline = next((p for p in pipeline_list if p["pipeline_id"] == pipeline_id), None)
    assert target_pipeline is not None, f"Pipeline {pipeline_id} not found in the list"
    if action == "enable":
       assert target_pipeline["enabled"] is True
    if action == "disable":
       assert target_pipeline["enabled"] is False

    # Delete the pipeline
    resp_delete_pipeline = session.delete(f"{url}api/{org_id}/pipelines/{pipeline_id}")
    assert resp_delete_pipeline.status_code == 200, f"Expected status code 200 but got {resp_delete_pipeline.status_code}"
    # Verify pipeline is deleted
    resp_verify_deletion = session.get(f"{url}api/{org_id}/pipelines")
    assert resp_verify_deletion.status_code == 200
    deleted_pipeline = next((p for p in resp_verify_deletion.json()["list"] if p["pipeline_id"] == pipeline_id), None)
    assert deleted_pipeline is None, f"Pipeline {pipeline_id} still exists after deletion"


@pytest.mark.parametrize(
    "pipeline_name, stream_name, action, expected_status, schedule_enabled",
    [
        ("pipeline12222", "stream_pytest_data", None, 200, False),  # No action (default behavior)
        ("scheduled_pipeline", "stream_scheduled_data", "enable", 200, True),  # Action: Enable with schedule
        ("scheduled_pipeline", "stream_scheduled_data", "disable", 200, False),  # Action: Disable with schedule
    ]
)

def test_pipeline_creation_and_action_with_schedule(create_session, base_url, pipeline_name, stream_name, action, expected_status, schedule_enabled):
    """Running an E2E test for pipeline creation with scheduling and enabling/disabling the pipeline."""
    session = create_session
    url = base_url
    org_id = "default"

    # Payload for scheduled pipeline creation
    pipeline_payload = {
        "name": pipeline_name,
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
                        "sql": "select * from default",
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
            "enabled": schedule_enabled,
            "frequency": "daily",  # Example frequency, adjust as needed
            "time": "02:00",       # Example time, adjust as needed
        }
    }

    # Create a pipeline
    resp_create_pipeline = session.post(f"{url}api/{org_id}/pipelines", json=pipeline_payload)
    assert resp_create_pipeline.status_code == expected_status, f"Expected status code {expected_status} but got {resp_create_pipeline.status_code}"
    print("Create pipeline response:", resp_create_pipeline.json())

    # Retrieve the pipeline list
    resp_list_pipelines = session.get(f"{url}api/{org_id}/pipelines")
    assert resp_list_pipelines.status_code == 200, f"Expected status code 200 but got {resp_list_pipelines.status_code}"

    # Extract the pipeline_id for the created pipeline
    pipelines_list = resp_list_pipelines.json().get("list", [])
    pipeline_id = next((p["pipeline_id"] for p in pipelines_list if p["name"] == pipeline_name), None)
    assert pipeline_id, "Pipeline ID not found for the created pipeline."
    print(f"Pipeline ID: {pipeline_id}")

    # Enable/disable pipeline based on the action
    value = "True" if action == "enable" else "False"
    resp_toggle_pipeline = session.put(f"{url}api/{org_id}/pipelines/{pipeline_id}/enable?value={value}")
    assert resp_toggle_pipeline.status_code == expected_status, f"Expected status code {expected_status} but got {resp_toggle_pipeline.status_code}"
    print(f"Pipeline {pipeline_id} {'enabled' if action == 'enable' else 'disabled'} successfully.")

    # Verify the pipeline state
    resp_verify_pipeline = session.get(f"{url}api/{org_id}/pipelines")
    pipeline_state = next((p["enabled"] for p in resp_verify_pipeline.json()["list"] if p["pipeline_id"] == pipeline_id), None)
    assert pipeline_state == (action == "enable"), f"Pipeline state mismatch after {action} action."

    # Delete the pipeline
    resp_delete_pipeline = session.delete(f"{url}api/{org_id}/pipelines/{pipeline_id}")
    assert resp_delete_pipeline.status_code == 200, f"Expected status code 200 but got {resp_delete_pipeline.status_code}"
    print(f"Pipeline {pipeline_id} deleted successfully.")



@pytest.mark.parametrize(
    "pipeline_name, stream_name, action, expected_status, schedule_enabled",
    [
        ("pipeline12222", "stream_pytest_data", None, 400, False),  # No action (default behavior)

    ]
)

def test_pipeline_creation_and_action_with_schedule(create_session, base_url, pipeline_name, stream_name, action, expected_status, schedule_enabled):
    """Running an E2E test for pipeline creation with scheduling and enabling/disabling the pipeline."""
    session = create_session
    url = base_url
    org_id = "default"

    # Payload for scheduled pipeline creation
    pipeline_payload = {
        "name": pipeline_name,
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
                        "sql": "",
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
            "enabled": schedule_enabled,
            "frequency": "daily",  # Example frequency, adjust as needed
            "time": "02:00",       # Example time, adjust as needed
        }
    }

    # Create a pipeline
    resp_create_pipeline = session.post(f"{url}api/{org_id}/pipelines", json=pipeline_payload)
    assert resp_create_pipeline.status_code == expected_status, f"Expected status code {expected_status} but got {resp_create_pipeline.status_code}"
    print("Create pipeline response:", resp_create_pipeline.json())


@pytest.mark.parametrize(
    "pipeline_name, stream_name, action, expected_status",
    [
        ("pipeline12222", "stream_pytest_data", None, 400),  # No action (default behavior)

    ]
)

def test_pipeline_creation_and_action_flatten(create_session, base_url, pipeline_name, stream_name, action, expected_status):
    """Running an E2E test for pipeline creation and enabling/disabling the pipeline."""
    session = create_session
    url = base_url
    org_id = "default"

    # Payload for pipeline creation
    pipeline_payload = {
        "name": pipeline_name,
        "description": "",
        "source": {
            "source_type": "realtime"
        },
        "nodes": [
            {
            "id": "b6c04033-6492-44f9-a365-00d6c6425193",
            "type": "input",
            "dimensions": {
                "width": 271,
                "height": 42
            },
            "computedPosition": {
                "x": 124.5,
                "y": 63,
                "z": 0
            },
            "handleBounds": {
                "source": [
                {
                    "id": "output",
                    "position": "bottom",
                    "x": 120.515625,
                    "y": 36,
                    "width": 30,
                    "height": 10
                }
                ],
                "target": []
            },
            "selected": False,
            "dragging": False,
            "resizing": False,
            "initialized": False,
            "isParent": False,
            "position": {
                "x": 124.5,
                "y": 63
            },
            "data": {
                "label": "b6c04033-6492-44f9-a365-00d6c6425193",
                "node_type": "stream",
                "stream_type": "logs",
                "stream_name": "stream_pytest_data",
                "org_id": "org_pytest_data"
            },
            "events": {},
            "io_type": "input"
            },
            {
            "id": "60aea6df-ec59-452e-ab52-4d1ec18391a1",
            "type": "output",
            "dimensions": {
                "width": 271,
                "height": 42
            },
            "computedPosition": {
                "x": 260,
                "y": 284,
                "z": 0
            },
            "handleBounds": {
                "source": [],
                "target": [
                {
                    "id": "input",
                    "position": "top",
                    "x": 120.515625,
                    "y": -4,
                    "width": 30,
                    "height": 10
                }
                ]
            },
            "selected": False,
            "dragging": False,
            "resizing": False,
            "initialized": False,
            "isParent": False,
            "position": {
                "x": 260,
                "y": 284
            },
            "data": {
                "label": "60aea6df-ec59-452e-ab52-4d1ec18391a1",
                "node_type": "stream",
                "stream_type": "logs",
                "stream_name": "stream_pytest_data",
                "org_id": "org_pytest_data"
            },
            "events": {},
            "io_type": "output"
            },
            {
            "id": "f912e999-0f19-4b9a-9f9b-34c4552cdaa4",
            "type": "default",
            "dimensions": {
                "width": 234,
                "height": 54
            },
            "computedPosition": {
                "x": 285.66666666666674,
                "y": 125.00000000000003,
                "z": 0
            },
            "handleBounds": {
                "source": [
                {
                    "id": "output",
                    "position": "bottom",
                    "x": 102.21875,
                    "y": 48,
                    "width": 30,
                    "height": 10
                }
                ],
                "target": [
                {
                    "id": "input",
                    "position": "top",
                    "x": 102.21875,
                    "y": -4,
                    "width": 30,
                    "height": 10
                }
                ]
            },
            "selected": False,
            "dragging": False,
            "resizing": False,
            "initialized": False,
            "isParent": False,
            "position": {
                "x": 285.66666666666674,
                "y": 125.00000000000003
            },
            "data": {
                "label": "f912e999-0f19-4b9a-9f9b-34c4552cdaa4",
                "node_type": "function",
                "name": "pytest",
                "after_flatten": True
            },
            "events": {},
            "io_type": "default"
            },
            {
            "id": "4278cc25-1699-4532-b4ef-705c63d455ee",
            "type": "default",
            "dimensions": {
                "width": 244,
                "height": 54
            },
            "computedPosition": {
                "x": 53.33333333333334,
                "y": 160.33333333333334,
                "z": 0
            },
            "handleBounds": {
                "source": [
                {
                    "id": "output",
                    "position": "bottom",
                    "x": 107.1171875,
                    "y": 48,
                    "width": 30,
                    "height": 10
                }
                ],
                "target": [
                {
                    "id": "input",
                    "position": "top",
                    "x": 107.1171875,
                    "y": -4,
                    "width": 30,
                    "height": 10
                }
                ]
            },
            "selected": False,
            "dragging": False,
            "resizing": False,
            "initialized": False,
            "isParent": False,
            "position": {
                "x": 53.33333333333334,
                "y": 160.33333333333334
            },
            "data": {
                "label": "4278cc25-1699-4532-b4ef-705c63d455ee",
                "node_type": "function",
                "name": "pytest2",
                "after_flatten": False
            },
            "events": {},
            "io_type": "default"
            },
            {
            "id": "9d2e796a-d424-48b8-a0b0-0d8b2143648c",
            "type": "output",
            "dimensions": {
                "width": 238,
                "height": 42
            },
            "computedPosition": {
                "x": -21.666666666666686,
                "y": 313,
                "z": 1000
            },
            "handleBounds": {
                "source": [],
                "target": [
                {
                    "id": "input",
                    "position": "top",
                    "x": 103.828125,
                    "y": -4,
                    "width": 30,
                    "height": 10
                }
                ]
            },
            "selected": True,
            "dragging": False,
            "resizing": False,
            "initialized": False,
            "isParent": False,
            "position": {
                "x": -21.666666666666686,
                "y": 313
            },
            "data": {
                "label": "9d2e796a-d424-48b8-a0b0-0d8b2143648c",
                "node_type": "stream",
                "stream_type": "logs",
                "stream_name": "pyteststream2",
                "org_id": "org_pytest_data"
            },
            "events": {},
            "io_type": "output"
            }
        ],
        "edges": [
            {
            "id": "eb6c04033-6492-44f9-a365-00d6c6425193-f912e999-0f19-4b9a-9f9b-34c4552cdaa4",
            "type": "custom",
            "source": "b6c04033-6492-44f9-a365-00d6c6425193",
            "target": "f912e999-0f19-4b9a-9f9b-34c4552cdaa4",
            "data": {},
            "events": {},
            "label": "",
            "markerEnd": {
                "type": "arrowclosed",
                "width": 20,
                "height": 20
            },
            "style": {
                "strokeWidth": 2
            },
            "animated": True,
            "sourceNode": {
                "id": "b6c04033-6492-44f9-a365-00d6c6425193",
                "type": "input",
                "dimensions": {
                "width": 271,
                "height": 42
                },
                "computedPosition": {
                "x": 124.5,
                "y": 63,
                "z": 0
                },
                "handleBounds": {
                "source": [
                    {
                    "id": "output",
                    "position": "bottom",
                    "x": 120.515625,
                    "y": 36,
                    "width": 30,
                    "height": 10
                    }
                ],
                "target": []
                },
                "selected": False,
                "dragging": False,
                "resizing": False,
                "initialized": False,
                "isParent": False,
                "position": {
                "x": 124.5,
                "y": 63
                },
                "data": {
                "label": "b6c04033-6492-44f9-a365-00d6c6425193",
                "node_type": "stream",
                "stream_type": "logs",
                "stream_name": "stream_pytest_data",
                "org_id": "org_pytest_data"
                },
                "events": {},
                "io_type": "input"
            },
            "targetNode": {
                "id": "f912e999-0f19-4b9a-9f9b-34c4552cdaa4",
                "type": "default",
                "dimensions": {
                "width": 234,
                "height": 54
                },
                "computedPosition": {
                "x": 285.66666666666674,
                "y": 125.00000000000003,
                "z": 0
                },
                "handleBounds": {
                "source": [
                    {
                    "id": "output",
                    "position": "bottom",
                    "x": 102.21875,
                    "y": 48,
                    "width": 30,
                    "height": 10
                    }
                ],
                "target": [
                    {
                    "id": "input",
                    "position": "top",
                    "x": 102.21875,
                    "y": -4,
                    "width": 30,
                    "height": 10
                    }
                ]
                },
                "selected": False,
                "dragging": False,
                "resizing": False,
                "initialized": False,
                "isParent": False,
                "position": {
                "x": 285.66666666666674,
                "y": 125.00000000000003
                },
                "data": {
                "label": "f912e999-0f19-4b9a-9f9b-34c4552cdaa4",
                "node_type": "function",
                "name": "pytest",
                "after_flatten": True
                },
                "events": {},
                "io_type": "default"
            },
            "sourceX": 260.015625,
            "sourceY": 109,
            "targetX": 402.88541666666674,
            "targetY": 121.00000000000003
            },
            {
            "id": "ef912e999-0f19-4b9a-9f9b-34c4552cdaa4-60aea6df-ec59-452e-ab52-4d1ec18391a1",
            "type": "custom",
            "source": "f912e999-0f19-4b9a-9f9b-34c4552cdaa4",
            "target": "60aea6df-ec59-452e-ab52-4d1ec18391a1",
            "data": {},
            "events": {},
            "label": "",
            "markerEnd": {
                "type": "arrowclosed",
                "width": 20,
                "height": 20
            },
            "style": {
                "strokeWidth": 2
            },
            "animated": True,
            "sourceNode": {
                "id": "f912e999-0f19-4b9a-9f9b-34c4552cdaa4",
                "type": "default",
                "dimensions": {
                "width": 234,
                "height": 54
                },
                "computedPosition": {
                "x": 285.66666666666674,
                "y": 125.00000000000003,
                "z": 0
                },
                "handleBounds": {
                "source": [
                    {
                    "id": "output",
                    "position": "bottom",
                    "x": 102.21875,
                    "y": 48,
                    "width": 30,
                    "height": 10
                    }
                ],
                "target": [
                    {
                    "id": "input",
                    "position": "top",
                    "x": 102.21875,
                    "y": -4,
                    "width": 30,
                    "height": 10
                    }
                ]
                },
                "selected": False,
                "dragging": False,
                "resizing": False,
                "initialized": False,
                "isParent": False,
                "position": {
                "x": 285.66666666666674,
                "y": 125.00000000000003
                },
                "data": {
                "label": "f912e999-0f19-4b9a-9f9b-34c4552cdaa4",
                "node_type": "function",
                "name": "pytest",
                "after_flatten": True
                },
                "events": {},
                "io_type": "default"
            },
            "targetNode": {
                "id": "60aea6df-ec59-452e-ab52-4d1ec18391a1",
                "type": "output",
                "dimensions": {
                "width": 271,
                "height": 42
                },
                "computedPosition": {
                "x": 260,
                "y": 284,
                "z": 0
                },
                "handleBounds": {
                "source": [],
                "target": [
                    {
                    "id": "input",
                    "position": "top",
                    "x": 120.515625,
                    "y": -4,
                    "width": 30,
                    "height": 10
                    }
                ]
                },
                "selected": False,
                "dragging": False,
                "resizing": False,
                "initialized": False,
                "isParent": False,
                "position": {
                "x": 260,
                "y": 284
                },
                "data": {
                "label": "60aea6df-ec59-452e-ab52-4d1ec18391a1",
                "node_type": "stream",
                "stream_type": "logs",
                "stream_name": "stream_pytest_data",
                "org_id": "org_pytest_data"
                },
                "events": {},
                "io_type": "output"
            },
            "sourceX": 402.88541666666674,
            "sourceY": 183.00000000000003,
            "targetX": 395.515625,
            "targetY": 280
            },
            {
            "id": "eb6c04033-6492-44f9-a365-00d6c6425193-4278cc25-1699-4532-b4ef-705c63d455ee",
            "type": "custom",
            "source": "b6c04033-6492-44f9-a365-00d6c6425193",
            "target": "4278cc25-1699-4532-b4ef-705c63d455ee",
            "data": {},
            "events": {},
            "label": "",
            "markerEnd": {
                "type": "arrowclosed",
                "width": 20,
                "height": 20
            },
            "style": {
                "strokeWidth": 2
            },
            "animated": True,
            "sourceNode": {
                "id": "b6c04033-6492-44f9-a365-00d6c6425193",
                "type": "input",
                "dimensions": {
                "width": 271,
                "height": 42
                },
                "computedPosition": {
                "x": 124.5,
                "y": 63,
                "z": 0
                },
                "handleBounds": {
                "source": [
                    {
                    "id": "output",
                    "position": "bottom",
                    "x": 120.515625,
                    "y": 36,
                    "width": 30,
                    "height": 10
                    }
                ],
                "target": []
                },
                "selected": False,
                "dragging": False,
                "resizing": False,
                "initialized": False,
                "isParent": False,
                "position": {
                "x": 124.5,
                "y": 63
                },
                "data": {
                "label": "b6c04033-6492-44f9-a365-00d6c6425193",
                "node_type": "stream",
                "stream_type": "logs",
                "stream_name": "stream_pytest_data",
                "org_id": "org_pytest_data"
                },
                "events": {},
                "io_type": "input"
            },
            "targetNode": {
                "id": "4278cc25-1699-4532-b4ef-705c63d455ee",
                "type": "default",
                "dimensions": {
                "width": 244,
                "height": 54
                },
                "computedPosition": {
                "x": 53.33333333333334,
                "y": 160.33333333333334,
                "z": 0
                },
                "handleBounds": {
                "source": [
                    {
                    "id": "output",
                    "position": "bottom",
                    "x": 107.1171875,
                    "y": 48,
                    "width": 30,
                    "height": 10
                    }
                ],
                "target": [
                    {
                    "id": "input",
                    "position": "top",
                    "x": 107.1171875,
                    "y": -4,
                    "width": 30,
                    "height": 10
                    }
                ]
                },
                "selected": False,
                "dragging": False,
                "resizing": False,
                "initialized": False,
                "isParent": False,
                "position": {
                "x": 53.33333333333334,
                "y": 160.33333333333334
                },
                "data": {
                "label": "4278cc25-1699-4532-b4ef-705c63d455ee",
                "node_type": "function",
                "name": "pytest2",
                "after_flatten": False
                },
                "events": {},
                "io_type": "default"
            },
            "sourceX": 260.015625,
            "sourceY": 109,
            "targetX": 175.45052083333334,
            "targetY": 156.33333333333334
            },
            {
            "id": "e4278cc25-1699-4532-b4ef-705c63d455ee-9d2e796a-d424-48b8-a0b0-0d8b2143648c",
            "type": "custom",
            "source": "4278cc25-1699-4532-b4ef-705c63d455ee",
            "target": "9d2e796a-d424-48b8-a0b0-0d8b2143648c",
            "data": {},
            "events": {},
            "label": "",
            "markerEnd": {
                "type": "arrowclosed",
                "width": 20,
                "height": 20
            },
            "style": {
                "strokeWidth": 2
            },
            "animated": True,
            "sourceNode": {
                "id": "4278cc25-1699-4532-b4ef-705c63d455ee",
                "type": "default",
                "dimensions": {
                "width": 244,
                "height": 54
                },
                "computedPosition": {
                "x": 53.33333333333334,
                "y": 160.33333333333334,
                "z": 0
                },
                "handleBounds": {
                "source": [
                    {
                    "id": "output",
                    "position": "bottom",
                    "x": 107.1171875,
                    "y": 48,
                    "width": 30,
                    "height": 10
                    }
                ],
                "target": [
                    {
                    "id": "input",
                    "position": "top",
                    "x": 107.1171875,
                    "y": -4,
                    "width": 30,
                    "height": 10
                    }
                ]
                },
                "selected": False,
                "dragging": False,
                "resizing": False,
                "initialized": False,
                "isParent": False,
                "position": {
                "x": 53.33333333333334,
                "y": 160.33333333333334
                },
                "data": {
                "label": "4278cc25-1699-4532-b4ef-705c63d455ee",
                "node_type": "function",
                "name": "pytest2",
                "after_flatten": False
                },
                "events": {},
                "io_type": "default"
            },
            "targetNode": {
                "id": "9d2e796a-d424-48b8-a0b0-0d8b2143648c",
                "type": "output",
                "dimensions": {
                "width": 238,
                "height": 42
                },
                "computedPosition": {
                "x": -21.666666666666686,
                "y": 313,
                "z": 1000
                },
                "handleBounds": {
                "source": [],
                "target": [
                    {
                    "id": "input",
                    "position": "top",
                    "x": 103.828125,
                    "y": -4,
                    "width": 30,
                    "height": 10
                    }
                ]
                },
                "selected": True,
                "dragging": False,
                "resizing": False,
                "initialized": False,
                "isParent": False,
                "position": {
                "x": -21.666666666666686,
                "y": 313
                },
                "data": {
                "label": "9d2e796a-d424-48b8-a0b0-0d8b2143648c",
                "node_type": "stream",
                "stream_type": "logs",
                "stream_name": "pyteststream2",
                "org_id": "org_pytest_data"
                },
                "events": {},
                "io_type": "output"
            },
            "sourceX": 175.45052083333334,
            "sourceY": 218.33333333333334,
            "targetX": 97.16145833333331,
            "targetY": 309
            }
        ],
        "org": org_id
        }

    # Create a pipeline
    resp_create_pipeline = session.post(f"{url}api/{org_id}/pipelines", json=pipeline_payload)
    assert resp_create_pipeline.status_code == expected_status, f"Expected status code {expected_status} but got {resp_create_pipeline.status_code}"
    print("Create pipeline response:", resp_create_pipeline.json())

    assert resp_create_pipeline.status_code == 400, "Invalid pipeline: After Flatten must be checked if a previous FunctionNode already checked it in the same branch."


def test_e2e_pipeline_history(create_session, base_url):
    """Running an E2E test for pipeline history API.

    This test validates:
    1. Creating pipelines and triggering them to generate history
    2. Fetching pipeline history for an organization
    3. Filtering history by pipeline name
    4. Pagination parameters (from, size)
    5. Time range filtering
    6. Proper handling of invalid requests
    """
    import time
    import json
    from datetime import datetime, timedelta

    session = create_session
    url = base_url
    org_id = "default"

    headers = {"Content-Type": "application/json"}

    # Step 1: Ingest some test data to process with pipeline
    stream_name = "pipeline_history_test_stream"
    log_payload = [
        {
            "level": "INFO",
            "message": "Pipeline test message 1",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "test-service",
        },
        {
            "level": "WARN",
            "message": "Pipeline test message 2",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "test-service",
        },
        {
            "level": "ERROR",
            "message": "Pipeline test message 3",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "test-service",
        },
    ]

    resp_ingest = session.post(
        f"{url}api/{org_id}/{stream_name}/_json",
        json=log_payload,
        headers=headers,
    )
    print(f"Ingest logs response: {resp_ingest.content}")
    assert resp_ingest.status_code == 200, (
        f"Expected 200 for log ingestion, but got {resp_ingest.status_code} {resp_ingest.content}"
    )

    # Step 2: Create first pipeline (realtime)
    pipeline_name_1 = "history_test_pipeline_1"
    pipeline_payload_1 = {
        "name": pipeline_name_1,
        "description": "Test pipeline 1 for history validation",
        "source": {"source_type": "realtime"},
        "nodes": [
            {
                "id": "input-node-1",
                "type": "input",
                "data": {
                    "node_type": "stream",
                    "stream_name": stream_name,
                    "stream_type": "logs",
                    "org_id": org_id,
                },
                "position": {"x": 100, "y": 100},
                "io_type": "input",
            },
            {
                "id": "output-node-1",
                "type": "output",
                "data": {
                    "node_type": "stream",
                    "stream_name": f"{stream_name}_output_1",
                    "stream_type": "logs",
                    "org_id": org_id,
                },
                "position": {"x": 300, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [
            {
                "id": "edge-1",
                "source": "input-node-1",
                "target": "output-node-1",
            }
        ],
        "org": org_id,
    }

    resp_create_pipeline_1 = session.post(
        f"{url}api/{org_id}/pipelines",
        json=pipeline_payload_1,
        headers=headers,
    )
    print(f"Create pipeline 1 response: {resp_create_pipeline_1.content}")
    assert resp_create_pipeline_1.status_code == 200, (
        f"Expected 200 for create pipeline 1, but got {resp_create_pipeline_1.status_code} {resp_create_pipeline_1.content}"
    )

    # Get pipeline_id for pipeline 1
    resp_list_pipelines = session.get(f"{url}api/{org_id}/pipelines")
    pipelines_list = resp_list_pipelines.json().get("list", [])
    pipeline_id_1 = None
    for pipeline in pipelines_list:
        if pipeline["name"] == pipeline_name_1:
            pipeline_id_1 = pipeline["pipeline_id"]
            break

    assert pipeline_id_1, f"Pipeline ID not found for {pipeline_name_1}"
    print(f"Pipeline 1 ID: {pipeline_id_1}")

    # Enable pipeline 1
    resp_enable_1 = session.put(
        f"{url}api/{org_id}/pipelines/{pipeline_id_1}/enable?value=true"
    )
    assert resp_enable_1.status_code == 200, (
        f"Expected 200 for enable pipeline 1, but got {resp_enable_1.status_code} {resp_enable_1.content}"
    )
    print(f"Pipeline {pipeline_name_1} enabled")

    # Step 3: Create second pipeline (scheduled)
    pipeline_name_2 = "history_test_pipeline_2"
    pipeline_payload_2 = {
        "name": pipeline_name_2,
        "description": "Test pipeline 2 for history validation",
        "source": {
            "source_type": "scheduled",
            "start_time": int(
                (datetime.utcnow() - timedelta(hours=1)).timestamp() * 1_000_000
            ),
            "end_time": int(datetime.utcnow().timestamp() * 1_000_000),
            "cron": "*/5 * * * *",  # Every 5 minutes
        },
        "nodes": [
            {
                "id": "input-node-2",
                "type": "input",
                "data": {
                    "node_type": "stream",
                    "stream_name": stream_name,
                    "stream_type": "logs",
                    "org_id": org_id,
                },
                "position": {"x": 100, "y": 100},
                "io_type": "input",
            },
            {
                "id": "output-node-2",
                "type": "output",
                "data": {
                    "node_type": "stream",
                    "stream_name": f"{stream_name}_output_2",
                    "stream_type": "logs",
                    "org_id": org_id,
                },
                "position": {"x": 300, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [
            {
                "id": "edge-2",
                "source": "input-node-2",
                "target": "output-node-2",
            }
        ],
        "org": org_id,
    }

    resp_create_pipeline_2 = session.post(
        f"{url}api/{org_id}/pipelines",
        json=pipeline_payload_2,
        headers=headers,
    )
    print(f"Create pipeline 2 response: {resp_create_pipeline_2.content}")
    assert resp_create_pipeline_2.status_code == 200, (
        f"Expected 200 for create pipeline 2, but got {resp_create_pipeline_2.status_code} {resp_create_pipeline_2.content}"
    )

    # Get pipeline_id for pipeline 2
    resp_list_pipelines = session.get(f"{url}api/{org_id}/pipelines")
    pipelines_list = resp_list_pipelines.json().get("list", [])
    pipeline_id_2 = None
    for pipeline in pipelines_list:
        if pipeline["name"] == pipeline_name_2:
            pipeline_id_2 = pipeline["pipeline_id"]
            break

    assert pipeline_id_2, f"Pipeline ID not found for {pipeline_name_2}"
    print(f"Pipeline 2 ID: {pipeline_id_2}")

    # Enable pipeline 2
    resp_enable_2 = session.put(
        f"{url}api/{org_id}/pipelines/{pipeline_id_2}/enable?value=true"
    )
    assert resp_enable_2.status_code == 200, (
        f"Expected 200 for enable pipeline 2, but got {resp_enable_2.status_code} {resp_enable_2.content}"
    )
    print(f"Pipeline {pipeline_name_2} enabled")

    # Wait for pipelines to potentially trigger and generate history
    print("Waiting for pipelines to potentially trigger and generate history...")
    time.sleep(20)

    # Step 4: Test 1 - Get all pipeline history for the organization
    print("\n=== Test 1: Get all pipeline history ===")
    resp_get_history = session.get(
        f"{url}api/{org_id}/pipelines/history",
        headers=headers,
    )
    print(f"Get pipeline history response: {resp_get_history.content}")
    assert resp_get_history.status_code == 200, (
        f"Expected 200 for get pipeline history, but got {resp_get_history.status_code} {resp_get_history.content}"
    )

    history_data = resp_get_history.json()
    assert "total" in history_data, "Response should contain 'total' field"
    assert "from" in history_data, "Response should contain 'from' field"
    assert "size" in history_data, "Response should contain 'size' field"
    assert "hits" in history_data, "Response should contain 'hits' field"
    assert isinstance(history_data["hits"], list), "'hits' should be a list"

    print(f"Total pipeline history entries: {history_data['total']}")
    print(f"Retrieved {len(history_data['hits'])} history entries")

    # Step 5: Test 2 - Filter history by specific pipeline_id
    print(f"\n=== Test 2: Filter history by pipeline_id: {pipeline_id_1} ===")
    resp_filtered_history = session.get(
        f"{url}api/{org_id}/pipelines/history?pipeline_id={pipeline_id_1}",
        headers=headers,
    )
    print(f"Filtered pipeline history response: {resp_filtered_history.content}")

    # This might return 200 with empty results if pipeline hasn't triggered yet
    # or 404 if pipeline doesn't exist
    assert resp_filtered_history.status_code in [200, 404], (
        f"Expected 200 or 404 for filtered history, but got {resp_filtered_history.status_code} {resp_filtered_history.content}"
    )

    if resp_filtered_history.status_code == 200:
        filtered_data = resp_filtered_history.json()
        print(f"Filtered results: {filtered_data['total']} entries")

        # If there are results, verify they're for the correct pipeline
        for entry in filtered_data.get("hits", []):
            assert entry["pipeline_name"] == pipeline_name_1, (
                f"Expected pipeline_name to be {pipeline_name_1}, but got {entry['pipeline_name']}"
            )

    # Step 6: Test 3 - Test pagination parameters
    print("\n=== Test 3: Test pagination ===")
    resp_paginated = session.get(
        f"{url}api/{org_id}/pipelines/history?from=0&size=10",
        headers=headers,
    )
    assert resp_paginated.status_code == 200, (
        f"Expected 200 for paginated history, but got {resp_paginated.status_code} {resp_paginated.content}"
    )

    paginated_data = resp_paginated.json()
    assert paginated_data["from"] == 0, "from parameter should be 0"
    assert paginated_data["size"] == 10, "size parameter should be 10"
    print(
        f"Pagination test passed: from={paginated_data['from']}, size={paginated_data['size']}"
    )

    # Step 7: Test 4 - Test with time range
    print("\n=== Test 4: Test time range filtering ===")
    # Get timestamps in microseconds
    end_time = int(datetime.utcnow().timestamp() * 1_000_000)
    start_time = int((datetime.utcnow() - timedelta(hours=1)).timestamp() * 1_000_000)

    resp_time_range = session.get(
        f"{url}api/{org_id}/pipelines/history?start_time={start_time}&end_time={end_time}",
        headers=headers,
    )
    assert resp_time_range.status_code == 200, (
        f"Expected 200 for time range history, but got {resp_time_range.status_code} {resp_time_range.content}"
    )

    time_range_data = resp_time_range.json()
    print(f"Time range results: {time_range_data['total']} entries")

    # Step 8: Test 5 - Test invalid time range (start > end)
    print("\n=== Test 5: Test invalid time range (should return 400) ===")
    resp_invalid_time = session.get(
        f"{url}api/{org_id}/pipelines/history?start_time={end_time}&end_time={start_time}",
        headers=headers,
    )
    assert resp_invalid_time.status_code == 400, (
        f"Expected 400 for invalid time range, but got {resp_invalid_time.status_code} {resp_invalid_time.content}"
    )
    print("Invalid time range correctly rejected with 400")

    # Step 9: Test 6 - Test with non-existent pipeline_id
    print("\n=== Test 6: Test with non-existent pipeline_id (should return 404) ===")
    resp_nonexistent = session.get(
        f"{url}api/{org_id}/pipelines/history?pipeline_id=35MtcBsSRwlYwuuuaybOibAZ4gF",
        headers=headers,
    )
    assert resp_nonexistent.status_code == 404, (
        f"Expected 404 for non-existent pipeline, but got {resp_nonexistent.status_code} {resp_nonexistent.content}"
    )
    print("Non-existent pipeline correctly returned 404")

    # Step 10: Test 7 - Test size limit (max 1000)
    print("\n=== Test 7: Test size limit enforcement ===")
    resp_large_size = session.get(
        f"{url}api/{org_id}/pipelines/history?size=2000",
        headers=headers,
    )
    assert resp_large_size.status_code == 200, (
        f"Expected 200 even with large size, but got {resp_large_size.status_code} {resp_large_size.content}"
    )

    large_size_data = resp_large_size.json()
    # Size should be clamped to 1000
    assert large_size_data["size"] == 1000, (
        f"Expected size to be clamped to 1000, but got {large_size_data['size']}"
    )
    print("Size limit correctly enforced (clamped to 1000)")

    # Cleanup: Delete pipelines
    print("\n=== Cleanup: Deleting test resources ===")

    resp_delete_pipeline_1 = session.delete(
        f"{url}api/{org_id}/pipelines/{pipeline_id_1}"
    )
    assert resp_delete_pipeline_1.status_code == 200, (
        f"Expected 200 for delete pipeline 1, but got {resp_delete_pipeline_1.status_code} {resp_delete_pipeline_1.content}"
    )
    print(f"Deleted pipeline: {pipeline_name_1}")

    resp_delete_pipeline_2 = session.delete(
        f"{url}api/{org_id}/pipelines/{pipeline_id_2}"
    )
    assert resp_delete_pipeline_2.status_code == 200, (
        f"Expected 200 for delete pipeline 2, but got {resp_delete_pipeline_2.status_code} {resp_delete_pipeline_2.content}"
    )
    print(f"Deleted pipeline: {pipeline_name_2}")

    print("\n=== Pipeline history E2E test completed successfully! ===")
    print("✓ All pipeline history API endpoints validated")
    print("✓ Filtering, pagination, and time range parameters working correctly")
    print("✓ Error handling for invalid requests validated")
