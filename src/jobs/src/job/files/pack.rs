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

//! Pack mover: uploads wal pack segments (see `ingester::pack`) to object
//! storage. Counterpart of the legacy mover in `parquet.rs`, but sourced from
//! the in-memory segment index instead of directory scans. A single segment
//! is uploaded as-is (already a complete parquet file), multiple segments are
//! merged in memory; consumed packs are deleted.

use std::{collections::BTreeMap, sync::Arc};

use arrow_schema::Schema;
use bytes::Bytes;
use chrono::Duration;
use config::{
    FileFormat, cluster, get_config,
    meta::stream::{FileMeta, StreamType},
    metrics,
    utils::{parquet::generate_filename_with_time_range, schema_ext::SchemaExt, time::now_micros},
};
use datafusion::datasource::{MemTable, TableProvider};
use db;
use hashbrown::{HashMap, HashSet};
use infra::{
    schema::{
        get_stream_setting_bloom_filter_fields, get_stream_setting_fts_fields,
        get_stream_setting_index_fields,
    },
    storage,
};
use ingester::{PackSegment, PendingStreamStats};
use schema::generate_schema_for_defined_schema_fields;
use search::datafusion::merge::{self, MergeParquetResult};
use tantivy_utils::index_builder::create_tantivy_index;
use tokio::sync::{Mutex, RwLock};

static PROCESSING_STREAMS: std::sync::LazyLock<RwLock<HashSet<String>>> =
    std::sync::LazyLock::new(|| RwLock::new(HashSet::new()));

pub async fn run() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let (tx, rx) = tokio::sync::mpsc::channel::<PendingStreamStats>(1);
    let rx = Arc::new(Mutex::new(rx));
    for thread_id in 0..cfg.limit.file_move_thread_num {
        let rx = rx.clone();
        tokio::spawn(async move {
            loop {
                let ret = rx.lock().await.recv().await;
                match ret {
                    None => {
                        log::debug!("[INGESTER:PACK:JOB] receiving streams channel is closed");
                        break;
                    }
                    Some(ps) => {
                        let stream_key =
                            format!("{}/{}/{}", ps.org_id, ps.stream_type, ps.stream_name);
                        if let Err(e) = move_stream_segments(thread_id, ps).await {
                            log::error!(
                                "[INGESTER:PACK:JOB:{thread_id}] error moving stream {stream_key}: {e}"
                            );
                        }
                        PROCESSING_STREAMS.write().await.remove(&stream_key);
                    }
                }
            }
        });
    }

    #[cfg(feature = "enterprise")]
    let mut drain_backoff_ms = 50u64; // Start with 50ms backoff
    loop {
        #[cfg(feature = "enterprise")]
        let is_draining = o2_enterprise::enterprise::drain::is_draining();
        #[cfg(not(feature = "enterprise"))]
        let is_draining = false;

        if !is_draining {
            // Normal operation: sleep between snapshots
            if cluster::is_offline() {
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(
                get_config().limit.file_push_interval,
            ))
            .await;
        } else {
            log::info!("[INGESTER:PACK:JOB] Draining mode active, processing segments immediately");
        }

        // check if db is available, skip this iteration to avoid generating
        // orphaned files in object store when db is down
        if let Err(e) = infra::file_list::health_check().await {
            log::error!(
                "[INGESTER:PACK:JOB] DB health check failed, skip uploading to avoid orphaned files in object store: {e}"
            );
            continue;
        }

        let pending = ingester::get_pending_stream_stats().await;
        let cfg = get_config();
        for ps in pending.into_iter() {
            // when draining, flush everything regardless of the thresholds
            if !is_draining && !should_flush(&ps, &cfg) {
                continue;
            }
            let stream_key = format!("{}/{}/{}", ps.org_id, ps.stream_type, ps.stream_name);
            {
                let mut w = PROCESSING_STREAMS.write().await;
                if w.contains(&stream_key) {
                    continue;
                }
                w.insert(stream_key);
            }
            if let Err(e) = tx.send(ps).await {
                log::error!("[INGESTER:PACK:JOB] error sending stream to move: {e}");
            }
        }

        #[cfg(feature = "enterprise")]
        if is_draining {
            // If draining and no more segments to process, we can exit
            let (pending_streams, _) = ingester::get_segment_index_stats().await;
            let processing_count = PROCESSING_STREAMS.read().await.len();
            if pending_streams == 0 && processing_count == 0 {
                log::info!(
                    "[INGESTER:PACK:JOB] Draining complete, all pack segments uploaded to S3"
                );
                break;
            }
            // Backoff to avoid tight loop while draining
            tokio::time::sleep(tokio::time::Duration::from_millis(drain_backoff_ms)).await;
            // Exponential backoff up to 1 second
            drain_backoff_ms = (drain_backoff_ms * 2).min(1000);
        }
    }
    log::info!("[INGESTER:PACK:JOB] job::files::pack is stopped");
    Ok(())
}

