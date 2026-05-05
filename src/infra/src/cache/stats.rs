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

use std::sync::LazyLock as Lazy;

use config::{
    RwHashMap,
    meta::stream::{FileMeta, StreamStats, StreamType},
    stats::CacheStats,
};

static STATS: Lazy<RwHashMap<String, StreamStats>> = Lazy::new(Default::default);

#[inline]
pub fn get_stats() -> RwHashMap<String, StreamStats> {
    STATS.clone()
}

#[inline]
pub fn get_stream_stats(org_id: &str, stream_name: &str, stream_type: StreamType) -> StreamStats {
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    STATS
        .get(&key)
        .map(|v| v.value().clone())
        .unwrap_or_default()
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
pub fn incr_stream_stats(key: &str, val: &FileMeta) -> Result<(), anyhow::Error> {
    if val.records == 0 {
        return Ok(());
    }

    // eg: files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet
    let columns = key.split('/').collect::<Vec<&str>>();
    if columns.len() < 9 {
        return Err(anyhow::anyhow!(
            "[incr_stream_stats] Invalid file path: {}",
            key
        ));
    }
    // let _ = columns[0];
    let org_id = columns[1];
    let stream_type = columns[2];
    let stream_name = columns[3];
    let key = format!("{org_id}/{stream_type}/{stream_name}");
    let mut stats = STATS.entry(key).or_default();
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
    stats.index_size += val.index_size as f64;

    Ok(())
}

/// Get cache statistics in standardized format: (len, capacity, memory_size)
#[inline]
pub fn get_cache_stats() -> (usize, usize, usize) {
    STATS.stats()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_stream_stats_len() {
        let val = StreamStats {
            created_at: 1667978841102,
            doc_time_min: 1667978841102,
            doc_time_max: 1667978845374,
            doc_num: 5000,
            file_num: 1,
            storage_size: 200.0,
            compressed_size: 3.0,
            index_size: 120000.0,
        };

        set_stream_stats("nexus", "default", StreamType::Logs, val.clone());
        let stats = get_stats();
        let (len, cap, mem_size) = get_cache_stats();
        assert_eq!(len, stats.len());
        assert_eq!(cap, 0);
        assert!(mem_size > 0);
    }

    #[test]
    fn test_get_set_stream_stats() {
        let val = StreamStats {
            created_at: 1667978841102,
            doc_time_min: 1667978841102,
            doc_time_max: 1667978845374,
            doc_num: 5000,
            file_num: 1,
            storage_size: 200.0,
            compressed_size: 3.0,
            index_size: 120000.0,
        };

        set_stream_stats("nexus", "default", StreamType::Logs, val.clone());
        let stats = get_stream_stats("nexus", "default", StreamType::Logs);
        assert_eq!(stats, val);

        let stats = get_stream_stats("nexus", "default", StreamType::Logs);
        assert_eq!(stats.doc_num, 5000);
    }

    #[test]
    fn test_remove_stream_stats() {
        let val = StreamStats {
            doc_num: 42,
            ..Default::default()
        };
        set_stream_stats("remove_test_org", "remove_stream", StreamType::Logs, val);
        let before = get_stream_stats("remove_test_org", "remove_stream", StreamType::Logs);
        assert_eq!(before.doc_num, 42);

        remove_stream_stats("remove_test_org", "remove_stream", StreamType::Logs);
        let after = get_stream_stats("remove_test_org", "remove_stream", StreamType::Logs);
        assert_eq!(after.doc_num, 0); // defaults to 0 after removal
    }

    #[test]
    fn test_remove_stream_stats_nonexistent_is_noop() {
        // removing a key that doesn't exist should not panic
        remove_stream_stats(
            "nonexistent_org_xyz",
            "nonexistent_stream",
            StreamType::Logs,
        );
    }

    #[test]
    fn test_incr_stream_stats_invalid_path_returns_error() {
        let meta = FileMeta {
            records: 10,
            ..Default::default()
        };
        let result = incr_stream_stats("too/short/path", &meta);
        assert!(result.is_err());
    }

    #[test]
    fn test_incr_stream_stats_zero_records_is_noop() {
        let meta = FileMeta {
            records: 0, // zero records → early return Ok(())
            ..Default::default()
        };
        let result = incr_stream_stats(
            "files/incr_org/logs/incr_stream/2024/01/01/00/abc_1.parquet",
            &meta,
        );
        assert!(result.is_ok());
    }
}
