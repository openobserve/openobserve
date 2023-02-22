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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_get_stream_stats_len() {
        let stats = get_stats();
        let data = get_stream_stats_len();
        assert_eq!(data, stats.len());

        let val = StreamStats {
            doc_time_min: 1667978841102,
            doc_time_max: 1667978845374,
            doc_num: 5000,
            file_num: 1,
            storage_size: 200.00,
            compressed_size: 3.00,
        };

        let _ = set_stream_stats("nexus", "default", "logs", val);
        let stats = get_stream_stats("nexus", "default", "logs");
        assert_eq!(stats, Some(val));

        let file_meta = FileMeta {
            min_ts: 1667978841110,
            max_ts: 1667978845354,
            records: 300,
            original_size: 10,
            compressed_size: 1,
        };

        let file_key = "files/nexus/logs/default/2022/10/03/10/6982652937134804993_1.parquet";
        let _ = incr_stream_stats(file_key, file_meta);

        let stats = get_stream_stats("nexus", "default", "logs");
        assert_eq!(stats.unwrap().doc_num, 5300);

        let _ = decr_stream_stats(file_key, file_meta);
        let stats = get_stream_stats("nexus", "default", "logs");
        assert_eq!(stats.unwrap().doc_num, 5000);
    }
}
