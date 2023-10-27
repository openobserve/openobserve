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

use ahash::AHashMap;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::{
    sync::{mpsc, RwLock},
    time,
};

use crate::common::{
    infra::{
        config::{FxIndexMap, CONFIG},
        errors::{Error, Result},
    },
    meta::{stream::StreamParams, StreamType},
    utils::json,
};
use crate::service::{ingestion, stream::unwrap_partition_time_level};

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
            let count = group_items.entry(item).or_insert(0);
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
        let mut stream_file_name = "".to_string();
        for (org, items) in new_table {
            if items.is_empty() {
                continue;
            }
            let stream_params = StreamParams {
                org_id: org.into(),
                stream_name: STREAM_NAME.into(),
                stream_type: StreamType::Metadata,
            };
            let mut buf: AHashMap<String, Vec<String>> = AHashMap::new();
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
                    unwrap_partition_time_level(None, StreamType::Logs),
                    data,
                    None,
                );
                let line_str = json::to_string(&data).unwrap();
                let hour_buf = buf.entry(hour_key).or_default();
                hour_buf.push(line_str);
            }
            _ = ingestion::write_file(&buf, 0, &stream_params, &mut stream_file_name, None).await;
        }
        Ok(())
    }

    async fn stop(&self) -> Result<()> {
        let tx = CHANNEL.channel.clone();
        tx.send(DvEvent::shutdown())
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        loop {
            if self.shutdown.load(Ordering::Relaxed) {
                break;
            }
            time::sleep(time::Duration::from_secs(1)).await;
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
                    log::info!("[distinct_values] event channel closed");
                    break;
                }
            };
            if let DvEventType::Shutudown = event.ev_type {
                if let Err(e) = CHANNEL.flush().await {
                    log::error!("flush error: {}", e);
                }
                CHANNEL.shutdown.store(true, Ordering::Relaxed);
                break;
            }
            let mut mem_table = CHANNEL.mem_table.write().await;
            let entry = mem_table.entry(event.org_id).or_default();
            let field_entry = entry.entry(event.item).or_insert(0);
            *field_entry += event.count;
        }
        log::info!("[distinct_values] event loop exit");
    });
    Arc::new(tx)
}

async fn run_flush() {
    let mut interval = time::interval(time::Duration::from_secs(10));
    interval.tick().await; // trigger the first run
    loop {
        interval.tick().await;
        if let Err(e) = CHANNEL.flush().await {
            log::error!("[distinct_values] errot flush data to wal: {}", e);
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
