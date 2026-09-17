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
    sync::Arc,
    time::Instant,
};

use config::{
    get_config,
    meta::{
        alerts::alert,
        pipeline::PipelineKind,
        self_reporting::usage::UsageType,
        stream::{StreamPartition, StreamType},
    },
    metrics,
    utils::{
        json::{self, estimate_json_bytes},
        schema_ext::SchemaExt,
        time::now_micros,
    },
};
use datafusion::arrow::datatypes::{DataType, Schema};
use infra::{errors::Result, schema::SchemaCache};
use ingestion_common::IngestUser;
use schema::{check_for_schema, check_request_columns_limit};

use super::columnar::ColumnarStream;
use crate::{
    alerts::alert::AlertExt,
    common::meta::stream::SchemaRecords,
    ingestion::{
        PartitionMemo, TriggerAlertData, evaluate_trigger, get_stream_partition_keys,
        get_thread_id, inferred_column_type, refactor_map, schema_records_to_entries,
        write_entries,
    },
    pipeline::batch_execution::ExecutablePipeline,
};

/// Stands in for the partition keys of a stream that has none.
static NO_PARTITION_KEYS: Vec<StreamPartition> = Vec::new();

/// A stream's records waiting for its pipelines, each with the data its handler carries along.
pub(super) type PipelineInputs<T> = HashMap<String, Vec<(json::Value, T)>>;

/// Records grouped by the stream they are written to, each with its handler's side data.
pub(super) type RecordsByStream<T> = HashMap<String, Vec<(json::Map<String, json::Value>, T)>>;

/// Why a stream's buffered records did not come out of its pipelines.
pub(super) enum PipelineFailure {
    MissingInputs {
        message: String,
    },
    Batch {
        stream_name: String,
        records: usize,
        message: String,
    },
}

/// Time spent in each part of the WAL write stage, for a handler that logs the breakdown.
#[derive(Default)]
pub(super) struct WriteTimings {
    pub streams: usize,
    pub deletion_check_micros: u128,
    pub get_writer_micros: u128,
    pub write_micros: u128,
    pub report_stats_micros: u128,
}

/// Runs each stream's pipelines over its buffered records, grouping the output by destination.
pub(super) async fn run_pipelines<T: Clone>(
    org_id: &str,
    stream_pipelines: &HashMap<String, Vec<ExecutablePipeline>>,
    mut inputs: PipelineInputs<T>,
    user_defined_schema_map: &HashMap<String, Option<HashSet<String>>>,
    stream_partitioning_map: &mut HashMap<String, Vec<StreamPartition>>,
) -> (RecordsByStream<T>, Vec<PipelineFailure>) {
    let mut outputs: RecordsByStream<T> = HashMap::new();
    let mut failures = Vec::new();
    for (stream_name, pipelines) in stream_pipelines {
        if pipelines.is_empty() {
            continue;
        }
        let Some(stream_inputs) = inputs.remove(stream_name) else {
            let message = format!(
                "[Ingestion]: Stream {stream_name} has pipeline, but inputs failed to be buffered. BUG"
            );
            log::error!("{message}");
            failures.push(PipelineFailure::MissingInputs { message });
            continue;
        };
        let (records, sides): (Vec<json::Value>, Vec<T>) = stream_inputs.into_iter().unzip();
        let has_user_pipeline = pipelines.iter().any(|p| p.kind == PipelineKind::User);

        for exec_pl in pipelines {
            let results = match exec_pl
                .process_batch(org_id, records.clone(), Some(stream_name.clone()))
                .await
            {
                Ok(results) => results,
                Err(e) => {
                    let message = format!(
                        "[Ingestion]: Stream {stream_name} pipeline batch processing failed: {e}"
                    );
                    log::error!("{message}");
                    failures.push(PipelineFailure::Batch {
                        stream_name: stream_name.clone(),
                        records: records.len(),
                        message,
                    });
                    continue;
                }
            };
            for (stream_params, stream_results) in results {
                if stream_params.stream_type != StreamType::Metrics {
                    continue;
                }
                let destination = stream_params.stream_name.to_string();
                if !stream_partitioning_map.contains_key(&destination) {
                    let keys =
                        get_stream_partition_keys(org_id, &StreamType::Metrics, &destination).await;
                    stream_partitioning_map.insert(destination.clone(), keys);
                }
                let defined_fields = defined_schema(user_defined_schema_map, &destination);
                for (idx, value) in stream_results {
                    let record = trim_to_defined_schema(into_record(value), defined_fields);
                    outputs
                        .entry(destination.clone())
                        .or_default()
                        .push((record, sides[idx].clone()));
                }
            }
        }

        if !has_user_pipeline && !outputs.contains_key(stream_name) {
            let defined_fields = defined_schema(user_defined_schema_map, stream_name);
            let trimmed = records.into_iter().zip(sides).map(|(value, side)| {
                (
                    trim_to_defined_schema(into_record(value), defined_fields),
                    side,
                )
            });
            outputs
                .entry(stream_name.clone())
                .or_default()
                .extend(trimmed);
        }
    }
    (outputs, failures)
}

