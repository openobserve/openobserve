// Copyright 2023 Zinc Labs Inc.
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
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use arrow_schema::{DataType, Field, Schema};
use config::{
    meta::stream::StreamType,
    utils::{json, schema_ext::SchemaExt},
    FxIndexMap, CONFIG,
};
use infra::errors::{Error, Result};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{mpsc, RwLock},
    time,
};

use crate::{
    common::meta::stream::SchemaRecords,
    service::{ingestion, stream::unwrap_partition_time_level},
};

const CHANNEL_SIZE: usize = 10240;
const STREAM_NAME: &str = "distinct_values";

static CHANNEL: Lazy<DistinctValues> = Lazy::new(DistinctValues::new);

type MemTable = FxIndexMap<String, FxIndexMap<DvItem, u32>>;

pub struct DistinctValues {
    channel: Arc<mpsc::Sender<DvEvent>>,
    shutdown: Arc<AtomicBool>,
    mem_table: Arc<RwLock<MemTable>>,
}

#[derive(Debug, Default, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub struct DvItem {
    pub stream_type: StreamType,
    pub stream_name: String,
    pub field_name: String,
    pub field_value: String,
    pub filter_name: String,
    pub filter_value: String,
}

#[derive(Debug)]
enum DvEventType {
    Add,
    Shutudown,
}

#[derive(Debug)]
struct DvEvent {
    org_id: String,
    item: DvItem,
    count: u32,
    ev_type: DvEventType,
}

impl DvEvent {
    pub fn new(org_id: &str, item: DvItem, count: u32) -> Self {
        Self {
            org_id: org_id.to_string(),
            item,
            count,
            ev_type: DvEventType::Add,
        }
    }
    pub fn shutdown() -> Self {
        Self {
            org_id: String::from(""),
            item: DvItem::default(),
            count: 0,
            ev_type: DvEventType::Shutudown,
        }
    }
}

impl Default for DistinctValues {
    fn default() -> Self {
        Self::new()
    }
}

impl DistinctValues {
    pub fn new() -> Self {
        tokio::task::spawn(async move { run_flush().await });
        Self {
            channel: handle_channel(),
            shutdown: Arc::new(AtomicBool::new(false)),
            mem_table: Arc::new(RwLock::new(FxIndexMap::default())),
        }
    }

    async fn write(&self, org_id: &str, data: Vec<DvItem>) -> Result<()> {
        let mut group_items: FxIndexMap<DvItem, u32> = FxIndexMap::default();
        for item in data {
            let count = group_items.entry(item).or_default();
            *count += 1;
        }
        for (item, count) in group_items {
            self.channel
                .send(DvEvent::new(org_id, item, count))
                .await
                .map_err(|v| Error::Message(v.to_string()))?;
        }
        Ok(())
    }

    async fn flush(&self) -> Result<()> {
        let mut mem_table = self.mem_table.write().await;
        let mut new_table: MemTable = FxIndexMap::default();
        std::mem::swap(&mut new_table, &mut *mem_table);
        drop(mem_table);

        // write to wal
        let timestamp = chrono::Utc::now().timestamp_micros();
        let schema = generate_schema();
        let schema_key = schema.hash_key();
        for (org_id, items) in new_table {
            if items.is_empty() {
                continue;
            }

            // check for schema
            let db_schema = super::db::schema::get(&org_id, STREAM_NAME, StreamType::Metadata)
                .await
                .unwrap();
            if db_schema.fields().is_empty() {
                let schema = schema.as_ref().clone();
                if let Err(e) = super::db::schema::set(
                    &org_id,
                    STREAM_NAME,
                    StreamType::Metadata,
                    &schema,
                    None,
                    false,
                )
                .await
                {
                    log::error!("[DISTINCT_VALUES] error while setting schema: {}", e);
                }
            }

            let mut buf: HashMap<String, SchemaRecords> = HashMap::new();
            for (item, count) in items {
                let mut data = json::to_value(item).unwrap();
                let data = data.as_object_mut().unwrap();
                data.insert("count".to_string(), json::Value::Number(count.into()));
                data.insert(
                    CONFIG.common.column_timestamp.clone(),
                    json::Value::Number(timestamp.into()),
                );
                let hour_key = ingestion::get_wal_time_key(
                    timestamp,
                    &vec![],
                    unwrap_partition_time_level(None, StreamType::Metadata),
                    data,
                    Some(&schema_key),
                );
                let data = json::Value::Object(data.clone());
                let data_size = json::to_vec(&data).unwrap_or_default().len();

                let hour_buf = buf.entry(hour_key).or_insert_with(|| SchemaRecords {
                    schema_key: schema_key.clone(),
                    schema: schema.clone(),
                    records: vec![],
                    records_size: 0,
                });
                hour_buf.records.push(Arc::new(data));
                hour_buf.records_size += data_size;
            }

            let writer = ingester::get_writer(0, &org_id, &StreamType::Metadata.to_string()).await;
            _ = ingestion::write_file(&writer, STREAM_NAME, buf).await;
            if let Err(e) = writer.sync().await {
                log::error!("[DISTINCT_VALUES] error while syncing writer: {}", e);
            }
        }
        Ok(())
    }

    async fn stop(&self) -> Result<()> {
        log::info!("[DISTINCT_VALUES] shutting down");
        let tx = self.channel.clone();
        tx.send(DvEvent::shutdown())
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        loop {
            if self.shutdown.load(Ordering::Relaxed) {
                break;
            }
            time::sleep(time::Duration::from_secs(1)).await;
            log::info!("[DISTINCT_VALUES] shutting down");
        }
        Ok(())
    }
}

fn handle_channel() -> Arc<mpsc::Sender<DvEvent>> {
    let (tx, mut rx) = mpsc::channel::<DvEvent>(CHANNEL_SIZE);
    tokio::task::spawn(async move {
        loop {
            let event = match rx.recv().await {
                Some(v) => v,
                None => {
                    log::info!("[DISTINCT_VALUES] event channel closed");
                    break;
                }
            };
            if let DvEventType::Shutudown = event.ev_type {
                if let Err(e) = CHANNEL.flush().await {
                    log::error!("[DISTINCT_VALUES] flush error: {}", e);
                }
                CHANNEL.shutdown.store(true, Ordering::Release);
                break;
            }
            let mut mem_table = CHANNEL.mem_table.write().await;
            let entry = mem_table.entry(event.org_id).or_default();
            let field_entry = entry.entry(event.item).or_default();
            *field_entry += event.count;
        }
        log::info!("[DISTINCT_VALUES] event loop exit");
    });
    Arc::new(tx)
}

async fn run_flush() {
    let mut interval = time::interval(time::Duration::from_secs(10));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        if let Err(e) = CHANNEL.flush().await {
            log::error!("[DISTINCT_VALUES] errot flush data to wal: {}", e);
        }
    }
}

pub async fn write(org_id: &str, data: Vec<DvItem>) -> Result<()> {
    CHANNEL.write(org_id, data).await
}

pub async fn close() -> Result<()> {
    CHANNEL.stop().await?;
    Ok(())
}

fn generate_schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new(
            CONFIG.common.column_timestamp.as_str(),
            DataType::Int64,
            false,
        ),
        Field::new("count", DataType::Int64, false),
        Field::new("stream_name", DataType::Utf8, false),
        Field::new("stream_type", DataType::Utf8, false),
        Field::new("field_name", DataType::Utf8, false),
        Field::new("field_value", DataType::Utf8, true),
        Field::new("filter_name", DataType::Utf8, true),
        Field::new("filter_value", DataType::Utf8, true),
    ]))
}
