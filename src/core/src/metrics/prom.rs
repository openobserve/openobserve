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
    borrow::Cow,
    collections::{HashMap, HashSet},
};

use bytes::Bytes;
use chrono::{TimeZone, Utc};
use config::{
    TIMESTAMP_COL_NAME,
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        alerts::alert,
        promql::*,
        search::default_use_cache,
        self_reporting::usage::UsageType,
        stream::{StreamParams, StreamPartition, StreamStats, StreamType},
    },
    utils::{
        flatten::format_label_name_cow,
        json,
        schema::format_stream_name,
        time::{now_micros, parse_i64_to_timestamp_micros},
    },
};
use datafusion::arrow::datatypes::Schema;
use db::{self, alerts::alert::cache_stream_key};
use infra::{
    cache::stats,
    errors::{Error, Result},
    schema::SchemaCache,
};
use ingestion_common::IngestUser;
use promql_parser::{label::MatchOp, parser};
use proto::prometheus_rpc;
use schema::stream_schema_exists;
use search_service;

use super::{
    columnar, ingest,
    native_histogram::{CLASSIC_HISTOGRAM_SUFFIXES, expand_native_histogram},
    prom_decode,
};
use crate::{
    common::{
        infra::config::{METRIC_CLUSTER_LEADER, METRIC_CLUSTER_MAP},
        meta::stream::SchemaRecords,
    },
    ingestion::{TriggerAlertData, check_ingestion_allowed},
    pipeline::batch_execution::ExecutablePipeline,
};

/// A record waiting for the write path, with the series hash when this handler computed it.
type PendingRecord = (json::Map<String, json::Value>, i64, Option<u64>);

type JsonDataByStream = HashMap<String, Vec<PendingRecord>>;

struct RecordSink<'a> {
    pipelines: &'a HashMap<String, Vec<ExecutablePipeline>>,
    user_defined_schema: &'a HashMap<String, Option<HashSet<String>>>,
    pipeline_inputs: &'a mut HashMap<String, Vec<(json::Value, i64)>>,
    json_data_by_stream: &'a mut JsonDataByStream,
}

/// HA replica election, run once per request at the first record that will actually be written.
struct HaGate<'a> {
    first_line: &'a mut bool,
    armed: bool,
    cluster_name: &'a str,
    replica_label: &'a str,
    interval: i64,
}

impl HaGate<'_> {
    /// `false` once this replica has lost leadership; the request must then write nothing.
    async fn admit(&mut self) -> bool {
        if !self.armed || !*self.first_line {
            return true;
        }
        *self.first_line = false;
        run_ha_election(self.cluster_name, self.replica_label, self.interval).await
    }
}

