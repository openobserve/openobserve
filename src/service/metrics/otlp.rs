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

use crate::{
    common::{
        flatten,
        infra::{cluster, config::CONFIG},
        json,
        meta::{
            self,
            alert::{Alert, Trigger},
            http::HttpResponse as MetaHttpResponse,
            prom::{self, MetricType, HASH_LABEL, NAME_LABEL, VALUE_LABEL},
            stream::{PartitioningDetails, StreamParams},
            usage::UsageType,
            StreamType,
        },
    },
    service::{
        db,
        ingestion::{
            chk_schema_by_record,
            grpc::{get_exemplar_val, get_metric_val, get_val},
            write_file,
        },
        schema::{set_schema_metadata, stream_schema_exists},
        stream::unwrap_partition_time_level,
        usage::report_request_usage_stats,
    },
};
use actix_web::{http, HttpResponse};
use ahash::AHashMap;
use bytes::BytesMut;
use chrono::Utc;
use datafusion::arrow::datatypes::Schema;
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::metrics::v1::metric::Data;
use opentelemetry_proto::tonic::{
    collector::metrics::v1::{ExportMetricsServiceRequest, ExportMetricsServiceResponse},
    metrics::v1::*,
};
use prost::Message;

const EXCLUDE_LABELS: [&str; 5] = [VALUE_LABEL, "start_time", "is_monotonic", "exemplars", "le"];

