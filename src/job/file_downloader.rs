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

/// (account, file, size, cache_type)
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
                    Some((account, file, file_size, cache)) => {
                        match download_file(&account, &file, file_size, cache).await {
                            Ok(data_len) => {
                                if data_len > 0 && data_len != file_size {
                                    log::warn!(
                                        "[FileDownloader] download file {} found size mismatch, expected: {}, actual: {}, will update it",
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
                                            "[FileDownloader] update file size for file {} err: {}",
                                            file,
                                            e,
                                        );
                                    }
                                }
                            }
                            Err(e) => {
                                log::error!(
                                    "[FileDownloader] download file {} to cache {:?} err: {}",
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
    account: &str,
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
                disk_exists = file_data::disk::exist(file_name).await;
            }
            if !mem_exists && (cfg.memory_cache.skip_disk_check || !disk_exists) {
                file_data::memory::download(account, file_name, Some(file_size)).await
            } else {
                Ok(0)
            }
        }
        file_data::CacheType::Disk => {
            if !file_data::disk::exist(file_name).await {
                file_data::disk::download(account, file_name, Some(file_size)).await
            } else {
                Ok(0)
            }
        }
        _ => Ok(0),
    }
}

pub async fn queue_download(
    account: String,
    file: String,
    size: i64,
    cache_type: file_data::CacheType,
) -> Result<(), anyhow::Error> {
    FILE_DOWNLOAD_CHANNEL
        .sender
        .send((account, file, size as usize, cache_type))
        .await?;
    Ok(())
}
