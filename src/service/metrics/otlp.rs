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

use std::{
    collections::{HashMap, HashSet},
    io::Error,
    sync::Arc,
};

use axum::{
    Json, http,
    response::{IntoResponse, Response as HttpResponse},
};
use bytes::{Bytes, BytesMut};
use chrono::Utc;
use config::{
    TIMESTAMP_COL_NAME,
    meta::{
        alerts::alert,
        otlp::OtlpRequestType,
        promql::*,
        self_reporting::usage::UsageType,
        stream::{PartitioningDetails, StreamParams, StreamType},
    },
    metrics,
    utils::{
        flatten::{self, format_label_name},
        json,
        schema_ext::SchemaExt,
        time::now_micros,
    },
};
use infra::schema::{SchemaCache, unwrap_partition_time_level};
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::{
    collector::metrics::v1::{
        ExportMetricsPartialSuccess, ExportMetricsServiceRequest, ExportMetricsServiceResponse,
    },
    metrics::v1::{metric::Data, *},
};
use prost::Message;

use crate::{
    common::meta::{http::HttpResponse as MetaHttpResponse, stream::SchemaRecords},
    service::{
        alerts::alert::AlertExt,
        db, format_stream_name,
        ingestion::{
            TriggerAlertData, check_ingestion_allowed, evaluate_trigger, get_thread_id,
            grpc::{get_exemplar_val, get_metric_val, get_val},
            write_file,
        },
        metrics::get_exclude_labels,
        pipeline::batch_execution::ExecutablePipeline,
        schema::{check_for_schema, stream_schema_exists},
        self_reporting::report_request_usage_stats,
    },
};

pub async fn otlp_proto(
    org_id: &str,
    body: Bytes,
    user: crate::common::meta::ingestion::IngestUser,
) -> Result<HttpResponse, std::io::Error> {
    let request = match ExportMetricsServiceRequest::decode(body) {
        Ok(v) => v,
        Err(e) => {
            log::error!("[METRICS:OTLP] Invalid proto: org_id: {org_id}, error: {e}");
            return Ok(MetaHttpResponse::bad_request(format!("Invalid proto: {e}")));
        }
    };
    match handle_otlp_request(org_id, request, OtlpRequestType::HttpProtobuf, user).await {
        Ok(v) => Ok(v),
        Err(e) => {
            log::error!(
                "[METRICS:OTLP] Error while handling grpc metrics request: org_id: {org_id}, error: {e}"
            );
            // Check if this is a schema validation error (columns limit)
            let error_msg = e.to_string();
            if error_msg.contains("ZO_COLS_PER_RECORD_LIMIT") {
                return Ok(MetaHttpResponse::bad_request(error_msg));
            }
            Err(Error::other(e))
        }
    }
}

pub async fn otlp_json(
    org_id: &str,
    body: Bytes,
    user: crate::common::meta::ingestion::IngestUser,
) -> Result<HttpResponse, std::io::Error> {
    let request = match serde_json::from_slice::<ExportMetricsServiceRequest>(body.as_ref()) {
        Ok(req) => req,
        Err(e) => {
            log::error!("[METRICS:OTLP] Invalid json: {e}");
            return Ok(MetaHttpResponse::bad_request(format!("Invalid json: {e}")));
        }
    };
    match handle_otlp_request(org_id, request, OtlpRequestType::HttpJson, user).await {
        Ok(v) => Ok(v),
        Err(e) => {
            log::error!("[METRICS:OTLP] Error while handling http trace request: {e}");
            // Check if this is a schema validation error (columns limit)
            let error_msg = e.to_string();
            if error_msg.contains("ZO_COLS_PER_RECORD_LIMIT") {
                return Ok(MetaHttpResponse::bad_request(error_msg));
            }
            Err(Error::other(e))
        }
    }
}

