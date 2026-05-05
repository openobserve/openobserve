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

pub mod requests;
pub mod responses;

use config::meta::{
    alerts::{self as meta_alerts, deduplication::DeduplicationConfig, default_align_time},
    search as meta_search, stream as meta_stream,
    triggers::Trigger,
};
use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use svix_ksuid::Ksuid;
use utoipa::ToSchema;

/// Alert configuration for monitoring streams and triggering notifications.
///
/// An alert watches a stream (logs, metrics, or traces) using SQL or PromQL queries,
/// and sends notifications to configured destinations when trigger conditions are met.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Alert {
    /// Unique identifier for the alert. Auto-generated on creation.
    #[serde(default)]
    #[schema(read_only)]
    #[schema(value_type = Option<String>)]
    pub id: Option<Ksuid>,

    /// Human-readable name for the alert. Must be unique within the organization.
    #[serde(default)]
    #[schema(example = "High Error Rate Alert")]
    pub name: String,

    /// Organization ID. Usually set automatically from the request context.
    #[serde(default)]
    pub org_id: String,

    /// Type of stream to monitor: logs, metrics, or traces.
    #[serde(default)]
    pub stream_type: StreamType,

    /// Name of the stream to monitor.
    #[serde(default)]
    #[schema(example = "default")]
    pub stream_name: String,

    /// If true, alert evaluates in real-time as data arrives.
    /// If false, alert runs on a schedule defined by trigger_condition.frequency.
    #[serde(default)]
    pub is_real_time: bool,

    /// Query configuration: SQL query or PromQL expression to evaluate.
    #[serde(default)]
    pub query_condition: QueryCondition,

    /// Trigger configuration: when and how often to evaluate, thresholds.
    #[serde(default)]
    pub trigger_condition: TriggerCondition,

    /// List of destination names to notify when alert fires.
    /// Destinations must be pre-configured in the system.
    /// Accepts either `destinations` or `alert_destinations` as the JSON field name.
    #[serde(default, alias = "alert_destinations")]
    #[schema(example = json!(["slack-alerts", "pagerduty"]))]
    pub destinations: Vec<String>,

    /// Optional template name. When specified, this template is used for all
    /// destinations instead of destination-level templates. This allows using
    /// different templates for different alerts while reusing the same destinations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,

    /// Optional key-value attributes to include in alert notifications.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_attributes: Option<HashMap<String, String>>,

    /// Template for formatting individual rows in the alert message.
    #[serde(default)]
    pub row_template: String,

    /// Format type for the row template.
    #[serde(default)]
    pub row_template_type: meta_alerts::alert::RowTemplateType,

    /// Human-readable description of what this alert monitors.
    #[serde(default)]
    #[schema(example = "Fires when error count exceeds threshold in the specified time window")]
    pub description: String,

    /// Whether the alert is active. Disabled alerts are not evaluated.
    #[serde(default)]
    pub enabled: bool,

    /// Timezone offset in minutes. Negative values for western hemisphere.
    #[serde(default)]
    pub tz_offset: i32,

    /// Unix timestamp of when alert was last triggered.
    #[serde(default)]
    #[schema(read_only)]
    pub last_triggered_at: Option<i64>,

    /// Unix timestamp of when alert condition was last satisfied.
    #[serde(default)]
    #[schema(read_only)]
    pub last_satisfied_at: Option<i64>,

    /// Username of the alert owner.
    #[serde(default)]
    pub owner: Option<String>,

    /// Unix timestamp of last modification.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(read_only)]
    pub updated_at: Option<i64>,

    /// Username who last edited the alert.
    #[serde(default)]
    #[schema(read_only)]
    pub last_edited_by: Option<String>,

    /// Optional deduplication configuration to prevent alert spam.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deduplication: Option<DeduplicationConfig>,

    /// When true, this alert routes notifications through the incident system
    /// instead of sending direct alert notifications.
    #[serde(default)]
    pub creates_incident: bool,
}

/// Configuration for when and how an alert should be triggered.
///
/// ## Example
/// ```json
/// {
///     "period": 15,
///     "operator": ">=",
///     "threshold": 100,
///     "frequency": 5,
///     "frequency_type": "minutes",
///     "silence": 60
/// }
/// ```
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct TriggerCondition {
    /// Time window in minutes to evaluate. The query looks back this many minutes.
    #[serde(rename = "period")]
    #[schema(example = 15)]
    pub period_minutes: i64,

    /// Comparison operator for threshold: =, !=, >, >=, <, <=
    #[serde(default)]
    pub operator: Operator,

    /// Threshold value to compare against the query result.
    #[serde(rename = "threshold")]
    #[serde(default)]
    #[schema(example = 100)]
    pub threshold_count: i64,

    /// How often (in minutes) to run the alert query. Used with frequency_type="minutes".
    #[serde(rename = "frequency")]
    #[serde(default)]
    #[schema(example = 5)]
    pub frequency_minutes: i64,

    /// Cron expression for scheduling. Used with frequency_type="cron".
    #[serde(default)]
    #[schema(example = "0 */5 * * *")]
    pub cron: String,

    /// Schedule type: "minutes" for interval-based or "cron" for cron expressions.
    #[serde(default)]
    pub frequency_type: FrequencyType,

    /// Silence period in minutes after an alert fires before it can fire again.
    #[serde(rename = "silence")]
    #[serde(default)]
    #[schema(example = 60)]
    pub silence_minutes: i64,

    /// Timezone for cron scheduling (e.g., "America/New_York").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,

    /// Tolerance in seconds for time-based comparisons.
    #[serde(rename = "tolerance_in_secs")]
    #[serde(default)]
    pub tolerance_seconds: Option<i64>,

    /// Whether to align query time windows to period boundaries.
    #[serde(default = "default_align_time")]
    pub align_time: bool,
}