/// The stream's schema once `records` are in it, as the write path keys and partitions by it.
pub(super) async fn resolve_batch_schema(
    org_id: &str,
    stream_name: &str,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
    records: &[&json::Map<String, json::Value>],
    min_timestamp: i64,
    has_uds: bool,
) -> Result<(Arc<Schema>, String)> {
    check_columns_per_record(org_id, stream_name, records)?;
    // probed once per field of every record, so it takes foldhash rather than SipHash
    let schema_fields: hashbrown::HashMap<&str, &DataType> =
        match stream_schema_map.get(stream_name) {
            Some(schema) => schema
                .schema()
                .fields()
                .iter()
                .map(|f| (f.name().as_str(), f.data_type()))
                .collect(),
            None => hashbrown::HashMap::default(),
        };
    let evolving: Vec<&json::Map<String, json::Value>> = records
        .iter()
        .copied()
        .filter(|record| record_evolves_schema(record, &schema_fields))
        .collect();
    drop(schema_fields);
    // a user-defined schema is applied by check_for_schema itself, so it cannot be skipped
    if !evolving.is_empty() || has_uds {
        let checked = if evolving.is_empty() {
            records.to_vec()
        } else {
            evolving
        };
        check_for_schema(
            org_id,
            stream_name,
            StreamType::Metrics,
            stream_schema_map,
            checked,
            min_timestamp,
            false, // is_derived is false for metrics
        )
        .await?;
    }

    let schema = stream_schema_map
        .get(stream_name)
        .unwrap()
        .schema()
        .as_ref()
        .clone()
        .with_metadata(HashMap::new());
    let schema_key = schema.hash_key();
    Ok((Arc::new(schema), schema_key))
}

