// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Service Streams Table — v2 schema
//!
//! Stores service registry entries. Keyed by (org_id, service_name, disambiguation).
//! `disambiguation` is a JSONB object of distinguish_by field values.
//! Streams are split into three typed columns.

use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, QueryFilter, Schema, Set,
    entity::prelude::*, sea_query::Expr,
};
use serde::{Deserialize, Serialize};
use svix_ksuid::KsuidLike;

use crate::{
    db::{get_orm_client_ddl, get_orm_client_ro, get_orm_client_rw},
    errors::{self, DbError, Error},
};

/// Service Streams Table — v2 ORM entity
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "service_streams")]
pub struct Model {
    #[sea_orm(
        primary_key,
        column_type = "String(StringLen::N(27))",
        auto_increment = false
    )]
    pub id: String,

    #[sea_orm(column_type = "String(StringLen::N(128))")]
    pub org_id: String,

    #[sea_orm(column_type = "String(StringLen::N(256))")]
    pub service_name: String,

    /// Identity set that produced this service record.
    /// E.g. "k8s", "aws", "gcp", "azure", "default".
    #[sea_orm(column_type = "String(StringLen::N(64))")]
    pub set_id: String,

    /// JSONB: distinguish_by field values. Keys are field alias group IDs.
    /// E.g., {"k8s-cluster": "prod", "k8s-namespace": "default"}
    #[sea_orm(column_type = "Json")]
    pub disambiguation: Json,

    /// JSONB: all semantic dimensions extracted from the telemetry record.
    /// Superset of `disambiguation` — every field the processor mapped to a semantic group.
    /// Used by analytics to compute cardinality and co-occurrence without requiring
    /// disambiguation to be configured first.
    #[sea_orm(column_type = "Json")]
    pub all_dimensions: Json,

    /// JSONB array of log stream names
    #[sea_orm(column_type = "Json")]
    pub logs_streams: Json,

    /// JSONB array of trace stream names
    #[sea_orm(column_type = "Json")]
    pub traces_streams: Json,

    /// JSONB array of metric stream names
    #[sea_orm(column_type = "Json")]
    pub metrics_streams: Json,

    /// JSONB object mapping semantic group ID → raw field name that produced it.
    /// E.g., {"service": "kubernetes_labels_app", "k8s-cluster": "cluster_name"}
    /// Nullable: absent for records written before this column was added.
    #[sea_orm(column_type = "Json", nullable)]
    pub field_name_mapping: Option<Json>,

    pub last_seen: i64,
}

#[derive(Copy, Clone, Debug, EnumIter)]
pub enum Relation {}

impl RelationTrait for Relation {
    fn def(&self) -> RelationDef {
        panic!("No relations defined")
    }
}

impl ActiveModelBehavior for ActiveModel {}

/// Service record returned from DB queries (v2 schema).
#[derive(FromQueryResult, Debug, Clone, Serialize, Deserialize)]
pub struct ServiceRecord {
    pub id: String,
    pub org_id: String,
    pub service_name: String,
    /// Identity set that produced this service record (e.g. "k8s", "aws").
    pub set_id: String,
    /// JSONB: distinguish_by values. Keys = field alias group IDs.
    pub disambiguation: serde_json::Value,
    /// JSONB: all semantic dimensions extracted from the telemetry record.
    pub all_dimensions: serde_json::Value,
    /// JSONB array of log stream names
    pub logs_streams: serde_json::Value,
    /// JSONB array of trace stream names
    pub traces_streams: serde_json::Value,
    /// JSONB array of metric stream names
    pub metrics_streams: serde_json::Value,
    /// JSONB object mapping semantic group ID → raw field name.
    /// None for records written before this column was added.
    pub field_name_mapping: Option<serde_json::Value>,
    pub last_seen: i64,
}

impl ServiceRecord {
    pub fn new(
        org_id: &str,
        service_name: &str,
        set_id: &str,
        disambiguation: serde_json::Value,
    ) -> Self {
        Self {
            id: svix_ksuid::Ksuid::new(None, None).to_string(),
            org_id: org_id.to_owned(),
            service_name: service_name.to_owned(),
            set_id: set_id.to_owned(),
            disambiguation,
            all_dimensions: serde_json::json!({}),
            logs_streams: serde_json::json!([]),
            traces_streams: serde_json::json!([]),
            metrics_streams: serde_json::json!([]),
            field_name_mapping: None,
            last_seen: 0,
        }
    }
}

pub async fn create_table() -> Result<(), errors::Error> {
    let client = get_orm_client_ddl().await;
    let builder = client.get_database_backend();

    let schema = Schema::new(builder);
    let create_table_stmt = schema
        .create_table_from_entity(Entity)
        .if_not_exists()
        .take();

    client
        .execute(builder.build(&create_table_stmt))
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Upsert a service record.
/// Looks up by (org_id, service_name, disambiguation). If found: union stream name. If not: insert.
/// Normalize a `serde_json::Value` object so its keys are in sorted order.
/// This ensures deterministic serialization for text/JSONB equality comparisons
/// (especially on SQLite, which compares JSON as raw text).
fn normalize_json_object(v: serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::Object(m) => {
            let sorted: std::collections::BTreeMap<_, _> = m.into_iter().collect();
            serde_json::Value::Object(sorted.into_iter().collect())
        }
        other => other,
    }
}

