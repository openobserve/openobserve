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
    path::PathBuf,
    sync::{
        atomic::{AtomicI64, AtomicU64, Ordering},
        Arc,
    },
};

use arrow_schema::Schema;
use chrono::{Duration, Utc};
use config::{metrics, CONFIG};
use once_cell::sync::Lazy;
use snafu::ResultExt;
use tokio::sync::{Mutex, RwLock};
use wal::Writer as WalWriter;

use crate::{
    entry::{Entry, RecordBatchEntry},
    errors::*,
    immutable,
    immutable::IMMUTABLES,
    memtable::MemTable,
    rwmap::RwMap,
};

static WRITERS: Lazy<Vec<RwMap<WriterKey, Arc<Writer>>>> = Lazy::new(|| {
    let writer_num = if CONFIG.common.feature_per_thread_lock {
        CONFIG.limit.http_worker_num
    } else {
        1
    };
    let mut writers = Vec::with_capacity(writer_num);
    for _ in 0..writer_num {
        writers.push(RwMap::default());
    }
    writers
});

pub struct Writer {
    thread_id: usize,
    key: WriterKey,
    wal: Arc<Mutex<WalWriter>>,
    memtable: Arc<RwLock<MemTable>>,
    next_seq: AtomicU64,
    created_at: AtomicI64,
}

// check total memory size
pub fn check_memtable_size() -> Result<()> {
    let total_mem_size = metrics::INGEST_MEMTABLE_ARROW_BYTES
        .with_label_values(&[])
        .get();
    if total_mem_size >= CONFIG.limit.mem_table_max_size as i64 {
        Err(Error::MemoryTableOverflowError {})
    } else {
        Ok(())
    }
}

/// Get a writer for a given org_id and stream_type
pub async fn get_writer(thread_id: usize, org_id: &str, stream_type: &str) -> Arc<Writer> {
    let key = WriterKey::new(org_id, stream_type);
    let mut rw = WRITERS[thread_id].write().await;
    let w = rw
        .entry(key.clone())
        .or_insert_with(|| Arc::new(Writer::new(thread_id, key)));
    w.clone()
}

pub async fn read_from_memtable(
    org_id: &str,
    stream_type: &str,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
) -> Result<Vec<(Arc<Schema>, Vec<Arc<RecordBatchEntry>>)>> {
    let key = WriterKey::new(org_id, stream_type);
    let writer_num = if CONFIG.common.feature_per_thread_lock {
        CONFIG.limit.http_worker_num
    } else {
        1
    };
    let mut batches = Vec::with_capacity(writer_num);
    for i in 0..writer_num {
        let w = WRITERS[i].read().await;
        let Some(r) = w.get(&key) else {
            continue;
        };
        if let Ok(batch) = r.read(stream_name, time_range).await {
            batches.extend(batch);
        }
    }
    Ok(batches)
}

pub async fn check_ttl() -> Result<()> {
    for w in WRITERS.iter() {
        let w = w.read().await;
        for r in w.values() {
            // check writer
            r.write(Arc::new(Schema::empty()), Entry::default(), true)
                .await?;
        }
    }
    Ok(())
}

pub async fn flush_all() -> Result<()> {
    for w in WRITERS.iter() {
        let mut w = w.write().await;
        let keys = w.keys().cloned().collect::<Vec<_>>();
        for r in w.values() {
            r.close().await?; // close writer
            metrics::INGEST_MEMTABLE_FILES.with_label_values(&[]).dec();
        }
        for key in keys {
            w.remove(&key);
        }
    }
    Ok(())
}

impl Writer {
    pub(crate) fn new(thread_id: usize, key: WriterKey) -> Self {
        let now = Utc::now().timestamp_micros();
        let next_seq = AtomicU64::new(now as u64);
        let wal_id = next_seq.fetch_add(1, Ordering::SeqCst);
        let wal_dir = PathBuf::from(&CONFIG.common.data_wal_dir)
            .join("logs")
            .join(thread_id.to_string());
        log::info!(
            "[INGESTER:WAL] create file: {}/{}/{}/{}.wal",
            wal_dir.display().to_string(),
            &key.org_id,
            &key.stream_type,
            wal_id
        );
        Self {
            thread_id,
            key: key.clone(),
            wal: Arc::new(Mutex::new(
                WalWriter::new(
                    wal_dir,
                    &key.org_id,
                    &key.stream_type,
                    wal_id,
                    CONFIG.limit.max_file_size_on_disk as u64,
                )
                .expect("wal file create error"),
            )),
            memtable: Arc::new(RwLock::new(MemTable::new())),
            next_seq,
            created_at: AtomicI64::new(now),
        }
    }

