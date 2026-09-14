// Copyright 2026 OpenObserve Inc.

export const DBM_VIEWER_STREAM_ROW_PERMS = ["AllowGet"] as const;

// ALLOW_GET on `metrics:_all_<org>` reads as a wildcard over every metric stream in the org, so the type node gets LIST only.
export const DBM_VIEWER_TYPE_NODE_PERMS = ["AllowList"] as const;

// Kept BY HAND — dbmViewerPreset.spec.ts fails when the Metrics tab's catalogs
// (DBM_METRIC_SECTIONS, DBM_INSTANCE_METRICS) add or drop a raw metric stream.
export const DBM_VIEWER_STREAMS: string[] = [
  "mysql_buffer_pool_operations",
  "mysql_connection_max",
  "mysql_replica_time_behind_source",
  "mysql_threads",
  "postgresql_backends",
  "postgresql_blks_hit",
  "postgresql_blks_read",
  "postgresql_commits",
  "postgresql_connection_max",
  "postgresql_database_locks",
  "postgresql_deadlocks",
  "postgresql_index_scans",
  "postgresql_index_size",
  "postgresql_operations",
  "postgresql_replication_data_delay",
  "postgresql_rollbacks",
  "postgresql_rows",
  "postgresql_wal_lag",
  "system_cpu_time",
  "system_disk_io",
  "system_memory_usage",
  "system_network_io",
];

// The org-level module toggle (no per-object entities) that authorizes every
// `/{org}/db_monitoring/*` endpoint — the DB-load and health-ratio panels riding
// `_o2_dbm_server`. Distinct from DBM_VIEWER_STREAMS: those are ordinary
// `metrics:<name>` objects, this is its own OFGA type with a single grantable row.
export const DBM_MODULE_RESOURCE = "db_monitoring";
