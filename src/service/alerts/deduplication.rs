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

//! Alert deduplication logic

use std::collections::HashSet;

use chrono::Utc;
use config::{
    TIMESTAMP_COL_NAME,
    meta::alerts::{ConditionList, QueryType, alert::Alert, deduplication::DeduplicationConfig},
    utils::json::{Map, Value},
};
use infra::table::entity::alert_dedup_state;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};

/// Calculate fingerprint for an alert result row
pub fn calculate_fingerprint(
    alert: &Alert,
    result_row: &Map<String, Value>,
    config: &DeduplicationConfig,
) -> String {
    let fields = get_fingerprint_fields(alert, result_row, config);

    let mut parts = vec![alert.get_unique_key()];
    for field in fields {
        if let Some(val) = result_row.get(&field) {
            parts.push(format!("{}:{}", field, json_value_to_string(val)));
        }
    }

    // Generate SHA-256 hash using sha256 crate
    sha256::digest(parts.join("|"))
}

/// Get effective fingerprint fields based on query type and configuration
fn get_fingerprint_fields(
    alert: &Alert,
    result_row: &Map<String, Value>,
    config: &DeduplicationConfig,
) -> Vec<String> {
    // User specified fields - use them
    if !config.fingerprint_fields.is_empty() {
        return config.fingerprint_fields.clone();
    }

    // Auto-detect based on query type
    match alert.query_condition.query_type {
        QueryType::Custom => extract_custom_query_fields(alert, result_row),
        QueryType::SQL => {
            // Try to extract from aggregation first (for alerts with aggregation)
            if let Some(agg) = &alert.query_condition.aggregation
                && let Some(group_by) = &agg.group_by
                && !group_by.is_empty()
            {
                return group_by.clone();
            }
            // Fallback: all non-timestamp fields
            extract_all_non_timestamp_fields(result_row)
        }
        QueryType::PromQL => extract_promql_label_fields(result_row),
    }
}

/// Extract fields from Custom query conditions
fn extract_custom_query_fields(alert: &Alert, result_row: &Map<String, Value>) -> Vec<String> {
    if let Some(conditions) = &alert.query_condition.conditions {
        let mut fields = HashSet::new();
        extract_condition_fields(conditions, &mut fields);
        if !fields.is_empty() {
            return fields.into_iter().collect();
        }
    }

    // Check if there's aggregation with group_by
    if let Some(agg) = &alert.query_condition.aggregation
        && let Some(group_by) = &agg.group_by
        && !group_by.is_empty()
    {
        return group_by.clone();
    }

    // Fallback: all fields except timestamp
    extract_all_non_timestamp_fields(result_row)
}

/// Recursively extract field names from condition tree
fn extract_condition_fields(conditions: &ConditionList, fields: &mut HashSet<String>) {
    match conditions {
        ConditionList::EndCondition(condition) => {
            fields.insert(condition.column.clone());
        }
        ConditionList::AndNode { and } => {
            for child in and {
                extract_condition_fields(child, fields);
            }
        }
        ConditionList::OrNode { or } => {
            for child in or {
                extract_condition_fields(child, fields);
            }
        }
        ConditionList::NotNode { not } => {
            extract_condition_fields(not, fields);
        }
        ConditionList::LegacyConditions(conds) => {
            for cond in conds {
                fields.insert(cond.column.clone());
            }
        }
    }
}

/// Extract label fields from PromQL result (exclude _timestamp and value)
fn extract_promql_label_fields(result_row: &Map<String, Value>) -> Vec<String> {
    result_row
        .keys()
        .filter(|k| *k != TIMESTAMP_COL_NAME && *k != "_timestamp" && *k != "value")
        .cloned()
        .collect()
}

/// Extract all fields except timestamp
fn extract_all_non_timestamp_fields(result_row: &Map<String, Value>) -> Vec<String> {
    result_row
        .keys()
        .filter(|k| *k != TIMESTAMP_COL_NAME && *k != "_timestamp")
        .cloned()
        .collect()
}

/// Convert JSON value to string for hashing
fn json_value_to_string(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        Value::Array(_) | Value::Object(_) => serde_json::to_string(value).unwrap_or_default(),
    }
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
    pub org_id: &'a str,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    pub occurrence_count: i64,
    pub notification_sent: bool,
}

