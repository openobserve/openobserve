// Copyright 2023 Zinc Labs Inc.
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

use actix_web::{http, web, HttpResponse};
use ahash::AHashMap;
use bytes::BytesMut;
use chrono::Utc;
use datafusion::arrow::datatypes::Schema;
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::{
    collector::metrics::v1::{ExportMetricsServiceRequest, ExportMetricsServiceResponse},
    metrics::v1::*,
};
use prost::Message;

use super::{format_label_name, get_exclude_labels, otlp_grpc::handle_grpc_request};
use crate::handler::http::request::CONTENT_TYPE_JSON;
use crate::service::{
    db,
    ingestion::{chk_schema_by_record, grpc::get_val_for_attr, write_file},
    schema::{set_schema_metadata, stream_schema_exists},
    stream::unwrap_partition_time_level,
    usage::report_request_usage_stats,
};
use crate::{
    common::{
        infra::{cluster, config::CONFIG, metrics},
        meta::{
            self,
            alert::{Alert, Trigger},
            http::HttpResponse as MetaHttpResponse,
            prom::{self, MetricType, HASH_LABEL, METADATA_LABEL, NAME_LABEL, VALUE_LABEL},
            stream::{PartitioningDetails, StreamParams},
            usage::UsageType,
            StreamType,
        },
        utils::{flatten, json},
    },
    service::format_stream_name,
};

const SERVICE: &str = "service";

pub async fn metrics_proto_handler(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
) -> Result<HttpResponse, std::io::Error> {
    let request = ExportMetricsServiceRequest::decode(body).expect("Invalid protobuf");
    match handle_grpc_request(org_id, thread_id, request, false).await {
        Ok(res) => Ok(res),
        Err(e) => {
            log::error!("error processing request: {}", e);
            Ok(
                HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                    http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                    e.to_string(),
                )),
            )
        }
    }
}

