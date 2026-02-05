// Copyright 2025 OpenObserve Inc.
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

use config::{
    RwAHashSet, metrics,
    stats::{CacheStatsAsync, MemorySize},
};
use once_cell::sync::Lazy;
use snafu::ResultExt;
use tokio::{fs, sync::mpsc};

use crate::{
    ReadRecordBatchEntry,
    entry::PersistStat,
    errors::{DeleteFileSnafu, RenameFileSnafu, Result, TokioMpscSendSnafu, WriteDataSnafu},
    memtable::MemTable,
    rwmap::RwIndexMap,
    writer::WriterKey,
};

pub(crate) static IMMUTABLES: Lazy<RwIndexMap<PathBuf, Arc<Immutable>>> =
    Lazy::new(RwIndexMap::default);

static PROCESSING_TABLES: Lazy<RwAHashSet<PathBuf>> = Lazy::new(Default::default);

pub(crate) struct Immutable {
    idx: usize,
    key: WriterKey,
    memtable: MemTable,
}

impl MemorySize for Immutable {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<Immutable>() + self.key.mem_size() + self.memtable.mem_size()
    }
}

pub async fn read_from_immutable(
    trace_id: &str,
    org_id: &str,
    stream_type: &str,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
    partition_filters: &[(String, Vec<String>)],
    memtable_ids: &std::collections::HashSet<u64>,
) -> Result<(Vec<u64>, Vec<ReadRecordBatchEntry>)> {
    let shared_memtable = config::get_config().common.feature_shared_memtable_enabled;
    let r = IMMUTABLES.read().await;
    let mut ids = Vec::with_capacity(r.len());
    let mut batches = Vec::with_capacity(r.len());
    for (_, i) in r.iter() {
        if stream_type == i.key.stream_type.as_ref()
            && (shared_memtable || org_id == i.key.org_id.as_ref())
        {
            let (id, batche) =
                i.memtable
                    .read(org_id, stream_name, time_range, partition_filters)?;
            if memtable_ids.contains(&id) {
                log::debug!(
                    "[trace_id {trace_id}] skip immutable memtable id: {id} already in memtable",
                );
                continue;
            }
            ids.push(id);
            batches.extend(batche);
        }
    }
    Ok((ids, batches))
}

impl Immutable {
    pub(crate) fn new(idx: usize, key: WriterKey, memtable: MemTable) -> Self {
        Self { idx, key, memtable }
    }

