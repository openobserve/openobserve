// Copyright 2026 OpenObserve Inc.
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

use std::sync::Arc;

use ::datafusion::{arrow::datatypes::Schema, error::DataFusionError};
use bytes::Bytes;
use config::{
    FileFormat, get_config, ider, is_local_disk_storage,
    meta::stream::{FileKey, FileMeta, StorageType, StreamType},
    metrics,
    utils::{parquet::read_schema_from_bytes, schema_ext::SchemaExt},
};
use hashbrown::{HashMap, HashSet};
use infra::{
    cache::file_data,
    runtime::DATAFUSION_RUNTIME,
    schema::{
        SchemaCache, get_stream_setting_bloom_filter_fields, get_stream_setting_fts_fields,
        get_stream_setting_index_fields,
    },
    storage,
};
use metrics_index::MetricsFileLayout;
use schema::generate_schema_for_defined_schema_fields;
use search::datafusion::{
    exec::TableBuilder,
    merge::{self, MergeMode, MergeOutput, MergeResult, MergedFile},
};
use tantivy_utils::index_builder::{TantivyIndexOptions, create_tantivy_index};
use tokio::sync::Semaphore;

/// Returns the new files and the files to retire: the merged inputs plus those whose blob is gone.
pub async fn merge_files(
    thread_id: usize,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    prefix: &str,
    files_with_size: &[FileKey],
    mode: &MergeMode,
) -> Result<(Vec<FileKey>, Vec<FileKey>), anyhow::Error> {
    let start = std::time::Instant::now();
    // a whole-batch mode (downsampling) merges everything it is given, even a
    // single file; otherwise 0/1 files means nothing to do
    let merge_whole_batch = mode.merges_whole_batch();
    if files_with_size.len() <= 1 && !merge_whole_batch {
        return Ok((Vec::new(), Vec::new()));
    }

    let mut new_file_size = 0;
    let mut new_compressed_file_size = 0;
    let mut new_file_list = Vec::new();
    let cfg = get_config();
    for file in files_with_size.iter() {
        if (new_file_size + file.meta.original_size > cfg.compact.max_file_size as i64
            || new_compressed_file_size + file.meta.compressed_size
                > cfg.compact.max_file_size as i64)
            && !merge_whole_batch
        {
            break;
        }
        new_file_size += file.meta.original_size;
        new_compressed_file_size += file.meta.compressed_size;
        new_file_list.push(file.clone());
        // metrics
        metrics::COMPACT_MERGED_FILES
            .with_label_values(&[org_id, stream_type.as_str()])
            .inc();
        metrics::COMPACT_MERGED_BYTES
            .with_label_values(&[org_id, stream_type.as_str()])
            .inc_by(file.meta.original_size as u64);
    }
    // no files need to merge
    if new_file_list.len() <= 1 && !merge_whole_batch {
        return Ok((Vec::new(), Vec::new()));
    }

    // cache parquet files
    let planned = new_file_list.len();
    let gone_files = cache_remote_files(&mut new_file_list).await?;
    log::info!(
        "[COMPACTOR:WORKER:{thread_id}] download {planned} parquet files, took: {} ms",
        start.elapsed().as_millis()
    );
    // survivors of a merge that produced no output stay; gone rows are still deleted
    if new_file_list.is_empty() || (new_file_list.len() <= 1 && !merge_whole_batch) {
        return Ok((Vec::new(), gone_files));
    }
    // only files that passed the storage check feed the output
    let merged_files = new_file_list.clone();

    // get time range and stats for these files in a single iteration
    let (min_ts, max_ts, total_records, new_file_size) = new_file_list.iter().fold(
        (i64::MAX, i64::MIN, 0, 0),
        |(min_ts, max_ts, records, size), file| {
            (
                min_ts.min(file.meta.min_ts),
                max_ts.max(file.meta.max_ts),
                records + file.meta.records,
                size + file.meta.original_size,
            )
        },
    );
    let min_ts = if min_ts == i64::MAX { 0 } else { min_ts };
    let max_ts = if max_ts == i64::MIN { 0 } else { max_ts };
    let new_file_meta = FileMeta {
        min_ts,
        max_ts,
        records: total_records,
        original_size: new_file_size,
        compressed_size: 0,
        flattened: false,
        index_size: 0,
        bloom_ver: 0,
    };
    if new_file_meta.records == 0 {
        return Err(anyhow::anyhow!("merge_files error: records is 0"));
    }

    // get latest version of schema
    let latest_schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    let stream_settings = infra::schema::unwrap_stream_settings(&latest_schema);
    let bloom_filter_fields = get_stream_setting_bloom_filter_fields(&stream_settings);
    let full_text_search_fields = get_stream_setting_fts_fields(&stream_settings);
    let index_fields = get_stream_setting_index_fields(&stream_settings);
    let (defined_schema_fields, need_original, index_original_data, index_all_values, storage_type) =
        match stream_settings {
            Some(s) => (
                s.defined_schema_fields,
                s.store_original_data,
                s.index_original_data,
                s.index_all_values,
                s.storage_type,
            ),
            None => (Vec::new(), false, false, false, StorageType::Normal),
        };
    let latest_schema = if !defined_schema_fields.is_empty() {
        let latest_schema = SchemaCache::new(latest_schema);
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
        Arc::new(latest_schema)
    };

    // read schema from parquet file and group files by schema
    let mut schemas = HashMap::new();
    let files = new_file_list.clone();
    let mut fi = 0;
    for file in new_file_list.iter() {
        fi += 1;
        log::info!(
            "[COMPACTOR:WORKER:{thread_id}:{fi}] merge small file: {}",
            file.key
        );
        let buf = file_data::get(&file.account, &file.key, None).await?;
        let file_format = FileFormat::from_extension(&file.key)
            .ok_or_else(|| anyhow::anyhow!("invalid file format: {}", file.key))?;
        let schema = match read_schema_from_bytes(file_format, &buf).await {
            Ok(schema) => schema,
            Err(e) => {
                log::error!(
                    "[COMPACTOR:WORKER:{thread_id}:{fi}] read schema error for file: {}, err: {e}",
                    file.key
                );
                return Err(e);
            }
        };
        let schema = schema.as_ref().clone().with_metadata(Default::default());
        let schema_key = schema.hash_key();
        if !schemas.contains_key(&schema_key) {
            schemas.insert(schema_key.clone(), schema);
        }
    }

    // generate the parquet schema
    let all_fields = schemas
        .values()
        .flat_map(|s| s.fields().iter().map(|f| f.name().to_string()))
        .collect::<HashSet<_>>();
    let schema = Arc::new(latest_schema.retain(all_fields));

    // generate datafusion tables
    let trace_id = ider::generate();
    let session = config::meta::search::Session {
        id: trace_id.to_string(),
        storage_type: config::meta::search::StorageType::Memory,
        work_group: None,
        target_partitions: 2,
    };

    let input_sort_order = mode.input_sort_order(&files);
    log::debug!(
        "[COMPACTOR:WORKER:{thread_id}] merge [{mode}] input sort order: {input_sort_order}, files: {}",
        files.len()
    );
    let tables = match TableBuilder::new()
        .sort_order(input_sort_order)
        .build(session, files.clone(), schema.clone())
        .await
    {
        Ok(tables) => tables,
        Err(e) => {
            log::error!("create_parquet_table err: {e}, files: {files:?}, schema: {schema:?}");
            return Err(DataFusionError::Plan(format!("create_parquet_table err: {e}")).into());
        }
    };

    let merge_result = {
        let mode = mode.clone();
        let output = MergeOutput::for_compactor(stream_type).with_file_key_prefix(prefix);
        DATAFUSION_RUNTIME
            .spawn(async move {
                merge::merge_parquet_files(
                    schema,
                    tables,
                    &bloom_filter_fields,
                    new_file_meta,
                    &mode,
                    output,
                )
                .await
            })
            .await?
    };

    // clear session data
    search::datafusion::storage::file_list::clear(&trace_id);

    let files = new_file_list.into_iter().map(|f| f.key).collect::<Vec<_>>();
    let buf = match merge_result {
        Ok(v) => v,
        Err(e) => {
            log::error!("merge_parquet_files err: {e}, files: {files:?}");
            return Err(DataFusionError::Plan(format!("merge_parquet_files err: {e}")).into());
        }
    };

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
    }

    let storage_tier = if cfg.s3.feature_force_infrequent_access && storage_type.is_compliance() {
        storage::StorageTier::InfrequentAccess
    } else {
        storage::StorageTier::Default
    };

    let MergeResult {
        files: outputs,
        file_format,
    } = buf;
    // an empty result would delete the source files without a replacement
    if outputs.is_empty() {
        return Err(anyhow::anyhow!(
            "merge_parquet_files error: produced no files"
        ));
    }
    let mut new_files = Vec::with_capacity(outputs.len());
    for file in outputs {
        let id = ider::generate_file_name();
        let new_file_key = file.file_key(prefix, &id, file_format)?;
        let account = storage::get_account(org_id, &new_file_key).unwrap_or_default();
        let cache_locally = cfg.cache_latest_files.enabled
            && cfg.cache_latest_files.cache_parquet
            && cfg.cache_latest_files.download_from_node;
        let account_ref = &account;
        let (buf, mut new_file_meta) = publish_merged_output(
            file,
            &new_file_key,
            cache_locally,
            |key, bytes| async move {
                storage::put_with_tier(account_ref, &key, bytes, storage_tier)
                    .await
                    .map_err(anyhow::Error::from)
            },
        )
        .await?;

        if cfg.search.inverted_index_enabled && stream_type.support_index() && need_index {
            generate_inverted_index(
                org_id,
                &new_file_key,
                &full_text_search_fields,
                &index_fields,
                &merged_files,
                &mut new_file_meta,
                latest_schema.clone(),
                buf,
                storage_tier,
            )
            .await?;
        }
        new_files.push(FileKey::new(0, account, new_file_key, new_file_meta, false));
    }
    log::info!(
        "[COMPACTOR:WORKER:{thread_id}] merged {} files into {} new file(s): {:?}, original_size: {}, compressed_size: {}, took: {} ms",
        merged_files.len(),
        new_files.len(),
        new_files.iter().map(|f| f.key.as_str()).collect::<Vec<_>>(),
        new_files.iter().map(|f| f.meta.original_size).sum::<i64>(),
        new_files
            .iter()
            .map(|f| f.meta.compressed_size)
            .sum::<i64>(),
        start.elapsed().as_millis(),
    );

    let mut retire_files = merged_files;
    retire_files.extend(gone_files);
    Ok((new_files, retire_files))
}

