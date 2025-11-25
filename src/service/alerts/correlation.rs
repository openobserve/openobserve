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
//!
//! # Overview
//!
//! Alert correlation reduces alert noise by grouping related alerts into incidents.
//! For example, when a service crashes, it might trigger alerts for CPU, memory,
//! error rate, and latency—all of which can be grouped into a single incident.
//!
//! # How It Works
//!
//! ## 1. Semantic Matching (Preferred)
//!
//! Alerts are matched based on **canonical dimensions** extracted from alert data:
//!
//! ```text
//! Alert A: {service: "api", host: "prod-1", cpu: 95%}
//! Alert B: {service: "api", host: "prod-1", memory: 90%}
//! → MATCH: Same service + host
//! ```
//!
//! Semantic field groups handle field name variations:
//! ```text
//! Group "service": ["service", "service_name", "app_name"]
//! → Alert with "app_name: api" matches Alert with "service: api"
//! ```
//!
//! ## 2. Temporal Fallback (Optional)
//!
//! When semantic matching fails, alerts can be grouped by time proximity:
//!
//! ```text
//! Alert C: {service: "api", host: "prod-1"} at T+0s
//! Alert D: {service: "db", host: "prod-2"}  at T+30s
//! → MATCH: Within 5-minute window (lower confidence)
//! ```
//!
//! ## 3. Confidence Scoring
//!
//! Incidents are assigned confidence based on match types:
//! - **High**: All alerts matched semantically
//! - **Medium**: Mix of semantic and temporal matches
//! - **Low**: All alerts matched temporally only
//!
//! # Example Workflow
//!
//! ```text
//! 1. Alert "High CPU" fires for service=api, host=prod-1
//!    → No existing incident
//!    → Create new incident_123 (status: Open)
//!
//! 2. Alert "High Memory" fires for service=api, host=prod-1
//!    → Matches incident_123 (semantic: service+host)
//!    → Add to incident_123, increment alert_count
//!
//! 3. Alert "High Latency" fires for service=api, host=prod-1
//!    → Matches incident_123
//!    → Add to incident_123
//!
//! 4. Operator acknowledges incident_123
//!    → Status: Acknowledged
//!
//! 5. Issue resolved, operator closes incident
//!    → Status: Resolved
//!    → Metrics: MTTR = 15 minutes, alert_count = 3
//! ```
//!
//! # Transaction Safety
//!
//! All correlation operations use database transactions to prevent race conditions:
//! - Finding/creating incidents
//! - Updating alert counts
//! - Adding alerts to incidents
//!
//! This ensures that concurrent alerts don't create duplicate incidents.

use std::{collections::HashMap, time::Instant};

use config::{
    meta::alerts::{
        alert::Alert,
        correlation::{
            CorrelationConfidence, CorrelationConfig, CorrelationType, IncidentStatus, MatchType,
        },
        deduplication::SemanticFieldGroup,
    },
    metrics,
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
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, Set, TransactionTrait,
};
use svix_ksuid::{self, KsuidLike};

