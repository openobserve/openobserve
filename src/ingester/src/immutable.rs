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

use std::{path::PathBuf, sync::Arc};

use arrow_schema::Schema;
use config::{metrics, CONFIG};
use futures::future::try_join_all;
use once_cell::sync::Lazy;
use snafu::ResultExt;
use tokio::{sync::Semaphore, task};

use crate::{
    entry::RecordBatchEntry,
    errors::{DeleteFileSnafu, RenameFileSnafu, Result, TokioJoinSnafu, WriteDataSnafu},
    memtable::MemTable,
    rwmap::RwIndexMap,
    writer::WriterKey,
};

pub(crate) static IMMUTABLES: Lazy<RwIndexMap<PathBuf, Immutable>> = Lazy::new(RwIndexMap::default);

#[warn(dead_code)]
pub(crate) struct Immutable {
    thread_id: usize,
    key: WriterKey,
    memtable: MemTable,
}

pub async fn read_from_immutable(
    org_id: &str,
    stream_type: &str,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
) -> Result<Vec<(Arc<Schema>, Vec<Arc<RecordBatchEntry>>)>> {
    let r = IMMUTABLES.read().await;
    let mut batches = Vec::with_capacity(r.len());
    for (_, i) in r.iter() {
        if org_id == i.key.org_id.as_ref() && stream_type == i.key.stream_type.as_ref() {
            batches.extend(i.memtable.read(stream_name, time_range).await?);
        }
    }
    Ok(batches)
}

impl Immutable {
    pub(crate) fn new(thread_id: usize, key: WriterKey, memtable: MemTable) -> Self {
        Self {
            thread_id,
            key,
            memtable,
        }
    }

    pub(crate) async fn persist(&self, wal_path: &PathBuf) -> Result<(i64, usize)> {
        let mut persist_json_size = 0;
        let mut persist_arrow_size = 0;
        // 1. dump memtable to disk
        let (schema_size, paths) = self
            .memtable
            .persist(self.thread_id, &self.key.org_id, &self.key.stream_type)
            .await?;
        persist_arrow_size += schema_size;
        // 2. create a lock file
        let done_path = wal_path.with_extension("lock");
        let lock_data = paths
            .iter()
            .map(|(p, ..)| p.to_string_lossy())
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(&done_path, lock_data.as_bytes()).context(WriteDataSnafu)?;
        // 3. delete wal file
        std::fs::remove_file(wal_path).context(DeleteFileSnafu { path: wal_path })?;
        // 4. rename the tmp files to parquet files
        for (path, json_size, arrow_size) in paths {
            persist_json_size += json_size;
            persist_arrow_size += arrow_size;
            let parquet_path = path.with_extension("parquet");
            std::fs::rename(&path, &parquet_path).context(RenameFileSnafu { path: &path })?;
        }
        // 5. delete the lock file
        std::fs::remove_file(&done_path).context(DeleteFileSnafu { path: &done_path })?;
        Ok((persist_json_size, persist_arrow_size))
    }
}

pub(crate) async fn persist() -> Result<()> {
    let r = IMMUTABLES.read().await;
    let n = r.len();
    let mut paths = Vec::with_capacity(n);
    for item in r.iter() {
        if paths.len() >= n {
            break;
        }
        paths.push(item.0.clone());
    }
    drop(r);

    let mut tasks = Vec::with_capacity(paths.len());
    let semaphore = Arc::new(Semaphore::new(CONFIG.limit.file_move_thread_num));
    for path in paths {
        let semaphore = semaphore.clone();
        let task: task::JoinHandle<Result<Option<(PathBuf, i64, usize)>>> =
            task::spawn(async move {
                let permit = semaphore.clone().acquire_owned().await.unwrap();
                let r = IMMUTABLES.read().await;
                let Some(immutable) = r.get(&path) else {
                    drop(permit);
                    return Ok(None);
                };
                // persist entry to local disk
                let ret = immutable.persist(&path).await;
                drop(r);
                drop(permit);
                ret.map(|size| Some((path, size.0, size.1)))
            });
        tasks.push(task);
    }

    // remove entry from IMMUTABLES
    let tasks = try_join_all(tasks).await.context(TokioJoinSnafu)?;
    let mut rw = IMMUTABLES.write().await;
    for task in tasks {
        if let Some((path, json_size, arrow_size)) = task? {
            log::info!(
                "[INGESTER:WAL] persist file: {}, json_size: {}, arrow_size: {}",
                path.to_string_lossy(),
                json_size,
                arrow_size
            );
            // remove entry
            rw.remove(&path);
            // update metrics
            metrics::INGEST_MEMTABLE_BYTES
                .with_label_values(&[])
                .sub(json_size);
            metrics::INGEST_MEMTABLE_ARROW_BYTES
                .with_label_values(&[])
                .sub(arrow_size as i64);
            metrics::INGEST_MEMTABLE_FILES.with_label_values(&[]).dec();
        }
    }
    rw.shrink_to_fit();

    Ok(())
}
