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
use strum::Display;

use crate::service::metrics::prom::prometheus as proto;

pub const NAME_LABEL: &str = "__name__";
pub const TYPE_LABEL: &str = "__type__";
pub const HASH_LABEL: &str = "__hash__";
pub const VALUE_LABEL: &str = "value";
pub const LE_LABEL: &str = "le";
pub const QUANTILE_LABEL: &str = "quantile";
pub const CLUSTER_LABEL: &str = "cluster";
pub const REPLICA_LABEL: &str = "__replica__";
pub const METADATA_LABEL: &str = "prom_metadata";

// See https://docs.rs/indexmap/latest/indexmap/#alternate-hashers
pub type FxIndexMap<K, V> =
    indexmap::IndexMap<K, V, std::hash::BuildHasherDefault<rustc_hash::FxHasher>>;

#[derive(Debug, Clone, Serialize)]
pub struct Metric {
    #[serde(flatten)]
    pub labels: FxIndexMap<String, String>,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusterLeader {
    pub name: String,
    pub last_received: i64,
}

// cf. https://github.com/prometheus/prometheus/blob/f5fcaa3872ce03808567fabc56afc9cf61c732cb/model/textparse/interface.go#L106-L119
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Display)]
#[strum(serialize_all = "lowercase")]
pub enum MetricType {
    Unknown,
    Counter,
    Gauge,
    Histogram,
    GaugeHistogram,
    Summary,
    Info,
    StateSet,
}

impl From<proto::metric_metadata::MetricType> for MetricType {
    fn from(mt: proto::metric_metadata::MetricType) -> Self {
        use proto::metric_metadata::MetricType as ProtoMetricType;

        match mt {
            ProtoMetricType::Unknown => Self::Unknown,
            ProtoMetricType::Counter => Self::Counter,
            ProtoMetricType::Gauge => Self::Gauge,
            ProtoMetricType::Histogram => Self::Histogram,
            ProtoMetricType::Gaugehistogram => Self::GaugeHistogram,
            ProtoMetricType::Summary => Self::Summary,
            ProtoMetricType::Info => Self::Info,
            ProtoMetricType::Stateset => Self::StateSet,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metric_type_display() {
        assert_eq!(MetricType::Counter.to_string(), "counter");
        assert_eq!(MetricType::Gauge.to_string(), "gauge");
        assert_eq!(MetricType::Histogram.to_string(), "histogram");
        assert_eq!(MetricType::GaugeHistogram.to_string(), "gaugehistogram");
        assert_eq!(MetricType::Summary.to_string(), "summary");
        assert_eq!(MetricType::Info.to_string(), "info");
        assert_eq!(MetricType::StateSet.to_string(), "stateset");
        assert_eq!(format!("{}", MetricType::Unknown), "unknown");
        assert_eq!(MetricType::Unknown.to_string(), "unknown");
    }
}
