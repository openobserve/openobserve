use crate::{
    common::{
        infra::{cluster, config::CONFIG},
        json,
        meta::{
            self,
            alert::{Alert, Evaluate, Trigger},
            http::HttpResponse as MetaHttpResponse,
            prom::{HASH_LABEL, NAME_LABEL, VALUE_LABEL},
            stream::PartitioningDetails,
            usage::UsageType,
            StreamType,
        },
    },
    service::{
        db,
        ingestion::{
            chk_schema_by_record,
            grpc::{get_exemplar_val, get_metric_val, get_val},
        },
        schema::stream_schema_exists,
        stream::unwrap_partition_time_level,
        usage::report_request_usage_stats,
    },
};
use actix_web::{http, web, HttpResponse};
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
                let _schema_exists = stream_schema_exists(
                    org_id,
                    &metric_name,
                    StreamType::Metrics,
                    &mut metric_schema_map,
                )
                .await;
                // get partition keys
                if !stream_partitioning_map.contains_key(metric_name) {
                    let partition_det = crate::service::ingestion::get_stream_partition_keys(
                        &metric_name,
                        &metric_schema_map,
                    )
                    .await;
                    stream_partitioning_map.insert(metric_name.clone(), partition_det.clone());
                }

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
                rec["unit"] = metric.unit.to_owned().into();
                rec["description"] = metric.description.to_owned().into();

                let records = match &metric.data {
                    Some(data) => match data {
                        Data::Gauge(gauge) => process_gauge(&mut rec, gauge),
                        Data::Sum(sum) => process_sum(&mut rec, sum),
                        Data::Histogram(hist) => process_histogram(&mut rec, hist),
                        Data::ExponentialHistogram(exp_hist) => todo!(),
                        Data::Summary(summary) => process_summary(&mut rec, summary),
                    },
                    None => vec![],
                };
                for mut rec in records {
                    // check for schema
                    let _schema_exists = stream_schema_exists(
                        org_id,
                        &metric_name,
                        StreamType::Metrics,
                        &mut metric_schema_map,
                    )
                    .await;

                    // get partition keys
                    if !stream_partitioning_map.contains_key(metric_name) {
                        let partition_det = crate::service::ingestion::get_stream_partition_keys(
                            &metric_name,
                            &metric_schema_map,
                        )
                        .await;
                        stream_partitioning_map.insert(metric_name.clone(), partition_det.clone());
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
                        &metric_name,
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
                                            metric_name.clone(),
                                            Trigger {
                                                timestamp,
                                                is_valid: true,
                                                alert_name: alert.name.clone(),
                                                stream: metric_name.clone(),
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

    let res = ExportMetricsServiceResponse {};
    let mut out = BytesMut::with_capacity(res.encoded_len());
    res.encode(&mut out).expect("Out of memory");

    return Ok(HttpResponse::Ok()
        .status(http::StatusCode::OK)
        .content_type("application/x-protobuf")
        .body(out));
}

fn process_gauge(rec: &mut json::Value, gauge: &Gauge) -> Vec<serde_json::Value> {
    let mut records = vec![];
    for data_point in &gauge.data_points {
        process_data_point(rec, data_point);
        let val_map = rec.as_object_mut().unwrap();
        let hash = super::signature_without_labels(val_map, &[VALUE_LABEL]);
        val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
        records.push(rec.clone());
    }
    records
}

fn process_sum(rec: &mut json::Value, sum: &Sum) -> Vec<serde_json::Value> {
    let mut records = vec![];
    process_aggregation_temporality(rec, sum.aggregation_temporality);
    rec["is_monotonic"] = sum.is_monotonic.into();
    for data_point in &sum.data_points {
        process_data_point(rec, data_point);
        let val_map = rec.as_object_mut().unwrap();
        let hash = super::signature_without_labels(val_map, &[VALUE_LABEL]);
        val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
        records.push(rec.clone());
    }
    records
}

fn process_histogram(rec: &mut json::Value, hist: &Histogram) -> Vec<serde_json::Value> {
    let mut records = vec![];
    process_aggregation_temporality(rec, hist.aggregation_temporality);
    for data_point in &hist.data_points {
        for mut bucket_rec in process_hist_data_point(rec, data_point) {
            let val_map = bucket_rec.as_object_mut().unwrap();
            let hash = super::signature_without_labels(val_map, &[VALUE_LABEL]);
            val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
            records.push(bucket_rec);
        }
    }
    records
}

/* fn process_exponentail_histogram(
    rec: &mut json::Value,
    hist: &ExponentialHistogram,
) -> Vec<serde_json::Value> {
    let mut records = vec![];
    process_aggregation_temporality(rec, hist.aggregation_temporality);
    for data_point in &hist.data_points {
        for mut bucket_rec in process_hist_data_point(rec, data_point) {
            let val_map = bucket_rec.as_object_mut().unwrap();
            let hash = super::signature_without_labels(val_map, &[VALUE_LABEL]);
            val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
            records.push(bucket_rec);
        }
    }
    records
} */

fn process_summary(rec: &mut json::Value, summary: &Summary) -> Vec<serde_json::Value> {
    let mut records = vec![];

    for data_point in &summary.data_points {
        for mut bucket_rec in process_summary_data_point(rec, data_point) {
            let val_map = bucket_rec.as_object_mut().unwrap();
            let hash = super::signature_without_labels(val_map, &[VALUE_LABEL]);
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
    rec["value"] = get_metric_val(&data_point.value);
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
    count_rec["value"] = data_point.count.into();
    count_rec[NAME_LABEL] = format!("{}_count", count_rec[NAME_LABEL]).into();
    bucket_recs.push(count_rec);

    // add sum record
    let mut sum_rec = rec.clone();
    sum_rec["value"] = data_point.sum.into();
    sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL]).into();
    bucket_recs.push(sum_rec);

    // add bucket records
    let last_index = data_point.bucket_counts.len() - 1;
    for i in 0..last_index {
        let mut bucket_rec = rec.clone();
        match data_point.bucket_counts.get(i) {
            Some(val) => bucket_rec["value"] = val.clone().into(),
            None => {}
        }
        match data_point.explicit_bounds.get(i) {
            Some(val) => bucket_rec["le"] = val.clone().into(),
            None => {}
        }
        if i == last_index {
            bucket_rec["le"] = std::f64::INFINITY.into();
        }
        bucket_recs.push(bucket_rec);
    }
    bucket_recs
}

/* fn process_exp_hist_data_point(
    rec: &mut json::Value,
    data_point: &ExponentialHistogramDataPoint,
) -> Vec<serde_json::Value> {
    let mut bucket_recs = vec![];

    for attr in &data_point.attributes {
        rec[attr.key.as_str()] = get_val(&attr.value);
    }
    rec["count"] = data_point.count.into();
    rec["sum"] = data_point.sum.into();
    rec[&CONFIG.common.column_timestamp] = (data_point.time_unix_nano / 1000).into();
    rec["start_time"] = data_point.start_time_unix_nano.into();
    rec["flag"] = if data_point.flags == 1 {
        DataPointFlags::FlagNoRecordedValue.as_str_name()
    } else {
        DataPointFlags::FlagNone.as_str_name()
    }
    .into();
    process_exemplars(rec, &data_point.exemplars);
    for i in 0..data_point.bucket_counts.len() {
        let mut bucket_rec = rec.clone();
        match data_point.bucket_counts.get(i) {
            Some(val) => bucket_rec["bucket_count"] = val.clone().into(),
            None => {}
        }
        match data_point.explicit_bounds.get(i) {
            Some(val) => bucket_rec["bucket_upper_bound"] = val.clone().into(),
            None => {}
        }

        bucket_recs.push(bucket_rec);
    }
    bucket_recs
} */

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
    count_rec["value"] = data_point.count.into();
    count_rec[NAME_LABEL] = format!("{}_count", count_rec[NAME_LABEL]).into();
    bucket_recs.push(count_rec);

    // add sum record
    let mut sum_rec = rec.clone();
    sum_rec["value"] = data_point.sum.into();
    sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL]).into();
    bucket_recs.push(sum_rec);

    // add bucket records
    for value in &data_point.quantile_values {
        let mut bucket_rec = rec.clone();
        bucket_rec["value"] = value.value.into();
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
        exemplar_rec["value"] = get_exemplar_val(&exemplar.value);
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
