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

use config::{get_config, meta::stream::FileMeta};
use infra::cache::file_data;
use once_cell::sync::Lazy;
use tokio::sync::{
    Mutex,
    mpsc::{Receiver, Sender},
};

type FileInfo = (String, String, usize, file_data::CacheType);

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
    for _ in 0..cfg.limit.file_download_thread_num {
        let rx = FILE_DOWNLOAD_CHANNEL.receiver.clone();
        tokio::spawn(async move {
            loop {
                let ret = rx.lock().await.recv().await;
                match ret {
                    None => {
                        log::debug!("[FILE_CACHE_DOWNLOAD:JOB] Receiving channel is closed");
                        break;
                    }
                    Some((trace_id, file, file_size, cache)) => {
                        match download_file(&trace_id, &file, file_size, cache).await {
                            Ok(data_len) => {
                                if data_len > 0 && data_len != file_size {
                                    log::warn!(
                                        "[trace_id {trace_id}] search->storage: download file {} found size mismatch, expected: {}, actual: {}, will skip it",
                                        file,
                                        file_size,
                                        data_len,
                                    );
                                    // update database
                                    // if let Err(e) = infra::file_list::update_compressed_size(
                                    //     &file,
                                    //     data_len as i64,
                                    // )
                                    // .await
                                    // {
                                    //     log::error!(
                                    //         "[trace_id {trace_id}] search->storage: update file
                                    // size for file {} err: {}",
                                    //         file,
                                    //         e,
                                    //     );
                                    // }
                                }
                            }
                            Err(e) => {
                                log::error!(
                                    "[trace_id {trace_id}] search->storage: download file {} to cache {:?} err: {}",
                                    file,
                                    cache,
                                    e,
                                );
                            }
                        }
                    }
                }
            }
        });
    }

    // add files to priority queue
    let rx = PRIORITY_FILE_DOWNLOAD_CHANNEL.receiver.clone();
    tokio::spawn(async move {
        loop {
            let ret = rx.lock().await.recv().await;
            match ret {
                None => {
                    log::debug!(
                        "[FILE_CACHE_DOWNLOAD:PRIORITY_QUEUE:JOB] Receiving channel is closed"
                    );
                    break;
                }
                Some((trace_id, file, file_size, cache)) => {
                    PRIORITY_FILE_DOWNLOAD_CHANNEL
                        .push((trace_id, file, file_size, cache))
                        .await;
                }
            }
        }
    });

    // handle priority queue download
    for _ in 0..cfg.limit.file_download_priority_queue_thread_num {
        tokio::spawn(async move {
            loop {
                let file_info = PRIORITY_FILE_DOWNLOAD_CHANNEL.pop().await;
                match file_info {
                    Some((trace_id, file, file_size, cache)) => {
                        match download_file(&trace_id, &file, file_size, cache).await {
                            Ok(data_len) => {
                                if data_len > 0 && data_len != file_size {
                                    log::warn!(
                                        "[trace_id {}] priority queue download file {} found size mismatch, expected: {}, actual: {}, will skip it",
                                        trace_id,
                                        file,
                                        file_size,
                                        data_len
                                    );
                                }
                            }
                            Err(e) => {
                                log::error!(
                                    "[trace_id {}] priority queue download file {} to cache {:?} err: {}",
                                    trace_id,
                                    file,
                                    cache,
                                    e
                                );
                            }
                        }
                    }
                    None => {
                        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                    }
                }
            }
        });
    }
    Ok(())
}

async fn download_file(
    trace_id: &str,
    file_name: &str,
    file_size: usize,
    cache_type: file_data::CacheType,
) -> Result<usize, anyhow::Error> {
    let cfg = get_config();
    match cache_type {
        file_data::CacheType::Memory => {
            let mut disk_exists = false;
            let mem_exists = file_data::memory::exist(file_name).await;
            if !mem_exists && !cfg.memory_cache.skip_disk_check {
                // when skip_disk_check = false, need to check disk cache
                disk_exists = file_data::disk::exist(file_name).await;
            }
            if !mem_exists && (cfg.memory_cache.skip_disk_check || !disk_exists) {
                file_data::memory::download(trace_id, file_name, Some(file_size)).await
            } else {
                Ok(0)
            }
        }
        file_data::CacheType::Disk => {
            if !file_data::disk::exist(file_name).await {
                file_data::disk::download(trace_id, file_name, Some(file_size)).await
            } else {
                Ok(0)
            }
        }
        _ => Ok(0),
    }
}

pub async fn queue_background_download(
    trace_id: &str,
    file: &str,
    size: i64,
    cache_type: file_data::CacheType,
    to_priority_queue: bool,
) -> Result<(), anyhow::Error> {
    if !to_priority_queue {
        FILE_DOWNLOAD_CHANNEL
            .sender
            .send((
                trace_id.to_owned(),
                file.to_owned(),
                size as usize,
                cache_type,
            ))
            .await?;
    } else {
        PRIORITY_FILE_DOWNLOAD_CHANNEL
            .sender
            .send((
                trace_id.to_owned(),
                file.to_owned(),
                size as usize,
                cache_type,
            ))
            .await?;
    }
    Ok(())
}

pub fn should_prioritize_file(file_meta: &FileMeta) -> bool {
    let cfg = get_config();
    let window_micros = (cfg.limit.file_download_priority_queue_window_secs * 1_000_000) as i64;
    let now = chrono::Utc::now().timestamp_micros();
    // Check if the file's timestamp range overlaps with the current time window.
    // A file is prioritized if its data is "fresh" - containing events from the recent past
    // through the near future relative to current time, within the configured window.
    file_meta.min_ts > now - window_micros && file_meta.max_ts < now + window_micros
}
