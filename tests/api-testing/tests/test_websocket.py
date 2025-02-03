

def test_websocket_enable(create_session, base_url):
    """Running an E2E test for websocket enable."""

    session = create_session
    url = base_url
    org_id = "default"
    payload_websocket = {
        "scrape_interval":16,
        "span_id_field_name":"span_id",
        "trace_id_field_name":"trace_id",
        "toggle_ingestion_logs":True,
        "enable_websocket_search":True
        }

    resp_websocket = session.post(f"{url}api/{org_id}/settings", json=payload_websocket)

    print(resp_websocket.content)
    assert (
        resp_websocket.status_code == 200
    ), f"Websocket enable 200, but got {resp_websocket.status_code} {resp_websocket.content}"
    
