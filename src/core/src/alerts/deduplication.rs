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

//! Alert deduplication logic
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

/// Append the evaluated level to a fingerprint for MULTI-LEVEL alerts.
///
/// A Warning batch and a Critical batch must never share a dedup identity —
/// otherwise deduplication discards the Warning→Critical escalation that the
/// scheduler explicitly allowed through silence (§7.1). Single-level alerts
/// keep their legacy fingerprints byte-for-byte, so existing dedup state is
/// not invalidated on upgrade. The `|level:` separator is deliberately not
/// the `,dim=val` shape, so dimension parsing never mistakes it for a field.
fn with_level_component(
    base: String,
    alert: &Alert,
    level: Option<config::meta::alerts::level::AlertLevel>,
) -> String {
    let multi_level = alert.trigger_condition.warning_threshold.is_some()
        || alert
            .query_condition
            .aggregation
            .as_ref()
            .is_some_and(|a| a.warning_value.is_some())
        || alert.query_condition.promql_warning_value.is_some();
    match (multi_level, level) {
        (true, Some(l)) => format!("{base}|level:{l}"),
        _ => base,
    }
}

/// Calculate fingerprint for an alert result row
///
/// Delegates to enterprise implementation; the evaluated level is appended as
/// an implicit component for multi-level alerts (see `with_level_component`).
pub fn calculate_fingerprint(
    alert: &Alert,
    result_row: &Map<String, Value>,
    config: &DeduplicationConfig,
    org_config: Option<&GlobalDeduplicationConfig>,
    semantic_groups: &[config::meta::correlation::FieldAlias],
    level: Option<config::meta::alerts::level::AlertLevel>,
) -> String {
    let base = o2_enterprise::enterprise::alerts::dedup::calculate_fingerprint(
        alert,
        result_row,
        config,
        org_config,
        semantic_groups,
    );

    // Level and group are the two IMPLICIT fingerprint components (M-5). The
    // group one is derived from the row itself rather than passed in, so every
    // caller gets it — there is no way to compute a fingerprint for a
    // multi-alert row and accidentally leave the group out, which would let
    // one group's notification dedup away another's.
    //
    // `with_group_component` returns the base unchanged for an ungrouped alert
    // and for the rollup key, so existing fingerprints stay byte-identical and
    // no live silence window is invalidated by the upgrade.
    let with_level = with_level_component(base, alert, level);
    config::meta::alerts::grouping::with_group_component(with_level, row_group_key(alert, result_row).as_deref())
}

/// This row's group identity, for the M-5 fingerprint component.
///
/// `None` for anything that is not an opted-in multi-alert, which is what
/// keeps every pre-existing alert's fingerprint unchanged.
fn row_group_key(alert: &Alert, row: &Map<String, Value>) -> Option<String> {
    let agg = alert.query_condition.aggregation.as_ref()?;
    if !agg.multi_alert {
        return None;
    }
    let group_by = agg.group_by.as_ref()?;
    // Same extractor the evaluation and dispatch use, so the fingerprint's
    // notion of "which group" cannot drift from the state row's.
    let labels = config::meta::alerts::dispatch::row_group_labels(row, group_by);
    Some(config::meta::alerts::grouping::group_key(&labels))
}

/// What one pass of [`apply_deduplication`] decided.
pub struct DeduplicationOutcome {
    /// The rows that survived deduplication and should be notified on.
    pub rows: Vec<Map<String, Value>>,
    /// Whether deduplication actually ran (it is opt-in per alert).
    pub applied: bool,
    /// Fingerprints RESERVED by this pass — recorded as seen but not yet
    /// confirmed as delivered (§5.5 MN-6).
    ///
    /// The caller must pass these to [`confirm_notification_sent`] once the
    /// notification actually goes out. Until it does, they do not suppress:
    /// that is what lets a failed send be retried instead of being swallowed
    /// as a duplicate for the rest of the window.
    pub reserved: Vec<String>,
}

