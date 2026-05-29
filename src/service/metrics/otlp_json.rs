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

//! OTLP/JSON deserialization for metrics.
//!
//! `opentelemetry-proto`'s `with-serde` derives do not implement the
//! OTLP/JSON wire format correctly for several metric types:
//!
//! * `Metric.data` (the `oneof gauge | sum | histogram | exponential_histogram
//!   | summary`) is always deserialized as `None`, dropping every data point.
//! * 64-bit integer fields use a mix of string-coercing and number-only
//!   helpers, so neither the spec-compliant string form (e.g.
//!   `"timeUnixNano": "..."`) nor the lax number form deserializes the full
//!   message — `HistogramDataPoint`, `SummaryDataPoint`, and the `AsInt`
//!   variant of `NumberDataPoint` are all affected.
//!
//! As a result, sending OTLP metrics with `Content-Type: application/json`
//! (what the upstream OpenTelemetry Collector emits when configured with the
//! `otlphttp` exporter and `encoding: json`) silently drops every data point.
//! Streams get registered from the metric name but never receive any events.
//!
//! This module parses OTLP/JSON metric requests via shadow structs that match
//! the OTLP/JSON wire format spec (camelCase, 64-bit ints encodable as either
//! JSON number or string, enums encodable as either integer or `SCREAMING_CASE`
//! name, `bytes` as base64) and converts the result into the prost-generated
//! types so the rest of the ingestion pipeline is unaffected.
//!
//! Reference: <https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding>

use opentelemetry_proto::tonic::{
    collector::metrics::v1::ExportMetricsServiceRequest,
    common::v1::{AnyValue, ArrayValue, InstrumentationScope, KeyValue, KeyValueList, any_value},
    metrics::v1::{
        AggregationTemporality, Exemplar, ExponentialHistogram, ExponentialHistogramDataPoint,
        Gauge, Histogram, HistogramDataPoint, Metric, NumberDataPoint, ResourceMetrics,
        ScopeMetrics, Sum, Summary, SummaryDataPoint, exemplar, exponential_histogram_data_point,
        metric, number_data_point, summary_data_point,
    },
    resource::v1::Resource,
};
use serde::{Deserialize, Deserializer, de};

/// Parse an OTLP/JSON `ExportMetricsServiceRequest` from its serialized body.
pub fn parse_export_metrics_request(
    body: &[u8],
) -> Result<ExportMetricsServiceRequest, serde_json::Error> {
    let req: ExportMetricsServiceRequestJson = serde_json::from_slice(body)?;
    Ok(req.into())
}

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------

/// Deserialize a 64-bit unsigned int from either a JSON number or string.
///
/// OTLP/JSON encodes `fixed64` / `uint64` / `int64` as strings, but receivers
/// must also accept the corresponding JSON numeric form.
fn de_u64<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
    struct V;
    impl<'de> de::Visitor<'de> for V {
        type Value = u64;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("u64 as number or string")
        }
        fn visit_u64<E: de::Error>(self, v: u64) -> Result<u64, E> {
            Ok(v)
        }
        fn visit_i64<E: de::Error>(self, v: i64) -> Result<u64, E> {
            u64::try_from(v).map_err(|_| E::custom("negative value for u64"))
        }
        fn visit_f64<E: de::Error>(self, v: f64) -> Result<u64, E> {
            if v.is_finite() && v >= 0.0 && v <= u64::MAX as f64 {
                Ok(v as u64)
            } else {
                Err(E::custom("out-of-range f64 for u64"))
            }
        }
        fn visit_str<E: de::Error>(self, v: &str) -> Result<u64, E> {
            v.parse::<u64>().map_err(E::custom)
        }
    }
    d.deserialize_any(V)
}

fn de_u64_from_value(v: serde_json::Value) -> Result<u64, String> {
    match v {
        serde_json::Value::Null => Err("null".into()),
        serde_json::Value::Number(n) => n
            .as_u64()
            .or_else(|| n.as_i64().and_then(|i| u64::try_from(i).ok()))
            .or_else(|| n.as_f64().and_then(|f| (f.is_finite() && f >= 0.0).then(|| f as u64)))
            .ok_or_else(|| format!("invalid u64 number: {n}")),
        serde_json::Value::String(s) => s.parse::<u64>().map_err(|e| e.to_string()),
        other => Err(format!("expected u64, got {other:?}")),
    }
}