pub async fn metrics_json_handler(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
) -> Result<HttpResponse, std::io::Error> {
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )),
        );
    }

    if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id) {
        return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            http::StatusCode::FORBIDDEN.into(),
            "Quota exceeded for this organization".to_string(),
        )));
    }

    let start = std::time::Instant::now();
    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let mut metric_data_map: AHashMap<String, AHashMap<String, Vec<String>>> = AHashMap::new();
    let mut metric_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut stream_trigger_map: AHashMap<String, Trigger> = AHashMap::new();
    let mut stream_partitioning_map: AHashMap<String, PartitioningDetails> = AHashMap::new();

    let body: json::Value = match json::from_slice(body.as_ref()) {
        Ok(v) => v,
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                format!("Invalid json: {}", e),
            )))
        }
    };

    let res_metrics = match body.get("resourceMetrics") {
        Some(v) => match v.as_array() {
            Some(v) => v,
            None => {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    "Invalid json: the structure must be {{\"resourceMetrics\":[]}}".to_string(),
                )))
            }
        },
        None => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                "Invalid json: the structure must be {{\"resourceMetrics\":[]}}".to_string(),
            )))
        }
    };

    for res_metric in res_metrics.iter() {
        let mut service_att_map: json::Map<String, json::Value> = json::Map::new();
        if res_metric.get("resource").is_some() {
            let resource = res_metric.get("resource").unwrap().as_object().unwrap();
            if resource.get("attributes").is_some() {
                let attributes = resource.get("attributes").unwrap().as_array().unwrap();
                for res_attr in attributes {
                    let local_attr = res_attr.as_object().unwrap();

                    service_att_map.insert(
                        format!(
                            "{}_{}",
                            SERVICE,
                            format_label_name(local_attr.get("key").unwrap().as_str().unwrap())
                        ),
                        get_val_for_attr(local_attr.get("value").unwrap().clone()),
                    );
                }
            }
        }
        let scope_resources = res_metric.get("scopeMetrics");
        let inst_resources = if let Some(v) = scope_resources {
            v.as_array().unwrap()
        } else {
            continue;
        };
        for inst_metrics in inst_resources {
            if inst_metrics.get("metrics").is_some() {
                let metrics = inst_metrics.get("metrics").unwrap().as_array().unwrap();
                for metric in metrics {
                    // parse metadata
                    let metric_name =
                        &format_stream_name(metric.get("name").unwrap().as_str().unwrap());

                    // check for schema
                    let schema_exists = stream_schema_exists(
                        org_id,
                        metric_name,
                        StreamType::Metrics,
                        &mut metric_schema_map,
                    )
                    .await;

                    // get partition keys
                    if !stream_partitioning_map.contains_key(metric_name) {
                        let partition_det = crate::service::ingestion::get_stream_partition_keys(
                            metric_name,
                            &metric_schema_map,
                        )
                        .await;
                        stream_partitioning_map
                            .insert(metric_name.to_owned(), partition_det.clone());
                    }
                    let partition_det = stream_partitioning_map.get(metric_name).unwrap();
                    let partition_keys = partition_det.partition_keys.clone();
                    let partition_time_level = unwrap_partition_time_level(
                        partition_det.partition_time_level,
                        StreamType::Metrics,
                    );

                    // Start get stream alerts
                    let key = format!("{}/{}/{}", &org_id, StreamType::Metrics, metric_name);
                    crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
                    // End get stream alert

                    // Start Register Transforms for stream
                    let (local_trans, stream_vrl_map) =
                        crate::service::ingestion::register_stream_transforms(
                            org_id,
                            StreamType::Metrics,
                            metric_name,
                        );
                    // End Register Transforms for stream

                    let buf = metric_data_map.entry(metric_name.to_owned()).or_default();
                    let mut rec = json::json!({});

                    rec[NAME_LABEL] = metric_name.to_owned().into();

                    for (key, value) in &service_att_map {
                        rec[key] = value.clone();
                    }

                    if let Some(lib) = inst_metrics.get("scope") {
                        let lib = lib.as_object().unwrap();
                        if let Some(v) = lib.get("name") {
                            rec["instrumentation_library_name"] =
                                serde_json::Value::String(v.as_str().unwrap().to_string());
                        }
                        if let Some(v) = lib.get("version") {
                            rec["instrumentation_library_version"] =
                                serde_json::Value::String(v.as_str().unwrap().to_string());
                        }
                    };

                    let metadata = prom::Metadata {
                        metric_family_name: metric_name.to_owned(),
                        metric_type: MetricType::Unknown,
                        help: metric
                            .get("description")
                            .unwrap_or(&json::json!(""))
                            .as_str()
                            .unwrap()
                            .to_owned(),
                        unit: metric.get("unit").unwrap().as_str().unwrap().to_owned(),
                    };
                    let mut prom_meta: AHashMap<String, String> = AHashMap::new();

                    let records = if metric.get("sum").is_some() {
                        let sum = metric.get("sum").unwrap().as_object().unwrap();
                        process_sum(&mut rec, sum, &mut metadata.clone(), &mut prom_meta)
                    } else if metric.get("histogram").is_some() {
                        let histogram = metric.get("histogram").unwrap().as_object().unwrap();
                        process_histogram(
                            &mut rec,
                            histogram,
                            &mut metadata.clone(),
                            &mut prom_meta,
                        )
                    } else if metric.get("summary").is_some() {
                        let summary = metric.get("summary").unwrap().as_object().unwrap();
                        process_summary(&rec, summary, &mut metadata.clone(), &mut prom_meta)
                    } else if metric.get("gauge").is_some() {
                        let gauge = metric.get("gauge").unwrap().as_object().unwrap();
                        process_gauge(&mut rec, gauge, &mut metadata.clone(), &mut prom_meta)
                    } else if metric.get("exponentialHistogram").is_some() {
                        let exp = metric
                            .get("exponentialHistogram")
                            .unwrap()
                            .as_object()
                            .unwrap();
                        process_exponential_histogram(
                            &mut rec,
                            exp,
                            &mut metadata.clone(),
                            &mut prom_meta,
                        )
                    } else {
                        continue;
                    };

                    let mut extra_metadata: AHashMap<String, String> = AHashMap::new();
                    extra_metadata.insert(
                        METADATA_LABEL.to_string(),
                        json::to_string(&metadata).unwrap(),
                    );
                    set_schema_metadata(org_id, metric_name, StreamType::Metrics, extra_metadata)
                        .await
                        .unwrap();

                    if !schema_exists.has_metadata {
                        set_schema_metadata(org_id, metric_name, StreamType::Metrics, prom_meta)
                            .await
                            .unwrap();
                    }

                    for mut rec in records {
                        // flattening
                        rec = flatten::flatten(&rec).expect("failed to flatten");
                        // get json object

                        if !local_trans.is_empty() {
                            rec = crate::service::ingestion::apply_stream_transform(
                                &local_trans,
                                &rec,
                                &stream_vrl_map,
                                metric_name,
                                &mut runtime,
                            )
                            .unwrap_or(rec);
                        }

                        let val_map: &mut serde_json::Map<String, serde_json::Value> =
                            rec.as_object_mut().unwrap();

                        let timestamp = val_map
                            .get(&CONFIG.common.column_timestamp)
                            .unwrap()
                            .as_i64()
                            .unwrap_or(Utc::now().timestamp_micros());

                        let value_str = json::to_string(&val_map).unwrap();
                        chk_schema_by_record(
                            &mut metric_schema_map,
                            org_id,
                            StreamType::Metrics,
                            metric_name,
                            timestamp,
                            &value_str,
                        )
                        .await;

                        // get hour key
                        let hour_key = crate::service::ingestion::get_wal_time_key(
                            timestamp,
                            &partition_keys,
                            partition_time_level,
                            val_map,
                            None,
                        );
                        let hour_buf = buf.entry(hour_key).or_default();
                        hour_buf.push(value_str);

                        // real time alert
                        if !stream_alerts_map.is_empty() {
                            // Start check for alert trigger
                            let key =
                                format!("{}/{}/{}", &org_id, StreamType::Metrics, metric_name);
                            if let Some(alerts) = stream_alerts_map.get(&key) {
                                for alert in alerts {
                                    if alert.is_real_time {
                                        let set_trigger = meta::alert::Evaluate::evaluate(
                                            &alert.condition,
                                            val_map.clone(),
                                        );
                                        if set_trigger {
                                            stream_trigger_map.insert(
                                                metric_name.to_owned(),
                                                Trigger {
                                                    timestamp,
                                                    is_valid: true,
                                                    alert_name: alert.name.clone(),
                                                    stream: metric_name.to_owned(),
                                                    org: org_id.to_string(),
                                                    stream_type: StreamType::Metrics,
                                                    last_sent_at: 0,
                                                    count: 0,
                                                    is_ingest_time: true,
                                                    parent_alert_deleted: false,
                                                },
                                            );
                                        }
                                    }
                                }
                            }
                            // End check for alert trigger
                        }
                    }
                }
            }
        }
    }

    let time = start.elapsed().as_secs_f64();
    for (stream_name, stream_data) in metric_data_map {
        // stream_data could be empty if metric value is nan, check it
        if stream_data.is_empty() {
            continue;
        }

        // write to file
        let mut stream_file_name = "".to_string();

        // check if we are allowed to ingest
        if db::compact::retention::is_deleting_stream(
            org_id,
            &stream_name,
            StreamType::Metrics,
            None,
        ) {
            log::warn!("stream [{stream_name}] is being deleted");
            continue;
        }

        let time_level = if let Some(details) = stream_partitioning_map.get(&stream_name) {
            details.partition_time_level
        } else {
            Some(CONFIG.limit.metrics_file_retention.as_str().into())
        };

        let mut req_stats = write_file(
            &stream_data,
            thread_id,
            &StreamParams::new(org_id, &stream_name, StreamType::Metrics),
            &mut stream_file_name,
            time_level,
        )
        .await;

        req_stats.response_time += time;
        report_request_usage_stats(
            req_stats,
            org_id,
            &stream_name,
            StreamType::Metrics,
            UsageType::Metrics,
            0,
        )
        .await;

        let time = start.elapsed().as_secs_f64();
        metrics::HTTP_RESPONSE_TIME
            .with_label_values(&[
                "/api/org/v1/metrics",
                "200",
                org_id,
                &stream_name,
                StreamType::Metrics.to_string().as_str(),
            ])
            .observe(time);
        metrics::HTTP_INCOMING_REQUESTS
            .with_label_values(&[
                "/api/org/v1/metrics",
                "200",
                org_id,
                &stream_name,
                StreamType::Metrics.to_string().as_str(),
            ])
            .inc();
    }

    // only one trigger per request, as it updates etcd
    for (_, entry) in &stream_trigger_map {
        let mut alerts = stream_alerts_map
            .get(&format!(
                "{}/{}/{}",
                entry.org,
                StreamType::Metrics,
                entry.stream
            ))
            .unwrap()
            .clone();

        alerts.retain(|alert| alert.name.eq(&entry.alert_name));
        if !alerts.is_empty() {
            crate::service::ingestion::send_ingest_notification(
                entry.clone(),
                alerts.first().unwrap().clone(),
            )
            .await;
        }
    }

    let res = ExportMetricsServiceResponse {
        partial_success: None,
    };
    let mut out = BytesMut::with_capacity(res.encoded_len());
    res.encode(&mut out).expect("Out of memory");

    return Ok(HttpResponse::Ok()
        .status(http::StatusCode::OK)
        .content_type(CONTENT_TYPE_JSON)
        .body(out));
}

