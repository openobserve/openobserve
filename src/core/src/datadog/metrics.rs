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
//
// Portions ported from opentelemetry-collector-contrib receiver/datadogreceiver (Apache-2.0).

use std::collections::BTreeMap;

use opentelemetry_proto::tonic::{
    collector::metrics::v1::ExportMetricsServiceRequest,
    common::v1::any_value::Value,
    metrics::v1::{
        Gauge, Metric, NumberDataPoint, ResourceMetrics, ScopeMetrics, metric::Data,
        number_data_point,
    },
};
use prost::Message;
use proto::datadog_agentpayload::{
    MetricPayload,
    metric_payload::{MetricSeries, MetricType},
};
use serde::Deserialize;

use super::{
    DatadogError, ExpansionBudget, RECORD_BYTES, attributes_bytes, resource_bytes,
    tags::{HOST_NAME, SplitTags, key_value, resource, string_kv, to_key_values},
};

const NANOS_PER_SECOND: i64 = 1_000_000_000;
const METRIC_TYPE_ATTR: &str = "datadog_metric_type";
const INTERVAL_ATTR: &str = "datadog_interval";

#[derive(Debug, Deserialize)]
struct CheckRun {
    check: String,
    #[serde(default)]
    host_name: Option<String>,
    status: i64,
    #[serde(default)]
    timestamp: i64,
    #[serde(default)]
    tags: Option<Vec<String>>,
}

/// Translates a v2 `MetricPayload` into gauges that keep the sent value and Datadog type.
pub fn series_to_otlp(body: &[u8]) -> Result<ExportMetricsServiceRequest, DatadogError> {
    let payload = MetricPayload::decode(body).map_err(|e| DatadogError::Decode(e.to_string()))?;
    let mut budget = ExpansionBudget::new(body);
    Ok(ExportMetricsServiceRequest {
        resource_metrics: payload
            .series
            .into_iter()
            .filter_map(|series| series_to_resource_metrics(series, &mut budget).transpose())
            .collect::<Result<_, _>>()?,
    })
}

/// Translates `/api/v1/check_run` JSON (an array or one object) into a 0-3 status gauge per check.
pub fn check_runs_to_otlp(body: &[u8]) -> Result<ExportMetricsServiceRequest, DatadogError> {
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|e| DatadogError::Decode(e.to_string()))?;
    let values = match value {
        serde_json::Value::Array(values) => values,
        object @ serde_json::Value::Object(_) => vec![object],
        _ => {
            return Err(DatadogError::Decode(
                "check_run body is not JSON object or array".into(),
            ));
        }
    };
    let resource_metrics = values
        .into_iter()
        .map(|v| {
            serde_json::from_value::<CheckRun>(v)
                .map(check_run_to_resource_metrics)
                .map_err(|e| DatadogError::Decode(e.to_string()))
        })
        .collect::<Result<_, _>>()?;
    Ok(ExportMetricsServiceRequest { resource_metrics })
}

pub(super) fn resource_metrics(
    attributes: BTreeMap<String, String>,
    metric: Metric,
) -> ResourceMetrics {
    ResourceMetrics {
        resource: Some(resource(attributes)),
        scope_metrics: vec![ScopeMetrics {
            metrics: vec![metric],
            ..Default::default()
        }],
        ..Default::default()
    }
}

pub(super) fn seconds_to_nanos(seconds: i64) -> u64 {
    // Agent timestamps are positive Unix seconds; a negative one has no u64 form and becomes 0.
    u64::try_from(seconds.saturating_mul(NANOS_PER_SECOND)).unwrap_or(0)
}

