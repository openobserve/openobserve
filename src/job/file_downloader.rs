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

use std::{
    collections::VecDeque,
    sync::{Arc, LazyLock as Lazy},
};

use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::cluster::{Role, RoleGroup, get_internal_grpc_token},
    metrics,
    utils::time::{day_micros, now_micros},
};
use futures_util::StreamExt;
use hashbrown::{HashMap, HashSet};
use infra::{cache::file_data, cluster};
use proto::cluster_rpc::{SimpleFileList, event_client::EventClient};
use tokio::sync::{
    Mutex,
    mpsc::{Receiver, Sender},
};
use tonic::{codec::CompressionEncoding, metadata::MetadataValue};

/// (trace_id, file_id, account, file, size, cache_type)
type FileInfo = (String, i64, String, String, usize, file_data::CacheType);

mod processing_files {
    use hashbrown::HashSet;
    use parking_lot::RwLock;

    use super::*;

    static PROCESSING_FILES: Lazy<RwLock<HashSet<String>>> =
        Lazy::new(|| RwLock::new(HashSet::new()));

    pub fn is_processing(file_name: &str) -> bool {
        PROCESSING_FILES.read().contains(file_name)
    }

    pub fn add(file_name: &str) {
        PROCESSING_FILES.write().insert(file_name.to_string());
    }

    pub fn remove(file_name: &str) {
        PROCESSING_FILES.write().remove(file_name);
    }
}

mod queued_files {
    use hashbrown::HashSet;
    use parking_lot::RwLock;

    use super::*;

    static QUEUED_FILES: Lazy<RwLock<HashSet<String>>> = Lazy::new(|| RwLock::new(HashSet::new()));

    /// Returns true if newly inserted (caller should enqueue), false if already present (skip).
    pub fn try_add(file_name: &str) -> bool {
        QUEUED_FILES.write().insert(file_name.to_string())
    }

    pub fn remove(file_name: &str) {
        QUEUED_FILES.write().remove(file_name);
    }
}

struct DownloadQueue {
    sender: Sender<FileInfo>,
    receiver: Arc<Mutex<Receiver<FileInfo>>>,
}

impl DownloadQueue {
    fn new(sender: Sender<FileInfo>, receiver: Arc<Mutex<Receiver<FileInfo>>>) -> Self {
        Self { sender, receiver }
    }
}

struct PriorityDownloadQueue {
    stack: Mutex<VecDeque<FileInfo>>,
    notify: tokio::sync::Notify,
    max_size: usize,
}

impl PriorityDownloadQueue {
    fn new(max_size: usize) -> Self {
        Self {
            stack: Mutex::new(VecDeque::with_capacity(max_size)),
            notify: tokio::sync::Notify::new(),
            max_size,
        }
    }

    // Returns false if at cap — caller must remove from queued_files and skip metric inc.
    async fn push(&self, file_info: FileInfo) -> bool {
        let mut stack = self.stack.lock().await;
        if stack.len() >= self.max_size {
            return false;
        }
        stack.push_back(file_info);
        drop(stack);
        self.notify.notify_one();
        true
    }

    // Blocks until an item is available. LIFO via pop_back.
    // notified() is created before the lock check to avoid missed-wakeup race.
    // Chains notify_one() so all workers drain the queue under burst load.
    async fn pop(&self) -> FileInfo {
        loop {
            let notified = self.notify.notified();
            {
                let mut stack = self.stack.lock().await;
                if let Some(item) = stack.pop_back() {
                    if !stack.is_empty() {
                        self.notify.notify_one();
                    }
                    return item;
                }
            }
            notified.await;
        }
    }
}

const FILE_DOWNLOAD_QUEUE_SIZE: usize = 10000;
static FILE_DOWNLOAD_CHANNEL: Lazy<DownloadQueue> = Lazy::new(|| {
    let (tx, rx) = tokio::sync::mpsc::channel::<FileInfo>(FILE_DOWNLOAD_QUEUE_SIZE);
    DownloadQueue::new(tx, Arc::new(Mutex::new(rx)))
});

static PRIORITY_FILE_DOWNLOAD_CHANNEL: Lazy<PriorityDownloadQueue> =
    Lazy::new(|| PriorityDownloadQueue::new(FILE_DOWNLOAD_QUEUE_SIZE));

