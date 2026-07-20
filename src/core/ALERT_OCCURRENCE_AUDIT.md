# Scheduled Alert Occurrence Audit Records

## Overview

OpenObserve stores a bounded audit record when a scheduled alert genuinely fires. The record explains the alert configuration revision, evaluated time window, condition, and bounded result that caused the alert to proceed through notification or incident handling.

This is not a full evaluation reconstruction system. Occurrence records do not preserve underlying telemetry, WAL contents, Parquet file references, scan inputs, or compaction state.

## User Workflow

List recent occurrences for an alert:

```text
GET /api/v2/{org_id}/alerts/{alert_id}/occurrences?limit=50&offset=0
```

Retrieve a single occurrence:

```text
GET /api/v2/{org_id}/alerts/occurrences/{occurrence_id}
```

The list endpoint returns summary records sorted newest first. The get endpoint includes the bounded matched-result preview.

## Captured Fields

- `occurrence_id`
- `org_id`
- `alert_id`
- `alert_name`
- `alert_updated_at`
- deterministic `config_hash`
- evaluated `window_start` and `window_end`
- `trigger_timestamp`
- `query_type`
- `condition_operator`
- `threshold_value`
- `matched_count`
- bounded `result_preview`
- `query_took`
- scheduler `trace_id`
- `created_at`
- `schema_version`

The config hash covers stream identity, scheduled query condition, trigger condition, deduplication configuration, and incident-routing flag. It intentionally excludes runtime state such as `updated_at`, destinations, owner, scheduler timestamps, and last trigger/satisfied times.

## Integration Point

The scheduler creates an occurrence only for scheduled alerts after evaluation returns matched rows and after silence/grouping/deduplication decisions have been applied:

- Realtime alerts are skipped.
- Silenced triggers are skipped.
- Condition-not-satisfied evaluations are skipped.
- Enterprise deduplication that suppresses all rows is skipped.
- Enterprise grouping that only queues an alert for a future grouped send is skipped in this version.
- Direct notification paths record after `send_notification` returns.
- Incident paths record after incident correlation handles notification.

Occurrence persistence is best-effort. A database write failure is logged with org, alert, trace, and window context, but it does not block notification delivery.

## Bounding Strategy

The result preview stores at most 10 rows and at most 64 KiB of serialized JSON. `matched_count` stores the full number of matched rows already returned by evaluation, while `result_preview.truncated` indicates whether the preview omitted rows or oversized content.

OpenObserve scheduled alert evaluation already queries with WAL enabled. The occurrence record uses the evaluated result already in memory and does not query file lists after evaluation.

## Retention

The table includes `created_at` and a `delete_older_than` storage helper so cleanup can be wired into an existing retention job. No standalone background retention subsystem is introduced in this change.

Until that cleanup job is scheduled, deployments should treat occurrence retention as bounded by their database retention or explicit administrative cleanup.

## Performance And Privacy

The feature adds one bounded database row per recorded scheduled alert occurrence. It does not create child file-reference rows, fan out by scan files, or copy unbounded telemetry results.

The preview can include raw fields from matched alert results. Keep alert queries narrow when occurrence previews are enabled for sensitive streams.

## Example Response

```json
{
  "occurrence_id": "2XQ4VYiGLnsBUbQ1uJ2ldokUULN",
  "org_id": "acme",
  "alert_id": "2XQ4VdD2xcWd1FJV6m2ndOg7qxp",
  "alert_name": "checkout_error_rate",
  "alert_updated_at": 1774080000000000,
  "config_hash": "md5:8f14e45fceea167a5a36dedd4bea2543",
  "window_start": 1774080000000000,
  "window_end": 1774080600000000,
  "trigger_timestamp": 1774080600000000,
  "query_type": "sql",
  "condition_operator": ">=",
  "threshold_value": 3,
  "matched_count": 4,
  "result_preview": {
    "matched_count": 4,
    "rows": [
      {
        "service": "checkout",
        "error_count": 4
      }
    ],
    "truncated": false,
    "max_rows": 10,
    "max_bytes": 65536
  },
  "query_took": 42,
  "trace_id": "scheduler-trace/query-trace",
  "created_at": 1774080601000000,
  "schema_version": 1
}
```

## Limitations

Full evaluation reconstruction is not supported. Occurrence records explain a firing from bounded scheduler-time data; they do not preserve all data needed to reconstruct the original query execution.
