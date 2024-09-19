def test_e2e_ingestlogs(create_session, base_url):
    """Running an E2E test logs ingestion."""

    session = create_session
    url = base_url
    org_id = "default"
    stream_name = "newpy-tests"
    payload = [
        {
            "Athlete": "newtemp",
            "City": "Athens",
            "Country": "HUN",
            "Discipline": "Swimming",
            "Sport": "Aquatics",
            "Year": 1896,
        },
        {
            "Athlete": "HERSCHMANN",
            "City": "Athens",
            "Country": "CHN",
            "Discipline": "Swimming",
            "Sport": "Aquatics",
            "Year": 1896,
        },
    ]

    resp_create_logstream = session.post(
        f"{url}api/{org_id}/{stream_name}/_json", json=payload
    )

    print(resp_create_logstream.content)
    assert (
        resp_create_logstream.status_code == 200
    ), f"Get all alerts list 200, but got {resp_create_logstream.status_code} {resp_create_logstream.content}"


def test_e2e_nostreamname(create_session, base_url):
    """Running an E2E test for adding logs without stream name."""

    session = create_session
    url = base_url
    org_id = "default"
    stream_name = ""
    payload = [
        {
            "Athlete": "newtemp",
            "City": "Athens",
            "Country": "HUN",
            "Discipline": "Swimming",
            "Sport": "Aquatics",
            "Year": 1896,
        },
        {
            "Athlete": "HERSCHMANN",
            "City": "Athens",
            "Country": "CHN",
            "Discipline": "Swimming",
            "Sport": "Aquatics",
            "Year": 1896,
        },
    ]

    resp_create_logstream = session.post(
        f"{url}api/{org_id}/{stream_name}/_json", json=payload
    )
    print(resp_create_logstream.content)
    assert (
        resp_create_logstream.status_code == 404
    ), f"Get all alerts list 200, but got {resp_create_logstream.status_code} {resp_create_logstream.content}"


def test_e2e_invalidstreamname(create_session, base_url):
    """Running an E2E test for adding invalid stream name."""

    session = create_session
    url = base_url
    org_id = "default"
    stream_name = "newpy#$#$#$#$2@2"
    payload = [
        {
            "Athlete": "newtemp",
            "City": "Athens",
            "Country": "HUN",
            "Discipline": "Swimming",
            "Sport": "Aquatics",
            "Year": 1896,
        },
        {
            "Athlete": "HERSCHMANN",
            "City": "Athens",
            "Country": "CHN",
            "Discipline": "Swimming",
            "Sport": "Aquatics",
            "Year": 1896,
        },
    ]
    resp_create_logstream = session.post(
        f"{url}api/{org_id}/{stream_name}/_json", json=payload
    )

    print(resp_create_logstream.content)
    assert (
        resp_create_logstream.status_code == 404
    ), f"Get all alerts list 200, but got {resp_create_logstream.status_code} {resp_create_logstream.content}"


def test_e2e_vrl(create_session, base_url):
    """Running an E2E test for search log query."""

    session = create_session
    org_id = "default"
    stream_name = "gke_fluentbit"
    access_key = "f="
    headers = {
        "Authorization": f"Basic {access_key}",
        "Content-Type": "application/json",
    }

    payload = [
        {
            "query": {
                "sql": f'select * from "{stream_name}" ',
                "start_time": 1700629279639000,
                "end_time": 1700630179639000,
                "from": 0,
                "size": 150,
                "query_fn": "LmEgPTEgCiAu",
            }
        }
    ]

    resp_get_allalerts = session.post(
        f"{base_url}web/logs?stream={stream_name}&period=15m&refresh=0&org_identifier={org_id}",
        json=payload,
        headers=headers,
    )

    print(resp_get_allalerts.content)
    assert (
        resp_get_allalerts.status_code == 200
    ), f"Get all alerts list 200, but got {resp_get_allalerts.status_code} {resp_get_allalerts.content}"


def test_e2e_getallstreams(create_session, base_url):
    """Running an E2E test for get all the streams list."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_allstreams = session.get(f"{url}api/{org_id}/streams")

    print(resp_get_allstreams.content)
    assert (
        resp_get_allstreams.status_code == 200
    ), f"Get all alerts list 200, but got {resp_get_allstreams.status_code} {resp_get_allstreams.content}"


def test_e2e_getschema(create_session, base_url):
    """Running an E2E test for get stream schema."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_streamschema = session.get(f"{url}api/{org_id}/streams/newpy_tests/schema")

    print(resp_get_streamschema.content)
    assert (
        resp_get_streamschema.status_code == 200
    ), f"Get all alerts list 200, but got {resp_get_streamschema.status_code} {resp_get_streamschema.content}"


def test_e2e_deleteinvalidstreams(create_session, base_url):
    """Running an E2E test for delete invalid stream."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_deletestreams = session.delete(f"{url}api/{org_id}/streams/invalidstream")

    print(resp_get_deletestreams.content)
    assert (
        resp_get_deletestreams.status_code == 404
    ), f"Get all alerts list 200, but got {resp_get_deletestreams.status_code} {resp_get_deletestreams.content}"


def test_e2e_incorrectstreamesettings(create_session, base_url):
    """Running an E2E test for invalid stream settings."""

    session = create_session
    url = base_url
    org_id = "default"
    resp_get_streamssettings = session.put(f"{url}api/{org_id}/streams/newpy_tests/settings")

    print(resp_get_streamssettings.content)
    assert (
        resp_get_streamssettings.status_code == 400
    ), f"Get all alerts list 200, but got {resp_get_streamssettings.status_code} {resp_get_streamssettings.content}"


def test_e2e_deletevalidstreams(create_session, base_url):
    """Running an E2E test for delete streams."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_get_allstreams = session.delete(f"{url}api/{org_id}/streams/newpy_tests")

    print(resp_get_allstreams.content)
    assert (
        resp_get_allstreams.status_code == 200
    ), f"Get all alerts list 200, but got {resp_get_allstreams.status_code} {resp_get_allstreams.content}"
