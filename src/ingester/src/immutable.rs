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

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use config::metrics;
use hashbrown::HashSet;
use once_cell::sync::Lazy;
use snafu::ResultExt;
use tokio::{
    fs,
    sync::{RwLock, mpsc},
};

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

static PROCESSING_TABLES: Lazy<RwLock<HashSet<PathBuf>>> =
    Lazy::new(|| RwLock::new(HashSet::new()));

pub(crate) struct Immutable {
    idx: usize,
    key: WriterKey,
    memtable: MemTable,
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
            .persist(self.idx, &self.key.org_id, &self.key.stream_type)
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
            // Add memtable id to the parquet file name
            let parquet_path =
                add_memtable_id_to_file_name(&path, self.memtable.id()).with_extension("parquet");
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

fn add_memtable_id_to_file_name(path: &Path, memtable_id: u64) -> PathBuf {
    let file_stem = path.file_stem().unwrap().to_string_lossy();
    let extension = path.extension().map(|e| e.to_string_lossy());
    let new_file_name = match extension {
        Some(ext) => format!("{}_{}.{}", file_stem, memtable_id, ext),
        None => format!("{}_{}", file_stem, memtable_id),
    };
    path.with_file_name(new_file_name)
}

pub fn get_memtable_id_from_file_name(file_name: &str) -> u64 {
    // Remove extension by finding the last dot and taking everything before it
    // If no dot exists, use the entire filename
    let stem = file_name
        .rfind('.')
        .map(|pos| &file_name[..pos])
        .unwrap_or(file_name);
    // Get the part after the last underscore
    stem.rsplit('_')
        .next()
        .and_then(|id_str| id_str.parse::<u64>().ok())
        .unwrap_or_default()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_memtable_id_simple() {
        // Simple case with single underscore
        let file_name = "file_1234567890.parquet";
        assert_eq!(get_memtable_id_from_file_name(file_name), 1234567890);
    }

    #[test]
    fn test_get_memtable_id_multiple_underscores() {
        // Multiple underscores - should get the last one
        let file_name = "prefix_middle_suffix_9876543210.parquet";
        assert_eq!(get_memtable_id_from_file_name(file_name), 9876543210);
    }

    #[test]
    fn test_get_memtable_id_complex_real_world() {
        // Real-world complex case from the issue
        let file_name =
            "1765538190188506.1765538190416169.7405204004302487552_1765538214467130.parquet";
        assert_eq!(get_memtable_id_from_file_name(file_name), 1765538214467130);
    }

    #[test]
    fn test_get_memtable_id_multiple_dots_and_underscores() {
        // Multiple dots and underscores
        let file_name = "a.b.c_d.e.f_12345.parquet";
        assert_eq!(get_memtable_id_from_file_name(file_name), 12345);
    }

    #[test]
    fn test_get_memtable_id_no_extension() {
        // No extension
        let file_name = "file_555666777";
        assert_eq!(get_memtable_id_from_file_name(file_name), 555666777);
    }

    #[test]
    fn test_get_memtable_id_no_underscore() {
        // No underscore - should return 0
        let file_name = "file.parquet";
        assert_eq!(get_memtable_id_from_file_name(file_name), 0);
    }

    #[test]
    fn test_get_memtable_id_invalid_number() {
        // Invalid number after underscore - should return 0
        let file_name = "file_notanumber.parquet";
        assert_eq!(get_memtable_id_from_file_name(file_name), 0);
    }

    #[test]
    fn test_get_memtable_id_empty_string() {
        // Empty string
        assert_eq!(get_memtable_id_from_file_name(""), 0);
    }

    #[test]
    fn test_get_memtable_id_only_underscore() {
        // Only underscore
        let file_name = "_123456.parquet";
        assert_eq!(get_memtable_id_from_file_name(file_name), 123456);
    }

    #[test]
    fn test_get_memtable_id_multiple_extensions() {
        // Multiple extensions (e.g., .tar.gz style)
        // Based on add_memtable_id_to_file_name, the ID is added before the extension
        let file_name = "file.tar_999888777.gz";
        assert_eq!(get_memtable_id_from_file_name(file_name), 999888777);
    }

    #[test]
    fn test_get_memtable_id_max_u64() {
        // Test with max u64 value
        let file_name = "file_18446744073709551615.parquet";
        assert_eq!(get_memtable_id_from_file_name(file_name), u64::MAX);
    }

    #[test]
    fn test_get_memtable_id_zero() {
        // Test with zero
        let file_name = "file_0.parquet";
        assert_eq!(get_memtable_id_from_file_name(file_name), 0);
    }
}
