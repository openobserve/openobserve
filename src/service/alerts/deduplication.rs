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
    meta::alerts::{alert::Alert, deduplication::DeduplicationConfig},
    utils::json::{Map, Value},
};
use infra::table::entity::alert_dedup_state;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};

/// Calculate fingerprint for an alert result row
///
/// Delegates to enterprise implementation.
pub fn calculate_fingerprint(
    alert: &Alert,
    result_row: &Map<String, Value>,
    config: &DeduplicationConfig,
) -> String {
    o2_enterprise::enterprise::alerts::dedup::calculate_fingerprint(alert, result_row, config)
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
        let new_state = alert_dedup_state::ActiveModel {
            fingerprint: Set(params.fingerprint.to_string()),
            alert_id: Set(params.alert_id.to_string()),
            first_seen_at: Set(params.first_seen_at),
            last_seen_at: Set(params.last_seen_at),
            occurrence_count: Set(params.occurrence_count),
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

/// Apply deduplication to alert result rows before sending notifications
///
/// This is the main entry point for deduplication logic in the alert execution flow.
pub async fn apply_deduplication(
    db: &DatabaseConnection,
    alert: &Alert,
    result_rows: Vec<Map<String, Value>>,
) -> Result<Vec<Map<String, Value>>, sea_orm::DbErr> {
    // Check if deduplication is enabled
    let dedup_config = match &alert.deduplication {
        Some(config) if config.enabled => config,
        _ => return Ok(result_rows), // Deduplication disabled, return all rows
    };

    apply_deduplication_impl(db, alert, result_rows, dedup_config).await
}

/// Enterprise implementation of apply_deduplication
async fn apply_deduplication_impl(
    db: &DatabaseConnection,
    alert: &Alert,
    result_rows: Vec<Map<String, Value>>,
    dedup_config: &DeduplicationConfig,
) -> Result<Vec<Map<String, Value>>, sea_orm::DbErr> {
    let now = o2_enterprise::enterprise::alerts::dedup::current_timestamp_micros();
    let alert_id = alert.get_unique_key();
    let _org_id = &alert.org_id;

    // Determine effective time window using enterprise logic
    let time_window_minutes = o2_enterprise::enterprise::alerts::dedup::get_effective_time_window(
        dedup_config,
        alert.trigger_condition.frequency,
    );

    let mut deduplicated_rows = Vec::new();

    for row in result_rows {
        let fingerprint = calculate_fingerprint(alert, &row, dedup_config);

        // Check if this fingerprint exists and is within time window
        let should_send = match get_dedup_state(db, &fingerprint).await? {
            Some(existing_state) => {
                if is_within_window(&existing_state, time_window_minutes) {
                    // Within window - update occurrence count but don't send
                    if let Err(e) = save_dedup_state(
                        db,
                        DedupStateParams {
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

            deduplicated_rows.push(row);
        }
    }

    Ok(deduplicated_rows)
}
