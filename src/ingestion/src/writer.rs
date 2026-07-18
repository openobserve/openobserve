// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use chrono::{TimeZone, Utc};
use common::meta::stream::SchemaRecords;
use config::{
    SIZE_IN_MB,
    meta::{
        self_reporting::usage::RequestStats,
        stream::{PartitionTimeLevel, StreamPartition, StreamType},
    },
    utils::{
        json::{Map, Value},
        schema::format_partition_key,
    },
};
use infra::errors::{Error, Result};

static REQUEST_COUNTER: AtomicUsize = AtomicUsize::new(0);

pub fn get_thread_id() -> usize {
    REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed) % config::get_config().limit.http_worker_num
}

pub async fn get_stream_partition_keys(
    org_id: &str,
    stream_type: &StreamType,
    stream_name: &str,
) -> Vec<StreamPartition> {
    infra::schema::get_settings(org_id, stream_name, *stream_type)
        .await
        .unwrap_or_default()
        .partition_keys
}

pub fn get_write_partition_key(
    timestamp: i64,
    partition_keys: &[StreamPartition],
    time_level: PartitionTimeLevel,
    local_val: &Map<String, Value>,
    suffix: Option<&str>,
) -> String {
    let mut time_key = match time_level {
        PartitionTimeLevel::Unset | PartitionTimeLevel::Hourly => Utc
            .timestamp_nanos(timestamp * 1000)
            .format("%Y/%m/%d/%H")
            .to_string(),
        PartitionTimeLevel::Daily => Utc
            .timestamp_nanos(timestamp * 1000)
            .format("%Y/%m/%d/00")
            .to_string(),
    };
    time_key.push('/');
    time_key.push_str(suffix.unwrap_or("default"));
    for key in partition_keys {
        if key.disabled {
            continue;
        }
        let value = local_val
            .get(&key.field)
            .map(config::utils::json::get_string_value)
            .unwrap_or_else(|| "null".to_string());
        time_key.push('/');
        time_key.push_str(&format_partition_key(&key.get_partition_key(&value)));
    }
    time_key
}

pub async fn write_file(
    writer: &Arc<ingester::Writer>,
    org_id: &str,
    stream_name: &str,
    buf: HashMap<String, SchemaRecords>,
    fsync: bool,
) -> Result<RequestStats> {
    let entries = buf
        .into_iter()
        .filter_map(|(partition_key, entry)| {
            (!entry.records.is_empty()).then(|| ingester::Entry {
                org_id: Arc::from(org_id),
                stream: Arc::from(stream_name),
                schema: Some(entry.schema),
                schema_key: Arc::from(entry.schema_key.as_str()),
                partition_key: Arc::from(partition_key.as_str()),
                data: entry.records,
                data_size: entry.records_size,
                batch: None,
            })
        })
        .collect::<Vec<_>>();
    let (records, size) = entries
        .iter()
        .map(|entry| (entry.data.len(), entry.data_size))
        .fold((0, 0), |(record_total, size_total), (records, size)| {
            (record_total + records, size_total + size)
        });
    if let Err(error) = writer.write_batch(entries, fsync).await {
        log::error!(
            "ingestion write file for stream {}/{} error: {}",
            writer.get_key_str(),
            stream_name,
            error
        );
        return Err(Error::IngestionError(error.to_string()));
    }

    Ok(RequestStats {
        size: size as f64 / SIZE_IN_MB,
        records: records as i64,
        ..Default::default()
    })
}
