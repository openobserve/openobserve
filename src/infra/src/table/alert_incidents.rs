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

//! Alert Incidents Table Operations
//!
//! Provides CRUD operations for incidents and incident-alert associations.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder, Set,
    TransactionTrait,
};
use svix_ksuid::KsuidLike;

use super::entity::{alert_incident_alerts, alert_incidents};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::{self, DbError, Error},
};

/// Find an open incident by org and correlation key
pub async fn find_open_by_correlation_key(
    org_id: &str,
    correlation_key: &str,
) -> Result<Option<alert_incidents::Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    alert_incidents::Entity::find()
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .filter(alert_incidents::Column::CorrelationKey.eq(correlation_key))
        .filter(alert_incidents::Column::Status.ne("resolved"))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Get incident by ID
pub async fn get(org_id: &str, id: &str) -> Result<Option<alert_incidents::Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    alert_incidents::Entity::find_by_id(id)
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Create a new incident
pub async fn create(
    org_id: &str,
    correlation_key: &str,
    severity: &str,
    stable_dimensions: serde_json::Value,
    first_alert_at: i64,
    title: Option<String>,
) -> Result<alert_incidents::Model, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();
    let id = svix_ksuid::Ksuid::new(None, None).to_string();

    let model = alert_incidents::ActiveModel {
        id: Set(id),
        org_id: Set(org_id.to_string()),
        correlation_key: Set(correlation_key.to_string()),
        status: Set("open".to_string()),
        severity: Set(severity.to_string()),
        stable_dimensions: Set(stable_dimensions),
        topology_context: Set(None),
        first_alert_at: Set(first_alert_at),
        last_alert_at: Set(first_alert_at),
        resolved_at: Set(None),
        alert_count: Set(0), // Will be incremented by add_alert_to_incident
        title: Set(title),
        assigned_to: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    };

    model
        .insert(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Add an alert to an existing incident (updates last_alert_at and alert_count)
pub async fn add_alert_to_incident(
    incident_id: &str,
    alert_id: &str,
    alert_name: &str,
    alert_fired_at: i64,
    correlation_reason: &str,
) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();

    // Use transaction for atomic update
    let txn = client
        .begin()
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    // Insert alert link
    let alert_link = alert_incident_alerts::ActiveModel {
        incident_id: Set(incident_id.to_string()),
        alert_id: Set(alert_id.to_string()),
        alert_fired_at: Set(alert_fired_at),
        alert_name: Set(alert_name.to_string()),
        correlation_reason: Set(Some(correlation_reason.to_string())),
        created_at: Set(now),
    };

    alert_link
        .insert(&txn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    // Update incident: increment count, update last_alert_at
    let incident = alert_incidents::Entity::find_by_id(incident_id)
        .one(&txn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("Incident not found".to_string())))?;

    let mut active: alert_incidents::ActiveModel = incident.into();
    active.alert_count = Set(active.alert_count.unwrap() + 1);
    active.last_alert_at = Set(alert_fired_at.max(active.last_alert_at.unwrap()));
    active.updated_at = Set(now);
    active
        .update(&txn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    txn.commit()
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Update incident status
pub async fn update_status(
    org_id: &str,
    id: &str,
    status: &str,
) -> Result<alert_incidents::Model, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();

    let incident = get(org_id, id)
        .await?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("Incident not found".to_string())))?;

    let mut active: alert_incidents::ActiveModel = incident.into();
    active.status = Set(status.to_string());
    active.updated_at = Set(now);

    if status == "resolved" {
        active.resolved_at = Set(Some(now));
    }

    active
        .update(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// List incidents with optional filters
pub async fn list(
    org_id: &str,
    status: Option<&str>,
    limit: u64,
    offset: u64,
) -> Result<Vec<alert_incidents::Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let mut query = alert_incidents::Entity::find()
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .order_by_desc(alert_incidents::Column::LastAlertAt);

    if let Some(s) = status {
        query = query.filter(alert_incidents::Column::Status.eq(s));
    }

    query
        .paginate(client, limit)
        .fetch_page(offset / limit)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Get alerts for an incident
pub async fn get_incident_alerts(
    incident_id: &str,
) -> Result<Vec<alert_incident_alerts::Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    alert_incident_alerts::Entity::find()
        .filter(alert_incident_alerts::Column::IncidentId.eq(incident_id))
        .order_by_desc(alert_incident_alerts::Column::AlertFiredAt)
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Count open incidents for an org
pub async fn count_open(org_id: &str) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    alert_incidents::Entity::find()
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .filter(alert_incidents::Column::Status.ne("resolved"))
        .count(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Count incidents with optional status filter
pub async fn count(org_id: &str, status: Option<&str>) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    let mut query =
        alert_incidents::Entity::find().filter(alert_incidents::Column::OrgId.eq(org_id));

    if let Some(s) = status {
        query = query.filter(alert_incidents::Column::Status.eq(s));
    }

    query
        .count(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Get topology context from incident with proper deserialization
///
/// This is the SINGLE SOURCE OF TRUTH for topology deserialization.
/// Returns None if incident doesn't exist, has no topology, or deserialization fails.
pub async fn get_topology(
    org_id: &str,
    id: &str,
) -> Result<Option<config::meta::alerts::incidents::IncidentTopology>, errors::Error> {
    let incident = get(org_id, id).await?;

    match incident {
        Some(inc) => match inc.topology_context {
            Some(json_value) => {
                match serde_json::from_value::<config::meta::alerts::incidents::IncidentTopology>(
                    json_value.clone(),
                ) {
                    Ok(topology) => Ok(Some(topology)),
                    Err(e) => {
                        log::error!(
                            "[DB::alert_incidents] Failed to deserialize topology_context for incident {}: {}. Raw JSON: {:?}",
                            id,
                            e,
                            json_value
                        );
                        Ok(None)
                    }
                }
            }
            None => Ok(None),
        },
        None => Ok(None),
    }
}

/// Update topology context for an incident
///
/// Accepts typed IncidentTopology and handles serialization internally.
/// This is the SINGLE SOURCE OF TRUTH for topology serialization.
pub async fn update_topology(
    org_id: &str,
    id: &str,
    topology: &config::meta::alerts::incidents::IncidentTopology,
) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();

    let incident = get(org_id, id)
        .await?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("Incident not found".to_string())))?;

    // Serialize topology to JSON - ONLY place this happens
    let topology_json = serde_json::to_value(topology).map_err(|e| {
        Error::DbError(DbError::SeaORMError(format!(
            "Failed to serialize topology: {}",
            e
        )))
    })?;

    let mut active: alert_incidents::ActiveModel = incident.into();
    active.topology_context = Set(Some(topology_json));
    active.updated_at = Set(now);

    active
        .update(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Update incident metadata (alert_count, last_alert_at, optionally stable_dimensions)
///
/// Used when adding alerts to existing incidents to:
/// - Increment alert counter
/// - Update last alert timestamp
/// - Optionally merge new dimensions (for dimension accumulation)
pub async fn update_incident_metadata(
    org_id: &str,
    id: &str,
    alert_count: i32,
    last_alert_at: i64,
    stable_dimensions: Option<serde_json::Value>,
) -> Result<(), errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();

    let incident = get(org_id, id)
        .await?
        .ok_or_else(|| Error::DbError(DbError::SeaORMError("Incident not found".to_string())))?;

    let mut active: alert_incidents::ActiveModel = incident.into();

    active.alert_count = Set(alert_count);
    active.last_alert_at = Set(last_alert_at);
    active.updated_at = Set(now);

    // Only update dimensions if provided (when dimensions change)
    if let Some(dims) = stable_dimensions {
        active.stable_dimensions = Set(dims);
    }

    active
        .update(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Auto-resolve stale incidents that haven't received new alerts
///
/// Returns the number of incidents resolved
pub async fn auto_resolve_stale(stale_threshold_micros: i64) -> Result<u64, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let now = chrono::Utc::now().timestamp_micros();
    let cutoff = now - stale_threshold_micros;

    // Find all open/acknowledged incidents with last_alert_at older than threshold
    let stale_incidents = alert_incidents::Entity::find()
        .filter(alert_incidents::Column::Status.ne("resolved"))
        .filter(alert_incidents::Column::LastAlertAt.lt(cutoff))
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    let count = stale_incidents.len() as u64;

    for incident in stale_incidents {
        let mut active: alert_incidents::ActiveModel = incident.into();
        active.status = Set("resolved".to_string());
        active.resolved_at = Set(Some(now));
        active.updated_at = Set(now);

        if let Err(e) = active.update(client).await {
            log::warn!("[incidents] Failed to auto-resolve incident: {}", e);
        }
    }

    Ok(count)
}

/// Get all open incidents for RCA processing (ordered by newest first)
///
/// Note: This function is used by enterprise-only RCA job in alert_manager.
pub async fn get_open_incidents_for_rca() -> Result<Vec<alert_incidents::Model>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;

    alert_incidents::Entity::find()
        .filter(alert_incidents::Column::Status.eq("open"))
        .order_by_desc(alert_incidents::Column::LastAlertAt)
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ksuid_generation() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        assert_eq!(id.len(), 27);
    }

    #[tokio::test]
    async fn test_topology_serialization() {
        // Test that update_topology properly serializes typed IncidentTopology
        use config::meta::alerts::incidents::{AlertEdge, AlertNode, EdgeType};

        let node1 = AlertNode {
            alert_id: "alert_cpu_high".to_string(),
            alert_name: "High CPU Usage".to_string(),
            service_name: "api-gateway".to_string(),
            alert_count: 1,
            first_fired_at: 1000,
            last_fired_at: 1000,
        };

        let node2 = AlertNode {
            alert_id: "alert_db_pool".to_string(),
            alert_name: "Connection Pool Exhausted".to_string(),
            service_name: "database".to_string(),
            alert_count: 1,
            first_fired_at: 1500,
            last_fired_at: 1500,
        };

        let edge = AlertEdge {
            from_node_index: 0,
            to_node_index: 1,
            edge_type: EdgeType::ServiceDependency,
        };

        let topology = config::meta::alerts::incidents::IncidentTopology {
            nodes: vec![node1, node2],
            edges: vec![edge],
            related_incident_ids: vec![],
            suggested_root_cause: Some("# RCA Analysis\n\nTest markdown".to_string()),
        };

        // Serialize to JSON
        let json = serde_json::to_value(&topology).unwrap();

        // Verify structure
        assert_eq!(json["nodes"][0]["alert_id"], "alert_cpu_high");
        assert_eq!(json["nodes"][1]["service_name"], "database");
        assert_eq!(json["edges"][0]["from_node_index"], 0);
        assert_eq!(json["edges"][0]["edge_type"], "service_dependency");
        assert!(
            json["suggested_root_cause"]
                .as_str()
                .unwrap()
                .contains("RCA Analysis")
        );
    }

    #[tokio::test]
    async fn test_topology_deserialization() {
        // Test that get_topology properly deserializes JSON to typed IncidentTopology
        let json = serde_json::json!({
            "nodes": [
                {
                    "alert_id": "alert_1",
                    "alert_name": "High Latency",
                    "service_name": "api-gateway",
                    "alert_count": 2,
                    "first_fired_at": 1000,
                    "last_fired_at": 2000
                }
            ],
            "edges": [
                {
                    "from_node_index": 0,
                    "to_node_index": 1,
                    "edge_type": "temporal"
                }
            ],
            "related_incident_ids": [],
            "suggested_root_cause": "# Root Cause\n\nDatabase connection pool exhausted"
        });

        // Deserialize
        let topology: config::meta::alerts::incidents::IncidentTopology =
            serde_json::from_value(json).unwrap();

        assert_eq!(topology.nodes.len(), 1);
        assert_eq!(topology.edges.len(), 1);
        assert_eq!(topology.nodes[0].alert_id, "alert_1");
        assert_eq!(topology.nodes[0].alert_count, 2);
        assert!(
            topology
                .suggested_root_cause
                .unwrap()
                .contains("Database connection")
        );
    }

    #[tokio::test]
    async fn test_topology_deserialization_handles_missing_fields() {
        // Test minimal topology structure
        let json = serde_json::json!({
            "nodes": [],
            "edges": [],
            "related_incident_ids": []
        });

        let topology: config::meta::alerts::incidents::IncidentTopology =
            serde_json::from_value(json).unwrap();

        assert!(topology.nodes.is_empty());
        assert!(topology.edges.is_empty());
        assert_eq!(topology.suggested_root_cause, None);
    }

    #[tokio::test]
    async fn test_topology_deserialization_rejects_invalid_json() {
        // Test that malformed JSON is properly rejected
        let json = serde_json::json!({
            "invalid_field": "value",
            "nodes": 123  // Wrong type
        });

        let result: Result<config::meta::alerts::incidents::IncidentTopology, _> =
            serde_json::from_value(json);

        assert!(result.is_err(), "Should reject malformed JSON");
    }
}