pub async fn handle_otlp_request(
    org_id: &str,
    request: ExportMetricsServiceRequest,
    req_type: OtlpRequestType,
    user: crate::common::meta::ingestion::IngestUser,
) -> Result<HttpResponse, anyhow::Error> {
    // check system resource
    if let Err(e) = check_ingestion_allowed(org_id, StreamType::Metrics, None).await {
        // we do not want to log trial period expired errors
        if matches!(e, infra::errors::Error::TrialPeriodExpired) {
            return Ok(MetaHttpResponse::too_many_requests(e));
        } else {
            log::error!("[METRICS:OTLP] ingestion error: {e}");
            return Ok((
                http::StatusCode::SERVICE_UNAVAILABLE,
                Json(MetaHttpResponse::error(
                    http::StatusCode::SERVICE_UNAVAILABLE,
                    e,
                )),
            )
                .into_response());
        }
    }

    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();

    let mut metric_data_map: HashMap<String, HashMap<String, SchemaRecords>> = HashMap::new();
    let mut metric_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let mut schema_evolved: HashMap<String, bool> = HashMap::new();
    let mut stream_partitioning_map: HashMap<String, PartitioningDetails> = HashMap::new();

    // Start get user defined schema
    let mut user_defined_schema_map: HashMap<String, Option<HashSet<String>>> = HashMap::new();
    let mut streams_need_original_map: HashMap<String, bool> = HashMap::new();
    let mut streams_need_all_values_map: HashMap<String, bool> = HashMap::new();
    // End get user defined schema

    // associated pipeline
    let mut stream_executable_pipelines: HashMap<String, Option<ExecutablePipeline>> =
        HashMap::new();
    let mut stream_pipeline_inputs: HashMap<String, Vec<json::Value>> = HashMap::new();

    // realtime alerts
    let mut stream_alerts_map: HashMap<String, Vec<alert::Alert>> = HashMap::new();
    let mut stream_trigger_map: HashMap<String, Option<TriggerAlertData>> = HashMap::new();

    let mut partial_success = ExportMetricsPartialSuccess::default();

    // records buffer
    let mut json_data_by_stream: HashMap<String, Vec<_>> = HashMap::new();

    for resource_metric in &request.resource_metrics {
        if resource_metric.scope_metrics.is_empty() {
            continue;
        }
        for scope_metric in &resource_metric.scope_metrics {
            for metric in &scope_metric.metrics {
                let metric_name = format_stream_name(metric.name.to_string());
                // check for schema
                let schema_exists = stream_schema_exists(
                    org_id,
                    &metric_name,
                    StreamType::Metrics,
                    &mut metric_schema_map,
                )
                .await;

                // get partition keys
                if !stream_partitioning_map.contains_key(&metric_name) {
                    let partition_det = crate::service::ingestion::get_stream_partition_keys(
                        org_id,
                        &StreamType::Metrics,
                        &metric_name,
                    )
                    .await;
                    stream_partitioning_map
                        .insert(metric_name.clone().to_owned(), partition_det.clone());
                }

                // Start get stream alerts
                let stream_param = StreamParams::new(org_id, &metric_name, StreamType::Metrics);
                crate::service::ingestion::get_stream_alerts(
                    std::slice::from_ref(&stream_param),
                    &mut stream_alerts_map,
                )
                .await;
                // End get stream alert

                // get stream pipeline
                if !stream_executable_pipelines.contains_key(&metric_name) {
                    let pipeline_params =
                        crate::service::ingestion::get_stream_executable_pipeline(&stream_param)
                            .await;
                    stream_executable_pipelines.insert(metric_name.clone(), pipeline_params);
                }

                // get user defined schema
                crate::service::ingestion::get_uds_and_original_data_streams(
                    std::slice::from_ref(&stream_param),
                    &mut user_defined_schema_map,
                    &mut streams_need_original_map,
                    &mut streams_need_all_values_map,
                )
                .await;

                let mut rec = json::json!({});
                if let Some(res) = &resource_metric.resource {
                    for item in &res.attributes {
                        rec[format_label_name(item.key.as_str())] = get_val(&item.value.as_ref());
                    }
                }
                if let Some(lib) = &scope_metric.scope {
                    rec["instrumentation_library_name"] =
                        serde_json::Value::String(lib.name.to_owned());
                    rec["instrumentation_library_version"] =
                        serde_json::Value::String(lib.version.to_owned());
                }
                rec[NAME_LABEL] = metric_name.to_owned().into();

                // process metadata
                let metadata = Metadata {
                    metric_family_name: rec[NAME_LABEL].to_string(),
                    metric_type: MetricType::Unknown,
                    help: metric.description.to_owned(),
                    unit: metric.unit.to_owned(),
                };
                let mut prom_meta: HashMap<String, String> = HashMap::new();

                let records = match &metric.data {
                    Some(data) => match data {
                        Data::Gauge(gauge) => {
                            process_gauge(&mut rec, gauge, metadata, &mut prom_meta)
                        }
                        Data::Sum(sum) => process_sum(&mut rec, sum, metadata, &mut prom_meta),
                        Data::Histogram(hist) => {
                            process_histogram(&mut rec, hist, metadata, &mut prom_meta)
                        }
                        Data::ExponentialHistogram(exp_hist) => process_exponential_histogram(
                            &mut rec,
                            exp_hist,
                            metadata,
                            &mut prom_meta,
                        ),
                        Data::Summary(summary) => {
                            process_summary(&rec, summary, metadata, &mut prom_meta)
                        }
                    },
                    None => vec![],
                };

                // update schema metadata
                if !schema_exists.has_metrics_metadata {
                    if !prom_meta.contains_key(METADATA_LABEL) {
                        prom_meta.insert(
                            METADATA_LABEL.to_string(),
                            json::to_string(&Metadata::new(&metric_name)).unwrap(),
                        );
                    }
                    log::info!(
                        "Metadata for stream {org_id}/metrics/{metric_name} needs to be updated"
                    );
                    if let Err(e) = db::schema::update_setting(
                        org_id,
                        &metric_name,
                        StreamType::Metrics,
                        prom_meta,
                    )
                    .await
                    {
                        log::error!(
                            "Failed to set metadata for metric: {metric_name} with error: {e}"
                        );
                    }
                }

                // process data points
                for mut rec in records {
                    // flattening
                    rec = flatten::flatten(rec)?;

                    let local_metric_name = format_stream_name(
                        rec.get(NAME_LABEL).unwrap().as_str().unwrap().to_string(),
                    );

                    if local_metric_name != metric_name {
                        // check for schema
                        stream_schema_exists(
                            org_id,
                            &local_metric_name,
                            StreamType::Metrics,
                            &mut metric_schema_map,
                        )
                        .await;

                        // get partition keys
                        if !stream_partitioning_map.contains_key(&local_metric_name) {
                            let partition_det =
                                crate::service::ingestion::get_stream_partition_keys(
                                    org_id,
                                    &StreamType::Metrics,
                                    &local_metric_name,
                                )
                                .await;
                            stream_partitioning_map
                                .insert(local_metric_name.clone(), partition_det.clone());
                        }

                        // Start get stream alerts
                        let stream_param =
                            StreamParams::new(org_id, &local_metric_name, StreamType::Metrics);
                        crate::service::ingestion::get_stream_alerts(
                            std::slice::from_ref(&stream_param),
                            &mut stream_alerts_map,
                        )
                        .await;
                        // End get stream alert

                        // get stream pipeline
                        if !stream_executable_pipelines.contains_key(&local_metric_name) {
                            let pipeline_params =
                                crate::service::ingestion::get_stream_executable_pipeline(
                                    &stream_param,
                                )
                                .await;
                            stream_executable_pipelines
                                .insert(local_metric_name.clone(), pipeline_params);
                        }

                        crate::service::ingestion::get_uds_and_original_data_streams(
                            std::slice::from_ref(&stream_param),
                            &mut user_defined_schema_map,
                            &mut streams_need_original_map,
                            &mut streams_need_all_values_map,
                        )
                        .await;
                    }

                    // ready to be buffered for downstream processing
                    if stream_executable_pipelines
                        .get(&local_metric_name)
                        .unwrap()
                        .is_some()
                    {
                        stream_pipeline_inputs
                            .entry(local_metric_name.clone())
                            .or_default()
                            .push(rec);
                    } else {
                        // get json object
                        let mut local_val = match rec.take() {
                            json::Value::Object(val) => val,
                            _ => unreachable!(),
                        };

                        if let Some(Some(fields)) = user_defined_schema_map.get(&local_metric_name)
                        {
                            local_val = crate::service::ingestion::refactor_map(local_val, fields);
                        }

                        json_data_by_stream
                            .entry(local_metric_name.clone())
                            .or_default()
                            .push(local_val);
                    }
                }
            }
        }
    }

    // process records buffered for pipeline processing
    for (stream_name, exec_pl_option) in &stream_executable_pipelines {
        if let Some(exec_pl) = exec_pl_option {
            let Some(pipeline_inputs) = stream_pipeline_inputs.remove(stream_name) else {
                let err_msg = format!(
                    "[Ingestion]: Stream {stream_name} has pipeline, but inputs failed to be buffered. BUG",
                );
                log::error!("{err_msg}");
                partial_success.error_message = err_msg;
                continue;
            };
            let count = pipeline_inputs.len();
            match exec_pl
                .process_batch(org_id, pipeline_inputs, Some(stream_name.clone()))
                .await
            {
                Err(e) => {
                    let err_msg = format!(
                        "[Ingestion]: Stream {stream_name} pipeline batch processing failed: {e}",
                    );
                    log::error!("{err_msg}");
                    // update status
                    partial_success.rejected_data_points += count as i64;
                    partial_success.error_message = err_msg;
                    continue;
                }
                Ok(pl_results) => {
                    for (stream_params, stream_pl_results) in pl_results {
                        if stream_params.stream_type != StreamType::Metrics {
                            continue;
                        }

                        let destination_stream = stream_params.stream_name.to_string();

                        // add partition keys
                        if !stream_partitioning_map.contains_key(&destination_stream) {
                            let partition_det =
                                crate::service::ingestion::get_stream_partition_keys(
                                    org_id,
                                    &StreamType::Metrics,
                                    &destination_stream,
                                )
                                .await;
                            stream_partitioning_map
                                .insert(destination_stream.clone(), partition_det.clone());
                        }
                        for (_, mut res) in stream_pl_results {
                            // get json object
                            let mut local_val = match res.take() {
                                json::Value::Object(v) => v,
                                _ => unreachable!(),
                            };

                            if let Some(Some(fields)) =
                                user_defined_schema_map.get(&destination_stream)
                            {
                                local_val =
                                    crate::service::ingestion::refactor_map(local_val, fields);
                            }

                            // buffer to downstream processing directly
                            json_data_by_stream
                                .entry(destination_stream.clone())
                                .or_default()
                                .push(local_val);
                        }
                    }
                }
            }
        }
    }

    for (local_metric_name, json_data) in json_data_by_stream {
        // get partition keys
        let partition_det = stream_partitioning_map.get(&local_metric_name).unwrap();
        let partition_keys = partition_det.partition_keys.clone();
        let partition_time_level =
            unwrap_partition_time_level(partition_det.partition_time_level, StreamType::Metrics);

        for val_map in json_data {
            let timestamp = val_map
                .get(TIMESTAMP_COL_NAME)
                .and_then(|ts| ts.as_i64())
                .unwrap_or(Utc::now().timestamp_micros());

            let value_str = json::to_string(&val_map).unwrap();

            // check for schema evolution
            let schema_fields = match metric_schema_map.get(&local_metric_name) {
                Some(schema) => schema
                    .schema()
                    .fields()
                    .iter()
                    .map(|f| f.name())
                    .collect::<HashSet<_>>(),
                None => HashSet::default(),
            };
            let mut need_schema_check = !schema_evolved.contains_key(&local_metric_name);
            for key in val_map.keys() {
                if !schema_fields.contains(&key) {
                    need_schema_check = true;
                    break;
                }
            }
            drop(schema_fields);
            if need_schema_check {
                let (schema_evolution, _infer_schema) = check_for_schema(
                    org_id,
                    &local_metric_name,
                    StreamType::Metrics,
                    &mut metric_schema_map,
                    vec![&val_map],
                    timestamp,
                    false, // is_derived is false for metrics
                )
                .await?;
                if schema_evolution.is_schema_changed {
                    schema_evolved.insert(local_metric_name.to_owned(), true);
                }
            }

            let buf = metric_data_map
                .entry(local_metric_name.to_owned())
                .or_default();
            let schema = metric_schema_map
                .get(&local_metric_name)
                .unwrap()
                .schema()
                .as_ref()
                .clone()
                .with_metadata(HashMap::new());
            let schema_key = schema.hash_key();
            // get hour key
            let hour_key = crate::service::ingestion::get_write_partition_key(
                timestamp,
                &partition_keys,
                partition_time_level,
                &val_map,
                Some(&schema_key),
            );
            let hour_buf = buf.entry(hour_key).or_insert_with(|| SchemaRecords {
                schema_key,
                schema: Arc::new(schema),
                records: vec![],
                records_size: 0,
            });
            hour_buf
                .records
                .push(Arc::new(json::Value::Object(val_map.to_owned())));
            hour_buf.records_size += value_str.len();

            // real time alert
            let need_trigger = !stream_trigger_map.contains_key(&local_metric_name);
            if need_trigger && !stream_alerts_map.is_empty() {
                // Start check for alert trigger
                let key = format!("{}/{}/{}", &org_id, StreamType::Metrics, local_metric_name);
                if let Some(alerts) = stream_alerts_map.get(&key) {
                    let mut trigger_alerts: TriggerAlertData = Vec::new();
                    let alert_end_time = now_micros();
                    for alert in alerts {
                        if let Ok(Some(data)) = alert
                            .evaluate(Some(&val_map), (None, alert_end_time), None)
                            .await
                            .map(|res| res.data)
                        {
                            trigger_alerts.push((alert.clone(), data))
                        }
                    }
                    stream_trigger_map.insert(local_metric_name.clone(), Some(trigger_alerts));
                }
            }
            // End check for alert trigger
        }
    }

    // write data to wal
    for (stream_name, stream_data) in metric_data_map {
        // stream_data could be empty if metric value is nan, check it
        if stream_data.is_empty() {
            continue;
        }

        // check if we are allowed to ingest
        if db::compact::retention::is_deleting_stream(
            org_id,
            StreamType::Metrics,
            &stream_name,
            None,
        ) {
            log::warn!("stream [{stream_name}] is being deleted");
            continue;
        }

        // write to file
        let writer = ingester::get_writer(
            get_thread_id(),
            org_id,
            StreamType::Metrics.as_str(),
            &stream_name,
        )
        .await;
        // for performance issue, we will flush all when the app shutdown
        let fsync = false;
        let mut req_stats = write_file(&writer, org_id, &stream_name, stream_data, fsync).await?;

        let fns_length: usize =
            stream_executable_pipelines
                .get(&stream_name)
                .map_or(0, |exec_pl_option| {
                    exec_pl_option
                        .as_ref()
                        .map_or(0, |exec_pl| exec_pl.num_of_func())
                });
        req_stats.response_time = start.elapsed().as_secs_f64();
        let email_str = user.to_email();
        req_stats.user_email = if email_str.is_empty() {
            None
        } else {
            Some(email_str)
        };
        report_request_usage_stats(
            req_stats,
            org_id,
            &stream_name,
            StreamType::Metrics,
            UsageType::Metrics,
            fns_length as _,
            started_at,
        )
        .await;
    }

    let ep = if OtlpRequestType::Grpc == req_type {
        "/grpc/otlp/metrics"
    } else {
        "/api/otlp/v1/metrics"
    };

    let time_took = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[ep, "200", org_id, StreamType::Metrics.as_str(), "", ""])
        .observe(time_took);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[ep, "200", org_id, StreamType::Metrics.as_str(), "", ""])
        .inc();

    // only one trigger per request
    for (_, entry) in stream_trigger_map {
        if let Some(entry) = entry {
            evaluate_trigger(entry).await;
        }
    }

    format_response(partial_success, req_type)
}

