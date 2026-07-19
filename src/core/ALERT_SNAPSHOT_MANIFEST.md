# Deterministic Alert Snapshot Manifest

## Overview

When a notify-worthy scheduled alert fires, OpenObserve creates a deterministic snapshot manifest. The manifest stores file-list metadata references for the alert source stream and the evaluated alert time window.

The manifest is a reference record. It does not copy Parquet files or preserve file availability.

## MVP Scope

- Scheduled alerts only
- Notify-worthy alert occurrences only
- Alert source stream only
- File-list metadata references only
- Parent/child SeaORM persistence
- Idempotency by `org_id`, `alert_id`, `window_start`, and `window_end`
- Read-only retrieval endpoint:

```text
GET /api/v2/{org_id}/alerts/snapshots/{snapshot_id}
```

## Creation Flow

1. Scheduled alert evaluation succeeds.
2. Trigger data exists and is non-empty.
3. Silence, grouping, and deduplication checks allow notification.
4. Existing notification and trigger-usage behavior continues.
5. Snapshot creation runs as a best-effort operation after trigger usage is published.
6. Snapshot creation failures are logged and do not fail or suppress alert notification.

Snapshots are skipped for real-time alerts, unsatisfied alerts, failed evaluations, empty trigger data, silenced occurrences, grouped occurrences waiting for a batch, and deduplication-suppressed occurrences.

## Snapshot Contents

Parent fields:

- `snapshot_id`
- `org_id`
- `alert_id`
- `alert_name`
- `trigger_timestamp`
- `window_start`
- `window_end`
- `created_at`
- `schema_version`

File reference fields:

- `stream_type`
- `stream_name`
- `file_id`
- `file_key`
- `min_ts`
- `max_ts`

The response exposes only these manifest fields. It does not expose credentials, signed URLs, storage configuration, notification payloads, or complete `FileKey` objects.

## File Selection Semantics

File-list entries are included when their timestamp range overlaps the alert window:

```text
file_min_ts <= window_end
AND
file_max_ts >= window_start
```

Timestamps are in microseconds. Deleted file-list entries are excluded. Empty file lists are valid and produce a snapshot with no file references.

File ordering is deterministic. Files are ordered by stable metadata, and duplicate file keys are canonicalized deterministically before persistence.

## Persistence And Idempotency

Snapshots use a KSUID primary key in the `alert_snapshots` table. File references are stored in `alert_snapshot_files`.

Duplicate alert occurrences are prevented by the unique natural key:

```text
org_id, alert_id, window_start, window_end
```

Repeated creation for the same occurrence returns the first committed snapshot. Parent and child rows are written in one transaction. If child insertion fails, parent creation is rolled back.

## Retrieval And Authorization

Retrieve a snapshot manifest with:

```text
GET /api/v2/{org_id}/alerts/snapshots/{snapshot_id}
```

Existing API authentication middleware applies. Lookup is scoped by `org_id`, so cross-organization access returns the standard not-found response. Malformed snapshot IDs are rejected before persistence lookup.

The endpoint is read-only. There is no create, update, delete, or list API for snapshots.

Alert object-level RBAC beyond current organization authentication follows the existing `get_alert` convention and remains a maintainer decision.

## Limitations

- Stores references, not copies of Parquet files.
- Does not pin files against retention or compaction.
- Referenced file keys may become unavailable after retention or compaction.
- Does not inspect Parquet contents.
- Does not scan object storage.
- Does not support real-time alerts.
- Does not correlate related streams or services.
- Has no frontend.
- Does not use AI or LLMs.
- Does not integrate with enterprise incident management.

## Local Validation Commands

Passing test commands for this branch:

```text
cargo test -p infra alert_snapshots
cargo test -p infra m20260719_000001_create_alert_snapshot_tables
cargo test -p openobserve-core alerts::snapshots
cargo test -p openobserve-core scheduled_snapshot
cargo test -p openobserve-core alerts::scheduler
cargo test -p openobserve-core alerts::alert
cargo test -p openobserve-api-management snapshots

cargo check -p infra
cargo check -p openobserve-core
cargo check -p openobserve-api-management
cargo check -p openobserve-api
```

Branch clippy validation is currently blocked by a pre-existing `collapsible_if` lint in:

```text
src/config/src/config.rs
```

Do not treat clippy as passing until that upstream lint is resolved or scoped separately.

## Manual End-To-End Verification

1. Build and start OpenObserve locally.
2. Ingest telemetry into a logs stream.
3. Create a scheduled alert for that stream.
4. Configure a condition that becomes satisfied.
5. Allow the scheduled alert to run.
6. Confirm normal notification behavior.
7. Find the created `snapshot_id` using the safest available development method. At the moment, that usually means checking the `alert_snapshots` database table or scheduler logs; there is no snapshot list API.
8. Call:

```text
GET /api/v2/{org_id}/alerts/snapshots/{snapshot_id}
```

9. Verify the response contains the expected alert ID, evaluated time window, source stream, and ordered file references.
10. Where practical, retry the same occurrence and confirm that no duplicate parent or child snapshot rows are created.
