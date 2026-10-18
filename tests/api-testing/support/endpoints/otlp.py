"""OTLP ingestion endpoint wrappers (/v1/logs, /v1/traces)."""
from __future__ import annotations

from typing import Any

import requests

CONTENT_TYPE_PROTO = "application/x-protobuf"
CONTENT_TYPE_JSON = "application/json"

# OO reads the target stream from this header; without it everything lands in `default`.
STREAM_HEADER = "stream-name"


class OtlpAPI:
    def __init__(self, client): self.c = client

    def _post_proto(
        self,
        path: str,
        payload: bytes,
        *,
        stream: str | None,
        org: str | None,
        content_type: str,
    ) -> requests.Response:
        headers = {"Content-Type": content_type}
        if stream is not None:
            headers[STREAM_HEADER] = stream
        return self.c.post(path, data=payload, headers=headers, org=org)

    def logs_protobuf(
        self,
        payload: bytes,
        *,
        stream: str | None = None,
        org: str | None = None,
        content_type: str = CONTENT_TYPE_PROTO,
    ) -> requests.Response:
        """POST a raw ExportLogsServiceRequest to /api/{org}/v1/logs."""
        return self._post_proto(
            "v1/logs", payload, stream=stream, org=org, content_type=content_type
        )

    def logs_json(
        self,
        body: dict[str, Any],
        *,
        stream: str | None = None,
        org: str | None = None,
    ) -> requests.Response:
        headers = {"Content-Type": CONTENT_TYPE_JSON}
        if stream is not None:
            headers[STREAM_HEADER] = stream
        return self.c.post("v1/logs", json=body, headers=headers, org=org)

    def traces_protobuf(
        self,
        payload: bytes,
        *,
        stream: str | None = None,
        org: str | None = None,
    ) -> requests.Response:
        return self._post_proto(
            "v1/traces", payload, stream=stream, org=org, content_type=CONTENT_TYPE_PROTO
        )
