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

use super::get_lock;
use crate::{
    db::{ORM_CLIENT, ORM_CLIENT_DDL, connect_to_orm, connect_to_orm_ddl},
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
    let client = ORM_CLIENT_DDL.get_or_init(connect_to_orm_ddl).await;
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

pub async fn put(org_id: &str, mut record: ServiceRecord) -> Result<(), errors::Error> {
    // Normalize disambiguation to sorted-key JSON so that text comparisons in SQLite
    // are stable regardless of insertion order of the original object.
    record.disambiguation = normalize_json_object(record.disambiguation);

    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

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
        let logs = union_stream_array(&existing_model.logs_streams, &record.logs_streams);
        let traces = union_stream_array(&existing_model.traces_streams, &record.traces_streams);
        let metrics = union_stream_array(&existing_model.metrics_streams, &record.metrics_streams);

        let mut active: ActiveModel = existing_model.into();
        active.logs_streams = Set(logs);
        active.traces_streams = Set(traces);
        active.metrics_streams = Set(metrics);
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
        .await?;
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
            let logs = union_stream_array(&existing_model.logs_streams, &record.logs_streams);
            let traces = union_stream_array(&existing_model.traces_streams, &record.traces_streams);
            let metrics =
                union_stream_array(&existing_model.metrics_streams, &record.metrics_streams);

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

            let mut active: ActiveModel = existing_model.into();
            active.disambiguation = Set(richer_disambiguation);
            active.logs_streams = Set(logs);
            active.traces_streams = Set(traces);
            active.metrics_streams = Set(metrics);
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
            .await?;
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
        }
    }

    Ok(())
}

/// Delete rows for `service_name` that are strict subsets of `richer_map`, excluding `keep_id`.
/// Called after a successful put/upgrade to clean up orphaned lower-specificity rows.
async fn delete_subset_orphans(
    client: &sea_orm::DatabaseConnection,
    org_id: &str,
    service_name: &str,
    set_id: &str,
    richer_map: &std::collections::HashMap<String, String>,
    keep_id: &str,
) -> Result<(), errors::Error> {
    let candidates = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ServiceName.eq(service_name))
        .filter(Column::SetId.eq(set_id))
        .all(client)
        .await
        .map_err(|e| errors::Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;

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
            Entity::delete_by_id(row.id)
                .exec(client)
                .await
                .map_err(|e| errors::Error::DbError(errors::DbError::SeaORMError(e.to_string())))?;
        }
    }
    Ok(())
}

fn union_stream_array(existing: &serde_json::Value, new: &serde_json::Value) -> serde_json::Value {
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
    serde_json::Value::Array(result)
}

/// List all services for an organization
pub async fn list(org_id: &str) -> Result<Vec<ServiceRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

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
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

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
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

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
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

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
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(result.rows_affected)
}

/// List distinct organization IDs that have service_streams records
pub async fn list_distinct_orgs() -> Result<Vec<String>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
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
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

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
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

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
        let result = union_stream_array(&existing, &new);
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
        let result = union_stream_array(&existing, &new);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
    }

    #[test]
    fn test_union_stream_array_deduplicates_existing() {
        let existing = serde_json::json!(["a", "a", "b"]);
        let new = serde_json::json!([]);
        let result = union_stream_array(&existing, &new);
        let arr = result.as_array().unwrap();
        assert_eq!(arr.len(), 2);
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
}
