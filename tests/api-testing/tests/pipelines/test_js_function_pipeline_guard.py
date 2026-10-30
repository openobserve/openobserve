"""API regression tests: a function a pipeline uses cannot be switched to JavaScript."""

import uuid

import pytest

ORG_ID = "default"
VRL_BODY = ".a = 1"
JS_BODY = "row.a = 1;"


@pytest.fixture
def vrl_function(create_session, base_url):
    """A VRL function, deleted again once the test is done."""
    name = f"jsguard_{uuid.uuid4().hex[:8]}"
    resp = create_session.post(
        f"{base_url}api/{ORG_ID}/functions",
        json={"name": name, "function": VRL_BODY, "params": "row", "transType": 0},
    )
    assert resp.status_code == 200, f"could not create function: {resp.status_code} {resp.text[:200]}"
    yield name
    create_session.delete(f"{base_url}api/{ORG_ID}/functions/{name}")


def _create_pipeline(session, base_url, func_name):
    """A realtime pipeline whose only transform is `func_name`; returns its id."""
    stream = f"jsguard_src_{uuid.uuid4().hex[:8]}"
    input_id, function_id, output_id = (str(uuid.uuid4()) for _ in range(3))
    payload = {
        "name": f"{func_name}_pl",
        "description": "",
        "source": {"source_type": "realtime"},
        "org": ORG_ID,
        "nodes": [
            {
                "id": input_id,
                "type": "input",
                "data": {
                    "node_type": "stream",
                    "stream_name": stream,
                    "stream_type": "logs",
                    "org_id": ORG_ID,
                },
                "position": {"x": 100, "y": 100},
                "io_type": "input",
            },
            {
                "id": function_id,
                "type": "default",
                "data": {
                    "node_type": "function",
                    "name": func_name,
                    "after_flatten": False,
                },
                "position": {"x": 300, "y": 100},
                "io_type": "default",
            },
            {
                "id": output_id,
                "type": "output",
                "data": {
                    "node_type": "stream",
                    "stream_name": f"{stream}_out",
                    "stream_type": "logs",
                    "org_id": ORG_ID,
                },
                "position": {"x": 500, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [
            {"id": f"e{input_id}-{function_id}", "source": input_id, "target": function_id},
            {"id": f"e{function_id}-{output_id}", "source": function_id, "target": output_id},
        ],
    }
    resp = session.post(f"{base_url}api/{ORG_ID}/pipelines", json=payload)
    assert resp.status_code == 200, f"could not create pipeline: {resp.status_code} {resp.text[:300]}"
    listed = session.get(f"{base_url}api/{ORG_ID}/pipelines")
    assert listed.status_code == 200
    for pipeline in listed.json().get("list", []):
        if pipeline["name"] == payload["name"]:
            return pipeline["pipeline_id"]
    pytest.fail(f"pipeline {payload['name']} is missing from the list")


def test_js_switch_is_refused_while_a_pipeline_uses_the_function(create_session, base_url, vrl_function):
    pipeline_id = _create_pipeline(create_session, base_url, vrl_function)
    try:
        refused = create_session.put(
            f"{base_url}api/{ORG_ID}/functions/{vrl_function}",
            json={"name": vrl_function, "function": JS_BODY, "params": "row", "transType": 1},
        )
        assert refused.status_code == 400, f"expected 400, got {refused.status_code}: {refused.text[:300]}"
        assert "cannot become a JavaScript function" in refused.text
        assert f"{vrl_function}_pl" in refused.text

        listed = create_session.get(f"{base_url}api/{ORG_ID}/functions")
        stored = [f for f in listed.json()["list"] if f["name"] == vrl_function]
        assert stored, f"function {vrl_function} disappeared"
        assert stored[0].get("transType", 0) == 0, "the refused JavaScript body was stored anyway"
    finally:
        create_session.delete(f"{base_url}api/{ORG_ID}/pipelines/{pipeline_id}")


def test_vrl_update_is_allowed_while_a_pipeline_uses_the_function(create_session, base_url, vrl_function):
    pipeline_id = _create_pipeline(create_session, base_url, vrl_function)
    try:
        updated = create_session.put(
            f"{base_url}api/{ORG_ID}/functions/{vrl_function}",
            json={"name": vrl_function, "function": ".b = 2", "params": "row", "transType": 0},
        )
        assert updated.status_code == 200, f"expected 200, got {updated.status_code}: {updated.text[:300]}"
    finally:
        create_session.delete(f"{base_url}api/{ORG_ID}/pipelines/{pipeline_id}")


def test_js_switch_is_allowed_when_no_pipeline_uses_the_function(create_session, base_url, vrl_function):
    updated = create_session.put(
        f"{base_url}api/{ORG_ID}/functions/{vrl_function}",
        json={"name": vrl_function, "function": JS_BODY, "params": "row", "transType": 1},
    )
    assert updated.status_code == 200, f"expected 200, got {updated.status_code}: {updated.text[:300]}"
