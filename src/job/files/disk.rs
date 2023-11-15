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

use arrow::ipc::reader::StreamReader;
use datafusion::arrow::json::ReaderBuilder;
use std::collections::HashMap;
use std::io::BufRead;
use std::{
    fs,
    io::{BufReader, Seek, SeekFrom},
    path::Path,
    sync::Arc,
};
use tokio::{sync::Semaphore, task, time};

use crate::common::infra::config::FILE_EXT_ARROW;
use crate::common::meta::prom::NAME_LABEL;
use crate::common::meta::stream::PartitionTimeLevel;
use crate::common::utils::hasher::get_schema_key_xxh3;
use crate::common::utils::schema::infer_json_schema;
use crate::common::{
    infra::{cluster, config::CONFIG, metrics, storage, wal},
    meta::{common::FileMeta, stream::StreamParams, StreamType},
    utils::{
        file::scan_files,
        json,
        schema::{infer_json_schema_from_iterator, infer_json_schema_from_seekable},
        stream::populate_file_meta,
    },
};
use crate::service::{
    db, schema::schema_evolution, search::datafusion::new_parquet_writer,
    usage::report_compression_stats,
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

        if let Err(e) = metrics_json_to_arrow().await {
            log::error!("Error converting metrics json to arrow : {}", e);
        }
    }

    log::info!("job::files::disk is stopped");
    Ok(())
}

/*
 * upload compressed files to storage & delete moved files from local
 */