pub async fn remote_write(
    org_id: &str,
    body: Bytes,
    user: IngestUser,
) -> std::result::Result<(), anyhow::Error> {
    // check system resource
    check_ingestion_allowed(org_id, StreamType::Metrics, None).await?;

    let start = std::time::Instant::now();
    let started_at = Utc::now().timestamp_micros();

    let cfg = get_config();
    let dedup_enabled = cfg.prom.dedup_enabled;
    let election_interval = cfg.prom.leader_election_interval * 1000000;
    let mut cluster_name = String::new();
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
    let mut stream_pipeline_inputs: HashMap<String, Vec<(json::Value, i64)>> = HashMap::new();

    // realtime alerts
    let mut stream_alerts_map: HashMap<String, Vec<alert::Alert>> = HashMap::new();
    let mut stream_trigger_map: HashMap<String, Option<TriggerAlertData>> = HashMap::new();

    let decoded = snap::raw::Decoder::new()
        .decompress_vec(&body)
        .map_err(|e| anyhow::anyhow!("Invalid snappy compressed data: {e}"))?;
    let request =
        prom_decode::decode(&decoded).map_err(|e| anyhow::anyhow!("Invalid protobuf: {e}"))?;

    // records buffer
    let mut json_data_by_stream: HashMap<String, Vec<_>> = HashMap::new();

    // check if stream is deleting from cache
    let mut stream_delete_status: HashMap<String, bool> = HashMap::new();
    let mut skipped_records: u32 = 0;

    // parse metadata
    for item in request.metadata {
        let metric_name = format_stream_name(item.metric_family_name.to_string());
        let schema = infra::schema::get(org_id, &metric_name, StreamType::Metrics)
            .await
            .unwrap_or(Schema::empty());
        if schema.metadata().contains_key(METADATA_LABEL) {
            // already has metadata, skip
            continue;
        }
        let metadata = Metadata {
            metric_family_name: item.metric_family_name.clone(),
            metric_type: item.r#type().into(),
            help: item.help.clone(),
            unit: item.unit.clone(),
        };
        let mut extra_metadata: HashMap<String, String> = HashMap::new();
        extra_metadata.insert(
            METADATA_LABEL.to_string(),
            json::to_string(&metadata).unwrap(),
        );
        log::info!("Metadata for stream {org_id}/metrics/{metric_name} needs to be updated");
        if let Err(e) =
            db::schema::update_setting(org_id, &metric_name, StreamType::Metrics, extra_metadata)
                .await
        {
            log::error!("Error updating metadata for stream: {metric_name}, err: {e}");
        }
    }

    // maybe empty, we can return immediately
    if request.timeseries.is_empty() {
        ingest::observe_request(WRITE_ENDPOINT, org_id, &start);
        return Ok(());
    }

    // parse timeseries
    let step_start = std::time::Instant::now();
    let mut first_line = true;

    // Detailed performance tracking
    let mut event_count = 0;
    let mut sample_count = 0;

    // Pre-load all configurations for unique metrics to avoid repeated queries
    let preload_start = std::time::Instant::now();
    let mut unique_metrics = HashSet::new();
    // a request carries far more series than distinct metric names, so each is formatted once
    let mut formatted_names: HashMap<String, String> = HashMap::new();
    for event in &request.timeseries {
        if let Some((_, raw_name)) = event.labels.iter().find(|(name, _)| *name == NAME_LABEL) {
            let metric_name = match formatted_names.get(*raw_name) {
                Some(name) => name.clone(),
                None => {
                    let name = format_stream_name(raw_name.to_string());
                    formatted_names.insert(raw_name.to_string(), name.clone());
                    unique_metrics.insert(name.clone());
                    name
                }
            };
            if !event.histograms.is_empty() {
                // native histograms degrade into classic streams; preload those too
                for suffix in CLASSIC_HISTOGRAM_SUFFIXES {
                    unique_metrics.insert(format!("{metric_name}{suffix}"));
                }
            }
        }
    }

    let mut preload_pipeline_time = 0u128;
    let mut preload_uds_time = 0u128;
    let mut preload_schema_time = 0u128;
    let mut preload_alerts_time = 0u128;

    if !unique_metrics.is_empty() {
        let streams: Vec<StreamParams> = unique_metrics
            .iter()
            .map(|name| StreamParams {
                org_id: org_id.to_owned().into(),
                stream_name: name.to_owned().into(),
                stream_type: StreamType::Metrics,
            })
            .collect();

        // Preload pipelines
        let t = std::time::Instant::now();
        for stream in &streams {
            let stream_name_str: &str = stream.stream_name.as_ref();
            if !stream_executable_pipelines.contains_key(stream_name_str) {
                let pipeline_params =
                    crate::ingestion::get_stream_executable_pipelines(stream).await;
                stream_executable_pipelines.insert(stream.stream_name.to_string(), pipeline_params);
            }
        }
        preload_pipeline_time = t.elapsed().as_micros();

        // Preload UDS
        let t = std::time::Instant::now();
        crate::ingestion::get_uds_and_original_data_streams(
            &streams,
            &mut user_defined_schema_map,
            &mut streams_need_original_map,
            &mut streams_need_all_values_map,
        )
        .await;
        preload_uds_time = t.elapsed().as_micros();

        // Preload schemas
        let t = std::time::Instant::now();
        for stream in &streams {
            let stream_name_str: &str = stream.stream_name.as_ref();
            if !metric_schema_map.contains_key(stream_name_str) {
                let _schema_exists = stream_schema_exists(
                    &stream.org_id,
                    &stream.stream_name,
                    stream.stream_type,
                    &mut metric_schema_map,
                )
                .await;
            }
        }
        preload_schema_time = t.elapsed().as_micros();

        // Preload partition keys
        for stream in &streams {
            let stream_name_str: &str = stream.stream_name.as_ref();
            if !stream_partitioning_map.contains_key(stream_name_str) {
                let partition_det = crate::ingestion::get_stream_partition_keys(
                    &stream.org_id,
                    &stream.stream_type,
                    &stream.stream_name,
                )
                .await;
                stream_partitioning_map.insert(stream.stream_name.to_string(), partition_det);
            }
        }

        // Preload alerts
        let t = std::time::Instant::now();
        crate::ingestion::get_stream_alerts(&streams, &mut stream_alerts_map).await;
        preload_alerts_time = t.elapsed().as_micros();
    }
    let total_preload_time = preload_start.elapsed().as_micros();

    let mut columnar_streams = columnar::plan_columnar_streams(
        org_id,
        &unique_metrics,
        &metric_schema_map,
        &stream_executable_pipelines,
        &user_defined_schema_map,
        &stream_alerts_map,
        &stream_partitioning_map,
    );

    let mut sink = RecordSink {
        pipelines: &stream_executable_pipelines,
        user_defined_schema: &user_defined_schema_map,
        pipeline_inputs: &mut stream_pipeline_inputs,
        json_data_by_stream: &mut json_data_by_stream,
    };
    for event in request.timeseries {
        event_count += 1;
        // get labels
        let mut replica_label = "";

        // a label spelled correctly on the wire is borrowed; only the JSON path copies labels
        let mut label_pairs: Vec<(Cow<'_, str>, Cow<'_, str>)> =
            Vec::with_capacity(event.labels.len());
        // allocated only for a series wide enough that `push_label`'s scan would go quadratic
        let mut label_index: HashMap<String, usize> = HashMap::new();
        for (name, value) in event.labels {
            if name == cfg.prom.ha_replica_label {
                replica_label = value;
                continue;
            }
            if name == cfg.prom.ha_cluster_label {
                if cluster_name.is_empty() {
                    cluster_name = format!("{}/{}", org_id, value);
                }
                continue;
            }
            columnar::push_label(
                &mut label_pairs,
                &mut label_index,
                (format_label_name_cow(name), Cow::Borrowed(value)),
            );
        }

        let metric_name = match label_pairs
            .iter_mut()
            .find(|(name, _)| name.as_ref() == NAME_LABEL)
        {
            // `__name__` must equal the stream name or `{__name__="..."}` can never match
            Some((_, v)) => {
                let name = match formatted_names.get(v.as_ref()) {
                    Some(name) => name.clone(),
                    None => format_stream_name(v.to_string()),
                };
                if v.as_ref() != name.as_str() {
                    *v = Cow::Owned(name.clone());
                }
                name
            }
            None => continue,
        };

        // check stream if it is deleting
        let is_deleting = match stream_delete_status.get(&metric_name) {
            Some(v) => *v,
            None => {
                let flag = db::compact::retention::is_deleting_stream(
                    org_id,
                    StreamType::Metrics,
                    &metric_name,
                    None,
                );
                stream_delete_status.insert(metric_name.clone(), flag);
                flag
            }
        };

        if is_deleting {
            skipped_records += 1;
            continue;
        }

        // Note: All configurations (pipeline, UDS, schema, partition, alerts) are now pre-loaded
        // before the loop to avoid repeated async queries

        let mut gate = HaGate {
            first_line: &mut first_line,
            armed: dedup_enabled && !cluster_name.is_empty(),
            cluster_name: &cluster_name,
            replica_label,
            interval: election_interval,
        };

        // every sample of a series shares its labels, so the identity is loop-invariant
        let series_hash = super::signature_of_series_labels(&label_pairs);

        // a label the schema has not seen goes down the JSON path, which evolves the schema
        if event.histograms.is_empty()
            && let Some(columnar) = columnar_streams.get_mut(&metric_name)
            && let Some(label_bytes) = columnar.resolve_columns(&label_pairs)
        {
            sample_count += event.samples.len();
            // no iterator may live across this await, or the handler loses axum's `Handler` bound
            let has_writable = event
                .samples
                .iter()
                .any(|s| super::sanitize_metric_value(s.value).is_some());
            if has_writable && !gate.admit().await {
                ingest::observe_request(WRITE_ENDPOINT, org_id, &start);
                return Ok(());
            }
            for sample in &event.samples {
                if let Some(value) = super::sanitize_metric_value(sample.value) {
                    let timestamp = parse_i64_to_timestamp_micros(sample.timestamp);
                    columnar.append(&label_pairs, label_bytes, value, timestamp, series_hash);
                }
            }
            continue;
        }

        let mut labels: json::Map<String, json::Value> =
            json::Map::with_capacity(label_pairs.len() + 3);
        for (name, value) in label_pairs {
            labels.insert(name.into_owned(), json::Value::String(value.into_owned()));
        }
        // a pipeline rewrites the labels the identity derives from, UDS trimming drops some of them
        let known_hash = (!stream_executable_pipelines
            .get(&metric_name)
            .is_some_and(|v| !v.is_empty())
            && !matches!(user_defined_schema_map.get(&metric_name), Some(Some(_))))
        .then_some(series_hash);

        // parse samples
        let sample_total = event.samples.len();
        let can_move_labels = event.histograms.is_empty();
        for (sample_idx, sample) in event.samples.into_iter().enumerate() {
            sample_count += 1;
            // NaN -> no observation -> no record; infinities clamp. Shared with the OTLP
            // writer so the two ingestion paths cannot drift apart on this.
            let Some(sample_val) = super::sanitize_metric_value(sample.value) else {
                continue;
            };

            if !gate.admit().await {
                // do not accept any entries for this request
                ingest::observe_request(WRITE_ENDPOINT, org_id, &start);
                return Ok(());
            }

            let timestamp = parse_i64_to_timestamp_micros(sample.timestamp);
            // the last sample owns the label set outright; nothing reads it afterwards
            let value = if can_move_labels && sample_idx + 1 == sample_total {
                build_metric_record(std::mem::take(&mut labels), sample_val, timestamp)
            } else {
                build_metric_record(labels.clone(), sample_val, timestamp)
            };

            // ready to be buffered for downstream processing
            buffer_metric_record(
                &metric_name,
                json::Value::Object(value),
                timestamp,
                known_hash,
                &mut sink,
            );
        }

        if !event.histograms.is_empty() {
            match buffer_native_histograms(
                &event.histograms,
                &labels,
                &metric_name,
                cfg.prom.native_histogram_max_buckets,
                &mut gate,
                &mut sink,
            )
            .await
            {
                Some(counted) => sample_count += counted,
                None => {
                    ingest::observe_request(WRITE_ENDPOINT, org_id, &start);
                    return Ok(());
                }
            }
        }
    }

    // warn if any records were skipped due to streams being deleted
    if skipped_records > 0 {
        log::warn!("[METRICS:PROM] Skipped {skipped_records} records due to streams being deleted");
    }

    let parse_timeseries_ms = step_start.elapsed().as_millis();

    // Detailed performance logging
    if parse_timeseries_ms > 200 {
        let parse_timeseries_us = parse_timeseries_ms * 1000;
        let other_time = parse_timeseries_us.saturating_sub(total_preload_time);

        log::info!(
            "[remote_write] org: {org_id}, parse timeseries took: {parse_timeseries_ms} ms, streams: {} (events: {event_count}, samples: {sample_count}) | \
            preload_total={:.1}ms (pipeline={:.1}ms, uds={:.1}ms, schema={:.1}ms, alerts={:.1}ms), other={:.1}ms",
            unique_metrics.len(),
            total_preload_time as f64 / 1000.0,
            preload_pipeline_time as f64 / 1000.0,
            preload_uds_time as f64 / 1000.0,
            preload_schema_time as f64 / 1000.0,
            preload_alerts_time as f64 / 1000.0,
            other_time as f64 / 1000.0,
        );
    }

    let (pipeline_outputs, _) = ingest::run_pipelines(
        org_id,
        &stream_executable_pipelines,
        stream_pipeline_inputs,
        &user_defined_schema_map,
        &mut stream_partitioning_map,
    )
    .await;
    for (stream_name, records) in pipeline_outputs {
        // a pipeline rewrote the labels, so the series hash is recomputed from its output
        json_data_by_stream.entry(stream_name).or_default().extend(
            records
                .into_iter()
                .map(|(record, timestamp)| (record, timestamp, None)),
        );
    }

    let step_start = std::time::Instant::now();
    for (stream_name, mut json_data) in json_data_by_stream {
        finish_identity_columns(&mut json_data);
        let has_uds = matches!(user_defined_schema_map.get(&stream_name), Some(Some(_)));
        let min_timestamp = json_data.iter().map(|(_, ts, _)| *ts).min().unwrap_or(0);
        let record_refs: Vec<&json::Map<String, json::Value>> =
            json_data.iter().map(|(record, ..)| record).collect();
        let (schema, schema_key) = ingest::resolve_batch_schema(
            org_id,
            &stream_name,
            &mut metric_schema_map,
            &record_refs,
            min_timestamp,
            has_uds,
        )
        .await?;
        drop(record_refs);

        let alerts =
            stream_alerts_map.get(&cache_stream_key(org_id, StreamType::Metrics, &stream_name));
        let partition_keys = stream_partitioning_map.get(&stream_name);
        let triggers = ingest::buffer_stream_records(
            org_id,
            json_data
                .into_iter()
                .map(|(record, timestamp, _)| (record, timestamp)),
            &schema,
            &schema_key,
            partition_keys,
            alerts,
            metric_data_map.entry(stream_name.clone()).or_default(),
        )
        .await;
        if triggers.is_some() {
            stream_trigger_map.insert(stream_name, triggers);
        }
    }
    let elapsed_ms = step_start.elapsed().as_millis();
    if elapsed_ms > 200 {
        log::info!(
            "[remote_write] org: {org_id}, build records and schema check took: {elapsed_ms} ms",
        );
    }

    // write data to wal
    let step_start = std::time::Instant::now();

    let entries_by_stream = ingest::entries_by_stream(org_id, metric_data_map, columnar_streams)?;

    let timings = ingest::write_streams(
        org_id,
        entries_by_stream,
        &stream_executable_pipelines,
        &user,
        UsageType::PrometheusRemoteWrite,
        &start,
        started_at,
    )
    .await?;
    let elapsed_ms = step_start.elapsed().as_micros();
    if elapsed_ms > 200_000 {
        let other_time = elapsed_ms
            - timings.get_writer_micros
            - timings.write_micros
            - timings.report_stats_micros
            - timings.deletion_check_micros;

        log::info!(
            "[remote_write] org: {org_id}, write to WAL took: {} ms (streams: {}) | \
            breakdown: deletion_check={:.1}ms, get_writer={:.1}ms, write_file={:.1}ms, report_stats={:.1}ms, other={:.1}ms",
            elapsed_ms as f64 / 1000.0,
            timings.streams,
            timings.deletion_check_micros as f64 / 1000.0,
            timings.get_writer_micros as f64 / 1000.0,
            timings.write_micros as f64 / 1000.0,
            timings.report_stats_micros as f64 / 1000.0,
            other_time as f64 / 1000.0,
        );
    }

    ingest::observe_request(WRITE_ENDPOINT, org_id, &start);
    ingest::spawn_triggers(stream_trigger_map);

    let total_ms = start.elapsed().as_millis();
    if total_ms > 1000 {
        log::info!("[remote_write] org: {org_id}, total time: {total_ms} ms");
    }

    Ok(())
}

