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

//! Normalizes OTLP/JSON metric payloads (proto3 JSON mapping, as sent by the
//! otel-collector with `encoding: json`) into the shape accepted by the serde
//! derives of `opentelemetry-proto` 0.32.
//!
//! The proto3 JSON mapping encodes 64-bit integers as strings, allows enum
//! values by name, and omits zero/empty fields. The serde derives only
//! partially implement this mapping; because `Metric.data` is a flattened
//! `Option` oneof, every gap below makes the whole metric silently
//! deserialize as `data: None` (or a value as 0) instead of failing the
//! request — see <https://github.com/openobserve/openobserve/issues/12345>.
//! Gaps in 0.32, each covered by a function here:
//! - `NumberDataPoint`/`Exemplar` reject string-encoded `asInt` values
//! - `aggregationTemporality` rejects enum names
//! - `ExponentialHistogramDataPoint`, `Buckets`, `ValueAtQuantile` and `Exemplar` lack
//!   `serde(default)`, rejecting omitted zero/empty fields
//! - `Exemplar`'s value oneof is not flattened, so a spec-form top-level `asInt`/`asDouble` key is
//!   ignored

use config::utils::json;

/// Normalizes an `ExportMetricsServiceRequest` JSON body in place.
/// Lenient by design: unrecognized shapes are left untouched and surface as
/// deserialization errors (HTTP 400) later.
pub fn normalize(body: &mut json::Value) {
    let resource_metrics = match body
        .get_mut("resourceMetrics")
        .and_then(|v| v.as_array_mut())
    {
        Some(v) => v,
        None => return,
    };
    for resource_metric in resource_metrics {
        let scope_metrics = match resource_metric
            .get_mut("scopeMetrics")
            .and_then(|v| v.as_array_mut())
        {
            Some(v) => v,
            None => continue,
        };
        for scope_metric in scope_metrics {
            if let Some(metrics) = scope_metric
                .get_mut("metrics")
                .and_then(|v| v.as_array_mut())
            {
                for metric in metrics {
                    normalize_metric(metric);
                }
            }
        }
    }
}

fn normalize_metric(metric: &mut json::Value) {
    if let Some(gauge) = metric.get_mut("gauge") {
        normalize_number_data_points(gauge);
    }
    if let Some(sum) = metric.get_mut("sum") {
        normalize_temporality(sum);
        normalize_number_data_points(sum);
    }
    if let Some(histogram) = metric.get_mut("histogram") {
        normalize_temporality(histogram);
        if let Some(points) = data_points_mut(histogram) {
            for point in points {
                normalize_exemplars(point);
            }
        }
    }
    if let Some(exp_histogram) = metric.get_mut("exponentialHistogram") {
        normalize_temporality(exp_histogram);
        if let Some(points) = data_points_mut(exp_histogram) {
            for point in points {
                normalize_exp_hist_data_point(point);
            }
        }
    }
    if let Some(summary) = metric.get_mut("summary")
        && let Some(points) = data_points_mut(summary)
    {
        for point in points {
            normalize_summary_data_point(point);
        }
    }
}

fn data_points_mut(data: &mut json::Value) -> Option<&mut Vec<json::Value>> {
    data.get_mut("dataPoints").and_then(|v| v.as_array_mut())
}

fn normalize_temporality(data: &mut json::Value) {
    if let Some(temporality) = data.get_mut("aggregationTemporality")
        && let Some(name) = temporality.as_str()
    {
        let num = match name {
            "AGGREGATION_TEMPORALITY_UNSPECIFIED" => 0,
            "AGGREGATION_TEMPORALITY_DELTA" => 1,
            "AGGREGATION_TEMPORALITY_CUMULATIVE" => 2,
            _ => return,
        };
        *temporality = json::Value::from(num);
    }
}

fn normalize_number_data_points(data: &mut json::Value) {
    if let Some(points) = data_points_mut(data) {
        for point in points {
            normalize_as_int(point);
            normalize_exemplars(point);
        }
    }
}

fn normalize_as_int(point: &mut json::Value) {
    if let Some(value) = point.get_mut("asInt")
        && let Some(s) = value.as_str()
        && let Ok(num) = s.parse::<i64>()
    {
        *value = json::Value::from(num);
    }
}

fn normalize_exemplars(point: &mut json::Value) {
    if let Some(exemplars) = point.get_mut("exemplars").and_then(|v| v.as_array_mut()) {
        for exemplar in exemplars {
            normalize_exemplar(exemplar);
        }
    }
}

