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

//! # Parquet File Processing System - Operational Flow Documentation
//!
//! ## High-Level Architecture Overview
//!
//! This is a **batch-oriented file processing system** that moves WAL (Write-Ahead Log) parquet
//! files from local disk to remote storage. The system uses a **nested channel architecture** with
//! worker threads to handle file processing and merging operations.
//!
//! ## Core Components & Data Flow
//!
//! ### 1. Main Control Loop (`run()` function)
//! ```
//! [Main Loop] ---> [Pending Delete Scanner] ---> [WAL Files Scanner]
//!      ^                                               |
//!      |                                               v
//! [Sleep Interval] <------------------------------- [Channel Send]
//! ```
//!
//! **Purpose**: Orchestrates the entire process with periodic scanning
//! **Critical Timing**: Sleeps for `file_push_interval` seconds between cycles
//! **Why**: Prevents overwhelming the system while ensuring timely file processing
//!
//! ### 2. Worker Thread Pool Setup
//! ```
//! [Main] ---> [Create Channel(1)] ---> [Spawn N Workers]
//!                |                         |
//!                v                         v
//!         [Single Receiver]         [Worker Pool listening]
//! ```
//!
//! **Channel Buffer Size**: 1 (blocking backpressure mechanism)
//! **Worker Count**: `cfg.limit.file_move_thread_num`
//! **Critical Ordering**: Workers process batches sequentially per worker, but multiple workers run
//! in parallel
//!
//! ### 3. File Discovery & Grouping Pipeline
//! ```
//! [scan_files_with_channel] ---> [Batch Channel] ---> [prepare_files]
//!          |                           |                     |
//!          v                           v                     v
//!     [File System]              [Vec<String>]        [Partition Groups]
//! ```
//!
//! **Batching**: Files are discovered in batches (limit: `file_push_limit`)
//! **Grouping Logic**: Files are partitioned by prefix (org/stream/date path minus thread_id)
//! **Why Grouping**: Related files are processed together for efficient merging
//!
//! ### 4. File Processing States & Lifecycle
//! ```
//! [Discovered] ---> [PROCESSING_FILES] ---> [Merged/Uploaded] ---> [Deleted/Pending Delete]
//!                          ^                                              |
//!                          |                                              v
//!                   [Lock Check] <--------------------- [WAL Lock Files Check]
//! ```
//!
//! **State Management**: `PROCESSING_FILES` global HashSet prevents duplicate processing
//! **Lock Coordination**: WAL lock files indicate active usage, triggering pending delete instead
//! of immediate deletion
//!
//! ## Critical Operational Sequences
//!
//! ### 1. File Merge Decision Logic (Order Matters!)
//! ```
//! 1. Sort files by min_ts (timestamp ordering)
//! 2. Check total size vs max_file_size
//! 3. Check field count vs file_move_fields_limit
//! 4. Check file age vs max_file_retention_time
//! 5. If all conditions pass → proceed with merge
//! ```
//!
//! **Why This Order**: Timestamp sorting ensures temporal consistency; size/field limits prevent
//! resource exhaustion; age check ensures timely processing
//!
//! ### 2. Merge Operation Sequence
//! ```
//! 1. Create DataFusion session with unique trace_id
//! 2. Build table from file list
//! 3. Execute merge_parquet_files()
//! 4. Generate inverted index (if enabled)
//! 5. Upload to remote storage
//! 6. Update file_list metadata
//! 7. Cleanup local files
//! 8. Clear session data
//! ```
//!
//! **Critical**: Session cleanup MUST happen after merge completion to prevent memory leaks
//!
//! ### 3. File Deletion Workflow
//! ```
//! [Check WAL Lock] ---> [Lock Exists?] ---> [Add to Pending Delete]
//!         |                    |                      |
//!         v                    v                      v
//!    [No Lock]          [Lock Present]         [Queue for Later]
//!         |                                           |
//!         v                                           v
//!   [Delete Immediately]                    [Process in Next Cycle]
//! ```
//!
//! **Concurrency Safety**: WAL locks prevent deletion of actively used files
//!
//! ## Channel Usage Patterns & Threading
//!
//! ### 1. File Discovery Channel
//! - **Type**: `tokio::sync::mpsc::channel::<Vec<String>>(1)`
//! - **Flow**: Single producer (file scanner) → Single consumer (prepare_files)
//! - **Backpressure**: Buffer size 1 creates natural flow control
//!
//! ### 2. Worker Distribution Channel
//! - **Type**: `tokio::sync::mpsc::channel::<(String, Vec<FileKey>)>(1)`
//! - **Flow**: Single producer (main loop) → Multiple consumers (worker pool)
//! - **Load Balancing**: First-available worker gets next batch
//!
//! ### 3. Worker Coordination
//! - **Shared Receiver**: `Arc<Mutex<Receiver>>` enables multiple workers to compete for work
//! - **Partition Isolation**: Each worker processes different file partitions simultaneously
//!
//! ## Memory & Resource Management
//!
//! ### 1. Processing Files Tracking
//! - **Global State**: `PROCESSING_FILES` prevents concurrent processing
//! - **Cleanup Points**: Files removed from set after successful processing or error
//!
//! ### 2. Metadata Caching
//! - **Cache**: `WAL_PARQUET_METADATA` stores file metadata to avoid repeated reads
//! - **Lifecycle**: Metadata removed when files are deleted or processed
//!
//! ### 3. Session Management
//! - **Trace IDs**: Unique identifiers prevent session collision
//! - **Cleanup**: Explicit cleanup of DataFusion sessions prevents memory leaks
//!
//! ## Error Handling & Resilience
//!
//! ### 1. Non-Fatal Errors (Continue Processing)
//! - File read failures → Skip file, log warning
//! - Schema retrieval failures → Release files, continue with next batch
//! - Individual file deletion failures → Add to pending delete
//!
//! ### 2. Fatal Errors (Stop Processing)
//! - Storage upload failures → Abort entire merge operation
//! - Critical system failures → Propagate error up the chain
//!
//! ## Key Transformation Points for Streaming Model
//!
//! 1. **Replace Batch Channels** with streaming iterators or async streams
//! 2. **Eliminate File Grouping** in favor of individual file processing
//! 3. **Convert Worker Pool** to stream processing pipeline
//! 4. **Replace Periodic Scanning** with event-driven file watching
//! 5. **Modify State Management** from global HashSets to stream-local state