#[allow(clippy::too_many_arguments)]
async fn generate_inverted_index(
    org_id: &str,
    new_file_key: &str,
    fts_fields: &[String],
    index_fields: &[String],
    merged_files: &[FileKey],
    new_file_meta: &mut FileMeta,
    latest_schema: Arc<Schema>,
    buf: Bytes,
    storage_tier: storage::StorageTier,
) -> Result<(), anyhow::Error> {
    let index_size = create_tantivy_index(
        TantivyIndexOptions {
            caller: "COMPACTOR",
            org_id,
            data_file_name: new_file_key,
            storage_tier,
        },
        fts_fields,
        index_fields,
        latest_schema, // Use stream schema to include all configured fields
        buf,
    )
    .await
    .map_err(|e| {
        anyhow::anyhow!(
            "create_tantivy_index_on_compactor for file: {new_file_key}, error: {e}, need delete files: {merged_files:?}",
        )
    })?;
    new_file_meta.index_size = index_size as i64;

    Ok(())
}

/// Refreshes sizes in place, drops gone and skipped files, and returns the gone ones.
async fn cache_remote_files(files: &mut Vec<FileKey>) -> Result<Vec<FileKey>, anyhow::Error> {
    let cfg = get_config();
    let scan_size = files.iter().map(|f| f.meta.compressed_size).sum::<i64>();
    if is_local_disk_storage()
        || !cfg.disk_cache.enabled
        || scan_size >= cfg.disk_cache.skip_size as i64
    {
        return Ok(Vec::new());
    };

    let mut tasks = Vec::with_capacity(files.len());
    let semaphore = std::sync::Arc::new(Semaphore::new(cfg.limit.cpu_num));
    for file in files.iter() {
        let file_account = file.account.to_string();
        let file_name = file.key.to_string();
        let file_size = file.meta.compressed_size as usize;
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let task: tokio::task::JoinHandle<(String, Result<usize, anyhow::Error>)> =
            tokio::task::spawn(async move {
                let ret = if !file_data::disk::exist(&file_name).await {
                    file_data::disk::download(&file_account, &file_name, Some(file_size)).await
                } else {
                    Ok(0)
                };
                drop(permit);
                (file_name, ret)
            });
        tasks.push(task);
    }

    let mut gone_files = Vec::new();
    for task in tasks {
        let (key, ret) = match task.await {
            Ok(v) => v,
            Err(e) => {
                log::error!("[COMPACTOR] load file task err: {e}");
                continue;
            }
        };
        // a failed download may have left a partial entry in the disk cache
        if ret.is_err() {
            let _ = file_data::disk::remove(&key).await;
        }
        if let Some(gone) = settle_download(files, &key, ret) {
            gone_files.push(gone);
        }
    }

    Ok(gone_files)
}