fn process_sum(
    rec: &mut json::Value,
    sum: &json::Map<String, json::Value>,
    metadata: &mut prom::Metadata,
    prom_meta: &mut AHashMap<String, String>,
) -> Vec<serde_json::Value> {
    // set metadata
    metadata.metric_type = MetricType::Counter;
    prom_meta.insert(
        meta::prom::METADATA_LABEL.to_string(),
        json::to_string(&metadata).unwrap(),
    );

    let mut records = vec![];
    process_aggregation_temporality(
        rec,
        sum.get("aggregationTemporality").unwrap().as_u64().unwrap(),
    );
    rec["is_monotonic"] = sum.get("isMonotonic").unwrap().as_bool().unwrap().into();
    for data_point in sum.get("dataPoints").unwrap().as_array().unwrap_or(&vec![]) {
        let dp = data_point.as_object().unwrap();
        let mut dp_rec = rec.clone();
        process_data_point(&mut dp_rec, dp);
        let val_map = dp_rec.as_object_mut().unwrap();

        let vec: Vec<&str> = get_exclude_labels();

        let hash = super::signature_without_labels(val_map, &vec);
        val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
        records.push(dp_rec.clone());
    }
    records
}

fn process_histogram(
    rec: &mut json::Value,
    hist: &json::Map<String, json::Value>,
    metadata: &mut prom::Metadata,
    prom_meta: &mut AHashMap<String, String>,
) -> Vec<serde_json::Value> {
    // set metadata
    metadata.metric_type = MetricType::Histogram;
    prom_meta.insert(
        meta::prom::METADATA_LABEL.to_string(),
        json::to_string(&metadata).unwrap(),
    );

    let mut records = vec![];
    process_aggregation_temporality(
        rec,
        hist.get("aggregationTemporality")
            .unwrap()
            .as_u64()
            .unwrap(),
    );
    for data_point in hist
        .get("dataPoints")
        .unwrap()
        .as_array()
        .unwrap_or(&vec![])
    {
        let dp = data_point.as_object().unwrap();
        let mut dp_rec = rec.clone();
        for mut bucket_rec in process_hist_data_point(&mut dp_rec, dp) {
            let val_map = bucket_rec.as_object_mut().unwrap();
            let vec: Vec<&str> = get_exclude_labels();
            let hash = super::signature_without_labels(val_map, &vec);
            val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
            records.push(bucket_rec);
        }
    }
    records
}

