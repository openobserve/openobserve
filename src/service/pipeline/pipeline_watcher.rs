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
use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};

use infra::errors::Result;
use ingester::Entry;
use once_cell::sync::Lazy;
use tokio::{
    fs::remove_file,
    sync::{
        mpsc::{Receiver, Sender},
        Semaphore,
    },
};
use wal::{FilePosition, ReadFrom};

use crate::service::pipeline::{
    pipeline_exporter::PipelineExporter, pipeline_offset_manager::get_pipeline_offset_manager,
    pipeline_receiver::PipelineReceiver,
};

#[derive(Debug)]
pub enum WatcherEvent {
    NewFile(PathBuf),
    StopWatchFile(PathBuf),
    StopWatchFileAndWait(PathBuf),
    LoadFromPersistFile((PathBuf, FilePosition)),
    Shutdown,
}

pub static FILE_WATCHER_NOTIFY: Lazy<Arc<tokio::sync::RwLock<Option<Sender<WatcherEvent>>>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(None)));

pub static FILE_RECEIVER_MAP: Lazy<Arc<tokio::sync::RwLock<HashMap<PathBuf, PipelineReceiver>>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(HashMap::new())));

#[allow(clippy::type_complexity)]
pub static RECEVIER_TASK_MAP: Lazy<Arc<tokio::sync::RwLock<HashMap<PathBuf, Sender<()>>>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(HashMap::new())));

pub struct PipelineWatcher {
    signal_receiver: Receiver<WatcherEvent>,
    concurrent: usize,
}

impl PipelineWatcher {
    pub async fn init(
        signal_sender: Sender<WatcherEvent>,
        signal_receiver: Receiver<WatcherEvent>,
        concurrent: usize,
    ) -> PipelineWatcher {
        let mut notify = FILE_WATCHER_NOTIFY.write().await;
        *notify = Some(signal_sender);
        PipelineWatcher::new(signal_receiver, concurrent)
    }

    fn new(signal_receiver: Receiver<WatcherEvent>, concurrent: usize) -> Self {
        // let pipeline_destination_map = HashMap::new();
        Self {
            signal_receiver,
            concurrent,
        }
    }

