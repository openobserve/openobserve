// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, QueryFilter, Schema, Set,
    entity::prelude::*,
};
use serde::{Deserialize, Serialize};
use svix_ksuid::KsuidLike;

use super::get_lock;
use crate::{
    db::{ORM_CLIENT, ORM_CLIENT_DDL, connect_to_orm, connect_to_orm_ddl},
    errors::{self, DbError, Error},
};

/// Service Streams Table
///
/// Stores services with their metadata, dimensions, and associated streams.
/// Primary key: id (KSUID)
/// Unique index: (org_id, service_key)
///
/// service_key format: "service_name?dimension1=value1&dimension2=value2"
/// Example: "api-server?environment=production&host=server01"
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "service_streams")]
pub struct Model {
    /// 27-character human readable KSUID
    #[sea_orm(
        primary_key,
        column_type = "String(StringLen::N(27))",
        auto_increment = false
    )]
    pub id: String,

    #[sea_orm(column_type = "String(StringLen::N(128))")]
    pub org_id: String,

    #[sea_orm(column_type = "String(StringLen::N(512))")]
    pub service_key: String,

    /// Correlation key (hash of stable dimensions only)
    /// Used as the primary identity for grouping services and preventing DB explosion
    #[sea_orm(column_type = "String(StringLen::N(64))", default_value = "")]
    pub correlation_key: String,

    /// Service name (e.g., "api-server", "web-server")
    #[sea_orm(column_type = "String(StringLen::N(256))")]
    pub service_name: String,

    /// Dimensions as JSON: {"environment": "production", "version": "1.0"}
    #[sea_orm(column_type = "Text")]
    pub dimensions: String,

    /// Streams as JSON: {"logs": [...], "metrics": [...], "traces": [...]}
    #[sea_orm(column_type = "Text")]
    pub streams: String,

    /// When this service was first discovered (microseconds since epoch)
    pub first_seen: i64,

    /// When this service was last seen (microseconds since epoch)
    pub last_seen: i64,

    /// Additional metadata as JSON (optional)
    #[sea_orm(column_type = "Text", nullable)]
    pub metadata: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter)]
pub enum Relation {}

impl RelationTrait for Relation {
    fn def(&self) -> RelationDef {
        panic!("No relations defined")
    }
}

impl ActiveModelBehavior for ActiveModel {}

/// Service record for cross-region synchronization.
/// Clone is required for super-cluster queue message serialization.
#[derive(FromQueryResult, Debug, Clone, Serialize, Deserialize)]
pub struct ServiceRecord {
    pub org_id: String,
    pub service_key: String,
    pub correlation_key: String,
    pub service_name: String,
    pub dimensions: String,
    pub streams: String,
    pub first_seen: i64,
    pub last_seen: i64,
    pub metadata: Option<String>,
}

impl ServiceRecord {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        org_id: &str,
        service_key: &str,
        correlation_key: &str,
        service_name: &str,
        dimensions: &str,
        streams: &str,
        first_seen: i64,
        last_seen: i64,
    ) -> Self {
        Self {
            org_id: org_id.to_owned(),
            service_key: service_key.to_owned(),
            correlation_key: correlation_key.to_owned(),
            service_name: service_name.to_owned(),
            dimensions: dimensions.to_owned(),
            streams: streams.to_owned(),
            first_seen,
            last_seen,
            metadata: None,
        }
    }
}

