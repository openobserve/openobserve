// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::collections::HashSet;

use config::{get_config, is_local_disk_storage, meta::search::ScanStats};
use infra::cache::{file_data, file_downloader};

/// Linear interpolation: cached_ratio=0 -> query_thread_num, cached_ratio=1 -> cpu_num.
pub fn calc_target_partitions(cpu_num: usize, query_thread_num: usize, cached_ratio: f64) -> usize {
    (cpu_num as i64
        + ((query_thread_num as i64 - cpu_num as i64) as f64 * (1.0 - cached_ratio)) as i64)
        as usize
}

#[tracing::instrument(name = "service:search:grpc:storage:cache_files", skip_all)]
pub async fn cache_files(
    trace_id: &str,
    files: &[(i64, &String, &String, i64, i64)],
    scan_stats: &mut ScanStats,
    file_type: &str,
) -> (file_data::CacheType, u64, u64) {
    let mut cached_files = HashSet::with_capacity(files.len());
    let (mut cache_hits, mut cache_misses) = (0, 0);

    let start = std::time::Instant::now();
    for (_id, _account, file, _size, max_ts) in files.iter() {
        if file_data::memory::exist(file).await {
            scan_stats.querier_memory_cached_files += 1;
            cached_files.insert(file);
            cache_hits += 1;
        } else if file_data::disk::exist(file).await {
            scan_stats.querier_disk_cached_files += 1;
            cached_files.insert(file);
            cache_hits += 1;
        } else {
            cache_misses += 1;
        }

        let stream_type = if file_type == "index" {
            config::meta::stream::StreamType::Index
        } else if file.contains("/logs/") {
            config::meta::stream::StreamType::Logs
        } else if file.contains("/metrics/") {
            config::meta::stream::StreamType::Metrics
        } else if file.contains("/traces/") {
            config::meta::stream::StreamType::Traces
        } else {
            config::meta::stream::StreamType::Logs
        };

        let current_time = chrono::Utc::now().timestamp_micros();
        let file_age_seconds = (current_time - max_ts) / 1_000_000;
        let file_age_hours = file_age_seconds as f64 / 3600.0;

        if file_age_hours > 0.0 {
            config::metrics::FILE_ACCESS_TIME
                .with_label_values(&[&stream_type.to_string()])
                .observe(file_age_hours);
        }
    }

    let check_cache_took = start.elapsed().as_millis() as usize;
    if check_cache_took > 1000 {
        log::warn!(
            "[trace_id {trace_id}] search->storage: check file cache took: {check_cache_took} ms",
        );
    }

    let files_num = files.len() as i64;
    if files_num == scan_stats.querier_memory_cached_files + scan_stats.querier_disk_cached_files {
        return (file_data::CacheType::Disk, cache_hits, cache_misses);
    }

    let cfg = get_config();
    let cache_type = if cfg.memory_cache.enabled
        && scan_stats.compressed_size < cfg.memory_cache.skip_size as i64
    {
        file_data::CacheType::Memory
    } else if !is_local_disk_storage()
        && cfg.disk_cache.enabled
        && scan_stats.compressed_size < cfg.disk_cache.skip_size as i64
    {
        file_data::CacheType::Disk
    } else {
        return (file_data::CacheType::None, cache_hits, cache_misses);
    };

    let trace_id = trace_id.to_string();
    let files = files
        .iter()
        .filter_map(|(id, account, file, size, ts)| {
            if cached_files.contains(file) {
                None
            } else {
                Some((*id, account.to_string(), file.to_string(), *size, *ts))
            }
        })
        .collect::<Vec<_>>();
    let file_type = file_type.to_string();
    tokio::spawn(async move {
        let files_num = files.len();
        for (id, account, file, size, ts) in files {
            if let Err(e) = file_downloader::queue_download(
                trace_id.clone(),
                id,
                account,
                file.clone(),
                size,
                ts,
                cache_type,
            )
            .await
            {
                log::error!(
                    "[trace_id {trace_id}] error in queuing file {file} for background download: {e}"
                );
            }
        }
        log::info!(
            "[trace_id {trace_id}] search->storage: successfully enqueued {files_num} files of {file_type} for background download into {cache_type:?}",
        );
    });

    if scan_stats.querier_memory_cached_files + scan_stats.querier_disk_cached_files < files_num / 2
    {
        (file_data::CacheType::None, cache_hits, cache_misses)
    } else {
        (cache_type, cache_hits, cache_misses)
    }
}

#[cfg(test)]
mod tests {
    use super::calc_target_partitions;

    #[test]
    fn target_partitions_interpolates_cache_ratio() {
        assert_eq!(calc_target_partitions(8, 32, 0.0), 32);
        assert_eq!(calc_target_partitions(8, 32, 0.5), 20);
        assert_eq!(calc_target_partitions(8, 32, 1.0), 8);
    }
}