/// Upsert a service record.
///
/// Returns the `disambiguation` JSON of every orphaned (lower-specificity) row that was
/// deleted as part of this put, so callers can evict the matching cache keys (F19).
/// Empty on a plain insert.
pub async fn put(
    org_id: &str,
    record: ServiceRecord,
    max_streams_per_type: usize,
) -> Result<Vec<serde_json::Value>, errors::Error> {
    let client = get_orm_client_rw().await;
    put_with(client, org_id, record, max_streams_per_type).await
}

/// [`put`] against a caller-supplied connection.
///
/// The `_with` variant exists so the no-op/write-amplification behavior can be
/// exercised against a real schema in tests — the same shape
/// `alert_states::get`/`get_with` already use. `put` delegates here so a test
/// cannot accidentally verify a different code path from the one production runs.
pub async fn put_with<C: sea_orm::ConnectionTrait>(
    client: &C,
    org_id: &str,
    mut record: ServiceRecord,
    max_streams_per_type: usize,
) -> Result<Vec<serde_json::Value>, errors::Error> {
    // Normalize disambiguation to sorted-key JSON so that text comparisons in SQLite
    // are stable regardless of insertion order of the original object.
    record.disambiguation = normalize_json_object(record.disambiguation);

    // Look up the exact row via (org_id, service_name, set_id, disambiguation).
    // Scoping by set_id ensures records from different identity sets never merge.
    let existing = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ServiceName.eq(&record.service_name))
        .filter(Column::SetId.eq(&record.set_id))
        .filter(Expr::col(Column::Disambiguation).eq(record.disambiguation.clone()))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    // Build incoming disambiguation map once — used in both branches for orphan cleanup.
    let incoming_map: std::collections::HashMap<String, String> = record
        .disambiguation
        .as_object()
        .map(|m| {
            m.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default();

    if let Some(existing_model) = existing {
        // Exact match: union streams
        let kept_id = existing_model.id.clone();
        // all_dimensions must union like field_name_mapping does — otherwise the
        // values of dimensions tracked after the row was first inserted (e.g. a
        // newly configured alias group) never become visible on the row.
        let merged_dims =
            union_dimension_objects(&existing_model.all_dimensions, &record.all_dimensions);
        let logs = union_stream_array(
            &existing_model.logs_streams,
            &record.logs_streams,
            max_streams_per_type,
        );
        let traces = union_stream_array(
            &existing_model.traces_streams,
            &record.traces_streams,
            max_streams_per_type,
        );
        let metrics = union_stream_array(
            &existing_model.metrics_streams,
            &record.metrics_streams,
            max_streams_per_type,
        );

        let mut active: ActiveModel = existing_model.into();
        active.logs_streams = Set(logs);
        active.traces_streams = Set(traces);
        active.metrics_streams = Set(metrics);
        active.all_dimensions = Set(merged_dims);
        active.last_seen = Set(record.last_seen);
        if let Some(fnm) = record.field_name_mapping {
            active.field_name_mapping = Set(Some(fnm));
        }

        active
            .update(client)
            .await
            .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

        // Delete any orphaned rows that are strict subsets of the row we just updated.
        // These accumulate when a record with fewer disambiguation fields was written before
        // the richer variant existed.
        delete_subset_orphans(
            client,
            org_id,
            &record.service_name,
            &record.set_id,
            &incoming_map,
            &kept_id,
        )
        .await
    } else {
        // No exact match. Check if an existing row can be upgraded:
        // A row is upgradeable if its disambiguation is a subset of the incoming one
        // (all existing key-value pairs match in the incoming map, incoming may have more).
        // This merges e.g. {} → {"k8s-cluster": "prod"} or
        // {"k8s-cluster": "prod"} → {"k8s-cluster": "prod", "k8s-namespace": "ecommerce"}.
        let candidates = Entity::find()
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::ServiceName.eq(&record.service_name))
            .filter(Column::SetId.eq(&record.set_id))
            .all(client)
            .await
            .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

        // Find a compatible row in either direction:
        //   Case A: existing ⊆ incoming → upgrade (adopt incoming's richer disambiguation)
        //   Case B: incoming ⊆ existing → match (keep existing's richer disambiguation)
        // In both cases the matching values for shared keys must be equal.
        let upgradeable = candidates.into_iter().find(|row| {
            let existing_map: std::collections::HashMap<String, String> = row
                .disambiguation
                .as_object()
                .map(|m| {
                    m.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            // Case A: existing is a subset of incoming
            let existing_subset_of_incoming = existing_map
                .iter()
                .all(|(k, v)| incoming_map.get(k).map(|iv| iv == v).unwrap_or(false));
            // Case B: incoming is a subset of existing
            let incoming_subset_of_existing = incoming_map
                .iter()
                .all(|(k, v)| existing_map.get(k).map(|ev| ev == v).unwrap_or(false));
            existing_subset_of_incoming || incoming_subset_of_existing
        });

        if let Some(existing_model) = upgradeable {
            let kept_id = existing_model.id.clone();
            let logs = union_stream_array(
                &existing_model.logs_streams,
                &record.logs_streams,
                max_streams_per_type,
            );
            let traces = union_stream_array(
                &existing_model.traces_streams,
                &record.traces_streams,
                max_streams_per_type,
            );
            let metrics = union_stream_array(
                &existing_model.metrics_streams,
                &record.metrics_streams,
                max_streams_per_type,
            );

            // Keep whichever disambiguation is richer (more keys wins)
            let existing_map: std::collections::HashMap<String, String> = existing_model
                .disambiguation
                .as_object()
                .map(|m| {
                    m.iter()
                        .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            let richer_map = if incoming_map.len() >= existing_map.len() {
                &incoming_map
            } else {
                &existing_map
            };
            let richer_disambiguation = if incoming_map.len() >= existing_map.len() {
                record.disambiguation
            } else {
                existing_model.disambiguation.clone()
            };

            let merged_dims =
                union_dimension_objects(&existing_model.all_dimensions, &record.all_dimensions);
            let mut active: ActiveModel = existing_model.into();
            active.disambiguation = Set(richer_disambiguation);
            active.logs_streams = Set(logs);
            active.traces_streams = Set(traces);
            active.metrics_streams = Set(metrics);
            active.all_dimensions = Set(merged_dims);
            active.last_seen = Set(record.last_seen);
            if let Some(fnm) = record.field_name_mapping {
                active.field_name_mapping = Set(Some(fnm));
            }

            active
                .update(client)
                .await
                .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

            // Clean up any other orphaned subset rows for this service (same set_id)
            delete_subset_orphans(
                client,
                org_id,
                &record.service_name,
                &record.set_id,
                richer_map,
                &kept_id,
            )
            .await
        } else {
            let active_model = ActiveModel {
                id: Set(record.id),
                org_id: Set(org_id.to_owned()),
                service_name: Set(record.service_name.clone()),
                set_id: Set(record.set_id),
                disambiguation: Set(record.disambiguation),
                all_dimensions: Set(record.all_dimensions),
                logs_streams: Set(record.logs_streams),
                traces_streams: Set(record.traces_streams),
                metrics_streams: Set(record.metrics_streams),
                field_name_mapping: Set(record.field_name_mapping),
                last_seen: Set(record.last_seen),
            };

            Entity::insert(active_model)
                .exec(client)
                .await
                .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

            // Plain insert: nothing was orphaned.
            Ok(Vec::new())
        }
    }
}

/// Delete rows for `service_name` that are strict subsets of `richer_map`, excluding `keep_id`.
/// Called after a successful put/upgrade to clean up orphaned lower-specificity rows.
///
/// Returns the `disambiguation` JSON of each deleted row so callers can evict the
/// corresponding cache entries (F19).
async fn delete_subset_orphans<C: sea_orm::ConnectionTrait>(
    client: &C,
    org_id: &str,
    service_name: &str,
    set_id: &str,
    richer_map: &std::collections::HashMap<String, String>,
    keep_id: &str,
) -> Result<Vec<serde_json::Value>, errors::Error> {
    let candidates = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ServiceName.eq(service_name))
        .filter(Column::SetId.eq(set_id))
        .all(client)
        .await
        .map_err(|e| errors::Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;

    let mut deleted: Vec<serde_json::Value> = Vec::new();
    for row in candidates {
        if row.id == keep_id {
            continue;
        }
        let row_map: std::collections::HashMap<String, String> = row
            .disambiguation
            .as_object()
            .map(|m| {
                m.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default();
        // Only delete if this row's keys are a strict subset of richer_map with matching values
        let is_subset = row_map
            .iter()
            .all(|(k, v)| richer_map.get(k).map(|rv| rv == v).unwrap_or(false));
        if is_subset && row_map.len() < richer_map.len() {
            let disambiguation = row.disambiguation.clone();
            Entity::delete_by_id(row.id)
                .exec(client)
                .await
                .map_err(|e| errors::Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
            deleted.push(disambiguation);
        }
    }
    Ok(deleted)
}

/// Default cap on streams tracked per telemetry type, matching the enterprise
/// `StreamMergePolicy` default. Used by callers that have no config access.
pub const DEFAULT_MAX_STREAMS_PER_TYPE: usize = 50;

/// Union two JSON objects of dimension values; keys already present in `base`
/// win (same semantics as `ServiceMetadata::merge`), so later ingests can add
/// newly-tracked dimensions without churning stored values.
fn union_dimension_objects(
    base: &serde_json::Value,
    incoming: &serde_json::Value,
) -> serde_json::Value {
    let mut out = base.as_object().cloned().unwrap_or_default();
    if let Some(inc) = incoming.as_object() {
        for (k, v) in inc {
            out.entry(k.clone()).or_insert_with(|| v.clone());
        }
    }
    serde_json::Value::Object(out)
}

/// Union two stream-name arrays, deduplicating and capping the result at
/// `max_streams_per_type`. Without the cap the DB write path grows rows
/// unboundedly past the in-memory merge policy's limit (F32) — existing
/// entries are kept in order, new ones appended, then truncated (same
/// first-N rule the in-memory policy applies).
fn union_stream_array(
    existing: &serde_json::Value,
    new: &serde_json::Value,
    max_streams_per_type: usize,
) -> serde_json::Value {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    // Compact existing, dropping any duplicates already in the stored array
    let mut result: Vec<serde_json::Value> = existing
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|v| {
            v.as_str()
                .map(|s| seen.insert(s.to_string()))
                .unwrap_or(false)
        })
        .collect();
    // Add new entries that aren't already present
    if let Some(arr) = new.as_array() {
        for s in arr.iter().filter_map(|v| v.as_str()) {
            if seen.insert(s.to_string()) {
                result.push(serde_json::Value::String(s.to_string()));
            }
        }
    }
    result.truncate(max_streams_per_type);
    serde_json::Value::Array(result)
}

/// List all services for an organization
pub async fn list(org_id: &str) -> Result<Vec<ServiceRecord>, errors::Error> {
    let client = get_orm_client_ro().await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records.into_iter().map(model_to_record).collect())
}

/// List services by service name
pub async fn list_by_name(
    org_id: &str,
    service_name: &str,
) -> Result<Vec<ServiceRecord>, errors::Error> {
    let client = get_orm_client_ro().await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ServiceName.eq(service_name))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records.into_iter().map(model_to_record).collect())
}

/// List services with optional service name filter.
/// This avoids loading all records when only service name filtering is needed.
pub async fn list_filtered_by_service(
    org_id: &str,
    service_name: Option<&str>,
) -> Result<Vec<ServiceRecord>, errors::Error> {
    let client = get_orm_client_ro().await;

    let query = match service_name {
        Some(name) => Entity::find()
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::ServiceName.eq(name)),
        None => Entity::find().filter(Column::OrgId.eq(org_id)),
    };

    let records = query
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records.into_iter().map(model_to_record).collect())
}

/// Delete all service records for a specific identity set within an organization.
/// Called when a set is removed from the config to clean up stale data.
pub async fn delete_by_set_id(org_id: &str, set_id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;

    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SetId.eq(set_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Delete all services for an organization, returning the number of deleted rows
pub async fn delete_all(org_id: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;

    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(result.rows_affected)
}

/// List distinct organization IDs that have service_streams records
pub async fn list_distinct_orgs() -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_ro().await;
    let backend = client.get_database_backend();

    let sql = "SELECT DISTINCT org_id FROM service_streams ORDER BY org_id";
    let stmt = sea_orm::Statement::from_string(backend, sql.to_string());

    #[derive(FromQueryResult)]
    struct OrgRow {
        org_id: String,
    }

    let rows = OrgRow::find_by_statement(stmt)
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(rows.into_iter().map(|r| r.org_id).collect())
}

/// Delete stale records (last_seen older than threshold)
pub async fn delete_stale(org_id: &str, older_than_micros: i64) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;

    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::LastSeen.lt(older_than_micros))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(result.rows_affected)
}

