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
use proto::cluster_rpc::SearchQuery;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};

/// Calculate fingerprint for an alert result row
///
/// The fingerprint provides context about WHAT is alerting (not just WHERE):
/// 1. Alert name: Semantic description (e.g., "High CPU", "High Memory")
/// 2. Metric/condition: What's being measured/checked
/// 3. Dimensional fields: Where the problem is (cluster, pod, etc.)
///
/// This ensures:
/// - Different alert types are NEVER deduplicated together
/// - Survives alert recreation (name-based, not ID-based)
/// - Provides semantic meaning (can understand from fingerprint alone)
///
/// Example:
/// - Alert "High CPU" with WHERE cpu_usage > 90, GROUP BY [cluster, pod] → Fingerprint:
///   sha256("High CPU|__metric:cpu_usage|cluster:prod|pod:api-1")
/// - Alert "High Memory" with WHERE memory_usage > 90, GROUP BY [cluster, pod] → Fingerprint:
///   sha256("High Memory|__metric:memory_usage|cluster:prod|pod:api-1") → Different fingerprints,
///   correctly treated as separate incidents
pub fn calculate_fingerprint(
    alert: &Alert,
    result_row: &Map<String, Value>,
    config: &DeduplicationConfig,
) -> String {
    let fields = get_fingerprint_fields(alert, result_row, config);

    // Start with alert name for semantic context
    let mut parts = vec![alert.name.clone()];

    // Add metric/condition context from the query
    parts.extend(extract_query_context(alert));

    // Add dimensional fields (GROUP BY columns or user-selected fields)
    for field in fields {
        if let Some(val) = result_row.get(&field) {
            parts.push(format!("{}:{}", field, json_value_to_string(val)));
        }
    }

    // Generate SHA-256 hash using sha256 crate
    sha256::digest(parts.join("|"))
}

/// Extract query context (metrics/conditions) to include in fingerprint
///
/// This provides the "WHAT" context - what metric/condition is being checked.
/// For SQL: Extracts metric columns from SELECT (non-GROUP BY columns)
/// For PromQL: Extracts metric name from query
/// For Custom: Extracts condition column names
fn extract_query_context(alert: &Alert) -> Vec<String> {
    let mut context = Vec::new();

    match alert.query_condition.query_type {
        QueryType::SQL => {
            // Extract metric columns from SELECT clause using OpenObserve's SQL parser
            if let Some(sql) = &alert.query_condition.sql
                && let Some(metrics) = extract_sql_metrics_from_alert(alert, sql)
            {
                context.extend(metrics);
            }
        }
        QueryType::PromQL => {
            // Extract metric name and label selectors from PromQL query
            if let Some(promql) = &alert.query_condition.promql {
                context.extend(extract_promql_context(promql));
            }
        }
        QueryType::Custom => {
            // Extract column names from conditions
            if let Some(conditions) = &alert.query_condition.conditions {
                let mut fields = HashSet::new();
                extract_condition_fields(conditions, &mut fields);
                for field in fields {
                    context.push(format!("__condition:{field}"));
                }
            }
        }
    }

    context
}