use std::{
    path::{Path, PathBuf},
    pin::Pin,
    sync::Arc,
    time::UNIX_EPOCH,
};

use arc_swap::ArcSwap;
use arrow_schema::Schema;
use bytes::Bytes;
use chrono::{Duration, Utc};
use config::{
    CONFIG, Config, RwHashMap, cluster, get_config,
    meta::{
        search::StorageType,
        stream::{FileKey, FileMeta, StreamType},
    },
    metrics,
    utils::{
        async_file::{FilterResult, batch_process_files, get_file_meta, get_file_size},
        parquet::{
            get_recordbatch_reader_from_bytes, read_metadata_from_file, read_schema_from_file,
        },
        schema_ext::SchemaExt,
    },
};
use futures::{FutureExt, Stream, StreamExt};
use hashbrown::{HashMap, HashSet};
use infra::{
    schema::{
        SchemaCache, get_stream_setting_bloom_filter_fields, get_stream_setting_fts_fields,
        get_stream_setting_index_fields,
    },
    storage,
};
use ingester::{WAL_PARQUET_METADATA, WalParquetMetadataTable};
use once_cell::sync::Lazy;
use tokio::{
    fs::remove_file,
    sync::{Mutex, RwLock},
};

use crate::{
    common::infra::wal::{self, SEARCHING_FILES, SearchingFileLocker},
    service::{
        db::{
            self,
            compact::retention::CACHE,
            file_list::local::{FILE_DELETION_MANAGER, FileDeletionManager},
        },
        schema::generate_schema_for_defined_schema_fields,
        search::datafusion::exec::{self, MergeParquetResult, TableBuilder},
        tantivy::create_tantivy_index,
    },
};

static PROCESSING_FILES: Lazy<RwLock<HashSet<String>>> = Lazy::new(|| RwLock::new(HashSet::new()));

pub struct ParquetFileManager {
    processing_files: RwLock<HashSet<String>>,

    config: Arc<ArcSwap<Config>>,
    file_deletion_manager: Arc<FileDeletionManager>,
    wal_parquet_metadata: Arc<WalParquetMetadataTable>,
    searching_files_lock: Arc<parking_lot::RwLock<SearchingFileLocker>>,
    compaction_cache: Arc<RwHashMap<String, i64>>,
    canonical_wal_dir: PathBuf,
}

impl ParquetFileManager {
    pub async fn run(&self) -> Result<(), anyhow::Error> {
        // start worker threads
        let wal_dir = self.canonical_wal_dir.clone();
        // add the pending delete files to processing set
        {
            let mut processing_files = self.processing_files.write().await;
            self.file_deletion_manager
                .list_pending_delete()
                .await
                .into_iter()
                .filter_map(|file| wal_path_to_prefix_and_partition_key(file, &wal_dir))
                .filter_map(|(file_key, _)| file_key.to_str().map(String::from))
                .for_each(|file_key| {
                    processing_files.insert(file_key);
                });
        }

        // prepare files
        loop {
            if cluster::is_offline() {
                break;
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(
                self.config.load().limit.file_push_interval,
            ))
            .await;

            // check pending delete files
            if let Err(e) = self.scan_pending_delete_files().await {
                log::error!("[INGESTER:JOB] Error scan pending delete files: {e}");
            }

            // scan wal files
            let mut streams = self.scan_wal_files().await;
            while let Some(batch) = streams.next().await {
                let prepared_stream =
                    batch.filter_map(|file_path| self.prepare_single_file(file_path));
            }
            // TODO: Deal with stream!
        }

        log::info!("[INGESTER:JOB] job::files::parquet is stopped");
        Ok(())
    }