fn de_opt_i64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<i64>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Opt {
        Null,
        Num(i64),
        UNum(u64),
        FNum(f64),
        Str(String),
    }
    match Opt::deserialize(d)? {
        Opt::Null => Ok(None),
        Opt::Num(v) => Ok(Some(v)),
        Opt::UNum(v) => i64::try_from(v)
            .map(Some)
            .map_err(|_| de::Error::custom("u64 too large for i64")),
        Opt::FNum(v) => Ok(Some(v as i64)),
        Opt::Str(s) => s.parse::<i64>().map(Some).map_err(de::Error::custom),
    }
}

fn de_vec_u64<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u64>, D::Error> {
    let values: Vec<serde_json::Value> = Vec::deserialize(d)?;
    values
        .into_iter()
        .map(|v| de_u64_from_value(v).map_err(de::Error::custom))
        .collect()
}

fn de_bytes_b64<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
    use base64::Engine;
    let s: String = String::deserialize(d)?;
    if s.is_empty() {
        return Ok(Vec::new());
    }
    // OTLP/JSON spec: standard base64 with padding. Be lenient and accept
    // hex too, since some clients (e.g. older OTel SDKs) emit it.
    if let Ok(b) = base64::engine::general_purpose::STANDARD.decode(&s) {
        return Ok(b);
    }
    if let Ok(b) = base64::engine::general_purpose::STANDARD_NO_PAD.decode(&s) {
        return Ok(b);
    }
    if let Ok(b) = hex_decode(&s) {
        return Ok(b);
    }
    Err(de::Error::custom(format!(
        "expected base64 (or hex) for bytes field, got: {s:?}"
    )))
}

fn hex_decode(s: &str) -> Result<Vec<u8>, ()> {
    if s.len() % 2 != 0 {
        return Err(());
    }
    let mut out = Vec::with_capacity(s.len() / 2);
    for i in (0..s.len()).step_by(2) {
        let byte = u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| ())?;
        out.push(byte);
    }
    Ok(out)
}

/// Deserialize a protobuf enum value that may arrive as either an integer or
/// the SCREAMING_SNAKE string form per OTLP/JSON spec.
fn de_enum_i32<'de, D, F>(d: D, parse_name: F) -> Result<i32, D::Error>
where
    D: Deserializer<'de>,
    F: Fn(&str) -> Option<i32>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum E {
        Num(i32),
        UNum(u32),
        Str(String),
    }
    match E::deserialize(d)? {
        E::Num(v) => Ok(v),
        E::UNum(v) => Ok(v as i32),
        E::Str(s) => parse_name(&s)
            .ok_or_else(|| de::Error::custom(format!("unknown enum value: {s:?}"))),
    }
}

fn de_aggregation_temporality<'de, D: Deserializer<'de>>(d: D) -> Result<i32, D::Error> {
    de_enum_i32(d, |s| match s {
        "AGGREGATION_TEMPORALITY_UNSPECIFIED" => Some(AggregationTemporality::Unspecified as i32),
        "AGGREGATION_TEMPORALITY_DELTA" => Some(AggregationTemporality::Delta as i32),
        "AGGREGATION_TEMPORALITY_CUMULATIVE" => Some(AggregationTemporality::Cumulative as i32),
        _ => None,
    })
}

