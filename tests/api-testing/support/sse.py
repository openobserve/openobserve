"""Server-Sent Events (SSE) response parser for OO's `/_search_stream` and
`/_values_stream` endpoints.

OO returns SSE-formatted responses for streaming queries:
    event: search_response_metadata
    data: {"results": {"total": N, ...}}

    event: search_response_hits
    data: {"hits": [...]}

The endpoint may emit MULTIPLE metadata + hits frames per response (one
per partition for aggregations, etc.). This helper merges them into a
single `{"results": {"total": int, "hits": [...]}}` dict that callers
can treat uniformly.

Replaces the `read_response()` function previously inlined in
test_streaming.py.
"""
from __future__ import annotations

import json
import logging
from typing import Any

import requests

logger = logging.getLogger(__name__)


def read_sse_response(response: requests.Response) -> dict[str, Any]:
    """Parse an SSE-streamed response into one merged `{results: {total, hits}}` dict.

    Multiple metadata frames: we pick the MAX total (for aggregation queries,
    each partition reports a partial; max is the right global). Hits are
    concatenated across all hits frames.

    Returns `{"results": {"total": 0, "hits": []}}` if no valid frames found.
    """
    content = response.content.decode("utf-8")
    lines = content.split("\n")
    metadata_frames: list[dict[str, Any]] = []
    hits_frames: list[dict[str, Any]] = []

    for i, line in enumerate(lines):
        text = line.strip()

        if text.startswith("event: search_response_metadata"):
            if i + 1 < len(lines):
                data_line = lines[i + 1].strip()
                if data_line.startswith("data: "):
                    try:
                        metadata_frames.append(json.loads(data_line[6:]))
                    except json.JSONDecodeError as e:
                        logger.debug("SSE metadata frame parse error: %s", e)

        elif text.startswith("event: search_response_hits"):
            if i + 1 < len(lines):
                data_line = lines[i + 1].strip()
                if data_line.startswith("data: "):
                    try:
                        hits_frames.append(json.loads(data_line[6:]))
                    except json.JSONDecodeError as e:
                        logger.debug("SSE hits frame parse error: %s", e)

    if not metadata_frames:
        logger.debug("read_sse_response: no metadata frames found")
        return {"results": {"total": 0, "hits": []}}

    # Concatenate all hits across hits frames
    all_hits: list[dict[str, Any]] = []
    for frame in hits_frames:
        if "hits" in frame and isinstance(frame["hits"], list):
            all_hits.extend(frame["hits"])

    # Determine combined total. For single-frame responses use the reported
    # total directly. For multi-frame, pick the MAX (each partition reports
    # its partial; for aggregation queries the max is the global total).
    combined = metadata_frames[0].copy()
    if len(metadata_frames) == 1:
        total = metadata_frames[0].get("results", {}).get("total", len(all_hits))
    else:
        totals = [
            f.get("results", {}).get("total", 0) for f in metadata_frames
        ]
        total = max(totals) if any(t for t in totals) else len(all_hits)

    combined.setdefault("results", {})
    combined["results"]["total"] = total
    combined["results"]["hits"] = all_hits
    return combined
