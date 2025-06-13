use std::{
    io::{Cursor, ErrorKind},
    path::Path,
    sync::Arc,
};

use arrow::{
    array::RecordBatch,
    ipc::{reader::FileReader as ArrowFileReader, writer::FileWriter as ArrowFileWriter},
};
use bytes::Bytes;
use chrono::Duration;
use infra::cache::file_data::disk;
use once_cell::sync::Lazy;
use tokio::sync::mpsc;

use crate::common::meta::search::{
    Interval, StreamingAggsCacheResult, StreamingAggsCacheResultRecordBatch,
};

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

const STREAMING_AGGS_CACHE_DIR: &str = "record_batches";

#[derive(Debug)]
pub struct RecordBatchCacheRequest {
    pub streaming_id: String,
    pub file_path: String,
    pub file_name: String,
    pub records: Vec<Arc<RecordBatch>>,
}

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

pub async fn get_record_batches(
    file_path: &str,
    file_name: &str,
) -> std::io::Result<Vec<RecordBatch>> {
    let file = format!("record_batches/{}/{}", file_path, file_name);
    let data = disk::get(&file, None)
        .await
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "File not found"))?;
    let reader = ArrowFileReader::try_new(Cursor::new(data), None).map_err(|e| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("Arrow error: {}", e),
        )
    })?;
    let mut batches = Vec::new();
    for batch in reader {
        batches.push(batch.map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("Arrow error: {}", e),
            )
        })?);
    }
    Ok(batches)
}

