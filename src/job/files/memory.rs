// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use bytes::Bytes;
use datafusion::arrow::json::ReaderBuilder;
use std::{io::BufReader, sync::Arc};
use tokio::{sync::Semaphore, task, time};

use crate::common::{
    infra::{cluster, config::CONFIG, metrics, storage, wal},
    meta::{common::FileMeta, StreamType},
    utils::{
        json,
        schema::{infer_json_schema, infer_json_schema_from_iterator},
        stream::populate_file_meta,
    },
};
use crate::service::{
    db,
    schema::{filter_schema_null_fields, schema_evolution},
    search::datafusion::new_parquet_writer,
    usage::report_compression_stats,
};

pub async fn run() -> Result<(), anyhow::Error> {
    if !CONFIG.common.wal_memory_mode_enabled {
        return Ok(());
    }

    let mut interval = time::interval(time::Duration::from_secs(CONFIG.limit.file_push_interval));
    interval.tick().await; // trigger the first run
    loop {
        if cluster::is_offline() {
            break;
        }
        interval.tick().await;
        if let Err(e) = move_files_to_storage().await {
            log::error!("Error moving memory files to remote: {}", e);
        }
    }
    log::info!("job::files::memory is stopped");
    Ok(())
}

/*
 * upload compressed files to storage & delete moved files from local
 */