fn process_summary(
    rec: &json::Value,
    summary: &json::Map<String, json::Value>,
    metadata: &mut prom::Metadata,
    prom_meta: &mut AHashMap<String, String>,
) -> Vec<serde_json::Value> {
    // set metadata
    metadata.metric_type = MetricType::Summary;
    prom_meta.insert(
        meta::prom::METADATA_LABEL.to_string(),
        json::to_string(&metadata).unwrap(),
    );

    let mut records = vec![];
    for data_point in summary
        .get("dataPoints")
        .unwrap()
        .as_array()
        .unwrap_or(&vec![])
    {
        let dp = data_point.as_object().unwrap();
        let mut dp_rec = rec.clone();
        for mut bucket_rec in process_summary_data_point(&mut dp_rec, dp) {
            let val_map = bucket_rec.as_object_mut().unwrap();
            let vec: Vec<&str> = get_exclude_labels();
            let hash = super::signature_without_labels(val_map, &vec);
            val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
            records.push(bucket_rec);
        }
    }
    records
}

fn process_gauge(
    rec: &mut json::Value,
    gauge: &json::Map<String, json::Value>,
    metadata: &mut prom::Metadata,
    prom_meta: &mut AHashMap<String, String>,
) -> Vec<serde_json::Value> {
    let mut records = vec![];

    // set metadata
    metadata.metric_type = MetricType::Gauge;
    prom_meta.insert(
        meta::prom::METADATA_LABEL.to_string(),
        json::to_string(&metadata).unwrap(),
    );

    for data_point in gauge
        .get("dataPoints")
        .unwrap()
        .as_array()
        .unwrap_or(&vec![])
    {
        let dp = data_point.as_object().unwrap();
        process_data_point(rec, dp);
        let val_map = rec.as_object_mut().unwrap();
        let hash = super::signature_without_labels(val_map, &[VALUE_LABEL]);
        val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
        records.push(rec.clone());
    }
    records
}