/// Applies one download result to the merge inputs; returns the file when its blob is gone.
fn settle_download(
    files: &mut Vec<FileKey>,
    key: &str,
    ret: Result<usize, anyhow::Error>,
) -> Option<FileKey> {
    let pos = files.iter().position(|f| f.key == key)?;
    let e = match ret {
        Ok(data_len) => {
            let planned = files[pos].meta.compressed_size;
            // file_list was corrected by the downloader; DataFusion reads the footer at this size
            if data_len > 0 && data_len as i64 != planned {
                log::warn!(
                    "[COMPACT] download file {key} found size mismatch, expected: {planned}, actual: {data_len}, using actual size"
                );
                files[pos].meta.compressed_size = data_len as i64;
            }
            return None;
        }
        Err(e) => e,
    };
    let msg = e.to_string().to_lowercase();
    if msg.contains("not found")
        || msg.contains("data size is zero")
        || msg.contains("is corrupted")
    {
        log::error!("[COMPACT] found invalid file: {key}, will delete it, err: {e}");
        Some(files.remove(pos))
    } else {
        log::warn!("[COMPACT] download file to cache err: {e}, skip file: {key}");
        files.remove(pos);
        None
    }
}

async fn publish_merged_output<F>(
    file: MergedFile,
    key: &str,
    cache_locally: bool,
    put: impl Fn(String, Bytes) -> F,
) -> anyhow::Result<(Bytes, FileMeta)>
where
    F: Future<Output = anyhow::Result<()>>,
{
    let (data, mut meta, index_path) = file.into_upload_parts().await?;
    let bytes = Bytes::from(data);
    meta.compressed_size = i64::try_from(bytes.len())?;
    anyhow::ensure!(
        meta.compressed_size > 0,
        "merge output compressed size is zero"
    );
    let index = if let Some(path) = index_path {
        let index_key = MetricsFileLayout::metrics_index_path(key)
            .ok_or_else(|| anyhow::anyhow!("metrics index for non-indexed file {key}"))?;
        Some((index_key, Bytes::from(tokio::fs::read(&path).await?)))
    } else {
        None
    };
    if cache_locally {
        infra::cache::file_data::disk::set(key, bytes.clone()).await?;
    }
    put(key.to_string(), bytes.clone()).await?;
    if let Some((key, index)) = index {
        put(key, index).await?;
    }
    Ok((bytes, meta))
}