    // check if the file is still in pending delete
    async fn scan_pending_delete_files(&self) -> Result<(), anyhow::Error> {
        let start = std::time::Instant::now();
        let cfg = get_config();

        let wal_dir = self.canonical_wal_dir.clone();

        let pending_delete_files = self.file_deletion_manager.list_pending_delete().await;
        let files_num = pending_delete_files.len();
        for (file_path, (file_key, _)) in pending_delete_files.into_iter().filter_map(|path| {
            Some(path.clone()).zip(wal_path_to_prefix_and_partition_key(path, &wal_dir))
        }) {
            if let Some(file_key_str) = file_key.to_str().map(String::from) {
                // If this file has a lock file - we skip
                if self.searching_files_lock.read().exist(&file_key_str) {
                    continue;
                }

                // If not, it is released and we can skip it
                log::warn!(
                    "[INGESTER:JOB] the file was released, delete it: {:?}",
                    file_key
                );

                #[cfg(not(test))]
                let Ok(file_size) = tokio::fs::metadata(&file_path).await.map(|f| f.len()) else {
                    // File was present in the pending_delete list but doesn't exist
                    continue;
                };

                // delete metadata from cache and file from disk
                // All these operations are independent and can be done without any causal ordering
                let _ = tokio::join!(
                    // Delete the file
                    async {
                        tokio::fs::remove_file(&file_path).await.inspect_err(|e| {
                            log::error!(
                                "[INGESTER:JOB] Failed to remove parquet file: {file_key_str}, {e}"
                            )
                        })
                    },
                    // Release the metadata locks
                    async {
                        self.wal_parquet_metadata
                            .write()
                            .await
                            .remove(&file_key_str)
                    },
                    // Release the processing locks
                    async { self.processing_files.write().await.remove(&file_key_str) },
                    // Release from the pending deletion list of locks
                    async {
                        self.file_deletion_manager
                            .dequeue_from_deletion(&file_key_str)
                            .await
                            .inspect_err(|e| {
                                log::error!(
                                    "[INGESTER:JOB] Failed to remove pending delete file: {file_key_str}, {e}",
                                );
                            })
                    }
                );

                #[cfg(not(test))]
                {
                    // deleted successfully then update metrics
                    // We need to account for wal_type/thread_id
                    let mut rel_path = file_key.components().skip(1);

                    if let (Some(org_id), Some(stream_type)) = (rel_path.next(), rel_path.next())
                        && let (Some(org_id), Some(stream_type)) = (
                            org_id.as_os_str().to_str(),
                            stream_type.as_os_str().to_str(),
                        )
                    {
                        metrics::INGEST_WAL_USED_BYTES
                            .with_label_values(&[org_id, stream_type])
                            .sub(file_size as i64);
                    } else {
                        log::error!(
                            "[INGESTER:JOB] Failed to generate metrics while completing scanning pending delete files. Path extraction failed."
                        )
                    }
                }
            }
        }

        if files_num > 0 {
            log::debug!(
                "[INGESTER:JOB] scan pending delete files total: {}, took: {} ms",
                files_num,
                start.elapsed().as_millis()
            );
        }
        Ok(())
    }

    async fn scan_wal_files(
        &self,
    ) -> Pin<Box<dyn Stream<Item = Pin<Box<dyn Stream<Item = PathBuf> + Send>>> + Send>> {
        let start = std::time::Instant::now();

        let wal_dir = self.canonical_wal_dir.clone();
        let pattern = wal_dir.join("files/");

        // Define batching predicate: batch files by hour-level directories
        let batching_predicate = |path: &std::path::Path| {
            let check = path
                .components()
                .skip_while(|c| c.as_os_str() != "files")
                .skip(8) // .../files/[org_id/stream_type/stream_id/thread_id/YY/MM/DD/HH]/*/wal.parquet
                .next() // HH
                .map(|_| true) // the hour component is in path -> we can batch!
                .unwrap_or_default();

            FilterResult::Static(check)
        };

        // Define filter predicate: allow directory traversal and only include .parquet files
        let filter_predicate = |path: &std::path::Path| {
            if path.is_dir() {
                // Allow directory traversal
                FilterResult::Static(true)
            } else if path.is_file() {
                // Only include .parquet files
                let result = path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("parquet"))
                    .unwrap_or(false);
                FilterResult::Static(result)
            } else {
                FilterResult::Static(false)
            }
        };

        // Use batch_process_files to get stream of streams
        batch_process_files(pattern.as_path(), batching_predicate, filter_predicate).await
    }

    /// Streaming version of prepare_files that processes individual files
    /// Returns (partition_key, file_key) pairs or None if file should be skipped
    async fn prepare_single_file(
        &self,
        file_path: std::path::PathBuf,
    ) -> Option<(PathBuf, FileKey)> {
        let (file_key, partition_key) =
            wal_path_to_prefix_and_partition_key(file_path.clone(), &self.canonical_wal_dir)?;

        let file_key_str = file_key.to_str().map(String::from)?;

        // Check if the file is already processing
        if self.processing_files.read().await.contains(&file_key_str) {
            return None;
        }

        // Get parquet metadata
        let parquet_meta = if let Some(meta) = self
            .wal_parquet_metadata
            .read()
            .await
            .get(file_key.to_str()?)
        {
            meta.clone()
        } else if let Ok(parquet_meta) = read_metadata_from_file(&file_path).await {
            parquet_meta
        } else {
            return None;
        };

        // Skip empty files
        if parquet_meta.eq(&FileMeta::default()) {
            log::warn!("[INGESTER:JOB] the file is empty, just delete file: {file_key_str}");
            let file_key_str = file_key.to_str().map(String::from)?;
            // delete metadata from cache
            self.wal_parquet_metadata
                .write()
                .await
                .remove(&file_key_str);
            // delete file from disk
            if let Err(e) = remove_file(&file_path).await {
                log::error!(
                    "[INGESTER:JOB] Failed to remove parquet file from disk: {file_key_str}, {e}"
                );
            }
            return None;
        }

        // Create FileKey
        let file_key_obj = FileKey::new(
            0,
            "".to_string(), // not needed here
            file_key_str.clone(),
            parquet_meta,
            false,
        );

        // Mark file as processing
        self.processing_files.write().await.insert(file_key_str);

        // [files/org_id/stream_type/stream_id/YY/MM/DD/HH/*]/wal.parquet
        Some((partition_key, file_key_obj))
    }
}

// TODO: Eventually this initialization will be moved into a global state manager
pub static PARQUET_FILE_MANAGER: Lazy<Arc<ParquetFileManager>> = Lazy::new(|| {
    Arc::new(ParquetFileManager {
        processing_files: Default::default(),
        config: CONFIG.clone(),
        file_deletion_manager: Default::default(),
        wal_parquet_metadata: Default::default(),
        searching_files_lock: SEARCHING_FILES.clone(),
        compaction_cache: CACHE.clone(),

        canonical_wal_dir: PathBuf::from(&get_config().common.data_wal_dir)
            .canonicalize()
            .expect("Critical config detail: wal_dir"),
    })
});

