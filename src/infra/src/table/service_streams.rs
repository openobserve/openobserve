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

/// Outcome of a [`put`]; a named struct so call sites cannot positionally confuse the two facts.
#[must_use]
#[derive(Debug, Clone)]
pub struct PutOutcome {
    /// `disambiguation` JSON of each orphaned lower-specificity row this put deleted (F19).
    pub orphans: Vec<serde_json::Value>,
    /// True iff a data column changed, a row inserted, or an orphan deleted; not last_seen alone.
    pub changed: bool,
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

/// Upsert a service record; callers gate cache-invalidation events on `PutOutcome::changed`.
pub async fn put(
    org_id: &str,
    record: ServiceRecord,
    max_streams_per_type: usize,
) -> Result<PutOutcome, errors::Error> {
    let client = get_orm_client_rw().await;
    put_with(client, org_id, record, max_streams_per_type).await
}

/// [`put`] against a caller-supplied connection, so tests exercise the exact production code path.
pub async fn put_with<C: sea_orm::ConnectionTrait>(
    client: &C,
    org_id: &str,
    mut record: ServiceRecord,
    max_streams_per_type: usize,
) -> Result<PutOutcome, errors::Error> {
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
        let mut dirty = false;
        set_if_dirty(&mut active.logs_streams, logs, &mut dirty);
        set_if_dirty(&mut active.traces_streams, traces, &mut dirty);
        set_if_dirty(&mut active.metrics_streams, metrics, &mut dirty);
        set_if_dirty(&mut active.all_dimensions, merged_dims, &mut dirty);
        if let Some(fnm) = record.field_name_mapping {
            set_if_dirty(&mut active.field_name_mapping, Some(fnm), &mut dirty);
        }
        active.last_seen = Set(record.last_seen);

        active
            .update(client)
            .await
            .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

        // Delete any orphaned rows that are strict subsets of the row we just updated.
        // These accumulate when a record with fewer disambiguation fields was written before
        // the richer variant existed.
        let orphans = delete_subset_orphans(
            client,
            org_id,
            &record.service_name,
            &record.set_id,
            &incoming_map,
            &kept_id,
        )
        .await?;
        let changed = dirty || !orphans.is_empty();
        Ok(PutOutcome { orphans, changed })
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
            let mut dirty = false;
            set_if_dirty(
                &mut active.disambiguation,
                richer_disambiguation,
                &mut dirty,
            );
            set_if_dirty(&mut active.logs_streams, logs, &mut dirty);
            set_if_dirty(&mut active.traces_streams, traces, &mut dirty);
            set_if_dirty(&mut active.metrics_streams, metrics, &mut dirty);
            set_if_dirty(&mut active.all_dimensions, merged_dims, &mut dirty);
            if let Some(fnm) = record.field_name_mapping {
                set_if_dirty(&mut active.field_name_mapping, Some(fnm), &mut dirty);
            }
            active.last_seen = Set(record.last_seen);

            active
                .update(client)
                .await
                .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

            // Clean up any other orphaned subset rows for this service (same set_id)
            let orphans = delete_subset_orphans(
                client,
                org_id,
                &record.service_name,
                &record.set_id,
                richer_map,
                &kept_id,
            )
            .await?;
            let changed = dirty || !orphans.is_empty();
            Ok(PutOutcome { orphans, changed })
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

            // Plain insert: nothing was orphaned, and a new row is always a mutation.
            Ok(PutOutcome {
                orphans: Vec::new(),
                changed: true,
            })
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

/// Compares typed values, never serialized text: preserve_order builds would spuriously differ.
fn set_if_dirty<T: Into<sea_orm::Value> + PartialEq>(
    slot: &mut sea_orm::ActiveValue<T>,
    computed: T,
    dirty: &mut bool,
) {
    if matches!(slot, sea_orm::ActiveValue::Unchanged(stored) if *stored == computed) {
        return;
    }
    *slot = Set(computed);
    *dirty = true;
}

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

    // Nothing enforces this list — keep it in sync manually when adding a mutable column.
    const MUTABLE_COLUMNS: [&str; 7] = [
        "disambiguation",
        "all_dimensions",
        "logs_streams",
        "traces_streams",
        "metrics_streams",
        "field_name_mapping",
        "last_seen",
    ];

    /// AFTER UPDATE OF a col fires iff it is in the SET clause, which holds only Set(_) fields.
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

    /// SET-clause appearances of `col` against `id`, regardless of the assigned value.
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

    /// Zero iff no UPDATE named an audited column (an empty SET clause fires no trigger).
    async fn total_set_clause_hits(db: &sea_orm::DatabaseConnection, id: &str) -> i64 {
        let mut total = 0;
        for col in MUTABLE_COLUMNS {
            total += set_clause_count(db, id, col).await;
        }
        total
    }

    /// Deliberately non-degenerate: every mergeable field is populated so no-op checks bite.
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

    // The fix must compare serde_json::Value equality, not JSON text: prod enables preserve_order.

    // last_seen is always Set (out of scope), so an UPDATE still occurs; data columns must not.
    #[tokio::test]
    async fn exact_repeat_call_sets_no_data_columns() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();

        let _ = put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();
        assert_eq!(
            total_set_clause_hits(&db, &first_id).await,
            0,
            "insert is not an UPDATE"
        );

        let repeat = service_record(disambiguation, 1_000);
        let _ = put_with(&db, "org1", repeat, DEFAULT_MAX_STREAMS_PER_TYPE)
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

    // Only traces_streams grows, so only it and always-written last_seen may reach the SET clause.
    #[tokio::test]
    async fn partial_change_updates_only_when_a_field_actually_differs() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        let _ = put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        let mut second = service_record(disambiguation, 1_000);
        second.traces_streams =
            serde_json::json!(["checkout-service-traces", "checkout-service-traces-v2"]);
        let _ = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert_eq!(
            set_clause_count(&db, &first_id, "traces_streams").await,
            1,
            "traces_streams grew, so it must have been Set(_) on the ActiveModel"
        );
        // Same-value guard: last_seen stays Set(_) every call, catching a fix that skips it.
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

    // disambiguation must stay 0: the exact-match branch never assigns it, only upgrade does.
    #[tokio::test]
    async fn full_change_updates_and_persists_every_new_value() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        let _ = put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
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
        let _ = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
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
        assert_eq!(
            row.metrics_streams,
            serde_json::json!(["checkout-service-metrics", "checkout-service-metrics-v2"]),
            "metrics_streams unions rather than replaces — existing entries are kept"
        );
        assert_eq!(row.last_seen, 2_000);
        assert_eq!(
            row.field_name_mapping,
            Some(serde_json::json!({"service": "kubernetes_labels_app_v2"}))
        );
    }

