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

mod entry;
pub mod errors;
mod immutable;
mod memtable;
mod partition;
mod rwmap;
mod stream;
mod wal;
mod writer;

use std::{fs::create_dir_all, path::PathBuf, sync::Arc};

use arrow_schema::Schema;
use config::RwAHashMap;
pub use entry::Entry;
pub use immutable::{check_persist_done, get_memtable_id_from_file_name, read_from_immutable};
use once_cell::sync::Lazy;
use snafu::ResultExt;
use tokio::sync::{Mutex, mpsc};
pub use wal::collect_wal_parquet_metrics;
pub use writer::{
    Writer, check_disk_circuit_breaker, check_memory_circuit_breaker, check_memtable_size,
    flush_all, get_max_writer_seq_id, get_writer, read_from_memtable,
};

use crate::errors::OpenDirSnafu;

pub(crate) type ReadRecordBatchEntry = (Arc<Schema>, Vec<Arc<entry::RecordBatchEntry>>);

pub static WAL_PARQUET_METADATA: Lazy<RwAHashMap<String, config::meta::stream::FileMeta>> =
    Lazy::new(Default::default);

pub static WAL_DIR_DEFAULT_PREFIX: &str = "logs";

// writer signal
pub enum WriterSignal {
    Produce,
    Rotate,
    Close,
}

/// Pre-processed write batch ready for IO operations
///
/// This structure contains all data pre-processed and ready for direct IO,
/// moving CPU-intensive work (JSON to Arrow conversion) out of the consume loop.
pub struct ProcessedBatch {
    /// Original entries for metadata
    pub entries: Vec<Entry>,
    /// Serialized bytes for WAL writing
    pub bytes_entries: Vec<Vec<u8>>,
    /// Arrow RecordBatch entries for Memtable writing
    pub batch_entries: Vec<Arc<entry::RecordBatchEntry>>,
    /// Total JSON size for rotation check
    pub entries_json_size: usize,
    /// Total Arrow size for rotation check
    pub entries_arrow_size: usize,
}

impl ProcessedBatch {
    /// Create an empty ProcessedBatch for control signals (Rotate, Close)
    pub fn empty() -> Self {
        Self {
            entries: Vec::new(),
            bytes_entries: Vec::new(),
            batch_entries: Vec::new(),
            entries_json_size: 0,
            entries_arrow_size: 0,
        }
    }
}

pub async fn init() -> errors::Result<()> {
    // check uncompleted parquet files, need delete those files
    wal::check_uncompleted_parquet_files().await?;

    // replay wal files to create immutable
    let wal_dir = PathBuf::from(&config::get_config().common.data_wal_dir).join("logs");
    create_dir_all(&wal_dir).context(OpenDirSnafu {
        path: wal_dir.clone(),
    })?;
    let wal_files = wal::wal_scan_files(&wal_dir, "wal")
        .await
        .unwrap_or_default();
    tokio::task::spawn(async move {
        if let Err(e) = wal::replay_wal_files(wal_dir, wal_files).await {
            log::error!("replay wal files error: {e}");
        }
    });

    // start a job to flush memtable to immutable
    tokio::task::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(
                config::get_config().limit.max_file_retention_time,
            ))
            .await;
            // check memtable ttl
            if let Err(e) = writer::check_ttl().await {
                log::error!("memtable check ttl error: {e}");
            }
        }
    });

    // start a job to flush memtable to immutable
    tokio::task::spawn(async move {
        if let Err(e) = run().await {
            log::error!("immutable persist error: {e}");
        }
    });
    Ok(())
}

async fn run() -> errors::Result<()> {
    // start persist worker
    let cfg = config::get_config();
    let (tx, rx) = mpsc::channel::<PathBuf>(cfg.limit.mem_dump_thread_num);
    let rx = Arc::new(Mutex::new(rx));
    for thread_id in 0..cfg.limit.mem_dump_thread_num {
        let rx = rx.clone();
        tokio::spawn(async move {
            loop {
                let ret = rx.lock().await.recv().await;
                match ret {
                    None => {
                        log::debug!("[INGESTER:MEM] Receiving memtable channel is closed");
                        break;
                    }
                    Some(path) => {
                        if let Err(e) = immutable::persist_table(thread_id, path).await {
                            log::error!("[INGESTER:MEM:{thread_id}] Error persist memtable: {e}");
                        }
                    }
                }
            }
        });
    }

    // start a job to dump immutable data to disk
    loop {
        if config::cluster::is_offline() {
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_secs(
            config::get_config().limit.mem_persist_interval,
        ))
        .await;
        // persist immutable data to disk
        if let Err(e) = immutable::persist(tx.clone()).await {
            log::error!("immutable persist error: {e}");
        }
        // shrink metadata cache
        WAL_PARQUET_METADATA.write().await.shrink_to_fit();
    }

    log::info!("[INGESTER:MEM] immutable persist is stopped");
    Ok(())
}

// wal file format:
// files/{org}/{stype}/{stream}/{thread_id}/{year}/{month}/{day}/{hour}/{schema_key}/{file_name}
pub fn is_wal_file(local_mode: bool, file: &str) -> bool {
    // not local mode, directly return false
    if !local_mode {
        return false;
    }

    // local mode, check the file name format
    let columns = file.split('/').collect::<Vec<_>>();
    !(columns.len() < 11
        // thread_id is impossible over 1000
        || columns[4].len() == 4
        // schema_key is 16 bytes, and not contains "="
        || columns[9].len() != 16
        || columns[9].contains("="))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_wal_file_wal_file() {
        assert!(is_wal_file(
            true,
            "files/org/stype/stream/0/2025/03/24/00/2adf99cbc1277d5c/file.parquet"
        ));
        assert!(is_wal_file(
            true,
            "files/org/stype/stream/0/2025/03/24/00/2adf99cbc1277d5c/a=b/file.parquet"
        ));
    }

    #[test]
    fn test_is_wal_file_storage_file() {
        assert!(!is_wal_file(
            true,
            "files/org/stype/stream/2025/03/24/00/file.parquet"
        ));
        assert!(!is_wal_file(
            true,
            "files/org/stype/stream/2025/03/24/00/a=b/file.parquet"
        ));
    }

    #[test]
    fn test_is_wal_file_not_local_mode() {
        assert!(!is_wal_file(
            false,
            "files/org/stype/stream/0/2025/03/24/00/2adf99cbc1277d5c/file.parquet"
        ));
        assert!(!is_wal_file(
            false,
            "files/org/stype/stream/2025/03/24/00/file.parquet"
        ));
        assert!(!is_wal_file(
            false,
            "files/org/stype/stream/2025/03/24/00/a=b/file.parquet"
        ));
    }
}