///////////////////////////////

// pub async fn run() -> Result<(), anyhow::Error> {
//     // add the pending delete files to processing set
//     let pending_delete_files = FILE_DELETION_MANAGER.list_pending_delete().await;
//     for file in pending_delete_files
//         .into_iter()
//         .filter_map(|f| f.to_str().map(|s| s.to_string()))
//     {
//         PROCESSING_FILES.write().await.insert(file);
//     }

//     // start worker threads
//     let cfg = get_config();
//     let (tx, rx) = tokio::sync::mpsc::channel::<(String, Vec<FileKey>)>(1);
//     let rx = Arc::new(Mutex::new(rx));
//     for thread_id in 0..cfg.limit.file_move_thread_num {
//         let rx = rx.clone();
//         tokio::spawn(async move {
//             loop {
//                 let ret = rx.lock().await.recv().await;
//                 match ret {
//                     None => {
//                         log::debug!("[INGESTER:JOB] Receiving files channel is closed");
//                         break;
//                     }
//                     Some((prefix, files)) => {
//                         if let Err(e) = move_files(thread_id, &prefix, files).await {
//                             log::error!("[INGESTER:JOB] Error moving parquet files to remote:
// {e}");                         }
//                     }
//                 }
//             }
//         });
//     }

//     // prepare files
//     loop {
//         if cluster::is_offline() {
//             break;
//         }
//         tokio::time::sleep(tokio::time::Duration::from_secs(
//             get_config().limit.file_push_interval,
//         ))
//         .await;
//         // check pending delete files
//         if let Err(e) = scan_pending_delete_files().await {
//             log::error!("[INGESTER:JOB] Error scan pending delete files: {e}");
//         }
//         // scan wal files
//         if let Err(e) = scan_wal_files(tx.clone()).await {
//             log::error!("[INGESTER:JOB] Error prepare parquet files: {e}");
//         }
//     }
//     log::info!("[INGESTER:JOB] job::files::parquet is stopped");
//     Ok(())
// }

// // check if the file is still in pending delete
// async fn scan_pending_delete_files() -> Result<(), anyhow::Error> {
//     let start = std::time::Instant::now();
//     let cfg = get_config();

//     let wal_dir = Path::new(&cfg.common.data_wal_dir).canonicalize().unwrap();
//     let pending_delete_files = FILE_DELETION_MANAGER.list_pending_delete().await;
//     let files_num = pending_delete_files.len();
//     for file_key in pending_delete_files
//         .into_iter()
//         .filter_map(|f| f.to_str().map(String::from))
//     {
//         if wal::lock_files_exists(&file_key) {
//             continue;
//         }
//         log::warn!("[INGESTER:JOB] the file was released, delete it: {file_key}");
//         let file = wal_dir.join(&file_key);
//         let Ok(file_size) = get_file_size(&file).await else {
//             continue;
//         };
//         // delete metadata from cache
//         WAL_PARQUET_METADATA.write().await.remove(&file_key);
//         // delete file from disk
//         if let Err(e) = remove_file(&file).await {
//             log::error!("[INGESTER:JOB] Failed to remove parquet file: {file_key}, {e}");
//         }
//         // need release the file
//         PROCESSING_FILES.write().await.remove(&file_key);
//         // delete from pending delete list
//         if let Err(e) = FILE_DELETION_MANAGER.dequeue_from_deletion(&file_key).await {
//             log::error!("[INGESTER:JOB] Failed to remove pending delete file: {file_key}, {e}");
//         }
//         // deleted successfully then update metrics
//         let (org_id, stream_type, ..) = split_perfix(&file_key);
//         metrics::INGEST_WAL_USED_BYTES
//             .with_label_values(&[org_id.as_str(), stream_type.as_str()])
//             .sub(file_size as i64);
//     }

//     if files_num > 0 {
//         log::debug!(
//             "[INGESTER:JOB] scan pending delete files total: {}, took: {} ms",
//             files_num,
//             start.elapsed().as_millis()
//         );
//     }
//     Ok(())
// }

/// # Streaming WAL Files Scanner
///
/// ## Execution Plan
///
/// This is a streaming variant of `scan_wal_files` that processes files individually through
/// a continuous stream pipeline instead of batching them first.
///
/// ### Stream Processing Pipeline
/// ```
/// [Directory Walker] -> [Filter Parquet] -> [Process Individual] -> [Group by Prefix] -> [Send to Workers]
///        |                     |                    |                     |                   |
///   [WalkDir Stream]    [Extension Filter]   [prepare_single_file]  [Batch Accumulator]  [Worker Channel]
/// ```
///
/// ### Key Design Decisions
/// - **Filter Function**: Check for `.parquet` extension and exclude files already being processed
/// - **Process Function**: Transform individual PathBuf to FileKey (extracted from prepare_files
///   logic)
/// - **Batching Strategy**: Accumulate files by prefix before sending to workers for compatibility
/// - **Limit Handling**: Apply file limit at stream level using `take(limit)`
/// - **Error Handling**: Continue processing on individual file errors, log and skip
///
/// ### Stream State Management
/// - **Prefix Grouping**: Internal HashMap groups files by prefix as they stream through
/// - **Batch Flushing**: Send accumulated batches when prefix changes or stream ends
/// - **Backpressure**: Leverages existing channel backpressure mechanism
///
/// ### Integration Points
/// - **Worker Channel**: Reuses existing `tokio::sync::mpsc::Sender<(String, Vec<FileKey>)>`
/// - **Configuration**: Same config limits (`file_push_limit`, `data_wal_dir`)
/// - **Metrics**: Maintains same logging and timing metrics as original function