pub async fn init() -> Result<(), errors::Error> {
    create_table().await?;
    Ok(())
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

/// Add or update a service (upsert)
///
/// IMPORTANT: When updating an existing record, streams are MERGED (not overwritten)
/// to prevent race conditions between multiple ingesters. This ensures that logs
/// discovered by one ingester are not lost when another ingester updates the same
/// service with traces/metrics.
pub async fn put(record: ServiceRecord) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let service_name_for_log = record.service_name.clone();
    log::debug!(
        "[SERVICE_STREAMS] put () called for org={} service={} correlation_key={} incoming_streams={}",
        record.org_id,
        service_name_for_log,
        record.correlation_key,
        record.streams
    );

    // Try to find existing record by unique constraint (org_id, correlation_key)
    // This ensures services with the same stable dimensions are deduplicated
    let existing = Entity::find()
        .filter(Column::OrgId.eq(&record.org_id))
        .filter(Column::CorrelationKey.eq(&record.correlation_key))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    if let Some(existing_record) = existing {
        log::debug!(
            "[SERVICE_STREAMS] Found existing record for service={} existing_streams={}",
            service_name_for_log,
            existing_record.streams
        );

        // MERGE streams instead of overwriting to prevent race conditions
        // between multiple ingesters processing different telemetry types
        let merged_streams = merge_streams_json(&existing_record.streams, &record.streams);

        log::debug!(
            "[SERVICE_STREAMS_MERGE] service={}: existing={} + incoming={} => merged={}",
            service_name_for_log,
            existing_record.streams,
            record.streams,
            merged_streams
        );

        // Keep the earliest first_seen and latest last_seen
        let first_seen = existing_record.first_seen.min(record.first_seen);
        let last_seen = existing_record.last_seen.max(record.last_seen);

        // Update existing record with merged streams
        let mut active_model: ActiveModel = existing_record.into();
        active_model.service_key = Set(record.service_key);
        active_model.correlation_key = Set(record.correlation_key);
        active_model.service_name = Set(record.service_name);
        active_model.dimensions = Set(record.dimensions);
        active_model.streams = Set(merged_streams);
        active_model.first_seen = Set(first_seen);
        active_model.last_seen = Set(last_seen);
        active_model.metadata = Set(record.metadata);

        active_model
            .update(client)
            .await
            .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

        log::debug!(
            "[SERVICE_STREAMS] Updated service={} successfully",
            service_name_for_log
        );
    } else {
        log::debug!(
            "[SERVICE_STREAMS] INSERT new service={} correlation_key={} streams={}",
            service_name_for_log,
            record.correlation_key,
            record.streams
        );

        // Insert new record
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let active_model = ActiveModel {
            id: Set(id),
            org_id: Set(record.org_id),
            service_key: Set(record.service_key),
            correlation_key: Set(record.correlation_key),
            service_name: Set(record.service_name),
            dimensions: Set(record.dimensions),
            streams: Set(record.streams),
            first_seen: Set(record.first_seen),
            last_seen: Set(record.last_seen),
            metadata: Set(record.metadata),
        };

        Entity::insert(active_model)
            .exec(client)
            .await
            .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    }

    Ok(())
}

/// Merge two streams JSON objects, combining logs/traces/metrics arrays
///
/// This prevents race conditions where one ingester overwrites streams
/// discovered by another ingester. The merge is a union operation - all
/// unique streams from both sources are preserved.
fn merge_streams_json(existing_json: &str, new_json: &str) -> String {
    use std::collections::HashSet;

    // Parse both JSON strings
    let existing: serde_json::Value = serde_json::from_str(existing_json).unwrap_or_default();
    let new: serde_json::Value = serde_json::from_str(new_json).unwrap_or_default();

    // Helper to merge arrays as sets (by stream_name to deduplicate)
    let merge_array =
        |existing_arr: &serde_json::Value, new_arr: &serde_json::Value| -> Vec<serde_json::Value> {
            let mut seen: HashSet<String> = HashSet::new();
            let mut result: Vec<serde_json::Value> = Vec::new();

            // Add all existing streams
            if let Some(arr) = existing_arr.as_array() {
                for item in arr {
                    // Use stream_name as dedup key, or serialize the whole object
                    let key = item
                        .get("stream_name")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| item.to_string());
                    if seen.insert(key) {
                        result.push(item.clone());
                    }
                }
            }

            // Add new streams that don't already exist
            if let Some(arr) = new_arr.as_array() {
                for item in arr {
                    let key = item
                        .get("stream_name")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| item.to_string());
                    if seen.insert(key) {
                        result.push(item.clone());
                    }
                }
            }

            result
        };

    // Merge each stream type
    let logs = merge_array(
        existing.get("logs").unwrap_or(&serde_json::Value::Null),
        new.get("logs").unwrap_or(&serde_json::Value::Null),
    );
    let traces = merge_array(
        existing.get("traces").unwrap_or(&serde_json::Value::Null),
        new.get("traces").unwrap_or(&serde_json::Value::Null),
    );
    let metrics = merge_array(
        existing.get("metrics").unwrap_or(&serde_json::Value::Null),
        new.get("metrics").unwrap_or(&serde_json::Value::Null),
    );

    // Build merged result
    let merged = serde_json::json!({
        "logs": logs,
        "traces": traces,
        "metrics": metrics
    });

    merged.to_string()
}