pub async fn run() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    // worker tasks: handle normal queue download (FIFO via mpsc channel)
    for thread in 0..cfg.limit.file_download_thread_num {
        let rx = FILE_DOWNLOAD_CHANNEL.receiver.clone();
        tokio::spawn(async move {
            loop {
                let ret = rx.lock().await.recv().await;
                match ret {
                    None => {
                        log::debug!("[FILE_CACHE_DOWNLOAD:JOB:NORMAL] Receiving channel is closed");
                        break;
                    }
                    Some((trace_id, id, account, file, file_size, cache)) => {
                        // transition: queued → not-queued (must run before any skip path)
                        queued_files::remove(&file);

                        // check if the file is already being downloaded
                        if processing_files::is_processing(&file) {
                            log::warn!(
                                "[trace_id {trace_id}] [thread {thread}] search->storage: file {file} is already being downloaded, will skip it"
                            );
                            // update metrics
                            metrics::FILE_DOWNLOADER_NORMAL_QUEUE_SIZE
                                .with_label_values::<&str>(&[])
                                .dec();
                            continue;
                        }

                        // add the file to processing set
                        processing_files::add(&file);

                        // download the file
                        match download_file(
                            thread, &trace_id, id, &account, &file, file_size, cache,
                        )
                        .await
                        {
                            Ok(data_len) => {
                                if data_len > 0 && data_len != file_size {
                                    log::warn!(
                                        "[FILE_CACHE_DOWNLOAD:JOB:NORMAL] download file {file} found size mismatch, expected: {file_size}, actual: {data_len}, will skip it",
                                    );
                                }
                            }
                            Err(e) => {
                                log::error!(
                                    "[FILE_CACHE_DOWNLOAD:JOB:NORMAL] download file {file} to cache {cache:?} err: {e}",
                                );
                            }
                        }

                        // remove the file from processing set
                        processing_files::remove(&file);

                        // update metrics
                        metrics::FILE_DOWNLOADER_NORMAL_QUEUE_SIZE
                            .with_label_values::<&str>(&[])
                            .dec();
                    }
                }
            }
        });
    }

    // worker tasks: handle priority queue download (LIFO via VecDeque::pop_back)
    for thread in 0..cfg.limit.file_download_priority_queue_thread_num {
        tokio::spawn(async move {
            loop {
                let (trace_id, id, account, file, file_size, cache) =
                    PRIORITY_FILE_DOWNLOAD_CHANNEL.pop().await;

                // transition: queued → not-queued (must run before any skip path)
                queued_files::remove(&file);

                // check if the file is already being downloaded
                if processing_files::is_processing(&file) {
                    log::warn!(
                        "[trace_id {trace_id}] [thread {thread}] search->storage: file {file} is already being downloaded, will skip it"
                    );
                    metrics::FILE_DOWNLOADER_PRIORITY_QUEUE_SIZE
                        .with_label_values::<&str>(&[])
                        .dec();
                    continue;
                }

                // add the file to processing set
                processing_files::add(&file);

                // download the file
                match download_file(thread, &trace_id, id, &account, &file, file_size, cache).await
                {
                    Ok(data_len) => {
                        if data_len > 0 && data_len != file_size {
                            log::warn!(
                                "[FILE_CACHE_DOWNLOAD:JOB:PRIORITY] download file {file} found size mismatch, expected: {file_size}, actual: {data_len}, will skip it",
                            );
                        }
                    }
                    Err(e) => {
                        log::error!(
                            "[FILE_CACHE_DOWNLOAD:JOB:PRIORITY] download file {file} to cache {cache:?} err: {e}",
                        );
                    }
                }

                // remove the file from processing set
                processing_files::remove(&file);

                // update metrics
                metrics::FILE_DOWNLOADER_PRIORITY_QUEUE_SIZE
                    .with_label_values::<&str>(&[])
                    .dec();
            }
        });
    }
    Ok(())
}

