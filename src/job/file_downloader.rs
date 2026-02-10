// Copyright 2025 OpenObserve Inc.
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

use std::{collections::VecDeque, sync::Arc};

use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::cluster::{Role, RoleGroup, get_internal_grpc_token},
    metrics,
    utils::time::now_micros,
};
use futures_util::StreamExt;
use hashbrown::{HashMap, HashSet};
use infra::{cache::file_data, cluster};
use once_cell::sync::Lazy;
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
    sender: Sender<FileInfo>,
    receiver: Arc<Mutex<Receiver<FileInfo>>>,
    stack: Arc<Mutex<VecDeque<FileInfo>>>,
}

impl PriorityDownloadQueue {
    fn new(sender: Sender<FileInfo>, receiver: Arc<Mutex<Receiver<FileInfo>>>) -> Self {
        Self {
            sender,
            receiver,
            stack: Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    async fn push(&self, file_info: FileInfo) {
        self.stack.lock().await.push_back(file_info);
    }

    async fn pop(&self) -> Option<FileInfo> {
        self.stack.lock().await.pop_front()
    }
}

const FILE_DOWNLOAD_QUEUE_SIZE: usize = 10000;
static FILE_DOWNLOAD_CHANNEL: Lazy<DownloadQueue> = Lazy::new(|| {
    let (tx, rx) = tokio::sync::mpsc::channel::<FileInfo>(FILE_DOWNLOAD_QUEUE_SIZE);
    DownloadQueue::new(tx, Arc::new(Mutex::new(rx)))
});

static PRIORITY_FILE_DOWNLOAD_CHANNEL: Lazy<PriorityDownloadQueue> = Lazy::new(|| {
    let (tx, rx) = tokio::sync::mpsc::channel::<FileInfo>(FILE_DOWNLOAD_QUEUE_SIZE);
    PriorityDownloadQueue::new(tx, Arc::new(Mutex::new(rx)))
});

pub async fn run() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    // handle normal queue download
    // move files
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

    // main task: add files to priority queue
    let rx = PRIORITY_FILE_DOWNLOAD_CHANNEL.receiver.clone();
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);

    tokio::spawn(async move {
        loop {
            let ret = rx.lock().await.recv().await;
            match ret {
                None => {
                    log::debug!("[FILE_CACHE_DOWNLOAD:JOB:PRIORITY] Receiving channel is closed");
                    if shutdown_tx.send(true).is_err() {
                        log::error!(
                            "[FILE_CACHE_DOWNLOAD:JOB:PRIORITY] Failed to send disconnect signal"
                        );
                    }
                    break;
                }
                Some((trace_id, id, account, file, file_size, cache)) => {
                    PRIORITY_FILE_DOWNLOAD_CHANNEL
                        .push((trace_id, id, account, file, file_size, cache))
                        .await;
                }
            }
        }
    });

    // worker tasks: handle priority queue download
    for thread in 0..cfg.limit.file_download_priority_queue_thread_num {
        let mut shutdown_rx = shutdown_rx.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = shutdown_rx.changed() => {
                        log::warn!(
                            "[FILE_CACHE_DOWNLOAD:JOB:PRIORITY] Received shutdown signal, exiting"
                        );
                        break;
                    }
                    _ = async {
                        let file_info = PRIORITY_FILE_DOWNLOAD_CHANNEL.pop().await;
                        match file_info {
                            Some((trace_id, id, account, file, file_size, cache)) => {
                                 // check if the file is already being downloaded
                                if processing_files::is_processing(&file) {
                                    log::warn!(
                                        "[trace_id {trace_id}] [thread {thread}] search->storage: file {file} is already being downloaded, will skip it"
                                    );
                                    // update metrics
                                    metrics::FILE_DOWNLOADER_PRIORITY_QUEUE_SIZE
                                        .with_label_values::<&str>(&[])
                                        .dec();
                                    return;
                                }

                                // add the file to processing set
                                processing_files::add(&file);

                                // download the file
                                match download_file(thread, &trace_id, id, &account, &file, file_size, cache).await {
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
                            None => {
                                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                            }
                        }
                    } => {}
                }
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
    let cfg = get_config();
    if cfg.limit.file_download_enable_priority_queue
        && should_prioritize_file(ts, cfg.limit.file_download_priority_queue_window_secs)
    {
        PRIORITY_FILE_DOWNLOAD_CHANNEL
            .sender
            .send((trace_id, id, account, file, size as usize, cache_type))
            .await?;

        // update metrics
        metrics::FILE_DOWNLOADER_PRIORITY_QUEUE_SIZE
            .with_label_values::<&str>(&[])
            .inc();
    } else {
        FILE_DOWNLOAD_CHANNEL
            .sender
            .send((
                trace_id,
                id,
                account,
                file.to_owned(),
                size as usize,
                cache_type,
            ))
            .await?;

        // update metrics
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