fn process_exponential_histogram(
    rec: &mut json::Value,
    hist: &json::Map<String, json::Value>,
    metadata: &mut prom::Metadata,
    prom_meta: &mut AHashMap<String, String>,
) -> Vec<serde_json::Value> {
    // set metadata
    metadata.metric_type = MetricType::ExponentialHistogram;
    prom_meta.insert(
        meta::prom::METADATA_LABEL.to_string(),
        json::to_string(&metadata).unwrap(),
    );
    let mut records = vec![];
    process_aggregation_temporality(
        rec,
        hist.get("aggregationTemporality")
            .unwrap()
            .as_u64()
            .unwrap(),
    );
    for data_point in hist
        .get("dataPoints")
        .unwrap()
        .as_array()
        .unwrap_or(&vec![])
    {
        let mut dp_rec = rec.clone();
        let dp = data_point.as_object().unwrap();
        for mut bucket_rec in process_exp_hist_data_point(&mut dp_rec, dp) {
            let val_map = bucket_rec.as_object_mut().unwrap();
            let vec: Vec<&str> = get_exclude_labels();
            let hash = super::signature_without_labels(val_map, &vec);
            val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
            records.push(bucket_rec);
        }
    }
    records
}

fn process_data_point(rec: &mut json::Value, data_point: &json::Map<String, json::Value>) {
    for attr in data_point
        .get("attributes")
        .unwrap()
        .as_array()
        .unwrap_or(&vec![])
    {
        let attr = attr.as_object().unwrap();
        if let Some(v) = attr.get("value") {
            rec[format_label_name(attr.get("key").unwrap().as_str().unwrap())] =
                get_attribute_value(v)
        }
    }
    let ts = data_point
        .get("timeUnixNano")
        .unwrap()
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    rec["start_time"] = data_point
        .get("startTimeUnixNano")
        .unwrap()
        .as_str()
        .unwrap()
        .into();
    rec[&CONFIG.common.column_timestamp] = (ts / 1000).into();

    set_data_point_value(rec, data_point);

    if let Some(v) = data_point.get("flags") {
        rec["flag"] = if v.as_u64().unwrap() == 1 {
            DataPointFlags::FlagNoRecordedValue.as_str_name()
        } else {
            DataPointFlags::FlagNone.as_str_name()
        }
        .into();
    }

    process_exemplars(rec, data_point);
}