    // Incoming None must preserve the stored mapping and not itself force a rewrite.
    #[tokio::test]
    async fn field_name_mapping_none_preserves_existing_value_and_is_a_noop_field() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        let _ = put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        let mut second = service_record(disambiguation, 1_000);
        second.field_name_mapping = None;
        let _ = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
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

    #[tokio::test]
    async fn field_name_mapping_identical_some_is_a_noop_field() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        let _ = put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        // Identical to service_record()'s default field_name_mapping.
        let second = service_record(disambiguation, 1_000);
        let _ = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert_eq!(
            set_clause_count(&db, &first_id, "field_name_mapping").await,
            0,
            "identical Some(..) field_name_mapping must not force a rewrite"
        );
    }

    #[tokio::test]
    async fn field_name_mapping_changed_some_updates() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        let _ = put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        let mut second = service_record(disambiguation, 1_000);
        second.field_name_mapping = Some(serde_json::json!({"service": "different_raw_field"}));
        let _ = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
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

    // Subset incoming resolves richer_disambiguation to the stored value: rewrite nothing.
    #[tokio::test]
    async fn upgrade_branch_subset_incoming_leaves_richer_disambiguation_untouched() {
        let db = db().await;
        let richer = service_record(
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"}),
            1_000,
        );
        let richer_id = richer.id.clone();
        let _ = put_with(&db, "org1", richer, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        let subset = service_record(serde_json::json!({"k8s-cluster": "prod"}), 1_000);
        let _ = put_with(&db, "org1", subset, DEFAULT_MAX_STREAMS_PER_TYPE)
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

    #[tokio::test]
    async fn upgrade_branch_richer_incoming_updates_disambiguation() {
        let db = db().await;
        let sparse = service_record(serde_json::json!({"k8s-cluster": "prod"}), 1_000);
        let sparse_id = sparse.id.clone();
        let _ = put_with(&db, "org1", sparse, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        // The extra stream and newer last_seen catch an upgrade branch that stops writing them.
        let mut richer = service_record(
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"}),
            2_000,
        );
        richer.traces_streams =
            serde_json::json!(["checkout-service-traces", "checkout-service-traces-v2"]);
        let _ = put_with(&db, "org1", richer, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert_eq!(
            set_clause_count(&db, &sparse_id, "disambiguation").await,
            1,
            "the incoming row is richer, so disambiguation must actually have been Set(_)"
        );
        assert_eq!(
            set_clause_count(&db, &sparse_id, "traces_streams").await,
            1,
            "the union gained a stream, so the upgrade branch must have Set(_) traces_streams"
        );
        assert_eq!(
            set_clause_count(&db, &sparse_id, "last_seen").await,
            1,
            "the upgrade branch must keep writing last_seen"
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
        assert_eq!(
            row.traces_streams,
            serde_json::json!(["checkout-service-traces", "checkout-service-traces-v2"]),
            "the upgrade must persist the stream union, not discard it"
        );
        assert_eq!(row.last_seen, 2_000);
    }

    #[tokio::test]
    async fn plain_insert_is_unaffected_and_is_not_an_update() {
        let db = db().await;
        let record = service_record(serde_json::json!({"k8s-cluster": "prod"}), 1_000);
        let id = record.id.clone();

        let outcome = put_with(&db, "org1", record, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(outcome.orphans.is_empty(), "a plain insert orphans nothing");
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

    // Guards "never writes last_seen" only; the same-value guard is in the partial-change test.
    #[tokio::test]
    async fn last_seen_always_updates_even_when_nothing_else_changed() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        let _ = put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        let second = service_record(disambiguation, 2_000);
        let _ = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
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

    // Raw incoming differs but union(stored, subset) == stored: the fix must compare the merge.
    #[tokio::test]
    async fn subset_incoming_streams_are_a_noop() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let mut first = service_record(disambiguation.clone(), 1_000);
        first.logs_streams =
            serde_json::json!(["checkout-service-logs", "checkout-service-logs-v2"]);
        first.traces_streams =
            serde_json::json!(["checkout-service-traces", "checkout-service-traces-v2"]);
        first.metrics_streams =
            serde_json::json!(["checkout-service-metrics", "checkout-service-metrics-v2"]);
        let first_id = first.id.clone();
        let _ = put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        // service_record()'s 1-element stream arrays are strict subsets of what is now stored.
        let mut second = service_record(disambiguation, 2_000);
        second.all_dimensions = serde_json::json!({"k8s-cluster": "prod"});
        let _ = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
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
                "{col}: its merged value equals what is stored, so it must never have been Set(_)"
            );
        }
        assert_eq!(
            set_clause_count(&db, &first_id, "last_seen").await,
            1,
            "last_seen is always written, in or out of the no-op set"
        );
        let row = Entity::find_by_id(first_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.logs_streams,
            serde_json::json!(["checkout-service-logs", "checkout-service-logs-v2"]),
            "the stored superset must survive a subset put untouched"
        );
    }

    // union_dimension_objects is base-wins, so same-keys/new-values merges back to stored.
    #[tokio::test]
    async fn same_keys_different_values_all_dimensions_is_a_noop() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let first = service_record(disambiguation.clone(), 1_000);
        let first_id = first.id.clone();
        let _ = put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        // Same keys as stored ({"k8s-cluster", "k8s-namespace"}), every value different.
        let mut second = service_record(disambiguation, 1_000);
        second.all_dimensions =
            serde_json::json!({"k8s-cluster": "staging", "k8s-namespace": "legacy"});
        let _ = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert_eq!(
            set_clause_count(&db, &first_id, "all_dimensions").await,
            0,
            "base-wins merge resolves to the stored value, so all_dimensions must never have been Set(_)"
        );
        assert_eq!(
            set_clause_count(&db, &first_id, "last_seen").await,
            1,
            "last_seen is always written, in or out of the no-op set"
        );
        let row = Entity::find_by_id(first_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.all_dimensions,
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"}),
            "stored values win over conflicting incoming values"
        );
    }

    // If a pure no-op reported changed, every flush would still invalidate cluster caches.
    #[tokio::test]
    async fn exact_repeat_noop_reports_changed_false() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let _ = put_with(
            &db,
            "org1",
            service_record(disambiguation.clone(), 1_000),
            DEFAULT_MAX_STREAMS_PER_TYPE,
        )
        .await
        .unwrap();

        let outcome = put_with(
            &db,
            "org1",
            service_record(disambiguation, 1_000),
            DEFAULT_MAX_STREAMS_PER_TYPE,
        )
        .await
        .unwrap();

        assert!(
            outcome.orphans.is_empty(),
            "an exact repeat orphans nothing"
        );
        assert!(
            !outcome.changed,
            "no data column changed, so the call must not report changed"
        );
    }

    // last_seen-only writes must NOT count as changed, else every call still invalidates.
    #[tokio::test]
    async fn subset_incoming_noop_reports_changed_false() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let mut first = service_record(disambiguation.clone(), 1_000);
        first.logs_streams =
            serde_json::json!(["checkout-service-logs", "checkout-service-logs-v2"]);
        first.traces_streams =
            serde_json::json!(["checkout-service-traces", "checkout-service-traces-v2"]);
        first.metrics_streams =
            serde_json::json!(["checkout-service-metrics", "checkout-service-metrics-v2"]);
        let _ = put_with(&db, "org1", first, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        // Every incoming field merges back to the stored value; only last_seen differs.
        let mut second = service_record(disambiguation, 2_000);
        second.all_dimensions = serde_json::json!({"k8s-cluster": "prod"});
        let outcome = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(outcome.orphans.is_empty(), "a subset put orphans nothing");
        assert!(
            !outcome.changed,
            "only last_seen was written, which must not count as changed"
        );
    }

    #[tokio::test]
    async fn partial_change_reports_changed_true() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let _ = put_with(
            &db,
            "org1",
            service_record(disambiguation.clone(), 1_000),
            DEFAULT_MAX_STREAMS_PER_TYPE,
        )
        .await
        .unwrap();

        let mut second = service_record(disambiguation, 1_000);
        second.traces_streams =
            serde_json::json!(["checkout-service-traces", "checkout-service-traces-v2"]);
        let outcome = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(
            outcome.changed,
            "traces_streams genuinely grew, so the call must report changed"
        );
    }

    // Kills the mutant whose changed derivation omits field_name_mapping.
    #[tokio::test]
    async fn field_name_mapping_only_change_reports_changed_true() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let _ = put_with(
            &db,
            "org1",
            service_record(disambiguation.clone(), 1_000),
            DEFAULT_MAX_STREAMS_PER_TYPE,
        )
        .await
        .unwrap();

        let mut second = service_record(disambiguation, 1_000);
        second.field_name_mapping = Some(serde_json::json!({"service": "different_raw_field"}));
        let outcome = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(
            outcome.changed,
            "field_name_mapping is the only field that differs and it must count as changed"
        );
    }

    // A NEW key survives the base-wins union, so this is a genuine all_dimensions change.
    #[tokio::test]
    async fn all_dimensions_only_change_reports_changed_true() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let _ = put_with(
            &db,
            "org1",
            service_record(disambiguation.clone(), 1_000),
            DEFAULT_MAX_STREAMS_PER_TYPE,
        )
        .await
        .unwrap();

        let mut second = service_record(disambiguation, 1_000);
        second.all_dimensions = serde_json::json!({
            "k8s-cluster": "prod",
            "k8s-namespace": "ecommerce",
            "k8s-region": "us-east-1"
        });
        let outcome = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(
            outcome.changed,
            "the merged all_dimensions gained a key, so the call must report changed"
        );
    }

    // Metrics varies alone, so a typo'd comparand triplicating logs/traces cannot survive.
    #[tokio::test]
    async fn metrics_streams_only_change_reports_changed_true() {
        let db = db().await;
        let disambiguation = serde_json::json!({"k8s-cluster": "prod"});
        let _ = put_with(
            &db,
            "org1",
            service_record(disambiguation.clone(), 1_000),
            DEFAULT_MAX_STREAMS_PER_TYPE,
        )
        .await
        .unwrap();

        let mut second = service_record(disambiguation, 1_000);
        second.metrics_streams =
            serde_json::json!(["checkout-service-metrics", "checkout-service-metrics-v2"]);
        let outcome = put_with(&db, "org1", second, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(
            outcome.changed,
            "metrics_streams is the only field that grew and it must count as changed"
        );
    }

    #[tokio::test]
    async fn plain_insert_reports_changed_true() {
        let db = db().await;
        let record = service_record(serde_json::json!({"k8s-cluster": "prod"}), 1_000);

        let outcome = put_with(&db, "org1", record, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(outcome.orphans.is_empty(), "a plain insert orphans nothing");
        assert!(outcome.changed, "a new row is always a mutation");
    }

    // Subset incoming resolves every field to the stored value in the upgrade branch too.
    #[tokio::test]
    async fn upgrade_branch_identical_resolution_reports_changed_false() {
        let db = db().await;
        let richer = service_record(
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"}),
            1_000,
        );
        let richer_id = richer.id.clone();
        let _ = put_with(&db, "org1", richer, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        // last_seen differs so a mutant deriving changed from its delta cannot survive here.
        let subset = service_record(serde_json::json!({"k8s-cluster": "prod"}), 2_000);
        let outcome = put_with(&db, "org1", subset, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(
            outcome.orphans.is_empty(),
            "the only row is the kept one, so nothing is orphaned"
        );
        let row = Entity::find_by_id(richer_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.last_seen, 2_000,
            "changed=false must not mean the UPDATE was skipped — last_seen still persists"
        );
        assert!(
            !outcome.changed,
            "every data field resolved to the stored value; last_seen alone must not count as changed"
        );
    }

    #[tokio::test]
    async fn upgrade_branch_richer_incoming_reports_changed_true() {
        let db = db().await;
        let sparse = service_record(serde_json::json!({"k8s-cluster": "prod"}), 1_000);
        let _ = put_with(&db, "org1", sparse, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        let richer = service_record(
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"}),
            2_000,
        );
        let outcome = put_with(&db, "org1", richer, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(
            outcome.changed,
            "disambiguation was upgraded to the richer incoming value, so the call must report changed"
        );
    }

    // Kills the mutant whose upgrade branch derives changed from disambiguation alone.
    #[tokio::test]
    async fn upgrade_branch_new_stream_reports_changed_true() {
        let db = db().await;
        let richer = service_record(
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"}),
            1_000,
        );
        let _ = put_with(&db, "org1", richer, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        // Case-B upgrade: disambiguation resolves to stored, but logs_streams gains an entry.
        let mut subset = service_record(serde_json::json!({"k8s-cluster": "prod"}), 1_000);
        subset.logs_streams =
            serde_json::json!(["checkout-service-logs", "checkout-service-logs-v2"]);
        let outcome = put_with(&db, "org1", subset, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(
            outcome.changed,
            "the stream union gained an entry, so the upgrade branch must report changed"
        );
    }

    // Upgrade twin of the fnm-only case: a copy-paste derivation dropping fnm there must die.
    #[tokio::test]
    async fn upgrade_branch_fnm_only_change_reports_changed_true() {
        let db = db().await;
        let richer = service_record(
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"}),
            1_000,
        );
        let _ = put_with(&db, "org1", richer, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        // Case-B upgrade: streams, dims, and disambiguation all resolve to stored.
        let mut subset = service_record(serde_json::json!({"k8s-cluster": "prod"}), 1_000);
        subset.field_name_mapping = Some(serde_json::json!({"service": "different_raw_field"}));
        let outcome = put_with(&db, "org1", subset, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(
            outcome.changed,
            "field_name_mapping is the only field that differs and the upgrade branch must count it"
        );
    }

    // Upgrade twin of the dims-only case; a NEW key survives the base-wins union.
    #[tokio::test]
    async fn upgrade_branch_all_dimensions_only_change_reports_changed_true() {
        let db = db().await;
        let richer = service_record(
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"}),
            1_000,
        );
        let _ = put_with(&db, "org1", richer, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        let mut subset = service_record(serde_json::json!({"k8s-cluster": "prod"}), 1_000);
        subset.all_dimensions = serde_json::json!({
            "k8s-cluster": "prod",
            "k8s-namespace": "ecommerce",
            "k8s-region": "us-east-1"
        });
        let outcome = put_with(&db, "org1", subset, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert!(
            outcome.changed,
            "the merged all_dimensions gained a key and the upgrade branch must count it"
        );
    }

    // Pins orphan→changed in the upgrade branch too, not just the exact-match branch.
    #[tokio::test]
    async fn upgrade_branch_orphan_deletion_on_noop_reports_changed_true() {
        let db = db().await;
        let richer = service_record(
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"}),
            1_000,
        );
        let richer_id = richer.id.clone();
        let _ = put_with(&db, "org1", richer, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        // Disjoint from the incoming subset so the put cannot exact-match or upgrade this row.
        let orphan = ActiveModel {
            id: Set(svix_ksuid::Ksuid::new(None, None).to_string()),
            org_id: Set("org1".to_owned()),
            service_name: Set("checkout-service".to_owned()),
            set_id: Set("k8s".to_owned()),
            disambiguation: Set(serde_json::json!({"k8s-namespace": "ecommerce"})),
            all_dimensions: Set(serde_json::json!({})),
            logs_streams: Set(serde_json::json!([])),
            traces_streams: Set(serde_json::json!([])),
            metrics_streams: Set(serde_json::json!([])),
            field_name_mapping: Set(None),
            last_seen: Set(500),
        };
        Entity::insert(orphan).exec(&db).await.unwrap();

        // Case-B upgrade whose kept-row fields all resolve to stored; only the orphan dies.
        let subset = service_record(serde_json::json!({"k8s-cluster": "prod"}), 2_000);
        let outcome = put_with(&db, "org1", subset, DEFAULT_MAX_STREAMS_PER_TYPE)
            .await
            .unwrap();

        assert_eq!(
            outcome.orphans,
            vec![serde_json::json!({"k8s-namespace": "ecommerce"})],
            "the seeded strict-subset row must be deleted as an orphan"
        );
        let row = Entity::find_by_id(richer_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            row.last_seen, 2_000,
            "the upgrade-branch no-op must still persist last_seen"
        );
        assert!(
            outcome.changed,
            "the upgrade branch deleted a row, so caches must evict its key"
        );
    }

    // Orphan deletion is a mutation: only the caller's put event makes nodes drop the dead key.
    #[tokio::test]
    async fn orphan_deletion_on_noop_update_reports_changed_true() {
        let db = db().await;
        let richer_disambiguation =
            serde_json::json!({"k8s-cluster": "prod", "k8s-namespace": "ecommerce"});
        let _ = put_with(
            &db,
            "org1",
            service_record(richer_disambiguation.clone(), 1_000),
            DEFAULT_MAX_STREAMS_PER_TYPE,
        )
        .await
        .unwrap();

        // Seeded directly: put() upgrade-merges subsets, so legacy orphans can only pre-exist.
        let orphan = ActiveModel {
            id: Set(svix_ksuid::Ksuid::new(None, None).to_string()),
            org_id: Set("org1".to_owned()),
            service_name: Set("checkout-service".to_owned()),
            set_id: Set("k8s".to_owned()),
            disambiguation: Set(serde_json::json!({"k8s-cluster": "prod"})),
            all_dimensions: Set(serde_json::json!({})),
            logs_streams: Set(serde_json::json!([])),
            traces_streams: Set(serde_json::json!([])),
            metrics_streams: Set(serde_json::json!([])),
            field_name_mapping: Set(None),
            last_seen: Set(500),
        };
        Entity::insert(orphan).exec(&db).await.unwrap();

        let outcome = put_with(
            &db,
            "org1",
            service_record(richer_disambiguation, 1_000),
            DEFAULT_MAX_STREAMS_PER_TYPE,
        )
        .await
        .unwrap();

        assert_eq!(
            outcome.orphans,
            vec![serde_json::json!({"k8s-cluster": "prod"})],
            "the seeded subset row must be deleted as an orphan"
        );
        assert!(
            outcome.changed,
            "a row was deleted, so caches must evict its key even though the kept row was a no-op"
        );
    }
}
