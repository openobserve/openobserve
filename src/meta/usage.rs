use super::StreamType;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UsageData {
    pub event: UsageEvent,
    pub day: u32,
    pub hour: u32,
    pub month: u32,
    pub year: i32,
    pub organization_identifier: String,
    pub request_body: String,
    pub size: f64,
    pub unit: String,
    pub user_email: String,
    pub response_time: f64,
    pub stream_type: StreamType,
    pub num_records: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum UsageEvent {
    Ingestion,
    Search,
    Functions,
    Other,
}

impl From<UsageType> for UsageEvent {
    fn from(usage: UsageType) -> UsageEvent {
        match usage {
            UsageType::Bulk
            | UsageType::Json
            | UsageType::Multi
            | UsageType::Traces
            | UsageType::Metrics
            | UsageType::KinesisFirehose
            | UsageType::GCPSubscription
            | UsageType::EnrichmentTable
            | UsageType::Syslog
            | UsageType::JsonMetrics => UsageEvent::Ingestion,
            UsageType::Search
            | UsageType::SearchAround
            | UsageType::SearchTopNValues
            | UsageType::MetricSearch => UsageEvent::Search,
            UsageType::Functions => UsageEvent::Functions,
            UsageType::Retention => UsageEvent::Other,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum UsageType {
    #[serde(rename = "logs/_bulk")]
    Bulk,
    #[serde(rename = "logs/_json")]
    Json,
    #[serde(rename = "logs/_multi")]
    Multi,
    #[serde(rename = "/traces")]
    Traces,
    #[serde(rename = "/v1/write")]
    Metrics,
    #[serde(rename = "/_search")]
    Search,
    #[serde(rename = "/metrics/_search")]
    MetricSearch,
    #[serde(rename = "/_around")]
    SearchAround,
    #[serde(rename = "/_values")]
    SearchTopNValues,
    #[serde(rename = "functions")]
    Functions,
    #[serde(rename = "data_retention")]
    Retention,
    #[serde(rename = "/_kinesis_firehose")]
    KinesisFirehose,
    #[serde(rename = "/gcp/_sub")]
    GCPSubscription,
    #[serde(rename = "metrics/_json")]
    JsonMetrics,
    Syslog,
    EnrichmentTable,
}

impl ToString for UsageType {
    fn to_string(&self) -> String {
        match self {
            UsageType::Bulk => "logs/_bulk".to_owned(),
            UsageType::Json => "logs/_json".to_owned(),
            UsageType::JsonMetrics => "metrics/_json".to_owned(),
            UsageType::Multi => "logs/_multi".to_owned(),
            UsageType::Traces => "/traces".to_owned(),
            UsageType::Metrics => "/v1/write".to_owned(),
            UsageType::Search => "/_search".to_owned(),
            UsageType::Functions => "functions".to_owned(),
            UsageType::Retention => "data_retention".to_owned(),
            UsageType::KinesisFirehose => "_kinesis_firehose".to_owned(),
            UsageType::Syslog => "syslog".to_owned(),
            UsageType::EnrichmentTable => "enrichment_table".to_owned(),
            UsageType::SearchAround => "/_around".to_owned(),
            UsageType::SearchTopNValues => "/_values".to_owned(),
            UsageType::GCPSubscription => "/gcp/_sub".to_owned(),
            UsageType::MetricSearch => "/metrics/_search".to_owned(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RequestStats {
    pub size: f64,
    pub records: u64,
    pub response_time: f64,
    #[serde(default)]
    pub request_body: Option<String>,
}
impl Default for RequestStats {
    fn default() -> Self {
        Self {
            size: 0.0,
            records: 0,
            response_time: 0.0,
            request_body: None,
        }
    }
}
