import requests
import pytest


@pytest.mark.skip(reason="no way of currently testing this")
def test_e2e_ingestkineses(create_session, base_url):
    """Running an E2E ingest data using valid access key"""

    session = create_session
    url = base_url
    org_id = "e2e"
    access_key = "cm9vdEBhbHBoYTEuY29tOlgxT1JaSFNlckhJdDhjTEI="
    headers = {
        "X-Amz-Firehose-Access-Key": access_key,
        "Content-Type": "application/json",
    }
    payload = {
        "records": [
            {
                "data": "H4sICE6PQmUAA2YxLmpzb24ARY/NCsIwEITvPsWSs0g9+NPeRFovVcEWPIhIbNcm2CYlSS0ivrtprPWykPmGycxrBEAq1JoWmD5rJAGQ9X6XHvbxZRsmyWoTknHnka1A5Wgpm7ylJmOxLPQXlrLYKNnUHR+UxCik1V/SzVVniteGSxHx0qDSFp7OP3/4QGGcZAWAl7sW8XzIcG/DbV9Dq+636dxfLufebOF7njc4+j2u7TGGfg/0ewJYM8zuXBTAkJaGgbxBbiO5oF03iLhCJjVOiAt823sevT+zyFHsKgEAAA=="
            }
        ],
        "requestId": "9ec6b6f8-8b93-4734-8521-3e78a9517f5f",
        "timestamp": 1698860579000,
    }

    resp_ingestkineses = session.post(
        f"{url}aws/default/default/_kinesis_firehose", json=payload, headers=headers
    )

    print(resp_ingestkineses.content)
    assert (
        resp_ingestkineses.status_code == 200
    ), f"Creating a user 200, but got {resp_ingestkineses.status_code} {resp_ingestkineses.content}"


@pytest.mark.skip(reason="no way of currently testing this")
def test_e2e_invalidingestkineses(create_session, base_url):
    """Running an E2E test for incorrect access key while data ingestion."""

    session = create_session
    url = base_url
    org_id = "e2e"
    access_key = "cm9vdEBhbHBoYTEuY29tOlgxT1JaSFNlckh"
    headers = {
        "X-Amz-Firehose-Access-Key": access_key,
        "Content-Type": "application/json",
    }
    payload = {
        "records": [
            {
                "data": "H4sICE6PQmUAA2YxLmpzb24ARY/NCsIwEITvPsWSs0g9+NPeRFovVcEWPIhIbNcm2CYlSS0ivrtprPWykPmGycxrBEAq1JoWmD5rJAGQ9X6XHvbxZRsmyWoTknHnka1A5Wgpm7ylJmOxLPQXlrLYKNnUHR+UxCik1V/SzVVniteGSxHx0qDSFp7OP3/4QGGcZAWAl7sW8XzIcG/DbV9Dq+636dxfLufebOF7njc4+j2u7TGGfg/0ewJYM8zuXBTAkJaGgbxBbiO5oF03iLhCJjVOiAt823sevT+zyFHsKgEAAA=="
            }
        ],
        "requestId": "9ec6b6f8-8b93-4734-8521-3e78a9517f5f",
        "timestamp": 1698860579000,
    }

    resp_ingestkineses = session.post(
        f"{url}aws/default/default/_kinesis_firehose", json=payload, headers=headers
    )

    print(resp_ingestkineses.content)
    assert (
        resp_ingestkineses.status_code == 401
    ), f"Creating a user 200, but got {resp_ingestkineses.status_code} {resp_ingestkineses.content}"


@pytest.mark.skip(reason="no way of currently testing this")
def test_e2e_incorrertdatakineses(create_session, base_url):
    """Running an E2E test for missing request id in response."""

    session = create_session
    url = base_url
    org_id = "e2e"
    access_key = "cm9vdEBhbHBoYTEuY29tOlgxT1JaSFNlckhJdDhjTEI="
    headers = {
        "X-Amz-Firehose-Access-Key": access_key,
        "Content-Type": "application/json",
    }
    payload = {
        "records": [
            {
                "data": "H4sICE6PQmUAA2YxLmpzb24ARY/NCsIwEITvPsWSs0g9+NPeRFovVcEWPIhIbNcm2CYlSS0ivrtprPWykPmGycxrBEAq1JoWmD5rJAGQ9X6XHvbxZRsmyWoTknHnka1A5Wgpm7ylJmOxLPQXlrLYKNnUHR+UxCik1V/SzVVniteGSxHx0qDSFp7OP3/4QGGcZAWAl7sW8XzIcG/DbV9Dq+636dxfLufebOF7njc4+j2u7TGGfg/0ewJYM8zuXBTAkJaGgbxBbiO5oF03iLhCJjVOiAt823sevT+zyFHsKgEAAA=="
            }
        ],
    }

    resp_ingestkineses = session.post(
        f"{url}aws/default/default/_kinesis_firehose", json=payload, headers=headers
    )

    print(resp_ingestkineses.content)
    assert (
        resp_ingestkineses.status_code == 400
    ), f"Missing requestID 200 , but got {resp_ingestkineses.status_code} {resp_ingestkineses.content}"