// async fn prepare_files(files: Vec<String>) -> Result<HashMap<String, Vec<FileKey>>,
// anyhow::Error> {     let cfg = get_config();
//     let wal_dir = Path::new(&cfg.common.data_wal_dir).canonicalize().unwrap();

//     // do partition by partition key
//     let mut partition_files_with_size: HashMap<String, Vec<FileKey>> = HashMap::new();
//     for file in files {
//         let file_key = {
//             let file = match Path::new(&file).canonicalize() {
//                 Ok(v) => v,
//                 Err(_) => {
//                     continue;
//                 }
//             };
//             let file = match file.strip_prefix(&wal_dir) {
//                 Ok(v) => v,
//                 Err(_) => {
//                     continue;
//                 }
//             };
//             file.to_str().unwrap().replace('\\', "/")
//         };
//         // check if the file is processing
//         if PROCESSING_FILES.read().await.contains(&file_key) {
//             continue;
//         }

//         let parquet_meta = if let Some(meta) = WAL_PARQUET_METADATA.read().await.get(&file_key) {
//             meta.clone()
//         } else if let Ok(parquet_meta) = read_metadata_from_file(&(&file).into()).await {
//             parquet_meta
//         } else {
//             continue;
//         };
//         if parquet_meta.eq(&FileMeta::default()) {
//             log::warn!("[INGESTER:JOB] the file is empty, just delete file: {file}");
//             // delete metadata from cache
//             WAL_PARQUET_METADATA.write().await.remove(&file_key);
//             // delete file from disk
//             if let Err(e) = remove_file(wal_dir.join(&file)).await {
//                 log::error!("[INGESTER:JOB] Failed to remove parquet file from disk: {file},
// {e}");             }
//             continue;
//         }
//         let prefix = file_key[..file_key.rfind('/').unwrap()].to_string();
//         // remove thread_id from prefix
//         // eg: files/default/logs/olympics/0/2023/08/21/08/8b8a5451bbe1c44b/
//         let mut columns = prefix.split('/').collect::<Vec<&str>>();
//         columns.remove(4);
//         let prefix = columns.join("/");
//         let partition = partition_files_with_size.entry(prefix).or_default();
//         partition.push(FileKey::new(
//             0,
//             "".to_string(), // here we don't need it
//             file_key.clone(),
//             parquet_meta,
//             false,
//         ));
//         // mark the file as processing
//         PROCESSING_FILES.write().await.insert(file_key);
//     }

//     Ok(partition_files_with_size)
// }