/// Save or update deduplication state
pub async fn save_dedup_state(
    db: &DatabaseConnection,
    params: DedupStateParams<'_>,
) -> Result<alert_dedup_state::Model, sea_orm::DbErr> {
    let now = Utc::now().timestamp_micros();

    // Try to find existing record
    if let Some(existing) = get_dedup_state(db, params.fingerprint).await? {
        // Update existing
        let mut active: alert_dedup_state::ActiveModel = existing.clone().into();
        active.last_seen_at = Set(params.last_seen_at);
        active.occurrence_count = Set(params.occurrence_count);
        active.notification_sent = Set(params.notification_sent);
        active.update(db).await
    } else {
        // Insert new
        let new_state = alert_dedup_state::ActiveModel {
            fingerprint: Set(params.fingerprint.to_string()),
            alert_id: Set(params.alert_id.to_string()),
            org_id: Set(params.org_id.to_string()),
            first_seen_at: Set(params.first_seen_at),
            last_seen_at: Set(params.last_seen_at),
            occurrence_count: Set(params.occurrence_count),
            notification_sent: Set(params.notification_sent),
            created_at: Set(now),
        };
        new_state.insert(db).await
    }
}

/// Check if dedup state is within time window
pub fn is_within_window(state: &alert_dedup_state::Model, time_window_minutes: i64) -> bool {
    let now = Utc::now().timestamp_micros();
    let window_micros = time_window_minutes * 60 * 1_000_000;
    now - state.last_seen_at <= window_micros
}

/// Cleanup old deduplication state records
pub async fn cleanup_expired_state(
    db: &DatabaseConnection,
    org_id: Option<&str>,
    older_than_minutes: i64,
) -> Result<u64, sea_orm::DbErr> {
    let cutoff_time = Utc::now().timestamp_micros() - (older_than_minutes * 60 * 1_000_000);

    let mut query = alert_dedup_state::Entity::delete_many()
        .filter(alert_dedup_state::Column::LastSeenAt.lt(cutoff_time));

    if let Some(org) = org_id {
        query = query.filter(alert_dedup_state::Column::OrgId.eq(org));
    }

    let result = query.exec(db).await?;
    Ok(result.rows_affected)
}