/// Confirm reservations whose notification was delivered (§5.5 MN-6).
///
/// Called only after a successful send. Anything left unconfirmed is treated
/// as a delivery that never happened, so the next evaluation is allowed
/// through — no retry bookkeeping required.
pub async fn confirm_notification_sent(
    db: &DatabaseConnection,
    fingerprints: &[String],
) -> Result<(), sea_orm::DbErr> {
    if fingerprints.is_empty() {
        return Ok(());
    }
    alert_dedup_state::Entity::update_many()
        .col_expr(
            alert_dedup_state::Column::NotificationSent,
            sea_orm::sea_query::Expr::value(true),
        )
        .filter(alert_dedup_state::Column::Fingerprint.is_in(fingerprints.to_vec()))
        .exec(db)
        .await?;
    Ok(())
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
    level: Option<config::meta::alerts::level::AlertLevel>,
) -> Result<DeduplicationOutcome, sea_orm::DbErr> {
    // Check if per-alert deduplication is enabled
    let dedup_config = match &alert.deduplication {
        Some(config) if config.enabled => config,
        // Deduplication disabled, return all rows
        _ => {
            return Ok(DeduplicationOutcome {
                rows: result_rows,
                applied: false,
                reserved: Vec::new(),
            });
        }
    };

    // Get semantic groups from system_settings — the single source of truth
    let semantic_groups =
        crate::db::system_settings::get_semantic_field_groups(&alert.org_id).await;

    // Get org-level dedup config for cross-alert settings (alert_dedup_enabled, fingerprint_groups)
    let org_config = match super::org_config::get_deduplication_config(&alert.org_id).await {
        Ok(Some(config)) if config.enabled => Some(config),
        _ => None,
    };

    apply_deduplication_impl(
        db,
        alert,
        result_rows,
        dedup_config,
        org_config.as_ref(),
        &semantic_groups,
        level,
    )
    .await
    .map(|(rows, reserved)| DeduplicationOutcome {
        rows,
        applied: true,
        reserved,
    })
}

/// Enterprise implementation of apply_deduplication
async fn apply_deduplication_impl(
    db: &DatabaseConnection,
    alert: &Alert,
    result_rows: Vec<Map<String, Value>>,
    dedup_config: &DeduplicationConfig,
    org_config: Option<&GlobalDeduplicationConfig>,
    semantic_groups: &[config::meta::correlation::FieldAlias],
    level: Option<config::meta::alerts::level::AlertLevel>,
) -> Result<(Vec<Map<String, Value>>, Vec<String>), sea_orm::DbErr> {
    let now = o2_enterprise::enterprise::alerts::dedup::current_timestamp_micros();
    let alert_id = alert.get_unique_key();
    let org_id = &alert.org_id;

    // Determine effective time window using enterprise logic
    let time_window_minutes = o2_enterprise::enterprise::alerts::dedup::get_effective_time_window(
        dedup_config,
        alert.trigger_condition.frequency,
    );

    let mut deduplicated_rows = Vec::new();
    // Reserved but unconfirmed until the notification actually lands.
    let mut reserved = Vec::new();

    for row in result_rows {
        let fingerprint = calculate_fingerprint(
            alert,
            &row,
            dedup_config,
            org_config,
            semantic_groups,
            level,
        );

        // A reservation suppresses only once a delivery has CONFIRMED it
        // (§5.5 MN-6). Recording the fingerprint when a row merely *passes*
        // dedup — which is what happens below — means a send that then fails
        // is suppressed as a duplicate on every later evaluation while
        // `last_seen_at` keeps extending the window: one transient webhook
        // error swallows the page for the whole window. `notification_sent`
        // has existed on this table since the feature shipped and was never
        // read; it is the confirm flag.
        let should_send = match get_dedup_state(db, &fingerprint).await? {
            Some(existing_state)
                if config::meta::alerts::deduplication::reservation_suppresses(
                    existing_state.notification_sent,
                    is_within_window(&existing_state, time_window_minutes),
                ) =>
            {
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
            }
            _ => {
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
            reserved.push(fingerprint);
        }
    }

    Ok((deduplicated_rows, reserved))
}