async fn download_file(
    thread: usize,
    trace_id: &str,
    file_id: i64,
    account: &str,
    file_name: &str,
    file_size: usize,
    cache_type: file_data::CacheType,
) -> Result<usize, anyhow::Error> {
    let cfg = get_config();

    // download file from node
    if cfg.cache_latest_files.download_from_node
        && let Ok(ok) =
            download_file_with_consistent_hash(file_id, account, file_name, file_size).await
        && ok
    {
        return Ok(file_size);
    }

    // download from object store
    let size = if file_size > 0 { Some(file_size) } else { None };
    let start = std::time::Instant::now();
    let ret = match cache_type {
        file_data::CacheType::Memory => {
            let mut disk_exists = false;
            let mem_exists = file_data::memory::exist(file_name).await;
            if !mem_exists && !cfg.memory_cache.skip_disk_check {
                disk_exists = file_data::disk::exist(file_name).await;
            }
            if !mem_exists && (cfg.memory_cache.skip_disk_check || !disk_exists) {
                file_data::memory::download(account, file_name, size).await
            } else {
                Ok(0)
            }
        }
        file_data::CacheType::Disk => {
            if !file_data::disk::exist(file_name).await {
                file_data::disk::download(account, file_name, size).await
            } else {
                Ok(0)
            }
        }
        _ => Ok(0),
    };
    log::debug!(
        "[FILE_CACHE_DOWNLOAD:JOB:{thread}] [trace_id {trace_id}] download file: {file_name}, ret: {:?}, took: {} ms",
        ret,
        start.elapsed().as_millis()
    );
    ret
}

async fn download_file_with_consistent_hash(
    file_id: i64,
    account: &str,
    file_name: &str,
    file_size: usize,
) -> Result<bool, anyhow::Error> {
    let role_group = if LOCAL_NODE.is_interactive_querier() {
        RoleGroup::Interactive
    } else {
        RoleGroup::Background
    };
    let Some(node_name) = cluster::get_node_from_consistent_hash(
        &file_id.to_string(),
        &Role::Querier,
        Some(role_group),
    )
    .await
    else {
        return Ok(false);
    };
    // get node by file_id
    let Some(node) = cluster::get_cached_node_by_name(&node_name).await else {
        return Ok(false);
    };
    // download file from node
    let Ok(failed) = download_from_node(
        &node.grpc_addr,
        &[(
            file_id,
            account.to_string(),
            file_name.to_string(),
            file_size as i64,
            0,
        )],
    )
    .await
    else {
        return Ok(false);
    };
    // failed is empty means download success
    Ok(failed.is_empty())
}

// download files from node and return download failed files
// file: (account, file, size, ts)
pub async fn download_from_node(
    addr: &str,
    files: &[(i64, String, String, i64, i64)],
) -> Result<Vec<(i64, String, String, i64, i64)>, anyhow::Error> {
    let start = std::time::Instant::now();
    let cfg = get_config();
    log::debug!(
        "[FILE_CACHE_DOWNLOAD:gRPC] Download files from node start, files: {:?}",
        files.len()
    );

    let token: MetadataValue<_> = get_internal_grpc_token()
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid token"))?;

    let channel = infra::client::grpc::get_cached_channel(addr).await?;
    let client = EventClient::with_interceptor(channel, move |mut req: tonic::Request<()>| {
        req.metadata_mut().insert("authorization", token.clone());
        Ok(req)
    });

    let file_size_map = files
        .iter()
        .filter_map(|(_, _, f, s, _)| {
            if *s > cfg.cache_latest_files.download_node_size * 1024 * 1024 {
                None
            } else {
                Some((f, *s as usize))
            }
        })
        .collect::<HashMap<_, _>>();
    if file_size_map.is_empty() {
        return Ok(files.to_vec());
    }
    let request = tonic::Request::new(SimpleFileList {
        files: files.iter().map(|(_, _, f, ..)| f.to_string()).collect(),
    });

    let resp = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .get_files(request)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to get files from {addr}, {e}"))?;

    let mut file_contents = HashMap::new();
    let mut downloaded_files = HashSet::new();
    let mut resp_stream = resp.into_inner();
    while let Some(resp) = resp_stream.next().await {
        let resp = match resp {
            Ok(resp) => resp,
            Err(err) => {
                if err.code() == tonic::Code::NotFound {
                    log::debug!(
                        "[FILE_CACHE_DOWNLOAD:gRPC] Failed to download file {} from {}: file not found",
                        err.message(),
                        addr
                    );
                    continue;
                }
                return Err(anyhow::anyhow!(
                    "Failed to download file from {addr}, {err}"
                ));
            }
        };
        for content in resp.entries {
            let entry = file_contents
                .entry(content.filename.clone())
                .or_insert(bytes::BytesMut::new());
            entry.extend_from_slice(&content.content);
            downloaded_files.insert(content.filename);
        }
    }

    log::debug!(
        "[FILE_CACHE_DOWNLOAD:gRPC] Successfully retrieved {} files from {} in {} ms",
        downloaded_files.len(),
        addr,
        start.elapsed().as_millis()
    );

    // Cache the file contents
    for (file, content) in file_contents {
        let data = content.freeze();
        if let Some(size) = file_size_map.get(&file)
            && *size != data.len()
        {
            log::warn!(
                "[FILE_CACHE_DOWNLOAD:gRPC] Failed to download file {} from {}: size mismatch, expected {} but got {}",
                file,
                addr,
                size,
                data.len()
            );
            downloaded_files.remove(&file);
            continue;
        }
        if let Err(e) = infra::cache::file_data::set(&file, data).await {
            log::error!("[FILE_CACHE_DOWNLOAD:gRPC] Failed to cache file {file}: {e}");
            downloaded_files.remove(&file);
        }
    }

    // Return list of failed files
    let failed_files: Vec<_> = files
        .iter()
        .filter(|(_, f, ..)| !downloaded_files.contains(f))
        .cloned()
        .collect();

    log::debug!(
        "[FILE_CACHE_DOWNLOAD:gRPC] Failed to retrieve {} files from {} in {} ms",
        failed_files.len(),
        addr,
        start.elapsed().as_millis()
    );

    Ok(failed_files)
}