pub async fn get_metadata(org_id: &str, req: RequestMetadata) -> Result<ResponseMetadata> {
    if req.limit == Some(0) {
        return Ok(hashbrown::HashMap::new());
    }

    let stream_type = StreamType::Metrics;

    if let Some(metric_name) = req.metric {
        let schema = infra::schema::get(org_id, &metric_name, stream_type)
            .await
            // `db::schema::get` never fails, so it's safe to unwrap
            .unwrap();
        let mut resp = hashbrown::HashMap::new();
        if schema != Schema::empty() {
            resp.insert(
                metric_name,
                get_metadata_object(&schema).map_or_else(Vec::new, |obj| vec![obj]),
            );
        };
        return Ok(resp);
    }

    match db::schema::list(org_id, Some(stream_type), true).await {
        Err(error) => {
            tracing::error!(%stream_type, ?error, "failed to get metrics' stream schemas");
            Err(Error::Message(format!(
                "failed to get metrics' stream schemas: {error}"
            )))
        }
        Ok(mut stream_schemas) => {
            stream_schemas.sort_by(|a, b| a.stream_name.cmp(&b.stream_name));
            let histogram_summary = stream_schemas
                .iter()
                .filter_map(|v| match super::get_prom_metadata_from_schema(&v.schema) {
                    None => None,
                    Some(v) => {
                        if v.metric_type == MetricType::Histogram
                            || v.metric_type == MetricType::Summary
                        {
                            Some(v.metric_family_name)
                        } else {
                            None
                        }
                    }
                })
                .collect::<Vec<_>>();
            let mut histogram_summary_sub = Vec::with_capacity(histogram_summary.len() * 3);
            for name in histogram_summary.iter() {
                histogram_summary_sub.push(format!("{name}_bucket"));
                histogram_summary_sub.push(format!("{name}_count"));
                histogram_summary_sub.push(format!("{name}_sum"));
            }
            let metric_names = stream_schemas.into_iter().filter_map(|schema| {
                if histogram_summary_sub.contains(&schema.stream_name) {
                    None
                } else {
                    get_metadata_object(&schema.schema).map(|meta| (schema.stream_name, vec![meta]))
                }
            });
            Ok(match req.limit {
                None => metric_names.collect(),
                Some(limit) => metric_names.take(limit).collect(),
            })
        }
    }
}