/// Find open incidents that could correlate with this alert
async fn find_matching_incidents<C>(
    db: &C,
    org_id: &str,
    canonical_dimensions: &HashMap<String, String>,
    correlation_config: &CorrelationConfig,
    triggered_at: i64,
) -> Result<Option<(alert_incidents::Model, MatchType)>, sea_orm::DbErr>
where
    C: ConnectionTrait,
{
    let start = Instant::now();

    // Calculate temporal window cutoff using enterprise logic
    let temporal_cutoff =
        calculate_temporal_cutoff(triggered_at, correlation_config.temporal_window_seconds);

    log::debug!(
        "[correlation] Searching for matching incidents: org={}, dimensions={:?}, temporal_window={}s",
        org_id,
        canonical_dimensions,
        correlation_config.temporal_window_seconds
    );

    // Find all open incidents for this org within temporal window
    let open_incidents = alert_incidents::Entity::find()
        .filter(alert_incidents::Column::OrgId.eq(org_id))
        .filter(alert_incidents::Column::Status.eq(IncidentStatus::Open.as_str()))
        .filter(alert_incidents::Column::CreatedAt.gte(temporal_cutoff))
        .order_by_desc(alert_incidents::Column::CreatedAt)
        .all(db)
        .await?;

    // Record duration metric
    let org_id_str = org_id.to_string();
    let operation = "find_match".to_string();
    metrics::CORRELATION_PROCESSING_DURATION_SECONDS
        .with_label_values(&[&org_id_str, &operation])
        .observe(start.elapsed().as_secs_f64());

    log::debug!(
        "[correlation] Found {} open incidents within temporal window for org={}",
        open_incidents.len(),
        org_id
    );

    // Try semantic matching first
    if !correlation_config.correlation_dimensions.is_empty() {
        log::debug!(
            "[correlation] Attempting semantic matching on dimensions: {:?}",
            correlation_config.correlation_dimensions
        );

        for incident in &open_incidents {
            // Parse canonical dimensions from incident using enterprise logic
            let incident_dims = parse_canonical_dimensions(&incident.canonical_dimensions);

            if dimensions_match(
                canonical_dimensions,
                &incident_dims,
                correlation_config.require_dimension_match,
                &correlation_config.correlation_dimensions,
            ) {
                log::info!(
                    "[correlation] Semantic match found: incident_id={}, alert_dimensions={:?}, incident_dimensions={:?}, require_all={}",
                    incident.incident_id,
                    canonical_dimensions,
                    incident_dims,
                    correlation_config.require_dimension_match
                );
                return Ok(Some((incident.clone(), MatchType::SemanticFields)));
            }
        }

        log::debug!("[correlation] No semantic match found, checking temporal fallback");
    }

    // Temporal fallback if enabled
    if correlation_config.temporal_fallback_enabled && !open_incidents.is_empty() {
        let incident = &open_incidents[0];
        log::info!(
            "[correlation] Temporal fallback match: incident_id={}, alert_dimensions={:?}",
            incident.incident_id,
            canonical_dimensions
        );
        // Return the most recent incident
        return Ok(Some((incident.clone(), MatchType::TemporalOnly)));
    }

    log::debug!(
        "[correlation] No matching incident found for org={}, will create new incident",
        org_id
    );

    Ok(None)
}

/// Create a new incident
async fn create_incident<C>(
    db: &C,
    org_id: &str,
    canonical_dimensions: &HashMap<String, String>,
    now: i64,
) -> Result<alert_incidents::Model, sea_orm::DbErr>
where
    C: ConnectionTrait,
{
    let start = Instant::now();
    let incident_id = svix_ksuid::Ksuid::new(None, None).to_string();

    log::info!(
        "[correlation] Creating new incident: incident_id={}, org={}, dimensions={:?}",
        incident_id,
        org_id,
        canonical_dimensions
    );

    // Serialize canonical dimensions, handling potential failure
    let dimensions_json = serde_json::to_value(canonical_dimensions).map_err(|e| {
        log::error!(
            "[correlation] Failed to serialize canonical dimensions: incident_id={}, error={}",
            incident_id,
            e
        );
        sea_orm::DbErr::Custom(format!("Failed to serialize canonical dimensions: {e}"))
    })?;

    let new_incident = alert_incidents::ActiveModel {
        incident_id: Set(incident_id.clone()),
        org_id: Set(org_id.to_string()),
        status: Set(IncidentStatus::Open.as_str().to_string()),
        created_at: Set(now),
        updated_at: Set(now),
        resolved_at: Set(None),
        canonical_dimensions: Set(dimensions_json),
        alert_count: Set(1),
        temporal_only_count: Set(0),
        primary_correlation_type: Set(Some(CorrelationType::SemanticFields.as_str().to_string())),
        correlation_confidence: Set(Some(CorrelationConfidence::High.as_str().to_string())),
        root_cause: Set(None),
        recommended_actions: Set(None),
    };

    let result = new_incident.insert(db).await?;

    // Record metrics
    let org_id_str = org_id.to_string();
    metrics::CORRELATION_INCIDENTS_CREATED_TOTAL
        .with_label_values(&[&org_id_str])
        .inc();

    let confidence_str = CorrelationConfidence::High.as_str().to_string();
    metrics::CORRELATION_MATCH_CONFIDENCE
        .with_label_values(&[&org_id_str, &confidence_str])
        .inc();

    let operation = "create_incident".to_string();
    metrics::CORRELATION_PROCESSING_DURATION_SECONDS
        .with_label_values(&[&org_id_str, &operation])
        .observe(start.elapsed().as_secs_f64());

    log::info!(
        "[correlation] Incident created successfully: incident_id={}, correlation_type={}, confidence={}",
        incident_id,
        CorrelationType::SemanticFields.as_str(),
        CorrelationConfidence::High.as_str()
    );

    Ok(result)
}