fn process_hist_data_point(
    rec: &mut json::Value,
    data_point: &json::Map<String, json::Value>,
) -> Vec<serde_json::Value> {
    let mut bucket_recs = vec![];

    for attr in data_point
        .get("attributes")
        .unwrap()
        .as_array()
        .unwrap_or(&vec![])
    {
        let attr = attr.as_object().unwrap();
        if let Some(v) = attr.get("value") {
            rec[format_label_name(attr.get("key").unwrap().as_str().unwrap())] =
                get_attribute_value(v);
        }
    }
    let ts = data_point
        .get("timeUnixNano")
        .unwrap()
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    rec["start_time"] = data_point
        .get("startTimeUnixNano")
        .unwrap()
        .as_str()
        .unwrap()
        .into();
    rec[&CONFIG.common.column_timestamp] = (ts / 1000).into();
    if let Some(v) = data_point.get("flags") {
        rec["flag"] = if v.as_u64().unwrap() == 1 {
            DataPointFlags::FlagNoRecordedValue.as_str_name()
        } else {
            DataPointFlags::FlagNone.as_str_name()
        }
        .into();
    }
    process_exemplars(rec, data_point);
    // add count record
    let mut count_rec = rec.clone();
    count_rec[VALUE_LABEL] = data_point.get("count").unwrap().as_str().into();
    count_rec[NAME_LABEL] = format!("{}_count", count_rec[NAME_LABEL]).into();
    bucket_recs.push(count_rec);

    // add sum record
    let mut sum_rec = rec.clone();
    sum_rec[VALUE_LABEL] = data_point.get("sum").unwrap().as_str().into();
    sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL]).into();
    bucket_recs.push(sum_rec);

    // add bucket records

    let buckets = data_point.get("bucketCounts").unwrap().as_array().unwrap();
    let explicit_bounds = data_point
        .get("explicitBounds")
        .unwrap()
        .as_array()
        .unwrap();
    let last_index = buckets.len() - 1;
    for i in 0..last_index {
        let mut bucket_rec = rec.clone();
        if let Some(val) = buckets.get(i) {
            bucket_rec[VALUE_LABEL] = (*val).clone()
        }
        if let Some(val) = explicit_bounds.get(i) {
            bucket_rec["le"] = (*val).clone()
        }
        if i == last_index {
            bucket_rec["le"] = std::f64::INFINITY.into();
        }
        bucket_recs.push(bucket_rec);
    }
    bucket_recs
}