async fn move_files(
    thread_id: usize,
    prefix: &str,
    files: Vec<FileKey>,
) -> Result<(), anyhow::Error> {
    if files.is_empty() {
        return Ok(());
    }

    let cfg = get_config();
    let wal_dir = Path::new(&cfg.common.data_wal_dir).canonicalize().unwrap();
    let (org_id, stream_type, stream_name, prefix_date) = split_perfix(prefix);

    // check if we are allowed to ingest or just delete the file
    if db::compact::retention::is_deleting_stream(&org_id, stream_type, &stream_name, None) {
        for file in files {
            log::warn!(
                "[INGESTER:JOB:{thread_id}] the stream [{}/{}/{}] is deleting, just delete file: {}",
                &org_id,
                stream_type,
                &stream_name,
                file.key,
            );
            // delete metadata from cache
            WAL_PARQUET_METADATA.write().await.remove(&file.key);
            // delete file from disk
            if let Err(e) = remove_file(wal_dir.join(&file.key)).await {
                log::error!(
                    "[INGESTER:JOB:{thread_id}] Failed to remove parquet file from disk: {}, {}",
                    file.key,
                    e
                );
            }
            // remove the file from processing set
            PROCESSING_FILES.write().await.remove(&file.key);
        }
        return Ok(());
    }

    // get latest schema
    let latest_schema = match infra::schema::get(&org_id, &stream_name, stream_type).await {
        Ok(schema) => Arc::new(schema),
        Err(e) => {
            log::error!(
                "[INGESTER:JOB:{thread_id}] Failed to get latest schema for stream [{}/{}/{}]: {}",
                &org_id,
                stream_type,
                &stream_name,
                e
            );
            // need release all the files
            for file in files.iter() {
                PROCESSING_FILES.write().await.remove(&file.key);
            }
            return Err(e.into());
        }
    };
    let stream_fields_num = latest_schema.fields().len();

    // check stream is existing
    if stream_fields_num == 0 {
        for file in files {
            log::warn!(
                "[INGESTER:JOB:{thread_id}] the stream [{}/{}/{}] was deleted, just delete file: {}",
                &org_id,
                stream_type,
                &stream_name,
                file.key,
            );
            // delete metadata from cache
            WAL_PARQUET_METADATA.write().await.remove(&file.key);
            // delete file from disk
            if let Err(e) = remove_file(wal_dir.join(&file.key)).await {
                log::error!(
                    "[INGESTER:JOB:{thread_id}] Failed to remove parquet file from disk: {}, {}",
                    file.key,
                    e
                );
            }
            // remove the file from processing set
            PROCESSING_FILES.write().await.remove(&file.key);
        }
        return Ok(());
    }

    // check data retention
    let stream_settings = infra::schema::unwrap_stream_settings(&latest_schema).unwrap_or_default();
    let mut stream_data_retention_days = cfg.compact.data_retention_days;
    if stream_settings.data_retention > 0 {
        stream_data_retention_days = stream_settings.data_retention;
    }
    let num_uds_fields = stream_settings.defined_schema_fields.len();

    let stream_fields_num = if num_uds_fields > 0 {
        num_uds_fields
    } else {
        stream_fields_num
    };
    if stream_data_retention_days > 0 {
        let date =
            config::utils::time::now() - Duration::try_days(stream_data_retention_days).unwrap();
        let stream_data_retention_end = date.format("%Y-%m-%d").to_string();
        if prefix_date < stream_data_retention_end {
            for file in files {
                log::warn!(
                    "[INGESTER:JOB:{thread_id}] the file [{}/{}/{}] was exceed the data retention, just delete file: {}",
                    &org_id,
                    stream_type,
                    &stream_name,
                    file.key,
                );
                // delete metadata from cache
                WAL_PARQUET_METADATA.write().await.remove(&file.key);
                // delete file from disk
                if let Err(e) = remove_file(wal_dir.join(&file.key)).await {
                    log::error!(
                        "[INGESTER:JOB:{thread_id}] Failed to remove parquet file from disk: {}, {}",
                        file.key,
                        e
                    );
                }
                // remove the file from processing set
                PROCESSING_FILES.write().await.remove(&file.key);
            }
            return Ok(());
        }
    }

    // log::debug!("[INGESTER:JOB:{thread_id}] start processing for partition: {}", prefix);

    let wal_dir = wal_dir.clone();
    // sort by created time
    let mut files_with_size = files.to_owned();
    files_with_size.sort_by(|a, b| a.meta.min_ts.cmp(&b.meta.min_ts));
    // check the total size
    let total_original_size: i64 = files_with_size
        .iter()
        .map(|f| f.meta.original_size)
        .sum::<i64>();
    if total_original_size
        < std::cmp::min(
            cfg.limit.max_file_size_on_disk as i64,
            cfg.compact.max_file_size as i64,
        )
        && (cfg.limit.file_move_fields_limit == 0
            || stream_fields_num < cfg.limit.file_move_fields_limit)
    {
        let mut has_expired_files = false;
        // not enough files to upload, check if some files are too old
        let min_ts = Utc::now().timestamp_micros()
            - Duration::try_seconds(cfg.limit.max_file_retention_time as i64)
                .unwrap()
                .num_microseconds()
                .unwrap();
        for file in files_with_size.iter() {
            let Ok(file_meta) = get_file_meta(&wal_dir.join(&file.key)).await else {
                continue;
            };
            let file_created = file_meta
                .created()
                .unwrap_or(UNIX_EPOCH)
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_micros() as i64;
            if file_created <= min_ts {
                has_expired_files = true;
                break;
            }
        }
        if !has_expired_files {
            // need release all the files
            for file in files_with_size.iter() {
                PROCESSING_FILES.write().await.remove(&file.key);
            }
            return Ok(());
        }
    }

    // log::debug!(
    //     "[INGESTER:JOB:{thread_id}] start merging for partition: {}",
    //     prefix
    // );

    // start merge files and upload to s3
    loop {
        // yield to other tasks
        tokio::task::yield_now().await;
        // merge file and get the big file key
        let (account, new_file_name, new_file_meta, new_file_list) = match merge_files(
            thread_id,
            latest_schema.clone(),
            &wal_dir,
            &files_with_size,
            num_uds_fields,
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                log::error!("[INGESTER:JOB] merge files failed: {e}");
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                continue;
            }
        };
        if new_file_name.is_empty() {
            if new_file_list.is_empty() {
                // no file need to merge
                break;
            } else {
                // delete files from file_list and continue
                files_with_size.retain(|f| !&new_file_list.contains(f));
                continue;
            }
        }

        // write file list to storage
        if let Err(e) =
            db::file_list::set(&account, &new_file_name, Some(new_file_meta), false).await
        {
            log::error!(
                "[INGESTER:JOB] Failed write parquet file meta: {new_file_name}, error: {e}"
            );
            // need release all the files
            for file in files_with_size.iter() {
                PROCESSING_FILES.write().await.remove(&file.key);
            }
            return Ok(());
        };

        // check if allowed to delete the file
        for file in new_file_list.iter() {
            let can_delete = if wal::lock_files_exists(&file.key) {
                log::warn!(
                    "[INGESTER:JOB:{thread_id}] the file is in use, set to pending delete list: {}",
                    file.key
                );
                // add to pending delete list
                if let Err(e) = FILE_DELETION_MANAGER
                    .queue_for_deletion(&org_id, &file.account, &file.key)
                    .await
                {
                    log::error!(
                        "[INGESTER:JOB:{thread_id}] Failed to add pending delete file: {}, {}",
                        file.key,
                        e
                    );
                }
                false
            } else {
                FILE_DELETION_MANAGER.start_removing(&file.key).await?;
                true
            };

            if can_delete {
                // delete metadata from cache
                WAL_PARQUET_METADATA.write().await.remove(&file.key);
                // delete file from disk
                match remove_file(wal_dir.join(&file.key)).await {
                    Err(e) => {
                        log::warn!(
                            "[INGESTER:JOB:{thread_id}] Failed to remove parquet file from disk, set to pending delete list: {}, {}",
                            file.key,
                            e
                        );
                        // add to pending delete list
                        if let Err(e) = FILE_DELETION_MANAGER
                            .queue_for_deletion(&org_id, &file.account, &file.key)
                            .await
                        {
                            log::error!(
                                "[INGESTER:JOB:{thread_id}] Failed to add pending delete file: {}, {}",
                                file.key,
                                e
                            );
                        }
                    }
                    Ok(_) => {
                        // remove the file from processing set
                        PROCESSING_FILES.write().await.remove(&file.key);
                        // deleted successfully then update metrics
                        metrics::INGEST_WAL_USED_BYTES
                            .with_label_values(&[org_id.as_str(), stream_type.as_str()])
                            .sub(file.meta.compressed_size);
                    }
                }

                // remove the file from removing set
                FILE_DELETION_MANAGER.complete_removal(&file.key).await?;
            }

            // metrics
            metrics::INGEST_WAL_READ_BYTES
                .with_label_values(&[org_id.as_str(), stream_type.as_str()])
                .inc_by(file.meta.compressed_size as u64);
        }

        // delete files from file list
        let new_file_list = new_file_list.iter().map(|f| &f.key).collect::<Vec<_>>();
        files_with_size.retain(|f| !new_file_list.contains(&&f.key));
    }

    Ok(())
}

