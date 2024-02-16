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

use std::{fs, path::Path};

use arrow::ipc::reader::StreamReader;
use config::{
    cluster,
    meta::stream::{FileMeta, StreamType},
    metrics,
    utils::{file::scan_files, parquet::new_parquet_writer},
    CONFIG,
};
use infra::storage;
use tokio::{sync::Semaphore, task, time};

use super::{ider, FILE_EXT_PARQUET};
use crate::{
    common::{infra::wal, meta::stream::StreamParams, utils::stream::populate_file_meta},
    service::{db, schema::schema_evolution, usage::report_compression_stats},
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
            log::error!("Error moving disk files to remote: {}", e);
        }
    }

    log::info!("job::files::disk is stopped");
    Ok(())
}

// upload compressed files to storage & delete moved files from local
pub async fn move_files_to_storage() -> Result<(), anyhow::Error> {
    let wal_dir = Path::new(&CONFIG.common.data_idx_dir)
        .canonicalize()
        .unwrap();

    let pattern = format!("{}files/", &CONFIG.common.data_idx_dir);
    let files = scan_files(&pattern, "arrow");

    // use multiple threads to upload files
    let mut tasks = Vec::new();
    let semaphore = std::sync::Arc::new(Semaphore::new(CONFIG.limit.file_move_thread_num));
    for file in files {
        let local_file = file.to_owned();
        let local_path = Path::new(&file).canonicalize().unwrap();
        let file_path = local_path
            .strip_prefix(&wal_dir)
            .unwrap()
            .to_str()
            .unwrap()
            .replace('\\', "/");
        let columns = file_path.splitn(5, '/').collect::<Vec<&str>>();

        // eg: files/default/logs/olympics/0/2023/08/21/08/8b8a5451bbe1c44b/
        // 7099303408192061440f3XQ2p.json eg: files/default/traces/default/0/2023/09/04/05/
        // default/service_name=ingester/7104328279989026816guOA4t.json let _ = columns[0].
        // to_string(); // files/
        let org_id = columns[1].to_string();
        let stream_type: StreamType = StreamType::from(columns[2]);
        let stream_name = columns[3].to_string();
        let mut file_name = columns[4].to_string();

        // Hack: compatible for <= 0.5.1
        if !file_name.contains('/') && file_name.contains('_') {
            file_name = file_name.replace('_', "/");
        }

        // check the file is using for write
        if wal::check_in_use(
            StreamParams::new(&org_id, &stream_name, stream_type),
            &file_name,
        )
        .await
        {
            // println!("file is using for write, skip, {}", file_name);
            continue;
        }
        log::info!("[JOB] convert disk file: {}", file);

        // check if we are allowed to ingest or just delete the file
        if db::compact::retention::is_deleting_stream(&org_id, stream_type, &stream_name, None) {
            log::info!(
                "[JOB] the stream [{}/{}/{}] is deleting, just delete file: {}",
                &org_id,
                stream_type,
                &stream_name,
                file
            );
            if let Err(e) = tokio::fs::remove_file(&local_file).await {
                log::error!(
                    "[JOB] Failed to remove disk file from disk: {}, {}",
                    local_file,
                    e
                );
            }
            continue;
        }

        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: task::JoinHandle<Result<(), anyhow::Error>> = task::spawn(async move {
            let ret =
                upload_file(&org_id, &stream_name, stream_type, &local_file, &file_name).await;
            if let Err(e) = ret {
                log::error!(
                    "[JOB] Error while uploading disk file {} to storage {}",
                    &file_name,
                    e
                );
                drop(permit);
                return Ok(());
            }

            let (key, meta, _stream_type) = ret.unwrap();
            let ret = db::file_list::local::set(&key, Some(meta.clone()), false).await;
            if let Err(e) = ret {
                log::error!(
                    "[JOB] Failed write disk file meta: {}, error: {}",
                    local_file,
                    e.to_string()
                );
                drop(permit);
                return Ok(());
            }

            // check if allowed to delete the file
            loop {
                if wal::lock_files_exists(&file_path).await {
                    log::info!(
                        "[JOB] the file is still in use, waiting for a few ms: {}",
                        file_path
                    );
                    time::sleep(time::Duration::from_millis(100)).await;
                } else {
                    break;
                }
            }

            let ret = tokio::fs::remove_file(&local_file).await;
            if let Err(e) = ret {
                log::error!(
                    "[JOB] Failed to remove disk file from disk: {}, {}",
                    local_file,
                    e.to_string()
                );
                drop(permit);
                return Ok(());
            }

            // TODO(ansrivas): metrics
            // let columns = key.split('/').collect::<Vec<&str>>();
            // if columns[0] == "files" {
            //     metrics::INGEST_WAL_USED_BYTES
            //         .with_label_values(&[columns[1], columns[3], columns[2]])
            //         .sub(meta.original_size);
            //     report_compression_stats(meta.into(), &org_id, &stream_name, stream_type).await;
            // }

            drop(permit);
            Ok(())
        });
        tasks.push(task);
    }

    for task in tasks {
        if let Err(e) = task.await {
            log::error!("[JOB] Error while uploading disk file to storage {}", e);
        };
    }
    Ok(())
}

