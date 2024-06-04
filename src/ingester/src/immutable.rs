// Copyright 2024 Zinc Labs Inc.
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

use config::metrics;
use futures::future::join_all;
use once_cell::sync::Lazy;
use snafu::ResultExt;
use tokio::{fs, sync::Semaphore, task};

use crate::{
    entry::PersistStat,
    errors::{DeleteFileSnafu, RenameFileSnafu, Result, TokioJoinSnafu, WriteDataSnafu},
    memtable::MemTable,
    rwmap::RwMap,
    writer::WriterKey,
    ReadRecordBatchEntry,
};

pub(crate) static IMMUTABLES: Lazy<RwMap<PathBuf, Arc<Immutable>>> = Lazy::new(RwMap::default);

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
) -> Result<Vec<ReadRecordBatchEntry>> {
    let r = IMMUTABLES.read().await;
    let mut batches = Vec::with_capacity(r.len());
    for (_, i) in r.iter() {
        if org_id == i.key.org_id.as_ref() && stream_type == i.key.stream_type.as_ref() {
            batches.extend(i.memtable.read(stream_name, time_range)?);
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

    pub(crate) async fn persist(&self, wal_path: &PathBuf) -> Result<PersistStat> {
        let mut persist_stat = PersistStat::default();
        // 1. dump memtable to disk
        let (schema_size, paths) = self
            .memtable
            .persist(self.thread_id, &self.key.org_id, &self.key.stream_type)
            .await?;
        persist_stat.arrow_size += schema_size;
        // 2. create a lock file
        let done_path = wal_path.with_extension("lock");
        let lock_data = paths
            .iter()
            .map(|(p, ..)| p.to_string_lossy())
            .collect::<Vec<_>>()
            .join("\n");
        fs::write(&done_path, lock_data.as_bytes())
            .await
            .context(WriteDataSnafu)?;
        // 3. delete wal file
        fs::remove_file(wal_path)
            .await
            .context(DeleteFileSnafu { path: wal_path })?;
        // 4. rename the tmp files to parquet files
        for (path, stat) in paths {
            persist_stat += stat;
            let parquet_path = path.with_extension("parquet");
            fs::rename(&path, &parquet_path)
                .await
                .context(RenameFileSnafu { path: &path })?;
        }
        // 5. delete the lock file
        fs::remove_file(&done_path)
            .await
            .context(DeleteFileSnafu { path: &done_path })?;
        Ok(persist_stat)
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
    let semaphore = Arc::new(Semaphore::new(
        config::get_config().limit.file_move_thread_num,
    ));
    for path in paths {
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: task::JoinHandle<Result<Option<(PathBuf, PersistStat)>>> =
            task::spawn(async move {
                let r = IMMUTABLES.read().await;
                let Some(immutable) = r.get(&path) else {
                    drop(permit);
                    return Ok(None);
                };
                log::info!(
                    "[INGESTER:WAL] start persist file: {}",
                    path.to_string_lossy(),
                );
                // persist entry to local disk
                let immutable = immutable.clone();
                drop(r);
                let ret = immutable.persist(&path).await;
                drop(permit);
                ret.map(|stat| Some((path, stat)))
            });
        tasks.push(task);
    }

    // remove entry from IMMUTABLES
    let tasks = join_all(tasks).await;
    for task in tasks {
        match task.context(TokioJoinSnafu {})? {
            Err(e) => {
                log::error!("[INGESTER:WAL] persist error: {}", e);
            }
            Ok(None) => {}
            Ok(Some((path, stat))) => {
                log::info!(
                    "[INGESTER:WAL] done  persist file: {}, json_size: {}, arrow_size: {}, file_num: {} batch_num: {}",
                    path.to_string_lossy(),
                    stat.json_size,
                    stat.arrow_size,
                    stat.file_num,
                    stat.batch_num,
                );
                // remove entry
                let mut rw = IMMUTABLES.write().await;
                rw.remove(&path);
                drop(rw);
                // update metrics
                metrics::INGEST_MEMTABLE_BYTES
                    .with_label_values(&[])
                    .sub(stat.json_size);
                metrics::INGEST_MEMTABLE_ARROW_BYTES
                    .with_label_values(&[])
                    .sub(stat.arrow_size as i64);
                metrics::INGEST_MEMTABLE_FILES.with_label_values(&[]).dec();
            }
        }
    }
    let mut rw = IMMUTABLES.write().await;
    rw.shrink_to_fit();

    Ok(())
}