/// merge some small files into one big file, upload to storage, returns the big
/// file key and merged files
async fn merge_files(
    thread_id: usize,
    latest_schema: Arc<Schema>,
    wal_dir: &Path,
    files_with_size: &[FileKey],
    num_uds_fields: usize,
) -> Result<(String, String, FileMeta, Vec<FileKey>), anyhow::Error> {
    if files_with_size.is_empty() {
        return Ok((
            String::from(""),
            String::from(""),
            FileMeta::default(),
            Vec::new(),
        ));
    }

    let cfg = get_config();
    let mut new_file_size: i64 = 0;
    let mut new_compressed_file_size = 0;
    let mut new_file_list = Vec::new();
    let stream_fields_num = if num_uds_fields > 0 {
        num_uds_fields
    } else {
        latest_schema.fields().len()
    };
    let max_file_size = std::cmp::min(
        cfg.limit.max_file_size_on_disk as i64,
        cfg.compact.max_file_size as i64,
    );
    for file in files_with_size.iter() {
        if new_file_size > 0
            && (new_file_size + file.meta.original_size > max_file_size
                || new_compressed_file_size + file.meta.compressed_size > max_file_size
                || (cfg.limit.file_move_fields_limit > 0
                    && stream_fields_num >= cfg.limit.file_move_fields_limit))
        {
            break;
        }
        new_file_size += file.meta.original_size;
        new_compressed_file_size += file.meta.compressed_size;
        new_file_list.push(file.clone());
        log::info!("[INGESTER:JOB:{thread_id}] merge small file: {}", &file.key);
    }
    // no files need to merge
    if new_file_list.is_empty() {
        return Ok((
            String::from(""),
            String::from(""),
            FileMeta::default(),
            Vec::new(),
        ));
    }

    let retain_file_list = new_file_list.clone();

    // get time range for these files
    let min_ts = new_file_list.iter().map(|f| f.meta.min_ts).min().unwrap();
    let max_ts = new_file_list.iter().map(|f| f.meta.max_ts).max().unwrap();
    let total_records = new_file_list.iter().map(|f| f.meta.records).sum();
    let new_file_size = new_file_list.iter().map(|f| f.meta.original_size).sum();
    let mut new_file_meta = FileMeta {
        min_ts,
        max_ts,
        records: total_records,
        original_size: new_file_size,
        compressed_size: 0,
        flattened: false,
        index_size: 0,
    };
    if new_file_meta.records == 0 {
        return Err(anyhow::anyhow!("merge_files error: records is 0"));
    }

    // eg: files/default/logs/olympics/0/2023/08/21/08/8b8a5451bbe1c44b/7099303408192061440f3XQ2p.
    // parquet eg: files/default/traces/default/2/2023/09/04/05/default/service_name=ingester/
    // 7104328279989026816guOA4t.parquet let _ = columns[0].to_string(); // files/
    let file = new_file_list.first().unwrap();
    let columns = file.key.splitn(5, '/').collect::<Vec<&str>>();
    let org_id = columns[1].to_string();
    let stream_type = StreamType::from(columns[2]);
    let stream_name = columns[3].to_string();
    let file_name = columns[4].to_string();

    // get latest version of schema
    let stream_settings = infra::schema::unwrap_stream_settings(&latest_schema);
    let bloom_filter_fields = get_stream_setting_bloom_filter_fields(&stream_settings);
    let full_text_search_fields = get_stream_setting_fts_fields(&stream_settings);
    let index_fields = get_stream_setting_index_fields(&stream_settings);
    let (defined_schema_fields, need_original, index_original_data, index_all_values) =
        match stream_settings {
            Some(s) => (
                s.defined_schema_fields,
                s.store_original_data,
                s.index_original_data,
                s.index_all_values,
            ),
            None => (Vec::new(), false, false, false),
        };
    let latest_schema = if !defined_schema_fields.is_empty() {
        let latest_schema = SchemaCache::new(latest_schema.as_ref().clone());
        let latest_schema = generate_schema_for_defined_schema_fields(
            &latest_schema,
            &defined_schema_fields,
            need_original,
            index_original_data,
            index_all_values,
        );
        latest_schema.schema().clone()
    } else {
        latest_schema.clone()
    };

    // we shouldn't use the latest schema, because there are too many fields, we need read schema
    // from files only get the fields what we need
    let mut shared_fields = HashSet::new();
    for file in new_file_list.iter() {
        let file_schema = read_schema_from_file(&(&wal_dir.join(&file.key)).into()).await?;
        shared_fields.extend(file_schema.fields().iter().cloned());
    }
    // use the shared fields to create a new schema and with empty metadata
    let mut fields = shared_fields.into_iter().collect::<Vec<_>>();
    fields.sort_by(|a, b| a.name().cmp(b.name()));
    fields.dedup_by(|a, b| a.name() == b.name());
    let schema = Arc::new(Schema::new(fields));
    let schema_key = schema.hash_key();

    // generate datafusion tables
    let trace_id = config::ider::generate();
    let session = config::meta::search::Session {
        id: format!("{trace_id}-{schema_key}"),
        storage_type: StorageType::Wal,
        work_group: None,
        target_partitions: 0,
    };
    let rules = hashbrown::HashMap::new();
    let table = TableBuilder::new()
        .rules(rules)
        .sorted_by_time(true)
        .build(session, &new_file_list, schema.clone())
        .await?;
    let tables = vec![table];

    let start = std::time::Instant::now();
    let merge_result = exec::merge_parquet_files(
        stream_type,
        &stream_name,
        schema,
        tables,
        &bloom_filter_fields,
        &new_file_meta,
        true,
    )
    .await;

    // clear session data
    crate::service::search::datafusion::storage::file_list::clear(&trace_id);

    let (_new_schema, buf) = match merge_result {
        Ok(v) => v,
        Err(e) => {
            log::error!(
                "[INGESTER:JOB:{thread_id}] merge_parquet_files error for stream: {org_id}/{stream_type}/{stream_name}, err: {e}"
            );
            log::error!(
                "[INGESTER:JOB:{thread_id}] merge_parquet_files error for files: {retain_file_list:?}"
            );
            return Err(e.into());
        }
    };

    // ingester should not support multiple files
    // multiple files is for downsampling that will be handled in compactor
    let buf = match buf {
        MergeParquetResult::Single(v) => v,
        MergeParquetResult::Multiple { .. } => {
            panic!("[INGESTER:JOB] merge_parquet_files error: multiple files");
        }
    };

    new_file_meta.compressed_size = buf.len() as i64;
    if new_file_meta.compressed_size == 0 {
        return Err(anyhow::anyhow!(
            "merge_parquet_files error: compressed_size is 0"
        ));
    }
    let new_file_key =
        super::generate_storage_file_name(&org_id, stream_type, &stream_name, &file_name);
    log::info!(
        "[INGESTER:JOB:{thread_id}] merged {} files into a new file: {}, original_size: {}, compressed_size: {}, took: {} ms",
        retain_file_list.len(),
        new_file_key,
        new_file_meta.original_size,
        new_file_meta.compressed_size,
        start.elapsed().as_millis(),
    );

    // upload file
    let buf = Bytes::from(buf);
    if cfg.cache_latest_files.enabled
        && cfg.cache_latest_files.cache_parquet
        && cfg.cache_latest_files.download_from_node
    {
        infra::cache::file_data::disk::set(&new_file_key, buf.clone()).await?;
        log::debug!("merge_files {new_file_key} file_data::disk::set success");
    }

    let account = storage::get_account(&new_file_key).unwrap_or_default();
    storage::put(&account, &new_file_key, buf.clone()).await?;

    // skip index generation if not enabled or not supported by stream type
    if !cfg.common.inverted_index_enabled || !stream_type.support_index() {
        return Ok((account, new_file_key, new_file_meta, retain_file_list));
    }

    // skip index generation if no fields to index
    let latest_schema_fields = latest_schema
        .fields()
        .iter()
        .map(|f| f.name())
        .collect::<HashSet<_>>();
    let need_index = full_text_search_fields
        .iter()
        .chain(index_fields.iter())
        .any(|f| latest_schema_fields.contains(f));
    if !need_index {
        log::debug!("skip index generation for stream: {org_id}/{stream_type}/{stream_name}");
        return Ok((account, new_file_key, new_file_meta, retain_file_list));
    }

    // generate tantivy inverted index and write to storage
    let (schema, reader) = get_recordbatch_reader_from_bytes(&buf).await?;
    let index_size = create_tantivy_index(
        "INGESTER",
        &new_file_key,
        &full_text_search_fields,
        &index_fields,
        schema,
        reader,
    )
    .await
    .map_err(|e| anyhow::anyhow!("generate_tantivy_index_on_ingester error: {}", e))?;
    new_file_meta.index_size = index_size as i64;

    Ok((account, new_file_key, new_file_meta, retain_file_list))
}

