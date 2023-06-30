// Copyright 2022 Zinc Labs Inc. and Contributors
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

use dashmap::DashMap;
use once_cell::sync::Lazy;

use crate::infra::config::RwHashMap;
use crate::meta::common::FileMeta;
use crate::meta::stream::StreamStats;
use crate::meta::StreamType;

static STATS: Lazy<RwHashMap<String, StreamStats>> = Lazy::new(DashMap::default);

const STREAM_STATS_MEM_SIZE: usize = std::mem::size_of::<StreamStats>();

#[inline]
pub fn get_stats() -> RwHashMap<String, StreamStats> {
    STATS.clone()
}

#[inline]
pub fn get_stream_stats(org_id: &str, stream_name: &str, stream_type: StreamType) -> StreamStats {
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    STATS.get(&key).map(|v| *v.value()).unwrap_or_default()
}

#[inline]
pub fn remove_stream_stats(org_id: &str, stream_name: &str, stream_type: StreamType) {
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    STATS.remove(&key);
}

#[inline]
pub fn set_stream_stats(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    val: StreamStats,
) {
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    STATS.insert(key, val);
}

#[inline]
pub fn incr_stream_stats(key: &str, val: FileMeta) -> Result<(), anyhow::Error> {
    // eg: files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet
    let columns = key.split('/').collect::<Vec<&str>>();
    if columns.len() < 9 {
        return Err(anyhow::anyhow!(
            "[incr_stream_stats] Invalid file path: {}",
            key
        ));
    }
    let _ = columns[0];
    let org_id = columns[1];
    let stream_type = columns[2];
    let stream_name = columns[3];
    let key = format!("{org_id}/{stream_type}/{stream_name}");
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

#[inline]
pub fn decr_stream_stats(key: &str, val: FileMeta) -> Result<(), anyhow::Error> {
    // eg: files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet
    let columns = key.split('/').collect::<Vec<&str>>();
    if columns.len() < 9 {
        return Err(anyhow::anyhow!(
            "[decr_stream_stats] Invalid file path: {}",
            key
        ));
    }
    let _ = columns[0];
    let org_id = columns[1];
    let stream_type = columns[2];
    let stream_name = columns[3];
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    if !STATS.contains_key(&key) {
        return Ok(());
    }
    let mut stats = STATS.entry(key).or_default();
    if stats.doc_num > val.records {
        stats.doc_num -= val.records;
        stats.file_num -= 1;
        stats.storage_size -= val.original_size as f64;
        stats.compressed_size -= val.compressed_size as f64;
    } else {
        stats.doc_num = 0;
        stats.file_num = 0;
        stats.storage_size = 0.0;
        stats.compressed_size = 0.0;
    }

    Ok(())
}

#[inline]
pub fn reset_stream_stats_time(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_range: (i64, i64),
) -> Result<(), anyhow::Error> {
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    if !STATS.contains_key(&key) {
        return Ok(());
    }
    let mut stats = STATS.entry(key).or_default();
    if time_range.0 > 0 {
        stats.doc_time_min = time_range.0;
    }
    if time_range.1 > 0 {
        stats.doc_time_max = time_range.1;
    }
    Ok(())
}

#[inline]
pub fn get_stream_stats_len() -> usize {
    STATS.len()
}

#[inline]
pub fn get_stream_stats_in_memory_size() -> usize {
    STATS
        .iter()
        .map(|v| v.key().len() + STREAM_STATS_MEM_SIZE)
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_stream_stats_len() {
        let stats = get_stats();
        assert_eq!(get_stream_stats_len(), stats.len());

        let val = StreamStats {
            created_at: 1667978841102,
            doc_time_min: 1667978841102,
            doc_time_max: 1667978845374,
            doc_num: 5000,
            file_num: 1,
            storage_size: 200.00,
            compressed_size: 3.00,
        };

        set_stream_stats("nexus", "default", StreamType::Logs, val);
        let stats = get_stream_stats("nexus", "default", StreamType::Logs);
        assert_eq!(stats, val);

        let file_meta = FileMeta {
            min_ts: 1667978841110,
            max_ts: 1667978845354,
            records: 300,
            original_size: 10,
            compressed_size: 1,
        };

        let file_key = "files/nexus/logs/default/2022/10/03/10/6982652937134804993_1.parquet";
        let ret = incr_stream_stats(file_key, file_meta);
        assert!(ret.is_ok());

        let stats = get_stream_stats("nexus", "default", StreamType::Logs);
        assert_eq!(stats.doc_num, 5300);

        let ret = decr_stream_stats(file_key, file_meta);
        assert!(ret.is_ok());

        let stats = get_stream_stats("nexus", "default", StreamType::Logs);
        assert_eq!(stats.doc_num, 5000);

        let file_meta = FileMeta {
            min_ts: 1667978841120,
            max_ts: 1667978845374,
            records: 300,
            original_size: 10,
            compressed_size: 1,
        };
        let file_key = "files/nexus/logs/default/2022/10/03/10/6982652937134804993_1.parquet";
        let ret = incr_stream_stats(file_key, file_meta);
        assert!(ret.is_ok());

        let file_key = "files/nexus/logs/default/2022/10/03/10/6982652937134804993_2.parquet";
        let ret = incr_stream_stats(file_key, file_meta);
        assert!(ret.is_ok());

        let file_key = "files/nexus/logs/default/2022/10/03/6982652937134804993_2.parquet";
        let ret = incr_stream_stats(file_key, file_meta);
        assert!(ret.is_err());

        let file_key = "files/nexus/logs/default/2022/10/03/10/6982652937134804993_2.parquet";
        let ret = decr_stream_stats(file_key, file_meta);
        assert!(ret.is_ok());

        let file_key = "files/nexus/logs/default/2022/10/03/6982652937134804993_2.parquet";
        let ret = decr_stream_stats(file_key, file_meta);
        assert!(ret.is_err());
    }

    #[test]
    fn test_reset_stream_stats() {
        let time_range = (1667978841102, 1667978845374);
        let ret = reset_stream_stats_time("default", "olympics", StreamType::Logs, time_range);
        assert!(ret.is_ok());
    }
}