// HACK: the implementation returns at most one metadata object per metric.
// This differs from Prometheus, which [supports] multiple metadata objects per
// metric.
//
// [supports]: https://prometheus.io/docs/prometheus/latest/querying/api/#querying-metric-metadata
fn get_metadata_object(schema: &Schema) -> Option<MetadataObject> {
    // delegate rather than parse the blob a second time. The duplicate parse this replaces had
    // its own `panic!("BUG: failed to parse ...")`, so one corrupt schema entry took the process
    // down; and a second parser is a second thing to keep in step with the shared reader, which
    // is where a historically JSON-quoted family name gets normalised.
    super::get_prom_metadata_from_schema(schema).map(Into::into)
}

/// Default lookback window for `/api/v1/series` when `start` is omitted.
///
/// The Prometheus spec makes `start`/`end` optional (defaulting to the full
/// TSDB range), but an unbounded range is rejected by the file_list layer and
/// would mean a full-retention scan. 24h keeps low-frequency metrics (daily
/// jobs) discoverable while bounding the query cost.
const DEFAULT_SERIES_LOOKBACK_MICROS: i64 = 24 * 3600 * 1_000_000;

const WRITE_ENDPOINT: &str = "/prometheus/api/v1/write";

fn normalize_series_time_range(start: i64, end: i64) -> (i64, i64) {
    let end = if end <= 0 { now_micros() } else { end };
    let start = if start <= 0 {
        end - DEFAULT_SERIES_LOOKBACK_MICROS
    } else {
        start
    };
    (start, end)
}

pub async fn get_series(
    org_id: &str,
    selector: Option<parser::VectorSelector>,
    start: i64,
    end: i64,
) -> Result<Vec<serde_json::Value>> {
    let (start, end) = normalize_series_time_range(start, end);
    let metric_name = match selector.as_ref().and_then(try_into_metric_name) {
        Some(name) => name,
        None => {
            // HACK: in the ideal world we would have queried all the metric streams
            return Ok(vec![]);
        }
    };

    let schema = infra::schema::get(org_id, &metric_name, StreamType::Metrics)
        .await
        // `db::schema::get` never fails, so it's safe to unwrap
        .unwrap();

    // Comma-separated list of label names
    let label_names = schema
        .fields()
        .iter()
        .map(|f| f.name().as_str())
        .filter(|&s| s != TIMESTAMP_COL_NAME && s != VALUE_LABEL && s != HASH_LABEL)
        .collect::<Vec<_>>()
        .join("\", \"");
    if label_names.is_empty() {
        return Ok(vec![]);
    }

    let mut sql = format!("SELECT DISTINCT({HASH_LABEL}), \"{label_names}\" FROM {metric_name}");
    let mut sql_where = Vec::new();
    if let Some(selector) = selector {
        for mat in selector.matchers.matchers.iter() {
            // `__name__` already picked the stream; the stored column may hold the
            // pre-`format_stream_name` metric name, so filtering on it drops all rows.
            if mat.name == TIMESTAMP_COL_NAME
                || mat.name == VALUE_LABEL
                || mat.name == NAME_LABEL
                || schema.field_with_name(&mat.name).is_err()
            {
                continue;
            }
            match &mat.op {
                MatchOp::Equal => {
                    sql_where.push(format!("{} = '{}'", mat.name, mat.value));
                }
                MatchOp::NotEqual => {
                    sql_where.push(format!("{} != '{}'", mat.name, mat.value));
                }
                MatchOp::Re(_re) => {
                    sql_where.push(format!("re_match({}, '{}')", mat.name, mat.value));
                }
                MatchOp::NotRe(_re) => {
                    sql_where.push(format!("re_not_match({}, '{}')", mat.name, mat.value));
                }
            }
        }
        if !sql_where.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&sql_where.join(" AND "));
        }
    }

    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            from: 0,
            size: 1000,
            start_time: start,
            end_time: end,
            ..Default::default()
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        search_type: None,
        search_event_context: None,
        use_cache: default_use_cache(),
        clear_cache: false,
        local_mode: None,
        agent_options: None,
    };
    let series = match search_service::search("", org_id, StreamType::Metrics, None, &req).await {
        Err(err) => {
            log::error!("search series error: {err}");
            return Err(err);
        }
        Ok(resp) => resp
            .hits
            .into_iter()
            .map(|mut val| {
                if let Some(map) = val.as_object_mut() {
                    map.remove(HASH_LABEL);
                }
                val
            })
            .collect(),
    };
    Ok(series)
}

