use dashmap::DashMap;

use crate::meta::common::FileMeta;
use crate::meta::stream::StreamStats;

lazy_static! {
    static ref STATS: DashMap<String, StreamStats> = DashMap::with_capacity(2);
}

const STREAM_STATS_MEM_SIZE: usize = std::mem::size_of::<StreamStats>();

pub fn get_stats() -> DashMap<String, StreamStats> {
    STATS.clone()
}

pub fn get_stream_stats(org_id: &str, stream_name: &str, stream_type: &str) -> Option<StreamStats> {
    let key = format!("{}/{}/{}", org_id, stream_type, stream_name);
    STATS.get(&key).map(|v| *v.value())
}

pub fn set_stream_stats(org_id: &str, stream_name: &str, stream_type: &str, val: StreamStats) {
    let key = format!("{}/{}/{}", org_id, stream_type, stream_name);
    STATS.insert(key, val);
}

pub fn incr_stream_stats(key: &str, val: FileMeta) -> Result<(), anyhow::Error> {
    // eg: files/default/olympics/2022/10/03/10/6982652937134804993_1.parquet
    let columns = key.split('/').collect::<Vec<&str>>();
    if columns.len() < 8 {
        return Err(anyhow::anyhow!(
            "[TRACE] [incr_stream_stats] Invalid file path: {}",
            key
        ));
    }
    let _ = columns[0].to_string();
    let org_id = columns[1].to_string();
    let stream_type = columns[2].to_string();
    let stream_name = columns[3].to_string();
    let key = format!("{}/{}/{}", org_id, stream_type, stream_name);
    let mut stats = STATS.entry(key).or_default();
    if val.records == 0 {
        return Ok(());
    }
    if stats.doc_time_min > val.min_ts || stats.doc_time_min == 0 {
        stats.doc_time_min = val.min_ts;
    }
    if stats.doc_time_max < val.max_ts {
        stats.doc_time_max = val.max_ts;
    }
    stats.doc_num += val.records;
    stats.file_num += 1;
    stats.storage_size += val.original_size as f64;
    stats.compressed_size += val.compressed_size as f64;

    Ok(())
}

pub fn decr_stream_stats(key: &str, val: FileMeta) -> Result<(), anyhow::Error> {
    // eg: files/default/olympics/2022/10/03/10/6982652937134804993_1.parquet
    let columns = key.split('/').collect::<Vec<&str>>();
    if columns.len() < 8 {
        return Err(anyhow::anyhow!(
            "[TRACE] [decr_stream_stats] Invalid file path: {}",
            key
        ));
    }
    let _ = columns[0].to_string();
    let org_id = columns[1].to_string();
    let stream_type = columns[2].to_string();
    let stream_name = columns[3].to_string();
    let key = format!("{}/{}/{}", org_id, stream_type, stream_name);
    let mut stats = STATS.entry(key).or_default();
    stats.doc_num -= val.records;
    stats.file_num -= 1;
    stats.storage_size -= val.original_size as f64;
    stats.compressed_size -= val.compressed_size as f64;

    Ok(())
}

pub fn get_stream_stats_len() -> usize {
    STATS.len()
}

pub fn get_stream_stats_in_memory_size() -> usize {
    STATS
        .iter()
        .map(|v| v.key().len() + STREAM_STATS_MEM_SIZE)
        .sum()
}
