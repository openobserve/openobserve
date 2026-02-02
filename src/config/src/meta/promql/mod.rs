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
use serde::{Deserialize, Deserializer, Serialize};
use strum::Display;
use utoipa::ToSchema;

use crate::meta::search::SearchEventType;

/// Custom deserializer that accepts either a comma-separated string or a string array
fn deserialize_string_or_vec<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::{self, SeqAccess, Visitor};

    struct StringOrVec;

    impl<'de> Visitor<'de> for StringOrVec {
        type Value = Vec<String>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a string or array of strings")
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: de::Error,
        {
            if value.is_empty() {
                Ok(Vec::new())
            } else {
                Ok(value.split(',').map(|s| s.trim().to_string()).collect())
            }
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: SeqAccess<'de>,
        {
            let mut vec = Vec::new();
            while let Some(item) = seq.next_element::<String>()? {
                vec.push(item);
            }
            Ok(vec)
        }
    }

    deserializer.deserialize_any(StringOrVec)
}

pub mod grpc;
pub mod value;

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

impl Metadata {
    pub fn new(name: &str) -> Self {
        Self {
            metric_type: MetricType::Unknown,
            metric_family_name: name.to_string(),
            help: String::new(),
            unit: String::new(),
        }
    }
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
    /// Use cache.
    pub use_cache: Option<bool>,
    /// Use streaming output.
    pub use_streaming: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub search_type: Option<SearchEventType>,
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "deserialize_string_or_vec"
    )]
    pub regions: Vec<String>, // default query all regions, local: only query local region clusters
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "deserialize_string_or_vec"
    )]
    pub clusters: Vec<String>, // default query all clusters, local: only query local cluster
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub result_type: String, // vector, matrix, scalar, string
    pub result: value::Value,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum ApiFuncResponse<T: Serialize> {
    Success {
        data: T,
        #[serde(skip_serializing_if = "Option::is_none")]
        trace_id: Option<String>,
    },
    Error {
        #[serde(rename = "errorType")]
        error_type: ApiErrorType,
        error: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        trace_id: Option<String>,
    },
}

impl<T: Serialize> ApiFuncResponse<T> {
    pub fn ok(data: T, trace_id: Option<String>) -> Self {
        ApiFuncResponse::Success { data, trace_id }
    }

    pub fn err_bad_data(error: impl ToString, trace_id: Option<String>) -> Self {
        ApiFuncResponse::Error {
            error_type: ApiErrorType::BadData,
            error: error.to_string(),
            trace_id,
        }
    }

    pub fn err_internal(error: impl ToString, trace_id: Option<String>) -> Self {
        ApiFuncResponse::Error {
            error_type: ApiErrorType::Internal,
            error: error.to_string(),
            trace_id,
        }
    }
}

// cf. https://github.com/prometheus/prometheus/blob/5c5fa5c319fca713506fa144ec6768fddf00d466/web/api/v1/api.go#L73-L82
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiErrorType {
    Timeout,
    Cancelled,
    Exec,
    BadData,
    Internal,
    Unavailable,
    NotFound,
}

#[cfg(test)]
mod tests {
    use expect_test::expect;

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

    #[test]
    fn test_deserialize_string_or_vec() {
        // Test with comma-separated string
        let json = r#"{"regions": "region1,region2,region3", "clusters": "cluster1"}"#;
        let result: RequestRangeQuery = serde_json::from_str(json).unwrap();
        assert_eq!(result.regions, vec!["region1", "region2", "region3"]);
        assert_eq!(result.clusters, vec!["cluster1"]);

        // Test with array
        let json = r#"{"regions": ["region1", "region2"], "clusters": ["cluster1", "cluster2"]}"#;
        let result: RequestRangeQuery = serde_json::from_str(json).unwrap();
        assert_eq!(result.regions, vec!["region1", "region2"]);
        assert_eq!(result.clusters, vec!["cluster1", "cluster2"]);

        // Test with empty string
        let json = r#"{"regions": "", "clusters": []}"#;
        let result: RequestRangeQuery = serde_json::from_str(json).unwrap();
        assert!(result.regions.is_empty());
        assert!(result.clusters.is_empty());

        // Test with default (missing fields)
        let json = r#"{}"#;
        let result: RequestRangeQuery = serde_json::from_str(json).unwrap();
        assert!(result.regions.is_empty());
        assert!(result.clusters.is_empty());
    }

    #[test]
    fn test_api_func_response_serialize() {
        let ok = ApiFuncResponse::ok("hello".to_owned(), None);
        assert_eq!(
            serde_json::to_string(&ok).unwrap(),
            r#"{"status":"success","data":"hello"}"#
        );

        let err = ApiFuncResponse::<()>::err_internal("something went wrong".to_owned(), None);
        assert_eq!(
            serde_json::to_string(&err).unwrap(),
            r#"{"status":"error","errorType":"internal","error":"something went wrong"}"#
        );

        let err = ApiFuncResponse::<()>::err_bad_data(
            r#"invalid parameter \"start\": Invalid time value for 'start': cannot parse \"foobar\" to a valid timestamp"#,
            None,
        );
        expect![[r#"
            {
              "status": "error",
              "errorType": "bad_data",
              "error": "invalid parameter \\\"start\\\": Invalid time value for 'start': cannot parse \\\"foobar\\\" to a valid timestamp"
            }"#
        ]].assert_eq(&serde_json::to_string_pretty(&err).unwrap());
    }
}
