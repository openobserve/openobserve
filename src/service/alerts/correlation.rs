// Copyright 2025 OpenObserve Inc.
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

//! Alert correlation engine
//!
//! This module provides the correlation logic that groups related alerts into incidents
//! based on semantic field matching or temporal proximity.

use std::collections::HashMap;

use config::{
    meta::alerts::{
        alert::Alert,
        correlation::{
            CorrelationConfidence, CorrelationConfig, CorrelationType, IncidentStatus, MatchType,
        },
        deduplication::SemanticFieldGroup,
    },
    utils::json::{Map, Value},
};
use infra::table::entity::{alert_incident_alerts, alert_incidents};
// Pure business logic functions are now in o2_enterprise
// These re-exports maintain compatibility with existing code
use o2_enterprise::enterprise::alerts::correlation::{
    calculate_correlation_stats, calculate_temporal_cutoff, dimensions_match,
    extract_canonical_dimensions, generate_trigger_id as generate_trigger_id_impl,
    parse_canonical_dimensions,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
};
use svix_ksuid::{self, KsuidLike};

/// Find open incidents that could correlate with this alert
async fn find_matching_incidents(
    db: &DatabaseConnection,
    org_id: &str,
    canonical_dimensions: &HashMap<String, String>,
    correlation_config: &CorrelationConfig,
    triggered_at: i64,
) -> Result<Option<(alert_incidents::Model, MatchType)>, sea_orm::DbErr> {
    // Calculate temporal window cutoff using enterprise logic
    let temporal_cutoff =
        calculate_temporal_cutoff(triggered_at, correlation_config.temporal_window_seconds);

    // Find all open incidents for this org within temporal window
    let open_incidents = alert_incidents::Entity::find()
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .filter(alert_incidents::Column::Status.eq(IncidentStatus::Open.as_str()))
        .filter(alert_incidents::Column::CreatedAt.gte(temporal_cutoff))
        .order_by_desc(alert_incidents::Column::CreatedAt)
        .all(db)
        .await?;

    // Try semantic matching first
    if !correlation_config.correlation_dimensions.is_empty() {
        for incident in &open_incidents {
            // Parse canonical dimensions from incident using enterprise logic
            let incident_dims = parse_canonical_dimensions(&incident.canonical_dimensions);

            if dimensions_match(
                canonical_dimensions,
                &incident_dims,
                correlation_config.require_dimension_match,
                &correlation_config.correlation_dimensions,
            ) {
                return Ok(Some((incident.clone(), MatchType::SemanticFields)));
            }
        }
    }

    // Temporal fallback if enabled
    if correlation_config.temporal_fallback_enabled && !open_incidents.is_empty() {
        // Return the most recent incident
        return Ok(Some((open_incidents[0].clone(), MatchType::TemporalOnly)));
    }

    Ok(None)
}

/// Create a new incident
async fn create_incident(
    db: &DatabaseConnection,
    org_id: &str,
    canonical_dimensions: &HashMap<String, String>,
    now: i64,
) -> Result<alert_incidents::Model, sea_orm::DbErr> {
    let incident_id = svix_ksuid::Ksuid::new(None, None).to_string();

    let new_incident = alert_incidents::ActiveModel {
        incident_id: Set(incident_id),
        org_id: Set(org_id.to_string()),
        status: Set(IncidentStatus::Open.as_str().to_string()),
        created_at: Set(now),
        updated_at: Set(now),
        resolved_at: Set(None),
        canonical_dimensions: Set(serde_json::to_value(canonical_dimensions).unwrap()),
        alert_count: Set(1),
        temporal_only_count: Set(0),
        primary_correlation_type: Set(Some(CorrelationType::SemanticFields.as_str().to_string())),
        correlation_confidence: Set(Some(CorrelationConfidence::High.as_str().to_string())),
        root_cause: Set(None),
        recommended_actions: Set(None),
    };

    new_incident.insert(db).await
}

/// Update incident with new alert
async fn update_incident(
    db: &DatabaseConnection,
    incident: &alert_incidents::Model,
    match_type: MatchType,
    now: i64,
) -> Result<alert_incidents::Model, sea_orm::DbErr> {
    let mut active: alert_incidents::ActiveModel = incident.clone().into();

    active.alert_count = Set(incident.alert_count + 1);
    active.updated_at = Set(now);

    if match_type == MatchType::TemporalOnly {
        active.temporal_only_count = Set(incident.temporal_only_count + 1);

        // Calculate new correlation type and confidence using enterprise business logic
        let total_count = incident.alert_count + 1;
        let temporal_count = incident.temporal_only_count + 1;

        let (correlation_type, confidence) =
            calculate_correlation_stats(total_count, temporal_count);

        active.primary_correlation_type = Set(Some(correlation_type.as_str().to_string()));
        active.correlation_confidence = Set(Some(confidence.as_str().to_string()));
    }

    active.update(db).await
}