/// Update incident with new alert
async fn update_incident<C>(
    db: &C,
    incident: &alert_incidents::Model,
    match_type: MatchType,
    now: i64,
) -> Result<alert_incidents::Model, sea_orm::DbErr>
where
    C: ConnectionTrait,
{
    let start = Instant::now();
    let mut active: alert_incidents::ActiveModel = incident.clone().into();

    let new_count = incident.alert_count + 1;
    active.alert_count = Set(new_count);
    active.updated_at = Set(now);

    let mut confidence_updated = false;
    let mut new_confidence = None;

    if match_type == MatchType::TemporalOnly {
        active.temporal_only_count = Set(incident.temporal_only_count + 1);

        // Calculate new correlation type and confidence using enterprise business logic
        let total_count = incident.alert_count + 1;
        let temporal_count = incident.temporal_only_count + 1;

        let (correlation_type, confidence) =
            calculate_correlation_stats(total_count, temporal_count);

        log::info!(
            "[correlation] Updating incident correlation stats: incident_id={}, match_type={}, new_alert_count={}, temporal_only_count={}, correlation_type={}, confidence={}",
            incident.incident_id,
            match_type.as_str(),
            total_count,
            temporal_count,
            correlation_type.as_str(),
            confidence.as_str()
        );

        active.primary_correlation_type = Set(Some(correlation_type.as_str().to_string()));
        active.correlation_confidence = Set(Some(confidence.as_str().to_string()));
        confidence_updated = true;
        new_confidence = Some(confidence);
    }

    if !confidence_updated {
        log::info!(
            "[correlation] Adding alert to incident: incident_id={}, match_type={}, new_alert_count={}",
            incident.incident_id,
            match_type.as_str(),
            new_count
        );
    }

    let result = active.update(db).await?;

    // Record metrics
    if let Some(confidence) = new_confidence {
        let confidence_str = confidence.as_str().to_string();
        metrics::CORRELATION_MATCH_CONFIDENCE
            .with_label_values(&[&incident.org_id, &confidence_str])
            .inc();
    }

    let operation = "update_incident".to_string();
    metrics::CORRELATION_PROCESSING_DURATION_SECONDS
        .with_label_values(&[&incident.org_id, &operation])
        .observe(start.elapsed().as_secs_f64());

    Ok(result)
}

