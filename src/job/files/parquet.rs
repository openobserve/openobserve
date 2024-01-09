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
    collections::HashMap,
    io::{Cursor, Read},
    path::Path,
    sync::Arc,
    time::UNIX_EPOCH,
};

use arrow_schema::Schema;
use chrono::{Duration, Utc};
use config::{
    meta::stream::{FileKey, FileMeta, StreamType},
    metrics,
    utils::parquet::{read_metadata_from_bytes, read_metadata_from_file},
    CONFIG,
};
use parquet::arrow::ParquetRecordBatchStreamBuilder;
use tokio::{sync::Semaphore, task::JoinHandle, time};

use crate::{
    common::{
        infra::{cache, cluster, storage, wal},
        utils::{
            asynchronism::file::{get_file_contents, get_file_meta},
            file::scan_files,
        },
    },
    service::{
        db, schema::schema_evolution, search::datafusion::exec::merge_parquet_files, stream,
    },
};

pub async fn run() -> Result<(), anyhow::Error> {
    let mut interval = time::interval(time::Duration::from_secs(CONFIG.limit.file_push_interval));
    interval.tick().await; // trigger the first run
    loop {
        if cluster::is_offline() {
            break;
        }
        interval.tick().await;
        if let Err(e) = move_files_to_storage().await {
            log::error!("Error moving parquet files to remote: {}", e);
        }
    }
    log::info!("job::files::parquet is stopped");
    Ok(())
}

// upload compressed files to storage & delete moved files from local
pub async fn move_files_to_storage() -> Result<(), anyhow::Error> {
    let wal_dir = Path::new(&CONFIG.common.data_wal_dir)
        .canonicalize()
        .unwrap();

    let pattern = wal_dir.join("files/");
    let files = scan_files(&pattern, "parquet");

    // do partition by partition key
    let mut partition_files_with_size: HashMap<String, Vec<FileKey>> = HashMap::default();
    for file in files {
        let Ok(parquet_meta) = read_metadata_from_file(&(&file).into()).await else {
            continue;
        };
        let file = Path::new(&file)
            .canonicalize()
            .unwrap()
            .strip_prefix(&wal_dir)
            .unwrap()
            .to_str()
            .unwrap()
            .replace('\\', "/");
        let prefix = file[..file.rfind('/').unwrap()].to_string();
        let partition = partition_files_with_size.entry(prefix).or_default();
        partition.push(FileKey::new(&file, parquet_meta, false));
    }

    // use multiple threads to upload files
    let mut tasks = Vec::new();
    let semaphore = std::sync::Arc::new(Semaphore::new(CONFIG.limit.file_move_thread_num));
    for (prefix, files_with_size) in partition_files_with_size.into_iter() {
        let columns = prefix.splitn(5, '/').collect::<Vec<&str>>();
        // eg: files/default/logs/olympics/0/2023/08/21/08/8b8a5451bbe1c44b/
        // eg: files/default/traces/default/0/2023/09/04/05/default/service_name=ingester/
        // let _ = columns[0].to_string(); // files/
        let org_id = columns[1].to_string();
        let stream_type = StreamType::from(columns[2]);
        let stream_name = columns[3].to_string();

        // check if we are allowed to ingest or just delete the file
        if db::compact::retention::is_deleting_stream(&org_id, &stream_name, stream_type, None) {
            for file in files_with_size {
                log::warn!(
                    "[INGESTER:JOB] the stream [{}/{}/{}] is deleting, just delete file: {}",
                    &org_id,
                    stream_type,
                    &stream_name,
                    file.key,
                );
                if let Err(e) = tokio::fs::remove_file(wal_dir.join(&file.key)).await {
                    log::error!(
                        "[INGESTER:JOB] Failed to remove parquet file from disk: {}, {}",
                        file.key,
                        e
                    );
                }
            }
            continue;
        }

        let wal_dir = wal_dir.clone();
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: JoinHandle<Result<(), anyhow::Error>> = tokio::task::spawn(async move {
            let mut force_upload = false;
            // sort by created time
            let mut files_with_size = files_with_size.to_owned();
            files_with_size.sort_by(|a, b| a.meta.min_ts.cmp(&b.meta.min_ts));
            // check the total size
            let total_original_size: i64 = files_with_size
                .iter()
                .map(|f| f.meta.original_size)
                .sum::<i64>();
            if total_original_size < CONFIG.limit.max_file_size_on_disk as i64 {
                // not enough files to upload, check if some files are too old
                let min_ts = Utc::now().timestamp_micros()
                    - Duration::seconds(CONFIG.limit.max_file_retention_time as i64)
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
                        force_upload = true;
                        break;
                    }
                }
                if !force_upload {
                    drop(permit);
                    return Ok(());
                }
            }

            // get latest schema
            let latest_schema = db::schema::get(&org_id, &stream_name, stream_type).await?;

            // start merge files and upload to s3
            loop {
                // yield to other tasks
                tokio::task::yield_now().await;
                // merge file and get the big file key
                let (new_file_name, new_file_meta, new_file_list) =
                    match merge_files(&latest_schema, &wal_dir, &files_with_size, force_upload)
                        .await
                    {
                        Ok(v) => v,
                        Err(e) => {
                            log::error!("[INGESTER:JOB] merge files failed: {}", e);
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
                let ret =
                    db::file_list::local::set(&new_file_name, Some(new_file_meta), false).await;
                if let Err(e) = ret {
                    log::error!(
                        "[INGESTER:JOB] Failed write parquet file meta: {}, error: {}",
                        new_file_name,
                        e.to_string()
                    );
                    drop(permit);
                    return Ok(());
                }

                // check if allowed to delete the file
                for file in new_file_list.iter() {
                    loop {
                        if wal::lock_files_exists(&file.key).await {
                            log::warn!(
                                "[INGESTER:JOB] the file is still in use, waiting for a few ms: {}",
                                file.key
                            );
                            time::sleep(time::Duration::from_millis(100)).await;
                        } else {
                            break;
                        }
                    }

                    let ret = tokio::fs::remove_file(&wal_dir.join(&file.key)).await;
                    if let Err(e) = ret {
                        log::error!(
                            "[INGESTER:JOB] Failed to remove parquet file from disk: {}, {}",
                            file.key,
                            e.to_string()
                        );
                        drop(permit);
                        return Ok(());
                    }

                    // metrics
                    metrics::INGEST_WAL_READ_BYTES
                        .with_label_values(&[&org_id, stream_type.to_string().as_str()])
                        .inc_by(file.meta.compressed_size as u64);
                    metrics::INGEST_WAL_USED_BYTES
                        .with_label_values(&[&org_id, stream_type.to_string().as_str()])
                        .sub(file.meta.compressed_size);
                }

                // delete files from file list
                let new_file_list = new_file_list.iter().map(|f| &f.key).collect::<Vec<_>>();
                files_with_size.retain(|f| !new_file_list.contains(&&f.key));
            }

            drop(permit);
            Ok(())
        });
        tasks.push(task);
    }

    for task in tasks {
        if let Err(e) = task.await {
            log::error!(
                "[INGESTER:JOB] Error while uploading parquet file to storage {}",
                e
            );
        };
    }
    Ok(())
}

