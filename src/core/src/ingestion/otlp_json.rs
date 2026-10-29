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

use config::utils::json;
use opentelemetry_proto::tonic::{
    collector::{
        logs::v1::ExportLogsServiceRequest, metrics::v1::ExportMetricsServiceRequest,
        trace::v1::ExportTraceServiceRequest,
    },
    common::v1::{AnyValue, InstrumentationScope, KeyValue, any_value::Value},
    metrics::v1::{Exemplar, metric::Data},
    resource::v1::Resource,
};

/// Turns the empty array slots `json::normalize_otlp_empty_values` marked back into empty values.
pub fn restore_logs_empty_slots(request: &mut ExportLogsServiceRequest) {
    for resource_logs in &mut request.resource_logs {
        restore_resource(resource_logs.resource.as_mut());
        for scope_logs in &mut resource_logs.scope_logs {
            restore_scope(scope_logs.scope.as_mut());
            for record in &mut scope_logs.log_records {
                restore_key_values(&mut record.attributes);
                if let Some(body) = &mut record.body {
                    restore_any_value(body);
                }
            }
        }
    }
}

/// Turns the empty array slots `json::normalize_otlp_empty_values` marked back into empty values.
pub fn restore_traces_empty_slots(request: &mut ExportTraceServiceRequest) {
    for resource_spans in &mut request.resource_spans {
        restore_resource(resource_spans.resource.as_mut());
        for scope_spans in &mut resource_spans.scope_spans {
            restore_scope(scope_spans.scope.as_mut());
            for span in &mut scope_spans.spans {
                restore_key_values(&mut span.attributes);
                for event in &mut span.events {
                    restore_key_values(&mut event.attributes);
                }
                for link in &mut span.links {
                    restore_key_values(&mut link.attributes);
                }
            }
        }
    }
}

/// Turns the empty array slots `json::normalize_otlp_empty_values` marked back into empty values.
pub fn restore_metrics_empty_slots(request: &mut ExportMetricsServiceRequest) {
    for resource_metrics in &mut request.resource_metrics {
        restore_resource(resource_metrics.resource.as_mut());
        for scope_metrics in &mut resource_metrics.scope_metrics {
            restore_scope(scope_metrics.scope.as_mut());
            for metric in &mut scope_metrics.metrics {
                restore_key_values(&mut metric.metadata);
                if let Some(data) = &mut metric.data {
                    restore_metric_data(data);
                }
            }
        }
    }
}

fn restore_metric_data(data: &mut Data) {
    match data {
        Data::Gauge(gauge) => gauge.data_points.iter_mut().for_each(|point| {
            restore_key_values(&mut point.attributes);
            restore_exemplars(&mut point.exemplars);
        }),
        Data::Sum(sum) => sum.data_points.iter_mut().for_each(|point| {
            restore_key_values(&mut point.attributes);
            restore_exemplars(&mut point.exemplars);
        }),
        Data::Histogram(histogram) => histogram.data_points.iter_mut().for_each(|point| {
            restore_key_values(&mut point.attributes);
            restore_exemplars(&mut point.exemplars);
        }),
        Data::ExponentialHistogram(histogram) => {
            histogram.data_points.iter_mut().for_each(|point| {
                restore_key_values(&mut point.attributes);
                restore_exemplars(&mut point.exemplars);
            })
        }
        Data::Summary(summary) => summary
            .data_points
            .iter_mut()
            .for_each(|point| restore_key_values(&mut point.attributes)),
    }
}

fn restore_exemplars(exemplars: &mut [Exemplar]) {
    for exemplar in exemplars {
        restore_key_values(&mut exemplar.filtered_attributes);
    }
}

fn restore_resource(resource: Option<&mut Resource>) {
    if let Some(resource) = resource {
        restore_key_values(&mut resource.attributes);
    }
}

fn restore_scope(scope: Option<&mut InstrumentationScope>) {
    if let Some(scope) = scope {
        restore_key_values(&mut scope.attributes);
    }
}

