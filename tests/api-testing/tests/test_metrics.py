import pytest


@pytest.fixture
def sample_payload():
    return [
        {
            "__name__": "cpu",
            "__type__": "gauge",
            "namespace": "ziox",
            "container": "zo1",
            "_timestamp": 1691643770347,
            "value": 1.31,
        },
        {
            "__name__": "cpu",
            "__type__": "gauge",
            "namespace": "ziox",
            "container": "zo1",
            "_timestamp": 1691643770347,
            "value": 1.41,
        },
    ]


def test_e2e_metrics_ingest_validjson(create_session, base_url, sample_payload):
    """Running an E2E test for missing request id in response."""

    session = create_session
    url = base_url
    org_id = "default"

    resp_ingestmetrics = session.post(
        f"{url}api/{org_id}/ingest/metrics/_json", json=sample_payload
    )

    print(resp_ingestmetrics.content)
    assert (
        resp_ingestmetrics.status_code == 200
    ), f"valid json upload 200 , but got {resp_ingestmetrics.status_code} {resp_ingestmetrics.content}"


def test_e2e_metrics_ingest_invalijson(create_session, base_url):
    """Running an E2E test for missing request id in response."""

    session = create_session
    url = base_url
    org_id = "default"

    payload = [
        {
            "__name__": "cpu",
            "__type__": "gauge",
            "namespace": "ziox",
            "container": "zo1",
            "_timestamp": 1691643770347,
            "value": 1.31,
        },
        {},
    ]

    resp_ingestmetrics = session.post(
        f"{url}api/{org_id}/ingest/metrics/_json", json=payload
    )

    print(resp_ingestmetrics.content)
    assert (
        resp_ingestmetrics.status_code == 400
    ), f"Invalid json upload 400, but got {resp_ingestmetrics.status_code} {resp_ingestmetrics.content}"


# def test_e2e_metrics_query(create_session, base_url):
#     """Running an E2E test for metrics query."""

#     session = create_session
#     url = base_url
#     org_id = "default"
#     access_key = "ZTJlLnRlc3RpbmdAZXhhbXBsZS5jb206NnJCWGlWNmQxMmJ4SGdHdQ=="
#     headers = {
#         "Authorization": f"Basic {access_key}",
#         "Content-Type": "application/json"
#     }

#     resp_metricsquery = session.get(f"{base_url}api/e2e/prometheus/api/v1/format_query?query=%7B__name__%3D%22prometheus_tsdb_tombstone_cleanup_seconds_count%22%7D", headers=headers)

#     print(resp_metricsquery.content)
#     assert resp_metricsquery.status_code == 200, f"valid query upload 200, but got {resp_metricsquery.status_code} {resp_metricsquery.content}"


def test_e2e_metrics_invalidquery(create_session, base_url):
    """Running an E2E test for metrics query."""

    session = create_session
    org_id = "default"

    resp_metricsquery = session.get(
        f"{base_url}api/{org_id}/prometheus/api/v1/format_query?query=%7B__name__%3D%22%22%7D"
    )

    print(resp_metricsquery.content)
    assert (
        resp_metricsquery.status_code == 400
    ), f"Invalid query upload 400, but got {resp_metricsquery.status_code} {resp_metricsquery.content}"


def test_e2e_metrics_query(create_session, base_url):
    """Running an E2E test for metrics query."""

    session = create_session
    org_id = "default"

    resp_metricsquery = session.get(
        f"{base_url}api/{org_id}/prometheus/api/v1/format_query?query=%7B__name__%3D%22prometheus_tsdb_tombstone_cleanup_seconds_count%22%7D"
    )

    print(resp_metricsquery.content)
    assert (
        resp_metricsquery.status_code == 200
    ), f"valid query upload 200, but got {resp_metricsquery.status_code} {resp_metricsquery.content}"