/// merge some small files into one big file, upload to storage, returns the big
/// file key and merged files
async fn merge_files(
    latest_schema: &Schema,
    wal_dir: &Path,
    files_with_size: &[FileKey],
    force_upload: bool,
) -> Result<(String, FileMeta, Vec<FileKey>), anyhow::Error> {
    if files_with_size.is_empty() {
        return Ok((String::from(""), FileMeta::default(), Vec::new()));
    }

    let mut new_file_size = 0;
    let mut new_file_list = Vec::new();
    let mut deleted_files = Vec::new();
    for file in files_with_size.iter() {
        if new_file_size + file.meta.original_size > CONFIG.compact.max_file_size as i64 {
            break;
        }
        new_file_size += file.meta.original_size;
        new_file_list.push(file.clone());
    }
    // these files are too small, just skip upload and wait for next round
    if !force_upload && new_file_size < CONFIG.limit.max_file_size_on_disk as i64 {
        return Ok((String::from(""), FileMeta::default(), Vec::new()));
    }
    let mut retain_file_list = new_file_list.clone();

    // write parquet files into tmpfs
    let mut file_schema = None;
    let tmp_dir = cache::tmpfs::Directory::default();
    for file in retain_file_list.iter_mut() {
        log::info!("[INGESTER:JOB] merge small file: {}", &file.key);
        let data = match get_file_contents(&wal_dir.join(&file.key)).await {
            Ok(body) => body,
            Err(err) => {
                log::error!(
                    "[INGESTER:JOB] merge small file: {}, err: {}",
                    &file.key,
                    err
                );
                deleted_files.push(file.key.clone());
                continue;
            }
        };
        if file_schema.is_none() {
            let schema_reader = Cursor::new(data.clone());
            let arrow_reader = ParquetRecordBatchStreamBuilder::new(schema_reader).await?;
            file_schema = Some(
                arrow_reader
                    .schema()
                    .as_ref()
                    .clone()
                    .with_metadata(HashMap::new()),
            );
        }
        let file_size = data.len();
        file.meta.compressed_size = file_size as i64;
        tmp_dir.set(&file.key, data.into())?;
    }
    if !deleted_files.is_empty() {
        new_file_list.retain(|f| !deleted_files.contains(&f.key));
    }
    if new_file_list.is_empty() {
        return Ok((String::from(""), FileMeta::default(), retain_file_list));
    }

    // eg: files/default/logs/olympics/0/2023/08/21/08/8b8a5451bbe1c44b/
    // 7099303408192061440f3XQ2p.parquet
    // eg: files/default/traces/default/0/023/09/04/05/default/
    // service_name=ingester/7104328279989026816guOA4t.parquet
    // let _ = columns[0].to_string(); // files/
    let file = new_file_list.first().unwrap();
    let columns = file.key.splitn(5, '/').collect::<Vec<&str>>();
    let org_id = columns[1].to_string();
    let stream_type = StreamType::from(columns[2]);
    let stream_name = columns[3].to_string();
    let file_name = columns[4].to_string();

    if new_file_list.len() == 1 {
        let (new_file_name, file_meta) = upload_file(
            &org_id,
            &stream_name,
            stream_type,
            wal_dir,
            &file.key,
            &file_name,
        )
        .await?;
        return Ok((new_file_name, file_meta, retain_file_list));
    }

    // merge files
    let bloom_filter_fields =
        stream::get_stream_setting_bloom_filter_fields(latest_schema).unwrap();
    let mut buf = Vec::new();
    let mut new_file_meta = merge_parquet_files(
        tmp_dir.name(),
        &mut buf,
        Arc::new(file_schema.unwrap()),
        &bloom_filter_fields,
        new_file_size,
    )
    .await?;
    new_file_meta.original_size = new_file_size;
    new_file_meta.compressed_size = buf.len() as i64;
    if new_file_meta.records == 0 {
        return Err(anyhow::anyhow!("merge_parquet_files error: records is 0"));
    }

    let new_file_key =
        super::generate_storage_file_name(&org_id, stream_type, &stream_name, &file_name);
    log::info!(
        "[INGESTER:JOB] merge file succeeded, {} files into a new file: {}, orginal_size: {}, compressed_size: {}",
        retain_file_list.len(),
        new_file_key,
        new_file_meta.original_size,
        new_file_meta.compressed_size,
    );

    // upload file
    match storage::put(&new_file_key, buf.into()).await {
        Ok(_) => Ok((new_file_key, new_file_meta, retain_file_list)),
        Err(e) => Err(e),
    }
}

