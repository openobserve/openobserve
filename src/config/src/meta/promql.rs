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

use hashbrown::HashMap;
use proto::prometheus_rpc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use strum::Display;
use utoipa::ToSchema;

pub const NAME_LABEL: &str = "__name__";
pub const TYPE_LABEL: &str = "__type__";
pub const HASH_LABEL: &str = "__hash__";
pub const VALUE_LABEL: &str = "value";
pub const BUCKET_LABEL: &str = "le";
pub const QUANTILE_LABEL: &str = "quantile";
pub const METADATA_LABEL: &str = "prom_metadata"; // for schema metadata key
pub const EXEMPLARS_LABEL: &str = "exemplars";

#[derive(Debug, Clone, Serialize)]
pub struct Metric<'a> {
    #[serde(flatten)]
    pub labels: &'a crate::FxIndexMap<String, String>,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq, Deserialize)]
pub struct ClusterLeader {
    pub name: String,
    pub last_received: i64,
    #[serde(default)]
    pub updated_by: String, // instance id of ingestor
}

// cf. https://github.com/prometheus/prometheus/blob/f5fcaa3872ce03808567fabc56afc9cf61c732cb/model/textparse/interface.go#L106-L119
#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize, Display, ToSchema)]
#[strum(serialize_all = "lowercase")]
pub enum MetricType {
    Unknown,
    Counter,
    Gauge,
    Histogram,
    GaugeHistogram,
    ExponentialHistogram,
    Summary,
    Info,
    StateSet,
    #[serde(rename = "")]
    Empty,
}

impl From<prometheus_rpc::metric_metadata::MetricType> for MetricType {
    fn from(mt: prometheus_rpc::metric_metadata::MetricType) -> Self {
        use prometheus_rpc::metric_metadata::MetricType as ProtoMetricType;

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
            "exponentialhistogram" => Self::ExponentialHistogram,
            "summary" => Self::Summary,
            "info" => Self::Info,
            "stateset" => Self::StateSet,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
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
#[derive(Debug, Serialize, Deserialize)]
pub struct RequestRangeQuery {
    /// PromQL expression.
    pub query: Option<String>,
    /// Start timestamp, inclusive.
    pub start: Option<String>,
    /// End timestamp, inclusive.
    pub end: Option<String>,
    /// Query resolution step width in `duration` format or float number of
    /// seconds.
    pub step: Option<String>,
    /// Evaluation timeout.
    pub timeout: Option<String>,
    /// Do not use cache.
    pub no_cache: Option<bool>,
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
pub type ResponseMetadata = HashMap<String, Vec<MetadataObject>>;

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

#[derive(Debug, Deserialize)]
pub struct RequestFormatQuery {
    pub query: String,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub enum Function {
    Avg,
    Sum,
    Count,
    Min,
    Max,
    Last,
    First,
}

impl From<&str> for Function {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "avg" => Self::Avg,
            "sum" => Self::Sum,
            "count" => Self::Count,
            "min" => Self::Min,
            "max" => Self::Max,
            "last" => Self::Last,
            "first" => Self::First,
            _ => panic!("invalid downsampling function: {s}"),
        }
    }
}

impl Function {
    pub fn fun(&self) -> String {
        match self {
            Function::Avg => "avg".to_string(),
            Function::Sum => "sum".to_string(),
            Function::Count => "count".to_string(),
            Function::Min => "min".to_string(),
            Function::Max => "max".to_string(),
            Function::Last => "last_value".to_string(),
            Function::First => "first_value".to_string(),
        }
    }
}

// s -> second
// m -> minute
// h -> hour
// d -> day
#[derive(Debug, Clone)]
pub struct DownsamplingRule {
    pub rule: Option<Regex>,
    pub function: Function,
    pub offset: i64, // seconds
    pub step: i64,   // seconds
}

impl DownsamplingRule {
    pub fn is_match(&self, stream_name: &str) -> bool {
        if let Some(reg) = &self.rule {
            reg.is_match(stream_name)
        } else {
            true
        }
    }
}

#[derive(Debug, Clone, Hash, Eq, PartialEq, Serialize, Deserialize)]
pub enum HashLabelValue {
    String(String),
    Number(u64),
}

impl From<&str> for HashLabelValue {
    fn from(value: &str) -> Self {
        Self::String(value.to_string())
    }
}

impl From<u64> for HashLabelValue {
    fn from(value: u64) -> Self {
        Self::Number(value)
    }
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