pub async fn get_labels(
    org_id: &str,
    selector: Option<parser::VectorSelector>,
    start: i64,
    end: i64,
) -> Result<Vec<String>> {
    let opt_metric_name = selector.as_ref().and_then(try_into_metric_name);
    let stream_schemas = match db::schema::list(org_id, Some(StreamType::Metrics), true).await {
        Err(_) => return Ok(vec![]),
        Ok(schemas) => schemas,
    };
    let mut label_names = hashbrown::HashSet::new();
    for schema in stream_schemas {
        if let Some(ref metric_name) = opt_metric_name
            && *metric_name != schema.stream_name
        {
            // Client has requested a particular metric name, but this stream is
            // not it.
            continue;
        }
        let stats = stats::get_stream_stats(org_id, &schema.stream_name, StreamType::Metrics);
        if stats.time_range_intersects(start, end) {
            let field_names = schema
                .schema
                .fields()
                .iter()
                .map(|f| f.name())
                .filter(|&s| s != TIMESTAMP_COL_NAME && s != VALUE_LABEL && s != HASH_LABEL)
                .cloned();
            label_names.extend(field_names);
        }
    }
    let mut label_names = label_names.into_iter().collect::<Vec<_>>();
    label_names.sort();
    Ok(label_names)
}

/// The stats that say whether a metric family has data in a time range -- i.e. whether the
/// metric should be offered as a name at all.
///
/// A family is stored as one stream per member, and its base stream is mostly a metadata holder:
/// a histogram writes every row to `_count` / `_sum` / `_bucket` and nothing to the base at all,
/// so reading the base's stats would hide every histogram in the org. Members are therefore
/// tried in turn, and the first one with rows answers for the family:
///
/// - `_count` first: it is a `u64` on every data point, so it is always written. `_sum` is not --
///   it is optional in OTLP and, since a NaN is no longer recorded, a source that reports its sum
///   as NaN writes no `_sum` stream at all. Keying on `_sum` alone would hide the whole family
///   while its buckets ingested normally.
/// - then `_sum`, for a family whose `_count` has no stats.
/// - then the base stream itself, which for a *summary* is where the quantile rows live.
fn family_stats(
    org_id: &str,
    stream_name: &str,
    metadata: Option<&Metadata>,
    stream_type: StreamType,
) -> StreamStats {
    let is_family = metadata.is_some_and(|m| {
        matches!(
            m.metric_type,
            MetricType::Histogram | MetricType::ExponentialHistogram | MetricType::Summary
        )
    });
    if !is_family {
        return stats::get_stream_stats(org_id, stream_name, stream_type);
    }

    let base = stats::get_stream_stats(org_id, stream_name, stream_type);
    for member in [format!("{stream_name}_count"), format!("{stream_name}_sum")] {
        let stats = stats::get_stream_stats(org_id, &member, stream_type);
        if stats.doc_num > 0 {
            return stats;
        }
    }
    base
}

pub async fn get_label_values(
    org_id: &str,
    label_name: String,
    selector: Option<parser::VectorSelector>,
    start: i64,
    end: i64,
) -> Result<Vec<String>> {
    let opt_metric_name = selector.as_ref().and_then(try_into_metric_name);
    let stream_type = StreamType::Metrics;

    if label_name == NAME_LABEL {
        // This special case doesn't require any SQL to be executed. All we have
        // to do is to collect stream names that satisfy selection criteria
        // (i.e., `selector` and `start`/`end`) and return them.
        let stream_schemas = db::schema::list(org_id, Some(stream_type), true)
            .await
            .unwrap_or_default();
        let mut label_values = Vec::with_capacity(stream_schemas.len());
        for schema in stream_schemas {
            if let Some(ref metric_name) = opt_metric_name
                && *metric_name != schema.stream_name
            {
                // Client has requested a particular metric name, but this stream is
                // not it.
                continue;
            }
            let stats = family_stats(
                org_id,
                &schema.stream_name,
                super::get_prom_metadata_from_schema(&schema.schema).as_ref(),
                stream_type,
            );
            if stats.time_range_intersects(start, end) {
                label_values.push(schema.stream_name)
            }
        }
        label_values.sort();
        return Ok(label_values);
    }

    let metric_name = match opt_metric_name {
        Some(name) => name,
        None => {
            // HACK: in the ideal world we would have queried all the metric streams
            // and collected label names from them.
            return Ok(vec![]);
        }
    };

    let schema = infra::schema::get(org_id, &metric_name, stream_type)
        .await
        // `db::schema::get` never fails, so it's safe to unwrap
        .unwrap();
    if schema.fields().is_empty() {
        return Ok(vec![]);
    }
    if schema.field_with_name(&label_name).is_err() {
        return Ok(vec![]);
    }

    // Build SQL query with optional WHERE clause based on selector matchers
    let mut sql = format!("SELECT DISTINCT({label_name}) FROM {metric_name}");
    let mut sql_where = Vec::new();

    if let Some(selector) = selector {
        for mat in selector.matchers.matchers.iter() {
            // Skip special fields and fields that don't exist in the schema
            if mat.name == TIMESTAMP_COL_NAME
                || mat.name == VALUE_LABEL
                || mat.name == NAME_LABEL
                || schema.field_with_name(&mat.name).is_err()
            {
                continue;
            }
            match &mat.op {
                MatchOp::Equal => {
                    sql_where.push(format!("{} = '{}'", mat.name, mat.value));
                }
                MatchOp::NotEqual => {
                    sql_where.push(format!("{} != '{}'", mat.name, mat.value));
                }
                MatchOp::Re(_re) => {
                    sql_where.push(format!("re_match({}, '{}')", mat.name, mat.value));
                }
                MatchOp::NotRe(_re) => {
                    sql_where.push(format!("re_not_match({}, '{}')", mat.name, mat.value));
                }
            }
        }
        if !sql_where.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&sql_where.join(" AND "));
        }
    }

    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            from: 0,
            size: 1000,
            start_time: start,
            end_time: end,
            ..Default::default()
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        search_type: None,
        search_event_context: None,
        use_cache: default_use_cache(),
        clear_cache: false,
        local_mode: None,
        agent_options: None,
    };
    let mut label_values = match search_service::search("", org_id, stream_type, None, &req).await {
        Ok(resp) => resp
            .hits
            .iter()
            .filter_map(|v| v.as_object().unwrap().get(&label_name))
            .map(|v| v.as_str().unwrap().to_string())
            .collect::<Vec<_>>(),
        Err(err) => {
            log::error!("search values error: {err:?}");
            return Err(err);
        }
    };
    label_values.sort();
    label_values.dedup();
    Ok(label_values)
}