    pub async fn run(&mut self, mut stop_pipeline_watcher_rx: Receiver<()>) -> Result<()> {
        tokio::spawn(PipelineWatcher::export(self.concurrent));

        let config = &config::get_config();
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
            config.pipeline.offset_flush_interval,
        ));

        {
            // init offset manager, load offset from persist file first
            let _manager = get_pipeline_offset_manager().await;
        }

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    let manager = get_pipeline_offset_manager().await;
                    if let Err(e) = manager.write().await.flush().await {
                        log::error!("Error saving offset: {:?}", e);
                    }
                }
                _ = stop_pipeline_watcher_rx.recv() => {
                    log::info!("pipeline watcher receive shutdown signal, shutting down right now");
                    break
                }
                Some(event) = self.signal_receiver.recv() => {
                    match event {
                        WatcherEvent::NewFile(path) => {
                            if PipelineWatcher::watch_file(path, ReadFrom::Beginning).await.is_err() {
                                continue;
                            }
                        }
                        WatcherEvent::LoadFromPersistFile((path, position)) => {
                            if PipelineWatcher::watch_file(path, ReadFrom::Checkpoint(position)).await.is_err() {
                                continue;
                            }
                        }
                        WatcherEvent::StopWatchFile(path) => {
                            if let Err(e) = Self::stop_watch_file(&path, true).await {
                                log::error!("stop_watch_file failed: {:?}", e);
                            }
                        }
                        WatcherEvent::StopWatchFileAndWait(path) => {
                            if let Err(e) = Self::stop_watch_file(&path, false).await {
                                log::error!("stop_watch_file failed: {:?}", e);
                            }
                        }
                        WatcherEvent::Shutdown => {
                            let manager = get_pipeline_offset_manager().await;
                            if let Err(e) = manager.write().await.flush().await {
                                log::error!("Error saving offset: {:?}", e);
                            }
                            log::info!("Received shutdown signal, stopping FileWatcher...");
                            break
                        }
                    }
                }
            }
        }

        Ok(())
    }

    async fn watch_file(path: PathBuf, read_from: ReadFrom) -> Result<()> {
        let file_receiver = match PipelineWatcher::read_file_from_position(path.clone(), read_from)
        {
            Ok(receiver) => receiver,
            Err(e) => {
                log::error!(
                    "Error watching new file for path {:?}: position: {:?}, error: {:?}",
                    path,
                    read_from,
                    e
                );
                return Err(e);
            }
        };

        {
            let position = file_receiver.get_file_position();
            log::debug!(
                "file receiver begin inject into FILE_OFFSET_MANAGER: {:?}",
                path.display()
            );
            let offset_manager = get_pipeline_offset_manager().await;
            offset_manager
                .write()
                .await
                .save(path.to_str().unwrap(), position)
                .await;
            log::debug!(
                "file receiver inserted into FILE_OFFSET_MANAGER: {:?}",
                path.display()
            );
        }

        {
            log::debug!(
                "file receiver begin inject into FILE_RECEIVER_MAP: {:?}",
                path.display()
            );
            let mut map = FILE_RECEIVER_MAP.write().await;
            map.insert(file_receiver.path.clone(), file_receiver);
            log::debug!("file receiver inserted into FILE_RECEIVER_MAP: {:?}", map);
        }

        Ok(())
    }

    fn read_file_from_position(path: PathBuf, read_from: ReadFrom) -> Result<PipelineReceiver> {
        match PipelineReceiver::new(path.clone(), read_from) {
            Ok(file_receiver) => {
                log::info!("New file receiver created for path: {:?}", path);
                Ok(file_receiver)
            }
            Err(e) => Err(e),
        }
    }

    async fn stop_watch_file(path: &PathBuf, need_remove_file: bool) -> Result<()> {
        log::info!(
            "Stop watching file for path: {:?}, need_remove_file: {}",
            path,
            need_remove_file
        );
        if need_remove_file {
            let manager = get_pipeline_offset_manager().await;
            manager.write().await.remove(path.to_str().unwrap()).await?;
            log::info!(
                "remove wal file:[{:?}] from PIPELINE_OFFSET_MANAGER successfully",
                path
            );

            if let Err(e) = remove_file(&path).await {
                log::warn!(
                    "Failed to remove processed file {:?}: {:?}. Will retry later",
                    path,
                    e
                );
                // TODO: Implement retry mechanism
            }
            log::info!("remove wal file: {:?} from disk successfully", path);
        }

        {
            let task_map = RECEVIER_TASK_MAP.read().await;
            if let Some(stop_sender) = task_map.get(path.as_path()) {
                let _ = stop_sender.send(()).await;
            }
            log::info!(
                "remove wal file:[{:?}] from RECEVIER_TASK_MAP successfully",
                path
            );
        }

        {
            let mut recevier_map = FILE_RECEIVER_MAP.write().await;
            if recevier_map.get(path.as_path()).is_some() {
                recevier_map.remove(path);
            }
            log::info!(
                "remove wal file:[{:?}] from FILE_RECEIVER_MAP successfully",
                path
            );
        }

        Ok(())
    }

    async fn export(concurrent: usize) -> Result<()> {
        // control the task running concurrently
        let semaphore = Arc::new(Semaphore::new(concurrent));
        loop {
            {
                let map = FILE_RECEIVER_MAP.read().await;
                if map.len() == 0 {
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    continue;
                }
            } // release read lock

            let permit = semaphore.clone().acquire_owned().await.unwrap();
            let mut map = FILE_RECEIVER_MAP.write().await;
            let mut keys = map.keys().take(1).cloned();
            if let Some(random_key) = keys.next() {
                let mut pr = map.remove(&random_key).unwrap();
                let path = pr.path.clone();
                let (stop_tx, stop_rx) = tokio::sync::mpsc::channel::<()>(1);
                tokio::spawn(async move {
                    if let Err(e) = PipelineWatcher::sink(&mut pr, stop_rx).await {
                        log::error!("Error sending file receiver to current_tx: {:?}", e);
                    }
                    drop(permit);
                });

                RECEVIER_TASK_MAP.write().await.insert(path, stop_tx);
            }
            drop(map);
        }
    }

    async fn sink(pr: &mut PipelineReceiver, mut stop_rx: Receiver<()>) -> Result<()> {
        let path = pr.path.clone();
        loop {
            tokio::select! {
                _ = stop_rx.recv() => {
                    log::info!("Received stop signal for file: {:?}", path);
                    break
                }
                res = Self::read_entry_and_export(pr)  => {
                    match res {
                        Ok(None) => {
                            log::debug!("No more entries to read from file: {:?}, file_position: {}", path, pr.get_file_position());
                            // read to the end of the file, but can`t sure that real-time ingest is stop write data to the file.
                            // so we need to keep the file, and wait for the next
                            // we only delete file when receiver read to the end and wal file modified time over max_file_retention_time
                            //
                            if pr.should_delete_on_file_retention() {
                                log::info!("File: {:?} reached EOF, and modified time over max_file_retention_time, will remove it", pr.path.display());
                                PipelineWatcher::stop_watch_file(&path, true).await?;
                                break
                            }
                            // let`s wait for a while
                            tokio::time::sleep(Duration::from_secs(2)).await;
                            continue
                        }
                        Ok(Some(())) => {continue} // continue read next entry
                        Err(e) => {
                            log::error!("Error reading entry from file: {:?}, error: {:?}, will stop watch this file", path, e);
                            PipelineWatcher::stop_watch_file(&path, false).await?;
                            // todo: mark this destination cannot export, and reread the wal-file next time
                            break
                        }
                    }
                }
            }
        }

        Ok(())
    }
    async fn read_entry_and_export(pr: &mut PipelineReceiver) -> Result<Option<()>> {
        let entry = pr.read_entry();
        PipelineWatcher::handle_entry(entry, pr).await
    }

    async fn handle_entry(
        entry: Result<(Option<Entry>, FilePosition)>,
        pr: &mut PipelineReceiver,
    ) -> Result<Option<()>> {
        match entry {
            Ok((Some(entry), file_position)) => {
                if pr.pipeline_exporter.is_none() {
                    let dname = pr.get_destination_name().await?;
                    let skip_tl_verify = pr
                        .get_skip_tls_verify(pr.get_org_id(), dname.as_str())
                        .await;
                    pr.pipeline_exporter = Some(PipelineExporter::init(skip_tl_verify)?);
                }

                let max_retry_time = pr.get_stream_export_max_retry_time().await;
                // if entry.data just has one record, it will be a performance issue for exporter
                if let Some(exporter) = &pr.pipeline_exporter {
                    if let Err(e) = exporter
                        .export_entry(entry, max_retry_time, file_position, pr)
                        .await
                    {
                        log::error!(
                            "Failed to send entry to exporter: {}, data from file : {}",
                            e.to_string(),
                            pr.path.display()
                        );
                        return Err(e);
                    }
                }

                Ok(Some(()))
            }
            Ok((None, _)) => Ok(None),
            Err(e) => Err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{path, sync::Arc};

    use ingester::{Entry, WAL_DIR_DEFAULT_PREFIX};
    use parquet::data_type::AsBytes;
    use serde_json::Value;
    use tokio::sync::mpsc;
    use wal::Writer;

    use crate::service::pipeline::pipeline_watcher::{
        PipelineWatcher, WatcherEvent, FILE_WATCHER_NOTIFY,
    };

    async fn init_filewatcher() {
        let (signal_sender, _) = tokio::sync::mpsc::channel(1);
        let mut notify = FILE_WATCHER_NOTIFY.write().await;
        *notify = Some(signal_sender);
    }

    #[tokio::test]
    async fn test_shutdown() {
        init_filewatcher().await;
        let concurrent = 100;
        let (s, r) = mpsc::channel(concurrent);
        let mut fw = PipelineWatcher::init(s, r, concurrent).await;
        let (stop_tx, stop_rx) = mpsc::channel(1);
        tokio::spawn(async move {
            fw.run(stop_rx).await.unwrap();
        });

        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        let notify = FILE_WATCHER_NOTIFY.write().await;
        let s = notify.clone().unwrap();
        if let Err(e) = s.send(WatcherEvent::Shutdown).await {
            println!("send error {}", e.to_string())
        }

        let _ = stop_tx.send(()).await;
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    }
    #[tokio::test]
    async fn test_file_watcher() {
        init_filewatcher().await;
        let config = &config::get_config();
        let dir = path::PathBuf::from(&config.pipeline.remote_stream_wal_dir)
            .join(WAL_DIR_DEFAULT_PREFIX);
        let mut writer =
            Writer::new(dir, "org", "stream", "1".to_string(), 1024_1024, 8 * 1024).unwrap();
        for i in 0..100 {
            let mut entry = Entry {
                stream: Arc::from("example_stream"),
                schema: None, // empty Schema
                schema_key: Arc::from("example_schema_key"),
                partition_key: Arc::from("2023/12/18/00/country=US/state=CA"),
                data: vec![Arc::new(Value::String(format!("example_data_{i}")))],
                data_size: 1,
            };
            let bytes_entries = entry.into_bytes().unwrap();
            writer.write(bytes_entries.as_bytes()).unwrap();
        }
        writer.close().unwrap();

        let concurrent = 100;
        let (s, r) = mpsc::channel(concurrent);
        let mut fw = PipelineWatcher::init(s, r, concurrent).await;
        let sender = FILE_WATCHER_NOTIFY.write().await;
        let s = sender.clone().unwrap();
        s.send(WatcherEvent::NewFile(writer.path().clone()))
            .await
            .unwrap();

        let (stop_tx, stop_rx) = mpsc::channel(1);
        tokio::spawn(async move {
            fw.run(stop_rx).await.unwrap();
        });

        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        let _ = s.send(WatcherEvent::Shutdown).await;
        let _ = stop_tx.send(()).await;
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    }
}