pub async fn handle_grpc_request(
    org_id: &str,
    thread_id: usize,
    request: ExportMetricsServiceRequest,
) -> Result<HttpResponse, anyhow::Error> {
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
            "Quota exceeded for this organisation".to_string(),
        )));
    }
    let start = std::time::Instant::now();
    let mut metric_data_map: AHashMap<String, AHashMap<String, Vec<String>>> = AHashMap::new();
    let mut metric_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut stream_trigger_map: AHashMap<String, Trigger> = AHashMap::new();
    let mut stream_partitioning_map: AHashMap<String, PartitioningDetails> = AHashMap::new();

    for resource_metric in &request.resource_metrics {
        for instrumentation_metric in &resource_metric.instrumentation_library_metrics {
            for metric in &instrumentation_metric.metrics {
                let metric_name = &metric.name;
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
                        .insert(metric_name.clone().to_owned(), partition_det.clone());
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

                let buf = metric_data_map.entry(metric_name.to_owned()).or_default();
                let mut rec = json::json!({});
                match &resource_metric.resource {
                    Some(res) => {
                        for item in &res.attributes {
                            rec[item.key.as_str()] = get_val(&item.value);
                        }
                    }
                    None => {}
                }
                match &instrumentation_metric.instrumentation_library {
                    Some(lib) => {
                        rec["instrumentation_library_name"] =
                            serde_json::Value::String(lib.name.to_owned());
                        rec["instrumentation_library_version"] =
                            serde_json::Value::String(lib.version.to_owned());
                    }
                    None => {}
                }
                rec[NAME_LABEL] = metric_name.to_owned().into();

                //metadata handling
                let mut metadata = prom::Metadata {
                    metric_family_name: rec[NAME_LABEL].to_string(),
                    metric_type: MetricType::Unknown,
                    help: metric.description.to_owned(),
                    unit: metric.unit.to_owned(),
                };
                let mut prom_meta: AHashMap<String, String> = AHashMap::new();

                let records = match &metric.data {
                    Some(data) => match data {
                        Data::Gauge(gauge) => {
                            process_gauge(&mut rec, gauge, &mut metadata, &mut prom_meta)
                        }
                        Data::Sum(sum) => process_sum(&mut rec, sum, &mut metadata, &mut prom_meta),
                        Data::Histogram(hist) => {
                            process_histogram(&mut rec, hist, &mut metadata, &mut prom_meta)
                        }
                        Data::ExponentialHistogram(exp_hist) => process_exponential_histogram(
                            &mut rec,
                            exp_hist,
                            &mut metadata,
                            &mut prom_meta,
                        ),
                        Data::Summary(summary) => {
                            process_summary(&mut rec, summary, &mut metadata, &mut prom_meta)
                        }
                    },
                    None => vec![],
                };
                if !schema_exists.has_metadata {
                    set_schema_metadata(org_id, metric_name, StreamType::Metrics, prom_meta)
                        .await
                        .unwrap();
                }

                for mut rec in records {
                    // flattening
                    rec = flatten::flatten(&rec)?;
                    // get json object
                    let val_map: &mut serde_json::Map<String, serde_json::Value> =
                        rec.as_object_mut().unwrap();

                    let timestamp = val_map
                        .get(&CONFIG.common.column_timestamp)
                        .unwrap()
                        .as_i64()
                        .unwrap_or(Utc::now().timestamp_micros());

                    let value_str = crate::common::json::to_string(&val_map).unwrap();
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
                        let key = format!(
                            "{}/{}/{}",
                            &org_id,
                            StreamType::Metrics,
                            metric_name.clone()
                        );
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
            stream_data,
            thread_id,
            StreamParams {
                org_id,
                stream_name: &stream_name,
                stream_type: StreamType::Metrics,
            },
            &mut stream_file_name,
            time_level,
        );

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

    let res = ExportMetricsServiceResponse {};
    let mut out = BytesMut::with_capacity(res.encoded_len());
    res.encode(&mut out).expect("Out of memory");

    return Ok(HttpResponse::Ok()
        .status(http::StatusCode::OK)
        .content_type("application/x-protobuf")
        .body(out));
}

fn process_gauge(
    rec: &mut json::Value,
    gauge: &Gauge,
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

    for data_point in &gauge.data_points {
        process_data_point(rec, data_point);
        let val_map = rec.as_object_mut().unwrap();
        let hash = super::signature_without_labels(val_map, &[VALUE_LABEL]);
        val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
        records.push(rec.clone());
    }
    records
}

fn process_sum(
    rec: &mut json::Value,
    sum: &Sum,
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
    process_aggregation_temporality(rec, sum.aggregation_temporality);
    rec["is_monotonic"] = sum.is_monotonic.into();
    for data_point in &sum.data_points {
        process_data_point(rec, data_point);
        let val_map = rec.as_object_mut().unwrap();

        let vec: Vec<&str> = get_exclude_labels();

        let hash = super::signature_without_labels(val_map, &vec);
        val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
        records.push(rec.clone());
    }
    records
}

fn get_exclude_labels() -> Vec<&'static str> {
    let mut vec: Vec<&str> = EXCLUDE_LABELS.to_vec();
    vec.push(&CONFIG.common.column_timestamp);
    vec
}

fn process_histogram(
    rec: &mut json::Value,
    hist: &Histogram,
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
    process_aggregation_temporality(rec, hist.aggregation_temporality);
    for data_point in &hist.data_points {
        for mut bucket_rec in process_hist_data_point(rec, data_point) {
            let val_map = bucket_rec.as_object_mut().unwrap();
            let vec: Vec<&str> = get_exclude_labels();
            let hash = super::signature_without_labels(val_map, &vec);
            val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
            records.push(bucket_rec);
        }
    }
    records
}

fn process_exponential_histogram(
    rec: &mut json::Value,
    hist: &ExponentialHistogram,
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
    process_aggregation_temporality(rec, hist.aggregation_temporality);
    for data_point in &hist.data_points {
        for mut bucket_rec in process_exp_hist_data_point(rec, data_point) {
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
    rec: &mut json::Value,
    summary: &Summary,
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
    for data_point in &summary.data_points {
        for mut bucket_rec in process_summary_data_point(rec, data_point) {
            let val_map = bucket_rec.as_object_mut().unwrap();
            let vec: Vec<&str> = get_exclude_labels();
            let hash = super::signature_without_labels(val_map, &vec);
            val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
            records.push(bucket_rec);
        }
    }
    records
}

fn process_data_point(rec: &mut json::Value, data_point: &NumberDataPoint) {
    for attr in &data_point.attributes {
        rec[attr.key.as_str()] = get_val(&attr.value);
    }
    rec[VALUE_LABEL] = get_metric_val(&data_point.value);
    rec[&CONFIG.common.column_timestamp] = (data_point.time_unix_nano / 1000).into();
    rec["start_time"] = data_point.start_time_unix_nano.into();
    rec["flag"] = if data_point.flags == 1 {
        DataPointFlags::FlagNoRecordedValue.as_str_name()
    } else {
        DataPointFlags::FlagNone.as_str_name()
    }
    .into();
    process_exemplars(rec, &data_point.exemplars);
}

fn process_hist_data_point(
    rec: &mut json::Value,
    data_point: &HistogramDataPoint,
) -> Vec<serde_json::Value> {
    let mut bucket_recs = vec![];

    for attr in &data_point.attributes {
        rec[attr.key.as_str()] = get_val(&attr.value);
    }
    rec[&CONFIG.common.column_timestamp] = (data_point.time_unix_nano / 1000).into();
    rec["start_time"] = data_point.start_time_unix_nano.into();
    rec["flag"] = if data_point.flags == 1 {
        DataPointFlags::FlagNoRecordedValue.as_str_name()
    } else {
        DataPointFlags::FlagNone.as_str_name()
    }
    .into();
    process_exemplars(rec, &data_point.exemplars);
    // add count record
    let mut count_rec = rec.clone();
    count_rec[VALUE_LABEL] = data_point.count.into();
    count_rec[NAME_LABEL] = format!("{}_count", count_rec[NAME_LABEL]).into();
    bucket_recs.push(count_rec);

    // add sum record
    let mut sum_rec = rec.clone();
    sum_rec[VALUE_LABEL] = data_point.sum.into();
    sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL]).into();
    bucket_recs.push(sum_rec);

    // add bucket records
    let last_index = data_point.bucket_counts.len() - 1;
    for i in 0..last_index {
        let mut bucket_rec = rec.clone();
        if let Some(val) = data_point.bucket_counts.get(i) {
            bucket_rec[VALUE_LABEL] = (*val).into()
        }
        if let Some(val) = data_point.explicit_bounds.get(i) {
            bucket_rec["le"] = (*val).into()
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
    data_point: &ExponentialHistogramDataPoint,
) -> Vec<serde_json::Value> {
    let mut bucket_recs = vec![];

    for attr in &data_point.attributes {
        rec[attr.key.as_str()] = get_val(&attr.value);
    }
    rec[&CONFIG.common.column_timestamp] = (data_point.time_unix_nano / 1000).into();
    rec["start_time"] = data_point.start_time_unix_nano.into();
    rec["flag"] = if data_point.flags == 1 {
        DataPointFlags::FlagNoRecordedValue.as_str_name()
    } else {
        DataPointFlags::FlagNone.as_str_name()
    }
    .into();
    process_exemplars(rec, &data_point.exemplars);
    // add count record
    let mut count_rec = rec.clone();
    count_rec[VALUE_LABEL] = data_point.count.into();
    count_rec[NAME_LABEL] = format!("{}_count", count_rec[NAME_LABEL]).into();
    bucket_recs.push(count_rec);

    // add sum record
    let mut sum_rec = rec.clone();
    sum_rec[VALUE_LABEL] = data_point.sum.into();
    sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL]).into();
    bucket_recs.push(sum_rec);

    let base = 2 ^ (2 ^ -data_point.scale);
    // add negative bucket records
    match &data_point.negative {
        Some(buckets) => {
            let offset = buckets.offset;
            for (i, val) in buckets.bucket_counts.iter().enumerate() {
                let mut bucket_rec = rec.clone();
                bucket_rec[VALUE_LABEL] = (*val).into();
                bucket_rec["le"] = (base ^ (offset + (i as i32) + 1)).into();
                bucket_recs.push(bucket_rec);
            }
        }
        None => {}
    }
    // add positive bucket records
    match &data_point.positive {
        Some(buckets) => {
            let offset = buckets.offset;
            for (i, val) in buckets.bucket_counts.iter().enumerate() {
                let mut bucket_rec = rec.clone();
                bucket_rec[VALUE_LABEL] = (*val).into();
                bucket_rec["le"] = (base ^ (offset + (i as i32) + 1)).into();
                bucket_recs.push(bucket_rec);
            }
        }
        None => {}
    }

    bucket_recs
}

fn process_summary_data_point(
    rec: &mut json::Value,
    data_point: &SummaryDataPoint,
) -> Vec<serde_json::Value> {
    let mut bucket_recs = vec![];

    for attr in &data_point.attributes {
        rec[attr.key.as_str()] = get_val(&attr.value);
    }
    rec[&CONFIG.common.column_timestamp] = (data_point.time_unix_nano / 1000).into();
    rec["start_time"] = data_point.start_time_unix_nano.into();
    rec["flag"] = if data_point.flags == 1 {
        DataPointFlags::FlagNoRecordedValue.as_str_name()
    } else {
        DataPointFlags::FlagNone.as_str_name()
    }
    .into();
    // add count record
    let mut count_rec = rec.clone();
    count_rec[VALUE_LABEL] = data_point.count.into();
    count_rec[NAME_LABEL] = format!("{}_count", count_rec[NAME_LABEL]).into();
    bucket_recs.push(count_rec);

    // add sum record
    let mut sum_rec = rec.clone();
    sum_rec[VALUE_LABEL] = data_point.sum.into();
    sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL]).into();
    bucket_recs.push(sum_rec);

    // add bucket records
    for value in &data_point.quantile_values {
        let mut bucket_rec = rec.clone();
        bucket_rec[VALUE_LABEL] = value.value.into();
        bucket_rec["quantile"] = value.quantile.into();
        bucket_recs.push(bucket_rec);
    }
    bucket_recs
}

