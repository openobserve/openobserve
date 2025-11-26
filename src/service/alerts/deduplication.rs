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

//! Alert deduplication logic (Enterprise only)
//!
//! This module provides the deduplication interface that delegates to the enterprise
//! implementation. It is only compiled when the enterprise feature is enabled.

use config::{
    meta::alerts::{
        alert::Alert,
        deduplication::{DeduplicationConfig, GlobalDeduplicationConfig},
    },
    utils::json::{Map, Value},
};
use infra::table::entity::alert_dedup_state;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};

/// Calculate fingerprint for an alert result row
///
/// Delegates to enterprise implementation.
/// With org_config provided, uses semantic dimensions for cross-alert deduplication.
pub fn calculate_fingerprint(
    alert: &Alert,
    result_row: &Map<String, Value>,
    config: &DeduplicationConfig,
    org_config: Option<&GlobalDeduplicationConfig>,
) -> String {
    o2_enterprise::enterprise::alerts::dedup::calculate_fingerprint(
        alert, result_row, config, org_config,
    )
}

/// Get or create deduplication state
pub async fn get_dedup_state(
    db: &DatabaseConnection,
    fingerprint: &str,
) -> Result<Option<alert_dedup_state::Model>, sea_orm::DbErr> {
    alert_dedup_state::Entity::find_by_id(fingerprint)
        .one(db)
        .await
}

/// Parameters for saving deduplication state
pub struct DedupStateParams<'a> {
    pub org_id: &'a str,
    pub fingerprint: &'a str,
    pub alert_id: &'a str,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    pub occurrence_count: i64,
}

/// Save or update deduplication state
pub async fn save_dedup_state(
    db: &DatabaseConnection,
    params: DedupStateParams<'_>,
) -> Result<alert_dedup_state::Model, sea_orm::DbErr> {
    // Try to find existing record
    if let Some(existing) = get_dedup_state(db, params.fingerprint).await? {
        // Update existing
        let mut active: alert_dedup_state::ActiveModel = existing.clone().into();
        active.last_seen_at = Set(params.last_seen_at);
        active.occurrence_count = Set(params.occurrence_count);
        active.update(db).await
    } else {
        // Insert new
        let now = o2_enterprise::enterprise::alerts::dedup::current_timestamp_micros();
        let new_state = alert_dedup_state::ActiveModel {
            org_id: Set(params.org_id.to_string()),
            fingerprint: Set(params.fingerprint.to_string()),
            alert_id: Set(params.alert_id.to_string()),
            first_seen_at: Set(params.first_seen_at),
            last_seen_at: Set(params.last_seen_at),
            occurrence_count: Set(params.occurrence_count),
            notification_sent: Set(false),
            created_at: Set(now),
        };
        new_state.insert(db).await
    }
}

/// Check if dedup state is within time window
pub fn is_within_window(state: &alert_dedup_state::Model, time_window_minutes: i64) -> bool {
    o2_enterprise::enterprise::alerts::dedup::is_within_time_window(
        state.last_seen_at,
        time_window_minutes,
    )
}

/// Cleanup old deduplication state records
pub async fn cleanup_expired_state(
    db: &DatabaseConnection,
    older_than_minutes: i64,
) -> Result<u64, sea_orm::DbErr> {
    let cutoff_time = o2_enterprise::enterprise::alerts::dedup::current_timestamp_micros()
        - (older_than_minutes * 60 * 1_000_000);

    let query = alert_dedup_state::Entity::delete_many()
        .filter(alert_dedup_state::Column::LastSeenAt.lt(cutoff_time));

    let result = query.exec(db).await?;
    Ok(result.rows_affected)
}

/// Check for cross-alert semantic matches (when cross_alert_dedup is enabled)
///
/// Looks for any fingerprint containing the given semantic dimensions within the time window.
/// Used to suppress alerts that share semantic dimensions with recently fired alerts.
pub async fn find_matching_semantic_fingerprints(
    db: &DatabaseConnection,
    semantic_dimensions: &std::collections::HashMap<String, String>,
    time_window_minutes: i64,
) -> Result<Vec<alert_dedup_state::Model>, sea_orm::DbErr> {
    let cutoff_time = o2_enterprise::enterprise::alerts::dedup::current_timestamp_micros()
        - (time_window_minutes * 60 * 1_000_000);

    // Get all recent fingerprints
    let recent_states = alert_dedup_state::Entity::find()
        .filter(alert_dedup_state::Column::LastSeenAt.gt(cutoff_time))
        .all(db)
        .await?;

    // Filter for matches with overlapping semantic dimensions
    // Fingerprint format: "dim1=val1,dim2=val2,..."
    let matching_states: Vec<_> = recent_states
        .into_iter()
        .filter(|state| {
            // Parse fingerprint to check for dimension overlap
            o2_enterprise::enterprise::alerts::dedup::fingerprint_matches_dimensions(
                &state.fingerprint,
                semantic_dimensions,
            )
        })
        .collect();

    Ok(matching_states)
}