pub fn try_into_metric_name(selector: &parser::VectorSelector) -> Option<String> {
    match &selector.name {
        Some(name) => {
            // `match[]` argument contains a metric name, e.g.
            // `match[]=zo_response_code{method="GET"}`
            Some(name.clone())
        }
        None => {
            // `match[]` argument does not contain a metric name.
            // Check if there is `__name__` among the matchers,
            // e.g. `match[]={__name__="zo_response_code",method="GET"}`
            selector
                .matchers
                .find_matchers(NAME_LABEL)
                .first()
                .map(|m| m.value.clone())
        }
    }
}

/// Fills in `__hash__` and `_timestamp`, so the schema below sees the fields that get written.
fn finish_identity_columns(json_data: &mut [PendingRecord]) {
    for (val_map, timestamp, known_hash) in json_data.iter_mut() {
        // a `__hash__` the handler did not compute is an input field and gets overwritten
        let hash =
            known_hash.unwrap_or_else(|| super::signature_without_labels(val_map, &[VALUE_LABEL]));
        val_map.insert(HASH_LABEL.to_string(), json::Value::Number(hash.into()));
        val_map.insert(
            TIMESTAMP_COL_NAME.to_string(),
            json::Value::Number((*timestamp).into()),
        );
    }
}

fn build_metric_record(
    mut record: json::Map<String, json::Value>,
    value: f64,
    timestamp: i64,
) -> json::Map<String, json::Value> {
    record.insert(
        VALUE_LABEL.to_string(),
        json::Number::from_f64(value).map_or(json::Value::Null, json::Value::Number),
    );
    record.insert(
        TIMESTAMP_COL_NAME.to_string(),
        json::Value::Number(timestamp.into()),
    );
    record
}

fn buffer_metric_record(
    metric_name: &str,
    mut value: json::Value,
    timestamp: i64,
    known_hash: Option<u64>,
    sink: &mut RecordSink<'_>,
) {
    if sink
        .pipelines
        .get(metric_name)
        .is_some_and(|v| !v.is_empty())
    {
        // buffer to pipeline for batch processing
        sink.pipeline_inputs
            .entry(metric_name.to_owned())
            .or_default()
            .push((value, timestamp));
    } else {
        // get json object
        let mut local_val = match value.take() {
            json::Value::Object(val) => val,
            _ => unreachable!(),
        };

        if let Some(Some(fields)) = sink.user_defined_schema.get(metric_name) {
            local_val = crate::ingestion::refactor_map(local_val, fields);
        }

        // buffer to downstream processing directly
        sink.json_data_by_stream
            .entry(metric_name.to_owned())
            .or_default()
            .push((local_val, timestamp, known_hash));
    }
}

/// `None` means this replica lost the HA election, so the request must write nothing.
async fn buffer_native_histograms(
    histograms: &[prometheus_rpc::Histogram],
    labels: &json::Map<String, json::Value>,
    metric_name: &str,
    max_buckets: usize,
    gate: &mut HaGate<'_>,
    sink: &mut RecordSink<'_>,
) -> Option<usize> {
    // one stream name + label template per derived stream, not one per record
    let mut derived_streams = CLASSIC_HISTOGRAM_SUFFIXES.map(|suffix| {
        let mut hist_labels = labels.clone();
        if let Some(json::Value::String(name)) = hist_labels.get_mut(NAME_LABEL) {
            name.push_str(suffix);
        }
        (format!("{metric_name}{suffix}"), hist_labels)
    });
    let mut counted = 0;
    for hp in histograms {
        counted += 1;
        let records = expand_native_histogram(hp, max_buckets);
        if records.is_empty() {
            // unsupported schema or stale marker: nothing will be written
            continue;
        }
        if !gate.admit().await {
            return None;
        }
        let timestamp = parse_i64_to_timestamp_micros(hp.timestamp);
        for (suffix, le, value) in records {
            let Some(value) = super::sanitize_metric_value(value) else {
                continue;
            };
            let idx = CLASSIC_HISTOGRAM_SUFFIXES
                .iter()
                .position(|s| *s == suffix)
                .unwrap();
            let (stream_name, hist_labels) = &mut derived_streams[idx];
            if let Some(le) = le {
                hist_labels.insert(BUCKET_LABEL.to_string(), json::Value::String(le));
            }
            let record = build_metric_record(hist_labels.clone(), value, timestamp);
            buffer_metric_record(
                stream_name,
                json::Value::Object(record),
                timestamp,
                None,
                sink,
            );
        }
    }
    Some(counted)
}

/// Looks up the current leader state and runs leader election for this replica.
/// Requests without a replica label are always accepted.
async fn run_ha_election(cluster_name: &str, replica_label: &str, election_interval: i64) -> bool {
    if replica_label.is_empty() {
        return true;
    }
    let (has_entry, last_received) = match METRIC_CLUSTER_LEADER.read().await.get(cluster_name) {
        Some(leader) => (true, leader.last_received),
        None => (false, 0),
    };
    prom_ha_handler(
        has_entry,
        cluster_name,
        replica_label,
        last_received,
        election_interval,
    )
    .await
}