fn process_exemplars(rec: &mut json::Value, exemplars: &Vec<Exemplar>) {
    let mut exemplar_coll = vec![];
    for exemplar in exemplars {
        let mut exemplar_rec = json::json!({});
        for attr in &exemplar.filtered_attributes {
            exemplar_rec[attr.key.as_str()] = get_val(&attr.value);
        }
        exemplar_rec[VALUE_LABEL] = get_exemplar_val(&exemplar.value);
        exemplar_rec[&CONFIG.common.column_timestamp] = (exemplar.time_unix_nano / 1000).into();

        match TraceId::from_bytes(exemplar.trace_id.as_slice().try_into().unwrap_or_default()) {
            TraceId::INVALID => {}
            _ => {
                exemplar_rec["trace_id"] =
                    TraceId::from_bytes(exemplar.trace_id.as_slice().try_into().unwrap())
                        .to_string()
                        .into();
            }
        };

        match SpanId::from_bytes(exemplar.span_id.as_slice().try_into().unwrap_or_default()) {
            SpanId::INVALID => {}
            _ => {
                exemplar_rec["span_id"] =
                    SpanId::from_bytes(exemplar.span_id.as_slice().try_into().unwrap())
                        .to_string()
                        .into();
            }
        };

        exemplar_coll.push(exemplar_rec)
    }
    rec["exemplars"] = exemplar_coll.into();
}

fn process_aggregation_temporality(rec: &mut json::Value, val: i32) {
    rec["aggregation_temporality"] = match val {
        0 => AggregationTemporality::Unspecified.as_str_name(),
        1 => AggregationTemporality::Delta.as_str_name(),
        2 => AggregationTemporality::Cumulative.as_str_name(),
        _ => AggregationTemporality::Unspecified.as_str_name(),
    }
    .into();
}
