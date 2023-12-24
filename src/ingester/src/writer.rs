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

use std::sync::{
    atomic::{AtomicI64, AtomicU32, Ordering},
    Arc,
};

use arrow_schema::Schema;
use chrono::{Duration, Utc};
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

static WRITERS: Lazy<RwMap<WriterKey, Arc<Writer>>> = Lazy::new(RwMap::default);

pub struct Writer {
    key: WriterKey,
    wal: Arc<Mutex<WalWriter>>,
    memtable: Arc<RwLock<MemTable>>,
    next_seq: AtomicU32,
    created_at: AtomicI64,
}

/// Get a writer for a given org_id and stream_type
pub async fn get_writer(org_id: &str, stream_type: &str) -> Arc<Writer> {
    let key = WriterKey::new(org_id, stream_type);
    let mut rw = WRITERS.write().await;
    let w = rw
        .entry(key.clone())
        .or_insert_with(|| Arc::new(Writer::new(key)));
    w.clone()
}

// Get a reader for a given org_id and stream_type
pub async fn get_reader(org_id: &str, stream_type: &str) -> Option<Arc<Writer>> {
    let key = WriterKey::new(org_id, stream_type);
    WRITERS.read().await.get(&key).cloned()
}

impl Writer {
    pub(crate) fn new(key: WriterKey) -> Self {
        let next_seq = AtomicU32::new(1);
        let wal_id = next_seq.fetch_add(1, Ordering::SeqCst);
        Self {
            key: key.clone(),
            wal: Arc::new(Mutex::new(
                WalWriter::new(super::WAL_DIR, &key.org_id, &key.stream_type, wal_id)
                    .expect("wal file create error"),
            )),
            memtable: Arc::new(RwLock::new(MemTable::new())),
            next_seq,
            created_at: AtomicI64::new(Utc::now().timestamp_micros()),
        }
    }

    pub async fn write(&self, schema: Arc<Schema>, mut entry: Entry) -> Result<()> {
        let entry_bytes = entry.into_bytes()?;
        let mut wal = self.wal.lock().await;
        if self.check_threshold(wal.size(), entry_bytes.len()).await {
            // rotation wal
            let id = self.next_seq.fetch_add(1, Ordering::SeqCst);
            let new_wal =
                WalWriter::new(super::WAL_DIR, &self.key.org_id, &self.key.stream_type, id)
                    .context(WalSnafu)?;
            let old_wal = std::mem::replace(&mut *wal, new_wal);

            // rotation memtable
            let mut mem = self.memtable.write().await;
            let new_mem = MemTable::new();
            let old_mem = std::mem::replace(&mut *mem, new_mem);
            // update created_at
            self.created_at
                .store(Utc::now().timestamp_micros(), Ordering::Release);
            drop(mem);

            let key = self.key.clone();
            let path = old_wal.path().clone();
            tokio::task::spawn(async move {
                IMMUTABLES
                    .write()
                    .await
                    .insert(path, immutable::Immutable::new(key, old_mem));
            });
        }

        // write into wal
        wal.write(&entry_bytes).context(WalSnafu)?;

        // write into memtable
        self.memtable.write().await.write(schema, entry).await?;
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
    async fn check_threshold(&self, written_size: usize, data_size: usize) -> bool {
        written_size > 0
            && (written_size + data_size > super::WAL_FILE_MAX_SIZE
                || self.created_at.load(Ordering::Relaxed)
                    + Duration::seconds(super::WAL_FILE_ROTATION_INTERVAL)
                        .num_microseconds()
                        .unwrap()
                    <= Utc::now().timestamp_micros())
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
