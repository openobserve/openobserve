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

use std::{path::Path, sync::Arc, time::UNIX_EPOCH};

use arrow_schema::Schema;
use bytes::Bytes;
use chrono::{Duration, Utc};
use config::{
    FxIndexMap, cluster, get_config,
    meta::{
        search::StorageType,
        stream::{FileKey, FileMeta, StreamType},
    },
    metrics,
    utils::{
        async_file::{get_file_meta, get_file_size},
        file::scan_files_with_channel,
        parquet::{
            get_recordbatch_reader_from_bytes, read_metadata_from_file, read_schema_from_file,
        },
        schema_ext::SchemaExt,
    },
};
use hashbrown::HashSet;
use infra::{
    schema::{
        SchemaCache, get_stream_setting_bloom_filter_fields, get_stream_setting_fts_fields,
        get_stream_setting_index_fields,
    },
    storage,
};
use ingester::WAL_PARQUET_METADATA;
use once_cell::sync::Lazy;
use tokio::{
    fs::remove_file,
    sync::{Mutex, RwLock},
};

use crate::{
    common::infra::wal,
    service::{
        db,
        schema::generate_schema_for_defined_schema_fields,
        search::datafusion::exec::{self, MergeParquetResult, TableBuilder},
        tantivy::create_tantivy_index,
    },
};

static PROCESSING_FILES: Lazy<RwLock<HashSet<String>>> = Lazy::new(|| RwLock::new(HashSet::new()));

pub async fn run() -> Result<(), anyhow::Error> {
    // add the pending delete files to processing set
    let pending_delete_files = db::file_list::local::get_pending_delete().await;
    for file in pending_delete_files {
        PROCESSING_FILES.write().await.insert(file);
    }

    // start worker threads
    let cfg = get_config();
    let (tx, rx) = tokio::sync::mpsc::channel::<(String, Vec<FileKey>)>(1);
    let rx = Arc::new(Mutex::new(rx));
    for thread_id in 0..cfg.limit.file_move_thread_num {
        let rx = rx.clone();
        tokio::spawn(async move {
            loop {
                let ret = rx.lock().await.recv().await;
                match ret {
                    None => {
                        log::debug!("[INGESTER:JOB] Receiving files channel is closed");
                        break;
                    }
                    Some((prefix, files)) => {
                        if let Err(e) = move_files(thread_id, &prefix, files).await {
                            log::error!("[INGESTER:JOB] Error moving parquet files to remote: {e}");
                        }
                    }
                }
            }
        });
    }

    // prepare files
    #[cfg(feature = "enterprise")]
    let mut drain_backoff_ms = 50u64; // Start with 50ms backoff
    loop {
        #[cfg(feature = "enterprise")]
        // Check if we're in draining mode - if so, skip sleep and process immediately
        let is_draining = o2_enterprise::enterprise::drain::is_draining();

        #[cfg(feature = "enterprise")]
        if !is_draining {
            // Normal operation: sleep between scans
            if cluster::is_offline() {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(
                get_config().limit.file_push_interval,
            ))
            .await;
        } else {
            log::info!("[INGESTER:JOB] Draining mode active, processing files immediately");
        }

        #[cfg(not(feature = "enterprise"))]
        {
            // Normal operation: sleep between scans
            if cluster::is_offline() {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(
                get_config().limit.file_push_interval,
            ))
            .await;
        }

        // check pending delete files
        if let Err(e) = scan_pending_delete_files().await {
            log::error!("[INGESTER:JOB] Error scan pending delete files: {e}");
        }
        // scan wal files
        if let Err(e) = scan_wal_files(tx.clone()).await {
            log::error!("[INGESTER:JOB] Error prepare parquet files: {e}");
        }

        #[cfg(feature = "enterprise")]
        {
            // If draining and no more files to process, we can exit
            if is_draining {
                // Check if there are any remaining files to process
                let processing_count = PROCESSING_FILES.read().await.len();
                let has_pending_files =
                    o2_enterprise::enterprise::drain::parquet::check_has_pending_files(
                        processing_count,
                    )
                    .await;
                if !has_pending_files {
                    log::info!("[INGESTER:JOB] Draining complete, all files uploaded to S3");
                    break;
                } else {
                    // Backoff to avoid tight loop while draining
                    tokio::time::sleep(tokio::time::Duration::from_millis(drain_backoff_ms)).await;
                    // Exponential backoff up to 1 second
                    drain_backoff_ms = (drain_backoff_ms * 2).min(1000);
                }
            }
        }
    }
    log::info!("[INGESTER:JOB] job::files::parquet is stopped");
    Ok(())
}