pub async fn queue_download(
    trace_id: String,
    id: i64,
    account: String,
    file: String,
    size: i64,
    ts: i64,
    cache_type: file_data::CacheType,
) -> Result<(), anyhow::Error> {
    log::debug!(
        "[FILE_CACHE_DOWNLOAD:JOB] [trace_id {trace_id}] enqueue file: {file}, size: {size}, ts: {ts}"
    );

    // files with data older than the cache max age are not worth caching: with
    // time_lru they become the oldest bucket and are evicted first, so the
    // download would be wasted work. Skip the queue and let the query read
    // them directly from object storage.
    if exceeds_cache_max_age(ts, cache_type) {
        log::debug!(
            "[FILE_CACHE_DOWNLOAD:JOB] [trace_id {trace_id}] skip file: {file}, data is older than the cache max age"
        );
        return Ok(());
    }

    let cfg = get_config();

    // skip if already queued or already being downloaded
    if !queued_files::try_add(&file) {
        return Ok(());
    }
    if processing_files::is_processing(&file) {
        queued_files::remove(&file);
        return Ok(());
    }

    if cfg.limit.file_download_enable_priority_queue
        && should_prioritize_file(ts, cfg.limit.file_download_priority_queue_window_secs)
    {
        if PRIORITY_FILE_DOWNLOAD_CHANNEL
            .push((
                trace_id,
                id,
                account,
                file.clone(),
                size as usize,
                cache_type,
            ))
            .await
        {
            metrics::FILE_DOWNLOADER_PRIORITY_QUEUE_SIZE
                .with_label_values::<&str>(&[])
                .inc();
        } else {
            queued_files::remove(&file);
            log::warn!(
                "[FILE_CACHE_DOWNLOAD:JOB] priority queue full ({FILE_DOWNLOAD_QUEUE_SIZE}), dropping file: {file}"
            );
        }
    } else {
        if let Err(e) = FILE_DOWNLOAD_CHANNEL
            .sender
            .send((
                trace_id,
                id,
                account,
                file.clone(),
                size as usize,
                cache_type,
            ))
            .await
        {
            queued_files::remove(&file);
            return Err(e.into());
        }
        metrics::FILE_DOWNLOADER_NORMAL_QUEUE_SIZE
            .with_label_values::<&str>(&[])
            .inc();
    }
    Ok(())
}

// if the file timestamp is in the past window, it should be prioritized
fn should_prioritize_file(ts: i64, window_secs: i64) -> bool {
    let window_micros = window_secs * 1_000_000;
    let now = now_micros();
    ts > now - window_micros
}

/// Returns true if the file's data is older than the cache max age and should
/// not be downloaded into the cache.
pub fn exceeds_cache_max_age(ts: i64, cache_type: file_data::CacheType) -> bool {
    let cfg = get_config();
    let max_age_days = match cache_type {
        file_data::CacheType::Memory => cfg.memory_cache.max_age_days,
        file_data::CacheType::Disk => cfg.disk_cache.max_age_days,
        file_data::CacheType::None => 0,
    };
    exceeds_max_age(ts, max_age_days)
}