fn normalize_exemplar(exemplar: &mut json::Value) {
    let Some(obj) = exemplar.as_object_mut() else {
        return;
    };
    // the value oneof is not flattened on `Exemplar`, move it into `value`
    if let Some(value) = obj.remove("asInt") {
        let value = match value.as_str().and_then(|s| s.parse::<i64>().ok()) {
            Some(num) => json::Value::from(num),
            None => value,
        };
        obj.insert("value".to_string(), json::json!({ "asInt": value }));
    } else if let Some(value) = obj.remove("asDouble") {
        obj.insert("value".to_string(), json::json!({ "asDouble": value }));
    }
    // no serde(default): omitted empty fields are rejected as missing
    obj.entry("filteredAttributes").or_insert(json::json!([]));
    obj.entry("timeUnixNano").or_insert(json::json!(0));
    obj.entry("spanId").or_insert(json::json!(""));
    obj.entry("traceId").or_insert(json::json!(""));
}

fn normalize_exp_hist_data_point(point: &mut json::Value) {
    normalize_exemplars(point);
    if let Some(obj) = point.as_object_mut() {
        // no serde(default): omitted zero/empty fields are rejected as missing
        obj.entry("attributes").or_insert(json::json!([]));
        obj.entry("startTimeUnixNano").or_insert(json::json!(0));
        obj.entry("timeUnixNano").or_insert(json::json!(0));
        obj.entry("count").or_insert(json::json!(0));
        obj.entry("zeroCount").or_insert(json::json!(0));
        obj.entry("scale").or_insert(json::json!(0));
        obj.entry("flags").or_insert(json::json!(0));
        obj.entry("exemplars").or_insert(json::json!([]));
        obj.entry("zeroThreshold").or_insert(json::json!(0.0));
    }
    for key in ["positive", "negative"] {
        if let Some(buckets) = point.get_mut(key).and_then(|v| v.as_object_mut()) {
            buckets.entry("offset").or_insert(json::json!(0));
            buckets.entry("bucketCounts").or_insert(json::json!([]));
        }
    }
}