/// Flush when pending segments are big enough or the oldest exceeded the
/// retention time (same thresholds as the legacy mover).
fn should_flush(ps: &PendingStreamStats, cfg: &config::Config) -> bool {
    let max_file_size = std::cmp::min(
        cfg.limit.max_file_size_on_disk as i64,
        cfg.compact.max_file_size as i64,
    );
    if ps.total_original_size >= max_file_size || ps.total_compressed_size >= max_file_size {
        return true;
    }
    let expired_at = now_micros()
        - Duration::try_seconds(cfg.limit.max_file_retention_time as i64)
            .unwrap()
            .num_microseconds()
            .unwrap();
    ps.oldest_registered_at <= expired_at
}

async fn move_stream_segments(
    thread_id: usize,
    ps: PendingStreamStats,
) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let org_id = ps.org_id.clone();
    let stream_type = StreamType::from(ps.stream_type.as_str());
    let stream_name = ps.stream_name.clone();

    // fetch the segments here instead of carrying them in the snapshot, so
    // the snapshot stays cheap and the list is fresh at upload time
    let segments = ingester::get_stream_segments(&ps.org_id, &ps.stream_type, &ps.stream_name).await;
    if segments.is_empty() {
        return Ok(());
    }

    // check if we are allowed to ingest or just delete the segments
    if db::compact::retention::is_deleting_stream(&org_id, stream_type, &stream_name, None) {
        log::warn!(
            "[INGESTER:PACK:JOB:{thread_id}] the stream [{org_id}/{stream_type}/{stream_name}] is deleting, drop {} segments",
            segments.len()
        );
        consume_segments(&org_id, stream_type, &stream_name, &segments).await;
        return Ok(());
    }

    // get latest schema
    let latest_schema = Arc::new(infra::schema::get(&org_id, &stream_name, stream_type).await?);

    // check stream is existing
    if latest_schema.fields().is_empty() {
        log::warn!(
            "[INGESTER:PACK:JOB:{thread_id}] the stream [{org_id}/{stream_type}/{stream_name}] was deleted, drop {} segments",
            segments.len()
        );
        consume_segments(&org_id, stream_type, &stream_name, &segments).await;
        return Ok(());
    }

    // check data retention
    let stream_settings = infra::schema::unwrap_stream_settings(&latest_schema);
    let mut stream_data_retention_days = cfg.compact.data_retention_days;
    if let Some(settings) = &stream_settings
        && settings.data_retention > 0
    {
        stream_data_retention_days = settings.data_retention;
    }
    let mut segments = segments;
    if stream_data_retention_days > 0 {
        let date = config::utils::time::now()
            - Duration::try_days(stream_data_retention_days).unwrap();
        let retention_end = date.format("%Y/%m/%d").to_string();
        let (expired, retained): (Vec<_>, Vec<_>) = segments
            .into_iter()
            .partition(|s| s.meta.partition_key.as_str() < retention_end.as_str());
        if !expired.is_empty() {
            log::warn!(
                "[INGESTER:PACK:JOB:{thread_id}] the stream [{org_id}/{stream_type}/{stream_name}] has {} segments exceeding the data retention, drop them",
                expired.len()
            );
            consume_segments(&org_id, stream_type, &stream_name, &expired).await;
        }
        segments = retained;
    }
    if segments.is_empty() {
        return Ok(());
    }

    let num_uds_fields = stream_settings
        .as_ref()
        .map(|s| s.defined_schema_fields.len())
        .unwrap_or(0);
    let stream_fields_num = if num_uds_fields > 0 {
        num_uds_fields
    } else {
        latest_schema.fields().len()
    };
    let max_file_size = std::cmp::min(
        cfg.limit.max_file_size_on_disk as i64,
        cfg.compact.max_file_size as i64,
    );

    // group by partition path, same granularity as the legacy per-prefix grouping
    let mut groups: BTreeMap<String, Vec<PackSegment>> = BTreeMap::new();
    for seg in segments {
        groups
            .entry(seg.meta.partition_key.clone())
            .or_default()
            .push(seg);
    }

    for (_partition_key, mut group) in groups {
        group.sort_by_key(|s| s.meta.min_ts);
        // upload in chunks bounded by the max file size, like the legacy merge
        let mut remaining = group.as_slice();
        while !remaining.is_empty() {
            let mut chunk_len = 0;
            let mut chunk_original_size = 0;
            let mut chunk_compressed_size = 0;
            for seg in remaining.iter() {
                if chunk_len > 0
                    && (chunk_original_size + seg.meta.original_size > max_file_size
                        || chunk_compressed_size + seg.meta.length as i64 > max_file_size
                        || (cfg.limit.file_move_fields_limit > 0
                            && stream_fields_num >= cfg.limit.file_move_fields_limit))
                {
                    break;
                }
                chunk_len += 1;
                chunk_original_size += seg.meta.original_size;
                chunk_compressed_size += seg.meta.length as i64;
            }
            let (chunk, rest) = remaining.split_at(chunk_len);
            remaining = rest;

            let total_records: i64 = chunk.iter().map(|s| s.meta.records).sum();
            if total_records == 0 {
                log::warn!(
                    "[INGESTER:PACK:JOB:{thread_id}] skip empty chunk for stream [{org_id}/{stream_type}/{stream_name}]"
                );
                consume_segments(&org_id, stream_type, &stream_name, chunk).await;
                continue;
            }

            let (account, new_file_key, new_file_meta) = upload_chunk(
                thread_id,
                &org_id,
                stream_type,
                &stream_name,
                latest_schema.clone(),
                &stream_settings,
                chunk,
            )
            .await?;

            // write file list to storage
            let new_file_min_ts = new_file_meta.min_ts;
            db::file_list::set(&account, &new_file_key, Some(new_file_meta), false).await?;

            // trigger an incremental merge of the current hour once enough
            // files have piled up
            compaction::incremental::incr_pending_file(
                &org_id,
                stream_type,
                &stream_name,
                new_file_min_ts,
            )
            .await;

            // remove the segments from the index, delete fully consumed packs
            consume_segments(&org_id, stream_type, &stream_name, chunk).await;

            // metrics
            for seg in chunk.iter() {
                metrics::INGEST_WAL_READ_BYTES
                    .with_label_values(&[org_id.as_str(), stream_type.as_str()])
                    .inc_by(seg.meta.length);
            }
        }
    }

    Ok(())
}