async fn upload_file(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    path_str: &str,
    file_name: &str,
) -> Result<(String, FileMeta, StreamType), anyhow::Error> {
    let file = fs::File::open(path_str).unwrap();
    let file_meta = file.metadata().unwrap();
    let file_size = file_meta.len();
    log::info!("[JOB] File upload begin: disk: {}", path_str);
    if file_size == 0 {
        if let Err(e) = tokio::fs::remove_file(path_str).await {
            log::error!(
                "[JOB] Failed to remove disk file from disk: {}, {}",
                path_str,
                e
            );
        }
        return Err(anyhow::anyhow!("file is empty: {}", path_str));
    }

    // TODO(ansrivas): metrics should it be WAL or normal
    metrics::INGEST_BYTES
        .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
        .inc_by(file_size);

    let mut batches = vec![];

    let stream_reader = StreamReader::try_new(&file, None)?;
    for read_result in stream_reader {
        let record_batch = read_result?;
        batches.push(record_batch);
    }
    write_to_disk(
        batches,
        file_size,
        org_id,
        stream_name,
        stream_type,
        file_name,
        "upload_file",
    )
    .await
}

fn generate_index_file_name_from_compacted_file(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    compacted_file_name: &str,
) -> String {
    // eg: files/default/logs/quickstart1/2024/02/16/16/7164299619311026293.parquet
    let file_columns = compacted_file_name.split('/').collect::<Vec<&str>>();
    let stream_key = format!("{}/{}/{}", org_id, stream_type, stream_name);
    let file_date = format!(
        "{}/{}/{}/{}",
        file_columns[4], file_columns[5], file_columns[6], file_columns[7]
    );
    let file_name = ider::generate();
    format!("files/{stream_key}/{file_date}/{file_name}{FILE_EXT_PARQUET}")
}

pub(crate) async fn write_to_disk(
    batches: Vec<arrow::record_batch::RecordBatch>,
    file_size: u64,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    file_name: &str,
    caller: &str,
) -> Result<(String, FileMeta, StreamType), anyhow::Error> {
    let schema = if let Some(first_batch) = batches.first() {
        first_batch.schema()
    } else {
        return Err(anyhow::anyhow!("No record batches found".to_string(),));
    };

    // write metadata
    let mut file_meta = FileMeta {
        min_ts: 0,
        max_ts: 0,
        records: 0,
        original_size: file_size as i64,
        compressed_size: 0,
    };
    populate_file_meta(schema.clone(), vec![batches.to_vec()], &mut file_meta).await?;

    // write parquet file
    let mut buf_parquet = Vec::new();
    let mut writer = new_parquet_writer(&mut buf_parquet, &schema, &[], &file_meta);
    for batch in batches {
        writer.write(&batch).await?;
    }
    writer.close().await?;
    file_meta.compressed_size = buf_parquet.len() as i64;

    schema_evolution(org_id, stream_name, stream_type, schema, file_meta.min_ts).await;

    let new_idx_file_name =
        generate_index_file_name_from_compacted_file(org_id, stream_type, stream_name, file_name);
    log::warn!(
        "[JOB] IDX: write_to_disk: {} {} {} {} {} {}",
        org_id,
        stream_name,
        stream_type,
        new_idx_file_name,
        file_name,
        caller,
    );
    let store_file_name = new_idx_file_name.to_owned();
    match task::spawn_blocking(move || async move {
        storage::put(&store_file_name, bytes::Bytes::from(buf_parquet)).await
    })
    .await
    {
        Ok(output) => match output.await {
            Ok(_) => {
                log::info!("[JOB] disk file upload succeeded: {}", &new_idx_file_name);
                Ok((new_idx_file_name, file_meta, stream_type))
            }
            Err(err) => {
                log::error!("[JOB] disk file upload error: {:?}", err);
                Err(anyhow::anyhow!(err))
            }
        },
        Err(err) => {
            log::error!("[JOB] disk file upload error: {:?}", err);
            Err(anyhow::anyhow!(err))
        }
    }
}
