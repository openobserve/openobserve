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
use futures::lock::Mutex;
use log::info;
use once_cell::sync::Lazy;
use snafu::ResultExt;
use tokio::sync::RwLock;
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
    // next_seq: AtomicU64,
    wal_next_seq: AtomicU64,
    memtable_next_seq: AtomicU64,
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
        // let next_seq = AtomicU64::new(now as u64);
        let wal_next_seq = AtomicU64::new(now as u64);
        let memtable_next_seq = AtomicU64::new(now as u64);
        let wal_id = wal_next_seq.fetch_add(1, Ordering::SeqCst);
        memtable_next_seq.fetch_add(1, Ordering::SeqCst);
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
            wal_next_seq,
            memtable_next_seq,
            created_at: AtomicI64::new(now),
        }
    }

    // check_ttl is used to check if the memtable has expired
    pub async fn write(
        &self,
        _schema: Arc<Schema>,
        mut entry: Entry,
        check_ttl: bool,
    ) -> Result<()> {
        if entry.data.is_empty() && !check_ttl {
            return Ok(());
        }
        let entry_bytes = if !check_ttl {
            entry.into_bytes()?
        } else {
            Vec::new()
        };
        let mut wal = self.wal.lock().await;
        if self.check_wal_threshold(wal.size(), entry_bytes.len())
            || self.check_mem_threshold(self.memtable.read().await.size(), entry.data_size)
        {
            // sync wal before rotation
            wal.sync().context(WalSnafu)?;
            // rotation wal
            let wal_id = self.wal_next_seq.fetch_add(1, Ordering::SeqCst);
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
            let _ = std::mem::replace(&mut *wal, new_wal);
            // rotation memtable remove to flusher

            // update created_at
            self.created_at
                .store(Utc::now().timestamp_micros(), Ordering::Release);
        }

        if !check_ttl {
            // write into wal
            let start = std::time::Instant::now();
            wal.write(&entry_bytes, false).context(WalSnafu)?;
            metrics::INGEST_WAL_LOCK_TIME
                .with_label_values(&[&self.key.org_id])
                .observe(start.elapsed().as_millis() as f64);
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
        let wal = self.wal.lock().await;
        wal.sync().context(WalSnafu)
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

    pub async fn write_memtable(
        &self,
        schema: Arc<Schema>,
        entry: Entry,
        check_ttl: bool,
        rotate_mem: Option<&(String, String)>,
    ) -> Result<()> {
        if entry.data.is_empty() && !check_ttl {
            return Ok(());
        }

        let sid = entry.session_id.clone();
        info!(
            "[{sid}]write_memtable memtable_size: {:?}, entry.data_size: {}, CONFIG.limit.max_file_size_in_memory: {}",
            self.memtable.read().await.size(),
            entry.data_size,
            CONFIG.limit.max_file_size_in_memory,
        );

        if rotate_mem.is_some() {
            let mut mem = self.memtable.write().await;
            let new_mem = MemTable::new();
            let old_mem = std::mem::replace(&mut *mem, new_mem);
            drop(mem);
            // update created_at
            self.created_at
                .store(Utc::now().timestamp_micros(), Ordering::Release);
            let thread_id = self.thread_id;
            let key = self.key.clone();
            let path = PathBuf::from(rotate_mem.unwrap().1.as_str());
            let path_str = path.display().to_string();
            tokio::task::spawn(async move {
                log::info!(
                    "[INGESTER:WAL] [{sid}] start add to IMMUTABLES, file: {}",
                    path_str
                );
                IMMUTABLES.write().await.insert(
                    path.clone(),
                    Arc::new(immutable::Immutable::new(thread_id, key.clone(), old_mem)),
                );
                log::info!(
                    "[INGESTER:WAL] [{sid}] dones add to IMMUTABLES, file: {}",
                    path_str
                );
            });
        }

        let start = std::time::Instant::now();
        let mut mem = self.memtable.write().await;
        mem.write(schema, entry).await?;
        drop(mem);
        metrics::INGEST_MEMTABLE_LOCK_TIME
            .with_label_values(&[&self.key.org_id])
            .observe(start.elapsed().as_millis() as f64);
        Ok(())
    }

    pub async fn write_wal(&self, mut entry: Entry) -> Result<Option<(String, String)>> {
        if entry.data.is_empty() {
            return Ok(None);
        }
        let entry_bytes = entry.into_bytes()?;
        let mut wal = self.wal.lock().await;
        // info!(
        //     "[{}]write_wal memtable_size: {:?}, entry.data_size: {},
        // CONFIG.limit.max_file_size_in_memory: {}",     entry.session_id,
        //     self.memtable.read().await.size(),
        //     entry.data_size,
        //     CONFIG.limit.max_file_size_in_memory
        // );
        let mut res = None;
        if self.check_wal_threshold(wal.size(), entry_bytes.len())
            || self.check_mem_threshold(self.memtable.read().await.size(), entry.data_size)
        {
            // sync wal before rotation
            wal.sync().context(WalSnafu)?;
            // rotation wal
            let wal_id = self.wal_next_seq.fetch_add(1, Ordering::SeqCst);
            let wal_dir = PathBuf::from(&CONFIG.common.data_wal_dir)
                .join("logs")
                .join(self.thread_id.to_string());
            let sid = entry.session_id;
            log::info!(
                "[INGESTER:WAL] [{sid}] create file: {}/{}/{}/{}.wal",
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
            let path_str = old_wal.path().clone().display().to_string();
            log::info!(
                "[{sid}] old_wal path_str will be record in immutable : {:?}",
                path_str
            );

            res = Some((sid.to_string(), path_str));
        }

        // write into wal
        let start = std::time::Instant::now();
        wal.write(&entry_bytes, false).context(WalSnafu)?;
        metrics::INGEST_WAL_LOCK_TIME
            .with_label_values(&[&self.key.org_id])
            .observe(start.elapsed().as_millis() as f64);

        Ok(res)
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