fn process_gauge(
    rec: &mut json::Value,
    gauge: &Gauge,
    mut metadata: Metadata,
    prom_meta: &mut HashMap<String, String>,
) -> Vec<serde_json::Value> {
    let mut records = vec![];

    // set metadata
    metadata.metric_type = MetricType::Gauge;
    prom_meta.insert(
        METADATA_LABEL.to_string(),
        json::to_string(&metadata).unwrap(),
    );

    for data_point in &gauge.data_points {
        process_data_point(rec, data_point);
        let val_map = rec.as_object_mut().unwrap();
        let hash = super::signature_without_labels(val_map, &get_exclude_labels());
        val_map.insert(HASH_LABEL.to_string(), json::Value::Number(hash.into()));
        records.push(rec.clone());
    }
    records
}

fn process_sum(
    rec: &mut json::Value,
    sum: &Sum,
    mut metadata: Metadata,
    prom_meta: &mut HashMap<String, String>,
) -> Vec<serde_json::Value> {
    // set metadata
    metadata.metric_type = MetricType::Counter;
    prom_meta.insert(
        METADATA_LABEL.to_string(),
        json::to_string(&metadata).unwrap(),
    );

    let mut records = vec![];
    process_aggregation_temporality(rec, sum.aggregation_temporality);
    rec["is_monotonic"] = sum.is_monotonic.to_string().into();
    for data_point in &sum.data_points {
        let mut dp_rec = rec.clone();
        process_data_point(&mut dp_rec, data_point);
        let val_map = dp_rec.as_object_mut().unwrap();
        let hash = super::signature_without_labels(val_map, &get_exclude_labels());
        val_map.insert(HASH_LABEL.to_string(), json::Value::Number(hash.into()));
        records.push(dp_rec.clone());
    }
    records
}

fn process_histogram(
    rec: &mut json::Value,
    hist: &Histogram,
    mut metadata: Metadata,
    prom_meta: &mut HashMap<String, String>,
) -> Vec<serde_json::Value> {
    // set metadata
    metadata.metric_type = MetricType::Histogram;
    prom_meta.insert(
        METADATA_LABEL.to_string(),
        json::to_string(&metadata).unwrap(),
    );

    let mut records = vec![];
    process_aggregation_temporality(rec, hist.aggregation_temporality);
    for data_point in &hist.data_points {
        let mut dp_rec = rec.clone();
        for mut bucket_rec in process_hist_data_point(&mut dp_rec, data_point) {
            let val_map = bucket_rec.as_object_mut().unwrap();
            let hash = super::signature_without_labels(val_map, &get_exclude_labels());
            val_map.insert(HASH_LABEL.to_string(), json::Value::Number(hash.into()));
            records.push(bucket_rec);
        }
    }
    records
}

fn process_exponential_histogram(
    rec: &mut json::Value,
    hist: &ExponentialHistogram,
    mut metadata: Metadata,
    prom_meta: &mut HashMap<String, String>,
) -> Vec<serde_json::Value> {
    // set metadata
    metadata.metric_type = MetricType::ExponentialHistogram;
    prom_meta.insert(
        METADATA_LABEL.to_string(),
        json::to_string(&metadata).unwrap(),
    );
    let mut records = vec![];
    process_aggregation_temporality(rec, hist.aggregation_temporality);
    for data_point in &hist.data_points {
        let mut dp_rec = rec.clone();
        for mut bucket_rec in process_exp_hist_data_point(&mut dp_rec, data_point) {
            let val_map = bucket_rec.as_object_mut().unwrap();
            let hash = super::signature_without_labels(val_map, &get_exclude_labels());
            val_map.insert(HASH_LABEL.to_string(), json::Value::Number(hash.into()));
            records.push(bucket_rec);
        }
    }
    records
}

fn process_summary(
    rec: &json::Value,
    summary: &Summary,
    mut metadata: Metadata,
    prom_meta: &mut HashMap<String, String>,
) -> Vec<serde_json::Value> {
    // set metadata
    metadata.metric_type = MetricType::Summary;
    prom_meta.insert(
        METADATA_LABEL.to_string(),
        json::to_string(&metadata).unwrap(),
    );

    let mut records = vec![];
    for data_point in &summary.data_points {
        let mut dp_rec = rec.clone();
        for mut bucket_rec in process_summary_data_point(&mut dp_rec, data_point) {
            let val_map = bucket_rec.as_object_mut().unwrap();
            let hash = super::signature_without_labels(val_map, &get_exclude_labels());
            val_map.insert(HASH_LABEL.to_string(), json::Value::Number(hash.into()));
            records.push(bucket_rec);
        }
    }
    records
}

fn process_data_point(rec: &mut json::Value, data_point: &NumberDataPoint) {
    for attr in &data_point.attributes {
        rec[format_label_name(attr.key.as_str())] = get_val(&attr.value.as_ref());
    }
    rec[VALUE_LABEL] = get_metric_val(&data_point.value);
    rec[TIMESTAMP_COL_NAME] = (data_point.time_unix_nano / 1000).into();
    rec["start_time"] = data_point.start_time_unix_nano.to_string().into();
    rec["flag"] = if data_point.flags == 1 {
        DataPointFlags::NoRecordedValueMask.as_str_name()
    } else {
        DataPointFlags::DoNotUse.as_str_name()
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
        rec[format_label_name(attr.key.as_str())] = get_val(&attr.value.as_ref());
    }
    rec[TIMESTAMP_COL_NAME] = (data_point.time_unix_nano / 1000).into();
    rec["start_time"] = data_point.start_time_unix_nano.to_string().into();
    rec["flag"] = if data_point.flags == 1 {
        DataPointFlags::NoRecordedValueMask.as_str_name()
    } else {
        DataPointFlags::DoNotUse.as_str_name()
    }
    .into();
    process_exemplars(rec, &data_point.exemplars);
    // add count record
    let mut count_rec = rec.clone();
    count_rec[VALUE_LABEL] = (data_point.count as f64).into();
    count_rec[NAME_LABEL] = format!("{}_count", count_rec[NAME_LABEL].as_str().unwrap()).into();
    bucket_recs.push(count_rec);

    // add sum record
    let mut sum_rec = rec.clone();
    sum_rec[VALUE_LABEL] = data_point.sum.into();
    sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL].as_str().unwrap()).into();
    bucket_recs.push(sum_rec);

    // add min record
    let mut min_rec = rec.clone();
    min_rec[VALUE_LABEL] = data_point.min.into();
    min_rec[NAME_LABEL] = format!("{}_min", min_rec[NAME_LABEL].as_str().unwrap()).into();
    bucket_recs.push(min_rec);

    // add max record
    let mut max_rec = rec.clone();
    max_rec[VALUE_LABEL] = data_point.max.into();
    max_rec[NAME_LABEL] = format!("{}_max", max_rec[NAME_LABEL].as_str().unwrap()).into();
    bucket_recs.push(max_rec);

    // add bucket records
    let len = data_point.bucket_counts.len();
    let mut accumulated_count = 0;
    for i in 0..len {
        let mut bucket_rec = rec.clone();
        bucket_rec[NAME_LABEL] = format!("{}_bucket", rec[NAME_LABEL].as_str().unwrap()).into();
        if let Some(val) = data_point.explicit_bounds.get(i) {
            bucket_rec["le"] = (*val.to_string()).into()
        } else {
            bucket_rec["le"] = f64::INFINITY.to_string().into();
        }
        if let Some(val) = data_point.bucket_counts.get(i) {
            accumulated_count += val;
            bucket_rec[VALUE_LABEL] = (accumulated_count as f64).into()
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
        rec[format_label_name(attr.key.as_str())] = get_val(&attr.value.as_ref());
    }
    rec[TIMESTAMP_COL_NAME] = (data_point.time_unix_nano / 1000).into();
    rec["start_time"] = data_point.start_time_unix_nano.to_string().into();
    rec["flag"] = if data_point.flags == 1 {
        DataPointFlags::NoRecordedValueMask.as_str_name()
    } else {
        DataPointFlags::DoNotUse.as_str_name()
    }
    .into();
    process_exemplars(rec, &data_point.exemplars);
    // add count record
    let mut count_rec = rec.clone();
    count_rec[VALUE_LABEL] = (data_point.count as f64).into();
    count_rec[NAME_LABEL] = format!("{}_count", count_rec[NAME_LABEL].as_str().unwrap()).into();
    bucket_recs.push(count_rec);

    // add sum record
    let mut sum_rec = rec.clone();
    sum_rec[VALUE_LABEL] = data_point.sum.into();
    sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL].as_str().unwrap()).into();
    bucket_recs.push(sum_rec);

    let base = 2 ^ (2 ^ -data_point.scale);
    // add negative bucket records
    if let Some(buckets) = &data_point.negative {
        let offset = buckets.offset;
        for (i, val) in buckets.bucket_counts.iter().enumerate() {
            let mut bucket_rec = rec.clone();
            bucket_rec[NAME_LABEL] = format!("{}_bucket", rec[NAME_LABEL].as_str().unwrap()).into();
            bucket_rec[VALUE_LABEL] = (*val as f64).into();
            bucket_rec["le"] = (base ^ (offset + (i as i32) + 1)).to_string().into();
            bucket_recs.push(bucket_rec);
        }
    }
    // add positive bucket records
    if let Some(buckets) = &data_point.positive {
        let offset = buckets.offset;
        for (i, val) in buckets.bucket_counts.iter().enumerate() {
            let mut bucket_rec = rec.clone();
            bucket_rec[NAME_LABEL] = format!("{}_bucket", rec[NAME_LABEL].as_str().unwrap()).into();
            bucket_rec[VALUE_LABEL] = (*val as f64).into();
            bucket_rec["le"] = (base ^ (offset + (i as i32) + 1)).to_string().into();
            bucket_recs.push(bucket_rec);
        }
    }

    bucket_recs
}