fn process_exp_hist_data_point(
    rec: &mut json::Value,
    data_point: &json::Map<String, json::Value>,
) -> Vec<serde_json::Value> {
    let mut bucket_recs = vec![];

    for attr in data_point
        .get("attributes")
        .unwrap()
        .as_array()
        .unwrap_or(&vec![])
    {
        let attr = attr.as_object().unwrap();
        if let Some(v) = attr.get("value") {
            rec[format_label_name(attr.get("key").unwrap().as_str().unwrap())] =
                get_attribute_value(v);
        }
    }
    let ts = data_point
        .get("timeUnixNano")
        .unwrap()
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    rec["start_time"] = data_point
        .get("startTimeUnixNano")
        .unwrap()
        .as_str()
        .unwrap()
        .into();
    rec[&CONFIG.common.column_timestamp] = (ts / 1000).into();
    if let Some(v) = data_point.get("flags") {
        rec["flag"] = if v.as_u64().unwrap() == 1 {
            DataPointFlags::FlagNoRecordedValue.as_str_name()
        } else {
            DataPointFlags::FlagNone.as_str_name()
        }
        .into();
    }
    process_exemplars(rec, data_point);

    // add count record
    let mut count_rec = rec.clone();
    count_rec[VALUE_LABEL] = data_point.get("count").unwrap().as_str().into();
    count_rec[NAME_LABEL] = format!("{}_count", count_rec[NAME_LABEL]).into();
    bucket_recs.push(count_rec);

    // add sum record
    let mut sum_rec = rec.clone();
    sum_rec[VALUE_LABEL] = data_point.get("sum").unwrap().as_str().into();
    sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL]).into();
    bucket_recs.push(sum_rec);

    let base = 2 ^ (2 ^ -data_point.get("scale").unwrap().as_i64().unwrap());
    // add negative bucket records
    if let Some(buckets) = data_point.get("negative") {
        let buckets = buckets.as_object().unwrap();
        let offset = buckets.get("offset").unwrap().as_i64().unwrap();
        for (i, val) in buckets
            .get("bucket_counts")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            let mut bucket_rec = rec.clone();
            bucket_rec[VALUE_LABEL] = (*val).clone();
            bucket_rec["le"] = (base ^ (offset + (i as i64) + 1)).into();
            bucket_recs.push(bucket_rec);
        }
    }
    // add positive bucket records
    if let Some(buckets) = data_point.get("positive") {
        let buckets = buckets.as_object().unwrap();
        let offset = buckets.get("offset").unwrap().as_i64().unwrap();
        for (i, val) in buckets
            .get("bucket_counts")
            .unwrap()
            .as_array()
            .unwrap()
            .iter()
            .enumerate()
        {
            let mut bucket_rec = rec.clone();
            bucket_rec[VALUE_LABEL] = (*val).clone();
            bucket_rec["le"] = (base ^ (offset + (i as i64) + 1)).into();
            bucket_recs.push(bucket_rec);
        }
    }

    bucket_recs
}

fn process_summary_data_point(
    rec: &mut json::Value,
    data_point: &json::Map<String, json::Value>,
) -> Vec<serde_json::Value> {
    let mut bucket_recs = vec![];

    for attr in data_point
        .get("attributes")
        .unwrap()
        .as_array()
        .unwrap_or(&vec![])
    {
        let attr = attr.as_object().unwrap();
        if let Some(v) = attr.get("value") {
            rec[format_label_name(attr.get("key").unwrap().as_str().unwrap())] =
                get_attribute_value(v)
        }
    }
    let ts = data_point
        .get("timeUnixNano")
        .unwrap()
        .as_str()
        .unwrap()
        .parse::<u64>()
        .unwrap();
    rec["start_time"] = data_point
        .get("startTimeUnixNano")
        .unwrap()
        .as_str()
        .unwrap()
        .into();
    rec[&CONFIG.common.column_timestamp] = (ts / 1000).into();
    if let Some(v) = data_point.get("flags") {
        rec["flag"] = if v.as_u64().unwrap() == 1 {
            DataPointFlags::FlagNoRecordedValue.as_str_name()
        } else {
            DataPointFlags::FlagNone.as_str_name()
        }
        .into();
    }
    // add count record
    let mut count_rec = rec.clone();
    count_rec[VALUE_LABEL] = data_point.get("count").unwrap().as_str().into();
    count_rec[NAME_LABEL] = format!("{}_count", count_rec[NAME_LABEL]).into();
    bucket_recs.push(count_rec);

    // add sum record
    let mut sum_rec = rec.clone();
    sum_rec[VALUE_LABEL] = data_point.get("sum").unwrap().as_str().into();
    sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL]).into();
    bucket_recs.push(sum_rec);

    // add bucket records
    let buckets = data_point
        .get("quantileValues")
        .unwrap()
        .as_array()
        .unwrap();
    for value in buckets {
        let mut bucket_rec = rec.clone();
        let value = value.as_object().unwrap();
        bucket_rec[VALUE_LABEL] = value.get("value").unwrap().clone();
        bucket_rec["quantile"] = value.get("quantile").unwrap().clone();
        bucket_recs.push(bucket_rec);
    }
    bucket_recs
}

fn process_aggregation_temporality(rec: &mut json::Value, val: u64) {
    rec["aggregation_temporality"] = match val {
        0 => AggregationTemporality::Unspecified.as_str_name(),
        1 => AggregationTemporality::Delta.as_str_name(),
        2 => AggregationTemporality::Cumulative.as_str_name(),
        _ => AggregationTemporality::Unspecified.as_str_name(),
    }
    .into();
}

