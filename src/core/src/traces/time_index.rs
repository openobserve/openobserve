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

use std::{collections::HashMap, sync::Arc};

use arrow_schema::{DataType, Field, Schema};
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::stream::{PartitionTimeLevel, StreamSettings, StreamType},
    utils::{json, schema_ext::SchemaExt, util::get_trace_time_index_stream_name},
};
use infra::errors::{Error, Result};
use serde_json::{Map, Value};

use crate::{
    common::meta::stream::SchemaRecords,
    ingestion::{get_thread_id, get_write_partition_key, write_file},
};

const HOUR_MICROS: i64 = 3_600_000_000;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TraceTimeIndexRecord {
    pub timestamp: i64,
    pub trace_id: String,
    pub min_ts: i64,
    pub max_ts: i64,
}

fn nanos_floor_micros(value: i64) -> i64 {
    value.div_euclid(1_000)
}

fn nanos_ceil_micros(value: i64) -> i64 {
    let quotient = value.div_euclid(1_000);
    if value.rem_euclid(1_000) == 0 {
        quotient
    } else {
        quotient.saturating_add(1)
    }
}

fn hour_start(timestamp: i64) -> i64 {
    timestamp - timestamp.rem_euclid(HOUR_MICROS)
}

pub fn generate_records(records: &[(i64, Map<String, Value>)]) -> Vec<TraceTimeIndexRecord> {
    let mut aggregated: HashMap<(i64, String), TraceTimeIndexRecord> = HashMap::new();

    for (_, record) in records {
        let Some(trace_id) = record.get("trace_id").and_then(Value::as_str) else {
            continue;
        };
        let Some(start_ns) = record.get("start_time").map(json::get_int_value) else {
            continue;
        };
        let Some(end_ns) = record.get("end_time").map(json::get_int_value) else {
            continue;
        };

        let min_ts = nanos_floor_micros(start_ns);
        let raw_max_ts = nanos_ceil_micros(end_ns);
        let max_ts = raw_max_ts.max(min_ts);
        let start_hour = hour_start(min_ts);
        merge_record(
            &mut aggregated,
            start_hour,
            min_ts,
            trace_id,
            min_ts,
            max_ts,
        );

        let end_position = max_ts.saturating_sub(1).max(min_ts);
        let end_hour = hour_start(end_position);
        if end_hour != start_hour {
            merge_record(
                &mut aggregated,
                end_hour,
                end_hour,
                trace_id,
                min_ts,
                max_ts,
            );
        }
    }

    aggregated.into_values().collect()
}

fn merge_record(
    records: &mut HashMap<(i64, String), TraceTimeIndexRecord>,
    hour_bucket: i64,
    timestamp: i64,
    trace_id: &str,
    min_ts: i64,
    max_ts: i64,
) {
    let entry = records
        .entry((hour_bucket, trace_id.to_string()))
        .or_insert_with(|| TraceTimeIndexRecord {
            timestamp,
            trace_id: trace_id.to_string(),
            min_ts,
            max_ts,
        });
    entry.timestamp = entry.timestamp.min(timestamp);
    entry.min_ts = entry.min_ts.min(min_ts);
    entry.max_ts = entry.max_ts.max(max_ts);
}

fn index_schema() -> Schema {
    Schema::new(vec![
        Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
        Field::new("trace_id", DataType::Utf8, false),
        Field::new("min_ts", DataType::Int64, false),
        Field::new("max_ts", DataType::Int64, false),
    ])
}

async fn ensure_index_stream(org_id: &str, source_stream: &str) -> Result<String> {
    let index_stream = get_trace_time_index_stream_name(source_stream);
    let schema_cache = infra::schema::get_cache(org_id, &index_stream, StreamType::Metadata)
        .await
        .map_err(|e| Error::Message(format!("load trace time index schema: {e}")))?;
    let is_new = !schema_cache.fields_map().contains_key(TIMESTAMP_COL_NAME);

    if is_new {
        let expected = index_schema();
        crate::db::schema::merge(
            org_id,
            &index_stream,
            StreamType::Metadata,
            &expected,
            Some(config::utils::time::now_micros()),
        )
        .await
        .map_err(|e| Error::Message(format!("create trace time index schema: {e}")))?;
    }

    let source_settings = infra::schema::get_settings(org_id, source_stream, StreamType::Traces)
        .await
        .unwrap_or_default();
    let mut index_settings =
        infra::schema::get_settings(org_id, &index_stream, StreamType::Metadata)
            .await
            .map(|settings| (*settings).clone())
            .unwrap_or_else(|| StreamSettings {
                enable_distinct_fields: false,
                ..Default::default()
            });
    let needs_settings_update = !index_settings
        .bloom_filter_fields
        .iter()
        .any(|field| field == "trace_id")
        || !index_settings
            .index_fields
            .iter()
            .any(|field| field == "trace_id")
        || index_settings.data_retention != source_settings.data_retention
        || index_settings.extended_retention_days != source_settings.extended_retention_days;
    if needs_settings_update {
        if !index_settings
            .bloom_filter_fields
            .iter()
            .any(|field| field == "trace_id")
        {
            index_settings
                .bloom_filter_fields
                .push("trace_id".to_string());
        }
        if !index_settings
            .index_fields
            .iter()
            .any(|field| field == "trace_id")
        {
            index_settings.index_fields.push("trace_id".to_string());
        }
        index_settings.data_retention = source_settings.data_retention;
        index_settings.extended_retention_days = source_settings.extended_retention_days.clone();
        index_settings.enable_distinct_fields = false;
        schema::save_stream_settings(org_id, &index_stream, StreamType::Metadata, index_settings)
            .await
            .map_err(|e| Error::Message(format!("save trace time index settings: {e}")))?;
    }

    Ok(index_stream)
}