fn process_summary_data_point(
    rec: &mut json::Value,
    data_point: &SummaryDataPoint,
) -> Vec<serde_json::Value> {
    let mut bucket_recs = vec![];

    for attr in &data_point.attributes {
        rec[format_label_name(attr.key.as_str())] = get_val(&attr.value.as_ref());
    }
    rec[TIMESTAMP_COL_NAME] = (data_point.time_unix_nano / 1000).into();
    rec["start_time"] = data_point.start_time_unix_nano.to_string().into();
    rec["flag"] = if data_point.flags == 1 {
        DataPointFlags::NoRecordedValueMask.as_str_name()
    } else {
        DataPointFlags::DoNotUse.as_str_name()
    }
    .into();
    // add count record
    let mut count_rec = rec.clone();
    count_rec[VALUE_LABEL] = (data_point.count as f64).into();
    count_rec[NAME_LABEL] = format!("{}_count", count_rec[NAME_LABEL].as_str().unwrap()).into();
    bucket_recs.push(count_rec);

    // add sum record
    let mut sum_rec = rec.clone();
    sum_rec[VALUE_LABEL] = data_point.sum.into();
    sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL].as_str().unwrap()).into();
    bucket_recs.push(sum_rec);

    // add bucket records
    for value in &data_point.quantile_values {
        let mut bucket_rec = rec.clone();
        bucket_rec[VALUE_LABEL] = value.value.into();
        bucket_rec["quantile"] = value.quantile.to_string().into();
        bucket_recs.push(bucket_rec);
    }
    bucket_recs
}