fn restore_key_values(key_values: &mut [KeyValue]) {
    for key_value in key_values {
        if let Some(value) = &mut key_value.value {
            restore_any_value(value);
        }
    }
}

fn restore_any_value(any_value: &mut AnyValue) {
    match &mut any_value.value {
        Some(Value::ArrayValue(array)) => {
            for item in &mut array.values {
                if let Some(Value::StringValue(value)) = &mut item.value
                    && json::restore_otlp_array_string(value)
                {
                    item.value = None;
                }
                restore_any_value(item);
            }
        }
        Some(Value::KvlistValue(list)) => restore_key_values(&mut list.values),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ingestion::grpc::get_val_with_type_retained;

    #[test]
    fn test_logs_keep_empty_array_slots() {
        let body = br#"{"resourceLogs":[{"resource":{"attributes":[{"key":"r","value":{"arrayValue":{"values":[{},{"stringValue":"a"}]}}}]},"scopeLogs":[{"scope":{"attributes":[{"key":"s","value":{"arrayValue":{"values":[{"intValue":"1"},{}]}}}]},"logRecords":[{"body":{"arrayValue":{"values":[{"intValue":"1"},{},{"intValue":"3"}]}},"attributes":[{"key":"nested","value":{"kvlistValue":{"values":[{"key":"list","value":{"arrayValue":{"values":[{"arrayValue":{"values":[{},{"stringValue":"\u0000"}]}},{"stringValue":"\u0000x"}]}}}]}}}]}]}]}]}"#;
        assert!(json::from_slice::<ExportLogsServiceRequest>(body).is_err());

        let request: ExportLogsServiceRequest =
            json::from_slice_lenient_otlp(body, restore_logs_empty_slots).unwrap();
        let resource_logs = &request.resource_logs[0];
        let value = |kv: &KeyValue| get_val_with_type_retained(&kv.value.as_ref());
        assert_eq!(
            value(&resource_logs.resource.as_ref().unwrap().attributes[0]),
            json::json!([null, "a"])
        );
        let scope_logs = &resource_logs.scope_logs[0];
        assert_eq!(
            value(&scope_logs.scope.as_ref().unwrap().attributes[0]),
            json::json!([1, null])
        );
        let record = &scope_logs.log_records[0];
        assert_eq!(
            get_val_with_type_retained(&record.body.as_ref()),
            json::json!([1, null, 3])
        );
        assert_eq!(
            value(&record.attributes[0]),
            json::json!({"list": [[null, "\u{0}"], "\u{0}x"]})
        );
    }

    #[test]
    fn test_traces_keep_empty_array_slots() {
        let body = br#"{"resourceSpans":[{"scopeSpans":[{"spans":[{"traceId":"5b8efff798038103d269b633813fc60c","spanId":"0123456789abcdef","name":"s","attributes":[{"key":"a","value":{"arrayValue":{"values":[{"intValue":"1"},{}]}}}],"events":[{"name":"e","attributes":[{"key":"b","value":{"arrayValue":{"values":[{}]}}}]}],"links":[{"traceId":"5b8efff798038103d269b633813fc60c","spanId":"0123456789abcdee","attributes":[{"key":"c","value":{"arrayValue":{"values":[{},{"boolValue":true}]}}}]}]}]}]}]}"#;
        let request: ExportTraceServiceRequest =
            json::from_slice_lenient_otlp(body, restore_traces_empty_slots).unwrap();
        let span = &request.resource_spans[0].scope_spans[0].spans[0];
        let value = |kv: &KeyValue| get_val_with_type_retained(&kv.value.as_ref());
        assert_eq!(value(&span.attributes[0]), json::json!([1, null]));
        assert_eq!(value(&span.events[0].attributes[0]), json::json!([null]));
        assert_eq!(
            value(&span.links[0].attributes[0]),
            json::json!([null, true])
        );
    }
}