async fn upload_file(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    wal_dir: &Path,
    path_str: &str,
    file_name: &str,
) -> Result<(String, FileMeta), anyhow::Error> {
    let file_path = wal_dir.join(path_str);
    let mut file = std::fs::File::open(&file_path).unwrap();
    let file_meta = file.metadata().unwrap();
    let file_size = file_meta.len();
    log::info!("[INGESTER:JOB] File upload begin: {}", path_str);
    if file_size == 0 {
        if let Err(e) = tokio::fs::remove_file(file_path).await {
            log::error!(
                "[INGESTER:JOB] Failed to remove parquet file from disk: {}, {}",
                path_str,
                e
            );
        }
        return Err(anyhow::anyhow!("file is empty: {}", path_str));
    }

    // write metadata
    let mut buf_parquet: Vec<u8> = Vec::new();
    file.read_to_end(&mut buf_parquet)?;
    let buf_parquet = bytes::Bytes::from(buf_parquet);
    let mut file_meta = read_metadata_from_bytes(&buf_parquet).await?;
    file_meta.compressed_size = file_size as i64;

    // read schema
    let schema_reader = std::io::Cursor::new(buf_parquet.clone());
    let arrow_reader = ParquetRecordBatchStreamBuilder::new(schema_reader).await?;
    let inferred_schema = arrow_reader
        .schema()
        .as_ref()
        .clone()
        .with_metadata(std::collections::HashMap::new());

    schema_evolution(
        org_id,
        stream_name,
        stream_type,
        Arc::new(inferred_schema),
        file_meta.min_ts,
    )
    .await;

    let new_file_name =
        super::generate_storage_file_name(org_id, stream_type, stream_name, file_name);
    drop(file);
    let file_name = new_file_name.to_owned();
    match storage::put(&new_file_name, buf_parquet).await {
        Ok(_) => {
            log::info!("[INGESTER:JOB] File upload succeeded: {}", file_name);
            Ok((file_name, file_meta))
        }
        Err(err) => {
            log::error!("[INGESTER:JOB] File upload error: {:?}", err);
            Err(anyhow::anyhow!(err))
        }
    }
}