pub async fn move_files_to_storage() -> Result<(), anyhow::Error> {
    // need to clone here, to avoid thread boundry issues across awaits
    let files = wal::MEMORY_FILES.list("").await;
    // use multiple threads to upload files
    let mut tasks = Vec::new();
    let semaphore = std::sync::Arc::new(Semaphore::new(CONFIG.limit.file_move_thread_num));
    for (file, data) in files {
        let local_file = file.to_owned();
        let columns = local_file.splitn(5, '/').collect::<Vec<&str>>();

        // eg: files/default/logs/olympics/0/2023/08/21/08/8b8a5451bbe1c44b/7099303408192061440f3XQ2p.json
        // let _ = columns[0].to_string(); // files/
        let org_id = columns[1].to_string();
        let stream_type: StreamType = StreamType::from(columns[2]);
        let stream_name = columns[3].to_string();
        let file_name = columns[4].to_string();

        log::info!("[JOB] convert memory file: {}", file);

        // check if we are allowed to ingest or just delete the file
        if db::compact::retention::is_deleting_stream(&org_id, &stream_name, stream_type, None) {
            log::info!(
                "[JOB] the stream [{}/{}/{}] is deleting, just delete file: {}",
                &org_id,
                stream_type,
                &stream_name,
                file
            );
            wal::MEMORY_FILES.remove(&file).await;
            continue;
        }

        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: task::JoinHandle<Result<(), anyhow::Error>> = task::spawn(async move {
            let ret = upload_file(
                &org_id,
                &stream_name,
                stream_type,
                &local_file,
                &file_name,
                data,
            )
            .await;
            if let Err(e) = ret {
                log::error!("[JOB] Error while uploading memory file to storage {}", e);
                drop(permit);
                return Ok(());
            }

            let (key, meta, _stream_type) = ret.unwrap();
            let ret = db::file_list::local::set(&key, Some(meta.clone()), false).await;
            if let Err(e) = ret {
                log::error!(
                    "[JOB] Failed write memory file meta: {}, error: {}",
                    local_file,
                    e.to_string()
                );
                drop(permit);
                return Ok(());
            }

            // check if allowed to delete the file
            loop {
                if wal::lock_files_exists(&local_file).await {
                    log::info!(
                        "[JOB] the file is still in use, waiting for a few ms: {}",
                        local_file
                    );
                    time::sleep(time::Duration::from_millis(100)).await;
                } else {
                    break;
                }
            }

            // delete files
            wal::MEMORY_FILES.remove(&local_file).await;

            // metrics
            let columns = key.split('/').collect::<Vec<&str>>();
            if columns[0] == "files" {
                metrics::INGEST_WAL_USED_BYTES
                    .with_label_values(&[columns[1], columns[3], columns[2]])
                    .sub(meta.original_size);
                report_compression_stats(meta.into(), &org_id, &stream_name, stream_type).await;
            }

            drop(permit);
            Ok(())
        });
        tasks.push(task);
    }

    for task in tasks {
        if let Err(e) = task.await {
            log::error!("[JOB] Error while uploading memory file to storage {}", e);
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
    buf: Bytes,
) -> Result<(String, FileMeta, StreamType), anyhow::Error> {
    let file_size = buf.len() as u64;
    log::info!("[JOB] File upload begin: memory: {}", path_str);
    if file_size == 0 {
        wal::MEMORY_FILES.remove(path_str).await;
        return Err(anyhow::anyhow!("file is empty: {}", path_str));
    }

    // metrics
    metrics::INGEST_WAL_READ_BYTES
        .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
        .inc_by(file_size);

    let mut res_records: Vec<json::Value> = vec![];
    let mut schema_reader = BufReader::new(buf.as_ref());
    let inferred_schema = match infer_json_schema(&mut schema_reader, None, stream_type) {
        Ok(mut inferred_schema) => {
            drop(schema_reader);
            filter_schema_null_fields(&mut inferred_schema);
            inferred_schema
        }
        Err(err) => {
            // Buf has some corrupt json data....ignore such data & move rest of the records
            log::error!(
                "[JOB] Failed to infer schema from file: {}, error: {}",
                path_str,
                err.to_string()
            );

            drop(schema_reader);
            let mut json_reader = BufReader::new(buf.as_ref());
            let value_reader = arrow::json::reader::ValueIter::new(&mut json_reader, None);
            for value in value_reader {
                match value {
                    Ok(val) => {
                        res_records.push(val);
                    }
                    Err(err) => {
                        log::error!("[JOB] Failed to parse record: error: {}", err.to_string())
                    }
                }
            }
            if res_records.is_empty() {
                return Err(anyhow::anyhow!("file has corrupt json data: {}", path_str));
            }
            let value_iter = res_records.iter().map(Ok);
            let mut inferred_schema =
                infer_json_schema_from_iterator(value_iter, stream_type).unwrap();
            filter_schema_null_fields(&mut inferred_schema);
            inferred_schema
        }
    };
    let arrow_schema = Arc::new(inferred_schema);

    let mut batches = vec![];
    if res_records.is_empty() {
        let json_reader = BufReader::new(buf.as_ref());
        let json = ReaderBuilder::new(arrow_schema.clone())
            .build(json_reader)
            .unwrap();
        for batch in json {
            let batch_write = batch.unwrap();
            batches.push(batch_write);
        }
    } else {
        let mut json = vec![];
        let mut decoder = ReaderBuilder::new(arrow_schema.clone()).build_decoder()?;
        for value in res_records {
            decoder
                .decode(json::to_string(&value).unwrap().as_bytes())
                .unwrap();
            json.push(decoder.flush()?.unwrap());
        }
        for batch in json {
            batches.push(batch);
        }
    };

    // write metadata
    let mut file_meta = FileMeta {
        min_ts: 0,
        max_ts: 0,
        records: 0,
        original_size: file_size as i64,
        compressed_size: 0,
    };
    populate_file_meta(arrow_schema.clone(), vec![batches.to_vec()], &mut file_meta).await?;

    // write parquet file
    let mut buf_parquet = Vec::new();
    let mut writer = new_parquet_writer(&mut buf_parquet, &arrow_schema, &file_meta);
    for batch in batches {
        writer.write(&batch)?;
    }
    writer.close()?;
    file_meta.compressed_size = buf_parquet.len() as i64;

    schema_evolution(
        org_id,
        stream_name,
        stream_type,
        arrow_schema,
        file_meta.min_ts,
    )
    .await;

    let new_file_name =
        super::generate_storage_file_name(org_id, stream_type, stream_name, file_name);
    match storage::put(&new_file_name, bytes::Bytes::from(buf_parquet)).await {
        Ok(_output) => {
            log::info!("[JOB] memory file upload succeeded: {}", new_file_name);
            Ok((new_file_name, file_meta, stream_type))
        }
        Err(err) => {
            log::error!("[JOB] memory file upload error: {:?}", err);
            Err(anyhow::anyhow!(err))
        }
    }
}