/// Apply deduplication to alert result rows before sending notifications
///
/// This is the main entry point for deduplication logic in the alert execution flow.
/// It processes each result row, calculates fingerprints, checks for duplicates,
/// and returns only the rows that should trigger notifications.
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

    let now = Utc::now().timestamp_micros();
    let alert_id = alert.get_unique_key();
    let org_id = &alert.org_id;

    // Determine effective time window
    let time_window_minutes = dedup_config
        .time_window_minutes
        .unwrap_or_else(|| alert.trigger_condition.frequency * 2);

    let mut deduplicated_rows = Vec::new();

    for row in result_rows {
        let fingerprint = calculate_fingerprint(alert, &row, dedup_config);

        // Check if this fingerprint exists and is within time window
        let should_send = match get_dedup_state(db, &fingerprint).await? {
            Some(existing_state) => {
                if is_within_window(&existing_state, time_window_minutes) {
                    // Within window - update occurrence count but don't send
                    let _ = save_dedup_state(
                        db,
                        DedupStateParams {
                            fingerprint: &fingerprint,
                            alert_id: &alert_id,
                            org_id,
                            first_seen_at: existing_state.first_seen_at,
                            last_seen_at: now,
                            occurrence_count: existing_state.occurrence_count + 1,
                            notification_sent: true,
                        },
                    )
                    .await;
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
            let _ = save_dedup_state(
                db,
                DedupStateParams {
                    fingerprint: &fingerprint,
                    alert_id: &alert_id,
                    org_id,
                    first_seen_at: now,
                    last_seen_at: now,
                    occurrence_count: 1,
                    notification_sent: true,
                },
            )
            .await;

            deduplicated_rows.push(row);
        }
    }

    Ok(deduplicated_rows)
}

/// Extract GROUP BY fields from SQL query using existing OpenObserve mechanism
///
/// This function attempts to parse the SQL query and extract GROUP BY columns
/// using the same mechanism that OpenObserve uses for search queries.
pub async fn extract_sql_group_by_fields(
    sql_query: &str,
    org_id: &str,
    stream_type: config::meta::stream::StreamType,
) -> Vec<String> {
    // Try to parse the SQL using OpenObserve's Sql struct
    // Note: This requires creating a SearchQuery which may have overhead
    // For alerts, we can optimize by checking aggregation.group_by first (see
    // get_fingerprint_fields)

    use proto::cluster_rpc::SearchQuery;

    let search_query = SearchQuery {
        sql: sql_query.to_string(),
        from: 0,
        size: 1, // We only care about schema, not actual results
        quick_mode: false,
        start_time: 0,
        end_time: 0,
        track_total_hits: false,
        query_type: "sql".to_string(),
        uses_zo_fn: false,
        query_fn: String::new(),
        skip_wal: false,
        action_id: String::new(),
        histogram_interval: 0,
    };

    match crate::service::search::sql::Sql::new(&search_query, org_id, stream_type, None).await {
        Ok(sql) => {
            // Use the existing GROUP BY visitor
            match crate::service::search::sql::visitor::group_by::get_group_by_fields(&sql).await {
                Ok(fields) => fields,
                Err(e) => {
                    log::debug!("Failed to extract GROUP BY fields from SQL: {}", e);
                    vec![]
                }
            }
        }
        Err(e) => {
            log::debug!("Failed to parse SQL for GROUP BY extraction: {}", e);
            vec![]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_fingerprint() {
        let mut alert = Alert::default();
        alert.id = Some(config::ider::uuid().parse().unwrap());

        let mut result_row = Map::new();
        result_row.insert("service".to_string(), Value::String("api".to_string()));
        result_row.insert("hostname".to_string(), Value::String("prod-01".to_string()));
        result_row.insert("error".to_string(), Value::String("timeout".to_string()));

        let config = DeduplicationConfig {
            enabled: true,
            fingerprint_fields: vec![
                "service".to_string(),
                "hostname".to_string(),
                "error".to_string(),
            ],
            ..Default::default()
        };

        let fingerprint1 = calculate_fingerprint(&alert, &result_row, &config);

        // Same inputs should produce same fingerprint
        let fingerprint2 = calculate_fingerprint(&alert, &result_row, &config);
        assert_eq!(fingerprint1, fingerprint2);

        // Different value should produce different fingerprint
        result_row.insert("hostname".to_string(), Value::String("prod-02".to_string()));
        let fingerprint3 = calculate_fingerprint(&alert, &result_row, &config);
        assert_ne!(fingerprint1, fingerprint3);

        // Fingerprint should be 64 hex characters (SHA-256)
        assert_eq!(fingerprint1.len(), 64);
    }

    #[test]
    fn test_extract_condition_fields() {
        let conditions = ConditionList::AndNode {
            and: vec![
                ConditionList::EndCondition(config::meta::alerts::Condition {
                    column: "service".to_string(),
                    operator: config::meta::alerts::Operator::EqualTo,
                    value: Value::String("api".to_string()),
                    ignore_case: false,
                }),
                ConditionList::EndCondition(config::meta::alerts::Condition {
                    column: "level".to_string(),
                    operator: config::meta::alerts::Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: false,
                }),
            ],
        };

        let mut fields = HashSet::new();
        extract_condition_fields(&conditions, &mut fields);

        assert_eq!(fields.len(), 2);
        assert!(fields.contains("service"));
        assert!(fields.contains("level"));
    }

    #[test]
    fn test_extract_promql_label_fields() {
        let mut result_row = Map::new();
        result_row.insert("job".to_string(), Value::String("api".to_string()));
        result_row.insert("instance".to_string(), Value::String("prod-01".to_string()));
        result_row.insert("_timestamp".to_string(), Value::Number(1234567890.into()));
        result_row.insert("value".to_string(), Value::Number(150.into()));

        let fields = extract_promql_label_fields(&result_row);

        assert_eq!(fields.len(), 2);
        assert!(fields.contains(&"job".to_string()));
        assert!(fields.contains(&"instance".to_string()));
        assert!(!fields.contains(&"_timestamp".to_string()));
        assert!(!fields.contains(&"value".to_string()));
    }

    #[test]
    fn test_json_value_to_string() {
        assert_eq!(json_value_to_string(&Value::Null), "null");
        assert_eq!(json_value_to_string(&Value::Bool(true)), "true");
        assert_eq!(json_value_to_string(&Value::Number(42.into())), "42");
        assert_eq!(
            json_value_to_string(&Value::String("test".to_string())),
            "test"
        );
    }

    #[test]
    fn test_is_within_window() {
        let now = Utc::now().timestamp_micros();

        let state = alert_dedup_state::Model {
            fingerprint: "test".to_string(),
            alert_id: "alert1".to_string(),
            org_id: "org1".to_string(),
            first_seen_at: now,
            last_seen_at: now - (5 * 60 * 1_000_000), // 5 minutes ago
            occurrence_count: 1,
            notification_sent: false,
            created_at: now,
        };

        // Should be within 10 minute window
        assert!(is_within_window(&state, 10));

        // Should not be within 3 minute window
        assert!(!is_within_window(&state, 3));
    }

    #[test]
    fn test_extract_all_non_timestamp_fields() {
        let mut row = Map::new();
        row.insert("field1".to_string(), Value::String("value1".to_string()));
        row.insert("field2".to_string(), Value::Number(42.into()));
        row.insert("_timestamp".to_string(), Value::Number(1234567890.into()));
        row.insert(
            TIMESTAMP_COL_NAME.to_string(),
            Value::Number(1234567890.into()),
        );

        let fields = extract_all_non_timestamp_fields(&row);

        assert_eq!(fields.len(), 2);
        assert!(fields.contains(&"field1".to_string()));
        assert!(fields.contains(&"field2".to_string()));
        assert!(!fields.contains(&"_timestamp".to_string()));
        assert!(!fields.contains(&TIMESTAMP_COL_NAME.to_string()));
    }
}