    pub(crate) async fn persist(&self, wal_path: &PathBuf) -> Result<PersistStat> {
        let mut persist_stat = PersistStat::default();
        // 1. dump memtable to disk
        let (schema_size, paths) = self
            .memtable
            .persist(
                self.memtable.id(),
                self.idx,
                &self.key.org_id,
                &self.key.stream_type,
            )
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
            fs::rename(&path, &path.with_extension("parquet"))
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

pub(crate) async fn persist(tx: mpsc::Sender<PathBuf>) -> Result<()> {
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
    for path in paths {
        // check if the file is processing
        if PROCESSING_TABLES.read().await.contains(&path) {
            continue;
        }
        tx.send(path.clone()).await.context(TokioMpscSendSnafu)?;
        PROCESSING_TABLES.write().await.insert(path);
    }

    IMMUTABLES.write().await.shrink_to_fit();
    PROCESSING_TABLES.write().await.shrink_to_fit();

    Ok(())
}

pub(crate) async fn persist_table(idx: usize, path: PathBuf) -> Result<()> {
    let start = std::time::Instant::now();
    let r = IMMUTABLES.read().await;
    let Some(immutable) = r.get(&path) else {
        return Ok(());
    };
    let immutable = immutable.clone();
    drop(r);

    log::info!(
        "[INGESTER:MEM:{idx}] starts persist file: {}, took: {} ms",
        path.to_string_lossy(),
        start.elapsed().as_millis(),
    );

    // persist entry to local disk
    let start = std::time::Instant::now();
    let ret = immutable.persist(&path).await;
    let stat = match ret {
        Ok(v) => v,
        Err(e) => {
            // remove from processing tables
            PROCESSING_TABLES.write().await.remove(&path);
            return Err(e);
        }
    };
    log::info!(
        "[INGESTER:MEM:{idx}] finish persist file: {}, json_size: {}, arrow_size: {}, file_num: {} batch_num: {}, records: {}, took: {} ms",
        path.to_string_lossy(),
        stat.json_size,
        stat.arrow_size,
        stat.file_num,
        stat.batch_num,
        stat.records,
        start.elapsed().as_millis(),
    );

    // remove entry
    let mut rw = IMMUTABLES.write().await;
    rw.swap_remove(&path);
    drop(rw);

    // remove from processing tables
    PROCESSING_TABLES.write().await.remove(&path);

    // update metrics
    metrics::INGEST_MEMTABLE_BYTES
        .with_label_values::<&str>(&[])
        .sub(stat.json_size);
    metrics::INGEST_MEMTABLE_ARROW_BYTES
        .with_label_values::<&str>(&[])
        .sub(stat.arrow_size as i64);
    metrics::INGEST_MEMTABLE_FILES
        .with_label_values::<&str>(&[])
        .dec();

    Ok(())
}

// check if the persist is done for the given seq_id
// if there is no id less than the given seq_id, return true
pub async fn check_persist_done(seq_id: u64) -> bool {
    let r = IMMUTABLES.read().await;
    let mut min_id = u64::MAX;
    for (_, i) in r.iter() {
        if i.memtable.id() < seq_id {
            min_id = min_id.min(i.memtable.id());
        }
    }
    min_id < seq_id
}

pub async fn get_immutables_cache_stats() -> (usize, usize, usize) {
    IMMUTABLES.stats().await
}

pub async fn get_processing_tables_cache_stats() -> (usize, usize, usize) {
    PROCESSING_TABLES.stats().await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_immutables_cache_stats() {
        // Test that get_immutables_cache_stats returns valid tuple structure
        let (total_size, used_size, _item_len) = get_immutables_cache_stats().await;

        // used_size should not exceed total_size
        assert!(used_size <= total_size);
    }

    #[tokio::test]
    async fn test_get_immutables_cache_stats_consistency() {
        // Test that stats returns valid values across multiple calls
        // Note: In a concurrent test environment, values may change due to other tests
        let (total1, used1, len1) = get_immutables_cache_stats().await;
        let (total2, used2, len2) = get_immutables_cache_stats().await;

        // Total size should remain consistent
        assert_eq!(total1, total2);

        // Used size and length may change due to concurrent tests, but should not vary wildly
        let used_diff = if used2 > used1 {
            used2 - used1
        } else {
            used1 - used2
        };
        let len_diff = if len2 > len1 {
            len2 - len1
        } else {
            len1 - len2
        };
        assert!(used_diff < 100000 || used1 == 0 || used2 == 0);
        assert!(len_diff < 100 || len1 == 0 || len2 == 0);
    }

    #[tokio::test]
    async fn test_get_processing_tables_cache_stats() {
        // Test that get_processing_tables_cache_stats returns valid tuple structure
        let (total_size, used_size, _item_len) = get_processing_tables_cache_stats().await;

        // used_size should not exceed total_size
        assert!(used_size <= total_size);
    }

    #[tokio::test]
    async fn test_get_processing_tables_cache_stats_consistency() {
        // Test that stats returns valid values across multiple calls
        // Note: In a concurrent test environment, values may change due to other tests
        let (total1, used1, len1) = get_processing_tables_cache_stats().await;
        let (total2, used2, len2) = get_processing_tables_cache_stats().await;

        // Total size should remain consistent
        assert_eq!(total1, total2);

        // Used size and length may change due to concurrent tests, but should not vary wildly
        let used_diff = if used2 > used1 {
            used2 - used1
        } else {
            used1 - used2
        };
        let len_diff = if len2 > len1 {
            len2 - len1
        } else {
            len1 - len2
        };
        assert!(used_diff < 100000 || used1 == 0 || used2 == 0);
        assert!(len_diff < 100 || len1 == 0 || len2 == 0);
    }

    #[tokio::test]
    async fn test_both_cache_stats_functions() {
        // Test that both functions work correctly when called together
        let immutables_stats = get_immutables_cache_stats().await;
        let processing_stats = get_processing_tables_cache_stats().await;

        // Both should return valid tuples
        assert!(immutables_stats.1 <= immutables_stats.0);
        assert!(processing_stats.1 <= processing_stats.0);

        // Both functions should be callable independently
        let _ = get_immutables_cache_stats().await;
        let _ = get_processing_tables_cache_stats().await;
    }
}
