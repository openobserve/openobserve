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

use ahash::AHashMap;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const NAME_LABEL: &str = "__name__";
pub const TYPE_LABEL: &str = "__type__";
pub const HASH_LABEL: &str = "__hash__";
pub const VALUE_LABEL: &str = "value";
pub const CLUSTER_LABEL: &str = "cluster";
pub const REPLICA_LABEL: &str = "__replica__";

#[derive(Clone, Debug, Serialize)]
pub struct Metric {
    pub value: f64,
    #[serde(flatten)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub labels: AHashMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ClusterLeader {
    pub name: String,
    pub last_received: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum MetricType {
    UNKNOWN,
    COUNTER,
    GAUGE,
    HISTOGRAM,
    GAUGEHISTOGRAM,
    SUMMARY,
    INFO,
    STATESET,
}

impl From<&str> for MetricType {
    fn from(s: &str) -> Self {
        match s.to_uppercase().as_str() {
            "COUNTER" => MetricType::COUNTER,
            "GAUGE" => MetricType::GAUGE,
            "HISTOGRAM" => MetricType::HISTOGRAM,
            "GAUGEHISTOGRAM" => MetricType::GAUGEHISTOGRAM,
            "SUMMARY" => MetricType::SUMMARY,
            "INFO" => MetricType::INFO,
            "STATESET" => MetricType::STATESET,
            _ => MetricType::UNKNOWN,
        }
    }
}

impl MetricType {
    pub fn as_str_name(&self) -> &'static str {
        match self {
            MetricType::UNKNOWN => "UNKNOWN",
            MetricType::COUNTER => "COUNTER",
            MetricType::GAUGE => "GAUGE",
            MetricType::HISTOGRAM => "HISTOGRAM",
            MetricType::GAUGEHISTOGRAM => "GAUGEHISTOGRAM",
            MetricType::SUMMARY => "SUMMARY",
            MetricType::INFO => "INFO",
            MetricType::STATESET => "STATESET",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Metadata {
    pub metric_type: MetricType,
    pub metric_family_name: String,
    pub help: String,
    pub unit: String,
}

#[derive(Debug, Deserialize)]
pub struct RequestQuery {
    pub query: String,
    pub time: Option<String>,
    pub timeout: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RequestRangeQuery {
    pub query: String,
    pub start: String,
    pub end: String,
    pub step: Option<String>,
    pub timeout: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RequestMetadata {
    pub limit: i64,
    pub metric: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RequestSeries {
    #[serde(rename = "match")]
    pub matches: Vec<String>,
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RequestLabels {
    #[serde(rename = "match")]
    pub matches: Option<Vec<String>>,
    pub start: Option<String>,
    pub end: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RequestValues {
    #[serde(rename = "match")]
    pub matches: Option<Vec<String>>,
    pub start: Option<String>,
    pub end: Option<String>,
}
