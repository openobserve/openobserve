// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use serde::{Deserialize, Serialize};

use super::{common::FileMeta, StreamType};

pub const USAGE_STREAM: &str = "usage";
pub const STATS_STREAM: &str = "stats";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct UsageData {
    pub event: UsageEvent,
    pub day: u32,
    pub hour: u32,
    pub month: u32,
    pub year: i32,
    pub org_id: String,
    pub request_body: String,
    pub size: f64,
    pub unit: String,
    pub user_email: String,
    pub response_time: f64,
    pub stream_type: StreamType,
    pub num_records: u64,
    pub stream_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compressed_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_ts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_ts: Option<i64>,
}

#[derive(Hash, PartialEq, Eq)]
pub struct GroupKey {
    pub stream_name: String,
    pub org_id: String,
    pub stream_type: StreamType,
    pub day: u32,
    pub hour: u32,
    pub event: UsageEvent,
}

pub struct AggregatedData {
    pub usage_data: UsageData,
    pub count: u64,
}

#[derive(Hash, Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum UsageEvent {
    Ingestion,
    Search,
    Functions,
    Other,
}

impl std::fmt::Display for UsageEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            UsageEvent::Ingestion => write!(f, "Ingestion"),
            UsageEvent::Search => write!(f, "Search"),
            UsageEvent::Functions => write!(f, "Functions"),
            UsageEvent::Other => write!(f, "Other"),
        }
    }
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compressed_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_ts: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_ts: Option<i64>,
}
impl Default for RequestStats {
    fn default() -> Self {
        Self {
            size: 0.0,
            records: 0,
            response_time: 0.0,
            request_body: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
        }
    }
}

impl From<FileMeta> for RequestStats {
    fn from(meta: FileMeta) -> RequestStats {
        RequestStats {
            size: meta.original_size as f64 / (1024.0 * 1024.0),
            records: meta.records,
            response_time: 0.0,
            request_body: None,
            compressed_size: Some(meta.compressed_size as f64 / (1024.0 * 1024.0)),
            min_ts: Some(meta.min_ts),
            max_ts: Some(meta.max_ts),
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
}