#[cfg(test)]
mod tests {
    use config::meta::stream::FileMeta;

    use super::*;

    const PLANNED_SIZE: usize = 1024;

    async fn produced_indexed_output() -> MergedFile {
        use datafusion::{
            arrow::{
                array::{Float64Array, Int64Array, RecordBatch, StringArray, UInt64Array},
                datatypes::{DataType, Field, Schema},
            },
            datasource::MemTable,
        };
        let schema = Arc::new(Schema::new(vec![
            Field::new("__hash__", DataType::UInt64, false),
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("value", DataType::Float64, false),
            Field::new("tag", DataType::Utf8, true),
        ]));
        let batch = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(UInt64Array::from(vec![1, 1])),
                Arc::new(Int64Array::from(vec![10, 20])),
                Arc::new(Float64Array::from(vec![1., 2.])),
                Arc::new(StringArray::from(vec!["x", "x"])),
            ],
        )
        .unwrap();
        let table = Arc::new(MemTable::try_new(Arc::clone(&schema), vec![vec![batch]]).unwrap());
        let mut output = MergeOutput::for_compactor(StreamType::Metrics)
            .with_file_key_prefix("files/publish/metrics/m/2026/09/20/00");
        output.file_format = FileFormat::Parquet;
        output.metrics_blocks_enabled = true;
        merge::merge_parquet_files(
            schema,
            vec![table],
            &[],
            FileMeta {
                records: 2,
                original_size: 128,
                ..Default::default()
            },
            &MergeMode::MetricsIndexed,
            output,
        )
        .await
        .unwrap()
        .files
        .remove(0)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn single_pass_publication_returns_only_after_data_and_index_uploads() {
        for fail_at in [None, Some(0usize), Some(1)] {
            let file = produced_indexed_output().await;
            let key = file
                .file_key(
                    "files/publish/metrics/m/2026/09/20/00",
                    "unused",
                    FileFormat::Parquet,
                )
                .unwrap();
            let paths = match &file {
                MergedFile::MetricsIndexed {
                    data_path,
                    metrics_index_path,
                    ..
                } => vec![data_path.to_path_buf(), metrics_index_path.to_path_buf()],
                _ => panic!("indexed output expected"),
            };
            let puts = Arc::new(std::sync::Mutex::new(Vec::new()));
            let received = Arc::clone(&puts);
            let result = publish_merged_output(file, &key, false, move |name, bytes| {
                let received = Arc::clone(&received);
                async move {
                    let mut entries = received.lock().unwrap();
                    let position = entries.len();
                    entries.push((name, bytes));
                    anyhow::ensure!(fail_at != Some(position), "injected publication failure");
                    Ok(())
                }
            })
            .await;
            assert_eq!(result.is_ok(), fail_at.is_none());
            let puts = puts.lock().unwrap();
            assert_eq!(puts.len(), if fail_at == Some(0) { 1 } else { 2 });
            assert!(puts[0].0.ends_with(".parquet"));
            if puts.len() == 2 {
                assert!(puts[1].0.ends_with(".midx"));
                assert!(!puts[1].1.starts_with(b"ARROW1"));
            }
            assert!(paths.iter().all(|path| !path.exists()));
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn single_pass_materialization_failure_precedes_all_publication() {
        let file = produced_indexed_output().await;
        let key = file
            .file_key(
                "files/publish/metrics/m/2026/09/20/00",
                "unused",
                FileFormat::Parquet,
            )
            .unwrap();
        if let MergedFile::MetricsIndexed {
            metrics_index_path, ..
        } = &file
        {
            std::fs::remove_file(metrics_index_path).unwrap();
        }
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let calls = Arc::clone(&count);
        let result = publish_merged_output(file, &key, false, move |_, _| {
            calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async { Ok(()) }
        })
        .await;
        assert!(result.is_err());
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 0);
    }

    fn planned_file(key: &str) -> FileKey {
        FileKey::new(
            0,
            "default".to_string(),
            key.to_string(),
            FileMeta {
                compressed_size: PLANNED_SIZE as i64,
                ..Default::default()
            },
            false,
        )
    }

    fn planned_files() -> Vec<FileKey> {
        vec![planned_file("a.parquet"), planned_file("b.parquet")]
    }

    fn keys(files: &[FileKey]) -> Vec<&str> {
        files.iter().map(|f| f.key.as_str()).collect()
    }

    #[test]
    fn settle_download_refreshes_size_on_ok() {
        let mut files = planned_files();
        let gone = settle_download(&mut files, "a.parquet", Ok(PLANNED_SIZE + 1));
        assert!(gone.is_none());
        let sizes: Vec<i64> = files.iter().map(|f| f.meta.compressed_size).collect();
        assert_eq!(sizes, vec![PLANNED_SIZE as i64 + 1, PLANNED_SIZE as i64]);
    }

    #[test]
    fn settle_download_keeps_planned_size_on_matching_ok() {
        let mut files = planned_files();
        let gone = settle_download(&mut files, "a.parquet", Ok(PLANNED_SIZE));
        assert!(gone.is_none());
        assert_eq!(keys(&files), vec!["a.parquet", "b.parquet"]);
        assert!(
            files
                .iter()
                .all(|f| f.meta.compressed_size == PLANNED_SIZE as i64)
        );
    }

    #[test]
    fn settle_download_keeps_planned_size_on_cache_hit() {
        let mut files = planned_files();
        let gone = settle_download(&mut files, "a.parquet", Ok(0));
        assert!(gone.is_none());
        assert_eq!(keys(&files), vec!["a.parquet", "b.parquet"]);
        assert!(
            files
                .iter()
                .all(|f| f.meta.compressed_size == PLANNED_SIZE as i64)
        );
    }

    #[test]
    fn settle_download_removes_and_returns_not_found() {
        let mut files = planned_files();
        let ret = Err(anyhow::anyhow!("file a.parquet Not Found"));
        let gone = settle_download(&mut files, "a.parquet", ret);
        assert_eq!(gone.map(|f| f.key), Some("a.parquet".to_string()));
        assert_eq!(keys(&files), vec!["b.parquet"]);
    }

    #[test]
    fn settle_download_removes_and_returns_zero_size() {
        let mut files = planned_files();
        let ret = Err(anyhow::anyhow!("file b.parquet data size is zero"));
        let gone = settle_download(&mut files, "b.parquet", ret);
        assert_eq!(gone.map(|f| f.key), Some("b.parquet".to_string()));
        assert_eq!(keys(&files), vec!["a.parquet"]);
    }

    #[test]
    fn settle_download_removes_and_returns_corrupted() {
        let mut files = planned_files();
        let ret = Err(anyhow::anyhow!("file b.parquet is corrupted in blob store"));
        let gone = settle_download(&mut files, "b.parquet", ret);
        assert_eq!(gone.map(|f| f.key), Some("b.parquet".to_string()));
        assert_eq!(keys(&files), vec!["a.parquet"]);
    }

    #[test]
    fn settle_download_skips_unrelated_error_without_retiring() {
        let mut files = planned_files();
        let ret = Err(anyhow::anyhow!("connection reset by peer"));
        let gone = settle_download(&mut files, "a.parquet", ret);
        assert!(gone.is_none());
        assert_eq!(keys(&files), vec!["b.parquet"]);
    }

    #[test]
    fn settle_download_ignores_unknown_key() {
        let mut files = planned_files();
        let ret = Err(anyhow::anyhow!("file c.parquet Not Found"));
        let gone = settle_download(&mut files, "c.parquet", ret);
        assert!(gone.is_none());
        assert_eq!(files.len(), 2);
    }
}