pub async fn write(
    org_id: &str,
    source_stream: &str,
    source_records: &[(i64, Map<String, Value>)],
) -> Result<()> {
    if !get_config().common.trace_time_index_enabled {
        return Ok(());
    }

    let records = generate_records(source_records);
    if records.is_empty() {
        return Ok(());
    }

    let index_stream = ensure_index_stream(org_id, source_stream).await?;
    let schema = Arc::new(index_schema());
    let schema_key = schema.hash_key();
    let mut data_buf: HashMap<String, SchemaRecords> = HashMap::new();

    for record in records {
        let mut value = Map::new();
        value.insert(TIMESTAMP_COL_NAME.to_string(), record.timestamp.into());
        value.insert("trace_id".to_string(), record.trace_id.into());
        value.insert("min_ts".to_string(), record.min_ts.into());
        value.insert("max_ts".to_string(), record.max_ts.into());
        let partition = get_write_partition_key(
            record.timestamp,
            &vec![],
            PartitionTimeLevel::Hourly,
            &value,
            Some(&schema_key),
        );
        let value = Value::Object(value);
        let value_size = json::estimate_json_bytes(&value);
        let entry = data_buf.entry(partition).or_insert_with(|| SchemaRecords {
            schema_key: schema_key.clone(),
            schema: Arc::clone(&schema),
            records: Vec::new(),
            records_size: 0,
        });
        entry.records.push(Arc::new(value));
        entry.records_size += value_size;
    }

    let writer = ingester::get_writer(
        get_thread_id(),
        org_id,
        StreamType::Metadata.as_str(),
        &index_stream,
    )
    .await;
    write_file(
        &writer,
        org_id,
        &index_stream,
        data_buf,
        !get_config().common.wal_fsync_disabled,
    )
    .await
    .map_err(|e| Error::Message(format!("write trace time index: {e}")))?;
    config::metrics::TRACE_TIME_INDEX_OPERATIONS
        .with_label_values(&[org_id, "write", "success"])
        .inc();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn span(trace_id: &str, start_ns: i64, end_ns: i64) -> (i64, Map<String, Value>) {
        let mut value = Map::new();
        value.insert("trace_id".to_string(), trace_id.into());
        value.insert("start_time".to_string(), start_ns.into());
        value.insert("end_time".to_string(), end_ns.into());
        (start_ns / 1_000, value)
    }

    #[test]
    fn same_hour_span_generates_one_record() {
        let records = generate_records(&[span("trace", 10_000_000_000, 20_000_000_000)]);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].min_ts, 10_000_000);
        assert_eq!(records[0].max_ts, 20_000_000);
    }

    #[test]
    fn cross_hour_span_generates_two_records() {
        let records = generate_records(&[span("trace", 3_500_000_000_000, 3_700_000_000_000)]);
        assert_eq!(records.len(), 2);
        assert!(records.iter().all(|record| record.min_ts == 3_500_000_000));
        assert!(records.iter().all(|record| record.max_ts == 3_700_000_000));
    }

    #[test]
    fn month_long_span_still_generates_only_two_records() {
        let records = generate_records(&[span("trace", 1_000_000_000, 31 * 86_400_000_000_000)]);
        assert_eq!(records.len(), 2);
    }

    #[test]
    fn exact_hour_end_stays_in_previous_hour() {
        let records = generate_records(&[span("trace", 3_500_000_000_000, 3_600_000_000_000)]);
        assert_eq!(records.len(), 1);
    }

    #[test]
    fn inverted_span_is_clamped_to_zero_duration() {
        let records = generate_records(&[span("trace", 20_000_000_000, 10_000_000_000)]);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].min_ts, records[0].max_ts);
    }

    #[test]
    fn zero_duration_span_generates_one_record() {
        let records = generate_records(&[span("trace", 20_000_000_000, 20_000_000_000)]);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].min_ts, records[0].max_ts);
    }

    #[test]
    fn request_local_records_are_aggregated_by_trace_and_hour() {
        let records = generate_records(&[
            span("trace", 10_000_000_000, 20_000_000_000),
            span("trace", 5_000_000_000, 30_000_000_000),
        ]);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].min_ts, 5_000_000);
        assert_eq!(records[0].max_ts, 30_000_000);
    }
}