/// Get a specific service
pub async fn get(org_id: &str, service_key: &str) -> Result<Option<ServiceRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let record = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ServiceKey.eq(service_key))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(record.map(|r| ServiceRecord {
        org_id: r.org_id,
        service_key: r.service_key,
        correlation_key: r.correlation_key,
        service_name: r.service_name,
        dimensions: r.dimensions,
        streams: r.streams,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        metadata: r.metadata,
    }))
}

/// List all services for an organization
pub async fn list(org_id: &str) -> Result<Vec<ServiceRecord>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let records = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(records
        .into_iter()
        .map(|r| ServiceRecord {
            org_id: r.org_id,
            service_key: r.service_key,
            correlation_key: r.correlation_key,
            service_name: r.service_name,
            dimensions: r.dimensions,
            streams: r.streams,
            first_seen: r.first_seen,
            last_seen: r.last_seen,
            metadata: r.metadata,
        })
        .collect())
}

/// List services by service name (across all dimension combinations)
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

    Ok(records
        .into_iter()
        .map(|r| ServiceRecord {
            org_id: r.org_id,
            service_key: r.service_key,
            correlation_key: r.correlation_key,
            service_name: r.service_name,
            dimensions: r.dimensions,
            streams: r.streams,
            first_seen: r.first_seen,
            last_seen: r.last_seen,
            metadata: r.metadata,
        })
        .collect())
}