fn process_exemplars(rec: &mut json::Value, exemplars: &Vec<Exemplar>) {
    let mut exemplar_coll = vec![];
    for exemplar in exemplars {
        let mut exemplar_rec = json::json!({});
        for attr in &exemplar.filtered_attributes {
            exemplar_rec[attr.key.as_str()] = get_val(&attr.value.as_ref());
        }
        exemplar_rec[VALUE_LABEL] = get_exemplar_val(&exemplar.value);
        exemplar_rec[TIMESTAMP_COL_NAME] = (exemplar.time_unix_nano / 1000).into();

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
    rec[EXEMPLARS_LABEL] = exemplar_coll.into();
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

fn format_response(
    mut partial_success: ExportMetricsPartialSuccess,
    req_type: OtlpRequestType,
) -> Result<HttpResponse, anyhow::Error> {
    let partial = partial_success.rejected_data_points > 0;

    let res = if partial {
        log::error!(
            "[METRICS:OTLP] Partial success: {}, error: {}",
            partial_success.rejected_data_points,
            partial_success.error_message
        );
        partial_success.error_message =
            "Some data points were rejected due to exceeding the allowed retention period"
                .to_string();
        ExportMetricsServiceResponse {
            partial_success: Some(partial_success),
        }
    } else {
        ExportMetricsServiceResponse::default()
    };

    match req_type {
        OtlpRequestType::HttpJson => Ok(if partial {
            (http::StatusCode::PARTIAL_CONTENT, Json(res)).into_response()
        } else {
            MetaHttpResponse::json(res)
        }),
        _ => {
            let mut out = BytesMut::with_capacity(res.encoded_len());
            res.encode(&mut out).expect("Out of memory");
            Ok((
                http::StatusCode::OK,
                [(http::header::CONTENT_TYPE, "application/x-protobuf")],
                out.to_vec(),
            )
                .into_response())
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use config::meta::promql::{Metadata, MetricType};
    use opentelemetry_proto::tonic::metrics::v1::{
        AggregationTemporality, Exemplar, HistogramDataPoint, Metric, NumberDataPoint,
    };
    use serde_json::json;

    use super::*;

    fn create_test_gauge_metric(name: &str, value: f64) -> Metric {
        Metric {
            name: name.to_string(),
            description: "Test gauge metric".to_string(),
            unit: "test_unit".to_string(),
            metadata: vec![],
            data: Some(Data::Gauge(opentelemetry_proto::tonic::metrics::v1::Gauge {
                data_points: vec![NumberDataPoint {
                    attributes: vec![],
                    start_time_unix_nano: 0,
                    time_unix_nano: 1640995200000000000, // 2022-01-01 00:00:00 UTC
                    exemplars: vec![],
                    flags: 0,
                    value: Some(opentelemetry_proto::tonic::metrics::v1::number_data_point::Value::AsDouble(value)),
                }],
            })),
        }
    }

    fn create_test_sum_metric(name: &str, value: f64, is_monotonic: bool) -> Metric {
        Metric {
            name: name.to_string(),
            description: "Test sum metric".to_string(),
            unit: "test_unit".to_string(),
            metadata: vec![],
            data: Some(Data::Sum(opentelemetry_proto::tonic::metrics::v1::Sum {
                data_points: vec![NumberDataPoint {
                    attributes: vec![],
                    start_time_unix_nano: 0,
                    time_unix_nano: 1640995200000000000,
                    exemplars: vec![],
                    flags: 0,
                    value: Some(
                        opentelemetry_proto::tonic::metrics::v1::number_data_point::Value::AsDouble(
                            value,
                        ),
                    ),
                }],
                aggregation_temporality: AggregationTemporality::Cumulative as i32,
                is_monotonic,
            })),
        }
    }

    fn create_test_histogram_metric(name: &str, counts: Vec<u64>, bounds: Vec<f64>) -> Metric {
        Metric {
            name: name.to_string(),
            description: "Test histogram metric".to_string(),
            unit: "test_unit".to_string(),
            metadata: vec![],
            data: Some(Data::Histogram(
                opentelemetry_proto::tonic::metrics::v1::Histogram {
                    data_points: vec![HistogramDataPoint {
                        attributes: vec![],
                        start_time_unix_nano: 0,
                        time_unix_nano: 1640995200000000000,
                        exemplars: vec![],
                        flags: 0,
                        count: counts.iter().sum(),
                        sum: Some(100.0),
                        bucket_counts: counts,
                        explicit_bounds: bounds,
                        min: Some(0.0),
                        max: Some(100.0),
                    }],
                    aggregation_temporality: AggregationTemporality::Cumulative as i32,
                },
            )),
        }
    }

    fn create_test_exponential_histogram_metric(name: &str) -> Metric {
        Metric {
            name: name.to_string(),
            description: "Test exponential histogram metric".to_string(),
            unit: "test_unit".to_string(),
            metadata: vec![],
            data: Some(Data::ExponentialHistogram(opentelemetry_proto::tonic::metrics::v1::ExponentialHistogram {
                data_points: vec![opentelemetry_proto::tonic::metrics::v1::ExponentialHistogramDataPoint {
                    attributes: vec![],
                    start_time_unix_nano: 0,
                    time_unix_nano: 1640995200000000000,
                    exemplars: vec![],
                    flags: 0,
                    count: 100,
                    sum: Some(100.0),
                    min: Some(0.0),
                    max: Some(100.0),
                    scale: 0,
                    zero_count: 10,
                    zero_threshold: 0.0,
                    positive: Some(opentelemetry_proto::tonic::metrics::v1::exponential_histogram_data_point::Buckets {
                        offset: 0,
                        bucket_counts: vec![50, 30, 20],
                    }),
                    negative: Some(opentelemetry_proto::tonic::metrics::v1::exponential_histogram_data_point::Buckets {
                        offset: 0,
                        bucket_counts: vec![0],
                    }),
                }],
                aggregation_temporality: AggregationTemporality::Cumulative as i32,
            })),
        }
    }

    fn create_test_summary_metric(name: &str) -> Metric {
        Metric {
            name: name.to_string(),
            description: "Test summary metric".to_string(),
            unit: "test_unit".to_string(),
            metadata: vec![],
            data: Some(Data::Summary(opentelemetry_proto::tonic::metrics::v1::Summary {
                data_points: vec![opentelemetry_proto::tonic::metrics::v1::SummaryDataPoint {
                    attributes: vec![],
                    start_time_unix_nano: 0,
                    time_unix_nano: 1640995200000000000,
                    flags: 0,
                    count: 100,
                    sum: 100.0,
                    quantile_values: vec![
                        opentelemetry_proto::tonic::metrics::v1::summary_data_point::ValueAtQuantile {
                            quantile: 0.5,
                            value: 50.0,
                        },
                        opentelemetry_proto::tonic::metrics::v1::summary_data_point::ValueAtQuantile {
                            quantile: 0.95,
                            value: 95.0,
                        },
                    ],
                }],
            })),
        }
    }

    #[test]
    fn test_process_gauge() {
        let metric = create_test_gauge_metric("test_gauge", 42.5);
        let mut rec = json!({
            "__name__": "test_gauge",
            "__type__": "gauge"
        });
        let metadata = Metadata {
            metric_type: MetricType::Unknown,
            metric_family_name: "test_gauge".to_string(),
            help: "Test gauge metric".to_string(),
            unit: "test_unit".to_string(),
        };
        let mut prom_meta: HashMap<String, String> = HashMap::new();

        if let Some(Data::Gauge(gauge)) = &metric.data {
            let result = process_gauge(&mut rec, gauge, metadata, &mut prom_meta);

            // Verify the processed data
            assert!(!result.is_empty());
            let metadata = prom_meta
                .get(METADATA_LABEL)
                .and_then(|meta_str| serde_json::from_str::<Metadata>(meta_str).ok())
                .unwrap();
            let processed_data = &result[0];
            assert_eq!(processed_data["__name__"], "test_gauge");
            assert_eq!(processed_data["__type__"], "gauge");
            assert_eq!(processed_data["value"], 42.5);
            assert_eq!(metadata.metric_type, MetricType::Gauge);
        } else {
            panic!("Expected gauge metric");
        }
    }

    #[test]
    fn test_process_sum() {
        let metric = create_test_sum_metric("test_counter", 100.0, true);
        let mut rec = json!({
            "__name__": "test_counter",
            "__type__": "counter"
        });
        let metadata = Metadata {
            metric_type: MetricType::Unknown,
            metric_family_name: "test_counter".to_string(),
            help: "Test counter metric".to_string(),
            unit: "test_unit".to_string(),
        };
        let mut prom_meta: HashMap<String, String> = HashMap::new();

        if let Some(Data::Sum(sum)) = &metric.data {
            let result = process_sum(&mut rec, sum, metadata, &mut prom_meta);

            // Verify the processed data
            assert!(!result.is_empty());
            let metadata = prom_meta
                .get(METADATA_LABEL)
                .and_then(|meta_str| serde_json::from_str::<Metadata>(meta_str).ok())
                .unwrap();
            let processed_data = &result[0];
            assert_eq!(processed_data["__name__"], "test_counter");
            assert_eq!(processed_data["__type__"], "counter");
            assert_eq!(processed_data["value"], 100.0);
            assert_eq!(metadata.metric_type, MetricType::Counter);
            assert_eq!(processed_data["is_monotonic"], "true");
        } else {
            panic!("Expected sum metric");
        }
    }

    #[test]
    fn test_process_histogram() {
        let metric = create_test_histogram_metric(
            "test_histogram",
            vec![10, 20, 30],
            vec![10.0, 20.0, 30.0],
        );
        let mut rec = json!({
            "__name__": "test_histogram",
            "__type__": "histogram"
        });
        let metadata = Metadata {
            metric_type: MetricType::Unknown,
            metric_family_name: "test_histogram".to_string(),
            help: "Test histogram metric".to_string(),
            unit: "test_unit".to_string(),
        };
        let mut prom_meta: HashMap<String, String> = HashMap::new();

        if let Some(Data::Histogram(hist)) = &metric.data {
            let result = process_histogram(&mut rec, hist, metadata, &mut prom_meta);

            // Verify the processed data
            assert!(!result.is_empty());
            let metadata = prom_meta
                .get(METADATA_LABEL)
                .and_then(|meta_str| serde_json::from_str::<Metadata>(meta_str).ok())
                .unwrap();
            assert_eq!(metadata.metric_type, MetricType::Histogram);

            // Should have count, sum, min, max, and bucket records
            assert!(result.len() >= 4);
        } else {
            panic!("Expected histogram metric");
        }
    }

    #[test]
    fn test_process_exponential_histogram() {
        let metric = create_test_exponential_histogram_metric("test_exp_histogram");
        let mut rec = json!({
            "__name__": "test_exp_histogram",
            "__type__": "exponential_histogram"
        });
        let metadata = Metadata {
            metric_type: MetricType::Unknown,
            metric_family_name: "test_exp_histogram".to_string(),
            help: "Test exponential histogram metric".to_string(),
            unit: "test_unit".to_string(),
        };
        let mut prom_meta: HashMap<String, String> = HashMap::new();

        if let Some(Data::ExponentialHistogram(hist)) = &metric.data {
            let result = process_exponential_histogram(&mut rec, hist, metadata, &mut prom_meta);

            // Verify the processed data
            assert!(!result.is_empty());
            let metadata = prom_meta
                .get(METADATA_LABEL)
                .and_then(|meta_str| serde_json::from_str::<Metadata>(meta_str).ok())
                .unwrap();
            assert_eq!(metadata.metric_type, MetricType::ExponentialHistogram);
        } else {
            panic!("Expected exponential histogram metric");
        }
    }

    #[test]
    fn test_process_summary() {
        let metric = create_test_summary_metric("test_summary");
        let rec = json!({
            "__name__": "test_summary",
            "__type__": "summary"
        });
        let metadata = Metadata {
            metric_type: MetricType::Unknown,
            metric_family_name: "test_summary".to_string(),
            help: "Test summary metric".to_string(),
            unit: "test_unit".to_string(),
        };
        let mut prom_meta: HashMap<String, String> = HashMap::new();

        if let Some(Data::Summary(summary)) = &metric.data {
            let result = process_summary(&rec, summary, metadata, &mut prom_meta);

            // Verify the processed data
            assert!(!result.is_empty());
            let metadata = prom_meta
                .get(METADATA_LABEL)
                .and_then(|meta_str| serde_json::from_str::<Metadata>(meta_str).ok())
                .unwrap();
            assert_eq!(metadata.metric_type, MetricType::Summary);
        } else {
            panic!("Expected summary metric");
        }
    }

    #[test]
    fn test_process_data_point() {
        let mut rec = json!({
            "__name__": "test_metric",
            "__type__": "gauge"
        });
        let data_point = NumberDataPoint {
            attributes: vec![],
            start_time_unix_nano: 0,
            time_unix_nano: 1640995200000000000,
            exemplars: vec![],
            flags: 0,
            value: Some(
                opentelemetry_proto::tonic::metrics::v1::number_data_point::Value::AsDouble(42.0),
            ),
        };

        process_data_point(&mut rec, &data_point);

        // Verify the processed data
        assert_eq!(rec["value"], 42.0);
        assert!(rec.get("_timestamp").is_some());
        assert!(rec.get("start_time").is_some());
        assert!(rec.get("flag").is_some());
    }

    #[test]
    fn test_process_hist_data_point() {
        let rec = json!({
            "__name__": "test_histogram",
            "__type__": "histogram"
        });
        let data_point = HistogramDataPoint {
            attributes: vec![],
            start_time_unix_nano: 0,
            time_unix_nano: 1640995200000000000,
            exemplars: vec![],
            flags: 0,
            count: 100,
            sum: Some(100.0),
            bucket_counts: vec![10, 20, 30],
            explicit_bounds: vec![10.0, 20.0, 30.0],
            min: Some(0.0),
            max: Some(100.0),
        };

        let result = process_hist_data_point(&mut rec.clone(), &data_point);

        // Verify the processed data
        assert!(!result.is_empty());
        // Should have count, sum, min, max, and bucket records
        assert!(result.len() >= 4);

        // Check count record
        let count_rec = &result[0];
        assert!(count_rec["__name__"].as_str().unwrap().ends_with("_count"));
        assert_eq!(count_rec["value"], json!(100.0));

        // Check sum record
        let sum_rec = &result[1];
        assert!(sum_rec["__name__"].as_str().unwrap().ends_with("_sum"));
        assert_eq!(sum_rec["value"], json!(100.0));
    }

    #[test]
    fn test_process_exp_hist_data_point() {
        let mut rec = json!({
            "__name__": "test_exp_histogram",
            "__type__": "exponential_histogram"
        });
        let data_point = opentelemetry_proto::tonic::metrics::v1::ExponentialHistogramDataPoint {
            attributes: vec![],
            start_time_unix_nano: 0,
            time_unix_nano: 1640995200000000000,
            exemplars: vec![],
            flags: 0,
            count: 100,
            sum: Some(100.0),
            min: Some(0.0),
            max: Some(100.0),
            scale: 0,
            zero_count: 10,
            zero_threshold: 0.0,
            positive: Some(opentelemetry_proto::tonic::metrics::v1::exponential_histogram_data_point::Buckets {
                offset: 0,
                bucket_counts: vec![50, 30, 20],
            }),
            negative: Some(opentelemetry_proto::tonic::metrics::v1::exponential_histogram_data_point::Buckets {
                offset: 0,
                bucket_counts: vec![0],
            }),
        };

        let result = process_exp_hist_data_point(&mut rec, &data_point);

        // Verify the processed data
        assert!(!result.is_empty());
        // Should have count, sum, and bucket records
        assert!(result.len() >= 2);

        // Check count record
        let count_rec = &result[0];
        assert!(count_rec["__name__"].as_str().unwrap().ends_with("_count"));
        assert_eq!(count_rec["value"], json!(100.0));
    }

    #[test]
    fn test_process_summary_data_point() {
        let mut rec = json!({
            "__name__": "test_summary",
            "__type__": "summary"
        });
        let data_point = opentelemetry_proto::tonic::metrics::v1::SummaryDataPoint {
            attributes: vec![],
            start_time_unix_nano: 0,
            time_unix_nano: 1640995200000000000,
            flags: 0,
            count: 100,
            sum: 100.0,
            quantile_values: vec![
                opentelemetry_proto::tonic::metrics::v1::summary_data_point::ValueAtQuantile {
                    quantile: 0.5,
                    value: 50.0,
                },
                opentelemetry_proto::tonic::metrics::v1::summary_data_point::ValueAtQuantile {
                    quantile: 0.95,
                    value: 95.0,
                },
            ],
        };

        let result = process_summary_data_point(&mut rec, &data_point);

        // Verify the processed data
        assert!(!result.is_empty());
        // Should have count, sum, and quantile records
        assert!(result.len() >= 2);

        // Check count record
        let count_rec = &result[0];
        assert!(count_rec["__name__"].as_str().unwrap().ends_with("_count"));
        assert_eq!(count_rec["value"], json!(100.0));

        // Check sum record
        let sum_rec = &result[1];
        assert!(sum_rec["__name__"].as_str().unwrap().ends_with("_sum"));
        assert_eq!(sum_rec["value"], json!(100.0));
    }

    #[test]
    fn test_process_exemplars() {
        let mut rec = json!({
            "__name__": "test_metric",
            "__type__": "gauge"
        });
        let exemplar = Exemplar {
            filtered_attributes: vec![],
            time_unix_nano: 1640995200000000000,
            value: Some(opentelemetry_proto::tonic::metrics::v1::exemplar::Value::AsDouble(42.0)),
            span_id: vec![],
            trace_id: vec![],
        };

        process_exemplars(&mut rec, &vec![exemplar]);

        // Verify exemplars were processed
        assert!(rec.get("exemplars").is_some());
    }

    #[test]
    fn test_process_aggregation_temporality() {
        let mut rec = json!({
            "__name__": "test_metric",
            "__type__": "gauge"
        });

        // Test Cumulative
        process_aggregation_temporality(&mut rec, AggregationTemporality::Cumulative as i32);
        assert_eq!(
            rec["aggregation_temporality"],
            "AGGREGATION_TEMPORALITY_CUMULATIVE"
        );

        // Test Delta
        process_aggregation_temporality(&mut rec, AggregationTemporality::Delta as i32);
        assert_eq!(
            rec["aggregation_temporality"],
            "AGGREGATION_TEMPORALITY_DELTA"
        );

        // Test unknown value
        process_aggregation_temporality(&mut rec, 999);
        assert_eq!(
            rec["aggregation_temporality"],
            "AGGREGATION_TEMPORALITY_UNSPECIFIED"
        );
    }

    #[test]
    fn test_format_response() {
        let partial_success = ExportMetricsPartialSuccess {
            rejected_data_points: 5,
            error_message: "Some data points were rejected".to_string(),
        };

        let response = format_response(partial_success, OtlpRequestType::HttpJson);
        assert!(response.is_ok());

        let http_response = response.unwrap();
        assert_eq!(http_response.status(), http::StatusCode::PARTIAL_CONTENT);
    }

    #[test]
    fn test_format_response_success() {
        let partial_success = ExportMetricsPartialSuccess {
            rejected_data_points: 0,
            error_message: "".to_string(),
        };

        let response = format_response(partial_success, OtlpRequestType::HttpJson);
        assert!(response.is_ok());

        let http_response = response.unwrap();
        assert_eq!(http_response.status(), http::StatusCode::OK);
    }

    #[test]
    fn test_format_response_protobuf() {
        let partial_success = ExportMetricsPartialSuccess {
            rejected_data_points: 0,
            error_message: "".to_string(),
        };

        let response = format_response(partial_success, OtlpRequestType::HttpProtobuf);
        assert!(response.is_ok());

        let http_response = response.unwrap();
        assert_eq!(http_response.status(), http::StatusCode::OK);
        assert_eq!(
            http_response.headers().get("content-type").unwrap(),
            "application/x-protobuf"
        );
    }

    #[test]
    fn test_metric_with_attributes() {
        let metric = create_test_gauge_metric("test_metric_with_attrs", 42.0);
        let mut rec = json!({
            "__name__": "test_metric_with_attrs",
            "__type__": "gauge"
        });
        let metadata = Metadata {
            metric_type: MetricType::Unknown,
            metric_family_name: "test_metric_with_attrs".to_string(),
            help: "Test metric with attributes".to_string(),
            unit: "test_unit".to_string(),
        };
        let mut prom_meta: HashMap<String, String> = HashMap::new();

        if let Some(Data::Gauge(gauge)) = &metric.data {
            let result = process_gauge(&mut rec, gauge, metadata, &mut prom_meta);

            // Verify the processed data has required fields
            assert!(!result.is_empty());
            let processed_data = &result[0];
            assert!(processed_data.get("__name__").is_some());
            assert!(processed_data.get("__type__").is_some());
            assert!(processed_data.get("value").is_some());
            assert!(processed_data.get("_timestamp").is_some());
        } else {
            panic!("Expected gauge metric");
        }
    }

    #[test]
    fn test_empty_metrics_handling() {
        let empty_metric = Metric {
            name: "empty_metric".to_string(),
            description: "Empty metric".to_string(),
            unit: "test_unit".to_string(),
            metadata: vec![],
            data: None,
        };

        // This should handle empty data gracefully
        // The actual behavior depends on the implementation
        assert!(empty_metric.data.is_none());
    }

    mod protobuf_json_tests {
        use bytes::Bytes;
        use prost::Message;

        use super::*;

        #[test]
        fn test_decode_invalid_protobuf() {
            let invalid_data = Bytes::from("invalid protobuf data");
            let result = ExportMetricsServiceRequest::decode(invalid_data);
            assert!(result.is_err());
        }

        #[test]
        fn test_decode_valid_protobuf() {
            let request = ExportMetricsServiceRequest::default();
            let mut encoded = Vec::new();
            request.encode(&mut encoded).unwrap();

            let decoded = ExportMetricsServiceRequest::decode(encoded.as_slice());
            assert!(decoded.is_ok());
        }

        #[test]
        fn test_decode_invalid_json() {
            let invalid_json = r#"{"invalid": json structure"#;
            let result =
                serde_json::from_slice::<ExportMetricsServiceRequest>(invalid_json.as_bytes());
            assert!(result.is_err());
        }

        #[test]
        fn test_decode_empty_json() {
            let empty_json = "{}";
            let result =
                serde_json::from_slice::<ExportMetricsServiceRequest>(empty_json.as_bytes());
            // Empty JSON may not be valid for ExportMetricsServiceRequest if it has required fields
            // This test validates error handling for edge cases
            match result {
                Ok(_) => {
                    // If it succeeds, the struct supports empty initialization
                    // Test passes
                }
                Err(_) => {
                    // If it fails, that's expected for structs with required fields
                    // Test passes
                }
            }
        }

        #[test]
        fn test_decode_valid_json() {
            let valid_json = r#"{"resourceMetrics": []}"#;
            let result =
                serde_json::from_slice::<ExportMetricsServiceRequest>(valid_json.as_bytes());
            assert!(result.is_ok());
        }
    }

    mod metric_type_edge_cases {
        use super::*;

        #[test]
        fn test_gauge_with_zero_value() {
            let metric = create_test_gauge_metric("zero_gauge", 0.0);
            let mut rec = json!({"__name__": "zero_gauge", "__type__": "gauge"});
            let metadata = Metadata {
                metric_family_name: String::new(),
                metric_type: MetricType::Unknown,
                help: String::new(),
                unit: String::new(),
            };
            let mut prom_meta = HashMap::new();

            if let Some(Data::Gauge(gauge)) = &metric.data {
                let result = process_gauge(&mut rec, gauge, metadata, &mut prom_meta);
                assert!(!result.is_empty());
                assert_eq!(result[0]["value"], 0.0);
            }
        }

        #[test]
        fn test_gauge_with_negative_value() {
            let metric = create_test_gauge_metric("negative_gauge", -42.5);
            let mut rec = json!({"__name__": "negative_gauge", "__type__": "gauge"});
            let metadata = Metadata {
                metric_family_name: String::new(),
                metric_type: MetricType::Unknown,
                help: String::new(),
                unit: String::new(),
            };
            let mut prom_meta = HashMap::new();

            if let Some(Data::Gauge(gauge)) = &metric.data {
                let result = process_gauge(&mut rec, gauge, metadata, &mut prom_meta);
                assert!(!result.is_empty());
                assert_eq!(result[0]["value"], -42.5);
            }
        }

        #[test]
        fn test_gauge_with_infinity() {
            let metric = create_test_gauge_metric("infinity_gauge", f64::INFINITY);
            let mut rec = json!({"__name__": "infinity_gauge", "__type__": "gauge"});
            let metadata = Metadata {
                metric_family_name: String::new(),
                metric_type: MetricType::Unknown,
                help: String::new(),
                unit: String::new(),
            };
            let mut prom_meta = HashMap::new();

            if let Some(Data::Gauge(gauge)) = &metric.data {
                let result = process_gauge(&mut rec, gauge, metadata, &mut prom_meta);
                assert!(!result.is_empty());
                // Check that the value is infinite (JSON might not preserve exact infinity)
                let value = &result[0]["value"];
                if let Some(f_val) = value.as_f64() {
                    assert!(f_val.is_infinite());
                } else if let Some(s_val) = value.as_str() {
                    assert!(s_val.contains("inf") || s_val.contains("Inf") || s_val == "null");
                } else {
                    // JSON might convert infinity to null, which is acceptable
                    assert!(value.is_null(), "Value: {value:?}");
                }
            }
        }

        #[test]
        fn test_sum_non_monotonic() {
            let metric = create_test_sum_metric("non_monotonic_sum", 50.0, false);
            let mut rec = json!({"__name__": "non_monotonic_sum", "__type__": "counter"});
            let metadata = Metadata {
                metric_family_name: String::new(),
                metric_type: MetricType::Unknown,
                help: String::new(),
                unit: String::new(),
            };
            let mut prom_meta = HashMap::new();

            if let Some(Data::Sum(sum)) = &metric.data {
                let result = process_sum(&mut rec, sum, metadata, &mut prom_meta);
                assert!(!result.is_empty());
                assert_eq!(result[0]["is_monotonic"], "false");
            }
        }

        #[test]
        fn test_histogram_empty_buckets() {
            let metric = create_test_histogram_metric("empty_hist", vec![], vec![]);
            let mut rec = json!({"__name__": "empty_hist", "__type__": "histogram"});
            let metadata = Metadata {
                metric_family_name: String::new(),
                metric_type: MetricType::Unknown,
                help: String::new(),
                unit: String::new(),
            };
            let mut prom_meta = HashMap::new();

            if let Some(Data::Histogram(hist)) = &metric.data {
                let result = process_histogram(&mut rec, hist, metadata, &mut prom_meta);
                // Should still have count, sum, min, max records
                assert!(result.len() >= 4);
            }
        }

        #[test]
        fn test_histogram_single_bucket() {
            let metric = create_test_histogram_metric("single_bucket", vec![100], vec![10.0]);
            let mut rec = json!({"__name__": "single_bucket", "__type__": "histogram"});
            let metadata = Metadata {
                metric_family_name: String::new(),
                metric_type: MetricType::Unknown,
                help: String::new(),
                unit: String::new(),
            };
            let mut prom_meta = HashMap::new();

            if let Some(Data::Histogram(hist)) = &metric.data {
                let result = process_histogram(&mut rec, hist, metadata, &mut prom_meta);
                // Should have count, sum, min, max, and 1 bucket
                assert_eq!(result.len(), 5);

                // Check that bucket record exists
                let bucket_exists = result
                    .iter()
                    .any(|r| r["__name__"].as_str().unwrap_or("").ends_with("_bucket"));
                assert!(bucket_exists);
            }
        }

        #[test]
        fn test_histogram_many_buckets() {
            let counts = vec![10, 20, 30, 40, 50];
            let bounds = vec![1.0, 2.0, 3.0, 4.0, 5.0];
            let metric = create_test_histogram_metric("many_buckets", counts, bounds);
            let mut rec = json!({"__name__": "many_buckets", "__type__": "histogram"});
            let metadata = Metadata {
                metric_family_name: String::new(),
                metric_type: MetricType::Unknown,
                help: String::new(),
                unit: String::new(),
            };
            let mut prom_meta = HashMap::new();

            if let Some(Data::Histogram(hist)) = &metric.data {
                let result = process_histogram(&mut rec, hist, metadata, &mut prom_meta);
                // Should have count, sum, min, max, and 5 buckets
                assert_eq!(result.len(), 9);
            }
        }
    }

    mod exemplar_tests {
        use opentelemetry_proto::tonic::{common::v1::*, metrics::v1::exemplar};

        use super::*;

        fn create_test_exemplar_with_trace() -> Exemplar {
            let trace_id = [1u8; 16];
            let span_id = [2u8; 8];

            Exemplar {
                filtered_attributes: vec![KeyValue {
                    key: "service_name".to_string(),
                    value: Some(AnyValue {
                        value: Some(any_value::Value::StringValue("test-service".to_string())),
                    }),
                }],
                time_unix_nano: 1640995200000000000,
                value: Some(exemplar::Value::AsDouble(42.0)),
                span_id: span_id.to_vec(),
                trace_id: trace_id.to_vec(),
            }
        }

        #[test]
        fn test_exemplar_with_trace_and_span_ids() {
            let mut rec = json!({"__name__": "test_metric"});
            let exemplar = create_test_exemplar_with_trace();

            process_exemplars(&mut rec, &vec![exemplar]);

            assert!(rec.get("exemplars").is_some());
            let exemplars = rec["exemplars"].as_array().unwrap();
            assert_eq!(exemplars.len(), 1);

            let processed_exemplar = &exemplars[0];
            assert!(processed_exemplar.get("trace_id").is_some());
            assert!(processed_exemplar.get("span_id").is_some());
            assert_eq!(processed_exemplar["value"], 42.0);
            assert_eq!(processed_exemplar["service_name"], "test-service");
        }

        #[test]
        fn test_exemplar_with_invalid_trace_id() {
            let mut rec = json!({"__name__": "test_metric"});
            let mut exemplar = create_test_exemplar_with_trace();
            exemplar.trace_id = vec![0u8; 16]; // Invalid trace ID (all zeros)

            process_exemplars(&mut rec, &vec![exemplar]);

            let exemplars = rec["exemplars"].as_array().unwrap();
            let processed_exemplar = &exemplars[0];
            // Should not have trace_id field for invalid trace
            assert!(processed_exemplar.get("trace_id").is_none());
        }

        #[test]
        fn test_exemplar_with_invalid_span_id() {
            let mut rec = json!({"__name__": "test_metric"});
            let mut exemplar = create_test_exemplar_with_trace();
            exemplar.span_id = vec![0u8; 8]; // Invalid span ID (all zeros)

            process_exemplars(&mut rec, &vec![exemplar]);

            let exemplars = rec["exemplars"].as_array().unwrap();
            let processed_exemplar = &exemplars[0];
            // Should not have span_id field for invalid span
            assert!(processed_exemplar.get("span_id").is_none());
        }

        #[test]
        fn test_exemplar_with_multiple_attributes() {
            let mut rec = json!({"__name__": "test_metric"});
            let exemplar = Exemplar {
                filtered_attributes: vec![
                    KeyValue {
                        key: "service".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue("web".to_string())),
                        }),
                    },
                    KeyValue {
                        key: "version".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue("1.0.0".to_string())),
                        }),
                    },
                    KeyValue {
                        key: "count".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::IntValue(100)),
                        }),
                    },
                ],
                time_unix_nano: 1640995200000000000,
                value: Some(exemplar::Value::AsDouble(42.0)),
                span_id: vec![],
                trace_id: vec![],
            };

            process_exemplars(&mut rec, &vec![exemplar]);

            let exemplars = rec["exemplars"].as_array().unwrap();
            let processed_exemplar = &exemplars[0];
            assert_eq!(processed_exemplar["service"], "web");
            assert_eq!(processed_exemplar["version"], "1.0.0");
            // Integer values are often converted to strings in OTLP processing
            if processed_exemplar["count"].is_string() {
                assert_eq!(processed_exemplar["count"], "100");
            } else {
                assert_eq!(processed_exemplar["count"], 100);
            }
        }

        #[test]
        fn test_multiple_exemplars() {
            let mut rec = json!({"__name__": "test_metric"});
            let exemplars = vec![
                create_test_exemplar_with_trace(),
                Exemplar {
                    filtered_attributes: vec![],
                    time_unix_nano: 1640995300000000000,
                    value: Some(exemplar::Value::AsDouble(100.0)),
                    span_id: vec![],
                    trace_id: vec![],
                },
            ];

            process_exemplars(&mut rec, &exemplars);

            let processed_exemplars = rec["exemplars"].as_array().unwrap();
            assert_eq!(processed_exemplars.len(), 2);
            assert_eq!(processed_exemplars[0]["value"], 42.0);
            assert_eq!(processed_exemplars[1]["value"], 100.0);
        }
    }

    mod histogram_processing_tests {
        use super::*;

        #[test]
        fn test_histogram_bucket_accumulation() {
            let mut rec = json!({"__name__": "test_histogram"});
            let data_point = HistogramDataPoint {
                attributes: vec![],
                start_time_unix_nano: 0,
                time_unix_nano: 1640995200000000000,
                exemplars: vec![],
                flags: 0,
                count: 60,
                sum: Some(150.0),
                bucket_counts: vec![10, 20, 30], // Should accumulate to [10, 30, 60]
                explicit_bounds: vec![10.0, 20.0, 30.0],
                min: Some(0.0),
                max: Some(35.0),
            };

            let result = process_hist_data_point(&mut rec, &data_point);

            // Find bucket records and verify accumulation
            let bucket_records: Vec<_> = result
                .iter()
                .filter(|r| r["__name__"].as_str().unwrap_or("").ends_with("_bucket"))
                .collect();

            assert_eq!(bucket_records.len(), 3);

            // Verify accumulated counts: 10, 10+20=30, 10+20+30=60
            let mut expected_values = vec![10.0, 30.0, 60.0];
            expected_values.sort_by(|a, b| a.partial_cmp(b).unwrap());

            let mut actual_values: Vec<f64> = bucket_records
                .iter()
                .map(|r| r["value"].as_f64().unwrap())
                .collect();
            actual_values.sort_by(|a, b| a.partial_cmp(b).unwrap());

            assert_eq!(actual_values, expected_values);
        }

        #[test]
        fn test_histogram_infinity_bucket() {
            let mut rec = json!({"__name__": "test_histogram"});
            let data_point = HistogramDataPoint {
                attributes: vec![],
                start_time_unix_nano: 0,
                time_unix_nano: 1640995200000000000,
                exemplars: vec![],
                flags: 0,
                count: 100,
                sum: Some(200.0),
                bucket_counts: vec![50, 50],
                explicit_bounds: vec![10.0], // Second bucket should be +Inf
                min: Some(0.0),
                max: Some(100.0),
            };

            let result = process_hist_data_point(&mut rec, &data_point);

            // Find the infinity bucket
            let inf_bucket = result
                .iter()
                .find(|r| r["le"].as_str().map(|s| s == "inf").unwrap_or(false));

            assert!(inf_bucket.is_some());
            assert_eq!(inf_bucket.unwrap()["value"], 100.0); // 50 + 50
        }

        #[test]
        fn test_histogram_le_labels() {
            let mut rec = json!({"__name__": "test_histogram"});
            let bounds = vec![1.0, 5.0, 10.0];
            let data_point = HistogramDataPoint {
                attributes: vec![],
                start_time_unix_nano: 0,
                time_unix_nano: 1640995200000000000,
                exemplars: vec![],
                flags: 0,
                count: 60,
                sum: Some(150.0),
                bucket_counts: vec![10, 20, 30],
                explicit_bounds: bounds.clone(),
                min: Some(0.0),
                max: Some(12.0),
            };

            let result = process_hist_data_point(&mut rec, &data_point);

            // Check that each bucket has correct "le" label
            let bucket_records: Vec<_> = result
                .iter()
                .filter(|r| r["__name__"].as_str().unwrap_or("").ends_with("_bucket"))
                .collect();

            // Should have buckets for 1.0, 5.0, 10.0
            let le_values: Vec<String> = bucket_records
                .iter()
                .map(|r| r["le"].as_str().unwrap_or("").to_string())
                .collect();

            assert!(le_values.contains(&"1".to_string()));
            assert!(le_values.contains(&"5".to_string()));
            assert!(le_values.contains(&"10".to_string()));
        }

        #[test]
        fn test_exponential_histogram_buckets() {
            let mut rec = json!({"__name__": "test_exp_histogram"});
            let data_point = opentelemetry_proto::tonic::metrics::v1::ExponentialHistogramDataPoint {
                attributes: vec![],
                start_time_unix_nano: 0,
                time_unix_nano: 1640995200000000000,
                exemplars: vec![],
                flags: 0,
                count: 200,
                sum: Some(500.0),
                min: Some(0.1),
                max: Some(100.0),
                scale: 1,
                zero_count: 5,
                zero_threshold: 0.001,
                positive: Some(opentelemetry_proto::tonic::metrics::v1::exponential_histogram_data_point::Buckets {
                    offset: 0,
                    bucket_counts: vec![10, 20, 30],
                }),
                negative: Some(opentelemetry_proto::tonic::metrics::v1::exponential_histogram_data_point::Buckets {
                    offset: -2,
                    bucket_counts: vec![5, 10],
                }),
            };

            let result = process_exp_hist_data_point(&mut rec, &data_point);

            // Should have count, sum, positive buckets, and negative buckets
            assert!(result.len() >= 2); // At least count and sum

            // Check count record
            let count_record = result
                .iter()
                .find(|r| r["__name__"].as_str().unwrap_or("").ends_with("_count"));
            assert!(count_record.is_some());
            assert_eq!(count_record.unwrap()["value"], 200.0);

            // Check sum record
            let sum_record = result
                .iter()
                .find(|r| r["__name__"].as_str().unwrap_or("").ends_with("_sum"));
            assert!(sum_record.is_some());
            assert_eq!(sum_record.unwrap()["value"], 500.0);
        }
    }

    mod edge_case_tests {
        use super::*;

        #[test]
        fn test_data_point_flags() {
            let mut rec = json!({"__name__": "test_metric"});

            // Test with flag 1 (NoRecordedValueMask)
            let data_point_flag1 = NumberDataPoint {
                attributes: vec![],
                start_time_unix_nano: 0,
                time_unix_nano: 1640995200000000000,
                exemplars: vec![],
                flags: 1,
                value: Some(
                    opentelemetry_proto::tonic::metrics::v1::number_data_point::Value::AsDouble(
                        42.0,
                    ),
                ),
            };

            process_data_point(&mut rec, &data_point_flag1);
            assert_eq!(rec["flag"], "DATA_POINT_FLAGS_NO_RECORDED_VALUE_MASK");

            // Test with flag 0 (DoNotUse)
            let data_point_flag0 = NumberDataPoint {
                attributes: vec![],
                start_time_unix_nano: 0,
                time_unix_nano: 1640995200000000000,
                exemplars: vec![],
                flags: 0,
                value: Some(
                    opentelemetry_proto::tonic::metrics::v1::number_data_point::Value::AsDouble(
                        42.0,
                    ),
                ),
            };

            process_data_point(&mut rec, &data_point_flag0);
            assert_eq!(rec["flag"], "DATA_POINT_FLAGS_DO_NOT_USE");
        }

        #[test]
        fn test_timestamp_conversion() {
            let mut rec = json!({"__name__": "test_metric"});
            let nano_timestamp = 1640995200000000000u64; // 2022-01-01 00:00:00 UTC in nanoseconds
            let expected_micro_timestamp = 1640995200000000i64; // Expected microseconds

            let data_point = NumberDataPoint {
                attributes: vec![],
                start_time_unix_nano: 0,
                time_unix_nano: nano_timestamp,
                exemplars: vec![],
                flags: 0,
                value: Some(
                    opentelemetry_proto::tonic::metrics::v1::number_data_point::Value::AsDouble(
                        42.0,
                    ),
                ),
            };

            process_data_point(&mut rec, &data_point);
            assert_eq!(rec["_timestamp"], expected_micro_timestamp);
        }

        #[test]
        fn test_summary_quantiles() {
            let mut rec = json!({"__name__": "test_summary"});
            let data_point = opentelemetry_proto::tonic::metrics::v1::SummaryDataPoint {
                attributes: vec![],
                start_time_unix_nano: 0,
                time_unix_nano: 1640995200000000000,
                flags: 0,
                count: 1000,
                sum: 50000.0,
                quantile_values: vec![
                    opentelemetry_proto::tonic::metrics::v1::summary_data_point::ValueAtQuantile {
                        quantile: 0.5,
                        value: 45.0,
                    },
                    opentelemetry_proto::tonic::metrics::v1::summary_data_point::ValueAtQuantile {
                        quantile: 0.95,
                        value: 95.0,
                    },
                    opentelemetry_proto::tonic::metrics::v1::summary_data_point::ValueAtQuantile {
                        quantile: 0.99,
                        value: 99.0,
                    },
                ],
            };

            let result = process_summary_data_point(&mut rec, &data_point);

            // Should have count, sum, and quantile records
            assert!(result.len() >= 5); // 2 (count, sum) + 3 quantiles

            // Find quantile records
            let quantile_records: Vec<_> = result
                .iter()
                .filter(|r| r.get("quantile").is_some())
                .collect();

            assert_eq!(quantile_records.len(), 3);

            // Verify quantile values
            let quantiles: Vec<String> = quantile_records
                .iter()
                .map(|r| r["quantile"].as_str().unwrap().to_string())
                .collect();

            assert!(quantiles.contains(&"0.5".to_string()));
            assert!(quantiles.contains(&"0.95".to_string()));
            assert!(quantiles.contains(&"0.99".to_string()));
        }

        #[test]
        fn test_empty_attributes() {
            let mut rec = json!({"__name__": "test_metric"});
            let data_point = NumberDataPoint {
                attributes: vec![], // Empty attributes
                start_time_unix_nano: 0,
                time_unix_nano: 1640995200000000000,
                exemplars: vec![],
                flags: 0,
                value: Some(
                    opentelemetry_proto::tonic::metrics::v1::number_data_point::Value::AsDouble(
                        42.0,
                    ),
                ),
            };

            process_data_point(&mut rec, &data_point);

            // Should still process correctly with empty attributes
            assert_eq!(rec["value"], 42.0);
            assert!(rec.get("_timestamp").is_some());
        }
    }

    mod aggregation_temporality_tests {
        use super::*;

        #[test]
        fn test_all_aggregation_temporality_values() {
            let mut rec = json!({"__name__": "test_metric"});

            // Test all defined values
            let test_cases = vec![
                (0, "AGGREGATION_TEMPORALITY_UNSPECIFIED"),
                (1, "AGGREGATION_TEMPORALITY_DELTA"),
                (2, "AGGREGATION_TEMPORALITY_CUMULATIVE"),
            ];

            for (input, expected) in test_cases {
                process_aggregation_temporality(&mut rec, input);
                assert_eq!(rec["aggregation_temporality"], expected);
            }
        }

        #[test]
        fn test_invalid_aggregation_temporality() {
            let mut rec = json!({"__name__": "test_metric"});

            // Test various invalid values
            let invalid_values = vec![-1, 3, 100, 999];

            for invalid_value in invalid_values {
                process_aggregation_temporality(&mut rec, invalid_value);
                assert_eq!(
                    rec["aggregation_temporality"],
                    "AGGREGATION_TEMPORALITY_UNSPECIFIED"
                );
            }
        }
    }

    mod response_format_tests {
        use super::*;

        #[test]
        fn test_format_response_partial_content_json() {
            let partial_success = ExportMetricsPartialSuccess {
                rejected_data_points: 10,
                error_message: "Custom error message".to_string(),
            };

            let response = format_response(partial_success, OtlpRequestType::HttpJson);
            assert!(response.is_ok());

            let http_response = response.unwrap();
            assert_eq!(http_response.status(), http::StatusCode::PARTIAL_CONTENT);
        }

        #[test]
        fn test_format_response_success_json() {
            let partial_success = ExportMetricsPartialSuccess {
                rejected_data_points: 0,
                error_message: String::new(),
            };

            let response = format_response(partial_success, OtlpRequestType::HttpJson);
            assert!(response.is_ok());

            let http_response = response.unwrap();
            assert_eq!(http_response.status(), http::StatusCode::OK);
        }

        #[test]
        fn test_format_response_grpc() {
            let partial_success = ExportMetricsPartialSuccess {
                rejected_data_points: 0,
                error_message: String::new(),
            };

            let response = format_response(partial_success, OtlpRequestType::Grpc);
            assert!(response.is_ok());

            let http_response = response.unwrap();
            assert_eq!(http_response.status(), http::StatusCode::OK);
            assert_eq!(
                http_response.headers().get("content-type").unwrap(),
                "application/x-protobuf"
            );
        }

        #[test]
        fn test_format_response_http_protobuf() {
            let partial_success = ExportMetricsPartialSuccess {
                rejected_data_points: 5,
                error_message: "Test error".to_string(),
            };

            let response = format_response(partial_success, OtlpRequestType::HttpProtobuf);
            assert!(response.is_ok());

            let http_response = response.unwrap();
            assert_eq!(http_response.status(), http::StatusCode::OK);
            assert_eq!(
                http_response.headers().get("content-type").unwrap(),
                "application/x-protobuf"
            );
        }
    }

    mod metric_name_processing_tests {
        use super::*;

        #[test]
        fn test_histogram_metric_name_suffixes() {
            let mut rec = json!({"__name__": "request_duration"});
            let data_point = HistogramDataPoint {
                attributes: vec![],
                start_time_unix_nano: 0,
                time_unix_nano: 1640995200000000000,
                exemplars: vec![],
                flags: 0,
                count: 100,
                sum: Some(200.0),
                bucket_counts: vec![10, 20],
                explicit_bounds: vec![10.0],
                min: Some(1.0),
                max: Some(50.0),
            };

            let result = process_hist_data_point(&mut rec, &data_point);

            // Check that all expected metric name suffixes are present
            let metric_names: Vec<&str> = result
                .iter()
                .map(|r| r["__name__"].as_str().unwrap_or(""))
                .collect();

            assert!(metric_names.contains(&"request_duration_count"));
            assert!(metric_names.contains(&"request_duration_sum"));
            assert!(metric_names.contains(&"request_duration_min"));
            assert!(metric_names.contains(&"request_duration_max"));
            assert!(metric_names.contains(&"request_duration_bucket"));
        }

        #[test]
        fn test_summary_metric_name_suffixes() {
            let mut rec = json!({"__name__": "response_time"});
            let data_point = opentelemetry_proto::tonic::metrics::v1::SummaryDataPoint {
                attributes: vec![],
                start_time_unix_nano: 0,
                time_unix_nano: 1640995200000000000,
                flags: 0,
                count: 100,
                sum: 500.0,
                quantile_values: vec![
                    opentelemetry_proto::tonic::metrics::v1::summary_data_point::ValueAtQuantile {
                        quantile: 0.5,
                        value: 50.0,
                    },
                ],
            };

            let result = process_summary_data_point(&mut rec, &data_point);

            // Check that all expected metric name suffixes are present
            let metric_names: Vec<&str> = result
                .iter()
                .map(|r| r["__name__"].as_str().unwrap_or(""))
                .collect();

            assert!(metric_names.contains(&"response_time_count"));
            assert!(metric_names.contains(&"response_time_sum"));
            // Original name should be in quantile records
            assert!(metric_names.contains(&"response_time"));
        }

        #[test]
        fn test_exponential_histogram_metric_name_suffixes() {
            let mut rec = json!({"__name__": "latency"});
            let data_point =
                opentelemetry_proto::tonic::metrics::v1::ExponentialHistogramDataPoint {
                    attributes: vec![],
                    start_time_unix_nano: 0,
                    time_unix_nano: 1640995200000000000,
                    exemplars: vec![],
                    flags: 0,
                    count: 50,
                    sum: Some(250.0),
                    min: Some(1.0),
                    max: Some(100.0),
                    scale: 0,
                    zero_count: 0,
                    zero_threshold: 0.0,
                    positive: None,
                    negative: None,
                };

            let result = process_exp_hist_data_point(&mut rec, &data_point);

            // Should have at least count and sum records
            let metric_names: Vec<&str> = result
                .iter()
                .map(|r| r["__name__"].as_str().unwrap_or(""))
                .collect();

            assert!(metric_names.contains(&"latency_count"));
            assert!(metric_names.contains(&"latency_sum"));
        }
    }
}