fn process_exemplars(rec: &mut json::Value, data_point: &json::Map<String, json::Value>) {
    let exemplars = match data_point.get("exemplars") {
        Some(v) => match v.as_array() {
            Some(v) => v,
            None => {
                return;
            }
        },
        None => {
            return;
        }
    };
    let mut exemplar_coll = vec![];
    for exemplar in exemplars {
        let exemp = exemplar.as_object().unwrap();
        let mut exemplar_rec = json::json!({});
        for attr in exemp
            .get("filteredAttributes")
            .unwrap()
            .as_array()
            .unwrap_or(&vec![])
        {
            let attr = attr.as_object().unwrap();
            if let Some(v) = attr.get("value") {
                exemplar_rec[attr.get("key").unwrap().as_str().unwrap()] =
                    get_metric_value(v).into();
            }
        }
        set_data_point_value(&mut exemplar_rec, exemp);
        exemplar_rec[&CONFIG.common.column_timestamp] =
            (exemplar.get("timeUnixNano").unwrap().as_u64().unwrap() / 1000).into();

        let trace_id_bytes = hex::decode(exemplar.get("traceId").unwrap().as_str().unwrap())
            .expect("Failed to decode hex string");

        let mut trace_id_array = [0u8; 16];
        trace_id_array.copy_from_slice(&trace_id_bytes);

        match TraceId::from_bytes(trace_id_array) {
            TraceId::INVALID => {}
            _ => {
                exemplar_rec["trace_id"] = TraceId::from_bytes(trace_id_array).to_string().into();
            }
        };

        let span_id_bytes = hex::decode(exemplar.get("spanId").unwrap().as_str().unwrap())
            .expect("Failed to decode hex string");

        let mut span_id_array = [0u8; 8];
        span_id_array.copy_from_slice(&span_id_bytes);

        match SpanId::from_bytes(span_id_array) {
            SpanId::INVALID => {}
            _ => {
                exemplar_rec["span_id"] = SpanId::from_bytes(span_id_array).to_string().into();
            }
        };

        exemplar_coll.push(exemplar_rec)
    }
    rec["exemplars"] = exemplar_coll.into();
}

fn set_data_point_value(rec: &mut json::Value, data_point: &json::Map<String, json::Value>) {
    if data_point.get("asInt").is_some() {
        rec[VALUE_LABEL] = (data_point.get("asInt").unwrap().as_i64().unwrap() as f64).into();
    } else {
        rec[VALUE_LABEL] = data_point.get("asDouble").unwrap().clone();
    }
}

fn get_attribute_value(val: &json::Value) -> json::Value {
    if val.get("stringValue").is_some() {
        val.get("stringValue").unwrap().clone()
    } else if val.get("boolValue").is_some() {
        val.get("boolValue").unwrap().clone()
    } else if val.get("intValue").is_some() {
        val.get("intValue").unwrap().clone()
    } else if val.get("doubleValue").is_some() {
        val.get("doubleValue").unwrap().clone()
    } else if val.get("arrayValue").is_some() {
        val.get("arrayValue").unwrap().clone()
    } else if val.get("kvlistValue").is_some() {
        val.get("kvlistValue").unwrap().clone()
    } else if val.get("bytesValue").is_some() {
        val.get("bytesValue").unwrap().clone()
    } else {
        json::Value::Null
    }
}

fn get_metric_value(val: &json::Value) -> f64 {
    if val.get("stringValue").is_some() {
        val.get("stringValue")
            .unwrap()
            .as_str()
            .unwrap()
            .parse::<f64>()
            .unwrap()
    } else if val.get("intValue").is_some() {
        val.get("intValue").unwrap().as_i64().unwrap() as f64
    } else if val.get("doubleValue").is_some() {
        val.get("doubleValue").unwrap().as_f64().unwrap()
    } else {
        0.0
    }
}