fn series_to_resource_metrics(
    series: MetricSeries,
    budget: &mut ExpansionBudget,
) -> Result<Option<ResourceMetrics>, DatadogError> {
    budget.charge(RECORD_BYTES, 1)?;
    let metric_type = match MetricType::try_from(series.r#type) {
        Ok(MetricType::Gauge) => "gauge",
        Ok(MetricType::Count) => "count",
        Ok(MetricType::Rate) => "rate",
        Ok(MetricType::Unspecified) | Err(_) => {
            log::warn!(
                "[DATADOG] dropping series {} with unspecified type {}",
                series.metric,
                series.r#type
            );
            return Ok(None);
        }
    };
    let tags = SplitTags::from_tags(series.tags.iter().map(String::as_str));
    let mut resource_attrs = tags.resource;
    for res in series.resources {
        let key = if res.r#type == "host" {
            HOST_NAME.to_string()
        } else {
            res.r#type
        };
        resource_attrs.insert(key, res.name);
    }
    let mut attributes = to_key_values(tags.attributes);
    attributes.push(string_kv(METRIC_TYPE_ATTR, metric_type));
    attributes.push(key_value(INTERVAL_ATTR, Value::IntValue(series.interval)));
    // Downstream OTLP ingest copies the resource onto every point as well.
    let point_bytes = attributes_bytes(&attributes) + resource_bytes(&resource_attrs);
    budget.charge(point_bytes, series.points.len())?;
    let data_points = series
        .points
        .iter()
        .map(|point| NumberDataPoint {
            attributes: attributes.clone(),
            time_unix_nano: seconds_to_nanos(point.timestamp),
            value: Some(number_data_point::Value::AsDouble(point.value)),
            ..Default::default()
        })
        .collect();
    let metric = Metric {
        name: series.metric,
        unit: series.unit,
        data: Some(Data::Gauge(Gauge { data_points })),
        ..Default::default()
    };
    Ok(Some(resource_metrics(resource_attrs, metric)))
}

fn check_run_to_resource_metrics(check: CheckRun) -> ResourceMetrics {
    let tags = SplitTags::from_tags(check.tags.iter().flatten().map(String::as_str));
    let mut resource_attrs = tags.resource;
    if let Some(host) = check.host_name.filter(|h| !h.is_empty()) {
        resource_attrs.insert(HOST_NAME.to_string(), host);
    }
    let data_point = NumberDataPoint {
        attributes: to_key_values(tags.attributes),
        time_unix_nano: seconds_to_nanos(check.timestamp),
        value: Some(number_data_point::Value::AsInt(check.status)),
        ..Default::default()
    };
    let metric = Metric {
        name: check.check,
        data: Some(Data::Gauge(Gauge {
            data_points: vec![data_point],
        })),
        ..Default::default()
    };
    resource_metrics(resource_attrs, metric)
}

#[cfg(test)]
mod tests {
    use opentelemetry_proto::tonic::common::v1::KeyValue;
    use proto::datadog_agentpayload::metric_payload::{MetricPoint, Resource};

    use super::*;

    fn series(name: &str, metric_type: MetricType, interval: i64) -> MetricSeries {
        MetricSeries {
            resources: vec![Resource {
                r#type: "host".into(),
                name: "web-1".into(),
            }],
            metric: name.into(),
            tags: vec!["env:prod".into(), "endpoint:/cart".into()],
            points: vec![MetricPoint {
                value: 2.5,
                timestamp: 1_700_000_000,
            }],
            r#type: metric_type as i32,
            interval,
            ..Default::default()
        }
    }

