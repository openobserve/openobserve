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

use std::sync::Arc;

use config::get_config;
use infra::cache::file_data;
use once_cell::sync::Lazy;
use tokio::sync::{
    Mutex,
    mpsc::{Receiver, Sender},
};

type FileInfo = (String, String, i64, file_data::CacheType);

struct DownloadQueue {
    sender: Sender<FileInfo>,
    receiver: Arc<Mutex<Receiver<FileInfo>>>,
}

impl DownloadQueue {
    fn new(sender: Sender<FileInfo>, receiver: Arc<Mutex<Receiver<FileInfo>>>) -> Self {
        Self { sender, receiver }
    }
}

const FILE_DOWNLOAD_QUEUE_SIZE: usize = 10000;
static FILE_DOWNLOAD_CHANNEL: Lazy<DownloadQueue> = Lazy::new(|| {
    let (tx, rx) = tokio::sync::mpsc::channel::<FileInfo>(FILE_DOWNLOAD_QUEUE_SIZE);
    DownloadQueue::new(tx, Arc::new(Mutex::new(rx)))
});

pub async fn run() -> Result<(), anyhow::Error> {
    let cfg = get_config();
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
                        match download_file(&trace_id, &file, cache).await {
                            Ok(data_len) => {
                                if data_len > 0 && data_len != file_size as usize {
                                    log::warn!(
                                        "[trace_id {trace_id}] search->storage: download file {} found size mismatch, expected: {}, actual: {}, will update it",
                                        file,
                                        file_size,
                                        data_len,
                                    );
                                    // update database
                                    if let Err(e) = infra::file_list::update_compressed_size(
                                        &file,
                                        data_len as i64,
                                    )
                                    .await
                                    {
                                        log::error!(
                                            "[trace_id {trace_id}] search->storage: update file size for file {} err: {}",
                                            file,
                                            e,
                                        );
                                    }
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

    Ok(())
}

async fn download_file(
    trace_id: &str,
    file_name: &str,
    cache_type: file_data::CacheType,
) -> Result<usize, anyhow::Error> {
    let cfg = get_config();
    let ret = match cache_type {
        file_data::CacheType::Memory => {
            let mut disk_exists = false;
            let mem_exists = file_data::memory::exist(file_name).await;
            if !mem_exists && !cfg.memory_cache.skip_disk_check {
                // when skip_disk_check = false, need to check disk cache
                disk_exists = file_data::disk::exist(file_name).await;
            }
            if !mem_exists && (cfg.memory_cache.skip_disk_check || !disk_exists) {
                file_data::memory::download(trace_id, file_name).await
            } else {
                Ok(0)
            }
        }
        file_data::CacheType::Disk => {
            if !file_data::disk::exist(file_name).await {
                file_data::disk::download(trace_id, file_name).await
            } else {
                Ok(0)
            }
        }
        _ => Ok(0),
    };
    let data_len = ret?;
    log::debug!(
        "[trace_id {trace_id}] successfully downloaded file {file_name} into cache {:?}",
        cache_type
    );
    Ok(data_len)
}

pub async fn queue_background_download(
    trace_id: &str,
    file: &str,
    size: i64,
    cache_type: file_data::CacheType,
) -> Result<(), anyhow::Error> {
    FILE_DOWNLOAD_CHANNEL
        .sender
        .send((trace_id.to_owned(), file.to_owned(), size, cache_type))
        .await?;
    Ok(())
}