/// Extract metric columns and WHERE conditions from SQL query
///
/// This function uses the existing SQL parsing infrastructure to extract:
/// 1. **Metric columns**: Columns being measured (from SELECT, excluding GROUP BY and
///    non-aggregated)
/// 2. **WHERE conditions**: Equality conditions that provide context (cluster='prod', etc.)
///
/// Strategy for handling non-GROUP BY columns in SELECT:
/// - If query has aggregation (alert.query_condition.aggregation exists):
///   - Only include columns that appear to be in result row (actual metrics)
///   - Non-aggregated SELECT columns (like status, region) are filtered out
///   - This works because GROUP BY enforcement means non-aggregated columns must be in GROUP BY
/// - If no aggregation: Include all columns (it's a simple query)
///
/// WHERE conditions add important context:
/// - Alert on cluster='prod' is different from cluster='staging'
/// - Conditions like status='active' narrow the semantic scope
///
/// Examples:
/// - "SELECT AVG(cpu_usage) FROM ... WHERE cluster='prod'" → metrics: ["cpu_usage"], conditions:
///   ["cluster:prod"]
/// - "SELECT cluster, AVG(cpu) FROM ... WHERE region='us' GROUP BY cluster" → metrics: ["cpu"],
///   conditions: ["region:us"]
/// - "SELECT cluster, status, AVG(cpu) FROM ... GROUP BY cluster" → metrics: ["cpu"] (status
///   filtered out as it's not in GROUP BY and not aggregated)
fn extract_sql_metrics_from_alert(alert: &Alert, sql: &str) -> Option<Vec<String>> {
    // Create a SearchQuery to use with Sql struct
    let search_query = SearchQuery {
        sql: sql.to_string(),
        from: 0,
        size: 1, // We only care about schema, not results
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

    // Use async runtime to parse SQL (this is called from sync context)
    let sql_parsed = tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(async {
            crate::service::search::sql::Sql::new(
                &search_query,
                &alert.org_id,
                alert.stream_type,
                None,
            )
            .await
        })
    });

    let sql_struct = match sql_parsed {
        Ok(s) => s,
        Err(e) => {
            log::debug!("Failed to parse SQL for metric extraction: {}", e);
            return None;
        }
    };

    let mut context = Vec::new();

    // 1. Extract WHERE clause equality conditions (provides important context)
    // Example: WHERE cluster='prod' AND status='active'
    for (_table, equal_items) in sql_struct.equal_items.iter() {
        for (field, value) in equal_items {
            context.push(format!("__where:{field}={value}"));
        }
    }

    // 2. Extract metric columns from SELECT
    let mut all_columns = HashSet::new();
    for (_table, columns) in sql_struct.columns.iter() {
        all_columns.extend(columns.clone());
    }

    // Remove GROUP BY fields (they're dimensional, not metrics)
    let group_by_set: HashSet<String> = sql_struct.group_by.iter().cloned().collect();

    // Note: We rely on SQL's GROUP BY semantics to filter non-metric columns:
    // - Any non-aggregated column in SELECT must be in GROUP BY (already filtered)
    // - Remaining columns are either aggregated (metrics) or from non-aggregated queries
    // This naturally handles the case where SELECT has extra dimensional fields.

    let metrics: Vec<String> = all_columns
        .difference(&group_by_set)
        .filter(|col| {
            // Filter out common timestamp columns
            let col_lower = col.to_lowercase();
            col_lower != "_timestamp"
                && col_lower != TIMESTAMP_COL_NAME
                && !col_lower.ends_with("_time")
        })
        .map(|col| format!("__metric:{col}"))
        .take(5) // Limit to first 5 metrics for fingerprint brevity
        .collect();

    context.extend(metrics);

    if context.is_empty() {
        None
    } else {
        Some(context)
    }
}

/// Extract metric name and label selectors from PromQL query
///
/// Returns a vector containing:
/// 1. The metric name prefixed with __metric:
/// 2. Label selectors (equivalent to SQL WHERE) prefixed with __label:
///
/// Label selectors provide important context, similar to SQL WHERE clauses.
/// Example: cpu_usage{cluster="prod"} is different from cpu_usage{cluster="staging"}
///
/// Examples:
/// - "rate(http_requests_total[5m])" → ["__metric:http_requests_total"]
/// - "cpu_usage{cluster=\"prod\"}" → ["__metric:cpu_usage", "__label:cluster=prod"]
/// - "sum(memory{env=\"prod\", region=\"us\"})" → ["__metric:memory", "__label:env=prod",
///   "__label:region=us"]
fn extract_promql_context(promql: &str) -> Vec<String> {
    let mut context = Vec::new();
    let promql = promql.trim();

    // 1. Extract metric name
    if let Some(metric) = extract_promql_metric_name_internal(promql) {
        context.push(format!("__metric:{metric}"));
    }

    // 2. Extract label selectors (equivalent to SQL WHERE)
    // PromQL label selectors are in curly braces: metric_name{label1="value1", label2="value2"}
    if let Some(start) = promql.find('{')
        && let Some(end) = promql[start..].find('}')
    {
        let labels_str = &promql[start + 1..start + end];

        // Parse label selectors: label="value" or label='value'
        // Split by comma, handling potential spaces
        for label_pair in labels_str.split(',') {
            let label_pair = label_pair.trim();

            // Parse label="value" or label='value' or label=~"regex"
            if let Some(eq_pos) = label_pair.find('=') {
                let label_name = label_pair[..eq_pos].trim();
                let mut value_part = label_pair[eq_pos + 1..].trim();

                // Skip regex matchers (=~ and !~) for now, only handle exact matches
                if label_name.is_empty() || value_part.starts_with('~') {
                    continue;
                }

                // Remove quotes from value
                value_part = value_part.trim_start_matches('"').trim_end_matches('"');
                value_part = value_part.trim_start_matches('\'').trim_end_matches('\'');

                if !value_part.is_empty() {
                    context.push(format!("__label:{label_name}={value_part}"));
                }
            }
        }
    }

    context
}