/// Get total row count for an organization
pub async fn count(org_id: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_ro().await;

    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .count(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

fn model_to_record(r: Model) -> ServiceRecord {
    ServiceRecord {
        id: r.id,
        org_id: r.org_id,
        service_name: r.service_name,
        set_id: r.set_id,
        disambiguation: r.disambiguation,
        all_dimensions: r.all_dimensions,
        logs_streams: r.logs_streams,
        traces_streams: r.traces_streams,
        metrics_streams: r.metrics_streams,
        field_name_mapping: r.field_name_mapping,
        last_seen: r.last_seen,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_json_object_sorts_keys() {
        let val = serde_json::json!({"z": 1, "a": 2, "m": 3});
        let normalized = normalize_json_object(val);
        let keys: Vec<&str> = normalized
            .as_object()
            .unwrap()
            .keys()
            .map(|s| s.as_str())
            .collect();
        assert_eq!(keys, vec!["a", "m", "z"]);
    }

    #[test]
    fn test_normalize_json_object_non_object_passthrough() {
        let val = serde_json::json!([1, 2, 3]);
        let normalized = normalize_json_object(val.clone());
        assert_eq!(normalized, val);
    }

    #[test]
    fn test_normalize_json_object_null_passthrough() {
        let val = serde_json::Value::Null;
        let normalized = normalize_json_object(val);
        assert_eq!(normalized, serde_json::Value::Null);
    }

    #[test]
    fn test_union_stream_array_combines_without_duplicates() {
        let existing = serde_json::json!(["a", "b"]);
        let new = serde_json::json!(["b", "c"]);
        let result = union_stream_array(&existing, &new, DEFAULT_MAX_STREAMS_PER_TYPE);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 3);
        let strs: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
        assert!(strs.contains(&"a"));
        assert!(strs.contains(&"b"));
        assert!(strs.contains(&"c"));
    }

    #[test]
    fn test_union_stream_array_empty_existing() {
        let existing = serde_json::json!([]);
        let new = serde_json::json!(["x", "y"]);
        let result = union_stream_array(&existing, &new, DEFAULT_MAX_STREAMS_PER_TYPE);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
    }

    #[test]
    fn test_union_stream_array_deduplicates_existing() {
        let existing = serde_json::json!(["a", "a", "b"]);
        let new = serde_json::json!([]);
        let result = union_stream_array(&existing, &new, DEFAULT_MAX_STREAMS_PER_TYPE);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
    }

    #[test]
    fn test_union_stream_array_caps_at_max_streams_per_type() {
        let existing = serde_json::json!(["a", "b", "c"]);
        let new = serde_json::json!(["d", "e"]);
        let result = union_stream_array(&existing, &new, 4);
        let strs: Vec<&str> = result
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        // Existing entries win; new entries fill remaining slots in order.
        assert_eq!(strs, vec!["a", "b", "c", "d"]);
    }

    #[test]
    fn test_service_record_new_sets_fields() {
        let record = ServiceRecord::new("myorg", "mysvc", "setid1", serde_json::json!({"k": "v"}));
        assert_eq!(record.org_id, "myorg");
        assert_eq!(record.service_name, "mysvc");
        assert_eq!(record.set_id, "setid1");
        assert_eq!(record.last_seen, 0);
        assert!(!record.id.is_empty());
    }

    // ── put_with no-op / write-amplification tests ─────────────────────────
    //
    // The bug: `put()` always builds every mutable column as `Set(..)`, so
    // `.update()` issues a full-column UPDATE even when nothing changed
    // (measured: 251,333 UPDATEs / 12h in production, ~58% of DB time). The
    // fix marks a column `Unchanged(existing_value)` instead of `Set(value)`
    // when the computed new value equals what's already stored, so SeaORM's
    // own `Updater::is_noop()` (sea-orm 1.1.20, `executor/update.rs`) skips
    // issuing SQL entirely once every column ends up Unchanged/NotSet.
    //
    // Proving "no UPDATE was issued" against sqlite in-memory: row content
    // alone can't distinguish the fix from the bug (both leave the same
    // final values — one gets there via a wasted UPDATE). Directly
    // inspecting SeaORM's `Updater::is_noop()` isn't reachable from outside
    // the crate. So the fixture (`db()` below) attaches a real SQLite
    // `AFTER UPDATE OF <column>` trigger per mutable column to
    // `service_streams`, each incrementing its own counter in a sidecar
    // `update_audit` table every time that column is named in an UPDATE's
    // SET clause — regardless of whether the assigned value actually
    // changed. This is driver-level ground truth: `UpdateOne::prepare_values`
    // (sea-orm `query/update.rs`) only adds a column to the SQL SET clause
    // when the ActiveModel field is `ActiveValue::Set(_)`; `Unchanged`/
    // `NotSet` fields never reach the statement. So `set_clause_count(..)`
    // for one column proves that column was never `Set(_)` on the
    // ActiveModel for that call — not just that its final value happens to
    // match. `last_seen` is `Set(_)` unconditionally in both branches (out
    // of scope for this fix — see test 7), so `total_set_clause_hits(..)`
    // is only ever 0 for a call that issues no UPDATE at all (an insert);
    // an update call that is a no-op for every OTHER column still shows
    // exactly 1 via `last_seen`, which the per-column tests check for
    // explicitly rather than relying on the whole-row total.

    /// Every mutable column `put`/`put_with` can write, in the exact spelling
    /// SQLite uses for the column name (snake_case). Drives the per-column
    /// audit triggers below, so adding a mutable column to the entity is a
    /// visible one-line change here rather than a silent gap in coverage.
    const MUTABLE_COLUMNS: [&str; 7] = [
        "disambiguation",
        "all_dimensions",
        "logs_streams",
        "traces_streams",
        "metrics_streams",
        "field_name_mapping",
        "last_seen",
    ];

    /// Sidecar table + trigger fixture, matching `alert_states.rs`'s `db()`
    /// precedent (`Schema::new(backend).create_table_from_entity`) for the
    /// base schema.
    ///
    /// Per-column `AFTER UPDATE OF <col>` triggers are the no-op proof: SQLite
    /// fires `UPDATE OF <col>` iff `<col>` is named in the UPDATE statement's
    /// SET clause — independent of whether the assigned value actually
    /// differs from what was stored (verified directly against sqlite3: a
    /// same-value `SET a = 10` still fires `AFTER UPDATE OF a`, while an
    /// UPDATE that never names `a` does not). SeaORM's `UpdateOne::prepare_values`
    /// (sea-orm `query/update.rs`) only adds a column to the SET clause when
    /// the ActiveModel field is `ActiveValue::Set(_)` — `Unchanged`/`NotSet`
    /// fields never reach the statement. So a zero count on a column's audit
    /// row after a `put_with` call proves that column was never `Set` on the
    /// ActiveModel for that call — not merely that its final value matches.
    async fn db() -> sea_orm::DatabaseConnection {
        use sea_orm::{ConnectionTrait, Database, Schema};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        let create_table_stmt = schema.create_table_from_entity(Entity);
        db.execute(backend.build(&create_table_stmt)).await.unwrap();

        db.execute_unprepared(
            "CREATE TABLE update_audit (id TEXT NOT NULL, col TEXT NOT NULL, hit_count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (id, col))",
        )
        .await
        .unwrap();
        for col in MUTABLE_COLUMNS {
            let sql = format!(
                "CREATE TRIGGER service_streams_audit_{col} \
                 AFTER UPDATE OF {col} ON service_streams \
                 BEGIN \
                     INSERT INTO update_audit (id, col, hit_count) VALUES (NEW.id, '{col}', 1) \
                     ON CONFLICT(id, col) DO UPDATE SET hit_count = hit_count + 1; \
                 END"
            );
            db.execute_unprepared(&sql).await.unwrap();
        }

        db
    }

    /// Number of times `col` has appeared in an UPDATE statement's SET
    /// clause against `id` since the fixture was created — SQL-level ground
    /// truth for "was this column `Set(_)` on the ActiveModel," independent
    /// of the row's final stored value. See [`db`] for why this is a real
    /// proof and not a value-equality check in disguise.
    async fn set_clause_count(db: &sea_orm::DatabaseConnection, id: &str, col: &str) -> i64 {
        use sea_orm::{ConnectionTrait, FromQueryResult, Statement};

        #[derive(FromQueryResult)]
        struct Row {
            hit_count: i64,
        }

        let stmt = Statement::from_sql_and_values(
            db.get_database_backend(),
            "SELECT hit_count FROM update_audit WHERE id = ? AND col = ?",
            [id.into(), col.into()],
        );
        Row::find_by_statement(stmt)
            .one(db)
            .await
            .unwrap()
            .map(|r| r.hit_count)
            .unwrap_or(0)
    }

    /// Total UPDATE-statement touches across every mutable column — zero iff
    /// `Updater::is_noop()` (sea-orm `executor/update.rs`) skipped issuing
    /// SQL for this row entirely, since a no-op SET clause is empty and no
    /// column-scoped trigger can fire.
    async fn total_set_clause_hits(db: &sea_orm::DatabaseConnection, id: &str) -> i64 {
        let mut total = 0;
        for col in MUTABLE_COLUMNS {
            total += set_clause_count(db, id, col).await;
        }
        total
    }

    /// A record shaped like real service-registry telemetry: a k8s identity
    /// set with a cluster/namespace disambiguation, non-trivial stream
    /// arrays and dimensions — not an empty/degenerate fixture.
    fn service_record(disambiguation: serde_json::Value, last_seen: i64) -> ServiceRecord {
        let mut r = ServiceRecord::new("org1", "checkout-service", "k8s", disambiguation);
        r.all_dimensions = serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"});
        r.logs_streams = serde_json::json!(["checkout-service-logs"]);
        r.traces_streams = serde_json::json!(["checkout-service-traces"]);
        r.metrics_streams = serde_json::json!(["checkout-service-metrics"]);
        r.field_name_mapping = Some(serde_json::json!({"service": "kubernetes_labels_app"}));
        r.last_seen = last_seen;
        r
    }

    /// 1. Exact-match branch, byte-identical repeat: the second `put_with`
    /// call must not touch logs/traces/metrics/all_dimensions/field_name_mapping.
    /// `last_seen` is explicitly OUT of scope for this fix (see [`db`]'s
    /// sibling test 7): `active.last_seen = Set(record.last_seen)` stays
    /// unconditional, so it is `Set(_)` on every call regardless of whether
    /// its value changed, and its own trigger firing once here is expected,
    /// not a bug — only the other 5 columns' triggers must stay silent.
    #[tokio::test]
    async fn exact_repeat_call_issues_no_update() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();

        put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();
        assert_eq!(
            total_set_clause_hits(&db, &first_id).await,
            0,
            "insert is not an UPDATE"
        );

        let repeat = service_record(disambiguation, 1_000);
        put_with(&db, "org1", repeat, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        for col in [
            "disambiguation",
            "all_dimensions",
            "logs_streams",
            "traces_streams",
            "metrics_streams",
            "field_name_mapping",
        ] {
            assert_eq!(
                set_clause_count(&db, &first_id, col).await,
                0,
                "{col} is byte-identical between calls and must never have been Set(_)"
            );
        }
    }

    /// 2. Partial change: only `traces_streams` grows between calls. Proves,
    /// at the SQL SET-clause level (not just final row values, which the old
    /// buggy code would also get right via a wasted full-column UPDATE):
    /// `traces_streams` was actually `Set(_)` on the ActiveModel, while
    /// `disambiguation`/`all_dimensions`/`logs_streams`/`metrics_streams`/
    /// `field_name_mapping` were not — only `last_seen` (always written,
    /// out of scope for this fix) and `traces_streams` may appear.
    #[tokio::test]
    async fn partial_change_updates_only_when_a_field_actually_differs() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        let mut second = service_record(disambiguation, 1_000);
        second.traces_streams =
            serde_json::json!(["checkout-service-traces", "checkout-service-traces-v2"]);
        put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert_eq!(
            set_clause_count(&db, &first_id, "traces_streams").await,
            1,
            "traces_streams grew, so it must have been Set(_) on the ActiveModel"
        );
        // last_seen is unconditionally Set every call regardless of scope (out of
        // scope for this fix), so it is expected to appear here even though its
        // value (1_000) did not change between the two calls.
        assert_eq!(
            set_clause_count(&db, &first_id, "last_seen").await,
            1,
            "last_seen is always written, in or out of the no-op set"
        );
        for col in [
            "disambiguation",
            "all_dimensions",
            "logs_streams",
            "metrics_streams",
            "field_name_mapping",
        ] {
            assert_eq!(
                set_clause_count(&db, &first_id, col).await,
                0,
                "{col} did not change and must have been Unchanged(_), not Set(_), on the ActiveModel"
            );
        }

        let row = Entity::find_by_id(first_id.clone())
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        let traces: Vec<&str> = row
            .traces_streams
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        assert_eq!(
            traces,
            vec!["checkout-service-traces", "checkout-service-traces-v2"]
        );
        assert_eq!(
            row.logs_streams,
            serde_json::json!(["checkout-service-logs"]),
            "logs_streams did not change and must retain its original value"
        );
    }

    /// 3. Full change: every field the exact-match branch can touch differs
    /// between calls. Proves a real UPDATE happens and every new value is
    /// actually persisted. `disambiguation` is excluded here on purpose: the
    /// exact-match branch is reached only when disambiguation is identical
    /// between calls (that is what makes it an exact match), and the branch
    /// never assigns `active.disambiguation` at all — only the upgrade
    /// branch (tests 5a/5b) can rewrite it.
    #[tokio::test]
    async fn full_change_updates_and_persists_every_new_value() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        let mut second = service_record(disambiguation, 2_000);
        second.all_dimensions =
            serde_json::json!({"k8s-cluster": "prod", "k8s-region": "us-east-1"});
        second.logs_streams = serde_json::json!(["checkout-service-logs-v2"]);
        second.traces_streams = serde_json::json!(["checkout-service-traces-v2"]);
        second.metrics_streams = serde_json::json!(["checkout-service-metrics-v2"]);
        second.field_name_mapping =
            Some(serde_json::json!({"service": "kubernetes_labels_app_v2"}));
        put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        for col in [
            "all_dimensions",
            "logs_streams",
            "traces_streams",
            "metrics_streams",
            "field_name_mapping",
        ] {
            assert_eq!(
                set_clause_count(&db, &first_id, col).await,
                1,
                "{col} changed and must have been Set(_)"
            );
        }
        assert_eq!(
            set_clause_count(&db, &first_id, "disambiguation").await,
            0,
            "the exact-match branch never assigns disambiguation, no matter what else changed"
        );
        let row = Entity::find_by_id(first_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.logs_streams,
            serde_json::json!(["checkout-service-logs", "checkout-service-logs-v2"]),
            "logs_streams unions rather than replaces — existing entries are kept"
        );
        assert_eq!(row.last_seen, 2_000);
        assert_eq!(
            row.field_name_mapping,
            Some(serde_json::json!({"service": "kubernetes_labels_app_v2"}))
        );
    }

    /// 4a. `field_name_mapping: None` on the second call must leave the
    /// stored mapping untouched — existing behavior, must not regress —
    /// and must not itself force a rewrite (only `last_seen`, out of scope
    /// for this fix, is expected to have been `Set(_)`).
    #[tokio::test]
    async fn field_name_mapping_none_preserves_existing_value_and_is_a_noop_field() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        let mut second = service_record(disambiguation, 1_000);
        second.field_name_mapping = None;
        put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        for col in [
            "disambiguation",
            "all_dimensions",
            "logs_streams",
            "traces_streams",
            "metrics_streams",
            "field_name_mapping",
        ] {
            assert_eq!(
                set_clause_count(&db, &first_id, col).await,
                0,
                "{col}: field_name_mapping=None plus otherwise-identical fields must stay Unchanged(_)"
            );
        }
        let row = Entity::find_by_id(first_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.field_name_mapping,
            Some(serde_json::json!({"service": "kubernetes_labels_app"})),
            "existing field_name_mapping must be preserved when the incoming record has None"
        );
    }

    /// 4b. `field_name_mapping: Some(x)` where `x` is byte-identical to what's
    /// stored counts as a no-op for this field specifically.
    #[tokio::test]
    async fn field_name_mapping_identical_some_is_a_noop_field() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        // Identical to service_record()'s default field_name_mapping.
        let second = service_record(disambiguation, 1_000);
        put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert_eq!(
            set_clause_count(&db, &first_id, "field_name_mapping").await,
            0,
            "identical Some(..) field_name_mapping must not force a rewrite"
        );
    }

    /// 4c. `field_name_mapping: Some(x)` where `x` differs from what's stored
    /// must produce a real update.
    #[tokio::test]
    async fn field_name_mapping_changed_some_updates() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        let mut second = service_record(disambiguation, 1_000);
        second.field_name_mapping = Some(serde_json::json!({"service": "different_raw_field"}));
        put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert_eq!(
            set_clause_count(&db, &first_id, "field_name_mapping").await,
            1,
            "field_name_mapping changed and must have been Set(_)"
        );
        let row = Entity::find_by_id(first_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.field_name_mapping,
            Some(serde_json::json!({"service": "different_raw_field"}))
        );
    }

    /// 5a. Upgrade branch: incoming disambiguation is a subset of the
    /// existing (richer) row's, and the richer_disambiguation therefore
    /// resolves to byte-identical to what's already stored. `disambiguation`
    /// (upgrade-branch-only field) must be marked Unchanged, not rewritten —
    /// combined with identical logs/traces/metrics/all_dimensions/
    /// field_name_mapping, the whole call must be a no-op.
    #[tokio::test]
    async fn upgrade_branch_subset_incoming_leaves_richer_disambiguation_untouched() {
        let db = db().await;
        // Existing row already has the richer disambiguation.
        let richer = service_record(
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"}),
            1_000,
        );
        let richer_id = richer.id.clone();
        put_with(&db, "org1", richer, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        // Incoming disambiguation ({"k8s-cluster": "prod"}) is a strict subset
        // of the stored one, and every other mutable field is identical, so
        // richer_disambiguation resolves to the existing value verbatim.
        let subset = service_record(serde_json::json!({"k8s-cluster": "prod"}), 1_000);
        put_with(&db, "org1", subset, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        for col in [
            "disambiguation",
            "all_dimensions",
            "logs_streams",
            "traces_streams",
            "metrics_streams",
            "field_name_mapping",
        ] {
            assert_eq!(
                set_clause_count(&db, &richer_id, col).await,
                0,
                "{col}: the upgrade branch must not rewrite a field whose resolved value is unchanged"
            );
        }
        let row = Entity::find_by_id(richer_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.disambiguation,
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"})
        );
    }

    /// 5b. Upgrade branch: incoming disambiguation is richer than the
    /// existing (subset) row's, so richer_disambiguation genuinely changes —
    /// this must be a real update, including the disambiguation column.
    #[tokio::test]
    async fn upgrade_branch_richer_incoming_updates_disambiguation() {
        let db = db().await;
        let sparse = service_record(serde_json::json!({"k8s-cluster": "prod"}), 1_000);
        let sparse_id = sparse.id.clone();
        put_with(&db, "org1", sparse, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        let richer = service_record(
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"}),
            1_000,
        );
        put_with(&db, "org1", richer, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert_eq!(
            set_clause_count(&db, &sparse_id, "disambiguation").await,
            1,
            "the incoming row is richer, so disambiguation must actually have been Set(_)"
        );
        let row = Entity::find_by_id(sparse_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.disambiguation,
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"})
        );
    }

    /// 6. Insert path (no existing row, no upgrade candidate) must keep
    /// working exactly as today — a regression-safety check, not new
    /// behavior. An insert is not an UPDATE at all, so it must not touch
    /// any of the update-counting triggers.
    #[tokio::test]
    async fn plain_insert_is_unaffected_and_is_not_an_update() {
        let db = db().await;
        let record = service_record(serde_json::json!({"k8s-cluster": "prod"}), 1_000);
        let id = record.id.clone();

        let orphans = put_with(&db, "org1", record, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(orphans.is_empty(), "a plain insert orphans nothing");
        assert_eq!(
            total_set_clause_hits(&db, &id).await,
            0,
            "an insert must never register as an UPDATE"
        );
        let row = Entity::find_by_id(id).one(&db).await.unwrap().unwrap();
        assert_eq!(row.org_id, "org1");
        assert_eq!(row.service_name, "checkout-service");
        assert_eq!(
            row.logs_streams,
            serde_json::json!(["checkout-service-logs"])
        );
    }

    /// 7. `last_seen` is explicitly out of scope for this fix: it must be
    /// written on every call, even when every other field is identical.
    /// Guards against the fix accidentally scope-creeping into also
    /// skipping `last_seen` (that coarsening is a separate, deferred
    /// change) — this call SHOULD still issue a real UPDATE of `last_seen`,
    /// while every other (identical) field stays Unchanged(_).
    #[tokio::test]
    async fn last_seen_always_updates_even_when_nothing_else_changed() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        // Only last_seen differs from the first call.
        let second = service_record(disambiguation, 2_000);
        put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert_eq!(
            set_clause_count(&db, &first_id, "last_seen").await,
            1,
            "last_seen changed, so it must actually have been Set(_)"
        );
        for col in [
            "disambiguation",
            "all_dimensions",
            "logs_streams",
            "traces_streams",
            "metrics_streams",
            "field_name_mapping",
        ] {
            assert_eq!(
                set_clause_count(&db, &first_id, col).await,
                0,
                "{col} did not change and must stay Unchanged(_) even though last_seen updated"
            );
        }
        let row = Entity::find_by_id(first_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.last_seen, 2_000);
    }
}