// if the file data is older than max_age_days, it should not be cached.
// max_age_days == 0 means no limit, ts <= 0 means the timestamp is unknown.
fn exceeds_max_age(ts: i64, max_age_days: i64) -> bool {
    if max_age_days <= 0 || ts <= 0 {
        return false;
    }
    ts < now_micros() - day_micros(max_age_days)
}

#[cfg(test)]
mod tests {
    use config::utils::time::{day_micros, hour_micros, now_micros};

    use super::{
        FileInfo, PriorityDownloadQueue, exceeds_max_age, file_data, processing_files, queued_files,
    };

    #[test]
    fn test_exceeds_max_age_disabled() {
        // max_age_days == 0 means no limit, nothing is too old
        let one_year_ago = now_micros() - day_micros(365);
        assert!(!exceeds_max_age(one_year_ago, 0));
        assert!(!exceeds_max_age(one_year_ago, -1));
    }

    #[test]
    fn test_exceeds_max_age_unknown_ts() {
        // unknown timestamp should not be skipped
        assert!(!exceeds_max_age(0, 3));
        assert!(!exceeds_max_age(-1, 3));
    }

    #[test]
    fn test_exceeds_max_age_recent_file() {
        let one_hour_ago = now_micros() - hour_micros(1);
        assert!(!exceeds_max_age(one_hour_ago, 3));
    }

    #[test]
    fn test_exceeds_max_age_old_file() {
        let thirty_days_ago = now_micros() - day_micros(30);
        assert!(exceeds_max_age(thirty_days_ago, 3));
    }

    #[test]
    fn test_is_processing_false_initially() {
        assert!(!processing_files::is_processing(
            "unique_not_added_file_abc123.parquet"
        ));
    }

    #[test]
    fn test_add_and_is_processing() {
        let name = "test_add_file_xyz999.parquet";
        processing_files::add(name);
        assert!(processing_files::is_processing(name));
        processing_files::remove(name);
    }

    #[test]
    fn test_remove_clears_processing() {
        let name = "test_remove_file_qqq888.parquet";
        processing_files::add(name);
        processing_files::remove(name);
        assert!(!processing_files::is_processing(name));
    }

    #[test]
    fn test_normal_queue_cap_honored() {
        let cap = 3;
        let (tx, _rx) = tokio::sync::mpsc::channel::<FileInfo>(cap);

        for i in 0..cap {
            let result = tx.try_send((
                format!("trace-{i}"),
                i as i64,
                "org".into(),
                format!("file-{i}.parquet"),
                1024,
                file_data::CacheType::Disk,
            ));
            assert!(result.is_ok(), "send {i} should succeed under cap");
        }

        let overflow = tx.try_send((
            "trace-overflow".into(),
            99,
            "org".into(),
            "overflow.parquet".into(),
            1024,
            file_data::CacheType::Disk,
        ));
        assert!(overflow.is_err(), "send beyond cap must fail");
    }

    #[test]
    fn test_queued_files_no_duplicates() {
        let file = "dedup_test_unique_zz1234.parquet";

        // first add succeeds
        assert!(queued_files::try_add(file));
        // same file rejected while already queued
        assert!(!queued_files::try_add(file));

        // after remove, can be queued again
        queued_files::remove(file);
        assert!(queued_files::try_add(file));

        // cleanup
        queued_files::remove(file);
    }

    #[tokio::test]
    async fn test_priority_queue_cap_honored() {
        let cap = 3;
        let queue = PriorityDownloadQueue::new(cap);

        // fill to cap — all succeed
        for i in 0..cap {
            let ok = queue
                .push((
                    format!("trace-{i}"),
                    i as i64,
                    "org".into(),
                    format!("file-{i}.parquet"),
                    1024,
                    file_data::CacheType::Disk,
                ))
                .await;
            assert!(ok, "push {i} should succeed under cap");
        }

        // one more must be rejected
        let overflow = queue
            .push((
                "trace-overflow".into(),
                99,
                "org".into(),
                "overflow.parquet".into(),
                1024,
                file_data::CacheType::Disk,
            ))
            .await;
        assert!(!overflow, "push beyond cap must return false");
    }
}