pub async fn get_streaming_aggs_records_from_disk(
    cache_file_path: &str,
    start_time: i64,
    end_time: i64,
) -> std::io::Result<StreamingAggsCacheResult> {
    let cache_path = construct_cache_path(cache_file_path);
    // TODO: use infra/disk.rs methods
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

    let mut count = 0;
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
        // Overlap condition: file_start_time < end_time && file_end_time > start_time
        // This excludes files that only touch at boundaries
        // eg:
        // Cache files:
        // File 1: [3-4]   ← SKIPPED (only touches boundary at 4)
        // File 2: [4-5]   ← LOADED ✓
        // File 3: [5-6]   ← LOADED ✓
        // File 4: [6-7]   ← LOADED ✓
        // File 5: [7-8]   ← LOADED ✓
        // File 6: [8-9]   ← SKIPPED (only touches boundary at 8)
        // Query: [4-8]
        // Result: Loads files 2,3,4,5 covering [4-8]
        if file_start_time < end_time && file_end_time > start_time {
            log::debug!(
                "File {} matches time range: file_time=[{}, {}], query_time=[{}, {}]",
                file_name_str,
                file_start_time,
                file_end_time,
                start_time,
                end_time
            );
            match get_record_batches(cache_file_path, file_name_str).await {
                Ok(cached_record_batches) => {
                    for batch in cached_record_batches {
                        let record_batch_cache_result = StreamingAggsCacheResultRecordBatch {
                            record_batch: batch,
                            cache_start_time: file_start_time,
                            cache_end_time: file_end_time,
                        };
                        cached_records.push(record_batch_cache_result);
                    }
                    cache_start_time = std::cmp::min(cache_start_time, file_start_time);
                    cache_end_time = std::cmp::max(cache_end_time, file_end_time);
                    count += 1;
                }
                Err(e) => {
                    log::warn!(
                        "Failed to load cached record batches from {}: {:?}",
                        file_name_str,
                        e
                    );
                }
            }
        } else {
            log::debug!(
                "File {} does NOT match time range: file_time=[{}, {}], query_time=[{}, {}]",
                file_name_str,
                file_start_time,
                file_end_time,
                start_time,
                end_time
            );
        }
    }

    log::info!(
        "Found {} cached record batches in cache path: {}",
        count,
        cache_path
    );

    // Return the cached records if any were found
    if !cached_records.is_empty() {
        log::info!(
            "Loaded {} cached record batches cache_start_time: {}, cache_end_time: {}, query_start_time: {}, query_end_time: {}",
            cached_records.len(),
            cache_start_time,
            cache_end_time,
            start_time,
            end_time,
        );
        if cache_start_time == start_time && cache_end_time == end_time {
            log::info!(
                "Found cached records covering the entire time range: cache=[{}, {}], query=[{}, {}]",
                cache_start_time,
                cache_end_time,
                start_time,
                end_time
            );
            let cache_result = StreamingAggsCacheResult {
                cache_result: cached_records,
                is_complete_match: true,
                // TODO: calculate deltas
                deltas: vec![],
            };
            return Ok(cache_result);
        } else {
            log::info!(
                "Found cached records for partial time range: cache=[{}, {}], query=[{}, {}]",
                cache_start_time,
                cache_end_time,
                start_time,
                end_time
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

pub fn create_record_batch_cache_file_path(
    org_id: &str,
    stream_type: &str,
    stream_name: &str,
    hashed_query: u64,
    cache_interval: i64,
) -> String {
    // eg: /org_id/stream_type/stream_name/12345678_5
    format!(
        "{}/{}/{}/{}",
        org_id,
        stream_type,
        stream_name,
        create_record_batch_cache_key(hashed_query, cache_interval)
    )
}

fn create_record_batch_cache_key(hashed_query: u64, cache_interval: i64) -> String {
    // eg: 12345678_5, interval is in minutes
    format!("{}_{}", hashed_query, cache_interval)
}

pub fn parse_record_batch_cache_file_path(cache_file_path: &str) -> (u64, i64) {
    let parts: Vec<&str> = cache_file_path.split("/").collect();
    if parts.len() < 4 {
        return (0, 0);
    }
    let cache_key = parts.last().unwrap_or(&"");

    let split_cache_key = cache_key.split("_").collect::<Vec<&str>>();
    if split_cache_key.len() < 2 {
        return (0, 0);
    }
    (
        split_cache_key[0].parse::<u64>().unwrap_or_default(), // hashed_query
        split_cache_key[1].parse::<i64>().unwrap_or_default(), // cache_interval
    )
}

pub fn generate_record_batch_file_name(start_time: i64, end_time: i64) -> String {
    format!("{}_{}.arrow", start_time, end_time,)
}

pub fn construct_cache_path(file_path: &str) -> String {
    format!(
        "{}{}/{}",
        config::get_config().common.data_cache_dir,
        STREAMING_AGGS_CACHE_DIR,
        file_path
    )
}

pub fn generate_record_batch_interval(start_time: i64, end_time: i64) -> Interval {
    let intervals = [
        (Duration::try_hours(24 * 15), Interval::OneDay),
        (Duration::try_hours(24 * 1), Interval::OneHour),
        (Duration::try_hours(6), Interval::ThirtyMinutes),
        (Duration::try_hours(1), Interval::TenMinutes),
        (Duration::try_minutes(15), Interval::FiveMinutes),
    ];
    for (time, interval) in intervals.iter() {
        let time = time.unwrap().num_microseconds().unwrap();
        if (end_time - start_time) >= time {
            return interval.clone();
        }
    }
    Interval::FiveMinutes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_record_batch_interval() {
        // Test cases for different time ranges
        let test_cases = vec![
            // (time_range, expected_interval)
            // 15 days range -> OneDay interval
            (
                (
                    0,
                    Duration::try_hours(24 * 15)
                        .unwrap()
                        .num_microseconds()
                        .unwrap(),
                ),
                Interval::OneDay,
            ),
            // 1 day range -> OneHour interval
            (
                (
                    0,
                    Duration::try_hours(24).unwrap().num_microseconds().unwrap(),
                ),
                Interval::OneHour,
            ),
            // 6 hours range -> ThirtyMinutes interval
            (
                (
                    0,
                    Duration::try_hours(6).unwrap().num_microseconds().unwrap(),
                ),
                Interval::ThirtyMinutes,
            ),
            // 1 hour range -> TenMinutes interval
            (
                (
                    0,
                    Duration::try_hours(1).unwrap().num_microseconds().unwrap(),
                ),
                Interval::TenMinutes,
            ),
            // 15 minutes range -> FiveMinutes interval
            (
                (
                    0,
                    Duration::try_minutes(15)
                        .unwrap()
                        .num_microseconds()
                        .unwrap(),
                ),
                Interval::FiveMinutes,
            ),
            // Less than 15 minutes -> FiveMinutes interval (default)
            (
                (
                    0,
                    Duration::try_minutes(10)
                        .unwrap()
                        .num_microseconds()
                        .unwrap(),
                ),
                Interval::FiveMinutes,
            ),
            // 10:15-14:15
            (
                (1748513700000 * 1_000, 1748528100000 * 1_000),
                Interval::TenMinutes,
            ),
        ];

        for (time_range, expected_interval) in test_cases {
            let result = generate_record_batch_interval(time_range.0, time_range.1);
            assert_eq!(
                result, expected_interval,
                "Time range {:?} should return {}, but got {}",
                time_range, expected_interval, result
            );
        }
    }
}
