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

use std::{collections::HashMap, io::Cursor, path::Path, sync::Arc, time::UNIX_EPOCH};

use anyhow::Context;
use arrow::{
    array::{ArrayRef, BooleanArray, Int64Array, StringArray},
    record_batch::RecordBatch,
};
use arrow_schema::{DataType, Schema, SchemaRef};
use bytes::Bytes;
use chrono::{Duration, Utc};
use config::{
    cluster,
    meta::stream::{FileKey, FileMeta, PartitionTimeLevel, StreamType},
    metrics,
    utils::{
        asynchronism::file::{get_file_contents, get_file_meta},
        file::scan_files,
        json,
        parquet::read_metadata_from_file,
        schema_ext::SchemaExt,
    },
    FxIndexMap, CONFIG, DEFAULT_INDEX_TRIM_CHARS, INDEX_MIN_CHAR_LEN,
};
use datafusion::{arrow::json as arrow_json, datasource::MemTable, prelude::*};
use infra::{cache, storage};
use parquet::arrow::ParquetRecordBatchStreamBuilder;
use tokio::{sync::Semaphore, task::JoinHandle, time};

use crate::{
    common::{infra::wal, meta::stream::SchemaRecords},
    job::files::idx::write_to_disk,
    service::{
        db,
        schema::SchemaCache,
        search::datafusion::{
            exec::merge_parquet_files, string_to_array_v2_udf::STRING_TO_ARRAY_V2_UDF,
        },
        stream::{self},
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
    let mut files = scan_files(&pattern, "parquet");
    if files.is_empty() {
        return Ok(());
    }
    log::debug!("[INGESTER:JOB] move files get: {}", files.len());
    if files.len() > CONFIG.limit.file_push_limit {
        files.sort();
        files.truncate(CONFIG.limit.file_push_limit);
    }

    // do partition by partition key
    let mut partition_files_with_size: FxIndexMap<String, Vec<FileKey>> = FxIndexMap::default();
    for file in files {
        let Ok(parquet_meta) = read_metadata_from_file(&(&file).into()).await else {
            continue;
        };
        if parquet_meta.eq(&FileMeta::default()) {
            log::warn!(
                "[INGESTER:JOB] the file is empty, just delete file: {}",
                file
            );
            if let Err(e) = tokio::fs::remove_file(wal_dir.join(&file)).await {
                log::error!(
                    "[INGESTER:JOB] Failed to remove parquet file from disk: {}, {}",
                    file,
                    e
                );
            }
            continue;
        }
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
        if db::compact::retention::is_deleting_stream(&org_id, stream_type, &stream_name, None) {
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
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .context("[INGESTER:JOB] Failed to acquire semaphore for file uploading")?;
        let task: JoinHandle<Result<(), anyhow::Error>> = tokio::task::spawn(async move {
            // sort by created time
            let mut files_with_size = files_with_size.to_owned();
            files_with_size.sort_by(|a, b| a.meta.min_ts.cmp(&b.meta.min_ts));
            // check the total size
            let total_original_size: i64 = files_with_size
                .iter()
                .map(|f| f.meta.original_size)
                .sum::<i64>();
            if total_original_size < CONFIG.limit.max_file_size_on_disk as i64 {
                let mut has_expired_files = false;
                // not enough files to upload, check if some files are too old
                let min_ts = Utc::now().timestamp_micros()
                    - Duration::try_seconds(CONFIG.limit.max_file_retention_time as i64)
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
                    drop(permit);
                    return Ok(());
                }
            }

            // get latest schema
            let latest_schema = db::schema::get(&org_id, &stream_name, stream_type)
                .await
                .map_err(|e| {
                    log::error!(
                        "[INGESTER:JOB] Failed to get latest schema for stream [{}/{}/{}]: {}",
                        &org_id,
                        stream_type,
                        &stream_name,
                        e
                    );
                    e
                })?;

            // start merge files and upload to s3
            loop {
                // yield to other tasks
                tokio::task::yield_now().await;
                // merge file and get the big file key
                let (new_file_name, new_file_meta, new_file_list) =
                    match merge_files(&latest_schema, &wal_dir, &files_with_size).await {
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
) -> Result<(String, FileMeta, Vec<FileKey>), anyhow::Error> {
    if files_with_size.is_empty() {
        return Ok((String::from(""), FileMeta::default(), Vec::new()));
    }

    let mut new_file_size: i64 = 0;
    let mut new_file_list = Vec::new();
    let mut deleted_files = Vec::new();
    for file in files_with_size.iter() {
        if new_file_size > 0
            && new_file_size + file.meta.original_size > CONFIG.compact.max_file_size as i64
        {
            break;
        }
        new_file_size += file.meta.original_size;
        new_file_list.push(file.clone());
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

    // merge files
    let bloom_filter_fields =
        stream::get_stream_setting_bloom_filter_fields(latest_schema).unwrap();
    let full_text_search_fields = stream::get_stream_setting_fts_fields(latest_schema).unwrap();
    let mut buf = Vec::new();
    let mut fts_buf = Vec::new();
    let (mut new_file_meta, _) = match merge_parquet_files(
        tmp_dir.name(),
        stream_type,
        &stream_name,
        &mut buf,
        Arc::new(file_schema.unwrap()),
        &bloom_filter_fields,
        &full_text_search_fields,
        new_file_size,
        &mut fts_buf,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            log::error!(
                "[INGESTER:JOB]  merge_parquet_files error for stream -> '{}/{}/{}'",
                org_id,
                stream_type,
                stream_name
            );
            log::error!("[INGESTER:JOB] {} for files {:?}", e, retain_file_list);
            return Err(e.into());
        }
    };
    new_file_meta.original_size = new_file_size;
    new_file_meta.compressed_size = buf.len() as i64;
    if new_file_meta.records == 0 {
        return Err(anyhow::anyhow!(
            "merge_parquet_files error: records is 0 for org {} stream type {} stream {}",
            org_id,
            stream_type,
            stream_name
        ));
    }
    if new_file_meta.compressed_size == 0 {
        return Err(anyhow::anyhow!(
            "merge_parquet_files error: compressed_size is 0"
        ));
    }
    let new_file_key =
        super::generate_storage_file_name(&org_id, stream_type, &stream_name, &file_name);
    log::info!(
        "[INGESTER:JOB] merge file succeeded, {} files into a new file: {}, original_size: {}, compressed_size: {}",
        retain_file_list.len(),
        new_file_key,
        new_file_meta.original_size,
        new_file_meta.compressed_size,
    );

    let buf = Bytes::from(buf);

    // upload file
    match storage::put(&new_file_key, buf).await {
        Ok(_) => {
            if CONFIG.common.inverted_index_enabled && stream_type != StreamType::Index {
                generate_index_on_ingester(fts_buf, new_file_key.clone(), &org_id, &stream_name)
                    .await
                    .map_err(|e| anyhow::anyhow!("generate_index_on_ingester error: {}", e))?;
            }
            Ok((new_file_key, new_file_meta, retain_file_list))
        }
        Err(e) => Err(e),
    }
}

/// Create an inverted index file for the given file
pub(crate) async fn generate_index_on_ingester(
    buf: Vec<RecordBatch>,
    new_file_key: String,
    org_id: &str,
    stream_name: &str,
) -> Result<(), anyhow::Error> {
    let mut data_buf: HashMap<String, SchemaRecords> = HashMap::new();

    let index_record_batches =
        prepare_index_record_batches_v1(buf, org_id, stream_name, &new_file_key).await?;
    let record_batches: Vec<&RecordBatch> = index_record_batches.iter().flatten().collect();
    if record_batches.is_empty() {
        return Ok(());
    }
    let idx_schema: SchemaRef = record_batches.first().unwrap().schema();

    let mut schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let schema_chk = crate::service::schema::stream_schema_exists(
        org_id,
        stream_name,
        StreamType::Index,
        &mut schema_map,
    )
    .await;

    if !schema_chk.has_fields {
        db::schema::set(
            org_id,
            stream_name,
            StreamType::Index,
            idx_schema.as_ref(),
            Some(Utc::now().timestamp_micros()),
            false,
        )
        .await
        .unwrap();
    }
    let schema_key = idx_schema.hash_key();
    let schema_key_str = schema_key.as_str();

    let json_rows = arrow_json::writer::record_batches_to_json_rows(&record_batches)?;
    let recs: Vec<json::Value> = json_rows.into_iter().map(json::Value::Object).collect();
    for record_val in recs {
        let timestamp: i64 = record_val
            .get(&CONFIG.common.column_timestamp)
            .unwrap()
            .as_i64()
            .unwrap();

        let hour_key = crate::service::ingestion::get_wal_time_key(
            timestamp,
            &Vec::new(),
            PartitionTimeLevel::Hourly,
            &json::Map::new(),
            Some(schema_key_str),
        );

        let hour_buf = data_buf.entry(hour_key).or_insert_with(|| SchemaRecords {
            schema_key: schema_key.to_string(),
            schema: idx_schema.clone(),
            records: vec![],
            records_size: 0,
        });

        let record_size = json::estimate_json_bytes(&record_val);
        hour_buf.records.push(Arc::new(record_val));
        hour_buf.records_size += record_size;
    }
    let writer = ingester::get_writer(0, org_id, &StreamType::Index.to_string()).await;
    let _ = crate::service::ingestion::write_file(&writer, stream_name, data_buf).await;
    if let Err(e) = writer.sync().await {
        log::error!("ingestion error while syncing writer: {}", e);
    }
    log::info!("[INGESTER:JOB] Written index wal file successfully");
    Ok(())
}

/// Create an inverted index file for the given file
pub(crate) async fn generate_index_on_compactor(
    file_list_to_invalidate: &[FileKey],
    buf: Vec<RecordBatch>,
    new_file_key: String,
    org_id: &str,
    stream_name: &str,
) -> Result<(String, FileMeta), anyhow::Error> {
    let mut index_record_batches =
        prepare_index_record_batches_v1(buf, org_id, stream_name, &new_file_key).await?;
    let schema = if let Some(first_batch) = index_record_batches.first() {
        first_batch[0].schema()
    } else {
        return Ok((String::new(), FileMeta::default()));
    };

    let prefix_to_remove = format!("files/{}/logs/{}/", org_id, stream_name);
    let len_of_columns_to_invalidate = file_list_to_invalidate.len();
    let empty_terms: ArrayRef = Arc::new(StringArray::from(vec![
        None::<String>;
        len_of_columns_to_invalidate
    ]));
    let file_names: ArrayRef = Arc::new(StringArray::from(
        file_list_to_invalidate
            .iter()
            .map(|x| x.key.trim_start_matches(&prefix_to_remove).to_string())
            .collect::<Vec<String>>(),
    ));
    let _timestamp: ArrayRef = Arc::new(Int64Array::from(
        file_list_to_invalidate
            .iter()
            .map(|x| x.meta.min_ts)
            .collect::<Vec<i64>>(),
    ));
    let count: ArrayRef = Arc::new(Int64Array::from(vec![
        None::<i64>;
        len_of_columns_to_invalidate
    ]));
    let deleted: ArrayRef = Arc::new(BooleanArray::from(vec![true; len_of_columns_to_invalidate]));
    let columns = vec![empty_terms, file_names, _timestamp, count, deleted];
    let batch = RecordBatch::try_new(schema, columns).unwrap();
    index_record_batches.push(vec![batch]);

    let record_batches_flattened = index_record_batches.into_iter().flatten().collect();

    let original_file_size = 0; // The file never existed before this function was called
    let (filename, filemeta, _stream_type) = write_to_disk(
        record_batches_flattened,
        original_file_size,
        org_id,
        stream_name,
        StreamType::Index,
        &new_file_key,
        "index_creator",
    )
    .await?;

    log::debug!("[COMPACTOR:JOB] Written index file successfully");
    Ok((filename, filemeta))
}

async fn prepare_index_record_batches_v1(
    batches: Vec<RecordBatch>, // 10 fields index
    org_id: &str,
    stream_name: &str,
    new_file_key: &str,
) -> Result<Vec<Vec<RecordBatch>>, anyhow::Error> {
    if batches.is_empty() {
        return Ok(vec![]);
    }
    let local = batches.first().unwrap().schema();
    let ctx = SessionContext::new();
    let provider = MemTable::try_new(local.clone(), vec![batches])?;
    ctx.register_table("_tbl_raw_data", Arc::new(provider))?;
    let prefix_to_remove = format!("files/{}/logs/{}/", org_id, stream_name);
    let file_name_without_prefix = new_file_key.trim_start_matches(&prefix_to_remove);
    let mut indexed_record_batches_to_merge = Vec::new();
    for column in local.fields().iter() {
        // 1500 columns --> 100 columns of inverted index
        let index_df = ctx.table("_tbl_raw_data").await?;

        if column.data_type() != &DataType::Utf8 {
            continue;
        }

        let column_name = column.name();
        let split_chars = &CONFIG.common.inverted_index_split_chars;

        let remove_chars_btrim = DEFAULT_INDEX_TRIM_CHARS;
        let lower_case_expr = lower(concat(&[col(column_name), lit("")]));
        let split_arr = STRING_TO_ARRAY_V2_UDF.call(vec![lower_case_expr, lit(split_chars)]);
        let distinct_terms = array_distinct(split_arr);

        let record_batch = index_df
            .with_column("terms", distinct_terms)?
            .unnest_column("terms")?
            .with_column_renamed("terms", "term")?
            .with_column("term", btrim(vec![col("term"), lit(remove_chars_btrim)]))?
            .with_column("file_name", lit(file_name_without_prefix))?
            .aggregate(
                vec![col("term"), col("file_name")],
                vec![
                    min(col("_timestamp")).alias("_timestamp"),
                    count(col("term")).alias("_count"),
                ],
            )?
            .with_column("character_len", character_length(col("term")))?
            .with_column("deleted", lit(false))?
            .filter(col("character_len").gt_eq(lit(INDEX_MIN_CHAR_LEN as i32)))?
            .select_columns(&["term", "file_name", "_timestamp", "_count", "deleted"])?
            .collect()
            .await?;

        indexed_record_batches_to_merge.push(record_batch);
    }
    ctx.deregister_table("_tbl_raw_data")?;
    Ok(indexed_record_batches_to_merge)
}