/// Apply deduplication to alert result rows before sending notifications
///
/// This is the main entry point for deduplication logic in the alert execution flow.
/// Fetches org-level config for semantic groups and cross-alert deduplication.
pub async fn apply_deduplication(
    db: &DatabaseConnection,
    alert: &Alert,
    result_rows: Vec<Map<String, Value>>,
) -> Result<Vec<Map<String, Value>>, sea_orm::DbErr> {
    // Check if per-alert deduplication is enabled
    let dedup_config = match &alert.deduplication {
        Some(config) if config.enabled => config,
        _ => return Ok(result_rows), // Deduplication disabled, return all rows
    };

    // Fetch org-level config for semantic groups
    let org_config = match super::org_config::get_deduplication_config(&alert.org_id).await {
        Ok(Some(config)) if config.enabled => Some(config),
        Ok(Some(_)) => {
            // Org config exists but disabled - still allow per-alert dedup
            None
        }
        Ok(None) => None, // No org config
        Err(e) => {
            log::warn!(
                "Failed to fetch org dedup config for {}: {}, proceeding without semantic groups",
                alert.org_id,
                e
            );
            None
        }
    };

    apply_deduplication_impl(db, alert, result_rows, dedup_config, org_config.as_ref()).await
}

/// Enterprise implementation of apply_deduplication
async fn apply_deduplication_impl(
    db: &DatabaseConnection,
    alert: &Alert,
    result_rows: Vec<Map<String, Value>>,
    dedup_config: &DeduplicationConfig,
    org_config: Option<&GlobalDeduplicationConfig>,
) -> Result<Vec<Map<String, Value>>, sea_orm::DbErr> {
    let now = o2_enterprise::enterprise::alerts::dedup::current_timestamp_micros();
    let alert_id = alert.get_unique_key();
    let org_id = &alert.org_id;

    // Determine effective time window using enterprise logic
    let time_window_minutes = o2_enterprise::enterprise::alerts::dedup::get_effective_time_window(
        dedup_config,
        alert.trigger_condition.frequency,
    );

    let mut deduplicated_rows = Vec::new();

    for row in result_rows {
        let fingerprint = calculate_fingerprint(alert, &row, dedup_config, org_config);

        // Check if this fingerprint exists and is within time window
        let should_send = match get_dedup_state(db, &fingerprint).await? {
            Some(existing_state) => {
                if is_within_window(&existing_state, time_window_minutes) {
                    // Within window - update occurrence count but don't send
                    if let Err(e) = save_dedup_state(
                        db,
                        DedupStateParams {
                            org_id: org_id.as_str(),
                            fingerprint: &fingerprint,
                            alert_id: &alert_id,
                            first_seen_at: existing_state.first_seen_at,
                            last_seen_at: now,
                            occurrence_count: existing_state.occurrence_count + 1,
                        },
                    )
                    .await
                    {
                        log::warn!(
                            "Failed to update dedup state for fingerprint {}: {}",
                            fingerprint,
                            e
                        );
                    }

                    // Record suppression metric
                    let dedup_type = if existing_state.alert_id == alert_id {
                        "same_alert"
                    } else {
                        "cross_alert"
                    };
                    config::metrics::ALERT_DEDUP_SUPPRESSED_TOTAL
                        .with_label_values(&[org_id.as_str(), &alert.name, dedup_type])
                        .inc();

                    log::debug!(
                        "[dedup] Suppressed alert '{}' for org: {}, fingerprint: {}, occurrence: {}, type: {}",
                        alert.name,
                        org_id,
                        fingerprint,
                        existing_state.occurrence_count + 1,
                        dedup_type
                    );

                    false
                } else {
                    // Outside window - treat as new alert
                    true
                }
            }
            None => {
                // New fingerprint - should send
                true
            }
        };

        if should_send {
            // Save new dedup state
            if let Err(e) = save_dedup_state(
                db,
                DedupStateParams {
                    org_id: org_id.as_str(),
                    fingerprint: &fingerprint,
                    alert_id: &alert_id,
                    first_seen_at: now,
                    last_seen_at: now,
                    occurrence_count: 1,
                },
            )
            .await
            {
                log::error!(
                    "Failed to save dedup state for fingerprint {}: {}",
                    fingerprint,
                    e
                );
            }

            // Record passed metric
            config::metrics::ALERT_DEDUP_PASSED_TOTAL
                .with_label_values(&[org_id.as_str(), &alert.name])
                .inc();

            log::debug!(
                "[dedup] Alert '{}' passed dedup check for org: {}, fingerprint: {}",
                alert.name,
                org_id,
                fingerprint
            );

            deduplicated_rows.push(row);
        }
    }

    Ok(deduplicated_rows)
}
