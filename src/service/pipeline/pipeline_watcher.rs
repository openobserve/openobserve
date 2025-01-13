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
use std::{collections::HashMap, path::PathBuf, sync::Arc};

use infra::errors::{Error, Result};
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
    pipeline_entry::{PipelineEntry, PipelineEntryBuilder},
    pipeline_offset_manager::PIPELINE_OFFSET_MANAGER,
    pipeline_receiver::PipelineReceiver,
};

#[derive(Debug)]
pub enum WatcherEvent {
    NewFile(PathBuf),
    StopWatchFile(PathBuf),
    LoadFromPersistFile((PathBuf, FilePosition)),
    Shutdown,
}

pub static FILE_WATCHER_NOTIFY: Lazy<Arc<tokio::sync::RwLock<Option<Sender<WatcherEvent>>>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(None)));

pub static FILE_RECEIVER_MAP: Lazy<Arc<tokio::sync::RwLock<HashMap<PathBuf, PipelineReceiver>>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(HashMap::new())));

pub static RECEVIER_TASK_MAP: Lazy<Arc<tokio::sync::RwLock<HashMap<PathBuf, Sender<()>>>>> =
    Lazy::new(|| Arc::new(tokio::sync::RwLock::new(HashMap::new())));

pub(crate) struct PipelineWatcher {
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
        Self {
            signal_receiver,
            concurrent,
        }
    }

    pub async fn run(&mut self, pipeline_exporter_sender: Sender<PipelineEntry>, mut stop_pipeline_watcher_rx: Receiver<()>) -> Result<()> {
        tokio::spawn(PipelineWatcher::export(
            self.concurrent,
            pipeline_exporter_sender,
        ));

        let config = &config::get_config();
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
            config.pipeline.offset_flush_interval,
        ));

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    if let Err(e) = PIPELINE_OFFSET_MANAGER.write().await.flush().await {
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
                            if let Err(_) = PipelineWatcher::watch_file(path, ReadFrom::Beginning).await {
                                continue;
                            }
                        }
                        WatcherEvent::LoadFromPersistFile((path, position)) => {
                            if let Err(_) = PipelineWatcher::watch_file(path, ReadFrom::Checkpoint(position)).await {
                                continue;
                            }
                        }
                        WatcherEvent::StopWatchFile(path) => {
                            let _ = self.stop_watch_file(path);
                        }
                        WatcherEvent::Shutdown => {
                            if let Err(e) = PIPELINE_OFFSET_MANAGER.write().await.flush().await {
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
                log::error!("Error watching new file for path {:?}: {:?}", path, e);
                return Err(e);
            }
        };

        log::info!("file receiver created for path: {:?}", path);
        let mut map = FILE_RECEIVER_MAP.write().await;
        map.insert(file_receiver.path.clone(), file_receiver);

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

    async fn stop_watch_file(&self, path: PathBuf) -> Result<()> {
        log::info!("Stop watching file for path: {:?}", path);

        {
            let task_map = RECEVIER_TASK_MAP.read().await;
            if let Some(stop_sender) = task_map.get(path.as_path()) {
                let _ = stop_sender.send(());
            }
        }

        {
            let mut recevier_map = FILE_RECEIVER_MAP.write().await;
            if let Some(_) = recevier_map.get(path.as_path()) {
                recevier_map.remove(&path);
            }
        }

        Ok(())
    }

    async fn export(
        concurrent: usize,
        pipeline_exporter_sender: Sender<PipelineEntry>,
    ) -> Result<()> {
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
            let pipeline_exporter_sender = pipeline_exporter_sender.clone();
            let mut map = FILE_RECEIVER_MAP.write().await;
            let mut keys = map.keys().take(1).cloned();
            if let Some(random_key) = keys.next() {
                let mut pr = map.remove(&random_key).unwrap();
                let path = pr.path.clone();
                let (stop_tx, stop_rx) = tokio::sync::mpsc::channel::<()>(1);
                tokio::spawn(async move {
                    if let Err(e) =
                        PipelineWatcher::sink(&mut pr, pipeline_exporter_sender, stop_rx).await
                    {
                        log::error!("Error sending file receiver to current_tx: {:?}", e);
                    }
                    drop(permit);
                });

                RECEVIER_TASK_MAP.write().await.insert(path, stop_tx);
            }
            drop(map);
        }
    }

    async fn sink(
        pr: &mut PipelineReceiver,
        pipeline_exporter_sender: Sender<PipelineEntry>,
        mut stop_rx: Receiver<()>,
    ) -> Result<()> {
        let path = pr.path.clone();
        loop {
            tokio::select! {
                _ = stop_rx.recv() => {
                    log::info!("Received stop signal for file: {:?}", path);
                    break
                }
                entry = async { pr.read_entry() }  => {
                    let res = PipelineWatcher::handle_entry(entry, pr.org_id.clone(), pr.stream_type.clone(), pr.path.clone(), pipeline_exporter_sender.clone()).await?;
                    match res {
                        None => {
                            log::info!("No more entries to read from file: {:?}", path);
                            let notify = FILE_WATCHER_NOTIFY.write().await.clone().unwrap();
                            notify.send(WatcherEvent::StopWatchFile(path.clone())).await.map_err(|e| Error::Message(e.to_string()))?;
                            break
                        } // read to the end
                        Some(()) => {continue} // continue read next entry
                    }
                }
            }
        }

        // File processing complete, attempt cleanup
        log::info!("Finished processing file, attempting cleanup");
        if let Err(e) = remove_file(&path).await {
            log::warn!(
                "Failed to remove processed file {:?}: {:?}. Will retry later",
                path,
                e
            );
            // TODO: Implement retry mechanism
        }

        Ok(())
    }

    async fn handle_entry(
        entry: Result<(Option<Entry>, FilePosition)>,
        stream_org_id: String,
        stream_type: String,
        stream_path: PathBuf,
        pipeline_exporter_sender: Sender<PipelineEntry>,
    ) -> Result<Option<()>> {
        match entry {
            Ok((Some(entry), file_position)) => {
                log::debug!(
                    "Read entry from file, stream: {}, stream_key: {}, stream_data: {:?}, stream_path: {}",
                    entry.stream,
                    entry.schema_key,
                    entry.data,
                    stream_path.display(),
                );

                let data = PipelineEntryBuilder::new()
                    .stream_path(stream_path)
                    .stream_endpoint("http://example.com/stream".to_string())
                    .stream_org_id(stream_org_id)
                    .stream_type(stream_type)
                    .set_entry_position_of_file(file_position)
                    .entry(entry)
                    .build();

                if let Err(e) = pipeline_exporter_sender.send(data).await {
                    log::error!("Failed to send entry to exporter: {:?}", e);
                }

                Ok(Some(()))
            }
            Ok((None, _)) => {
                log::info!("No more entries to read from file");
                Ok(None)
            }
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
    #[tokio::test]
    async fn test_shutdown() {
        let concurrent = 100;
        let (s, r) = mpsc::channel(concurrent);
        let mut fw = PipelineWatcher::init(s, r, concurrent).await;
        let (exporter_tx, _) = mpsc::channel(1024);
        let (stop_tx, stop_rx) = mpsc::channel(1);
        tokio::spawn(async move {
            fw.run(exporter_tx, stop_rx).await.unwrap();
        });

        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        let notify = FILE_WATCHER_NOTIFY.write().await;
        let s = notify.clone().unwrap();
        s.send(WatcherEvent::Shutdown).await.unwrap();
        let _ = stop_tx.send(()).await;
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    }
    #[tokio::test]
    async fn test_file_watcher() {
        let config = &config::get_config();
        let dir = path::PathBuf::from(&config.pipeline.remote_stream_wal_dir)
            .join(WAL_DIR_DEFAULT_PREFIX);
        let mut writer = Writer::new(dir, "org", "stream", 1, 1024_1024, 8 * 1024).unwrap();
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

        let (exporter_tx, _) = mpsc::channel(1024);
        let (stop_tx, stop_rx) = mpsc::channel(1);
        tokio::spawn(async move {
            fw.run(exporter_tx, stop_rx).await.unwrap();
        });

        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        let _ = s.send(WatcherEvent::Shutdown).await;
        let _ = stop_tx.send(()).await;
        tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    }
}