/// Upload one chunk of segments as a single object storage file.
async fn upload_chunk(
    thread_id: usize,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    latest_schema: Arc<Schema>,
    stream_settings: &Option<config::meta::stream::StreamSettings>,
    chunk: &[PackSegment],
) -> Result<(String, String, FileMeta), anyhow::Error> {
    let cfg = get_config();
    let start = std::time::Instant::now();

    let min_ts = chunk.iter().map(|s| s.meta.min_ts).min().unwrap();
    let max_ts = chunk.iter().map(|s| s.meta.max_ts).max().unwrap();
    let total_records: i64 = chunk.iter().map(|s| s.meta.records).sum();
    let total_original_size: i64 = chunk.iter().map(|s| s.meta.original_size).sum();

    let bloom_filter_fields = get_stream_setting_bloom_filter_fields(stream_settings);
    let full_text_search_fields = get_stream_setting_fts_fields(stream_settings);
    let index_fields = get_stream_setting_index_fields(stream_settings);
    let (defined_schema_fields, need_original, index_original_data, index_all_values) =
        match stream_settings {
            Some(s) => (
                s.defined_schema_fields.clone(),
                s.store_original_data,
                s.index_original_data,
                s.index_all_values,
            ),
            None => (Vec::new(), false, false, false),
        };
    let index_schema = if !defined_schema_fields.is_empty() {
        let schema_cache = infra::schema::SchemaCache::new(latest_schema.as_ref().clone());
        generate_schema_for_defined_schema_fields(
            stream_type,
            &schema_cache,
            &defined_schema_fields,
            need_original,
            index_original_data,
            index_all_values,
        )
        .schema()
        .clone()
    } else {
        latest_schema.clone()
    };

    // read all segment bytes
    let mut bufs = Vec::with_capacity(chunk.len());
    for seg in chunk.iter() {
        let data = ingester::read_segment(
            seg.pack_path.as_path(),
            seg.meta.offset,
            seg.meta.length,
        )
        .await?;
        bufs.push(data);
    }

    let (buf, mut new_file_meta, file_format) = if chunk.len() == 1 {
        // fast path: upload the parquet bytes as-is, no decode/re-encode
        let buf = Bytes::from(bufs.pop().unwrap());
        let file_meta = FileMeta {
            min_ts,
            max_ts,
            records: total_records,
            original_size: total_original_size,
            compressed_size: buf.len() as i64,
            ..Default::default()
        };
        (buf, file_meta, FileFormat::Parquet)
    } else {
        // merge multiple segments in memory
        let mut shared_fields = HashSet::new();
        let mut schema_groups: HashMap<String, (Arc<Schema>, Vec<datafusion::arrow::record_batch::RecordBatch>)> =
            HashMap::new();
        for data in bufs {
            let (schema, batches) = config::utils::parquet::read_recordbatch_from_bytes(
                FileFormat::Parquet,
                Bytes::from(data),
            )
            .await?;
            shared_fields.extend(schema.fields().iter().cloned());
            let entry = schema_groups
                .entry(schema.hash_key())
                .or_insert_with(|| (schema.clone(), Vec::new()));
            entry.1.extend(batches);
        }
        let mut fields = shared_fields.into_iter().collect::<Vec<_>>();
        fields.sort_by(|a, b| a.name().cmp(b.name()));
        fields.dedup_by(|a, b| a.name() == b.name());
        let union_schema = Arc::new(Schema::new(fields));

        let mut tables: Vec<Arc<dyn TableProvider>> = Vec::with_capacity(schema_groups.len());
        for (_, (schema, batches)) in schema_groups {
            tables.push(Arc::new(MemTable::try_new(schema, vec![batches])?) as _);
        }

        let new_file_meta = FileMeta {
            min_ts,
            max_ts,
            records: total_records,
            original_size: total_original_size,
            ..Default::default()
        };
        let merge_result = merge::merge_parquet_files(
            stream_type,
            stream_name,
            union_schema,
            tables,
            &bloom_filter_fields,
            new_file_meta,
            true,
        )
        .await?;
        match merge_result {
            MergeParquetResult::Single {
                buf,
                file_meta,
                file_format,
            } => (Bytes::from(buf), file_meta, file_format),
            MergeParquetResult::Multiple { .. } => {
                return Err(anyhow::anyhow!(
                    "merge_parquet_files error: unexpected multiple files on ingester"
                ));
            }
        }
    };

    if new_file_meta.compressed_size == 0 {
        return Err(anyhow::anyhow!(
            "upload_chunk error: compressed_size is 0 for stream [{org_id}/{stream_type}/{stream_name}]"
        ));
    }

    // the synthetic wal-like name keeps the segments' partition path
    let wal_like_name = format!(
        "0/{}/{}",
        chunk[0].meta.partition_key,
        generate_filename_with_time_range(min_ts, max_ts, 0)
    );
    let new_file_key = super::generate_ingester_storage_file_key(
        org_id,
        stream_type,
        stream_name,
        &wal_like_name,
        file_format,
    );

    log::info!(
        "[INGESTER:PACK:JOB:{thread_id}] uploading {} segments into a new file: {new_file_key}, original_size: {}, compressed_size: {}, took: {} ms",
        chunk.len(),
        new_file_meta.original_size,
        new_file_meta.compressed_size,
        start.elapsed().as_millis(),
    );

    // upload file
    if cfg.cache_latest_files.enabled
        && cfg.cache_latest_files.cache_parquet
        && cfg.cache_latest_files.download_from_node
    {
        infra::cache::file_data::disk::set(&new_file_key, buf.clone()).await?;
    }
    let account = storage::get_account(org_id, &new_file_key).unwrap_or_default();
    storage::put(&account, &new_file_key, buf.clone()).await?;

    // Enterprise: extract service metadata during data processing
    #[cfg(feature = "enterprise")]
    super::parquet::queue_service_streams_if_needed(
        org_id,
        stream_type,
        stream_name,
        file_format,
        &new_file_key,
        &buf,
    )
    .await;

    // generate the inverted index if enabled and supported by the stream type
    if cfg.common.inverted_index_enabled && stream_type.support_index() {
        let index_schema_fields = index_schema
            .fields()
            .iter()
            .map(|f| f.name())
            .collect::<HashSet<_>>();
        let need_index = full_text_search_fields
            .iter()
            .chain(index_fields.iter())
            .any(|f| index_schema_fields.contains(f));
        if need_index {
            let index_size = create_tantivy_index(
                "INGESTER:PACK",
                org_id,
                &new_file_key,
                &full_text_search_fields,
                &index_fields,
                index_schema.clone(),
                buf,
            )
            .await
            .map_err(|e| anyhow::anyhow!("generate_tantivy_index_on_ingester error: {e}"))?;
            new_file_meta.index_size = index_size as i64;
        }
    }

    Ok((account, new_file_key, new_file_meta))
}

