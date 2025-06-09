use std::{
    fs::File,
    io::{Cursor, ErrorKind},
    path::Path,
    sync::Arc,
};

use arrow::{
    array::RecordBatch,
    ipc::{reader::FileReader as ArrowFileReader, writer::FileWriter as ArrowFileWriter},
};
use bytes::Bytes;
use infra::cache::file_data::disk;
use once_cell::sync::Lazy;
use tokio::sync::mpsc;

use crate::common::meta::search::{StreamingAggsCacheResult, StreamingAggsCacheResultRecordBatch};

const STREAMING_AGGS_CACHE_DIR: &str = "record_batches";

#[derive(Debug)]
pub struct RecordBatchCacheRequest {
    pub streaming_id: String,
    pub file_path: String,
    pub file_name: String,
    pub records: Vec<Arc<RecordBatch>>,
}

async fn cache_record_batches_to_disk_impl(
    request: RecordBatchCacheRequest,
) -> std::io::Result<()> {
    if request.records.is_empty() {
        return Ok(());
    }

    // Serialize the record batches into bytes
    let data = match serialize_record_batches(&request.records) {
        Ok(bytes) => bytes,
        Err(e) => {
            log::error!(
                "[streaming_id: {}] Failed to serialize record batches: {:?}",
                request.streaming_id,
                e
            );
            return Err(std::io::Error::new(
                ErrorKind::Other,
                "Serialization failed",
            ));
        }
    };

    let file = format!("record_batches/{}/{}", request.file_path, request.file_name);

    match disk::set(&file, Bytes::from(data)).await {
        Ok(_) => Ok(()),
        Err(e) => {
            log::error!("Error caching results to disk: {:?}", e);
            Err(std::io::Error::new(
                ErrorKind::Other,
                "Error caching results to disk",
            ))
        }
    }
}

// Global queue for cache requests
static CACHE_QUEUE: Lazy<mpsc::UnboundedSender<RecordBatchCacheRequest>> = Lazy::new(|| {
    let (sender, mut receiver) = mpsc::unbounded_channel::<RecordBatchCacheRequest>();

    // Spawn background task to process cache requests
    tokio::spawn(async move {
        while let Some(request) = receiver.recv().await {
            let streaming_id = request.streaming_id.clone();
            log::debug!("[streaming_id: {}] Received cache request", streaming_id);
            if let Err(e) = cache_record_batches_to_disk_impl(request).await {
                log::error!(
                    "[streaming_id: {}] Failed to cache record batches to disk: {:?}",
                    streaming_id,
                    e
                );
            }
        }
    });

    sender
});

pub fn cache_record_batches_to_disk(
    request: RecordBatchCacheRequest,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if request.records.is_empty() {
        return Ok(());
    }
    let streaming_id = request.streaming_id.clone();

    // Send to background queue (non-blocking)
    CACHE_QUEUE.send(request).map_err(|e| {
        log::error!(
            "[streaming_id: {}] Failed to queue cache request: {:?}",
            streaming_id,
            e
        );
        Box::new(std::io::Error::new(
            ErrorKind::Other,
            "Failed to queue cache request",
        )) as Box<dyn std::error::Error + Send + Sync>
    })?;

    Ok(())
}

pub fn serialize_record_batches(batches: &[Arc<RecordBatch>]) -> arrow::error::Result<Vec<u8>> {
    if batches.is_empty() {
        return Ok(vec![]);
    }

    let schema = batches[0].schema();
    let mut buffer = Cursor::new(Vec::new());
    let mut writer = ArrowFileWriter::try_new(&mut buffer, &schema)?;

    for batch in batches {
        writer.write(batch)?;
    }

    writer.finish()?;
    Ok(buffer.into_inner())
}

pub async fn get_streaming_aggs_records_from_disk(
    file_path: &str,
    start_time: i64,
    end_time: i64,
) -> std::io::Result<StreamingAggsCacheResult> {
    let cache_path = construct_cache_path(file_path);
    if !Path::new(&cache_path).exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Cache file not found",
        ));
    }

    let mut cached_records = Vec::new();
    // TODO: handle the case if this would remain the max and min value
    let mut cache_start_time: i64 = i64::MAX;
    let mut cache_end_time: i64 = i64::MIN;

    // Check if cached records were found for the entire time range
    let read_dir = std::fs::read_dir(&cache_path)?;
    let files: Vec<_> = read_dir.collect::<Result<Vec<_>, _>>()?;
    let files_num = files.len();
    log::info!("Found {} files in cache path: {}", files_num, cache_path);

    for file in files {
        let file_name = file.file_name();
        let file_name_str = file_name.to_str().ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid filename")
        })?;

        // Remove file extension before parsing timestamps
        let name_without_ext = file_name_str
            .rsplit_once('.')
            .map(|(name, _)| name)
            .unwrap_or(file_name_str);

        let parts: Vec<&str> = name_without_ext.split("_").collect();
        if parts.len() < 2 {
            continue;
        }
        let file_start_time = match parts[0].parse::<i64>() {
            Ok(time) => time,
            Err(e) => {
                log::error!("Invalid start time in file name: {}: {}", file_name_str, e);
                continue;
            }
        };
        let file_end_time = match parts[1].parse::<i64>() {
            Ok(time) => time,
            Err(e) => {
                log::error!("Invalid end time in file name: {}: {}", file_name_str, e);
                continue;
            }
        };

        // Check if file time range overlaps with requested time range
        // Overlap condition:
        if file_start_time <= end_time && file_end_time >= start_time {
            let file_path_full = format!("{}/{}", cache_path, file_name_str);
            let file = File::open(&file_path_full)?;
            let reader = ArrowFileReader::try_new(file, None).map_err(|e| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("Arrow error: {}", e),
                )
            })?;
            for batch_result in reader {
                let batch = batch_result.map_err(|e| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("Arrow error: {}", e),
                    )
                })?;
                let record_batch_cache_result = StreamingAggsCacheResultRecordBatch {
                    record_batch: batch,
                    cache_start_time: file_start_time,
                    cache_end_time: file_end_time,
                };
                cached_records.push(record_batch_cache_result);
            }
            cache_start_time = std::cmp::min(cache_start_time, file_start_time);
            cache_end_time = std::cmp::max(cache_end_time, file_end_time);
        }
    }

    // Return the cached records if any were found
    if !cached_records.is_empty() {
        log::info!(
            "Loaded {} cached record batches cache_start_time: {}, cache_end_time: {}",
            cached_records.len(),
            cache_start_time,
            cache_end_time
        );
        if cache_start_time == start_time && cache_end_time == end_time {
            log::info!("Found cached records for the entire time range");
            let cache_result = StreamingAggsCacheResult {
                cache_result: cached_records,
                is_complete_match: true,
                // TODO: calculate deltas
                deltas: vec![],
            };
            return Ok(cache_result);
        } else {
            log::info!(
                "Found cached records for the time range: {}, {}",
                cache_start_time,
                cache_end_time
            );
            let cache_result = StreamingAggsCacheResult {
                cache_result: cached_records,
                is_complete_match: false,
                // TODO: calculate deltas
                deltas: vec![],
            };
            return Ok(cache_result);
        }
    }

    // No cached records found
    Ok(StreamingAggsCacheResult::default())
}

pub fn construct_cache_path(file_path: &str) -> String {
    format!(
        "{}{}/{}",
        config::get_config().common.data_cache_dir,
        STREAMING_AGGS_CACHE_DIR,
        file_path
    )
}