/// Add alert to incident
async fn add_alert_to_incident<C>(
    db: &C,
    incident_id: &str,
    alert_id: &str,
    trigger_id: &str,
    triggered_at: i64,
    match_type: MatchType,
    now: i64,
) -> Result<(), sea_orm::DbErr>
where
    C: ConnectionTrait,
{
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
///
/// Uses database transactions to prevent race conditions when multiple alerts
/// arrive simultaneously.
pub async fn correlate_alert(
    db: &DatabaseConnection,
    org_id: &str,
    alert: &Alert,
    result_row: &Map<String, Value>,
    correlation_config: &CorrelationConfig,
    semantic_groups: &[SemanticFieldGroup],
) -> Result<Option<String>, sea_orm::DbErr> {
    if !correlation_config.enabled {
        log::debug!("[correlation] Correlation disabled for org={}", org_id);
        return Ok(None);
    }

    let now = o2_enterprise::enterprise::alerts::dedup::current_timestamp_micros();
    let alert_id = alert.get_unique_key();
    let trigger_id = generate_trigger_id(&alert_id, now);
    let triggered_at = now;

    log::info!(
        "[correlation] Starting correlation: org={}, alert_id={}, trigger_id={}",
        org_id,
        alert_id,
        trigger_id
    );

    // Extract canonical dimensions
    let canonical_dimensions = extract_canonical_dimensions(
        result_row,
        &correlation_config.correlation_dimensions,
        semantic_groups,
    );

    log::debug!(
        "[correlation] Extracted canonical dimensions: alert_id={}, dimensions={:?}",
        alert_id,
        canonical_dimensions
    );

    // Begin transaction to ensure atomicity of find/create/update operations
    // This prevents race conditions when multiple alerts arrive simultaneously
    let txn = db.begin().await?;

    log::debug!(
        "[correlation] Transaction started for alert_id={}",
        alert_id
    );

    // Find matching incident or create new one (within transaction)
    let (incident, match_type) = match find_matching_incidents(
        &txn,
        org_id,
        &canonical_dimensions,
        correlation_config,
        triggered_at,
    )
    .await?
    {
        Some((incident, match_type)) => {
            log::info!(
                "[correlation] Found matching incident: alert_id={}, incident_id={}, match_type={}",
                alert_id,
                incident.incident_id,
                match_type.as_str()
            );
            // Update existing incident
            let updated_incident = update_incident(&txn, &incident, match_type, now).await?;
            (updated_incident, match_type)
        }
        None => {
            // Check if we meet minimum alert threshold
            if correlation_config.min_alerts_for_incident <= 1 {
                log::info!(
                    "[correlation] Creating new incident for alert: alert_id={}, min_alerts={}",
                    alert_id,
                    correlation_config.min_alerts_for_incident
                );
                // Create new incident
                let new_incident =
                    create_incident(&txn, org_id, &canonical_dimensions, now).await?;
                (new_incident, MatchType::SemanticFields)
            } else {
                log::warn!(
                    "[correlation] Alert does not meet minimum threshold: alert_id={}, min_alerts={}, dropping alert",
                    alert_id,
                    correlation_config.min_alerts_for_incident
                );
                // Rollback transaction (no changes made)
                txn.rollback().await?;
                return Ok(None);
            }
        }
    };

    // Add alert to incident (within transaction)
    log::debug!(
        "[correlation] Adding alert to incident: alert_id={}, incident_id={}, trigger_id={}",
        alert_id,
        incident.incident_id,
        trigger_id
    );

    add_alert_to_incident(
        &txn,
        &incident.incident_id,
        &alert_id,
        &trigger_id,
        triggered_at,
        match_type,
        now,
    )
    .await?;

    // Commit transaction - all operations succeed or fail together
    txn.commit().await?;

    log::debug!(
        "[correlation] Transaction committed for alert_id={}",
        alert_id
    );

    // Record metrics (after successful commit)
    let org_id_str = org_id.to_string();
    let match_type_str = match_type.as_str().to_string();
    metrics::CORRELATION_ALERTS_MATCHED_TOTAL
        .with_label_values(&[&org_id_str, &match_type_str])
        .inc();

    log::info!(
        "[correlation] Successfully correlated alert: alert_id={}, incident_id={}, match_type={}",
        alert_id,
        incident.incident_id,
        match_type.as_str()
    );

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

    let old_status = incident.status.clone();

    log::info!(
        "[correlation] Updating incident status: incident_id={}, old_status={}, new_status={}",
        incident_id,
        old_status,
        new_status.as_str()
    );

    let mut active: alert_incidents::ActiveModel = incident.clone().into();
    let now = o2_enterprise::enterprise::alerts::dedup::current_timestamp_micros();

    active.status = Set(new_status.as_str().to_string());
    active.updated_at = Set(now);

    if new_status == IncidentStatus::Resolved {
        active.resolved_at = Set(Some(now));
        let duration_micros = now - incident.created_at;
        let duration_secs = duration_micros / 1_000_000;
        let duration_secs_f64 = duration_secs as f64;

        log::info!(
            "[correlation] Incident resolved: incident_id={}, duration={}s, alert_count={}",
            incident_id,
            duration_secs,
            incident.alert_count
        );

        // Record resolution metrics
        metrics::CORRELATION_INCIDENTS_RESOLVED_TOTAL
            .with_label_values(&[&incident.org_id])
            .inc();

        metrics::CORRELATION_INCIDENT_DURATION_SECONDS
            .with_label_values(&[&incident.org_id])
            .observe(duration_secs_f64);
    }

    active.update(db).await
}

// Tests for pure business logic are now in o2_enterprise::enterprise::alerts::correlation
// Tests for DB operations would go here if needed