/// Internal function to extract just the metric name from PromQL
fn extract_promql_metric_name_internal(promql: &str) -> Option<String> {
    // Extract the metric name from PromQL
    // Example: "rate(http_requests_total[5m])" → "http_requests_total"
    // Example: "sum(cpu_usage) by (pod)" → "cpu_usage"
    // Example: "http_requests_total" → "http_requests_total"

    let promql = promql.trim();

    // Try to find metric name between parentheses or at the start
    if let Some(paren_pos) = promql.find('(') {
        let inside = &promql[paren_pos + 1..];
        if let Some(end_pos) = inside.find(|c: char| !c.is_alphanumeric() && c != '_') {
            Some(inside[..end_pos].to_string())
        } else {
            // Metric name is the entire content inside parentheses
            Some(inside.to_string())
        }
    } else {
        // Metric at the start
        if let Some(end_pos) = promql.find(|c: char| !c.is_alphanumeric() && c != '_') {
            Some(promql[..end_pos].to_string())
        } else {
            // Entire string is the metric name
            Some(promql.to_string())
        }
    }
}

/// Legacy function for backward compatibility with tests
#[cfg(test)]
fn extract_promql_metric_name(promql: &str) -> Option<String> {
    extract_promql_metric_name_internal(promql)
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

    // Note: SQL metric extraction tests require async runtime and database setup,
    // so they are better suited for integration tests rather than unit tests.
    // The extract_sql_metrics_from_alert function reuses OpenObserve's existing
    // Sql struct which handles all the complex parsing logic.

    #[test]
    fn test_extract_promql_metric_name_simple() {
        assert_eq!(
            extract_promql_metric_name("http_requests_total"),
            Some("http_requests_total".to_string())
        );
    }

    #[test]
    fn test_extract_promql_metric_name_with_function() {
        assert_eq!(
            extract_promql_metric_name("rate(http_requests_total[5m])"),
            Some("http_requests_total".to_string())
        );
    }

    #[test]
    fn test_extract_promql_metric_name_with_aggregation() {
        assert_eq!(
            extract_promql_metric_name("sum(cpu_usage) by (pod)"),
            Some("cpu_usage".to_string())
        );
    }

    #[test]
    fn test_extract_promql_context_no_labels() {
        let context = extract_promql_context("rate(http_requests_total[5m])");
        assert_eq!(context.len(), 1);
        assert!(context.contains(&"__metric:http_requests_total".to_string()));
    }

    #[test]
    fn test_extract_promql_context_with_single_label() {
        let context = extract_promql_context("cpu_usage{cluster=\"prod\"}");
        assert_eq!(context.len(), 2);
        assert!(context.contains(&"__metric:cpu_usage".to_string()));
        assert!(context.contains(&"__label:cluster=prod".to_string()));
    }

    #[test]
    fn test_extract_promql_context_with_multiple_labels() {
        let context = extract_promql_context("sum(memory{env=\"prod\", region=\"us\"}) by (pod)");
        assert_eq!(context.len(), 3);
        assert!(context.contains(&"__metric:memory".to_string()));
        assert!(context.contains(&"__label:env=prod".to_string()));
        assert!(context.contains(&"__label:region=us".to_string()));
    }

    #[test]
    fn test_extract_promql_context_different_label_values() {
        // Production alert
        let prod_context = extract_promql_context("avg(cpu_usage{cluster=\"prod\"}) by (pod)");

        // Staging alert
        let staging_context =
            extract_promql_context("avg(cpu_usage{cluster=\"staging\"}) by (pod)");

        // Should produce different contexts
        assert_ne!(prod_context, staging_context);
        assert!(prod_context.contains(&"__label:cluster=prod".to_string()));
        assert!(staging_context.contains(&"__label:cluster=staging".to_string()));
    }

    #[test]
    fn test_extract_promql_context_with_single_quotes() {
        let context = extract_promql_context("cpu_usage{cluster='prod'}");
        assert_eq!(context.len(), 2);
        assert!(context.contains(&"__metric:cpu_usage".to_string()));
        assert!(context.contains(&"__label:cluster=prod".to_string()));
    }
}