// ---------------------------------------------------------------------------
// Shadow structs (OTLP/JSON wire shape)
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ExportMetricsServiceRequestJson {
    resource_metrics: Vec<ResourceMetricsJson>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ResourceMetricsJson {
    resource: Option<ResourceJson>,
    scope_metrics: Vec<ScopeMetricsJson>,
    schema_url: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ResourceJson {
    attributes: Vec<KeyValueJson>,
    dropped_attributes_count: u32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ScopeMetricsJson {
    scope: Option<InstrumentationScopeJson>,
    metrics: Vec<MetricJson>,
    schema_url: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct InstrumentationScopeJson {
    name: String,
    version: String,
    attributes: Vec<KeyValueJson>,
    dropped_attributes_count: u32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct KeyValueJson {
    key: String,
    value: Option<AnyValueJson>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct AnyValueJson {
    string_value: Option<String>,
    bool_value: Option<bool>,
    #[serde(default, deserialize_with = "de_opt_i64")]
    int_value: Option<i64>,
    double_value: Option<f64>,
    array_value: Option<ArrayValueJson>,
    kvlist_value: Option<KvListValueJson>,
    #[serde(default, deserialize_with = "de_opt_bytes_b64")]
    bytes_value: Option<Vec<u8>>,
}

fn de_opt_bytes_b64<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<u8>>, D::Error> {
    let s: Option<String> = Option::deserialize(d)?;
    match s {
        None => Ok(None),
        Some(s) if s.is_empty() => Ok(Some(Vec::new())),
        Some(s) => {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode(&s)
                .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(&s))
                .or_else(|_| hex_decode(&s).map_err(|_| {
                    base64::DecodeError::InvalidByte(0, 0)
                }))
                .map(Some)
                .map_err(de::Error::custom)
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct ArrayValueJson {
    values: Vec<AnyValueJson>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct KvListValueJson {
    values: Vec<KeyValueJson>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct MetricJson {
    name: String,
    description: String,
    unit: String,
    metadata: Vec<KeyValueJson>,
    // Flattened oneof variants
    gauge: Option<GaugeJson>,
    sum: Option<SumJson>,
    histogram: Option<HistogramJson>,
    exponential_histogram: Option<ExponentialHistogramJson>,
    summary: Option<SummaryJson>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct GaugeJson {
    data_points: Vec<NumberDataPointJson>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct SumJson {
    data_points: Vec<NumberDataPointJson>,
    #[serde(deserialize_with = "de_aggregation_temporality")]
    aggregation_temporality: i32,
    is_monotonic: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct HistogramJson {
    data_points: Vec<HistogramDataPointJson>,
    #[serde(deserialize_with = "de_aggregation_temporality")]
    aggregation_temporality: i32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ExponentialHistogramJson {
    data_points: Vec<ExponentialHistogramDataPointJson>,
    #[serde(deserialize_with = "de_aggregation_temporality")]
    aggregation_temporality: i32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct SummaryJson {
    data_points: Vec<SummaryDataPointJson>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct NumberDataPointJson {
    attributes: Vec<KeyValueJson>,
    #[serde(deserialize_with = "de_u64")]
    start_time_unix_nano: u64,
    #[serde(deserialize_with = "de_u64")]
    time_unix_nano: u64,
    // oneof value
    #[serde(deserialize_with = "de_opt_i64")]
    as_int: Option<i64>,
    as_double: Option<f64>,
    exemplars: Vec<ExemplarJson>,
    flags: u32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct HistogramDataPointJson {
    attributes: Vec<KeyValueJson>,
    #[serde(deserialize_with = "de_u64")]
    start_time_unix_nano: u64,
    #[serde(deserialize_with = "de_u64")]
    time_unix_nano: u64,
    #[serde(deserialize_with = "de_u64")]
    count: u64,
    sum: Option<f64>,
    #[serde(deserialize_with = "de_vec_u64")]
    bucket_counts: Vec<u64>,
    explicit_bounds: Vec<f64>,
    exemplars: Vec<ExemplarJson>,
    flags: u32,
    min: Option<f64>,
    max: Option<f64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ExponentialHistogramDataPointJson {
    attributes: Vec<KeyValueJson>,
    #[serde(deserialize_with = "de_u64")]
    start_time_unix_nano: u64,
    #[serde(deserialize_with = "de_u64")]
    time_unix_nano: u64,
    #[serde(deserialize_with = "de_u64")]
    count: u64,
    sum: Option<f64>,
    scale: i32,
    #[serde(deserialize_with = "de_u64")]
    zero_count: u64,
    positive: Option<BucketsJson>,
    negative: Option<BucketsJson>,
    flags: u32,
    exemplars: Vec<ExemplarJson>,
    min: Option<f64>,
    max: Option<f64>,
    zero_threshold: f64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct BucketsJson {
    offset: i32,
    #[serde(deserialize_with = "de_vec_u64")]
    bucket_counts: Vec<u64>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct SummaryDataPointJson {
    attributes: Vec<KeyValueJson>,
    #[serde(deserialize_with = "de_u64")]
    start_time_unix_nano: u64,
    #[serde(deserialize_with = "de_u64")]
    time_unix_nano: u64,
    #[serde(deserialize_with = "de_u64")]
    count: u64,
    sum: f64,
    quantile_values: Vec<QuantileValueJson>,
    flags: u32,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct QuantileValueJson {
    quantile: f64,
    value: f64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct ExemplarJson {
    filtered_attributes: Vec<KeyValueJson>,
    #[serde(deserialize_with = "de_u64")]
    time_unix_nano: u64,
    as_double: Option<f64>,
    #[serde(deserialize_with = "de_opt_i64")]
    as_int: Option<i64>,
    #[serde(deserialize_with = "de_bytes_b64")]
    span_id: Vec<u8>,
    #[serde(deserialize_with = "de_bytes_b64")]
    trace_id: Vec<u8>,
}

// ---------------------------------------------------------------------------
// Shadow -> prost conversions
// ---------------------------------------------------------------------------

impl From<ExportMetricsServiceRequestJson> for ExportMetricsServiceRequest {
    fn from(j: ExportMetricsServiceRequestJson) -> Self {
        Self {
            resource_metrics: j.resource_metrics.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<ResourceMetricsJson> for ResourceMetrics {
    fn from(j: ResourceMetricsJson) -> Self {
        Self {
            resource: j.resource.map(Into::into),
            scope_metrics: j.scope_metrics.into_iter().map(Into::into).collect(),
            schema_url: j.schema_url,
        }
    }
}

impl From<ResourceJson> for Resource {
    fn from(j: ResourceJson) -> Self {
        Self {
            attributes: j.attributes.into_iter().map(Into::into).collect(),
            dropped_attributes_count: j.dropped_attributes_count,
            entity_refs: Vec::new(),
        }
    }
}

impl From<ScopeMetricsJson> for ScopeMetrics {
    fn from(j: ScopeMetricsJson) -> Self {
        Self {
            scope: j.scope.map(Into::into),
            metrics: j.metrics.into_iter().map(Into::into).collect(),
            schema_url: j.schema_url,
        }
    }
}

impl From<InstrumentationScopeJson> for InstrumentationScope {
    fn from(j: InstrumentationScopeJson) -> Self {
        Self {
            name: j.name,
            version: j.version,
            attributes: j.attributes.into_iter().map(Into::into).collect(),
            dropped_attributes_count: j.dropped_attributes_count,
        }
    }
}

impl From<KeyValueJson> for KeyValue {
    fn from(j: KeyValueJson) -> Self {
        Self {
            key: j.key,
            value: j.value.map(Into::into),
        }
    }
}

impl From<AnyValueJson> for AnyValue {
    fn from(j: AnyValueJson) -> Self {
        let value = if let Some(s) = j.string_value {
            Some(any_value::Value::StringValue(s))
        } else if let Some(b) = j.bool_value {
            Some(any_value::Value::BoolValue(b))
        } else if let Some(i) = j.int_value {
            Some(any_value::Value::IntValue(i))
        } else if let Some(d) = j.double_value {
            Some(any_value::Value::DoubleValue(d))
        } else if let Some(a) = j.array_value {
            Some(any_value::Value::ArrayValue(ArrayValue {
                values: a.values.into_iter().map(Into::into).collect(),
            }))
        } else if let Some(kv) = j.kvlist_value {
            Some(any_value::Value::KvlistValue(KeyValueList {
                values: kv.values.into_iter().map(Into::into).collect(),
            }))
        } else {
            j.bytes_value.map(any_value::Value::BytesValue)
        };
        AnyValue { value }
    }
}

impl From<MetricJson> for Metric {
    fn from(j: MetricJson) -> Self {
        // OTLP/JSON oneof: pick the first variant that's set. Per spec only
        // one is set in well-formed payloads; if multiple are set we honor
        // the same ordering used by the protobuf binary decoder.
        let data = if let Some(g) = j.gauge {
            Some(metric::Data::Gauge(g.into()))
        } else if let Some(s) = j.sum {
            Some(metric::Data::Sum(s.into()))
        } else if let Some(h) = j.histogram {
            Some(metric::Data::Histogram(h.into()))
        } else if let Some(eh) = j.exponential_histogram {
            Some(metric::Data::ExponentialHistogram(eh.into()))
        } else {
            j.summary.map(|s| metric::Data::Summary(s.into()))
        };
        Self {
            name: j.name,
            description: j.description,
            unit: j.unit,
            metadata: j.metadata.into_iter().map(Into::into).collect(),
            data,
        }
    }
}

impl From<GaugeJson> for Gauge {
    fn from(j: GaugeJson) -> Self {
        Self {
            data_points: j.data_points.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<SumJson> for Sum {
    fn from(j: SumJson) -> Self {
        Self {
            data_points: j.data_points.into_iter().map(Into::into).collect(),
            aggregation_temporality: j.aggregation_temporality,
            is_monotonic: j.is_monotonic,
        }
    }
}

impl From<HistogramJson> for Histogram {
    fn from(j: HistogramJson) -> Self {
        Self {
            data_points: j.data_points.into_iter().map(Into::into).collect(),
            aggregation_temporality: j.aggregation_temporality,
        }
    }
}

impl From<ExponentialHistogramJson> for ExponentialHistogram {
    fn from(j: ExponentialHistogramJson) -> Self {
        Self {
            data_points: j.data_points.into_iter().map(Into::into).collect(),
            aggregation_temporality: j.aggregation_temporality,
        }
    }
}

impl From<SummaryJson> for Summary {
    fn from(j: SummaryJson) -> Self {
        Self {
            data_points: j.data_points.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<NumberDataPointJson> for NumberDataPoint {
    fn from(j: NumberDataPointJson) -> Self {
        let value = if let Some(d) = j.as_double {
            Some(number_data_point::Value::AsDouble(d))
        } else {
            j.as_int.map(number_data_point::Value::AsInt)
        };
        Self {
            attributes: j.attributes.into_iter().map(Into::into).collect(),
            start_time_unix_nano: j.start_time_unix_nano,
            time_unix_nano: j.time_unix_nano,
            exemplars: j.exemplars.into_iter().map(Into::into).collect(),
            flags: j.flags,
            value,
        }
    }
}

impl From<HistogramDataPointJson> for HistogramDataPoint {
    fn from(j: HistogramDataPointJson) -> Self {
        Self {
            attributes: j.attributes.into_iter().map(Into::into).collect(),
            start_time_unix_nano: j.start_time_unix_nano,
            time_unix_nano: j.time_unix_nano,
            count: j.count,
            sum: j.sum,
            bucket_counts: j.bucket_counts,
            explicit_bounds: j.explicit_bounds,
            exemplars: j.exemplars.into_iter().map(Into::into).collect(),
            flags: j.flags,
            min: j.min,
            max: j.max,
        }
    }
}

impl From<ExponentialHistogramDataPointJson> for ExponentialHistogramDataPoint {
    fn from(j: ExponentialHistogramDataPointJson) -> Self {
        Self {
            attributes: j.attributes.into_iter().map(Into::into).collect(),
            start_time_unix_nano: j.start_time_unix_nano,
            time_unix_nano: j.time_unix_nano,
            count: j.count,
            sum: j.sum,
            scale: j.scale,
            zero_count: j.zero_count,
            positive: j.positive.map(Into::into),
            negative: j.negative.map(Into::into),
            flags: j.flags,
            exemplars: j.exemplars.into_iter().map(Into::into).collect(),
            min: j.min,
            max: j.max,
            zero_threshold: j.zero_threshold,
        }
    }
}

impl From<BucketsJson> for exponential_histogram_data_point::Buckets {
    fn from(j: BucketsJson) -> Self {
        Self {
            offset: j.offset,
            bucket_counts: j.bucket_counts,
        }
    }
}

impl From<SummaryDataPointJson> for SummaryDataPoint {
    fn from(j: SummaryDataPointJson) -> Self {
        Self {
            attributes: j.attributes.into_iter().map(Into::into).collect(),
            start_time_unix_nano: j.start_time_unix_nano,
            time_unix_nano: j.time_unix_nano,
            count: j.count,
            sum: j.sum,
            quantile_values: j
                .quantile_values
                .into_iter()
                .map(|q| summary_data_point::ValueAtQuantile {
                    quantile: q.quantile,
                    value: q.value,
                })
                .collect(),
            flags: j.flags,
        }
    }
}

impl From<ExemplarJson> for Exemplar {
    fn from(j: ExemplarJson) -> Self {
        let value = if let Some(d) = j.as_double {
            Some(exemplar::Value::AsDouble(d))
        } else {
            j.as_int.map(exemplar::Value::AsInt)
        };
        Self {
            filtered_attributes: j.filtered_attributes.into_iter().map(Into::into).collect(),
            time_unix_nano: j.time_unix_nano,
            span_id: j.span_id,
            trace_id: j.trace_id,
            value,
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> ExportMetricsServiceRequest {
        parse_export_metrics_request(json.as_bytes()).expect("parse must succeed")
    }

    fn first_metric(req: &ExportMetricsServiceRequest) -> &Metric {
        &req.resource_metrics[0].scope_metrics[0].metrics[0]
    }

    #[test]
    fn histogram_with_string_ints_per_spec() {
        let req = parse(
            r#"{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{
                "name":"h","description":"d","unit":"ms",
                "histogram":{"aggregationTemporality":1,"dataPoints":[{
                    "startTimeUnixNano":"1","timeUnixNano":"2","count":"5","sum":12.3,
                    "bucketCounts":["0","2","3","0"],"explicitBounds":[10,100,1000]
                }]}
            }]}]}]}"#,
        );
        let m = first_metric(&req);
        assert_eq!(m.name, "h");
        let Some(metric::Data::Histogram(h)) = &m.data else {
            panic!("expected histogram, got {:?}", m.data)
        };
        assert_eq!(h.aggregation_temporality, 1);
        assert_eq!(h.data_points.len(), 1);
        let dp = &h.data_points[0];
        assert_eq!(dp.start_time_unix_nano, 1);
        assert_eq!(dp.time_unix_nano, 2);
        assert_eq!(dp.count, 5);
        assert_eq!(dp.sum, Some(12.3));
        assert_eq!(dp.bucket_counts, vec![0, 2, 3, 0]);
        assert_eq!(dp.explicit_bounds, vec![10.0, 100.0, 1000.0]);
    }

    #[test]
    fn histogram_with_numeric_ints_also_works() {
        let req = parse(
            r#"{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{
                "name":"h","histogram":{"aggregationTemporality":1,"dataPoints":[{
                    "startTimeUnixNano":1717000000000000000,"timeUnixNano":1717000001000000000,
                    "count":5,"sum":12.3,"bucketCounts":[0,2,3,0],"explicitBounds":[10,100,1000]
                }]}
            }]}]}]}"#,
        );
        let Some(metric::Data::Histogram(h)) = &first_metric(&req).data else {
            panic!("expected histogram")
        };
        assert_eq!(h.data_points[0].count, 5);
        assert_eq!(h.data_points[0].time_unix_nano, 1717000001000000000);
        assert_eq!(h.data_points[0].bucket_counts, vec![0, 2, 3, 0]);
    }

    #[test]
    fn counter_with_as_int_string() {
        let req = parse(
            r#"{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{
                "name":"c","sum":{"aggregationTemporality":1,"isMonotonic":true,"dataPoints":[{
                    "startTimeUnixNano":"1","timeUnixNano":"2","asInt":"7"
                }]}
            }]}]}]}"#,
        );
        let Some(metric::Data::Sum(s)) = &first_metric(&req).data else {
            panic!("expected sum")
        };
        assert!(s.is_monotonic);
        assert_eq!(s.aggregation_temporality, 1);
        let v = s.data_points[0].value.as_ref().unwrap();
        assert!(matches!(v, number_data_point::Value::AsInt(7)));
    }

    #[test]
    fn gauge_with_as_double() {
        let req = parse(
            r#"{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{
                "name":"g","gauge":{"dataPoints":[{
                    "startTimeUnixNano":"1","timeUnixNano":"2","asDouble":7.5
                }]}
            }]}]}]}"#,
        );
        let Some(metric::Data::Gauge(g)) = &first_metric(&req).data else {
            panic!("expected gauge")
        };
        let v = g.data_points[0].value.as_ref().unwrap();
        match v {
            number_data_point::Value::AsDouble(d) => assert_eq!(*d, 7.5),
            _ => panic!("expected AsDouble"),
        }
    }

    #[test]
    fn summary_with_quantiles() {
        let req = parse(
            r#"{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{
                "name":"s","summary":{"dataPoints":[{
                    "startTimeUnixNano":"1","timeUnixNano":"2","count":"100","sum":100.0,
                    "quantileValues":[{"quantile":0.5,"value":50},{"quantile":0.95,"value":95}]
                }]}
            }]}]}]}"#,
        );
        let Some(metric::Data::Summary(s)) = &first_metric(&req).data else {
            panic!("expected summary")
        };
        let dp = &s.data_points[0];
        assert_eq!(dp.count, 100);
        assert_eq!(dp.sum, 100.0);
        assert_eq!(dp.quantile_values.len(), 2);
        assert_eq!(dp.quantile_values[1].quantile, 0.95);
        assert_eq!(dp.quantile_values[1].value, 95.0);
    }

    #[test]
    fn exponential_histogram_with_buckets() {
        let req = parse(
            r#"{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{
                "name":"eh","exponentialHistogram":{"aggregationTemporality":1,"dataPoints":[{
                    "startTimeUnixNano":"1","timeUnixNano":"2","count":"100","sum":100.0,
                    "scale":0,"zeroCount":"10","zeroThreshold":0.0,
                    "positive":{"offset":0,"bucketCounts":["50","30","20"]},
                    "negative":{"offset":0,"bucketCounts":["0"]}
                }]}
            }]}]}]}"#,
        );
        let Some(metric::Data::ExponentialHistogram(eh)) = &first_metric(&req).data else {
            panic!("expected exponential histogram")
        };
        let dp = &eh.data_points[0];
        assert_eq!(dp.count, 100);
        assert_eq!(dp.zero_count, 10);
        assert_eq!(dp.positive.as_ref().unwrap().bucket_counts, vec![50, 30, 20]);
        assert_eq!(dp.negative.as_ref().unwrap().bucket_counts, vec![0]);
    }

    #[test]
    fn aggregation_temporality_string_form() {
        let req = parse(
            r#"{"resourceMetrics":[{"scopeMetrics":[{"metrics":[{
                "name":"h","histogram":{
                    "aggregationTemporality":"AGGREGATION_TEMPORALITY_DELTA",
                    "dataPoints":[{"startTimeUnixNano":"1","timeUnixNano":"2","count":"0","sum":0.0}]
                }
            }]}]}]}"#,
        );
        let Some(metric::Data::Histogram(h)) = &first_metric(&req).data else {
            panic!()
        };
        assert_eq!(h.aggregation_temporality, AggregationTemporality::Delta as i32);
    }

    #[test]
    fn attributes_round_trip() {
        let req = parse(
            r#"{"resourceMetrics":[{
                "resource":{"attributes":[{"key":"service.name","value":{"stringValue":"app"}}]},
                "scopeMetrics":[{
                    "scope":{"name":"lib","version":"1.0"},
                    "metrics":[{
                        "name":"g","gauge":{"dataPoints":[{
                            "startTimeUnixNano":"1","timeUnixNano":"2","asDouble":1.0,
                            "attributes":[
                                {"key":"k_str","value":{"stringValue":"v"}},
                                {"key":"k_int","value":{"intValue":"42"}},
                                {"key":"k_bool","value":{"boolValue":true}},
                                {"key":"k_dbl","value":{"doubleValue":3.14}}
                            ]
                        }]}
                    }]
                }]
            }]}"#,
        );
        let res = req.resource_metrics[0].resource.as_ref().unwrap();
        assert_eq!(res.attributes[0].key, "service.name");
        let scope = req.resource_metrics[0].scope_metrics[0].scope.as_ref().unwrap();
        assert_eq!(scope.name, "lib");
        let dp = match &first_metric(&req).data {
            Some(metric::Data::Gauge(g)) => &g.data_points[0],
            _ => panic!(),
        };
        assert_eq!(dp.attributes.len(), 4);
        assert!(matches!(
            dp.attributes[1].value.as_ref().unwrap().value.as_ref().unwrap(),
            any_value::Value::IntValue(42)
        ));
    }

    #[test]
    fn empty_request_is_ok() {
        let req = parse(r#"{"resourceMetrics":[]}"#);
        assert!(req.resource_metrics.is_empty());
    }

    #[test]
    fn metric_with_no_data_variant_is_ok() {
        let req = parse(
            r#"{"resourceMetrics":[{"scopeMetrics":[{"metrics":[
                {"name":"empty","description":"d","unit":"u"}
            ]}]}]}"#,
        );
        assert!(first_metric(&req).data.is_none());
    }
}