/// Add alert to incident
async fn add_alert_to_incident(
    db: &DatabaseConnection,
    incident_id: &str,
    alert_id: &str,
    trigger_id: &str,
    triggered_at: i64,
    match_type: MatchType,
    now: i64,
) -> Result<(), sea_orm::DbErr> {
    let new_alert = alert_incident_alerts::ActiveModel {
        incident_id: Set(incident_id.to_string()),
        alert_id: Set(alert_id.to_string()),
        trigger_id: Set(trigger_id.to_string()),
        triggered_at: Set(triggered_at),
        added_at: Set(now),
        match_type: Set(match_type.as_str().to_string()),
    };

    new_alert.insert(db).await?;
    Ok(())
}

/// Main correlation entry point
///
/// This function is called after deduplication to correlate alerts into incidents.
/// Returns the incident_id if the alert was correlated, None otherwise.
pub async fn correlate_alert(
    db: &DatabaseConnection,
    org_id: &str,
    alert: &Alert,
    result_row: &Map<String, Value>,
    correlation_config: &CorrelationConfig,
    semantic_groups: &[SemanticFieldGroup],
) -> Result<Option<String>, sea_orm::DbErr> {
    if !correlation_config.enabled {
        return Ok(None);
    }

    let now = o2_enterprise::enterprise::alerts::dedup::current_timestamp_micros();
    let alert_id = alert.get_unique_key();
    let trigger_id = generate_trigger_id(&alert_id, now);
    let triggered_at = now;

    // Extract canonical dimensions
    let canonical_dimensions = extract_canonical_dimensions(
        result_row,
        &correlation_config.correlation_dimensions,
        semantic_groups,
    );

    // Find matching incident or create new one
    let (incident, match_type) = match find_matching_incidents(
        db,
        org_id,
        &canonical_dimensions,
        correlation_config,
        triggered_at,
    )
    .await?
    {
        Some((incident, match_type)) => {
            // Update existing incident
            let updated_incident = update_incident(db, &incident, match_type, now).await?;
            (updated_incident, match_type)
        }
        None => {
            // Check if we meet minimum alert threshold
            if correlation_config.min_alerts_for_incident <= 1 {
                // Create new incident
                let new_incident = create_incident(db, org_id, &canonical_dimensions, now).await?;
                (new_incident, MatchType::SemanticFields)
            } else {
                // Don't create incident yet, not enough alerts
                return Ok(None);
            }
        }
    };

    // Add alert to incident
    add_alert_to_incident(
        db,
        &incident.incident_id,
        &alert_id,
        &trigger_id,
        triggered_at,
        match_type,
        now,
    )
    .await?;

    Ok(Some(incident.incident_id))
}

/// Generate a unique trigger ID for this alert firing
///
/// Delegates to enterprise implementation
fn generate_trigger_id(alert_id: &str, timestamp: i64) -> String {
    generate_trigger_id_impl(alert_id, timestamp)
}

/// Get incident details by ID
pub async fn get_incident(
    db: &DatabaseConnection,
    incident_id: &str,
) -> Result<Option<alert_incidents::Model>, sea_orm::DbErr> {
    alert_incidents::Entity::find_by_id(incident_id)
        .one(db)
        .await
}

/// Get alerts for an incident
pub async fn get_incident_alerts(
    db: &DatabaseConnection,
    incident_id: &str,
) -> Result<Vec<alert_incident_alerts::Model>, sea_orm::DbErr> {
    alert_incident_alerts::Entity::find()
        .filter(alert_incident_alerts::Column::IncidentId.eq(incident_id))
        .order_by_asc(alert_incident_alerts::Column::TriggeredAt)
        .all(db)
        .await
}

/// List incidents for an organization
pub async fn list_incidents(
    db: &DatabaseConnection,
    org_id: &str,
    status: Option<IncidentStatus>,
    limit: u64,
    offset: u64,
) -> Result<Vec<alert_incidents::Model>, sea_orm::DbErr> {
    let mut query = alert_incidents::Entity::find()
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .order_by_desc(alert_incidents::Column::CreatedAt);

    if let Some(status) = status {
        query = query.filter(alert_incidents::Column::Status.eq(status.as_str()));
    }

    query.limit(limit).offset(offset).all(db).await
}

/// Update incident status
pub async fn update_incident_status(
    db: &DatabaseConnection,
    incident_id: &str,
    new_status: IncidentStatus,
) -> Result<alert_incidents::Model, sea_orm::DbErr> {
    let incident = get_incident(db, incident_id)
        .await?
        .ok_or_else(|| sea_orm::DbErr::Custom("Incident not found".to_string()))?;

    let mut active: alert_incidents::ActiveModel = incident.into();
    let now = o2_enterprise::enterprise::alerts::dedup::current_timestamp_micros();

    active.status = Set(new_status.as_str().to_string());
    active.updated_at = Set(now);

    if new_status == IncidentStatus::Resolved {
        active.resolved_at = Set(Some(now));
    }

    active.update(db).await
}

// Tests for pure business logic are now in o2_enterprise::enterprise::alerts::correlation
// Tests for DB operations would go here if needed
