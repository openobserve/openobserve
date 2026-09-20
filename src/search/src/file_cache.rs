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
    let (cached_files, cache_hits, cache_misses) =
        inspect_file_cache(trace_id, files, scan_stats, file_type).await;

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

    let sync_max_size = cfg.limit.file_download_sync_max_size as i64;
    let (small, large): (Vec<_>, Vec<_>) = files
        .iter()
        .filter(|(_, _, file, ..)| !cached_files.contains(file))
        .map(|(id, account, file, size, ts)| {
            (*id, account.to_string(), file.to_string(), *size, *ts)
        })
        .partition(|(.., size, _)| (1..=sync_max_size).contains(size));
    if !large.is_empty() {
        let trace_id = trace_id.to_string();
        let file_type = file_type.to_string();
        tokio::spawn(async move {
            let files_num = large.len();
            for (id, account, file, size, ts) in large {
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
    }
    download_small_files(trace_id, small, cache_type, scan_stats, file_type).await;

    if scan_stats.querier_memory_cached_files + scan_stats.querier_disk_cached_files < files_num / 2
    {
        (file_data::CacheType::None, cache_hits, cache_misses)
    } else {
        (cache_type, cache_hits, cache_misses)
    }
}

/// Inspect cache membership without downloading or queuing object bodies.
pub async fn inspect_file_cache<'a>(
    trace_id: &str,
    files: &'a [(i64, &String, &String, i64, i64)],
    scan_stats: &mut ScanStats,
    file_type: &str,
) -> (HashSet<&'a String>, u64, u64) {
    let mut cached_files = HashSet::with_capacity(files.len());
    let (mut cache_hits, mut cache_misses) = (0, 0);

    let start = std::time::Instant::now();
    for (_id, _account, file, _size, max_ts) in files.iter() {
        if file_data::memory::exist(file).await {
            scan_stats.querier_memory_cached_files += 1;
            cached_files.insert(*file);
            cache_hits += 1;
        } else if file_data::disk::exist(file).await {
            scan_stats.querier_disk_cached_files += 1;
            cached_files.insert(*file);
            cache_hits += 1;
        } else {
            cache_misses += 1;
        }

        let stream_type = if file_type == "index" || file_type == "midx" {
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

    (cached_files, cache_hits, cache_misses)
}

// one full GET per small file is cheaper than a cold range read, so fetch them before the search
async fn download_small_files(
    trace_id: &str,
    files: Vec<file_downloader::DownloadFile>,
    cache_type: file_data::CacheType,
    scan_stats: &mut ScanStats,
    file_type: &str,
) {
    if files.is_empty() {
        return;
    }
    let start = std::time::Instant::now();
    let total = files.len();
    let concurrency = get_config().limit.query_thread_num;
    let cached = file_downloader::download_sync(trace_id, files, cache_type, concurrency).await;
    if cache_type == file_data::CacheType::Memory {
        scan_stats.querier_memory_cached_files += cached as i64;
    } else {
        scan_stats.querier_disk_cached_files += cached as i64;
    }
    log::info!(
        "[trace_id {trace_id}] search->storage: downloaded {cached} of {total} small files of {file_type} into {cache_type:?} before search, took: {} ms",
        start.elapsed().as_millis()
    );
}

#[cfg(test)]
mod tests {
    use std::{
        fmt,
        future::Future,
        process::Command,
        sync::{Arc, Mutex},
        time::Duration,
    };

    use bytes::Bytes;
    use futures::stream::BoxStream;
    use object_store::{
        CopyOptions, GetOptions, GetResult, ListResult, MultipartUpload, ObjectMeta, ObjectStore,
        PutMultipartOptions, PutOptions, PutPayload, PutResult, Result as StoreResult,
        memory::InMemory, path::Path,
    };

    use super::{ScanStats, cache_files, calc_target_partitions, file_data, inspect_file_cache};

    const ACCOUNT: &str = "cache-inspection:default";

    #[derive(Debug, Default)]
    struct TrackingStore {
        inner: InMemory,
        reads: Arc<Mutex<Vec<String>>>,
    }

    impl fmt::Display for TrackingStore {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            write!(f, "cache inspection tracking store")
        }
    }

    #[async_trait::async_trait]
    impl ObjectStore for TrackingStore {
        async fn put_opts(
            &self,
            location: &Path,
            payload: PutPayload,
            options: PutOptions,
        ) -> StoreResult<PutResult> {
            self.inner.put_opts(location, payload, options).await
        }

        async fn put_multipart_opts(
            &self,
            location: &Path,
            options: PutMultipartOptions,
        ) -> StoreResult<Box<dyn MultipartUpload>> {
            self.inner.put_multipart_opts(location, options).await
        }

        async fn get_opts(&self, location: &Path, options: GetOptions) -> StoreResult<GetResult> {
            self.reads.lock().unwrap().push(location.to_string());
            self.inner.get_opts(location, options).await
        }

        fn delete_stream(
            &self,
            locations: BoxStream<'static, StoreResult<Path>>,
        ) -> BoxStream<'static, StoreResult<Path>> {
            self.inner.delete_stream(locations)
        }

        fn list(&self, prefix: Option<&Path>) -> BoxStream<'static, StoreResult<ObjectMeta>> {
            self.inner.list(prefix)
        }

        async fn list_with_delimiter(&self, prefix: Option<&Path>) -> StoreResult<ListResult> {
            self.inner.list_with_delimiter(prefix).await
        }

        async fn copy_opts(&self, from: &Path, to: &Path, options: CopyOptions) -> StoreResult<()> {
            self.inner.copy_opts(from, to, options).await
        }
    }

    #[test]
    fn target_partitions_interpolates_cache_ratio() {
        assert_eq!(calc_target_partitions(8, 32, 0.0), 32);
        assert_eq!(calc_target_partitions(8, 32, 0.5), 20);
        assert_eq!(calc_target_partitions(8, 32, 1.0), 8);
    }

    #[test]
    fn inspection_reports_membership_without_reads_or_queues() {
        isolated(
            "inspection_reports_membership_without_reads_or_queues",
            async {
                let reads = setup(true, true, false, false).await;
                let account = ACCOUNT.to_string();
                let memory = key("memory");
                let disk = key("disk");
                let both = key("both");
                let missing = key("missing");
                let small_missing = key("small-missing");
                file_data::memory::set(&memory, Bytes::from_static(b"memory"))
                    .await
                    .unwrap();
                file_data::disk::set(&disk, Bytes::from_static(b"disk"))
                    .await
                    .unwrap();
                file_data::memory::set(&both, Bytes::from_static(b"memory"))
                    .await
                    .unwrap();
                file_data::disk::set(&both, Bytes::from_static(b"disk"))
                    .await
                    .unwrap();
                let ts = config::utils::time::now_micros() - 60_000_000;
                let files = [
                    (1, &account, &memory, 6, ts),
                    (5, &account, &small_missing, 7, ts),
                    (2, &account, &disk, 4, ts),
                    (3, &account, &both, 6, ts),
                    (4, &account, &missing, 2_000_000, ts),
                    (1, &account, &memory, 6, ts),
                ];
                let mut stats = ScanStats {
                    querier_memory_cached_files: 5,
                    querier_disk_cached_files: 7,
                    compressed_size: 123,
                    original_size: 456,
                    ..Default::default()
                };
                let ages = config::metrics::FILE_ACCESS_TIME.with_label_values(&["logs"]);
                let before = ages.get_sample_count();
                let (cached, hits, misses) =
                    inspect_file_cache("inspection", &files, &mut stats, "parquet").await;
                assert_eq!(cached, [&memory, &disk, &both].into_iter().collect());
                assert_eq!((hits, misses), (4, 2));
                assert_eq!(
                    (
                        stats.querier_memory_cached_files,
                        stats.querier_disk_cached_files
                    ),
                    (8, 8)
                );
                assert_eq!((stats.compressed_size, stats.original_size), (123, 456));
                assert_eq!(ages.get_sample_count(), before + files.len() as u64);
                assert!(!file_data::memory::exist(&missing).await);
                assert!(!file_data::disk::exist(&missing).await);
                assert!(!file_data::memory::exist(&small_missing).await);
                assert!(!file_data::disk::exist(&small_missing).await);
                assert_idle(&reads).await;
            },
        );
    }

    #[test]
    fn empty_inspection_preserves_stats_and_cached_fast_path() {
        isolated(
            "empty_inspection_preserves_stats_and_cached_fast_path",
            async {
                let reads = setup(true, true, false, false).await;
                let mut stats = ScanStats {
                    querier_memory_cached_files: 2,
                    ..Default::default()
                };
                let (cached, hits, misses) =
                    inspect_file_cache("empty", &[], &mut stats, "parquet").await;
                assert!(cached.is_empty());
                assert_eq!((hits, misses, stats.querier_memory_cached_files), (0, 0, 2));
                assert_eq!(
                    cache_files("empty", &[], &mut ScanStats::default(), "parquet").await,
                    (file_data::CacheType::Disk, 0, 0)
                );
                assert_idle(&reads).await;
            },
        );
    }

    #[test]
    fn cache_files_downloads_small_and_queues_large_normally() {
        isolated(
            "cache_files_downloads_small_and_queues_large_normally",
            async {
                download_and_queue(false).await;
            },
        );
    }

    #[test]
    fn cache_files_preserves_priority_queue_selection() {
        isolated("cache_files_preserves_priority_queue_selection", async {
            download_and_queue(true).await;
        });
    }

    #[test]
    fn cache_files_preserves_uncached_majority_return_value() {
        isolated(
            "cache_files_preserves_uncached_majority_return_value",
            async {
                let reads = setup(true, true, false, false).await;
                let account = ACCOUNT.to_string();
                let keys = [key("large-a"), key("large-b"), key("large-c")];
                let ts = config::utils::time::now_micros();
                let files = keys
                    .iter()
                    .enumerate()
                    .map(|(i, key)| (i as i64, &account, key, 2_000_000, ts))
                    .collect::<Vec<_>>();
                let mut stats = ScanStats {
                    compressed_size: 6_000_000,
                    ..Default::default()
                };
                assert_eq!(
                    cache_files("large", &files, &mut stats, "parquet").await,
                    (file_data::CacheType::None, 0, 3)
                );
                tokio::time::timeout(Duration::from_secs(2), async {
                    while queue_sizes() != (3, 0) {
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .unwrap();
                assert_eq!(
                    (
                        stats.querier_memory_cached_files,
                        stats.querier_disk_cached_files
                    ),
                    (0, 0)
                );
                assert!(reads.lock().unwrap().is_empty());
            },
        );
    }

    #[test]
    fn cache_files_retains_disk_download_and_all_cached_behavior() {
        isolated(
            "cache_files_retains_disk_download_and_all_cached_behavior",
            async {
                let reads = setup(false, true, true, false).await;
                let account = ACCOUNT.to_string();
                let small = key("small");
                infra::storage::put(&account, &small, Bytes::from_static(b"payload"))
                    .await
                    .unwrap();
                let files = [(1, &account, &small, 7, config::utils::time::now_micros())];
                let mut stats = ScanStats {
                    compressed_size: 7,
                    ..Default::default()
                };
                assert_eq!(
                    cache_files("disk", &files, &mut stats, "parquet").await,
                    (file_data::CacheType::Disk, 0, 1)
                );
                assert_eq!(
                    (
                        stats.querier_memory_cached_files,
                        stats.querier_disk_cached_files
                    ),
                    (0, 1)
                );
                assert_eq!(
                    file_data::disk::get(&small, None).await.unwrap(),
                    Bytes::from_static(b"payload")
                );
                let mut stats = ScanStats::default();
                assert_eq!(
                    cache_files("cached", &files, &mut stats, "parquet").await,
                    (file_data::CacheType::Disk, 1, 0)
                );
                assert_eq!(*reads.lock().unwrap(), vec![small]);
                assert_eq!(queue_sizes(), (0, 0));
            },
        );
    }

    #[test]
    fn cache_files_preserves_disabled_and_size_ineligible_behavior() {
        isolated(
            "cache_files_preserves_disabled_and_size_ineligible_behavior",
            async {
                let reads = setup(false, false, true, false).await;
                let account = ACCOUNT.to_string();
                let missing = key("missing");
                let files = [(1, &account, &missing, 7, config::utils::time::now_micros())];
                assert_eq!(
                    cache_files("disabled", &files, &mut ScanStats::default(), "parquet").await,
                    (file_data::CacheType::None, 0, 1)
                );
                let mut cfg = config::config::init();
                cfg.common.is_local_storage = false;
                let skip = cfg.memory_cache.skip_size.max(cfg.disk_cache.skip_size);
                config::CONFIG.store(Arc::new(cfg));
                let mut stats = ScanStats {
                    compressed_size: skip as i64,
                    ..Default::default()
                };
                assert_eq!(
                    cache_files("too-large", &files, &mut stats, "parquet").await,
                    (file_data::CacheType::None, 0, 1)
                );
                assert_idle(&reads).await;
            },
        );
    }

    async fn download_and_queue(priority: bool) {
        let reads = setup(true, true, false, priority).await;
        let account = ACCOUNT.to_string();
        let cached = key("cached");
        let small = key("small");
        let large = key("large");
        file_data::memory::set(&cached, Bytes::from_static(b"cached"))
            .await
            .unwrap();
        infra::storage::put(&account, &small, Bytes::from_static(b"payload"))
            .await
            .unwrap();
        let ts = config::utils::time::now_micros();
        let files = [
            (1, &account, &cached, 6, ts),
            (2, &account, &small, 7, ts),
            (3, &account, &large, 2_000_000, ts),
        ];
        let mut stats = ScanStats {
            compressed_size: 2_000_013,
            ..Default::default()
        };
        assert_eq!(
            cache_files("downloads", &files, &mut stats, "parquet").await,
            (file_data::CacheType::Memory, 1, 2)
        );
        assert_eq!(
            (
                stats.querier_memory_cached_files,
                stats.querier_disk_cached_files
            ),
            (2, 0)
        );
        assert_eq!(
            file_data::memory::get(&small, None).await.unwrap(),
            Bytes::from_static(b"payload")
        );
        let expected = if priority { (0, 1) } else { (1, 0) };
        tokio::time::timeout(Duration::from_secs(2), async {
            while queue_sizes() != expected {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(*reads.lock().unwrap(), vec![small]);
        assert!(!file_data::memory::exist(&large).await);
    }

    async fn setup(
        memory: bool,
        disk: bool,
        remote: bool,
        priority: bool,
    ) -> Arc<Mutex<Vec<String>>> {
        let store = TrackingStore::default();
        let reads = Arc::clone(&store.reads);
        infra::storage::add_account("cache-inspection", Box::new(store)).await;
        let mut cfg = config::config::init();
        cfg.memory_cache.enabled = memory;
        cfg.disk_cache.enabled = disk;
        cfg.common.is_local_storage = !remote;
        cfg.limit.file_download_enable_priority_queue = priority;
        config::CONFIG.store(Arc::new(cfg));
        assert_eq!(queue_sizes(), (0, 0));
        reads
    }

    fn key(name: &str) -> String {
        format!("files/cache-inspection/logs/stream/2026/09/20/10/{name}.parquet")
    }

    fn queue_sizes() -> (i64, i64) {
        (
            config::metrics::FILE_DOWNLOADER_NORMAL_QUEUE_SIZE
                .with_label_values::<&str>(&[])
                .get(),
            config::metrics::FILE_DOWNLOADER_PRIORITY_QUEUE_SIZE
                .with_label_values::<&str>(&[])
                .get(),
        )
    }

    async fn assert_idle(reads: &Arc<Mutex<Vec<String>>>) {
        tokio::task::yield_now().await;
        assert!(reads.lock().unwrap().is_empty());
        assert_eq!(queue_sizes(), (0, 0));
    }

    fn isolated(name: &str, task: impl Future<Output = ()>) {
        if std::env::var("O2_FILE_CACHE_TEST").as_deref() == Ok(name) {
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(task);
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        for (name, _) in std::env::vars().filter(|(name, _)| name.starts_with("ZO_")) {
            command.env_remove(name);
        }
        let output = command
            .args([
                "--exact",
                &format!("file_cache::tests::{name}"),
                "--nocapture",
            ])
            .current_dir(directory.path())
            .env("O2_FILE_CACHE_TEST", name)
            .env("ZO_DATA_DIR", directory.path().join("data"))
            .env("ZO_DATA_CACHE_DIR", directory.path().join("cache"))
            .env("ZO_LOCAL_MODE", "true")
            .env("ZO_RESULT_CACHE_ENABLED", "true")
            .env("ZO_MEMORY_CACHE_ENABLED", "true")
            .env("ZO_MEMORY_CACHE_BUCKET_NUM", "1")
            .env("ZO_MEMORY_CACHE_MAX_SIZE", "16")
            .env("ZO_MEMORY_CACHE_SKIP_SIZE", "8")
            .env("ZO_DISK_CACHE_ENABLED", "true")
            .env("ZO_DISK_CACHE_BUCKET_NUM", "1")
            .env("ZO_DISK_CACHE_MAX_SIZE", "16")
            .env("ZO_DISK_CACHE_SKIP_SIZE", "8")
            .env("ZO_QUERY_THREAD_NUM", "2")
            .env("ZO_FILE_DOWNLOAD_SYNC_MAX_SIZE", "1")
            .env("ZO_CACHE_LATEST_FILES_DOWNLOAD_FROM_NODE", "false")
            .env("ZO_TELEMETRY", "false")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed; 0 failed"));
    }
}
