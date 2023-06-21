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

use ahash::AHashMap as HashMap;
use serde::{Deserialize, Serialize};
use strum::Display;

use crate::service::metrics::prom::prometheus as proto;

pub const NAME_LABEL: &str = "__name__";
pub const TYPE_LABEL: &str = "__type__";
pub const HASH_LABEL: &str = "__hash__";
pub const VALUE_LABEL: &str = "value";
pub const LE_LABEL: &str = "le";
pub const QUANTILE_LABEL: &str = "quantile";
pub const METADATA_LABEL: &str = "prom_metadata"; // for schema metadata key

// See https://docs.rs/indexmap/latest/indexmap/#alternate-hashers
pub type FxIndexMap<K, V> = indexmap::IndexMap<K, V, ahash::RandomState>;

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
#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize, Display)]
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

impl From<&str> for MetricType {
    fn from(mt: &str) -> Self {
        match mt.to_lowercase().as_str() {
            "counter" => Self::Counter,
            "gauge" => Self::Gauge,
            "histogram" => Self::Histogram,
            "gaugehistogram" => Self::GaugeHistogram,
            "summary" => Self::Summary,
            "info" => Self::Info,
            "stateset" => Self::StateSet,
            _ => Self::Unknown,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Success,
    Error,
}

/// Instant query.
#[derive(Debug, Deserialize)]
pub struct RequestQuery {
    /// PromQL expression.
    pub query: Option<String>,
    /// Evaluation timestamp. Defaults to current server time.
    pub time: Option<String>,
    /// Evaluation timeout.
    pub timeout: Option<String>,
}

/// Range query.
#[derive(Debug, Deserialize)]
pub struct RequestRangeQuery {
    /// PromQL expression.
    pub query: Option<String>,
    /// Start timestamp, inclusive.
    pub start: Option<String>,
    /// End timestamp, inclusive.
    pub end: Option<String>,
    /// Query resolution step width in `duration` format or float number of seconds.
    pub step: Option<String>,
    /// Evaluation timeout.
    pub timeout: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RequestMetadata {
    /// Maximum number of metrics to return.
    pub limit: Option<usize>,
    /// A metric name to filter metadata for. All metric metadata is retrieved
    /// if left empty.
    pub metric: Option<String>,
}

// key - metric name
pub(crate) type ResponseMetadata = HashMap<String, Vec<MetadataObject>>;

#[derive(Debug, Serialize)]
pub struct MetadataObject {
    #[serde(rename = "type")]
    typ: String, // counter, gauge, histogram, summary
    help: String,
    unit: String,
}

impl From<Metadata> for MetadataObject {
    fn from(md: Metadata) -> Self {
        Self {
            typ: md.metric_type.to_string(),
            help: md.help,
            unit: md.unit,
        }
    }
}

/// Request a list of time series that match a certain label set.
#[derive(Debug, Deserialize)]
pub struct RequestSeries {
    /// Series selector argument that selects the series to return.
    ///
    /// NOTE: Prometheus API allows passing multiple `match[]` arguments,
    /// but we only supports a single one.
    #[serde(rename = "match[]")]
    pub matcher: Option<String>,
    /// Start timestamp.
    pub start: Option<String>,
    /// End timestamp.
    pub end: Option<String>,
}

/// Request a list of label names.
#[derive(Debug, Deserialize)]
pub struct RequestLabels {
    /// Series selector argument that selects the series from which to read
    /// the label names.
    ///
    /// NOTE: Prometheus API allows passing any number of `match[]` arguments,
    /// but we requires that exactly one is passed.
    #[serde(rename = "match[]")]
    pub matcher: Option<String>,
    /// Start timestamp.
    pub start: Option<String>,
    /// End timestamp.
    pub end: Option<String>,
}

/// Request a list of label values for a provided label name.
#[derive(Debug, Deserialize)]
pub struct RequestLabelValues {
    /// Series selector argument that selects the series from which to read
    /// the label values.
    ///
    /// NOTE: Prometheus API allows passing any number of `match[]` arguments,
    /// but we requires that exactly one is passed.
    #[serde(rename = "match[]")]
    pub matcher: Option<String>,
    /// Start timestamp.
    pub start: Option<String>,
    /// End timestamp.
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