/// Records the request metrics for a write rejected by HA election.
async fn prom_ha_handler(
    has_entry: bool,
    cluster_name: &str,
    replica_label: &str,
    last_received: i64,
    election_interval: i64,
) -> bool {
    let mut _accept_record = false;
    let curr_ts = Utc::now().timestamp_micros();
    if !has_entry {
        METRIC_CLUSTER_MAP
            .write()
            .await
            .insert(cluster_name.to_owned(), vec![]);
        log::info!("Making {replica_label} leader for {cluster_name} ");
        METRIC_CLUSTER_LEADER.write().await.insert(
            cluster_name.to_owned(),
            ClusterLeader {
                name: replica_label.to_owned(),
                last_received: curr_ts,
                updated_by: LOCAL_NODE.uuid.clone(),
            },
        );
        _accept_record = true;
    } else {
        let mut lock = METRIC_CLUSTER_LEADER.write().await;
        let leader = lock.get_mut(cluster_name).unwrap();
        if replica_label.eq(&leader.name) {
            _accept_record = true;
            leader.last_received = curr_ts;
            // log::info!(  "Updating last received data for {} to {}",
            // &leader.name, Utc.timestamp_nanos(last_received * 1000));
        } else if curr_ts - last_received > election_interval {
            // elect new leader as didnt receive data for last 30 secs
            log::info!(
                "Electing {} new leader for {} as last received data from {} at {} ",
                replica_label,
                cluster_name,
                leader.name,
                Utc.timestamp_nanos(last_received * 1000)
            );
            leader.name = replica_label.to_owned();
            leader.last_received = curr_ts;
            _accept_record = true;
        } else {
            // log::info!(
            //     "Rejecting entry from {}  as leader is {}",
            //     replica_label,
            //     &leader.name,
            // );
            _accept_record = false;
        }
    }

    let mut lock = METRIC_CLUSTER_MAP.write().await;
    let replica_list = lock.entry(cluster_name.to_owned()).or_default();
    let replica_list_db = if !replica_list.contains(&replica_label.to_owned()) {
        replica_list.push(replica_label.to_owned());
        replica_list.clone()
    } else {
        vec![]
    };
    drop(lock);

    if !replica_list_db.is_empty() {
        let _ = db::metrics::set_prom_cluster_info(cluster_name, &replica_list_db).await;
    }

    _accept_record
}

#[cfg(test)]
mod tests {
    use config::utils::flatten::format_label_name_owned;
    use promql_parser::{
        label::{MatchOp, Matcher, Matchers},
        parser::VectorSelector,
    };

    use super::*;

    fn schema_with_metadata(blob: &str) -> Schema {
        Schema::empty().with_metadata(
            [(METADATA_LABEL.to_string(), blob.to_string())]
                .into_iter()
                .collect(),
        )
    }

    /// Note `MetadataObject` carries only type/help/unit -- the family name is dropped on the
    /// way out -- so `/api/v1/metadata` cannot be asserted to serve an unquoted family name.
    /// What the endpoint gets from delegating is the shared reader's parse, asserted below.
    #[test]
    fn test_get_metadata_object_serves_type_help_unit() {
        let schema = schema_with_metadata(
            r#"{"metric_type":"Histogram","metric_family_name":"foo","help":"h","unit":"s"}"#,
        );

        let served = serde_json::to_value(get_metadata_object(&schema).unwrap()).unwrap();
        assert_eq!(served["type"], "histogram");
        assert_eq!(served["help"], "h");
        assert_eq!(served["unit"], "s");
    }

    fn family_metadata(metric_type: MetricType) -> Metadata {
        Metadata {
            metric_type,
            metric_family_name: "http_request_duration_seconds".to_string(),
            help: String::new(),
            unit: String::new(),
        }
    }

    fn seed_stats(org_id: &str, stream_name: &str, doc_num: i64, doc_time_max: i64) {
        stats::set_stream_stats(
            org_id,
            stream_name,
            StreamType::Metrics,
            StreamStats {
                doc_num,
                doc_time_min: 1,
                doc_time_max,
                ..Default::default()
            },
        );
    }

    /// The regression this guards: dropping NaN records means a histogram whose sum is always
    /// NaN writes no `_sum` stream at all. Keyed on `_sum`, the whole family would disappear
    /// from the metric picker while its buckets were still ingesting.
    #[test]
    fn test_family_stats_prefers_count_over_sum() {
        let org = "test_family_stats_count";
        seed_stats(org, "http_request_duration_seconds_count", 100, 5_000);
        // no `_sum` stream at all: its sum is NaN on every data point

        let stats = family_stats(
            org,
            "http_request_duration_seconds",
            Some(&family_metadata(MetricType::Histogram)),
            StreamType::Metrics,
        );

        assert_eq!(stats.doc_num, 100);
        assert!(stats.time_range_intersects(1, 6_000));
    }

    /// An exponential histogram writes `_count` / `_sum` / `_bucket` like any other histogram and
    /// nothing to its base stream, so it has to be treated as a family too -- read the base and
    /// it looks empty, and the metric never appears in the picker.
    #[test]
    fn test_family_stats_treats_exponential_histogram_as_a_family() {
        let org = "test_family_stats_exp_hist";
        seed_stats(org, "http_request_duration_seconds_count", 100, 5_000);

        let stats = family_stats(
            org,
            "http_request_duration_seconds",
            Some(&family_metadata(MetricType::ExponentialHistogram)),
            StreamType::Metrics,
        );

        assert_eq!(stats.doc_num, 100);
    }

    /// A summary's quantile rows keep the base metric name -- they are not renamed the way
    /// `_count` and `_sum` are -- so the base stream is the last place worth looking.
    #[test]
    fn test_family_stats_falls_back_to_the_base_stream() {
        let org = "test_family_stats_base";
        seed_stats(org, "request_latency", 25, 5_000);

        let stats = family_stats(
            org,
            "request_latency",
            Some(&family_metadata(MetricType::Summary)),
            StreamType::Metrics,
        );

        assert_eq!(stats.doc_num, 25);
    }

    /// The fallback: a family with no `_count` stats still resolves rather than disappearing.
    #[test]
    fn test_family_stats_falls_back_to_sum_when_count_is_empty() {
        let org = "test_family_stats_sum";
        seed_stats(org, "http_request_duration_seconds_sum", 50, 5_000);

        let stats = family_stats(
            org,
            "http_request_duration_seconds",
            Some(&family_metadata(MetricType::Summary)),
            StreamType::Metrics,
        );

        assert_eq!(stats.doc_num, 50);
    }

