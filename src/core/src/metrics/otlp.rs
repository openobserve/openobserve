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
        stream::{StreamParams, StreamPartition, StreamType},
    },
    metrics,
    utils::{
        flatten::{self, format_label_name},
        json,
        schema::format_stream_name,
        schema_ext::SchemaExt,
        time::now_micros,
    },
};
use db;
use infra::schema::{SchemaCache, get_partition_time_level};
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::{
    collector::metrics::v1::{
        ExportMetricsPartialSuccess, ExportMetricsServiceRequest, ExportMetricsServiceResponse,
    },
    metrics::v1::{metric::Data, *},
};
use prost::Message;

use crate::{
    alerts::alert::AlertExt,
    common::meta::{http::HttpResponse as MetaHttpResponse, stream::SchemaRecords},
    ingestion::{
        TriggerAlertData, check_ingestion_allowed, evaluate_trigger, get_thread_id,
        grpc::{get_exemplar_val, get_metric_val, get_val},
        write_file,
    },
    metrics::get_exclude_labels,
    pipeline::batch_execution::ExecutablePipeline,
    schema::{check_for_schema, stream_schema_exists},
};

pub async fn otlp_proto(
    org_id: &str,
    body: Bytes,
    user: crate::ingestion_contracts::IngestUser,
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
    user: crate::ingestion_contracts::IngestUser,
) -> Result<HttpResponse, std::io::Error> {
    let mut body_json = match serde_json::from_slice::<json::Value>(body.as_ref()) {
        Ok(v) => v,
        Err(e) => {
            log::error!("[METRICS:OTLP] Invalid json: {e}");
            return Ok(MetaHttpResponse::bad_request(format!("Invalid json: {e}")));
        }
    };
    super::otlp_json_compat::normalize(&mut body_json);
    let request = match serde_json::from_value::<ExportMetricsServiceRequest>(body_json) {
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
    user: crate::ingestion_contracts::IngestUser,
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
    let mut stream_partitioning_map: HashMap<String, Vec<StreamPartition>> = HashMap::new();

    // Start get user defined schema
    let mut user_defined_schema_map: HashMap<String, Option<HashSet<String>>> = HashMap::new();
    let mut streams_need_original_map: HashMap<String, bool> = HashMap::new();
    let mut streams_need_all_values_map: HashMap<String, bool> = HashMap::new();
    // End get user defined schema

    // associated pipeline
    let mut stream_executable_pipelines: HashMap<String, Vec<ExecutablePipeline>> = HashMap::new();
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
                let metadata = build_metadata(&metric_name, metric);
                let mut prom_meta: HashMap<String, String> = HashMap::new();

                let records = match &metric.data {
                    Some(data) => match data {
                        Data::Gauge(gauge) => process_gauge(&rec, gauge, metadata, &mut prom_meta),
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
                    None => {
                        // a flattened oneof that fails to deserialize turns into
                        // None instead of an error, so surface it here
                        log::warn!(
                            "[METRICS:OTLP] metric {metric_name} has no data points (unsupported or undecodable metric type), skipping"
                        );
                        partial_success.rejected_data_points += 1;
                        partial_success.error_message =
                            format!("metric {metric_name} has no data points");
                        vec![]
                    }
                };

                // A metric that yields no records -- every data point NaN, no data points at all,
                // or an undecodable type -- gets nothing at all: no schema, no metadata entry,
                // no stream. The per-stream lookups below therefore run only once we know there
                // is something to write.
                if records.is_empty() {
                    continue;
                }

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
                    let partition_det = crate::ingestion::get_stream_partition_keys(
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
                crate::ingestion::get_stream_alerts(
                    std::slice::from_ref(&stream_param),
                    &mut stream_alerts_map,
                )
                .await;
                // End get stream alert

                // get user defined schema
                crate::ingestion::get_uds_and_original_data_streams(
                    std::slice::from_ref(&stream_param),
                    &mut user_defined_schema_map,
                    &mut streams_need_original_map,
                    &mut streams_need_all_values_map,
                )
                .await;

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
                            let partition_det = crate::ingestion::get_stream_partition_keys(
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
                        crate::ingestion::get_stream_alerts(
                            std::slice::from_ref(&stream_param),
                            &mut stream_alerts_map,
                        )
                        .await;
                        // End get stream alert

                        crate::ingestion::get_uds_and_original_data_streams(
                            std::slice::from_ref(&stream_param),
                            &mut user_defined_schema_map,
                            &mut streams_need_original_map,
                            &mut streams_need_all_values_map,
                        )
                        .await;
                    }

                    // get stream pipeline -- for the stream this record actually lands in, which
                    // is not always the metric's own name: a histogram's rows all carry a
                    // `_count` / `_sum` / `_bucket` name and none carry the base. Registering the
                    // base here anyway would leave a stream in stream_executable_pipelines with
                    // no buffered inputs, and the loop at the end of this function reports that
                    // as a bug on every export request.
                    if !stream_executable_pipelines.contains_key(&local_metric_name) {
                        let stream_param =
                            StreamParams::new(org_id, &local_metric_name, StreamType::Metrics);
                        let pipeline_params =
                            crate::ingestion::get_stream_executable_pipelines(&stream_param).await;
                        stream_executable_pipelines
                            .insert(local_metric_name.clone(), pipeline_params);
                    }

                    // ready to be buffered for downstream processing
                    if stream_executable_pipelines
                        .get(&local_metric_name)
                        .is_some_and(|v| !v.is_empty())
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
                            local_val = crate::ingestion::refactor_map(local_val, fields);
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
    for (stream_name, pipelines) in &stream_executable_pipelines {
        if pipelines.is_empty() {
            continue;
        }
        let Some(pipeline_inputs) = stream_pipeline_inputs.remove(stream_name) else {
            let err_msg = format!(
                "[Ingestion]: Stream {stream_name} has pipeline, but inputs failed to be buffered. BUG",
            );
            log::error!("{err_msg}");
            partial_success.error_message = err_msg;
            continue;
        };
        let count = pipeline_inputs.len();
        let has_user_pipeline = pipelines
            .iter()
            .any(|p| p.kind == config::meta::pipeline::PipelineKind::User);

        for exec_pl in pipelines {
            match exec_pl
                .process_batch(org_id, pipeline_inputs.clone(), Some(stream_name.clone()))
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
                            let partition_det = crate::ingestion::get_stream_partition_keys(
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
                                local_val = crate::ingestion::refactor_map(local_val, fields);
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

        if !has_user_pipeline && !json_data_by_stream.contains_key(stream_name) {
            for mut rec in pipeline_inputs {
                let mut local_val = match rec.take() {
                    json::Value::Object(val) => val,
                    _ => unreachable!(),
                };

                if let Some(Some(fields)) = user_defined_schema_map.get(stream_name) {
                    local_val = crate::ingestion::refactor_map(local_val, fields);
                }

                json_data_by_stream
                    .entry(stream_name.clone())
                    .or_default()
                    .push(local_val);
            }
        }
    }

    for (local_metric_name, json_data) in json_data_by_stream {
        // get partition keys
        let partition_keys = stream_partitioning_map
            .get(&local_metric_name)
            .cloned()
            .unwrap_or_default();
        let partition_time_level = get_partition_time_level(StreamType::Metrics);

        // check for schema evolution
        let min_timestamp = batch_min_timestamp(&json_data, Utc::now().timestamp_micros());

        let _ = check_for_schema(
            org_id,
            &local_metric_name,
            StreamType::Metrics,
            &mut metric_schema_map,
            json_data.iter().collect(),
            min_timestamp,
            false, // is_derived is false for metrics
        )
        .await?;

        for val_map in json_data {
            let timestamp = val_map
                .get(TIMESTAMP_COL_NAME)
                .and_then(|ts| ts.as_i64())
                .unwrap_or(Utc::now().timestamp_micros());

            let value_str = json::to_string(&val_map).unwrap();

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
            let hour_key = crate::ingestion::get_write_partition_key(
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
                let key = format!("{}/{}/{}", org_id, StreamType::Metrics, local_metric_name);
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

        let fns_length: usize = stream_executable_pipelines
            .get(&stream_name)
            .map_or(0, |pipelines| {
                pipelines.iter().map(|exec_pl| exec_pl.num_of_func()).sum()
            });
        req_stats.response_time = start.elapsed().as_secs_f64();
        let email_str = user.to_email();
        req_stats.user_email = if email_str.is_empty() {
            None
        } else {
            Some(email_str)
        };
        usage_reporting::report_request_usage_stats(
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

fn batch_min_timestamp(
    json_data: &[serde_json::Map<String, serde_json::Value>],
    default: i64,
) -> i64 {
    let first = json_data
        .first()
        .and_then(|v| v.get(TIMESTAMP_COL_NAME)?.as_i64());
    let last = json_data
        .last()
        .and_then(|v| v.get(TIMESTAMP_COL_NAME)?.as_i64());

    match (first, last) {
        (Some(f), Some(l)) => f.min(l),
        (f, l) => f.or(l).unwrap_or(default),
    }
}

/// Builds the family metadata stored on the stream schema.
///
/// `metric_family_name` is the plain metric name. It is deliberately not read back out of
/// `rec[NAME_LABEL]`: that is a `json::Value::String`, and `Value::to_string()` returns the
/// serialised JSON -- `"name"`, quotes included -- rather than the string content.
fn build_metadata(
    metric_name: &str,
    metric: &opentelemetry_proto::tonic::metrics::v1::Metric,
) -> Metadata {
    Metadata {
        metric_family_name: metric_name.to_string(),
        metric_type: MetricType::Unknown,
        help: metric.description.to_owned(),
        unit: metric.unit.to_owned(),
    }
}

fn process_gauge(
    rec: &json::Value,
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
        // a fresh record per data point: `process_data_point` only ever sets attribute keys,
        // so reusing one record lets a data point inherit an attribute the previous one
        // carried and it never dropped -- which then feeds the series hash.
        let mut dp_rec = rec.clone();
        if !process_data_point(&mut dp_rec, data_point) {
            continue;
        }
        let val_map = dp_rec.as_object_mut().unwrap();
        let hash = super::signature_without_labels(val_map, &get_exclude_labels());
        val_map.insert(HASH_LABEL.to_string(), json::Value::Number(hash.into()));
        records.push(dp_rec);
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
        if !process_data_point(&mut dp_rec, data_point) {
            continue;
        }
        let val_map = dp_rec.as_object_mut().unwrap();
        let hash = super::signature_without_labels(val_map, &get_exclude_labels());
        val_map.insert(HASH_LABEL.to_string(), json::Value::Number(hash.into()));
        records.push(dp_rec);
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

/// Returns false if this data point has no usable value and must not be recorded.
///
/// The caller owns the drop, not this function: it mutates a record in place and cannot
/// remove it from the caller's buffer. Skipping only the `VALUE_LABEL` assignment would be
/// worse than the bug -- the record would keep whatever value it already held and re-report
/// a stale reading as if it were fresh.
#[must_use]
fn process_data_point(rec: &mut json::Value, data_point: &NumberDataPoint) -> bool {
    for attr in &data_point.attributes {
        rec[format_label_name(attr.key.as_str())] = get_val(&attr.value.as_ref());
    }
    let Some(value) = get_metric_val(&data_point.value).and_then(super::metric_value) else {
        return false;
    };
    rec[VALUE_LABEL] = value;
    rec[TIMESTAMP_COL_NAME] = (data_point.time_unix_nano / 1000).into();
    rec["start_time"] = data_point.start_time_unix_nano.to_string().into();
    rec["flag"] = if data_point.flags == 1 {
        DataPointFlags::NoRecordedValueMask.as_str_name()
    } else {
        DataPointFlags::DoNotUse.as_str_name()
    }
    .into();
    process_exemplars(rec, &data_point.exemplars);
    true
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

    if let Some(sum) = data_point.sum.and_then(super::metric_value) {
        let mut sum_rec = rec.clone();
        sum_rec[VALUE_LABEL] = sum;
        sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL].as_str().unwrap()).into();
        bucket_recs.push(sum_rec);
    }

    if let Some(min) = data_point.min.and_then(super::metric_value) {
        let mut min_rec = rec.clone();
        min_rec[VALUE_LABEL] = min;
        min_rec[NAME_LABEL] = format!("{}_min", min_rec[NAME_LABEL].as_str().unwrap()).into();
        bucket_recs.push(min_rec);
    }

    if let Some(max) = data_point.max.and_then(super::metric_value) {
        let mut max_rec = rec.clone();
        max_rec[VALUE_LABEL] = max;
        max_rec[NAME_LABEL] = format!("{}_max", max_rec[NAME_LABEL].as_str().unwrap()).into();
        bucket_recs.push(max_rec);
    }

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

    // add sum record -- OTLP marks `sum` optional, so an absent (or NaN) sum emits no record
    if let Some(sum) = data_point.sum.and_then(super::metric_value) {
        let mut sum_rec = rec.clone();
        sum_rec[VALUE_LABEL] = sum;
        sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL].as_str().unwrap()).into();
        bucket_recs.push(sum_rec);
    }

    // OTLP exponential histogram bucket boundaries are powers of `base`, where
    // `base = 2^(2^-scale)`. Bucket index `idx` (offset + array position) covers the
    // range (base^idx, base^(idx+1)], so its upper bound is `base^(idx+1)`.
    // NOTE: `^` is bitwise XOR in Rust, not exponentiation -- use `powf`/`powi`.
    let base = 2f64.powf(2f64.powi(-data_point.scale));
    // add negative bucket records (negative values, so the boundary is negated)
    if let Some(buckets) = &data_point.negative {
        let offset = buckets.offset;
        for (i, val) in buckets.bucket_counts.iter().enumerate() {
            let mut bucket_rec = rec.clone();
            bucket_rec[NAME_LABEL] = format!("{}_bucket", rec[NAME_LABEL].as_str().unwrap()).into();
            bucket_rec[VALUE_LABEL] = (*val as f64).into();
            bucket_rec["le"] = (-base.powi(offset + (i as i32) + 1)).to_string().into();
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
            bucket_rec["le"] = base.powi(offset + (i as i32) + 1).to_string().into();
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

    // add sum record -- `sum` is a plain f64 here, so it can only be dropped for NaN
    if let Some(sum) = super::metric_value(data_point.sum) {
        let mut sum_rec = rec.clone();
        sum_rec[VALUE_LABEL] = sum;
        sum_rec[NAME_LABEL] = format!("{}_sum", sum_rec[NAME_LABEL].as_str().unwrap()).into();
        bucket_recs.push(sum_rec);
    }

    // add bucket records -- a summary reports NaN for a quantile with no observations, and
    // an absent series is how Prometheus itself represents "no data"
    for value in &data_point.quantile_values {
        let Some(quantile_value) = super::metric_value(value.value) else {
            continue;
        };
        let mut bucket_rec = rec.clone();
        bucket_rec[VALUE_LABEL] = quantile_value;
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
        if partial_success.error_message.is_empty() {
            partial_success.error_message =
                "Some data points were rejected due to exceeding the allowed retention period"
                    .to_string();
        }
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
        let rec = json!({
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
            let result = process_gauge(&rec, gauge, metadata, &mut prom_meta);

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

        assert!(process_data_point(&mut rec, &data_point));

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
    fn test_process_hist_data_point_skips_missing_optional_stats() {
        let mut rec = json!({
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
            sum: None,
            bucket_counts: vec![10, 20],
            explicit_bounds: vec![10.0],
            min: None,
            max: None,
        };

        let result = process_hist_data_point(&mut rec, &data_point);
        let metric_names: Vec<&str> = result
            .iter()
            .map(|r| r[NAME_LABEL].as_str().unwrap_or(""))
            .collect();

        assert!(metric_names.contains(&"test_histogram_count"));
        assert!(metric_names.contains(&"test_histogram_bucket"));
        assert!(!metric_names.contains(&"test_histogram_sum"));
        assert!(!metric_names.contains(&"test_histogram_min"));
        assert!(!metric_names.contains(&"test_histogram_max"));
        // `!is_null()`, not `.get(..).is_some()`: a null value is still `Some(&Value::Null)`.
        // The writers are held to this across NaN inputs in `test_no_writer_emits_a_null_value`.
        assert!(result.iter().all(|r| !r[VALUE_LABEL].is_null()));
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
        let rec = json!({
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
            let result = process_gauge(&rec, gauge, metadata, &mut prom_meta);

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

    #[test]
    fn test_batch_min_timestamp() {
        // min of multiple values
        let json_data = vec![
            serde_json::Map::from_iter([(TIMESTAMP_COL_NAME.to_string(), json!(1i64))]),
            serde_json::Map::from_iter([(TIMESTAMP_COL_NAME.to_string(), json!(2i64))]),
            serde_json::Map::from_iter([(TIMESTAMP_COL_NAME.to_string(), json!(3i64))]),
        ];
        assert_eq!(batch_min_timestamp(&json_data, 42), 1i64);

        // first element doesn't have a timestamp, returns the last
        let json_data_with_one_timestamp = vec![
            serde_json::Map::from_iter([("value".to_string(), json!(1))]),
            serde_json::Map::from_iter([(TIMESTAMP_COL_NAME.to_string(), json!(2i64))]),
        ];
        assert_eq!(batch_min_timestamp(&json_data_with_one_timestamp, 42), 2i64);

        // no records have a timestamp, returns default
        let json_data_with_no_timestamp = vec![
            serde_json::Map::from_iter([("value".to_string(), json!(1))]),
            serde_json::Map::from_iter([("value".to_string(), json!(2))]),
        ];
        assert_eq!(batch_min_timestamp(&json_data_with_no_timestamp, 42), 42i64);
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
            let rec = json!({"__name__": "zero_gauge", "__type__": "gauge"});
            let metadata = Metadata {
                metric_family_name: String::new(),
                metric_type: MetricType::Unknown,
                help: String::new(),
                unit: String::new(),
            };
            let mut prom_meta = HashMap::new();

            if let Some(Data::Gauge(gauge)) = &metric.data {
                let result = process_gauge(&rec, gauge, metadata, &mut prom_meta);
                assert!(!result.is_empty());
                assert_eq!(result[0]["value"], 0.0);
            }
        }

        #[test]
        fn test_gauge_with_negative_value() {
            let metric = create_test_gauge_metric("negative_gauge", -42.5);
            let rec = json!({"__name__": "negative_gauge", "__type__": "gauge"});
            let metadata = Metadata {
                metric_family_name: String::new(),
                metric_type: MetricType::Unknown,
                help: String::new(),
                unit: String::new(),
            };
            let mut prom_meta = HashMap::new();

            if let Some(Data::Gauge(gauge)) = &metric.data {
                let result = process_gauge(&rec, gauge, metadata, &mut prom_meta);
                assert!(!result.is_empty());
                assert_eq!(result[0]["value"], -42.5);
            }
        }

        #[test]
        fn test_gauge_with_infinity() {
            let metric = create_test_gauge_metric("infinity_gauge", f64::INFINITY);
            let rec = json!({"__name__": "infinity_gauge", "__type__": "gauge"});
            let metadata = Metadata {
                metric_family_name: String::new(),
                metric_type: MetricType::Unknown,
                help: String::new(),
                unit: String::new(),
            };
            let mut prom_meta = HashMap::new();

            if let Some(Data::Gauge(gauge)) = &metric.data {
                let result = process_gauge(&rec, gauge, metadata, &mut prom_meta);
                assert_eq!(result.len(), 1);
                // an infinity is clamped to the f64 bound, matching the remote-write path.
                // it is never written as JSON null: a null value suppresses the `value`
                // column and takes the whole stream down with it.
                let value = &result[0]["value"];
                assert_eq!(value.as_f64().unwrap(), f64::MAX);
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
                    ..Default::default()
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
                        ..Default::default()
                    },
                    KeyValue {
                        key: "version".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue("1.0.0".to_string())),
                        }),
                        ..Default::default()
                    },
                    KeyValue {
                        key: "count".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::IntValue(100)),
                        }),
                        ..Default::default()
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

            // Bucket boundaries: base = 2^(2^-scale). scale=1 => base = 2^0.5 = sqrt(2).
            let base = 2f64.powf(2f64.powi(-1));

            // Positive buckets (offset 0): le = base^(idx+1) for idx = 0,1,2.
            let positive_les: Vec<f64> = result
                .iter()
                .filter(|r| r["__name__"].as_str().unwrap_or("").ends_with("_bucket"))
                .filter_map(|r| r["le"].as_str().and_then(|s| s.parse::<f64>().ok()))
                .filter(|le| *le > 0.0)
                .collect();
            assert_eq!(positive_les.len(), 3);
            for (i, le) in positive_les.iter().enumerate() {
                assert!((le - base.powi(i as i32 + 1)).abs() < 1e-9);
            }

            // Negative buckets (offset -2): le = -base^(idx+1) for idx = -2,-1.
            let negative_les: Vec<f64> = result
                .iter()
                .filter(|r| r["__name__"].as_str().unwrap_or("").ends_with("_bucket"))
                .filter_map(|r| r["le"].as_str().and_then(|s| s.parse::<f64>().ok()))
                .filter(|le| *le < 0.0)
                .collect();
            assert_eq!(negative_les.len(), 2);
            assert!((negative_les[0] - (-base.powi(-1))).abs() < 1e-9);
            assert!((negative_les[1] - (-base.powi(0))).abs() < 1e-9);
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

            assert!(process_data_point(&mut rec, &data_point_flag1));
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

            assert!(process_data_point(&mut rec, &data_point_flag0));
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

            assert!(process_data_point(&mut rec, &data_point));
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

            assert!(process_data_point(&mut rec, &data_point));

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

    #[test]
    fn test_batch_min_timestamp_empty_uses_default() {
        assert_eq!(batch_min_timestamp(&[], 42), 42);
    }

    #[test]
    fn test_batch_min_timestamp_single_entry() {
        let mut row = serde_json::Map::new();
        row.insert(TIMESTAMP_COL_NAME.to_string(), serde_json::json!(1000i64));
        assert_eq!(batch_min_timestamp(&[row], 0), 1000);
    }

    #[test]
    fn test_batch_min_timestamp_returns_min_of_first_and_last() {
        let mut first = serde_json::Map::new();
        first.insert(TIMESTAMP_COL_NAME.to_string(), serde_json::json!(500i64));
        let mut middle = serde_json::Map::new();
        middle.insert(TIMESTAMP_COL_NAME.to_string(), serde_json::json!(100i64));
        let mut last = serde_json::Map::new();
        last.insert(TIMESTAMP_COL_NAME.to_string(), serde_json::json!(200i64));
        // min(first=500, last=200) = 200
        assert_eq!(batch_min_timestamp(&[first, middle, last], 0), 200);
    }

    #[test]
    fn test_batch_min_timestamp_no_timestamp_field_uses_default() {
        let row = serde_json::Map::new(); // no _timestamp field
        assert_eq!(batch_min_timestamp(&[row], 99), 99);
    }

    /// A record written with a null value never gets a `value` column inferred into the
    /// schema, and the whole stream then fails every PromQL query while still costing full
    /// ingest and storage. NaN is the way a null gets in: `serde_json` maps a non-finite f64
    /// to `Value::Null`. So: NaN means no record, infinities clamp.
    mod value_policy {
        use opentelemetry_proto::tonic::{
            common::v1::{AnyValue, KeyValue, any_value},
            metrics::v1::{
                ExponentialHistogramDataPoint, Summary, SummaryDataPoint,
                exponential_histogram_data_point::Buckets, summary_data_point::ValueAtQuantile,
            },
        };

        use super::*;

        fn attr(key: &str, value: &str) -> KeyValue {
            KeyValue {
                key: key.to_string(),
                value: Some(AnyValue {
                    value: Some(any_value::Value::StringValue(value.to_string())),
                }),
                ..Default::default()
            }
        }

        fn number_dp(value: f64, attributes: Vec<KeyValue>) -> NumberDataPoint {
            NumberDataPoint {
                attributes,
                start_time_unix_nano: 0,
                time_unix_nano: 1640995200000000000,
                exemplars: vec![],
                flags: 0,
                value: Some(number_data_point::Value::AsDouble(value)),
            }
        }

        fn test_metadata() -> Metadata {
            Metadata {
                metric_type: MetricType::Unknown,
                metric_family_name: "test_metric".to_string(),
                help: String::new(),
                unit: String::new(),
            }
        }

        fn gauge_records(data_points: Vec<NumberDataPoint>) -> Vec<serde_json::Value> {
            let rec = json!({"__name__": "test_metric"});
            let mut prom_meta = HashMap::new();
            process_gauge(
                &rec,
                &Gauge { data_points },
                test_metadata(),
                &mut prom_meta,
            )
        }

        fn sum_records(data_points: Vec<NumberDataPoint>) -> Vec<serde_json::Value> {
            let mut rec = json!({"__name__": "test_metric"});
            let mut prom_meta = HashMap::new();
            process_sum(
                &mut rec,
                &Sum {
                    data_points,
                    aggregation_temporality: AggregationTemporality::Cumulative as i32,
                    is_monotonic: true,
                },
                test_metadata(),
                &mut prom_meta,
            )
        }

        fn hist_dp(sum: Option<f64>, min: Option<f64>, max: Option<f64>) -> HistogramDataPoint {
            HistogramDataPoint {
                attributes: vec![],
                start_time_unix_nano: 0,
                time_unix_nano: 1640995200000000000,
                exemplars: vec![],
                flags: 0,
                count: 100,
                sum,
                bucket_counts: vec![10, 20],
                explicit_bounds: vec![10.0],
                min,
                max,
            }
        }

        fn hist_records(dp: HistogramDataPoint) -> Vec<serde_json::Value> {
            let mut rec = json!({"__name__": "test_metric"});
            process_hist_data_point(&mut rec, &dp)
        }

        fn exp_hist_records(sum: Option<f64>) -> Vec<serde_json::Value> {
            let mut rec = json!({"__name__": "test_metric"});
            process_exp_hist_data_point(
                &mut rec,
                &ExponentialHistogramDataPoint {
                    attributes: vec![],
                    start_time_unix_nano: 0,
                    time_unix_nano: 1640995200000000000,
                    exemplars: vec![],
                    flags: 0,
                    count: 100,
                    sum,
                    min: None,
                    max: None,
                    scale: 0,
                    zero_count: 0,
                    zero_threshold: 0.0,
                    positive: Some(Buckets {
                        offset: 0,
                        bucket_counts: vec![50, 50],
                    }),
                    negative: None,
                },
            )
        }

        fn summary_records(sum: f64, quantiles: Vec<(f64, f64)>) -> Vec<serde_json::Value> {
            let mut rec = json!({"__name__": "test_metric"});
            process_summary_data_point(
                &mut rec,
                &SummaryDataPoint {
                    attributes: vec![],
                    start_time_unix_nano: 0,
                    time_unix_nano: 1640995200000000000,
                    flags: 0,
                    count: 100,
                    sum,
                    quantile_values: quantiles
                        .into_iter()
                        .map(|(quantile, value)| ValueAtQuantile { quantile, value })
                        .collect(),
                },
            )
        }

        fn names(records: &[serde_json::Value]) -> Vec<&str> {
            records
                .iter()
                .map(|r| r[NAME_LABEL].as_str().unwrap_or(""))
                .collect()
        }

        // ---- gauges: the HAProxy case. An unset HAProxy limit reads NaN on every scrape,
        // which is how a deliberately-scraped gauge became permanently unqueryable.

        #[test]
        fn test_process_gauge_nan_emits_no_record() {
            assert!(gauge_records(vec![number_dp(f64::NAN, vec![])]).is_empty());
        }

        #[test]
        fn test_process_gauge_finite_value_unchanged() {
            let records = gauge_records(vec![number_dp(42.0, vec![])]);
            assert_eq!(records.len(), 1);
            assert_eq!(records[0][VALUE_LABEL], json!(42.0));
        }

        /// The dangerous near-miss fix: declining to *assign* the value without dropping the
        /// record leaves the previous data point's reading in place, and the record is then
        /// pushed carrying a stale value that looks entirely real.
        #[test]
        fn test_process_gauge_nan_does_not_re_report_previous_value() {
            let after = gauge_records(vec![number_dp(5.0, vec![]), number_dp(f64::NAN, vec![])]);
            assert_eq!(
                after.len(),
                1,
                "the NaN data point must not produce a record"
            );
            assert_eq!(after[0][VALUE_LABEL], json!(5.0));

            let before = gauge_records(vec![number_dp(f64::NAN, vec![]), number_dp(5.0, vec![])]);
            assert_eq!(before.len(), 1);
            assert_eq!(before[0][VALUE_LABEL], json!(5.0));
        }

        #[test]
        fn test_process_gauge_clamps_infinities() {
            let records = gauge_records(vec![
                number_dp(f64::INFINITY, vec![]),
                number_dp(f64::NEG_INFINITY, vec![]),
            ]);
            assert_eq!(records.len(), 2);
            assert_eq!(records[0][VALUE_LABEL].as_f64().unwrap(), f64::MAX);
            assert_eq!(records[1][VALUE_LABEL].as_f64().unwrap(), f64::MIN);
        }

        #[test]
        fn test_process_sum_nan_emits_no_record() {
            assert!(sum_records(vec![number_dp(f64::NAN, vec![])]).is_empty());
            assert_eq!(sum_records(vec![number_dp(7.0, vec![])]).len(), 1);
        }

        // ---- label bleed: `process_data_point` only ever *sets* attribute keys, so a shared
        // record lets a data point inherit a label it never carried -- into its series hash.

        #[test]
        fn test_process_gauge_does_not_leak_labels_between_data_points() {
            let records = gauge_records(vec![
                number_dp(1.0, vec![attr("pod", "a"), attr("zone", "eu")]),
                number_dp(2.0, vec![attr("pod", "b")]),
            ]);

            assert_eq!(records.len(), 2);
            assert_eq!(records[0]["zone"], json!("eu"));
            assert!(
                records[1].get("zone").is_none(),
                "second data point carried no zone, so the record must not have one"
            );

            // and the series identity follows: the hash of the leak-free record is the hash of
            // the same data point sent on its own. An `assert_ne!` against the first record
            // would not show this -- `pod` alone already makes those two differ.
            let alone = gauge_records(vec![number_dp(2.0, vec![attr("pod", "b")])]);
            assert_eq!(
                records[1][HASH_LABEL], alone[0][HASH_LABEL],
                "the series hash must be computed over the labels the data point actually carried"
            );
        }

        /// `process_sum` has always cloned per data point. Asserted here so the two paths stay
        /// locked together.
        #[test]
        fn test_process_sum_does_not_leak_labels_between_data_points() {
            let records = sum_records(vec![
                number_dp(1.0, vec![attr("pod", "a"), attr("zone", "eu")]),
                number_dp(2.0, vec![attr("pod", "b")]),
            ]);

            assert_eq!(records.len(), 2);
            assert!(records[1].get("zone").is_none());
        }

        /// A dropped NaN data point must not leave its labels behind for the next one either.
        #[test]
        fn test_process_gauge_dropped_record_does_not_leak_labels() {
            let records = gauge_records(vec![
                number_dp(f64::NAN, vec![attr("pod", "a"), attr("zone", "eu")]),
                number_dp(2.0, vec![attr("pod", "b")]),
            ]);

            assert_eq!(records.len(), 1);
            assert!(records[0].get("zone").is_none());
        }

        // ---- classic histogram

        #[test]
        fn test_process_hist_data_point_nan_stats_emit_no_records() {
            let records = hist_records(hist_dp(Some(f64::NAN), Some(f64::NAN), Some(f64::NAN)));
            let names = names(&records);

            assert!(names.contains(&"test_metric_count"));
            assert!(names.contains(&"test_metric_bucket"));
            assert!(!names.contains(&"test_metric_sum"));
            assert!(!names.contains(&"test_metric_min"));
            assert!(!names.contains(&"test_metric_max"));
        }

        /// Guards against over-correction: the streams whose min/max are genuinely populated
        /// must keep working.
        #[test]
        fn test_process_hist_data_point_finite_stats_still_emitted() {
            let records = hist_records(hist_dp(Some(f64::NAN), Some(0.5), Some(9.5)));

            let min_rec = records
                .iter()
                .find(|r| r[NAME_LABEL] == json!("test_metric_min"))
                .expect("a real min must still be emitted alongside a NaN sum");
            assert_eq!(min_rec[VALUE_LABEL], json!(0.5));

            let max_rec = records
                .iter()
                .find(|r| r[NAME_LABEL] == json!("test_metric_max"))
                .expect("a real max must still be emitted");
            assert_eq!(max_rec[VALUE_LABEL], json!(9.5));

            assert!(!names(&records).contains(&"test_metric_sum"));
        }

        #[test]
        fn test_process_hist_data_point_clamps_infinite_sum() {
            let records = hist_records(hist_dp(Some(f64::INFINITY), None, None));
            let sum_rec = records
                .iter()
                .find(|r| r[NAME_LABEL] == json!("test_metric_sum"))
                .expect("an infinite sum clamps, it does not drop");
            assert_eq!(sum_rec[VALUE_LABEL].as_f64().unwrap(), f64::MAX);
        }

        // ---- exponential histogram: `sum` is optional in OTLP, and today an absent one is
        // written as a null-valued `_sum` record.

        #[test]
        fn test_process_exp_hist_data_point_absent_sum_emits_no_sum_record() {
            assert!(!names(&exp_hist_records(None)).contains(&"test_metric_sum"));
        }

        #[test]
        fn test_process_exp_hist_data_point_nan_sum_emits_no_sum_record() {
            assert!(!names(&exp_hist_records(Some(f64::NAN))).contains(&"test_metric_sum"));
        }

        #[test]
        fn test_process_exp_hist_data_point_finite_sum_emitted() {
            let records = exp_hist_records(Some(100.0));
            let sum_rec = records
                .iter()
                .find(|r| r[NAME_LABEL] == json!("test_metric_sum"))
                .expect("a finite sum is still emitted");
            assert_eq!(sum_rec[VALUE_LABEL], json!(100.0));
        }

        // ---- summary: a quantile with no observations is reported as NaN. An absent series is
        // how Prometheus itself represents "no data", so the record is dropped.

        #[test]
        fn test_process_summary_data_point_drops_nan_quantiles_only() {
            let records = summary_records(50.0, vec![(0.5, 45.0), (0.95, f64::NAN), (0.99, 99.0)]);
            let quantiles: Vec<&str> = records
                .iter()
                .filter_map(|r| r.get("quantile").and_then(|q| q.as_str()))
                .collect();

            assert_eq!(quantiles, vec!["0.5", "0.99"]);
            assert!(names(&records).contains(&"test_metric_sum"));
        }

        #[test]
        fn test_process_summary_data_point_nan_sum_emits_no_sum_record() {
            let records = summary_records(f64::NAN, vec![(0.5, 45.0)]);
            assert!(!names(&records).contains(&"test_metric_sum"));
            assert!(names(&records).contains(&"test_metric_count"));
        }

        // ---- the invariant itself, across all four record writers.

        #[test]
        fn test_no_writer_emits_a_null_value() {
            let mut records = vec![];
            records.extend(gauge_records(vec![
                number_dp(f64::NAN, vec![]),
                number_dp(1.0, vec![]),
            ]));
            records.extend(sum_records(vec![
                number_dp(f64::NAN, vec![]),
                number_dp(1.0, vec![]),
            ]));
            records.extend(hist_records(hist_dp(
                Some(f64::NAN),
                Some(f64::NAN),
                Some(f64::NAN),
            )));
            records.extend(exp_hist_records(None));
            records.extend(exp_hist_records(Some(f64::NAN)));
            records.extend(summary_records(f64::NAN, vec![(0.5, f64::NAN), (0.9, 1.0)]));

            assert!(!records.is_empty(), "the writers must still emit something");
            assert!(
                records.iter().all(|r| !r[VALUE_LABEL].is_null()),
                "a record with a null value suppresses the `value` column and makes the stream unreadable"
            );
        }

        // ---- the family name the metadata is written with.

        #[test]
        fn test_build_metadata_family_name_is_not_json_quoted() {
            let metric = Metric {
                name: "test_histogram".to_string(),
                description: "help text".to_string(),
                unit: "seconds".to_string(),
                metadata: vec![],
                data: Some(Data::Summary(Summary {
                    data_points: vec![],
                })),
            };

            let metadata = build_metadata("test_histogram", &metric);

            assert_eq!(metadata.metric_family_name, "test_histogram");
            assert_eq!(metadata.help, "help text");
            assert_eq!(metadata.unit, "seconds");
        }
    }
}