#[derive(Clone, Default, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct CompareHistoricData {
    #[serde(rename = "offSet")]
    pub offset: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum FrequencyType {
    #[serde(rename = "cron")]
    Cron,

    #[serde(rename = "minutes")]
    #[default]
    Minutes,
}

/// Query configuration for alert evaluation.
///
/// Supports three query types:
/// - **sql**: Use a SQL query that returns aggregated results
/// - **promql**: Use a PromQL expression for metrics
/// - **custom**: Use UI-defined conditions with optional aggregation
///
/// ## SQL Example
/// ```json
/// {
///     "type": "sql",
///     "sql": "SELECT count(*) as count FROM \"default\" WHERE level = 'error'"
/// }
/// ```
///
/// ## PromQL Example
/// ```json
/// {
///     "type": "promql",
///     "promql": "rate(http_requests_total{status=\"500\"}[5m])",
///     "promql_condition": {
///         "column": "value",
///         "operator": ">",
///         "value": 10
///     }
/// }
/// ```
///
/// ## Custom with Aggregation Example
/// ```json
/// {
///     "type": "custom",
///     "aggregation": {
///         "group_by": ["service"],
///         "function": "count",
///         "having": {
///             "column": "count",
///             "operator": ">=",
///             "value": 100
///         }
///     }
/// }
/// ```
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct QueryCondition {
    /// Type of query: "sql", "promql", or "custom"
    #[serde(default)]
    #[serde(rename = "type")]
    pub query_type: QueryType,

    /// Filter conditions for "custom" query type. Supports both V1 (flat) and V2 (nested) formats.
    #[schema(value_type = Option<Object>)]
    pub conditions: Option<meta_alerts::AlertConditionParams>,

    /// SQL query string. Used with type="sql". Query should return aggregated results
    /// that can be compared against the trigger threshold.
    #[schema(example = "SELECT count(*) as count FROM \"default\" WHERE level = 'error'")]
    pub sql: Option<String>,

    /// PromQL expression. Used with type="promql".
    #[schema(example = "rate(http_requests_total{status=\"500\"}[5m])")]
    pub promql: Option<String>,

    /// Condition to apply to PromQL results. Required with type="promql".
    pub promql_condition: Option<Condition>,

    /// Aggregation configuration for "custom" query type.
    pub aggregation: Option<Aggregation>,

    /// Optional VRL (Vector Remap Language) function for data transformation.
    #[serde(default)]
    pub vrl_function: Option<String>,

    /// Search event type classification.
    #[serde(default)]
    pub search_event_type: Option<SearchEventType>,

    /// Historical comparison periods for anomaly detection.
    #[serde(default)]
    pub multi_time_range: Option<Vec<CompareHistoricData>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct Aggregation {
    pub group_by: Option<Vec<String>>,
    pub function: AggFunction,
    pub having: Condition,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum AggFunction {
    #[serde(rename = "avg")]
    Avg,
    #[serde(rename = "min")]
    Min,
    #[serde(rename = "max")]
    Max,
    #[serde(rename = "sum")]
    Sum,
    #[serde(rename = "count")]
    Count,
    #[serde(rename = "median")]
    Median,
    #[serde(rename = "p50")]
    P50,
    #[serde(rename = "p75")]
    P75,
    #[serde(rename = "p90")]
    P90,
    #[serde(rename = "p95")]
    P95,
    #[serde(rename = "p99")]
    P99,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum QueryType {
    #[default]
    #[serde(rename = "custom")]
    Custom,
    #[serde(rename = "sql")]
    SQL,
    #[serde(rename = "promql")]
    PromQL,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Condition {
    pub column: String,
    pub operator: Operator,
    #[schema(value_type = Object)]
    pub value: JsonValue,
    #[serde(default)]
    pub ignore_case: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, Default)]
pub enum Operator {
    #[serde(rename = "=")]
    #[default]
    EqualTo,
    #[serde(rename = "!=")]
    NotEqualTo,
    #[serde(rename = ">")]
    GreaterThan,
    #[serde(rename = ">=")]
    GreaterThanEquals,
    #[serde(rename = "<")]
    LessThan,
    #[serde(rename = "<=")]
    LessThanEquals,
    Contains,
    NotContains,
}

#[derive(Hash, Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SearchEventType {
    UI,
    Dashboards,
    Reports,
    Alerts,
    Values,
    Other,
    RUM,
    DerivedStream,
    SearchJob,
    Download,
    Insights,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema, Hash)]
#[serde(rename_all = "lowercase")]
pub enum StreamType {
    #[default]
    Logs,
    Metrics,
    Traces,
    #[serde(rename = "enrichment_tables")]
    EnrichmentTables,
    #[serde(rename = "file_list")]
    Filelist,
    Metadata,
    Index,
}

// Translation functions from models in the config::meta module to models the
// http::models module.

impl From<(meta_alerts::alert::Alert, Option<Trigger>)> for Alert {
    fn from(value: (meta_alerts::alert::Alert, Option<Trigger>)) -> Self {
        let (alert, trigger) = value;
        let (last_triggered_at, last_satisfied_at) = (
            alert.get_last_triggered_at(trigger.as_ref()),
            alert.get_last_satisfied_at(trigger.as_ref()),
        );
        Self {
            id: alert.id,
            name: alert.name,
            org_id: alert.org_id,
            stream_type: alert.stream_type.into(),
            stream_name: alert.stream_name,
            is_real_time: alert.is_real_time,
            query_condition: alert.query_condition.into(),
            trigger_condition: alert.trigger_condition.into(),
            destinations: alert.destinations,
            template: alert.template,
            context_attributes: alert.context_attributes,
            row_template: alert.row_template,
            row_template_type: alert.row_template_type,
            description: alert.description,
            enabled: alert.enabled,
            tz_offset: alert.tz_offset,
            last_triggered_at,
            last_satisfied_at,
            owner: alert.owner,
            updated_at: alert.updated_at.map(|t| t.timestamp()),
            last_edited_by: alert.last_edited_by,
            deduplication: alert.deduplication,
            creates_incident: alert.creates_incident,
        }
    }
}

impl From<meta_alerts::TriggerCondition> for TriggerCondition {
    fn from(value: meta_alerts::TriggerCondition) -> Self {
        Self {
            period_minutes: value.period,
            operator: value.operator.into(),
            threshold_count: value.threshold,
            frequency_minutes: value.frequency / 60,
            cron: value.cron,
            frequency_type: value.frequency_type.into(),
            silence_minutes: value.silence,
            timezone: value.timezone,
            tolerance_seconds: value.tolerance_in_secs,
            align_time: value.align_time,
        }
    }
}

impl From<meta_alerts::CompareHistoricData> for CompareHistoricData {
    fn from(value: meta_alerts::CompareHistoricData) -> Self {
        Self {
            offset: value.offset,
        }
    }
}

impl From<meta_alerts::FrequencyType> for FrequencyType {
    fn from(value: meta_alerts::FrequencyType) -> Self {
        match value {
            meta_alerts::FrequencyType::Cron => Self::Cron,
            meta_alerts::FrequencyType::Minutes => Self::Minutes,
        }
    }
}

impl From<meta_alerts::QueryCondition> for QueryCondition {
    fn from(value: meta_alerts::QueryCondition) -> Self {
        Self {
            query_type: value.query_type.into(),
            // Pass AlertConditionParams directly (supports both V1 and V2)
            conditions: value.conditions,
            sql: value.sql,
            promql: value.promql,
            promql_condition: value.promql_condition.map(|pc| pc.into()),
            aggregation: value.aggregation.map(|a| a.into()),
            vrl_function: value.vrl_function,
            search_event_type: value.search_event_type.map(|t| t.into()),
            multi_time_range: value
                .multi_time_range
                .map(|cs| cs.into_iter().map(|c| c.into()).collect()),
        }
    }
}

impl From<meta_alerts::Aggregation> for Aggregation {
    fn from(value: meta_alerts::Aggregation) -> Self {
        Self {
            group_by: value.group_by,
            function: value.function.into(),
            having: value.having.into(),
        }
    }
}

impl From<meta_alerts::AggFunction> for AggFunction {
    fn from(value: meta_alerts::AggFunction) -> Self {
        match value {
            meta_alerts::AggFunction::Avg => Self::Avg,
            meta_alerts::AggFunction::Min => Self::Min,
            meta_alerts::AggFunction::Max => Self::Max,
            meta_alerts::AggFunction::Sum => Self::Sum,
            meta_alerts::AggFunction::Count => Self::Count,
            meta_alerts::AggFunction::Median => Self::Median,
            meta_alerts::AggFunction::P50 => Self::P50,
            meta_alerts::AggFunction::P75 => Self::P75,
            meta_alerts::AggFunction::P90 => Self::P90,
            meta_alerts::AggFunction::P95 => Self::P95,
            meta_alerts::AggFunction::P99 => Self::P99,
        }
    }
}

impl From<meta_alerts::QueryType> for QueryType {
    fn from(value: meta_alerts::QueryType) -> Self {
        match value {
            meta_alerts::QueryType::Custom => Self::Custom,
            meta_alerts::QueryType::SQL => Self::SQL,
            meta_alerts::QueryType::PromQL => Self::PromQL,
        }
    }
}

impl From<meta_alerts::Condition> for Condition {
    fn from(value: meta_alerts::Condition) -> Self {
        Self {
            column: value.column,
            operator: value.operator.into(),
            value: value.value,
            ignore_case: value.ignore_case,
        }
    }
}

impl From<meta_alerts::Operator> for Operator {
    fn from(value: meta_alerts::Operator) -> Self {
        match value {
            meta_alerts::Operator::EqualTo => Self::EqualTo,
            meta_alerts::Operator::NotEqualTo => Self::NotEqualTo,
            meta_alerts::Operator::GreaterThan => Self::GreaterThan,
            meta_alerts::Operator::GreaterThanEquals => Self::GreaterThanEquals,
            meta_alerts::Operator::LessThan => Self::LessThan,
            meta_alerts::Operator::LessThanEquals => Self::LessThanEquals,
            meta_alerts::Operator::Contains => Self::Contains,
            meta_alerts::Operator::NotContains => Self::NotContains,
        }
    }
}

impl From<meta_search::SearchEventType> for SearchEventType {
    fn from(value: meta_search::SearchEventType) -> Self {
        match value {
            meta_search::SearchEventType::UI => Self::UI,
            meta_search::SearchEventType::Dashboards => Self::Dashboards,
            meta_search::SearchEventType::Reports => Self::Reports,
            meta_search::SearchEventType::Alerts => Self::Alerts,
            meta_search::SearchEventType::Values => Self::Values,
            meta_search::SearchEventType::Other => Self::Other,
            meta_search::SearchEventType::RUM => Self::RUM,
            meta_search::SearchEventType::DerivedStream => Self::DerivedStream,
            meta_search::SearchEventType::SearchJob => Self::SearchJob,
            meta_search::SearchEventType::Download => Self::Download,
            meta_search::SearchEventType::Insights => Self::Insights,
        }
    }
}

impl From<meta_stream::StreamType> for StreamType {
    fn from(value: meta_stream::StreamType) -> Self {
        match value {
            meta_stream::StreamType::Logs => Self::Logs,
            meta_stream::StreamType::Metrics => Self::Metrics,
            meta_stream::StreamType::Traces => Self::Traces,
            meta_stream::StreamType::ServiceGraph => Self::Metadata, // ServiceGraph not
            // alertable, map to
            // Metadata
            meta_stream::StreamType::EnrichmentTables => Self::EnrichmentTables,
            meta_stream::StreamType::Filelist => Self::Filelist,
            meta_stream::StreamType::Metadata => Self::Metadata,
            meta_stream::StreamType::Index => Self::Index,
        }
    }
}

// Translation functions from models in the http::models module to models in the
// config::meta module.

impl From<Alert> for meta_alerts::alert::Alert {
    fn from(value: Alert) -> Self {
        let mut alert: meta_alerts::alert::Alert = Default::default();
        alert.id = value.id;
        alert.name = value.name;
        alert.org_id = value.org_id;
        alert.stream_type = value.stream_type.into();
        alert.stream_name = value.stream_name;
        alert.is_real_time = value.is_real_time;
        alert.query_condition = value.query_condition.into();
        alert.trigger_condition = value.trigger_condition.into();
        alert.destinations = value.destinations;
        alert.template = value.template;
        alert.context_attributes = value.context_attributes;
        alert.row_template = value.row_template;
        alert.row_template_type = value.row_template_type;
        alert.description = value.description;
        alert.enabled = value.enabled;
        alert.tz_offset = value.tz_offset;
        alert.owner = value.owner;
        alert.deduplication = value.deduplication;
        alert.creates_incident = value.creates_incident;

        alert
    }
}

impl From<TriggerCondition> for meta_alerts::TriggerCondition {
    fn from(value: TriggerCondition) -> Self {
        Self {
            align_time: value.align_time,
            period: value.period_minutes,
            operator: value.operator.into(),
            threshold: value.threshold_count,
            frequency: value.frequency_minutes * 60,
            cron: value.cron,
            frequency_type: value.frequency_type.into(),
            silence: value.silence_minutes,
            timezone: value.timezone,
            tolerance_in_secs: value.tolerance_seconds,
        }
    }
}

impl From<CompareHistoricData> for meta_alerts::CompareHistoricData {
    fn from(value: CompareHistoricData) -> Self {
        Self {
            offset: value.offset,
        }
    }
}

impl From<FrequencyType> for meta_alerts::FrequencyType {
    fn from(value: FrequencyType) -> Self {
        match value {
            FrequencyType::Cron => Self::Cron,
            FrequencyType::Minutes => Self::Minutes,
        }
    }
}

impl From<QueryCondition> for meta_alerts::QueryCondition {
    fn from(value: QueryCondition) -> Self {
        Self {
            query_type: value.query_type.into(),
            // Pass AlertConditionParams directly (supports both V1 and V2)
            conditions: value.conditions,
            sql: value.sql,
            promql: value.promql,
            promql_condition: value.promql_condition.map(|pc| pc.into()),
            aggregation: value.aggregation.map(|a| a.into()),
            vrl_function: value.vrl_function,
            search_event_type: value.search_event_type.map(|t| t.into()),
            multi_time_range: value
                .multi_time_range
                .map(|cs| cs.into_iter().map(|c| c.into()).collect()),
        }
    }
}

impl From<Aggregation> for meta_alerts::Aggregation {
    fn from(value: Aggregation) -> Self {
        Self {
            group_by: value.group_by,
            function: value.function.into(),
            having: value.having.into(),
        }
    }
}

impl From<AggFunction> for meta_alerts::AggFunction {
    fn from(value: AggFunction) -> Self {
        match value {
            AggFunction::Avg => Self::Avg,
            AggFunction::Min => Self::Min,
            AggFunction::Max => Self::Max,
            AggFunction::Sum => Self::Sum,
            AggFunction::Count => Self::Count,
            AggFunction::Median => Self::Median,
            AggFunction::P50 => Self::P50,
            AggFunction::P75 => Self::P75,
            AggFunction::P90 => Self::P90,
            AggFunction::P95 => Self::P95,
            AggFunction::P99 => Self::P99,
        }
    }
}

impl From<QueryType> for meta_alerts::QueryType {
    fn from(value: QueryType) -> Self {
        match value {
            QueryType::Custom => Self::Custom,
            QueryType::SQL => Self::SQL,
            QueryType::PromQL => Self::PromQL,
        }
    }
}

impl From<Condition> for meta_alerts::Condition {
    fn from(value: Condition) -> Self {
        Self {
            column: value.column,
            operator: value.operator.into(),
            value: value.value,
            ignore_case: value.ignore_case,
        }
    }
}

impl From<Operator> for meta_alerts::Operator {
    fn from(value: Operator) -> Self {
        match value {
            Operator::EqualTo => Self::EqualTo,
            Operator::NotEqualTo => Self::NotEqualTo,
            Operator::GreaterThan => Self::GreaterThan,
            Operator::GreaterThanEquals => Self::GreaterThanEquals,
            Operator::LessThan => Self::LessThan,
            Operator::LessThanEquals => Self::LessThanEquals,
            Operator::Contains => Self::Contains,
            Operator::NotContains => Self::NotContains,
        }
    }
}

impl From<SearchEventType> for meta_search::SearchEventType {
    fn from(value: SearchEventType) -> Self {
        match value {
            SearchEventType::UI => Self::UI,
            SearchEventType::Dashboards => Self::Dashboards,
            SearchEventType::Reports => Self::Reports,
            SearchEventType::Alerts => Self::Alerts,
            SearchEventType::Values => Self::Values,
            SearchEventType::Other => Self::Other,
            SearchEventType::RUM => Self::RUM,
            SearchEventType::DerivedStream => Self::DerivedStream,
            SearchEventType::SearchJob => Self::SearchJob,
            SearchEventType::Download => Self::Download,
            SearchEventType::Insights => Self::Insights,
        }
    }
}

impl From<StreamType> for meta_stream::StreamType {
    fn from(value: StreamType) -> Self {
        match value {
            StreamType::Logs => Self::Logs,
            StreamType::Metrics => Self::Metrics,
            StreamType::Traces => Self::Traces,
            StreamType::EnrichmentTables => Self::EnrichmentTables,
            StreamType::Filelist => Self::Filelist,
            StreamType::Metadata => Self::Metadata,
            StreamType::Index => Self::Index,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_query_condition_v2_deserialization() {
        // Test that the API layer can deserialize V2 conditions
        let json = r#"{
            "type": "custom",
            "conditions": {
                "version": 2,
                "conditions": {
                    "filterType": "group",
                    "logicalOperator": "AND",
                    "conditions": [
                        {
                            "filterType": "condition",
                            "type": "condition",
                            "column": "level",
                            "operator": "=",
                            "value": "error",
                            "logicalOperator": "AND"
                        },
                        {
                            "filterType": "condition",
                            "type": "condition",
                            "column": "service",
                            "operator": "=",
                            "value": "api",
                            "logicalOperator": "OR"
                        }
                    ]
                }
            },
            "sql": null,
            "promql": null,
            "aggregation": null,
            "promql_condition": null,
            "vrl_function": null,
            "search_event_type": null,
            "multi_time_range": null
        }"#;

        let result: Result<QueryCondition, _> = serde_json::from_str(json);
        assert!(
            result.is_ok(),
            "V2 deserialization failed: {:?}",
            result.err()
        );

        let query_cond = result.unwrap();
        assert_eq!(query_cond.query_type, QueryType::Custom);
        assert!(query_cond.conditions.is_some());

        // Verify it's V2
        match query_cond.conditions.unwrap() {
            meta_alerts::AlertConditionParams::V2(group) => {
                assert_eq!(group.filter_type, "group");
                assert_eq!(group.conditions.len(), 2);
            }
            _ => panic!("Expected V2 variant"),
        }
    }

    #[test]
    fn test_query_condition_v1_deserialization() {
        // Test that the API layer still supports V1 conditions
        let json = r#"{
            "type": "custom",
            "conditions": {
                "and": [
                    {
                        "column": "level",
                        "operator": "=",
                        "value": "error",
                        "ignore_case": false
                    },
                    {
                        "column": "service",
                        "operator": "=",
                        "value": "api",
                        "ignore_case": false
                    }
                ]
            },
            "sql": null,
            "promql": null,
            "aggregation": null,
            "promql_condition": null,
            "vrl_function": null,
            "search_event_type": null,
            "multi_time_range": null
        }"#;

        let result: Result<QueryCondition, _> = serde_json::from_str(json);
        assert!(
            result.is_ok(),
            "V1 deserialization failed: {:?}",
            result.err()
        );

        let query_cond = result.unwrap();
        assert!(query_cond.conditions.is_some());

        // Verify it's V1
        match query_cond.conditions.unwrap() {
            meta_alerts::AlertConditionParams::V1(_) => {}
            _ => panic!("Expected V1 variant"),
        }
    }

    #[test]
    fn test_agg_function_from_meta_all_variants() {
        use meta_alerts::AggFunction as M;
        assert!(matches!(AggFunction::from(M::Avg), AggFunction::Avg));
        assert!(matches!(AggFunction::from(M::Min), AggFunction::Min));
        assert!(matches!(AggFunction::from(M::Max), AggFunction::Max));
        assert!(matches!(AggFunction::from(M::Sum), AggFunction::Sum));
        assert!(matches!(AggFunction::from(M::Count), AggFunction::Count));
        assert!(matches!(AggFunction::from(M::Median), AggFunction::Median));
        assert!(matches!(AggFunction::from(M::P50), AggFunction::P50));
        assert!(matches!(AggFunction::from(M::P75), AggFunction::P75));
        assert!(matches!(AggFunction::from(M::P90), AggFunction::P90));
        assert!(matches!(AggFunction::from(M::P95), AggFunction::P95));
        assert!(matches!(AggFunction::from(M::P99), AggFunction::P99));
    }

    #[test]
    fn test_agg_function_to_meta_all_variants() {
        use meta_alerts::AggFunction as M;
        assert!(matches!(M::from(AggFunction::Avg), M::Avg));
        assert!(matches!(M::from(AggFunction::Min), M::Min));
        assert!(matches!(M::from(AggFunction::Max), M::Max));
        assert!(matches!(M::from(AggFunction::Sum), M::Sum));
        assert!(matches!(M::from(AggFunction::Count), M::Count));
        assert!(matches!(M::from(AggFunction::Median), M::Median));
        assert!(matches!(M::from(AggFunction::P50), M::P50));
        assert!(matches!(M::from(AggFunction::P75), M::P75));
        assert!(matches!(M::from(AggFunction::P90), M::P90));
        assert!(matches!(M::from(AggFunction::P95), M::P95));
        assert!(matches!(M::from(AggFunction::P99), M::P99));
    }

    #[test]
    fn test_query_type_from_meta_all_variants() {
        use meta_alerts::QueryType as M;
        assert!(matches!(QueryType::from(M::Custom), QueryType::Custom));
        assert!(matches!(QueryType::from(M::SQL), QueryType::SQL));
        assert!(matches!(QueryType::from(M::PromQL), QueryType::PromQL));
    }

    #[test]
    fn test_query_type_to_meta_all_variants() {
        use meta_alerts::QueryType as M;
        assert!(matches!(M::from(QueryType::Custom), M::Custom));
        assert!(matches!(M::from(QueryType::SQL), M::SQL));
        assert!(matches!(M::from(QueryType::PromQL), M::PromQL));
    }

    #[test]
    fn test_operator_from_meta_all_variants() {
        use meta_alerts::Operator as M;
        assert!(matches!(Operator::from(M::EqualTo), Operator::EqualTo));
        assert!(matches!(
            Operator::from(M::NotEqualTo),
            Operator::NotEqualTo
        ));
        assert!(matches!(
            Operator::from(M::GreaterThan),
            Operator::GreaterThan
        ));
        assert!(matches!(
            Operator::from(M::GreaterThanEquals),
            Operator::GreaterThanEquals
        ));
        assert!(matches!(Operator::from(M::LessThan), Operator::LessThan));
        assert!(matches!(
            Operator::from(M::LessThanEquals),
            Operator::LessThanEquals
        ));
        assert!(matches!(Operator::from(M::Contains), Operator::Contains));
        assert!(matches!(
            Operator::from(M::NotContains),
            Operator::NotContains
        ));
    }

    #[test]
    fn test_operator_to_meta_all_variants() {
        use meta_alerts::Operator as M;
        assert!(matches!(M::from(Operator::EqualTo), M::EqualTo));
        assert!(matches!(M::from(Operator::NotEqualTo), M::NotEqualTo));
        assert!(matches!(M::from(Operator::GreaterThan), M::GreaterThan));
        assert!(matches!(
            M::from(Operator::GreaterThanEquals),
            M::GreaterThanEquals
        ));
        assert!(matches!(M::from(Operator::LessThan), M::LessThan));
        assert!(matches!(
            M::from(Operator::LessThanEquals),
            M::LessThanEquals
        ));
        assert!(matches!(M::from(Operator::Contains), M::Contains));
        assert!(matches!(M::from(Operator::NotContains), M::NotContains));
    }

    #[test]
    fn test_search_event_type_from_meta_all_variants() {
        use meta_search::SearchEventType as M;
        assert!(matches!(SearchEventType::from(M::UI), SearchEventType::UI));
        assert!(matches!(
            SearchEventType::from(M::Dashboards),
            SearchEventType::Dashboards
        ));
        assert!(matches!(
            SearchEventType::from(M::Reports),
            SearchEventType::Reports
        ));
        assert!(matches!(
            SearchEventType::from(M::Alerts),
            SearchEventType::Alerts
        ));
        assert!(matches!(
            SearchEventType::from(M::Values),
            SearchEventType::Values
        ));
        assert!(matches!(
            SearchEventType::from(M::Other),
            SearchEventType::Other
        ));
        assert!(matches!(
            SearchEventType::from(M::RUM),
            SearchEventType::RUM
        ));
        assert!(matches!(
            SearchEventType::from(M::DerivedStream),
            SearchEventType::DerivedStream
        ));
        assert!(matches!(
            SearchEventType::from(M::SearchJob),
            SearchEventType::SearchJob
        ));
        assert!(matches!(
            SearchEventType::from(M::Download),
            SearchEventType::Download
        ));
        assert!(matches!(
            SearchEventType::from(M::Insights),
            SearchEventType::Insights
        ));
    }

    #[test]
    fn test_search_event_type_to_meta_all_variants() {
        use meta_search::SearchEventType as M;
        assert!(matches!(M::from(SearchEventType::UI), M::UI));
        assert!(matches!(
            M::from(SearchEventType::Dashboards),
            M::Dashboards
        ));
        assert!(matches!(M::from(SearchEventType::Reports), M::Reports));
        assert!(matches!(M::from(SearchEventType::Alerts), M::Alerts));
        assert!(matches!(M::from(SearchEventType::Values), M::Values));
        assert!(matches!(M::from(SearchEventType::Other), M::Other));
        assert!(matches!(M::from(SearchEventType::RUM), M::RUM));
        assert!(matches!(
            M::from(SearchEventType::DerivedStream),
            M::DerivedStream
        ));
        assert!(matches!(M::from(SearchEventType::SearchJob), M::SearchJob));
        assert!(matches!(M::from(SearchEventType::Download), M::Download));
        assert!(matches!(M::from(SearchEventType::Insights), M::Insights));
    }

    #[test]
    fn test_stream_type_from_meta_all_variants() {
        use meta_stream::StreamType as M;
        assert!(matches!(StreamType::from(M::Logs), StreamType::Logs));
        assert!(matches!(StreamType::from(M::Metrics), StreamType::Metrics));
        assert!(matches!(StreamType::from(M::Traces), StreamType::Traces));
        assert!(matches!(
            StreamType::from(M::EnrichmentTables),
            StreamType::EnrichmentTables
        ));
        assert!(matches!(
            StreamType::from(M::Filelist),
            StreamType::Filelist
        ));
        assert!(matches!(
            StreamType::from(M::Metadata),
            StreamType::Metadata
        ));
        assert!(matches!(StreamType::from(M::Index), StreamType::Index));
        // ServiceGraph maps to Metadata
        assert!(matches!(
            StreamType::from(M::ServiceGraph),
            StreamType::Metadata
        ));
    }

    #[test]
    fn test_stream_type_to_meta_all_variants() {
        use meta_stream::StreamType as M;
        assert!(matches!(M::from(StreamType::Logs), M::Logs));
        assert!(matches!(M::from(StreamType::Metrics), M::Metrics));
        assert!(matches!(M::from(StreamType::Traces), M::Traces));
        assert!(matches!(
            M::from(StreamType::EnrichmentTables),
            M::EnrichmentTables
        ));
        assert!(matches!(M::from(StreamType::Filelist), M::Filelist));
        assert!(matches!(M::from(StreamType::Metadata), M::Metadata));
        assert!(matches!(M::from(StreamType::Index), M::Index));
    }

    #[test]
    fn test_frequency_type_roundtrip() {
        use meta_alerts::FrequencyType as M;
        assert!(matches!(FrequencyType::from(M::Cron), FrequencyType::Cron));
        assert!(matches!(
            FrequencyType::from(M::Minutes),
            FrequencyType::Minutes
        ));
        assert!(matches!(M::from(FrequencyType::Cron), M::Cron));
        assert!(matches!(M::from(FrequencyType::Minutes), M::Minutes));
    }

    #[test]
    fn test_alert_skip_fields_absent_when_default() {
        let alert: Alert = serde_json::from_value(serde_json::json!({})).unwrap();
        let json = serde_json::to_value(&alert).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("template"));
        assert!(!obj.contains_key("context_attributes"));
        assert!(!obj.contains_key("updated_at"));
        assert!(!obj.contains_key("deduplication"));
    }

    #[test]
    fn test_alert_skip_fields_present_when_some() {
        let mut alert: Alert = serde_json::from_value(serde_json::json!({})).unwrap();
        alert.template = Some("my-template".to_string());
        alert.context_attributes = Some(HashMap::from([("env".to_string(), "prod".to_string())]));
        alert.updated_at = Some(1_700_000_000);
        let json = serde_json::to_value(&alert).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("template"));
        assert!(obj.contains_key("context_attributes"));
        assert!(obj.contains_key("updated_at"));
    }

    #[test]
    fn test_trigger_condition_timezone_none_absent() {
        let tc = TriggerCondition {
            timezone: None,
            ..TriggerCondition::default()
        };
        let json = serde_json::to_value(&tc).unwrap();
        assert!(!json.as_object().unwrap().contains_key("timezone"));
    }

    #[test]
    fn test_trigger_condition_timezone_some_present() {
        let tc = TriggerCondition {
            timezone: Some("America/New_York".to_string()),
            ..TriggerCondition::default()
        };
        let json = serde_json::to_value(&tc).unwrap();
        assert!(json.as_object().unwrap().contains_key("timezone"));
    }

    #[test]
    fn test_compare_historic_data_from_meta() {
        let meta = meta_alerts::CompareHistoricData {
            offset: "1h".to_string(),
        };
        let converted = CompareHistoricData::from(meta);
        assert_eq!(converted.offset, "1h");
    }

    #[test]
    fn test_condition_roundtrip() {
        use meta_alerts::Condition as MetaCondition;
        let meta = MetaCondition {
            column: "level".to_string(),
            operator: meta_alerts::Operator::EqualTo,
            value: serde_json::Value::String("error".to_string()),
            ignore_case: false,
        };
        let local = Condition::from(meta);
        assert_eq!(local.column, "level");
        assert!(matches!(local.operator, Operator::EqualTo));

        let back = meta_alerts::Condition::from(local);
        assert_eq!(back.column, "level");
        assert!(matches!(back.operator, meta_alerts::Operator::EqualTo));
    }

    #[test]
    fn test_trigger_condition_from_meta_converts_frequency_to_minutes() {
        let meta = meta_alerts::TriggerCondition {
            period: 15,
            operator: meta_alerts::Operator::GreaterThan,
            threshold: 5,
            frequency: 300, // 300 seconds → 5 minutes
            cron: "".to_string(),
            frequency_type: meta_alerts::FrequencyType::Minutes,
            silence: 60,
            timezone: Some("UTC".to_string()),
            tolerance_in_secs: Some(10),
            align_time: false,
        };
        let tc = TriggerCondition::from(meta);
        assert_eq!(tc.period_minutes, 15);
        assert!(matches!(tc.operator, Operator::GreaterThan));
        assert_eq!(tc.threshold_count, 5);
        assert_eq!(tc.frequency_minutes, 5); // 300 / 60 = 5
        assert_eq!(tc.silence_minutes, 60);
        assert_eq!(tc.timezone, Some("UTC".to_string()));
        assert_eq!(tc.tolerance_seconds, Some(10));
        assert!(!tc.align_time);
    }

    #[test]
    fn test_trigger_condition_to_meta_converts_frequency_to_seconds() {
        let tc = TriggerCondition {
            period_minutes: 10,
            operator: Operator::LessThan,
            threshold_count: 3,
            frequency_minutes: 5,
            cron: "".to_string(),
            frequency_type: FrequencyType::Minutes,
            silence_minutes: 30,
            timezone: None,
            tolerance_seconds: None,
            align_time: true,
        };
        let meta = meta_alerts::TriggerCondition::from(tc);
        assert_eq!(meta.period, 10);
        assert!(matches!(meta.operator, meta_alerts::Operator::LessThan));
        assert_eq!(meta.threshold, 3);
        assert_eq!(meta.frequency, 300); // 5 * 60 = 300
        assert_eq!(meta.silence, 30);
        assert!(meta.timezone.is_none());
        assert!(meta.tolerance_in_secs.is_none());
        assert!(meta.align_time);
    }

    #[test]
    fn test_aggregation_from_meta() {
        let meta = meta_alerts::Aggregation {
            group_by: Some(vec!["service".to_string(), "region".to_string()]),
            function: meta_alerts::AggFunction::Count,
            having: meta_alerts::Condition {
                column: "count".to_string(),
                operator: meta_alerts::Operator::GreaterThanEquals,
                value: serde_json::json!(100),
                ignore_case: false,
            },
        };
        let agg = Aggregation::from(meta);
        assert_eq!(
            agg.group_by,
            Some(vec!["service".to_string(), "region".to_string()])
        );
        assert!(matches!(agg.function, AggFunction::Count));
        assert_eq!(agg.having.column, "count");
    }

    #[test]
    fn test_aggregation_to_meta() {
        let agg = Aggregation {
            group_by: None,
            function: AggFunction::Avg,
            having: Condition {
                column: "value".to_string(),
                operator: Operator::GreaterThan,
                value: serde_json::json!(42),
                ignore_case: false,
            },
        };
        let meta = meta_alerts::Aggregation::from(agg);
        assert!(meta.group_by.is_none());
        assert!(matches!(meta.function, meta_alerts::AggFunction::Avg));
        assert_eq!(meta.having.column, "value");
    }

    #[test]
    fn test_query_condition_from_meta_sql() {
        let meta = meta_alerts::QueryCondition {
            query_type: meta_alerts::QueryType::SQL,
            conditions: None,
            sql: Some("SELECT count(*) FROM logs".to_string()),
            promql: None,
            promql_condition: None,
            aggregation: None,
            vrl_function: None,
            search_event_type: None,
            multi_time_range: None,
        };
        let qc = QueryCondition::from(meta);
        assert!(matches!(qc.query_type, QueryType::SQL));
        assert_eq!(qc.sql, Some("SELECT count(*) FROM logs".to_string()));
        assert!(qc.conditions.is_none());
        assert!(qc.aggregation.is_none());
    }

    #[test]
    fn test_query_condition_to_meta_sql() {
        let qc = QueryCondition {
            query_type: QueryType::SQL,
            conditions: None,
            sql: Some("SELECT count(*) FROM logs".to_string()),
            promql: None,
            promql_condition: None,
            aggregation: None,
            vrl_function: Some("fn".to_string()),
            search_event_type: None,
            multi_time_range: None,
        };
        let meta = meta_alerts::QueryCondition::from(qc);
        assert!(matches!(meta.query_type, meta_alerts::QueryType::SQL));
        assert_eq!(meta.sql, Some("SELECT count(*) FROM logs".to_string()));
        assert_eq!(meta.vrl_function, Some("fn".to_string()));
        assert!(meta.conditions.is_none());
    }

    #[test]
    fn test_alert_from_meta_without_trigger_maps_fields() {
        let mut meta_alert = meta_alerts::alert::Alert::default();
        meta_alert.name = "test-alert".to_string();
        meta_alert.org_id = "org1".to_string();
        meta_alert.stream_name = "default".to_string();
        meta_alert.enabled = true;
        meta_alert.creates_incident = true;

        let alert = Alert::from((meta_alert, None));
        assert_eq!(alert.name, "test-alert");
        assert_eq!(alert.org_id, "org1");
        assert_eq!(alert.stream_name, "default");
        assert!(alert.enabled);
        assert!(alert.creates_incident);
        assert!(alert.last_triggered_at.is_none());
        assert!(alert.last_satisfied_at.is_none());
    }

    #[test]
    fn test_alert_from_meta_with_trigger_no_timestamps() {
        let mut meta_alert = meta_alerts::alert::Alert::default();
        meta_alert.name = "triggered-alert".to_string();
        let trigger = config::meta::triggers::Trigger::default();

        let alert = Alert::from((meta_alert, Some(trigger)));
        assert_eq!(alert.name, "triggered-alert");
        // default trigger has no start/end time — timestamps remain None
        assert!(alert.last_triggered_at.is_none());
        assert!(alert.last_satisfied_at.is_none());
    }

    #[test]
    fn test_alert_to_meta_maps_basic_fields() {
        let json = serde_json::json!({
            "name": "my-alert",
            "org_id": "myorg",
            "stream_name": "stream1",
            "enabled": true,
            "creates_incident": true
        });
        let alert: Alert = serde_json::from_value(json).unwrap();
        let meta = meta_alerts::alert::Alert::from(alert);
        assert_eq!(meta.name, "my-alert");
        assert_eq!(meta.org_id, "myorg");
        assert_eq!(meta.stream_name, "stream1");
        assert!(meta.enabled);
        assert!(meta.creates_incident);
    }

    #[test]
    fn test_alert_to_meta_default_fields() {
        let alert: Alert = serde_json::from_value(serde_json::json!({})).unwrap();
        let meta = meta_alerts::alert::Alert::from(alert);
        assert_eq!(meta.name, "");
        assert_eq!(meta.org_id, "");
        assert!(!meta.enabled);
        assert!(!meta.creates_incident);
        assert!(meta.id.is_none());
        assert!(meta.owner.is_none());
    }
}