    /// A gauge or counter keeps its own rows, so it is its own liveness signal.
    #[test]
    fn test_family_stats_uses_the_stream_itself_for_non_families() {
        let org = "test_family_stats_gauge";
        seed_stats(org, "http_request_duration_seconds", 7, 5_000);
        seed_stats(org, "http_request_duration_seconds_count", 999, 5_000);

        let stats = family_stats(
            org,
            "http_request_duration_seconds",
            Some(&family_metadata(MetricType::Gauge)),
            StreamType::Metrics,
        );
        assert_eq!(stats.doc_num, 7);

        // and with no metadata at all
        let stats = family_stats(
            org,
            "http_request_duration_seconds",
            None,
            StreamType::Metrics,
        );
        assert_eq!(stats.doc_num, 7);
    }

    /// This endpoint used to parse the blob itself, with its own
    /// `panic!("BUG: failed to parse ...")` -- one corrupt schema entry took the process down.
    /// It now delegates to the shared reader, which returns `None` instead. That delegation is
    /// also what keeps `/api/v1/metadata` and `/streams` from drifting apart on a family name
    /// that is JSON-quoted in storage: only the shared reader normalises it.
    #[test]
    fn test_get_metadata_object_malformed_blob_is_none_not_panic() {
        assert!(get_metadata_object(&schema_with_metadata("not json")).is_none());
    }

    #[test]
    fn test_get_metadata_object_absent_metadata_is_none() {
        assert!(get_metadata_object(&Schema::empty()).is_none());
    }

    fn selector_with_name(name: &str) -> VectorSelector {
        VectorSelector {
            name: Some(name.to_string()),
            matchers: Matchers {
                matchers: vec![],
                or_matchers: vec![],
            },
            offset: None,
            at: None,
        }
    }

    fn selector_with_name_label(name: &str) -> VectorSelector {
        VectorSelector {
            name: None,
            matchers: Matchers {
                matchers: vec![Matcher {
                    name: "__name__".to_string(),
                    op: MatchOp::Equal,
                    value: name.to_string(),
                }],
                or_matchers: vec![],
            },
            offset: None,
            at: None,
        }
    }

    #[test]
    fn test_try_into_metric_name_from_name_field() {
        let sel = selector_with_name("my_metric");
        assert_eq!(try_into_metric_name(&sel), Some("my_metric".to_string()));
    }

    #[test]
    fn test_try_into_metric_name_from_name_label_matcher() {
        let sel = selector_with_name_label("metric_via_label");
        assert_eq!(
            try_into_metric_name(&sel),
            Some("metric_via_label".to_string())
        );
    }

    #[test]
    fn test_try_into_metric_name_none_when_no_name_or_name_label() {
        let sel = VectorSelector {
            name: None,
            matchers: Matchers {
                matchers: vec![Matcher {
                    name: "job".to_string(),
                    op: MatchOp::Equal,
                    value: "myservice".to_string(),
                }],
                or_matchers: vec![],
            },
            offset: None,
            at: None,
        };
        assert_eq!(try_into_metric_name(&sel), None);
    }

    #[test]
    fn test_try_into_metric_name_name_field_takes_precedence() {
        let sel = VectorSelector {
            name: Some("direct_name".to_string()),
            matchers: Matchers {
                matchers: vec![Matcher {
                    name: "__name__".to_string(),
                    op: MatchOp::Equal,
                    value: "label_name".to_string(),
                }],
                or_matchers: vec![],
            },
            offset: None,
            at: None,
        };
        assert_eq!(try_into_metric_name(&sel), Some("direct_name".to_string()));
    }

    #[test]
    fn test_normalize_series_time_range_defaults_to_lookback() {
        // omitted start arrives as 0 (see validate_metadata_params); it must
        // become a bounded window or file_list rejects the query (issue #13120)
        let end = now_micros();
        let (start, end_out) = normalize_series_time_range(0, end);
        assert_eq!(end_out, end);
        assert_eq!(start, end - DEFAULT_SERIES_LOOKBACK_MICROS);
    }

    #[test]
    fn test_normalize_series_time_range_defaults_end_to_now() {
        let before = now_micros();
        let (start, end) = normalize_series_time_range(0, 0);
        assert!(end >= before);
        assert_eq!(start, end - DEFAULT_SERIES_LOOKBACK_MICROS);
    }

    #[test]
    fn test_normalize_series_time_range_explicit_values_untouched() {
        let (start, end) = normalize_series_time_range(1_000, 2_000);
        assert_eq!((start, end), (1_000, 2_000));
    }

    #[test]
    fn test_push_label_collapses_formatted_collisions_like_the_json_map() {
        let mut label_pairs: Vec<(String, String)> = Vec::new();
        let mut label_index = HashMap::new();
        for (name, value) in [("__name__", "m"), ("foo.bar", "a"), ("foo-bar", "b")] {
            columnar::push_label(
                &mut label_pairs,
                &mut label_index,
                (format_label_name_owned(name.to_string()), value.to_string()),
            );
        }

        assert_eq!(
            label_pairs,
            vec![
                (NAME_LABEL.to_string(), "m".to_string()),
                ("foo_bar".to_string(), "b".to_string()),
            ]
        );
        let mut labels = json::Map::new();
        for (name, value) in &label_pairs {
            labels.insert(name.clone(), json::Value::String(value.clone()));
        }
        let record = build_metric_record(labels, 1.5, 1_700_000_000_000_000);
        assert_eq!(
            crate::metrics::signature_of_series_labels(&label_pairs),
            crate::metrics::signature_without_labels(&record, &[VALUE_LABEL])
        );
    }

    #[test]
    fn test_finish_identity_columns_overwrites_a_hash_it_did_not_compute() {
        let mut labels = json::Map::new();
        labels.insert(NAME_LABEL.to_string(), json::json!("http_requests"));
        labels.insert(HASH_LABEL.to_string(), json::json!("sent by the client"));
        let record = build_metric_record(labels, 1.0, 5);
        let recomputed = crate::metrics::signature_without_labels(&record, &[VALUE_LABEL]);
        let mut json_data = vec![(record.clone(), 5_i64, None), (record, 5_i64, Some(7_u64))];

        finish_identity_columns(&mut json_data);

        assert_eq!(
            json_data[0].0.get(HASH_LABEL),
            Some(&json::json!(recomputed))
        );
        assert_eq!(json_data[1].0.get(HASH_LABEL), Some(&json::json!(7_u64)));
    }
}