    // check_ttl is used to check if the memtable has expired
    pub async fn write(
        &self,
        schema: Arc<Schema>,
        mut entry: Entry,
        check_ttl: bool,
    ) -> Result<()> {
        if entry.data.is_empty() && !check_ttl {
            return Ok(());
        }
        let session_id = entry.session_id.to_string();
        log::info!("[{session_id}] entry.into_bytes start");
        let entry_bytes = if !check_ttl {
            entry.into_bytes()?
        } else {
            Vec::new()
        };
        log::info!("[{session_id}] entry.into_bytes done");
        let mut wal = self.wal.lock().await;
        log::info!("[{session_id}] self.wal.lock done");
        let mut mem = self.memtable.write().await;
        log::info!("[{session_id}] self.memtable.write done");
        if self.check_wal_threshold(wal.size(), entry_bytes.len())
            || self.check_mem_threshold(mem.size(), entry.data_size)
        {
            // sync wal before rotation
            // wal.sync().context(WalSnafu)?;
            // rotation wal
            let wal_id = self.next_seq.fetch_add(1, Ordering::SeqCst);
            let wal_dir = PathBuf::from(&CONFIG.common.data_wal_dir)
                .join("logs")
                .join(self.thread_id.to_string());
            log::info!(
                "[INGESTER:WAL] create file: {}/{}/{}/{}.wal",
                wal_dir.display().to_string(),
                &self.key.org_id,
                &self.key.stream_type,
                wal_id
            );
            let new_wal = WalWriter::new(
                wal_dir,
                &self.key.org_id,
                &self.key.stream_type,
                wal_id,
                CONFIG.limit.max_file_size_on_disk as u64,
            )
            .context(WalSnafu)?;
            let old_wal = std::mem::replace(&mut *wal, new_wal);

            // rotation memtable
            let new_mem = MemTable::new();
            let old_mem = std::mem::replace(&mut *mem, new_mem);
            // update created_at
            self.created_at
                .store(Utc::now().timestamp_micros(), Ordering::Release);

            let thread_id = self.thread_id;
            let key = self.key.clone();
            let path = old_wal.path().clone();
            let path_str = path.display().to_string();
            let sid = session_id.clone();
            tokio::task::spawn(async move {
                log::info!(
                    "[INGESTER:WAL] [{sid}] start add to IMMUTABLES, file: {}",
                    path_str,
                );
                IMMUTABLES.write().await.insert(
                    path,
                    Arc::new(immutable::Immutable::new(thread_id, key.clone(), old_mem)),
                );
                log::info!(
                    "[INGESTER:WAL] [{sid}] dones add to IMMUTABLES, file: {}",
                    path_str
                );
            });
        }

        if !check_ttl {
            // write into wal
            log::info!("[{session_id}]wal.write start");
            // let start = std::time::Instant::now();
            // wal.write(&entry_bytes, false).context(WalSnafu)?;
            // log::info!("[{session_id}]wal.write done");
            // metrics::INGEST_WAL_LOCK_TIME
            //     .with_label_values(&[
            //         &self.key.org_id,
            //     ])
            //     .observe(start.elapsed().as_micros() as f64);
            // write into memtable
            let start = std::time::Instant::now();
            mem.write(schema, entry).await?;
            metrics::INGEST_MEMTABLE_LOCK_TIME
                .with_label_values(&[&self.key.org_id])
                .observe(start.elapsed().as_micros() as f64);
            log::info!("[{session_id}]mem.write done");
        }

        Ok(())
    }

    pub async fn close(&self) -> Result<()> {
        // rotation wal
        let wal = self.wal.lock().await;
        wal.sync().context(WalSnafu)?;
        let path = wal.path().clone();
        drop(wal);

        // rotation memtable
        let mut mem = self.memtable.write().await;
        let new_mem = MemTable::new();
        let old_mem = std::mem::replace(&mut *mem, new_mem);
        drop(mem);

        let thread_id = self.thread_id;
        let key = self.key.clone();
        IMMUTABLES.write().await.insert(
            path,
            Arc::new(immutable::Immutable::new(thread_id, key, old_mem)),
        );
        Ok(())
    }

    pub async fn sync(&self) -> Result<()> {
        // let wal = self.wal.lock().await;
        // wal.sync().context(WalSnafu)
        Ok(())
    }

    pub async fn read(
        &self,
        stream_name: &str,
        time_range: Option<(i64, i64)>,
    ) -> Result<Vec<(Arc<Schema>, Vec<Arc<RecordBatchEntry>>)>> {
        let memtable = self.memtable.read().await;
        memtable.read(stream_name, time_range).await
    }

    /// Check if the wal file size is over the threshold or the file is too old
    fn check_wal_threshold(&self, written_size: (usize, usize), data_size: usize) -> bool {
        let (compressed_size, _uncompressed_size) = written_size;
        compressed_size > 0
            && (compressed_size + data_size > CONFIG.limit.max_file_size_on_disk
                || self.created_at.load(Ordering::Relaxed)
                    + Duration::try_seconds(CONFIG.limit.max_file_retention_time as i64)
                        .unwrap()
                        .num_microseconds()
                        .unwrap()
                    <= Utc::now().timestamp_micros())
    }

    /// Check if the memtable size is over the threshold
    fn check_mem_threshold(&self, written_size: (usize, usize), data_size: usize) -> bool {
        let (json_size, arrow_size) = written_size;
        json_size > 0
            && (json_size + data_size > CONFIG.limit.max_file_size_in_memory
                || arrow_size + data_size > CONFIG.limit.max_file_size_in_memory)
    }
}

#[derive(Debug, Clone, Hash, Eq, PartialEq)]
pub(crate) struct WriterKey {
    pub(crate) org_id: Arc<str>,
    pub(crate) stream_type: Arc<str>,
}

impl WriterKey {
    pub(crate) fn new<T>(org_id: T, stream_type: T) -> Self
    where
        T: AsRef<str>,
    {
        Self {
            org_id: Arc::from(org_id.as_ref()),
            stream_type: Arc::from(stream_type.as_ref()),
        }
    }
}