fn split_perfix(prefix: &str) -> (String, StreamType, String, String) {
    let columns = prefix.split('/').collect::<Vec<&str>>();
    // removed thread_id from prefix, so there is no thread_id in the path
    // eg: files/default/logs/olympics/2023/08/21/08/8b8a5451bbe1c44b/
    // eg: files/default/traces/default/2023/09/04/05/default/service_name=ingester/
    // let _ = columns[0].to_string(); // files/
    let org_id = columns[1].to_string();
    let stream_type = StreamType::from(columns[2]);
    let stream_name = columns[3].to_string();
    let prefix_date = format!("{}-{}-{}", columns[4], columns[5], columns[6]);
    (org_id, stream_type, stream_name, prefix_date)
}

pub fn wal_path_to_prefix_and_partition_key(
    canonical_path: PathBuf,
    prefix: impl AsRef<Path>,
) -> Option<(PathBuf, PathBuf)> {
    let stripped_path = canonical_path.strip_prefix(prefix).ok().map(PathBuf::from);

    let partition_key = stripped_path.as_ref().map(|path| {
        // files/org_id/stream_type/stream_id/thread_id/YY/MM/DD/HH/*/wal.parquet
        path.components()
            .enumerate()
            .filter_map(|(i, c)| if 4 == i { None } else { Some(c) })
            .collect()
    });

    stripped_path.zip(partition_key)
}