/// Delete a specific service
pub async fn delete(org_id: &str, service_key: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ServiceKey.eq(service_key))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Delete all services for an organization
pub async fn delete_all(org_id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Get total count of services for an organization
pub async fn count(org_id: &str) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .count(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merge_streams_json_empty() {
        let existing = r#"{"logs":[],"traces":[],"metrics":[]}"#;
        let new = r#"{"logs":[],"traces":[],"metrics":[]}"#;

        let merged = merge_streams_json(existing, new);
        let parsed: serde_json::Value = serde_json::from_str(&merged).unwrap();

        assert_eq!(parsed["logs"].as_array().unwrap().len(), 0);
        assert_eq!(parsed["traces"].as_array().unwrap().len(), 0);
        assert_eq!(parsed["metrics"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn test_merge_streams_json_logs_only_existing() {
        let existing =
            r#"{"logs":[{"stream_name":"default","filters":{}}],"traces":[],"metrics":[]}"#;
        let new = r#"{"logs":[],"traces":[],"metrics":[]}"#;

        let merged = merge_streams_json(existing, new);
        let parsed: serde_json::Value = serde_json::from_str(&merged).unwrap();

        assert_eq!(parsed["logs"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["logs"][0]["stream_name"], "default");
    }

    #[test]
    fn test_merge_streams_json_logs_only_new() {
        let existing = r#"{"logs":[],"traces":[],"metrics":[]}"#;
        let new = r#"{"logs":[{"stream_name":"default","filters":{}}],"traces":[],"metrics":[]}"#;

        let merged = merge_streams_json(existing, new);
        let parsed: serde_json::Value = serde_json::from_str(&merged).unwrap();

        assert_eq!(parsed["logs"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["logs"][0]["stream_name"], "default");
    }

    #[test]
    fn test_merge_streams_json_different_types() {
        // Simulates: Ingester 1 has logs, Ingester 2 has traces+metrics
        let existing =
            r#"{"logs":[{"stream_name":"default","filters":{}}],"traces":[],"metrics":[]}"#;
        let new = r#"{"logs":[],"traces":[{"stream_name":"default","filters":{}}],"metrics":[{"stream_name":"otel_metrics","filters":{}}]}"#;

        let merged = merge_streams_json(existing, new);
        let parsed: serde_json::Value = serde_json::from_str(&merged).unwrap();

        // Should have all three types merged
        assert_eq!(parsed["logs"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["traces"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["metrics"].as_array().unwrap().len(), 1);
        assert_eq!(parsed["logs"][0]["stream_name"], "default");
        assert_eq!(parsed["traces"][0]["stream_name"], "default");
        assert_eq!(parsed["metrics"][0]["stream_name"], "otel_metrics");
    }

    #[test]
    fn test_merge_streams_json_deduplication() {
        // Both have the same stream - should deduplicate
        let existing = r#"{"logs":[{"stream_name":"default","filters":{"k8s_cluster":"prod"}}],"traces":[],"metrics":[]}"#;
        let new = r#"{"logs":[{"stream_name":"default","filters":{"k8s_cluster":"staging"}}],"traces":[],"metrics":[]}"#;

        let merged = merge_streams_json(existing, new);
        let parsed: serde_json::Value = serde_json::from_str(&merged).unwrap();

        // Should have only 1 log stream (deduplicated by stream_name)
        assert_eq!(parsed["logs"].as_array().unwrap().len(), 1);
        // Existing wins (first one added)
        assert_eq!(parsed["logs"][0]["filters"]["k8s_cluster"], "prod");
    }

    #[test]
    fn test_merge_streams_json_multiple_streams_same_type() {
        let existing =
            r#"{"logs":[{"stream_name":"app_logs","filters":{}}],"traces":[],"metrics":[]}"#;
        let new =
            r#"{"logs":[{"stream_name":"system_logs","filters":{}}],"traces":[],"metrics":[]}"#;

        let merged = merge_streams_json(existing, new);
        let parsed: serde_json::Value = serde_json::from_str(&merged).unwrap();

        // Should have both streams (different names)
        assert_eq!(parsed["logs"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_merge_streams_json_race_condition_scenario() {
        // Simulates the exact race condition:
        // Ingester 1 discovers logs for service
        // Ingester 2 discovers traces and metrics for same service
        // Without merge, last write wins and logs are lost

        let ingester1_writes = r#"{"logs":[{"stream_name":"default","stream_type":"Logs","filters":{"service":"openobserve"}}],"traces":[],"metrics":[]}"#;
        let ingester2_writes = r#"{"logs":[],"traces":[{"stream_name":"default","stream_type":"Traces","filters":{"service":"openobserve"}}],"metrics":[{"stream_name":"otel_collector_metrics","stream_type":"Metrics","filters":{}}]}"#;

        // Ingester 2's write merges with Ingester 1's data
        let merged = merge_streams_json(ingester1_writes, ingester2_writes);
        let parsed: serde_json::Value = serde_json::from_str(&merged).unwrap();

        // All telemetry types should be preserved
        assert_eq!(
            parsed["logs"].as_array().unwrap().len(),
            1,
            "Logs should be preserved after merge"
        );
        assert_eq!(
            parsed["traces"].as_array().unwrap().len(),
            1,
            "Traces should be added"
        );
        assert_eq!(
            parsed["metrics"].as_array().unwrap().len(),
            1,
            "Metrics should be added"
        );
    }

    #[test]
    fn test_merge_streams_json_malformed_input() {
        // Handle malformed JSON gracefully
        let existing = "not valid json";
        let new = r#"{"logs":[{"stream_name":"default"}],"traces":[],"metrics":[]}"#;

        let merged = merge_streams_json(existing, new);
        let parsed: serde_json::Value = serde_json::from_str(&merged).unwrap();

        // Should still work, treating existing as empty
        assert_eq!(parsed["logs"].as_array().unwrap().len(), 1);
    }
}