fn normalize_summary_data_point(point: &mut json::Value) {
    if let Some(quantiles) = point
        .get_mut("quantileValues")
        .and_then(|v| v.as_array_mut())
    {
        for quantile in quantiles {
            if let Some(obj) = quantile.as_object_mut() {
                // no serde(default) on ValueAtQuantile: the 0-quantile is
                // omitted as a zero value and would drop the whole metric
                obj.entry("quantile").or_insert(json::json!(0.0));
                obj.entry("value").or_insert(json::json!(0.0));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use opentelemetry_proto::tonic::{
        collector::metrics::v1::ExportMetricsServiceRequest,
        metrics::v1::{exemplar, metric::Data, number_data_point},
    };

    use super::*;

    fn parse(metric_json: &str) -> Data {
        let mut body = json::json!({
            "resourceMetrics": [{
                "resource": {
                    "attributes": [
                        {"key": "service.name", "value": {"stringValue": "test"}}
                    ]
                },
                "scopeMetrics": [{
                    "scope": {"name": "test"},
                    "metrics": [json::from_str::<json::Value>(metric_json).unwrap()]
                }]
            }]
        });
        normalize(&mut body);
        let request: ExportMetricsServiceRequest = json::from_value(body).unwrap();
        request.resource_metrics[0].scope_metrics[0].metrics[0]
            .data
            .clone()
            .expect("metric data should deserialize")
    }

    #[test]
    fn test_histogram_with_string_integers() {
        let data = parse(
            r#"{"name":"h","histogram":{"aggregationTemporality":1,"dataPoints":[{
                "startTimeUnixNano":"1700000000000000000",
                "timeUnixNano":"1700000005000000000",
                "count":"5","sum":2500,"bucketCounts":["1","2","2"],"explicitBounds":[100,500]
            }]}}"#,
        );
        let Data::Histogram(hist) = data else {
            panic!("expected histogram, got {data:?}");
        };
        let point = &hist.data_points[0];
        assert_eq!(point.count, 5);
        assert_eq!(point.sum, Some(2500.0));
        assert_eq!(point.bucket_counts, vec![1, 2, 2]);
        assert_eq!(point.explicit_bounds, vec![100.0, 500.0]);
    }

    #[test]
    fn test_temporality_as_enum_name() {
        let data = parse(
            r#"{"name":"h","histogram":{"aggregationTemporality":"AGGREGATION_TEMPORALITY_DELTA","dataPoints":[{
                "timeUnixNano":"1700000005000000000","count":"5","bucketCounts":["5"]
            }]}}"#,
        );
        let Data::Histogram(hist) = data else {
            panic!("expected histogram, got {data:?}");
        };
        assert_eq!(hist.aggregation_temporality, 1);
    }

    #[test]
    fn test_sum_with_string_as_int() {
        let data = parse(
            r#"{"name":"c","sum":{"aggregationTemporality":2,"isMonotonic":true,"dataPoints":[{
                "timeUnixNano":"1700000005000000000","asInt":"42"
            }]}}"#,
        );
        let Data::Sum(sum) = data else {
            panic!("expected sum, got {data:?}");
        };
        assert_eq!(
            sum.data_points[0].value,
            Some(number_data_point::Value::AsInt(42))
        );
    }

    #[test]
    fn test_gauge_with_double_value() {
        let data = parse(
            r#"{"name":"g","gauge":{"dataPoints":[{
                "timeUnixNano":"1700000005000000000","asDouble":3.25
            }]}}"#,
        );
        let Data::Gauge(gauge) = data else {
            panic!("expected gauge, got {data:?}");
        };
        assert_eq!(
            gauge.data_points[0].value,
            Some(number_data_point::Value::AsDouble(3.25))
        );
    }

    #[test]
    fn test_exponential_histogram_with_omitted_fields() {
        let data = parse(
            r#"{"name":"e","exponentialHistogram":{"aggregationTemporality":1,"dataPoints":[{
                "timeUnixNano":"1700000005000000000","count":"5","zeroCount":"1","scale":2,
                "positive":{"bucketCounts":["1","3","1"]}
            }]}}"#,
        );
        let Data::ExponentialHistogram(hist) = data else {
            panic!("expected exponential histogram, got {data:?}");
        };
        let point = &hist.data_points[0];
        assert_eq!(point.count, 5);
        assert_eq!(point.zero_count, 1);
        assert_eq!(point.scale, 2);
        let positive = point.positive.as_ref().unwrap();
        assert_eq!(positive.offset, 0);
        assert_eq!(positive.bucket_counts, vec![1, 3, 1]);
    }

    #[test]
    fn test_summary_with_zero_quantile_omitted() {
        let data = parse(
            r#"{"name":"s","summary":{"dataPoints":[{
                "timeUnixNano":"1700000005000000000","count":"5","sum":10,
                "quantileValues":[{"value":1},{"quantile":0.99,"value":2}]
            }]}}"#,
        );
        let Data::Summary(summary) = data else {
            panic!("expected summary, got {data:?}");
        };
        let point = &summary.data_points[0];
        assert_eq!(point.count, 5);
        assert_eq!(point.quantile_values[0].quantile, 0.0);
        assert_eq!(point.quantile_values[0].value, 1.0);
        assert_eq!(point.quantile_values[1].quantile, 0.99);
    }

    #[test]
    fn test_histogram_exemplar_spec_form() {
        let data = parse(
            r#"{"name":"h","histogram":{"aggregationTemporality":1,"dataPoints":[{
                "timeUnixNano":"1700000005000000000","count":"5","bucketCounts":["5"],
                "exemplars":[{"timeUnixNano":"1700000005000000000","asInt":"7"}]
            }]}}"#,
        );
        let Data::Histogram(hist) = data else {
            panic!("expected histogram, got {data:?}");
        };
        assert_eq!(
            hist.data_points[0].exemplars[0].value,
            Some(exemplar::Value::AsInt(7))
        );
    }

    #[test]
    fn test_exemplar_with_trace_context() {
        let data = parse(
            r#"{"name":"h","histogram":{"aggregationTemporality":1,"dataPoints":[{
                "timeUnixNano":"1700000005000000000","count":"5","bucketCounts":["5"],
                "exemplars":[{
                    "filteredAttributes":[{"key":"k","value":{"stringValue":"v"}}],
                    "timeUnixNano":"1700000005000000000",
                    "spanId":"eee19b7ec3c1b174",
                    "traceId":"5b8efff798038103d269b633813fc60c",
                    "asDouble":7.5
                }]
            }]}}"#,
        );
        let Data::Histogram(hist) = data else {
            panic!("expected histogram, got {data:?}");
        };
        let exemplar = &hist.data_points[0].exemplars[0];
        assert_eq!(exemplar.value, Some(exemplar::Value::AsDouble(7.5)));
        assert_eq!(exemplar.span_id.len(), 8);
        assert_eq!(exemplar.trace_id.len(), 16);
    }

    #[test]
    fn test_already_normalized_payload_unchanged() {
        let data = parse(
            r#"{"name":"h","histogram":{"aggregationTemporality":2,"dataPoints":[{
                "timeUnixNano":"1700000005000000000","count":5,"sum":2500,
                "bucketCounts":[1,2,2],"explicitBounds":[100,500]
            }]}}"#,
        );
        let Data::Histogram(hist) = data else {
            panic!("expected histogram, got {data:?}");
        };
        assert_eq!(hist.data_points[0].count, 5);
        assert_eq!(hist.aggregation_temporality, 2);
    }

    #[test]
    fn test_malformed_input_does_not_panic() {
        for input in [
            r#"{}"#,
            r#"{"resourceMetrics": "not-an-array"}"#,
            r#"{"resourceMetrics": [{"scopeMetrics": [{"metrics": ["not-an-object"]}]}]}"#,
            r#"{"resourceMetrics": [{"scopeMetrics": [{"metrics": [{"histogram": {"dataPoints": "bad"}}]}]}]}"#,
        ] {
            let mut body = json::from_str::<json::Value>(input).unwrap();
            normalize(&mut body);
        }
    }
}