pub async fn move_files_to_storage() -> Result<(), anyhow::Error> {
    let wal_dir = Path::new(&CONFIG.common.data_wal_dir)
        .canonicalize()
        .unwrap();

    let pattern = format!("{}files/", &CONFIG.common.data_wal_dir);
    let files = scan_files(&pattern);

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

        // eg: files/default/logs/olympics/0/2023/08/21/08/8b8a5451bbe1c44b/7099303408192061440f3XQ2p.json
        // eg: files/default/traces/default/0/2023/09/04/05/default/service_name=ingester/7104328279989026816guOA4t.json
        // let _ = columns[0].to_string(); // files/
        let org_id = columns[1].to_string();
        let stream_type: StreamType = StreamType::from(columns[2]);
        let stream_name = columns[3].to_string();
        let mut file_name = columns[4].to_string();

        if stream_type.eq(&StreamType::Metrics) && file_name.ends_with(".json") {
            continue;
        }

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
        if db::compact::retention::is_deleting_stream(&org_id, &stream_name, stream_type, None) {
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
    let mut file = fs::File::open(path_str).unwrap();
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

    // metrics
    metrics::INGEST_WAL_READ_BYTES
        .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
        .inc_by(file_size);

    let is_arrow = file_name.ends_with(FILE_EXT_ARROW);

    let arrow_schema;
    let mut batches = vec![];
    if !is_arrow {
        let mut res_records: Vec<json::Value> = vec![];
        let mut schema_reader = BufReader::new(&file);
        let inferred_schema =
            match infer_json_schema_from_seekable(&mut schema_reader, None, stream_type) {
                Ok(inferred_schema) => {
                    drop(schema_reader);
                    inferred_schema
                }
                Err(err) => {
                    // File has some corrupt json data....ignore such data & move rest of the records
                    log::error!(
                        "[JOB] Failed to infer schema from file: {}, error: {}",
                        path_str,
                        err.to_string()
                    );

                    drop(schema_reader);
                    file.seek(SeekFrom::Start(0)).unwrap();
                    let mut json_reader = BufReader::new(&file);
                    let value_reader = arrow::json::reader::ValueIter::new(&mut json_reader, None);
                    for value in value_reader {
                        match value {
                            Ok(val) => {
                                res_records.push(val);
                            }
                            Err(err) => {
                                log::error!(
                                    "[JOB] Failed to parse record: error: {}",
                                    err.to_string()
                                )
                            }
                        }
                    }
                    if res_records.is_empty() {
                        return Err(anyhow::anyhow!(
                            "[JOB] File has corrupt json data: {}",
                            path_str
                        ));
                    }
                    let value_iter = res_records.iter().map(Ok);
                    infer_json_schema_from_iterator(value_iter, stream_type).unwrap()
                }
            };
        arrow_schema = Arc::new(inferred_schema);

        if res_records.is_empty() {
            file.seek(SeekFrom::Start(0)).unwrap();
            let json_reader = BufReader::new(&file);
            let json = ReaderBuilder::new(arrow_schema.clone())
                .build(json_reader)
                .unwrap();
            for batch in json {
                match batch {
                    Ok(batch) => batches.push(batch),
                    Err(err) => {
                        tokio::fs::remove_file(path_str).await?;
                        return Err(anyhow::anyhow!(
                            "[JOB] File has corrupt data: {}, err: {}",
                            path_str,
                            err
                        ));
                    }
                }
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
    } else {
        let stream_reader = StreamReader::try_new(&file, None)?;
        for read_result in stream_reader {
            let record_batch = read_result?;
            batches.push(record_batch);
        }
        let schema = if let Some(first_batch) = batches.first() {
            first_batch.schema()
        } else {
            return Err(anyhow::anyhow!("No record batches found".to_string(),));
        };
        arrow_schema = schema
    }

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
    drop(file);
    let file_name = new_file_name.to_owned();
    match task::spawn_blocking(move || async move {
        storage::put(&new_file_name, bytes::Bytes::from(buf_parquet)).await
    })
    .await
    {
        Ok(output) => match output.await {
            Ok(_) => {
                log::info!("[JOB] disk file upload succeeded: {}", file_name);
                Ok((file_name, file_meta, stream_type))
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
async fn handle_metrics(
    org_id: &str,
    stream_type: StreamType,
    path_str: &str,
) -> Result<Vec<String>, anyhow::Error> {
    let file = fs::File::open(path_str).unwrap();
    let file_meta = file.metadata().unwrap();
    let file_size = file_meta.len();
    let mut arrow_files = vec![];
    log::info!("[JOB] Metrics json data conversion : : {}", path_str);

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
    let reader = BufReader::new(file);

    let mut partitions: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
    for line in reader.lines() {
        let line = line?;
        let inferred_schema =
            infer_json_schema(&mut BufReader::new(line.as_bytes()), None, stream_type).unwrap();
        // get hour key
        let schema_key = get_schema_key_xxh3(&inferred_schema);
        let json: serde_json::Value = serde_json::from_str(&line)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        partitions
            .entry(format!(
                "{}#_#{}",
                schema_key,
                json.get(NAME_LABEL).unwrap().as_str().unwrap()
            ))
            .or_default()
            .push(json);
    }

    for (metric_key, value) in partitions {
        let metric_meta: Vec<&str> = metric_key.split("#_#").collect();
        let metric_name = metric_meta[1].to_owned();
        let schema_key = metric_meta[0].to_owned();
        //let dest_stream_name = metric_name.clone();
        let value_iter = value.iter().map(Ok);
        let metrics_schema = infer_json_schema_from_iterator(value_iter, stream_type).unwrap();

        let local_org_id = org_id.to_owned();
        //let metrics_schema = value.first().unwrap().schema();
        // write metadata
        let mut file_meta = FileMeta {
            min_ts: 0,
            max_ts: 0,
            records: 0,
            original_size: file_size as i64,
            compressed_size: 0,
        };

        let mut json = vec![];
        let mut batches = vec![];
        let mut decoder = ReaderBuilder::new(Arc::new(metrics_schema.clone())).build_decoder()?;
        for value in value {
            decoder
                .decode(json::to_string(&value).unwrap().as_bytes())
                .unwrap();
            json.push(decoder.flush()?.unwrap());
        }
        for batch in json {
            batches.push(batch);
        }
        populate_file_meta(
            Arc::new(metrics_schema.clone()),
            vec![batches.clone()],
            &mut file_meta,
        )
        .await?;
        let key = crate::service::ingestion::get_wal_time_key(
            file_meta.min_ts,
            &vec![],
            PartitionTimeLevel::Daily,
            &json::Map::new(),
            Some(&schema_key),
        );
        schema_evolution(
            org_id,
            &metric_name,
            stream_type,
            Arc::new(metrics_schema.clone()),
            file_meta.min_ts,
        )
        .await;
        match task::spawn_blocking(move || async move {
            let rw_file = crate::common::infra::wal::get_or_create_arrow(
                0,
                StreamParams::new(&local_org_id, &metric_name, StreamType::Metrics),
                None,
                &key,
                false,
                Some(metrics_schema),
            )
            .await;
            let wal_dir = if let Ok(path) = Path::new(&CONFIG.common.data_wal_dir).canonicalize() {
                path.to_str().unwrap().to_string()
            } else {
                return Err(anyhow::anyhow!("Unable to get wal dir"));
            };
            let new_file_name = format!("{wal_dir}/{}", rw_file.wal_name().to_owned());

            for batch in &batches {
                rw_file.write_arrow(batch.clone()).await;
            }
            file_meta.compressed_size = rw_file.size().await as i64;
            Ok(new_file_name) as Result<String, anyhow::Error>
        })
        .await
        {
            Ok(output) => match output.await {
                Ok(new_file_name) => {
                    arrow_files.push(new_file_name.clone());
                    wal::exclude_file(new_file_name).await
                }
                Err(err) => {
                    log::error!("[JOB] disk file conversion error: {:?}", err);
                    return Err(anyhow::anyhow!(err));
                }
            },
            Err(err) => {
                log::error!("[JOB] disk file conversion error: {:?}", err);
                return Err(anyhow::anyhow!(err));
            }
        }
    }
    log::info!("[JOB] disk file conversion succeeded for: {}", &path_str);
    Ok(arrow_files)
}

/*
 * converts single metrics json file to per stream arrow file & delete moved files from local
 */
pub async fn metrics_json_to_arrow() -> Result<(), anyhow::Error> {
    let wal_dir = Path::new(&CONFIG.common.data_wal_dir)
        .canonicalize()
        .unwrap();

    let pattern = format!("{}files/", &CONFIG.common.data_wal_dir);
    let files = scan_files(&pattern);

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

        // eg: files/default/logs/olympics/0/2023/08/21/08/8b8a5451bbe1c44b/7099303408192061440f3XQ2p.json
        // eg: files/default/traces/default/0/2023/09/04/05/default/service_name=ingester/7104328279989026816guOA4t.json
        // let _= columns[0].to_string(); // files/
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
        if db::compact::retention::is_deleting_stream(&org_id, &stream_name, stream_type, None) {
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
            if stream_type.eq(&StreamType::Metrics) && file_name.ends_with(".json") {
                let ret = handle_metrics(&org_id, stream_type, &local_file).await;
                if let Err(e) = ret {
                    log::error!("[JOB] Error while converting json file to arrow {}", e);
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

                match tokio::fs::remove_file(&local_file).await {
                    Ok(_) => wal::remove_excluded_files(ret.as_ref().unwrap().as_ref()).await,
                    Err(e) => {
                        log::error!(
                            "[JOB] Failed to remove json file from disk: {}, {}",
                            local_file,
                            e.to_string()
                        );
                        drop(permit);
                        return Ok(());
                    }
                }
                if let Err(e) = ret {
                    log::error!(
                        "[JOB] Failed to remove json file from disk: {}, {}",
                        local_file,
                        e.to_string()
                    );
                    drop(permit);
                    return Ok(());
                }
            };

            Ok(())
        });
        tasks.push(task);
    }

    for task in tasks {
        if let Err(e) = task.await {
            log::error!(
                "[JOB] metrics_json_to_arrow: Error while converting json to arrow{}",
                e
            );
        };
    }
    Ok(())
}