/// Buffers one stream's records into write partitions, running its realtime alerts on each first.
pub(super) async fn buffer_stream_records(
    org_id: &str,
    records: impl IntoIterator<Item = (json::Map<String, json::Value>, i64)>,
    schema: &Arc<Schema>,
    schema_key: &str,
    partition_keys: Option<&Vec<StreamPartition>>,
    alerts: Option<&Vec<alert::Alert>>,
    partitions: &mut HashMap<String, SchemaRecords>,
) -> Option<TriggerAlertData> {
    let partition_keys = partition_keys.unwrap_or(&NO_PARTITION_KEYS);
    let partition_time_level = infra::schema::get_partition_time_level(StreamType::Metrics);
    let mut partition_memo = PartitionMemo::new(partition_keys, partition_time_level);
    let alert_keys: Vec<String> = alerts
        .map(|alerts| {
            alerts
                .iter()
                .map(|alert| {
                    format!(
                        "{org_id}/{}/{}/{}",
                        StreamType::Metrics,
                        alert.stream_name,
                        alert.get_unique_key()
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    let mut triggers: TriggerAlertData = Vec::with_capacity(alert_keys.len());
    let mut trigger_slots: HashMap<String, super::TriggerSlot> = HashMap::new();

    for (record, timestamp) in records {
        if let Some(alerts) = alerts {
            evaluate_record_alerts(
                &record,
                alerts,
                &alert_keys,
                &mut triggers,
                &mut trigger_slots,
            )
            .await;
        }

        let partition = partition_memo.buffer(timestamp, &record, schema_key, partitions, || {
            SchemaRecords {
                schema_key: schema_key.to_string(),
                schema: schema.clone(),
                records: vec![],
                records_size: 0,
            }
        });
        let record = json::Value::Object(record);
        partition.records_size += estimate_json_bytes(&record);
        partition.records.push(Arc::new(record));
    }

    (!triggers.is_empty()).then_some(triggers)
}

/// Each stream's WAL entries, from its JSON partitions and from what went straight to arrow.
pub(super) fn entries_by_stream(
    org_id: &str,
    json_partitions: HashMap<String, HashMap<String, SchemaRecords>>,
    columnar_streams: impl IntoIterator<Item = (String, ColumnarStream)>,
) -> Result<HashMap<String, Vec<ingester::Entry>>> {
    let mut entries: HashMap<String, Vec<ingester::Entry>> = json_partitions
        .into_iter()
        .map(|(stream_name, partitions)| {
            let stream_entries = schema_records_to_entries(org_id, &stream_name, partitions);
            (stream_name, stream_entries)
        })
        .collect();
    // both paths can have written to the same stream in one request
    for (stream_name, columnar) in columnar_streams {
        let stream_entries = columnar.into_entries(org_id, &stream_name)?;
        entries
            .entry(stream_name)
            .or_default()
            .extend(stream_entries);
    }
    Ok(entries)
}

/// Writes every stream's entries to the WAL and reports the request's usage per stream.
pub(super) async fn write_streams(
    org_id: &str,
    entries_by_stream: HashMap<String, Vec<ingester::Entry>>,
    stream_pipelines: &HashMap<String, Vec<ExecutablePipeline>>,
    user: &IngestUser,
    usage_type: UsageType,
    start: &Instant,
    started_at: i64,
) -> Result<WriteTimings> {
    let mut timings = WriteTimings::default();
    for (stream_name, entries) in entries_by_stream {
        // a stream buffers nothing when every sample of it was NaN
        if entries.is_empty() {
            continue;
        }

        let t = Instant::now();
        if db::compact::retention::is_deleting_stream(
            org_id,
            StreamType::Metrics,
            &stream_name,
            None,
        ) {
            log::warn!("stream [{stream_name}] is being deleted");
            continue;
        }
        timings.deletion_check_micros += t.elapsed().as_micros();
        timings.streams += 1;

        let t = Instant::now();
        let writer = ingester::get_writer(
            get_thread_id(),
            org_id,
            StreamType::Metrics.as_str(),
            &stream_name,
        )
        .await;
        timings.get_writer_micros += t.elapsed().as_micros();

        // for performance issue, we will flush all when the app shutdown
        let fsync = false;
        let t = Instant::now();
        let mut req_stats = write_entries(&writer, &stream_name, entries, fsync).await?;
        timings.write_micros += t.elapsed().as_micros();

        let fns_length: usize = stream_pipelines.get(&stream_name).map_or(0, |pipelines| {
            pipelines.iter().map(|exec_pl| exec_pl.num_of_func()).sum()
        });
        req_stats.response_time = start.elapsed().as_secs_f64();
        let email_str = user.to_email();
        req_stats.user_email = if email_str.is_empty() {
            None
        } else {
            Some(email_str)
        };
        let t = Instant::now();
        usage_reporting::report_request_usage_stats(
            req_stats,
            org_id,
            &stream_name,
            StreamType::Metrics,
            usage_type,
            fns_length as u16,
            started_at,
        )
        .await;
        timings.report_stats_micros += t.elapsed().as_micros();
    }
    Ok(timings)
}

/// Records a successful request against `endpoint` in the HTTP metrics.
pub(super) fn observe_request(endpoint: &str, org_id: &str, start: &Instant) {
    let labels = [
        endpoint,
        "200",
        org_id,
        StreamType::Metrics.as_str(),
        "",
        "",
    ];
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&labels)
        .observe(start.elapsed().as_secs_f64());
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&labels)
        .inc();
}

/// Sends each stream's alert notification off the request path.
pub(super) fn spawn_triggers(stream_trigger_map: HashMap<String, Option<TriggerAlertData>>) {
    // only one trigger per request; notification/db work must not block ingestion
    for entry in stream_trigger_map.into_values().flatten() {
        tokio::spawn(evaluate_trigger(entry));
    }
}

/// `check_for_schema` applies the column limit to the batch's merged schema, not to one record.
fn check_columns_per_record(
    org_id: &str,
    stream_name: &str,
    records: &[&json::Map<String, json::Value>],
) -> Result<()> {
    let limit = get_config().limit.req_cols_per_record_limit;
    for record in records {
        // a column count never exceeds the entry count, so the cheap bound settles most records
        if record.len() <= limit {
            continue;
        }
        let columns = record
            .iter()
            .filter(|(key, value)| inferred_column_type(key, value).is_some())
            .count();
        check_request_columns_limit(org_id, StreamType::Metrics, stream_name, columns)?;
    }
    Ok(())
}

/// Whether this record can still change the schema, as `infer_json_schema_from_map` sees it.
fn record_evolves_schema(
    record: &json::Map<String, json::Value>,
    fields: &hashbrown::HashMap<&str, &DataType>,
) -> bool {
    record.iter().any(|(key, value)| {
        let Some(inferred) = inferred_column_type(key, value) else {
            return false;
        };
        fields
            .get(key.as_str())
            .is_none_or(|existing| **existing != inferred)
    })
}

/// The fields of a stream's user-defined schema, if it has one.
pub(super) fn defined_schema<'a>(
    user_defined_schema_map: &'a HashMap<String, Option<HashSet<String>>>,
    stream_name: &str,
) -> Option<&'a HashSet<String>> {
    user_defined_schema_map
        .get(stream_name)
        .and_then(Option::as_ref)
}

/// Keeps only a user-defined schema's fields, when the stream has one.
pub(super) fn trim_to_defined_schema(
    record: json::Map<String, json::Value>,
    defined_fields: Option<&HashSet<String>>,
) -> json::Map<String, json::Value> {
    match defined_fields {
        Some(fields) => refactor_map(record, fields),
        None => record,
    }
}

fn into_record(value: json::Value) -> json::Map<String, json::Value> {
    let json::Value::Object(record) = value else {
        unreachable!("a metric record is always an object")
    };
    record
}

async fn evaluate_record_alerts(
    record: &json::Map<String, json::Value>,
    alerts: &[alert::Alert],
    alert_keys: &[String],
    triggers: &mut TriggerAlertData,
    trigger_slots: &mut HashMap<String, super::TriggerSlot>,
) {
    let end_time = now_micros();
    let dedup = super::series_signature(record);
    for (alert, key) in alerts.iter().zip(alert_keys) {
        // one row per label set: a series repeats its labels on every sample
        if !super::trigger_wants_labels(trigger_slots, key, dedup) {
            continue;
        }
        match alert.evaluate(Some(record), (None, end_time), None).await {
            Ok(results) if results.data.is_some() => {
                super::merge_trigger_rows(
                    triggers,
                    trigger_slots,
                    key,
                    dedup,
                    alert,
                    results.data.unwrap(),
                );
            }
            Ok(_) => {}
            Err(e) => {
                log::error!("[METRICS] Error while evaluating realtime alert: {e}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use config::{
        TIMESTAMP_COL_NAME,
        meta::promql::{HASH_LABEL, NAME_LABEL, VALUE_LABEL},
    };

    use super::*;
    use crate::ingestion::get_write_partition_key;

    fn record_with(columns: usize) -> json::Map<String, json::Value> {
        let mut record = json::Map::new();
        for i in 0..columns {
            record.insert(format!("label_{i}"), json::json!("v"));
        }
        record
    }

    #[test]
    fn test_columns_per_record_rejects_only_a_record_over_the_limit() {
        let limit = get_config().limit.req_cols_per_record_limit;

        let (first, second) = (record_with(limit), record_with(limit));
        assert!(check_columns_per_record("org", "m", &[&first, &second]).is_ok());

        let wide = record_with(limit + 1);
        assert!(check_columns_per_record("org", "m", &[&wide]).is_err());

        // a null claims no column, so it cannot push a record over the limit
        let mut padded = record_with(limit);
        padded.insert("spare".to_string(), json::Value::Null);
        assert!(check_columns_per_record("org", "m", &[&padded]).is_ok());
    }

    #[test]
    fn test_record_evolves_schema_sees_a_type_change_on_a_known_field() {
        let (utf8, int64, uint64) = (DataType::Utf8, DataType::Int64, DataType::UInt64);
        let fields: hashbrown::HashMap<&str, &DataType> = [
            (NAME_LABEL, &utf8),
            (VALUE_LABEL, &int64),
            (TIMESTAMP_COL_NAME, &int64),
            (HASH_LABEL, &uint64),
        ]
        .into_iter()
        .collect();
        let mut record = json::Map::new();
        record.insert(NAME_LABEL.to_string(), json::json!("http_requests"));
        record.insert(TIMESTAMP_COL_NAME.to_string(), json::json!(5_i64));
        record.insert(HASH_LABEL.to_string(), json::json!(7_u64));
        record.insert(VALUE_LABEL.to_string(), json::json!(1_i64));

        assert!(!record_evolves_schema(&record, &fields));
        record.insert(VALUE_LABEL.to_string(), json::json!(1.5));
        assert!(record_evolves_schema(&record, &fields));
    }

    #[test]
    fn test_record_evolves_schema_on_an_unseen_field_but_not_on_a_null() {
        let (utf8, float64, int64, uint64) = (
            DataType::Utf8,
            DataType::Float64,
            DataType::Int64,
            DataType::UInt64,
        );
        let fields: hashbrown::HashMap<&str, &DataType> = [
            (NAME_LABEL, &utf8),
            (VALUE_LABEL, &float64),
            (TIMESTAMP_COL_NAME, &int64),
            (HASH_LABEL, &uint64),
        ]
        .into_iter()
        .collect();
        let mut record = json::Map::new();
        record.insert(NAME_LABEL.to_string(), json::json!("http_requests"));
        record.insert(TIMESTAMP_COL_NAME.to_string(), json::json!(5_i64));
        record.insert(HASH_LABEL.to_string(), json::json!(7_u64));
        record.insert(VALUE_LABEL.to_string(), json::json!(1.5));

        assert!(!record_evolves_schema(&record, &fields));
        record.insert("unset".to_string(), json::Value::Null);
        assert!(!record_evolves_schema(&record, &fields));
        record.insert("instance".to_string(), json::json!("host-1"));
        assert!(record_evolves_schema(&record, &fields));
    }

    #[test]
    fn test_trim_to_defined_schema_keeps_only_defined_fields() {
        let record = into_record(json::json!({"a": "1", "b": "2", "_timestamp": 5}));
        let defined = HashSet::from(["a".to_string(), TIMESTAMP_COL_NAME.to_string()]);

        let trimmed = trim_to_defined_schema(record.clone(), Some(&defined));
        assert!(trimmed.contains_key("a") && !trimmed.contains_key("b"));

        let untouched = trim_to_defined_schema(record, None);
        assert_eq!(untouched.len(), 3);
    }

    #[tokio::test]
    async fn test_buffer_stream_records_keys_each_record_as_the_write_path_does() {
        let schema = Arc::new(Schema::empty());
        let timestamps = [
            -3_601_000_000_i64,
            -1_000_000,
            1_000_000,
            2_000_000,
            3_600_000_000,
            1_000_000,
        ];
        let records = timestamps.iter().map(|ts| {
            let mut record = json::Map::new();
            record.insert("host".to_string(), json::json!("a"));
            (record, *ts)
        });
        let mut partitions = HashMap::new();
        buffer_stream_records("org", records, &schema, "key", None, None, &mut partitions).await;

        let level = infra::schema::get_partition_time_level(StreamType::Metrics);
        for ts in timestamps {
            let expected =
                get_write_partition_key(ts, &Vec::new(), level, &json::Map::new(), Some("key"));
            assert!(partitions.contains_key(&expected), "{ts}");
        }
        let written: usize = partitions.values().map(|p| p.records.len()).sum();
        assert_eq!(partitions.len(), 4);
        assert_eq!(written, timestamps.len());
    }
}