    fn attr<'a>(attrs: &'a [KeyValue], key: &str) -> Option<&'a Value> {
        attrs
            .iter()
            .find(|kv| kv.key == key)
            .and_then(|kv| kv.value.as_ref())
            .and_then(|v| v.value.as_ref())
    }

    fn gauge_point(metric: &Metric) -> &NumberDataPoint {
        match &metric.data {
            Some(Data::Gauge(g)) => &g.data_points[0],
            other => panic!("expected gauge, got {other:?}"),
        }
    }

    #[test]
    fn test_series_types_become_gauges_with_type_interval_and_host() {
        let payload = MetricPayload {
            series: vec![
                series("system.load.1", MetricType::Gauge, 0),
                series("requests.count", MetricType::Count, 10),
                series("requests.rate", MetricType::Rate, 10),
                series("unknown", MetricType::Unspecified, 10),
            ],
        };
        let req = series_to_otlp(&payload.encode_to_vec()).unwrap();
        assert_eq!(req.resource_metrics.len(), 3);
        let expected = [("gauge", 0), ("count", 10), ("rate", 10)];
        for (rm, (metric_type, interval)) in req.resource_metrics.iter().zip(expected) {
            let res = &rm.resource.as_ref().unwrap().attributes;
            assert_eq!(
                attr(res, HOST_NAME),
                Some(&Value::StringValue("web-1".into()))
            );
            assert_eq!(
                attr(res, "deployment.environment.name"),
                Some(&Value::StringValue("prod".into()))
            );
            let dp = gauge_point(&rm.scope_metrics[0].metrics[0]);
            assert_eq!(dp.value, Some(number_data_point::Value::AsDouble(2.5)));
            assert_eq!(dp.time_unix_nano, 1_700_000_000_000_000_000);
            assert_eq!(
                attr(&dp.attributes, METRIC_TYPE_ATTR),
                Some(&Value::StringValue(metric_type.into()))
            );
            assert_eq!(
                attr(&dp.attributes, INTERVAL_ATTR),
                Some(&Value::IntValue(interval))
            );
            assert_eq!(
                attr(&dp.attributes, "endpoint"),
                Some(&Value::StringValue("/cart".into()))
            );
        }
    }

    #[test]
    fn test_series_rejects_garbage() {
        assert!(series_to_otlp(b"\xff\xff\xff").is_err());
    }

    #[test]
    fn test_many_tags_on_many_points_past_the_size_budget_are_rejected() {
        let mut many = series("m", MetricType::Gauge, 10);
        many.tags = (0..50)
            .map(|i| format!("tag{i}:{}", "v".repeat(50)))
            .collect();
        many.points = vec![
            MetricPoint {
                value: 1.0,
                timestamp: 1
            };
            5000
        ];
        let body = MetricPayload { series: vec![many] }.encode_to_vec();
        let err = series_to_otlp(&body).unwrap_err();
        assert!(err.to_string().contains("size budget"), "{err}");
    }

    #[test]
    fn test_a_series_without_points_is_still_charged() {
        let empty = MetricSeries {
            r#type: MetricType::Gauge as i32,
            ..Default::default()
        };
        let mut budget = ExpansionBudget(RECORD_BYTES * 3);
        for _ in 0..3 {
            series_to_resource_metrics(empty.clone(), &mut budget).unwrap();
        }
        assert!(series_to_resource_metrics(empty, &mut budget).is_err());
    }

    #[test]
    fn test_a_large_resource_on_many_points_past_the_size_budget_is_rejected() {
        let mut many = series("m", MetricType::Gauge, 10);
        many.tags = vec![];
        many.resources.push(Resource {
            r#type: "region".into(),
            name: "r".repeat(64 * 1024),
        });
        many.points = vec![
            MetricPoint {
                value: 1.0,
                timestamp: 1
            };
            2000
        ];
        let body = MetricPayload { series: vec![many] }.encode_to_vec();
        let err = series_to_otlp(&body).unwrap_err();
        assert!(err.to_string().contains("size budget"), "{err}");
    }

    #[test]
    fn test_check_run_with_only_host_name() {
        let body = br#"[{"check":"datadog.agent.up","host_name":"web-1","status":2,"timestamp":1700000000,"tags":null,"message":""}]"#;
        let req = check_runs_to_otlp(body).unwrap();
        let rm = &req.resource_metrics[0];
        let res = &rm.resource.as_ref().unwrap().attributes;
        assert_eq!(res.len(), 1);
        assert_eq!(
            attr(res, HOST_NAME),
            Some(&Value::StringValue("web-1".into()))
        );
        let metric = &rm.scope_metrics[0].metrics[0];
        assert_eq!(metric.name, "datadog.agent.up");
        let dp = gauge_point(metric);
        assert_eq!(dp.value, Some(number_data_point::Value::AsInt(2)));
        assert!(dp.attributes.is_empty());
    }

    #[test]
    fn test_check_run_single_object_with_tags() {
        let body = br#"{"check":"http.can_connect","status":0,"timestamp":1700000000,"tags":["env:prod","url:http://x"]}"#;
        let req = check_runs_to_otlp(body).unwrap();
        let dp = gauge_point(&req.resource_metrics[0].scope_metrics[0].metrics[0]);
        assert_eq!(
            attr(&dp.attributes, "url"),
            Some(&Value::StringValue("http://x".into()))
        );
        assert!(check_runs_to_otlp(b"\"nope\"").is_err());
        assert!(check_runs_to_otlp(b"[{\"status\":1}]").is_err());
    }
}