/// Remove segments from the index and release their wal usage bytes.
async fn consume_segments(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    segments: &[PackSegment],
) {
    if segments.is_empty() {
        return;
    }
    let consumed = segments
        .iter()
        .map(|s| (s.pack_path.clone(), s.meta.offset))
        .collect::<Vec<_>>();
    ingester::mark_segments_consumed(org_id, stream_type.as_str(), stream_name, &consumed)
        .await;
    let total_bytes: i64 = segments.iter().map(|s| s.meta.length as i64).sum();
    metrics::INGEST_WAL_USED_BYTES
        .with_label_values(&[org_id, stream_type.as_str()])
        .sub(total_bytes);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending_stream(
        total_original_size: i64,
        total_compressed_size: i64,
        oldest_registered_at: i64,
    ) -> PendingStreamStats {
        PendingStreamStats {
            org_id: "org".to_string(),
            stream_type: "metrics".to_string(),
            stream_name: "s1".to_string(),
            total_original_size,
            total_compressed_size,
            oldest_registered_at,
        }
    }

    #[test]
    fn test_should_flush_by_size() {
        let cfg = get_config();
        let max_file_size = std::cmp::min(
            cfg.limit.max_file_size_on_disk as i64,
            cfg.compact.max_file_size as i64,
        );
        // big enough by original size
        let ps = pending_stream(max_file_size, 0, now_micros());
        assert!(should_flush(&ps, &cfg));
        // big enough by compressed size
        let ps = pending_stream(0, max_file_size, now_micros());
        assert!(should_flush(&ps, &cfg));
        // small and fresh -> keep accumulating
        let ps = pending_stream(1024, 512, now_micros());
        assert!(!should_flush(&ps, &cfg));
    }

    #[test]
    fn test_should_flush_by_age() {
        let cfg = get_config();
        let expired = now_micros()
            - Duration::try_seconds(cfg.limit.max_file_retention_time as i64 + 10)
                .unwrap()
                .num_microseconds()
                .unwrap();
        let ps = pending_stream(1024, 512, expired);
        assert!(should_flush(&ps, &cfg));
    }
}
