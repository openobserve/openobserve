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

use serde::{Deserialize, Serialize};

use crate::{
    SIZE_IN_MB, get_config,
    meta::{
        dashboards::usage_report::DashboardInfo,
        search::{SearchEventContext, SearchEventType},
        stream::{FileMeta, StreamType},
    },
};

pub const USAGE_STREAM: &str = "usage";
pub const STATS_STREAM: &str = "stats";
pub const TRIGGERS_STREAM: &str = "triggers";
pub const ERROR_STREAM: &str = "errors";
pub const DATA_RETENTION_USAGE_STREAM: &str = "data_retention_usage";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum TriggerDataStatus {
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "condition_not_satisfied")]
    ConditionNotSatisfied,
    #[serde(rename = "skipped")]
    Skipped,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum TriggerDataType {
    #[serde(rename = "report")]
    Report,
    #[serde(rename = "cached_report")]
    CachedReport,
    #[serde(rename = "alert")]
    Alert,
    #[serde(rename = "derived_stream")]
    DerivedStream,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct TriggerData {
    pub _timestamp: i64,
    pub org: String,
    pub module: TriggerDataType,
    pub key: String,
    pub next_run_at: i64,
    pub is_realtime: bool,
    pub is_silenced: bool,
    pub status: TriggerDataStatus,
    pub start_time: i64,
    pub end_time: i64,
    pub retries: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped_alerts_count: Option<i64>,
    pub error: Option<String>,
    pub success_response: Option<String>,
    pub is_partial: Option<bool>,
    pub delay_in_secs: Option<i64>,
    pub evaluation_took_in_secs: Option<f64>,
    pub source_node: Option<String>,
    pub query_took: Option<i64>,
    pub scheduler_trace_id: Option<String>,
    pub time_in_queue_ms: Option<i64>,
    // Deduplication tracking fields
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dedup_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dedup_suppressed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dedup_count: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grouped: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_size: Option<i32>,
}

impl Default for TriggerData {
    fn default() -> Self {
        Self {
            _timestamp: 0,
            org: String::new(),
            module: TriggerDataType::Alert,
            key: String::new(),
            next_run_at: 0,
            is_realtime: false,
            is_silenced: false,
            status: TriggerDataStatus::Completed,
            start_time: 0,
            end_time: 0,
            retries: 0,
            skipped_alerts_count: None,
            error: None,
            success_response: None,
            is_partial: None,
            delay_in_secs: None,
            evaluation_took_in_secs: None,
            source_node: None,
            query_took: None,
            scheduler_trace_id: None,
            time_in_queue_ms: None,
            dedup_enabled: None,
            dedup_suppressed: None,
            dedup_count: None,
            grouped: None,
            group_size: None,
        }
    }
}

impl TriggerData {
    /// Creates a sample TriggerData instance with all fields populated.
    ///
    /// This is used for:
    /// - Schema inference via reflection (ensures all Optional fields are present)
    /// - Field name extraction for testing/validation
    ///
    /// All Optional fields are set to Some() with default values to ensure they appear
    /// in serialization (avoiding `#[serde(skip_serializing_if = "Option::is_none")]`).
    pub fn init_for_reflection() -> Self {
        Self {
            _timestamp: 0,
            org: String::new(),
            module: TriggerDataType::Alert,
            key: String::new(),
            next_run_at: 0,
            is_realtime: false,
            is_silenced: false,
            status: TriggerDataStatus::Completed,
            start_time: 0,
            end_time: 0,
            retries: 0,
            // Populate all Optional fields to ensure they're in the schema
            skipped_alerts_count: Some(0),
            error: Some(String::new()),
            success_response: Some(String::new()),
            is_partial: Some(false),
            delay_in_secs: Some(0),
            evaluation_took_in_secs: Some(0.0),
            source_node: Some(String::new()),
            query_took: Some(0),
            scheduler_trace_id: Some(String::new()),
            time_in_queue_ms: Some(0),
            dedup_enabled: Some(false),
            dedup_suppressed: Some(false),
            dedup_count: Some(0),
            grouped: Some(false),
            group_size: Some(0),
        }
    }

    /// Returns all field names for TriggerData struct by introspecting a sample instance.
    ///
    /// This is primarily used for testing/validation. For schema creation, use
    /// `sample_for_reflection()` directly with schema inference.
    ///
    /// Field names respect serde rename attributes (e.g., `#[serde(rename_all = "snake_case")]`).
    pub fn get_field_names() -> Vec<String> {
        let sample = Self::init_for_reflection();

        // Serialize to JSON and extract keys
        let json_value = serde_json::to_value(&sample).unwrap();
        if let serde_json::Value::Object(map) = json_value {
            map.keys().cloned().collect()
        } else {
            vec![]
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UsageData {
    pub _timestamp: i64,
    pub event: UsageEvent,
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub event_time_hour: String,
    pub org_id: String,
    pub request_body: String,
    pub size: f64,
    pub unit: String,
    pub user_email: String,
    pub response_time: f64,
    pub stream_type: StreamType,
    pub num_records: i64,
    #[serde(default)]
    pub dropped_records: i64,
    pub stream_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_ratio: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scan_files: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compressed_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_ts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_ts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_type: Option<SearchEventType>,
    #[serde(default, flatten)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_event_context: Option<SearchEventContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub took_wait_in_queue: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_cache_ratio: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function: Option<String>,
    #[serde(default)]
    pub is_partial: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub dashboard_info: Option<DashboardInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak_memory_usage: Option<f64>,
}

#[derive(Hash, PartialEq, Eq)]
pub struct GroupKey {
    pub stream_name: String,
    pub org_id: String,
    pub stream_type: StreamType,
    pub day: u32,
    pub hour: u32,
    pub event: UsageEvent,
    pub email: String,
    pub node: String,
}

pub struct AggregatedData {
    pub usage_data: UsageData,
    pub count: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DataRetentionUsageData {
    pub _timestamp: i64,
    pub org_id: String,
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub event_time_hour: String,
    pub mb_hours: f64,
    pub storage_size_mb: f64,
    pub unit: String,
}

#[derive(Hash, Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum UsageEvent {
    Ingestion,
    Search,
    Functions,
    Pipeline,
    RemotePipeline,
    Other,
}

impl std::fmt::Display for UsageEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            UsageEvent::Ingestion => write!(f, "Ingestion"),
            UsageEvent::Search => write!(f, "Search"),
            UsageEvent::Functions => write!(f, "Functions"),
            UsageEvent::Pipeline => write!(f, "Pipeline"),
            UsageEvent::RemotePipeline => write!(f, "RemotePipeline"),
            UsageEvent::Other => write!(f, "Other"),
        }
    }
}

impl From<UsageType> for UsageEvent {
    fn from(usage: UsageType) -> UsageEvent {
        if usage.is_ingestion() {
            UsageEvent::Ingestion
        } else if usage.is_search() {
            UsageEvent::Search
        } else if usage.is_function() {
            UsageEvent::Functions
        } else if usage.is_pipeline() {
            UsageEvent::Pipeline
        } else if usage.is_remote_pipeline() {
            UsageEvent::RemotePipeline
        } else {
            UsageEvent::Other
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum UsageType {
    #[serde(rename = "/logs/_bulk")]
    Bulk,
    #[serde(rename = "/logs/_json")]
    Json,
    #[serde(rename = "/logs/_multi")]
    Multi,
    #[serde(rename = "/logs/_hec")]
    Hec,
    #[serde(rename = "/logs/_loki")]
    Loki,
    #[serde(rename = "/_kinesis_firehose")]
    KinesisFirehose,
    #[serde(rename = "/gcp/_sub")]
    GCPSubscription,
    #[serde(rename = "/otlp/v1/logs")]
    Logs,
    #[serde(rename = "/otlp/v1/traces")]
    Traces,
    #[serde(rename = "/otlp/v1/metrics")]
    Metrics,
    #[serde(rename = "/prometheus/v1/write")]
    PrometheusRemoteWrite,
    #[serde(rename = "/metrics/_json")]
    JsonMetrics,
    #[serde(rename = "/v1/rum")]
    RUM,
    #[serde(rename = "/_search")]
    Search,
    #[serde(rename = "/metrics/_search")]
    MetricSearch,
    #[serde(rename = "/_around")]
    SearchAround,
    #[serde(rename = "/_values")]
    SearchTopNValues,
    #[serde(rename = "/_search_history")]
    SearchHistory,
    #[serde(rename = "functions")]
    Functions,
    #[serde(rename = "pipeline")]
    Pipeline,
    #[serde(rename = "remote_pipeline")]
    RemotePipeline,
    #[serde(rename = "data_retention")]
    Retention,
    #[serde(rename = "syslog")]
    Syslog,
    #[serde(rename = "enrichment_table")]
    EnrichmentTable,
}

impl UsageType {
    pub fn is_search(&self) -> bool {
        matches!(
            self,
            UsageType::Search
                | UsageType::SearchAround
                | UsageType::SearchTopNValues
                | UsageType::SearchHistory
                | UsageType::MetricSearch
        )
    }

    pub fn is_ingestion(&self) -> bool {
        matches!(
            self,
            UsageType::Bulk
                | UsageType::Json
                | UsageType::Multi
                | UsageType::Hec
                | UsageType::Loki
                | UsageType::KinesisFirehose
                | UsageType::GCPSubscription
                | UsageType::Logs
                | UsageType::Traces
                | UsageType::Metrics
                | UsageType::PrometheusRemoteWrite
                | UsageType::JsonMetrics
                | UsageType::RUM
                | UsageType::EnrichmentTable
                | UsageType::Syslog
        )
    }

    pub fn is_function(&self) -> bool {
        matches!(self, UsageType::Functions)
    }

    pub fn is_pipeline(&self) -> bool {
        matches!(self, UsageType::Pipeline)
    }

    pub fn is_remote_pipeline(&self) -> bool {
        matches!(self, UsageType::RemotePipeline)
    }
}

impl std::fmt::Display for UsageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UsageType::Bulk => write!(f, "/logs/_bulk"),
            UsageType::Json => write!(f, "/logs/_json"),
            UsageType::Multi => write!(f, "/logs/_multi"),
            UsageType::Hec => write!(f, "/logs/_hec"),
            UsageType::Loki => write!(f, "/logs/_loki"),
            UsageType::KinesisFirehose => write!(f, "/_kinesis_firehose"),
            UsageType::GCPSubscription => write!(f, "/gcp/_sub"),
            UsageType::Logs => write!(f, "/otlp/v1/logs"),
            UsageType::Traces => write!(f, "/otlp/v1/traces"),
            UsageType::Metrics => write!(f, "/otlp/v1/metrics"),
            UsageType::PrometheusRemoteWrite => write!(f, "/prometheus/v1/write"),
            UsageType::JsonMetrics => write!(f, "/metrics/_json"),
            UsageType::RUM => write!(f, "/v1/rum"),
            UsageType::Search => write!(f, "/_search"),
            UsageType::MetricSearch => write!(f, "/metrics/_search"),
            UsageType::SearchAround => write!(f, "/_around"),
            UsageType::SearchTopNValues => write!(f, "/_values"),
            UsageType::SearchHistory => write!(f, "/_search_history"),
            UsageType::Functions => write!(f, "functions"),
            UsageType::Pipeline => write!(f, "pipeline"),
            UsageType::RemotePipeline => write!(f, "remote_pipeline"),
            UsageType::Retention => write!(f, "data_retention"),
            UsageType::Syslog => write!(f, "syslog"),
            UsageType::EnrichmentTable => write!(f, "enrichment_table"),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RequestStats {
    pub size: f64,
    pub records: i64,
    #[serde(default)]
    pub dropped_records: i64,
    pub response_time: f64,
    #[serde(default)]
    pub request_body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cached_ratio: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scan_files: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compressed_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_ts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_ts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_type: Option<SearchEventType>,
    #[serde(default, flatten)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_event_context: Option<SearchEventContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub took_wait_in_queue: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_cache_ratio: Option<usize>,
    #[serde(default)]
    pub is_partial: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub dashboard_info: Option<DashboardInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak_memory_usage: Option<f64>,
}
impl Default for RequestStats {
    fn default() -> Self {
        Self {
            size: 0.0,
            records: 0,
            dropped_records: 0,
            response_time: 0.0,
            request_body: None,
            function: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
            user_email: None,
            search_type: None,
            search_event_context: None,
            trace_id: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            is_partial: false,
            work_group: None,
            node_name: Some(get_config().common.instance_name.clone()),
            dashboard_info: None,
            peak_memory_usage: None,
        }
    }
}

impl From<FileMeta> for RequestStats {
    fn from(meta: FileMeta) -> RequestStats {
        RequestStats {
            size: meta.original_size as f64 / SIZE_IN_MB,
            records: meta.records,
            dropped_records: 0,
            response_time: 0.0,
            function: None,
            request_body: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: Some(meta.compressed_size as f64 / SIZE_IN_MB),
            min_ts: Some(meta.min_ts),
            max_ts: Some(meta.max_ts),
            user_email: None,
            search_type: None,
            search_event_context: None,
            trace_id: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            is_partial: false,
            work_group: None,
            node_name: None,
            dashboard_info: None,
            peak_memory_usage: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::{
        dashboards::usage_report::DashboardInfo,
        search::{SearchEventContext, SearchEventType},
        stream::{FileMeta, StreamType},
    };

    #[test]
    fn test_usage_event_display() {
        assert_eq!(format!("{}", UsageEvent::Ingestion), "Ingestion");
        assert_eq!(format!("{}", UsageEvent::Search), "Search");
        assert_eq!(format!("{}", UsageEvent::Functions), "Functions");
        assert_eq!(format!("{}", UsageEvent::Other), "Other");
    }

    #[test]
    fn test_usage_event_from_usage_type() {
        assert_eq!(UsageEvent::from(UsageType::Bulk), UsageEvent::Ingestion);
        assert_eq!(UsageEvent::from(UsageType::Json), UsageEvent::Ingestion);
        assert_eq!(UsageEvent::from(UsageType::Logs), UsageEvent::Ingestion);
        assert_eq!(UsageEvent::from(UsageType::Traces), UsageEvent::Ingestion);
        assert_eq!(UsageEvent::from(UsageType::Metrics), UsageEvent::Ingestion);
        assert_eq!(UsageEvent::from(UsageType::Search), UsageEvent::Search);
        assert_eq!(
            UsageEvent::from(UsageType::MetricSearch),
            UsageEvent::Search
        );
        assert_eq!(
            UsageEvent::from(UsageType::SearchAround),
            UsageEvent::Search
        );
        assert_eq!(
            UsageEvent::from(UsageType::Functions),
            UsageEvent::Functions
        );
        assert_eq!(UsageEvent::from(UsageType::Retention), UsageEvent::Other);
    }

    #[test]
    fn test_usage_type_display() {
        assert_eq!(format!("{}", UsageType::Bulk), "/logs/_bulk");
        assert_eq!(format!("{}", UsageType::Json), "/logs/_json");
        assert_eq!(format!("{}", UsageType::Multi), "/logs/_multi");
        assert_eq!(format!("{}", UsageType::Hec), "/logs/_hec");
        assert_eq!(format!("{}", UsageType::Loki), "/logs/_loki");
        assert_eq!(
            format!("{}", UsageType::KinesisFirehose),
            "/_kinesis_firehose"
        );
        assert_eq!(format!("{}", UsageType::GCPSubscription), "/gcp/_sub");
        assert_eq!(format!("{}", UsageType::Logs), "/otlp/v1/logs");
        assert_eq!(format!("{}", UsageType::Traces), "/otlp/v1/traces");
        assert_eq!(format!("{}", UsageType::Metrics), "/otlp/v1/metrics");
        assert_eq!(
            format!("{}", UsageType::PrometheusRemoteWrite),
            "/prometheus/v1/write"
        );
        assert_eq!(format!("{}", UsageType::JsonMetrics), "/metrics/_json");
        assert_eq!(format!("{}", UsageType::RUM), "/v1/rum");
        assert_eq!(format!("{}", UsageType::Search), "/_search");
        assert_eq!(format!("{}", UsageType::MetricSearch), "/metrics/_search");
        assert_eq!(format!("{}", UsageType::SearchAround), "/_around");
        assert_eq!(format!("{}", UsageType::SearchTopNValues), "/_values");
        assert_eq!(format!("{}", UsageType::SearchHistory), "/_search_history");
        assert_eq!(format!("{}", UsageType::Functions), "functions");
        assert_eq!(format!("{}", UsageType::Retention), "data_retention");
        assert_eq!(format!("{}", UsageType::Syslog), "syslog");
        assert_eq!(
            format!("{}", UsageType::EnrichmentTable),
            "enrichment_table"
        );
    }

    #[test]
    fn test_usage_type_is_search() {
        assert!(UsageType::Search.is_search());
        assert!(UsageType::MetricSearch.is_search());
        assert!(UsageType::SearchAround.is_search());
        assert!(UsageType::SearchTopNValues.is_search());
        assert!(UsageType::SearchHistory.is_search());

        assert!(!UsageType::Bulk.is_search());
        assert!(!UsageType::Json.is_search());
        assert!(!UsageType::Functions.is_search());
        assert!(!UsageType::Retention.is_search());
    }

    #[test]
    fn test_usage_type_is_ingestion() {
        assert!(UsageType::Bulk.is_ingestion());
        assert!(UsageType::Json.is_ingestion());
        assert!(UsageType::Multi.is_ingestion());
        assert!(UsageType::Hec.is_ingestion());
        assert!(UsageType::Loki.is_ingestion());
        assert!(UsageType::KinesisFirehose.is_ingestion());
        assert!(UsageType::GCPSubscription.is_ingestion());
        assert!(UsageType::Logs.is_ingestion());
        assert!(UsageType::Traces.is_ingestion());
        assert!(UsageType::Metrics.is_ingestion());
        assert!(UsageType::PrometheusRemoteWrite.is_ingestion());
        assert!(UsageType::JsonMetrics.is_ingestion());
        assert!(UsageType::RUM.is_ingestion());
        assert!(UsageType::EnrichmentTable.is_ingestion());
        assert!(UsageType::Syslog.is_ingestion());

        assert!(!UsageType::Search.is_ingestion());
        assert!(!UsageType::MetricSearch.is_ingestion());
        assert!(!UsageType::Functions.is_ingestion());
        assert!(!UsageType::Retention.is_ingestion());
    }

    #[test]
    fn test_usage_type_is_function() {
        assert!(UsageType::Functions.is_function());

        assert!(!UsageType::Bulk.is_function());
        assert!(!UsageType::Search.is_function());
        assert!(!UsageType::Retention.is_function());
    }

    #[test]
    fn test_trigger_data_status_serialization() {
        assert_eq!(
            serde_json::to_string(&TriggerDataStatus::Completed).unwrap(),
            "\"completed\""
        );
        assert_eq!(
            serde_json::to_string(&TriggerDataStatus::Failed).unwrap(),
            "\"failed\""
        );
        assert_eq!(
            serde_json::to_string(&TriggerDataStatus::ConditionNotSatisfied).unwrap(),
            "\"condition_not_satisfied\""
        );
        assert_eq!(
            serde_json::to_string(&TriggerDataStatus::Skipped).unwrap(),
            "\"skipped\""
        );
    }

    #[test]
    fn test_trigger_data_status_deserialization() {
        assert_eq!(
            serde_json::from_str::<TriggerDataStatus>("\"completed\"").unwrap(),
            TriggerDataStatus::Completed
        );
        assert_eq!(
            serde_json::from_str::<TriggerDataStatus>("\"failed\"").unwrap(),
            TriggerDataStatus::Failed
        );
        assert_eq!(
            serde_json::from_str::<TriggerDataStatus>("\"condition_not_satisfied\"").unwrap(),
            TriggerDataStatus::ConditionNotSatisfied
        );
        assert_eq!(
            serde_json::from_str::<TriggerDataStatus>("\"skipped\"").unwrap(),
            TriggerDataStatus::Skipped
        );
    }

    #[test]
    fn test_trigger_data_type_serialization() {
        assert_eq!(
            serde_json::to_string(&TriggerDataType::Report).unwrap(),
            "\"report\""
        );
        assert_eq!(
            serde_json::to_string(&TriggerDataType::CachedReport).unwrap(),
            "\"cached_report\""
        );
        assert_eq!(
            serde_json::to_string(&TriggerDataType::Alert).unwrap(),
            "\"alert\""
        );
        assert_eq!(
            serde_json::to_string(&TriggerDataType::DerivedStream).unwrap(),
            "\"derived_stream\""
        );
    }

    #[test]
    fn test_trigger_data_type_deserialization() {
        assert_eq!(
            serde_json::from_str::<TriggerDataType>("\"report\"").unwrap(),
            TriggerDataType::Report
        );
        assert_eq!(
            serde_json::from_str::<TriggerDataType>("\"cached_report\"").unwrap(),
            TriggerDataType::CachedReport
        );
        assert_eq!(
            serde_json::from_str::<TriggerDataType>("\"alert\"").unwrap(),
            TriggerDataType::Alert
        );
        assert_eq!(
            serde_json::from_str::<TriggerDataType>("\"derived_stream\"").unwrap(),
            TriggerDataType::DerivedStream
        );
    }

    #[test]
    fn test_trigger_data_serialization() {
        let trigger_data = TriggerData {
            _timestamp: 1234567890,
            org: "test_org".to_string(),
            module: TriggerDataType::Alert,
            key: "test_key".to_string(),
            next_run_at: 1234567890,
            is_realtime: true,
            is_silenced: false,
            status: TriggerDataStatus::Completed,
            start_time: 1234567890,
            end_time: 1234567890,
            retries: 0,
            skipped_alerts_count: Some(5),
            error: Some("test error".to_string()),
            success_response: Some("success".to_string()),
            is_partial: Some(true),
            delay_in_secs: Some(10),
            evaluation_took_in_secs: Some(1.5),
            source_node: Some("node1".to_string()),
            query_took: Some(500),
            scheduler_trace_id: Some("trace123".to_string()),
            time_in_queue_ms: Some(100),
            dedup_enabled: None,
            dedup_suppressed: None,
            dedup_count: None,
            grouped: None,
            group_size: None,
        };

        let json = serde_json::to_string(&trigger_data).unwrap();
        let deserialized: TriggerData = serde_json::from_str(&json).unwrap();

        assert_eq!(trigger_data, deserialized);
    }

    #[test]
    fn test_usage_data_serialization() {
        let usage_data = UsageData {
            _timestamp: 1234567890,
            event: UsageEvent::Search,
            year: 2024,
            month: 1,
            day: 1,
            hour: 12,
            event_time_hour: "2024-01-01T12:00:00Z".to_string(),
            org_id: "test_org".to_string(),
            request_body: "test_request".to_string(),
            size: 1.5,
            unit: "MB".to_string(),
            user_email: "test@example.com".to_string(),
            response_time: 0.5,
            stream_type: StreamType::Logs,
            num_records: 100,
            dropped_records: 5,
            stream_name: "test_stream".to_string(),
            trace_id: Some("trace123".to_string()),
            cached_ratio: Some(80),
            scan_files: Some(10),
            compressed_size: Some(0.5),
            min_ts: Some(1234567000),
            max_ts: Some(1234567999),
            search_type: Some(SearchEventType::UI),
            search_event_context: Some(SearchEventContext::default()),
            took_wait_in_queue: Some(50),
            result_cache_ratio: Some(75),
            function: Some("test_function".to_string()),
            is_partial: true,
            work_group: Some("test_group".to_string()),
            node_name: Some("node1".to_string()),
            dashboard_info: Some(DashboardInfo {
                run_id: "test_run_id".to_string(),
                panel_id: "test_panel_id".to_string(),
                panel_name: "test_panel_name".to_string(),
                tab_id: "test_tab_id".to_string(),
                tab_name: "test_tab_name".to_string(),
            }),
            peak_memory_usage: Some(1024000.0),
        };

        let json = serde_json::to_string(&usage_data).unwrap();
        let deserialized: UsageData = serde_json::from_str(&json).unwrap();

        assert_eq!(usage_data, deserialized);
    }

    #[test]
    fn test_usage_data_optional_fields_none() {
        let usage_data = UsageData {
            _timestamp: 1234567890,
            event: UsageEvent::Ingestion,
            year: 2024,
            month: 1,
            day: 1,
            hour: 12,
            event_time_hour: "2024-01-01T12:00:00Z".to_string(),
            org_id: "test_org".to_string(),
            request_body: "test_request".to_string(),
            size: 1.5,
            unit: "MB".to_string(),
            user_email: "test@example.com".to_string(),
            response_time: 0.5,
            stream_type: StreamType::Logs,
            num_records: 100,
            dropped_records: 0,
            stream_name: "test_stream".to_string(),
            trace_id: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
            search_type: None,
            search_event_context: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            function: None,
            is_partial: false,
            work_group: None,
            node_name: None,
            dashboard_info: None,
            peak_memory_usage: None,
        };

        let json = serde_json::to_string(&usage_data).unwrap();

        // Verify optional fields are not included when None
        assert!(!json.contains("trace_id"));
        assert!(!json.contains("cached_ratio"));
        assert!(!json.contains("scan_files"));
        assert!(!json.contains("compressed_size"));
        assert!(!json.contains("function"));
        assert!(!json.contains("work_group"));
        assert!(!json.contains("node_name"));
        assert!(!json.contains("dashboard_info"));
        assert!(!json.contains("peak_memory_usage"));
    }

    #[test]
    fn test_request_stats_default() {
        let stats = RequestStats::default();

        assert_eq!(stats.size, 0.0);
        assert_eq!(stats.records, 0);
        assert_eq!(stats.dropped_records, 0);
        assert_eq!(stats.response_time, 0.0);
        assert!(stats.request_body.is_none());
        assert!(stats.function.is_none());
        assert!(stats.cached_ratio.is_none());
        assert!(stats.scan_files.is_none());
        assert!(stats.compressed_size.is_none());
        assert!(stats.min_ts.is_none());
        assert!(stats.max_ts.is_none());
        assert!(stats.user_email.is_none());
        assert!(stats.search_type.is_none());
        assert!(stats.search_event_context.is_none());
        assert!(stats.trace_id.is_none());
        assert!(stats.took_wait_in_queue.is_none());
        assert!(stats.result_cache_ratio.is_none());
        assert!(!stats.is_partial);
        assert!(stats.work_group.is_none());
        assert!(stats.node_name.is_some());
        assert!(stats.dashboard_info.is_none());
    }

    #[test]
    fn test_request_stats_from_file_meta() {
        let file_meta = FileMeta {
            min_ts: 1234567000,
            max_ts: 1234567999,
            records: 500,
            original_size: 1024 * 1024 * 2, // 2MB
            compressed_size: 1024 * 1024,   // 1MB
            flattened: false,
            index_size: 0,
        };

        let stats = RequestStats::from(file_meta);

        assert_eq!(stats.size, 2.0); // 2MB / SIZE_IN_MB
        assert_eq!(stats.records, 500);
        assert_eq!(stats.dropped_records, 0);
        assert_eq!(stats.response_time, 0.0);
        assert!(stats.request_body.is_none());
        assert!(stats.function.is_none());
        assert!(stats.cached_ratio.is_none());
        assert!(stats.scan_files.is_none());
        assert_eq!(stats.compressed_size, Some(1.0)); // 1MB / SIZE_IN_MB
        assert_eq!(stats.min_ts, Some(1234567000));
        assert_eq!(stats.max_ts, Some(1234567999));
        assert!(stats.user_email.is_none());
        assert!(stats.search_type.is_none());
        assert!(stats.search_event_context.is_none());
        assert!(stats.trace_id.is_none());
        assert!(stats.took_wait_in_queue.is_none());
        assert!(stats.result_cache_ratio.is_none());
        assert!(!stats.is_partial);
        assert!(stats.work_group.is_none());
        assert!(stats.node_name.is_none());
        assert!(stats.dashboard_info.is_none());
    }

    #[test]
    fn test_request_stats_serialization() {
        let stats = RequestStats {
            size: 1.5,
            records: 100,
            dropped_records: 5,
            response_time: 0.5,
            request_body: Some("test body".to_string()),
            function: Some("test_func".to_string()),
            cached_ratio: Some(80),
            scan_files: Some(10),
            compressed_size: Some(0.75),
            min_ts: Some(1234567000),
            max_ts: Some(1234567999),
            user_email: Some("test@example.com".to_string()),
            search_type: Some(SearchEventType::UI),
            search_event_context: Some(SearchEventContext::default()),
            trace_id: Some("trace123".to_string()),
            took_wait_in_queue: Some(50),
            result_cache_ratio: Some(75),
            is_partial: true,
            work_group: Some("test_group".to_string()),
            node_name: Some("node1".to_string()),
            dashboard_info: Some(DashboardInfo {
                run_id: "test_run_id".to_string(),
                panel_id: "test_panel_id".to_string(),
                panel_name: "test_panel_name".to_string(),
                tab_id: "test_tab_id".to_string(),
                tab_name: "test_tab_name".to_string(),
            }),
            peak_memory_usage: Some(1024000.0),
        };

        let json = serde_json::to_string(&stats).unwrap();
        let deserialized: RequestStats = serde_json::from_str(&json).unwrap();

        assert_eq!(stats.size, deserialized.size);
        assert_eq!(stats.records, deserialized.records);
        assert_eq!(stats.dropped_records, deserialized.dropped_records);
        assert_eq!(stats.response_time, deserialized.response_time);
        assert_eq!(stats.request_body, deserialized.request_body);
        assert_eq!(stats.function, deserialized.function);
        assert_eq!(stats.is_partial, deserialized.is_partial);
    }

    #[test]
    fn test_stats_default() {
        let stats = Stats::default();

        assert_eq!(stats.records, 0);
        assert_eq!(stats.stream_type, StreamType::Logs);
        assert!(stats.org_id.is_empty());
        assert!(stats.stream_name.is_empty());
        assert_eq!(stats.original_size, 0.0);
        assert_eq!(stats._timestamp, 0);
        assert_eq!(stats.min_ts, 0);
        assert_eq!(stats.max_ts, 0);
        assert!(stats.compressed_size.is_none());
        assert!(stats.index_size.is_none());
    }

    #[test]
    fn test_stats_serialization() {
        let stats = Stats {
            records: 1000,
            stream_type: StreamType::Metrics,
            org_id: "test_org".to_string(),
            stream_name: "test_stream".to_string(),
            original_size: 2.5,
            _timestamp: 1234567890,
            min_ts: 1234567000,
            max_ts: 1234567999,
            compressed_size: Some(1.25),
            index_size: Some(0.75),
        };

        let json = serde_json::to_string(&stats).unwrap();
        let deserialized: Stats = serde_json::from_str(&json).unwrap();

        assert_eq!(stats, deserialized);
    }

    #[test]
    fn test_group_key_equality() {
        let key1 = GroupKey {
            stream_name: "stream1".to_string(),
            org_id: "org1".to_string(),
            stream_type: StreamType::Logs,
            day: 1,
            hour: 12,
            event: UsageEvent::Search,
            email: "test@example.com".to_string(),
            node: "node1".to_string(),
        };

        let key2 = GroupKey {
            stream_name: "stream1".to_string(),
            org_id: "org1".to_string(),
            stream_type: StreamType::Logs,
            day: 1,
            hour: 12,
            event: UsageEvent::Search,
            email: "test@example.com".to_string(),
            node: "node1".to_string(),
        };

        let key3 = GroupKey {
            stream_name: "stream2".to_string(),
            org_id: "org1".to_string(),
            stream_type: StreamType::Logs,
            day: 1,
            hour: 12,
            event: UsageEvent::Search,
            email: "test@example.com".to_string(),
            node: "node1".to_string(),
        };

        assert!(key1 == key2);
        assert!(key1 != key3);
    }

    #[test]
    fn test_group_key_hash() {
        use std::collections::HashMap;

        let mut map = HashMap::new();

        let key = GroupKey {
            stream_name: "stream1".to_string(),
            org_id: "org1".to_string(),
            stream_type: StreamType::Logs,
            day: 1,
            hour: 12,
            event: UsageEvent::Search,
            email: "test@example.com".to_string(),
            node: "node1".to_string(),
        };

        map.insert(key, "test_value");
        assert_eq!(map.len(), 1);

        let same_key = GroupKey {
            stream_name: "stream1".to_string(),
            org_id: "org1".to_string(),
            stream_type: StreamType::Logs,
            day: 1,
            hour: 12,
            event: UsageEvent::Search,
            email: "test@example.com".to_string(),
            node: "node1".to_string(),
        };

        assert!(map.contains_key(&same_key));
    }

    #[test]
    fn test_aggregated_data() {
        let usage_data = UsageData {
            _timestamp: 1234567890,
            event: UsageEvent::Ingestion,
            year: 2024,
            month: 1,
            day: 1,
            hour: 12,
            event_time_hour: "2024-01-01T12:00:00Z".to_string(),
            org_id: "test_org".to_string(),
            request_body: "test_request".to_string(),
            size: 1.5,
            unit: "MB".to_string(),
            user_email: "test@example.com".to_string(),
            response_time: 0.5,
            stream_type: StreamType::Logs,
            num_records: 100,
            dropped_records: 0,
            stream_name: "test_stream".to_string(),
            trace_id: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
            search_type: None,
            search_event_context: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            function: None,
            is_partial: false,
            work_group: None,
            node_name: None,
            dashboard_info: None,
            peak_memory_usage: None,
        };

        let aggregated = AggregatedData {
            usage_data,
            count: 5,
        };

        assert_eq!(aggregated.count, 5);
        assert_eq!(aggregated.usage_data.event, UsageEvent::Ingestion);
        assert_eq!(aggregated.usage_data.org_id, "test_org");
    }

    #[test]
    fn test_usage_type_serde_all_variants() {
        let variants = vec![
            UsageType::Bulk,
            UsageType::Json,
            UsageType::Multi,
            UsageType::Hec,
            UsageType::Loki,
            UsageType::KinesisFirehose,
            UsageType::GCPSubscription,
            UsageType::Logs,
            UsageType::Traces,
            UsageType::Metrics,
            UsageType::PrometheusRemoteWrite,
            UsageType::JsonMetrics,
            UsageType::RUM,
            UsageType::Search,
            UsageType::MetricSearch,
            UsageType::SearchAround,
            UsageType::SearchTopNValues,
            UsageType::SearchHistory,
            UsageType::Functions,
            UsageType::Retention,
            UsageType::Syslog,
            UsageType::EnrichmentTable,
        ];

        for variant in variants {
            let json = serde_json::to_string(&variant).unwrap();
            let deserialized: UsageType = serde_json::from_str(&json).unwrap();
            assert_eq!(variant, deserialized);
        }
    }

    #[test]
    fn test_usage_event_serde_all_variants() {
        let variants = vec![
            UsageEvent::Ingestion,
            UsageEvent::Search,
            UsageEvent::Functions,
            UsageEvent::Other,
        ];

        for variant in variants {
            let json = serde_json::to_string(&variant).unwrap();
            let deserialized: UsageEvent = serde_json::from_str(&json).unwrap();
            assert_eq!(variant, deserialized);
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Stats {
    pub records: i64,
    pub stream_type: StreamType,
    pub org_id: String,
    pub stream_name: String,
    pub original_size: f64,
    #[serde(default)]
    pub _timestamp: i64,
    #[serde(default)]
    pub min_ts: i64,
    #[serde(default)]
    pub max_ts: i64,
    #[serde(default)]
    pub compressed_size: Option<f64>,
    #[serde(default)]
    pub index_size: Option<f64>,
}
