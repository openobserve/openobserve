"""
Histogram Bucket Count Regression (openobserve#13946)

The sum of histogram bucket counts exceeded count(*) over the same time
range (e.g. 2744 vs 2704). #12313 snapped the follower scan start_time DOWN
to the histogram bucket boundary to keep the first chart bucket fully
populated -- but that widened the actual scan window, so records in
[bucket_start, requested_start) (data the user explicitly excluded) got
counted into the first bucket, while a separate count(*) query (no
histogram_interval) scanned the exact requested range.

Fixed by #13969: the scan window sent to followers now equals the requested
range exactly, so buckets only count in-range records and
sum(buckets) == count(*) always holds (first bucket may be partial, which
is correct -- Elasticsearch/Kibana date_histogram semantics).

This test picks a start_time that deliberately does NOT align to the
histogram bucket boundary, which is what exposed the bug: an aligned start
never widened the window in the first place.
"""

import time
from datetime import datetime, timezone

STREAM = "regression_13946_stream"
INTERVAL_SECONDS = 10


def test_histogram_bucket_sum_matches_count_star(create_session, base_url):
    session = create_session
    org_id = "default"

    # One record per second for 100s, so a 10s-aligned start would land
    # exactly on a bucket edge; offsetting the query start by 3s does not.
    now = datetime.now(timezone.utc)
    base_ts_us = int(now.timestamp() * 1_000_000) - 100_000_000

    records = []
    for i in range(100):
        records.append(
            {
                "_timestamp": base_ts_us + i * 1_000_000,
                "level": "info",
                "message": f"regression-13946-{i}",
                "source": STREAM,
            }
        )
    ingest_resp = session.post(f"{base_url}api/{org_id}/{STREAM}/_json", json=records)
    assert ingest_resp.status_code == 200, (
        f"ingest failed: {ingest_resp.status_code} {ingest_resp.text}"
    )

    time.sleep(3)  # let the write path become searchable

    # Deliberately mid-bucket: 3s past the 10s boundary that base_ts_us
    # itself starts on, and ending 4s before the natural end -- so both
    # the first AND last bucket are partial, exactly the case #12313's
    # snap mishandled.
    start_time = base_ts_us + 3_000_000
    end_time = base_ts_us + 96_000_000

    count_payload = {
        "query": {
            "sql": f'select count(*) as total from "{STREAM}" WHERE source=\'{STREAM}\'',
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": 0,
            "quick_mode": False,
            "track_total_hits": False,
        }
    }
    count_resp = session.post(f"{base_url}api/{org_id}/_search?type=logs", json=count_payload)
    assert count_resp.status_code == 200, (
        f"count(*) query failed: {count_resp.status_code} {count_resp.text}"
    )
    count_hits = count_resp.json().get("hits", [])
    total_count = count_hits[0]["total"] if count_hits else 0

    histogram_payload = {
        "query": {
            "sql": (
                f"select histogram(_timestamp, '{INTERVAL_SECONDS} second') AS zo_sql_key, "
                f"count(*) AS zo_sql_num from \"{STREAM}\" WHERE source='{STREAM}' "
                "GROUP BY zo_sql_key ORDER BY zo_sql_key"
            ),
            "start_time": start_time,
            "end_time": end_time,
            "from": 0,
            "size": 0,
            "quick_mode": False,
            "track_total_hits": False,
        }
    }
    histogram_resp = session.post(
        f"{base_url}api/{org_id}/_search?type=logs", json=histogram_payload
    )
    assert histogram_resp.status_code == 200, (
        f"histogram query failed: {histogram_resp.status_code} {histogram_resp.text}"
    )
    bucket_sum = sum(row["zo_sql_num"] for row in histogram_resp.json().get("hits", []))

    assert bucket_sum == total_count, (
        f"sum(histogram buckets)={bucket_sum} != count(*)={total_count} over the same "
        f"[{start_time}, {end_time}] range -- reproduces #13946's over-count from "
        f"scanning past the requested start to fill the first bucket"
    )