// check if the file is still in pending delete
async fn scan_pending_delete_files() -> Result<(), anyhow::Error> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let wal_dir = Path::new(&cfg.common.data_wal_dir).canonicalize().unwrap();
    let pending_delete_files = db::file_list::local::get_pending_delete().await;
    let files_num = pending_delete_files.len();
    for file_key in pending_delete_files {
        if wal::lock_files_exists(&file_key) {
            continue;
        }
        log::warn!("[INGESTER:JOB] the file was released, delete it: {file_key}");
        let file = wal_dir.join(&file_key);
        let Ok(file_size) = get_file_size(&file).await else {
            continue;
        };
        // delete metadata from cache
        WAL_PARQUET_METADATA.write().await.remove(&file_key);
        // delete file from disk
        if let Err(e) = remove_file(&file).await {
            log::error!("[INGESTER:JOB] Failed to remove parquet file: {file_key}, {e}");
        }
        // need release the file
        PROCESSING_FILES.write().await.remove(&file_key);
        // delete from pending delete list
        if let Err(e) = db::file_list::local::remove_pending_delete(&file_key).await {
            log::error!("[INGESTER:JOB] Failed to remove pending delete file: {file_key}, {e}");
        }
        // deleted successfully then update metrics
        let (org_id, stream_type, ..) = split_perfix(&file_key);
        metrics::INGEST_WAL_USED_BYTES
            .with_label_values(&[org_id.as_str(), stream_type.as_str()])
            .sub(file_size as i64);
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
    worker_tx: tokio::sync::mpsc::Sender<(String, Vec<FileKey>)>,
) -> Result<(), anyhow::Error> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let wal_dir = Path::new(&cfg.common.data_wal_dir).canonicalize().unwrap();
    let pattern = wal_dir.join("files/");

    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<String>>(1);
    tokio::spawn(async move {
        if let Err(e) = scan_files_with_channel(
            pattern.as_path(),
            "parquet",
            Some(cfg.limit.file_push_limit),
            tx,
        )
        .await
            && !e.to_string().contains("No such file or directory")
        {
            log::error!("[INGESTER:JOB] Failed to scan files: {e}");
        }
    });
    let mut files_num = 0;
    // let mut last_time = start.elapsed().as_millis();
    loop {
        match rx.recv().await {
            None => {
                break;
            }
            Some(files) => {
                // log::debug!(
                //     "[INGESTER:JOB] scan files get batch: {}, took: {} ms",
                //     files.len(),
                //     start.elapsed().as_millis() - last_time
                // );
                // last_time = start.elapsed().as_millis();
                files_num += files.len();
                match prepare_files(files).await {
                    Err(e) => {
                        log::error!("[INGESTER:JOB] Error prepare parquet files: {e}");
                    }
                    Ok(files) => {
                        for (prefix, files) in files.into_iter() {
                            if let Err(e) = worker_tx.send((prefix, files)).await {
                                log::error!(
                                    "[INGESTER:JOB] Error sending parquet files to move: {e}"
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    if files_num > 0 {
        log::debug!(
            "[INGESTER:JOB] scan files get total: {}, took: {} ms",
            files_num,
            start.elapsed().as_millis()
        );
    }
    Ok(())
}

async fn prepare_files(
    files: Vec<String>,
) -> Result<FxIndexMap<String, Vec<FileKey>>, anyhow::Error> {
    let cfg = get_config();
    let wal_dir = Path::new(&cfg.common.data_wal_dir).canonicalize().unwrap();

    // do partition by partition key
    let mut partition_files_with_size: FxIndexMap<String, Vec<FileKey>> = FxIndexMap::default();
    for file in files {
        let file_key = {
            let file = match Path::new(&file).canonicalize() {
                Ok(v) => v,
                Err(_) => {
                    continue;
                }
            };
            let file = match file.strip_prefix(&wal_dir) {
                Ok(v) => v,
                Err(_) => {
                    continue;
                }
            };
            file.to_str().unwrap().replace('\\', "/")
        };
        // check if the file is processing
        if PROCESSING_FILES.read().await.contains(&file_key) {
            continue;
        }

        let parquet_meta = if let Some(meta) = WAL_PARQUET_METADATA.read().await.get(&file_key) {
            meta.clone()
        } else if let Ok(parquet_meta) = read_metadata_from_file(&(&file).into()).await {
            parquet_meta
        } else {
            continue;
        };
        if parquet_meta.eq(&FileMeta::default()) {
            log::warn!("[INGESTER:JOB] the file is empty, just delete file: {file}");
            // delete metadata from cache
            WAL_PARQUET_METADATA.write().await.remove(&file_key);
            // delete file from disk
            if let Err(e) = remove_file(wal_dir.join(&file)).await {
                log::error!("[INGESTER:JOB] Failed to remove parquet file from disk: {file}, {e}");
            }
            continue;
        }
        let prefix = file_key[..file_key.rfind('/').unwrap()].to_string();
        // remove thread_id from prefix
        // eg: files/default/logs/olympics/0/2023/08/21/08/8b8a5451bbe1c44b/
        let mut columns = prefix.split('/').collect::<Vec<&str>>();
        columns.remove(4);
        let prefix = columns.join("/");
        let partition = partition_files_with_size.entry(prefix).or_default();
        partition.push(FileKey::new(
            0,
            "".to_string(), // here we don't need it
            file_key.clone(),
            parquet_meta,
            false,
        ));
        // mark the file as processing
        PROCESSING_FILES.write().await.insert(file_key);
    }

    Ok(partition_files_with_size)
}

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
                if let Err(e) =
                    db::file_list::local::add_pending_delete(&org_id, &file.account, &file.key)
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
                db::file_list::local::add_removing(&file.key).await?;
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
                        if let Err(e) = db::file_list::local::add_pending_delete(
                            &org_id,
                            &file.account,
                            &file.key,
                        )
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
                db::file_list::local::remove_removing(&file.key).await?;
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
    #[cfg(feature = "enterprise")]
    let log_patterns_enabled =
        infra::schema::get_stream_setting_log_patterns_enabled(&stream_settings);
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
            stream_type,
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
    let table = TableBuilder::new()
        .sorted_by_time(true)
        .build(session, new_file_list, schema.clone())
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

    // Enterprise: Extract patterns from merged parquet (ingester nodes only)
    #[cfg(feature = "enterprise")]
    {
        use config::cluster::LOCAL_NODE;
        if LOCAL_NODE.is_ingester() && stream_type == StreamType::Logs && log_patterns_enabled {
            let buf_clone = buf.clone();
            let org_id_clone = org_id.clone();
            let stream_name_clone = stream_name.clone();
            let fts_fields = full_text_search_fields.clone();

            // Spawn pattern extraction task (don't block file movement)
            tokio::spawn(async move {
                if let Err(e) = extract_patterns_from_parquet(
                    &org_id_clone,
                    &stream_name_clone,
                    &buf_clone,
                    &fts_fields,
                )
                .await
                {
                    log::error!(
                        "[PatternExtraction] Failed to extract patterns for {}/{}: {}",
                        org_id_clone,
                        stream_name_clone,
                        e
                    );
                }
            });
        }
    }

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

    // Enterprise: Extract service metadata during data processing
    // This runs BEFORE indexing checks to ensure all stream types are discovered
    #[cfg(feature = "enterprise")]
    {
        use config::cluster::LOCAL_NODE;
        let service_streams_config =
            &o2_enterprise::enterprise::common::config::get_config().service_streams;

        // Only process in ingester mode (if mode is "compactor", this will be handled during merge)
        // Skip self-reporting streams from _meta organization to avoid processing internal metrics
        if LOCAL_NODE.is_ingester()
            && service_streams_config.enabled
            && service_streams_config.is_ingester_mode()
            && org_id != config::META_ORG_ID
            && (stream_type == StreamType::Logs
                || stream_type == StreamType::Metrics
                || stream_type == StreamType::Traces)
        {
            // Check if we should process this file (per-stream-type sampling)
            let should_process =
                o2_enterprise::enterprise::service_streams::sampler::should_process_file(
                    &org_id,
                    stream_type,
                    &stream_name,
                    &new_file_key,
                );

            if should_process {
                let buf_clone = buf.clone();
                let org_id_clone = org_id.clone();
                let stream_name_clone = stream_name.clone();

                // Queue services for batched processing (non-blocking)
                tokio::spawn(async move {
                    if let Err(e) = queue_services_from_parquet(
                        &org_id_clone,
                        stream_type,
                        &stream_name_clone,
                        &buf_clone,
                    )
                    .await
                    {
                        log::error!(
                            "[ServiceStreams] Failed to queue services for {}/{}/{}: {}",
                            org_id_clone,
                            stream_type,
                            stream_name_clone,
                            e
                        );
                    }
                });
            }
        }
    }

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
    let (_parquet_schema, reader) = get_recordbatch_reader_from_bytes(&buf).await?;
    let index_size = create_tantivy_index(
        "INGESTER",
        &new_file_key,
        &full_text_search_fields,
        &index_fields,
        latest_schema.clone(), // Use stream schema to include all configured fields
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

#[cfg(feature = "enterprise")]
async fn extract_patterns_from_parquet(
    org_id: &str,
    stream_name: &str,
    parquet_data: &[u8],
    fts_fields: &[String],
) -> Result<(), anyhow::Error> {
    use config::utils::json;

    let start = std::time::Instant::now();

    // Read parquet data and extract log messages
    let parquet_bytes = Bytes::from(parquet_data.to_vec());
    let (_schema, mut reader) = get_recordbatch_reader_from_bytes(&parquet_bytes).await?;
    let mut log_messages = Vec::new();
    let read_start = std::time::Instant::now();

    // ParquetRecordBatchStream is a Stream, use .next().await
    use futures::StreamExt;

    use crate::common::meta::ingestion::{IngestUser, SystemJobType};
    while let Some(batch_result) = reader.next().await {
        let batch = batch_result?;

        // Try to find FTS fields in the batch
        for fts_field in fts_fields {
            if let Some(column) = batch.column_by_name(fts_field) {
                // Extract string values from the column
                use arrow::array::Array;
                if let Some(string_array) =
                    column.as_any().downcast_ref::<arrow::array::StringArray>()
                {
                    for i in 0..string_array.len() {
                        if !string_array.is_null(i) {
                            log_messages.push((
                                0i64, // timestamp not needed for pattern extraction
                                {
                                    let mut map = json::Map::new();
                                    map.insert(
                                        fts_field.clone(),
                                        json::Value::String(string_array.value(i).to_string()),
                                    );
                                    map
                                },
                            ));
                        }
                    }
                    break; // Found FTS field, no need to check others
                }
            }
        }
    }

    let read_duration = read_start.elapsed();

    if log_messages.is_empty() {
        log::debug!(
            "[PatternExtraction] No log messages found in parquet for {}/{}",
            org_id,
            stream_name
        );
        return Ok(());
    }

    log::info!(
        "[PatternExtraction] Read {} log messages from parquet in {:?} for {}/{}",
        log_messages.len(),
        read_duration,
        org_id,
        stream_name
    );

    // Record parquet read time metric
    metrics::PATTERN_EXTRACTION_TIME
        .with_label_values(&[org_id, "read_parquet"])
        .observe(read_duration.as_secs_f64());

    // Extract patterns directly using XDrain (no in-memory accumulation needed)
    let extraction_start = std::time::Instant::now();
    let patterns = o2_enterprise::enterprise::log_patterns::extract_patterns_from_logs(
        &log_messages,
        fts_fields,
    )
    .map_err(|e| anyhow::anyhow!("Pattern extraction failed: {}", e))?;
    let extraction_duration = extraction_start.elapsed();

    if patterns.is_empty() {
        log::debug!(
            "[PatternExtraction] No patterns found for {}/{}",
            org_id,
            stream_name
        );
        return Ok(());
    }

    log::info!(
        "[PatternExtraction] Extracted {} patterns from {} logs in {:?} for {}/{}",
        patterns.len(),
        log_messages.len(),
        extraction_duration,
        org_id,
        stream_name
    );

    // Record pattern extraction time metric
    metrics::PATTERN_EXTRACTION_TIME
        .with_label_values(&[org_id, "extraction"])
        .observe(extraction_duration.as_secs_f64());

    // Ingest patterns immediately
    let ingest_start = std::time::Instant::now();
    crate::service::logs::patterns::ingest_patterns(
        org_id,
        stream_name,
        patterns,
        IngestUser::SystemJob(SystemJobType::LogPatterns),
    )
    .await
    .map_err(|e| anyhow::anyhow!("Failed to ingest patterns: {}", e))?;
    let ingest_duration = ingest_start.elapsed();

    let total_duration = start.elapsed();

    log::info!(
        "[PatternExtraction] Completed in {:?} (read: {:?}, extract: {:?}, ingest: {:?}) for {}/{}",
        total_duration,
        read_duration,
        extraction_duration,
        ingest_duration,
        org_id,
        stream_name
    );

    // Record ingestion time metric
    metrics::PATTERN_EXTRACTION_TIME
        .with_label_values(&[org_id, "ingestion"])
        .observe(ingest_duration.as_secs_f64());

    // Record total pattern extraction time metric
    metrics::PATTERN_EXTRACTION_TIME
        .with_label_values(&[org_id, "total"])
        .observe(total_duration.as_secs_f64());

    Ok(())
}

#[cfg(feature = "enterprise")]
async fn queue_services_from_parquet(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    parquet_data: &[u8],
) -> Result<(), anyhow::Error> {
    use std::collections::HashMap;

    use tokio::sync::mpsc;

    let start = std::time::Instant::now();

    // Get semantic field groups and FQN priority upfront (before spawning tasks)
    let semantic_groups =
        crate::service::db::system_settings::get_semantic_field_groups(org_id).await;
    let fqn_priority =
        crate::service::db::system_settings::get_fqn_priority_dimensions(org_id).await;

    // Get config values for channel capacity
    let ss_config = &o2_enterprise::enterprise::common::config::get_config().service_streams;
    let channel_capacity = ss_config.channel_capacity;

    // Create bounded channel for backpressure - drops records if consumer can't keep up
    // ARROW-NATIVE: Channel now sends RecordBatch directly (no HashMap conversion!)
    let (tx, mut rx) = mpsc::channel::<arrow::record_batch::RecordBatch>(channel_capacity);

    // Clone data needed for producer task
    let parquet_bytes = Bytes::copy_from_slice(parquet_data);

    // Spawn producer task to read parquet and send Arrow batches through channel
    // ARROW-NATIVE: No HashMap conversion! Sends RecordBatch directly.
    let producer_handle = tokio::spawn(async move {
        let mut records_sent = 0u64;
        let mut records_dropped = 0u64;
        let mut batches_sent = 0u64;

        let reader_result = get_recordbatch_reader_from_bytes(&parquet_bytes).await;
        let (_schema, mut reader) = match reader_result {
            Ok(r) => r,
            Err(e) => {
                log::error!("[ServiceStreams] Failed to read parquet: {}", e);
                return (records_sent, records_dropped);
            }
        };

        use futures::StreamExt;
        while let Some(batch_result) = reader.next().await {
            let batch = match batch_result {
                Ok(b) => b,
                Err(e) => {
                    log::error!("[ServiceStreams] Error reading batch: {}", e);
                    continue;
                }
            };

            let num_rows = batch.num_rows();
            if num_rows == 0 {
                continue;
            }

            // Send Arrow batch directly (no conversion!)
            match tx.try_send(batch) {
                Ok(()) => {
                    batches_sent += 1;
                    records_sent += num_rows as u64;
                }
                Err(mpsc::error::TrySendError::Full(dropped_batch)) => {
                    let dropped = dropped_batch.num_rows() as u64;
                    records_dropped += dropped;
                    log::debug!("[ServiceStreams] Channel full, dropped {} records", dropped);
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {
                    // Consumer closed, stop producing
                    log::debug!(
                        "[ServiceStreams] Consumer closed, stopping producer (sent {} batches, {} records)",
                        batches_sent,
                        records_sent
                    );
                    return (records_sent, records_dropped);
                }
            }
        }

        log::debug!(
            "[ServiceStreams] Producer finished: sent {} batches ({} records), dropped {} records",
            batches_sent,
            records_sent,
            records_dropped
        );

        (records_sent, records_dropped)
    });

    // Consumer: Process batches as they arrive
    let processor = o2_enterprise::enterprise::service_streams::processor::StreamProcessor::new(
        org_id.to_string(),
        semantic_groups,
        fqn_priority,
    );

    let mut all_services: HashMap<
        String,
        o2_enterprise::enterprise::service_streams::meta::ServiceMetadata,
    > = HashMap::new();
    let mut total_records_processed = 0u64;

    // Process Arrow batches from channel
    // ARROW-NATIVE: Process RecordBatch directly (no HashMap conversion!)
    while let Some(batch) = rx.recv().await {
        let batch_len = batch.num_rows();

        // Process Arrow batch using Arrow-native method
        let services = processor
            .process_arrow_batch(&batch, stream_type, stream_name)
            .await;

        // Merge discovered services
        for (key, service) in services {
            all_services
                .entry(key)
                .and_modify(|existing| existing.merge(&service))
                .or_insert(service);
        }

        total_records_processed += batch_len as u64;
    }

    // Wait for producer to finish and get stats
    let (records_sent, records_dropped) = producer_handle.await.unwrap_or((0, 0));

    if records_dropped > 0 {
        log::warn!(
            "[ServiceStreams] Dropped {} records due to backpressure for {}/{}",
            records_dropped,
            org_id,
            stream_name
        );
        metrics::SERVICE_STREAMS_RECORDS_DROPPED
            .with_label_values(&[org_id, &stream_type.to_string()])
            .inc_by(records_dropped);
    }

    // Log blocked dimensions
    let blocked = processor.get_blocked_dimensions().await;
    if !blocked.is_empty() {
        log::warn!(
            "[ServiceStreams] Blocked high-cardinality dimensions for {}/{}: {:?}",
            org_id,
            stream_name,
            blocked
        );
        for (dimension, _count) in &blocked {
            metrics::SERVICE_STREAMS_HIGH_CARDINALITY_BLOCKED
                .with_label_values(&[org_id, dimension])
                .inc();
        }
    }

    if all_services.is_empty() {
        return Ok(());
    }

    // Record metrics
    let service_count = all_services.len() as u64;
    metrics::SERVICE_STREAMS_SERVICES_DISCOVERED
        .with_label_values(&[org_id, &stream_type.to_string()])
        .inc_by(service_count);

    let duration = start.elapsed();
    metrics::SERVICE_STREAMS_PROCESSING_TIME
        .with_label_values(&[org_id])
        .observe(duration.as_secs_f64());

    log::debug!(
        "[ServiceStreams] Processed {} records, discovered {} services in {:?} for {}/{} (sent: {}, dropped: {})",
        total_records_processed,
        service_count,
        duration,
        org_id,
        stream_name,
        records_sent,
        records_dropped
    );

    // Queue services for batched processing
    o2_enterprise::enterprise::service_streams::batch_processor::queue_services(
        org_id.to_string(),
        all_services,
    )
    .await;

    Ok(())
}
