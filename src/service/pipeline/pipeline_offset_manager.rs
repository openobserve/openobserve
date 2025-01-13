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

use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::Arc,
};
use std::fs::remove_file;
use infra::errors::{Error, Result};
use tokio::sync::{OnceCell, RwLock};
use wal::FilePosition;

use crate::service::pipeline::pipeline_watcher::{WatcherEvent, FILE_WATCHER_NOTIFY};

type OffsetData = HashMap<String, FilePosition>;

const OFFSET_PERSIST_FILE_NAME: &str = "offset.json";
const OFFSET_PERSIST_TMP_FILE_NAME: &str = "offset.json.tmp";

pub(crate) static PIPELINE_OFFSET_MANAGER: OnceCell<Arc<RwLock<PipelineOffsetManager>>> =
    OnceCell::const_new();

pub async fn init_pipeline_offset_manager() -> Arc<RwLock<PipelineOffsetManager>> {
    Arc::new(RwLock::new(PipelineOffsetManager::init().await.unwrap()))
}
#[derive(Debug)]
pub(crate) struct PipelineOffsetManager {
    offset_persist_file: PathBuf,
    offset_persist_tmp_file: PathBuf,
    offset_data: RwLock<OffsetData>,
}

impl PipelineOffsetManager {
    pub fn new() -> Self {
        let config = config::get_config();
        let dir = PathBuf::from(config.pipeline.remote_stream_wal_dir.as_str());
        let offset_persist_file = dir.join(OFFSET_PERSIST_FILE_NAME);
        let offset_persist_tmp_file = dir.join(OFFSET_PERSIST_TMP_FILE_NAME);
        let offset_data = RwLock::new(HashMap::new());

        let manager = Self {
            offset_persist_file,
            offset_persist_tmp_file,
            offset_data,
        };
        log::debug!("new PipelineOffsetManager: {:?}", manager);
        manager
    }

    pub async fn init() -> Result<Self> {
        let mut p = PipelineOffsetManager::new();
        match p.load() {
            Ok(offset_data) => {
                // notify watcher begin to work
                let watcher = FILE_WATCHER_NOTIFY.write().await;
                for (stream_file, position) in &offset_data {
                    let _ = watcher
                        .clone()
                        .unwrap()
                        .send(WatcherEvent::LoadFromPersistFile((
                            PathBuf::from(stream_file),
                            *position,
                        )))
                        .await;
                    log::info!("pipeline offset-manager notify offset-watcher to load file: {:?}, position: {:?}", stream_file, position);
                }
                drop(watcher);
                p.offset_data = RwLock::new(offset_data);
                Ok(p)
            }
            Err(e) => Err(e),
        }
    }

    fn load(&self) -> Result<OffsetData> {
        // First try reading from the tmp file location. If this works, it means
        // that the previous process was interrupted in the process of
        // flushing and the tmp file should contain more recent data that
        // should be preferred.
        match self.read_persist_file(&self.offset_persist_tmp_file) {
            Ok(offset_data) => {
                log::warn!("Recovered pipeline offset data from interrupted process.");
                // Try to move this tmp file to the stable location so we don't
                // immediately overwrite it when we next persist flushing.
                if let Err(error) =
                    fs::rename(&self.offset_persist_tmp_file, &self.offset_persist_file)
                {
                    log::warn!(
                        "Error persisting recovered checkpoint file. error: {}",
                        error
                    );
                }
                return Ok(offset_data);
            }
            Err(Error::IoError(e)) if e.kind() == io::ErrorKind::NotFound => {
                // This is expected, so no warning needed
            }
            Err(error) => {
                log::error!(
                    "Unable to recover pipeline offset data from interrupted process, error: {}. remove tmp offset data",
                    error
                );
                remove_file(&self.offset_persist_tmp_file).unwrap();
            }
        }

        // Next, attempt to read checkpoints from the stable file location. This
        // is the expected location, so warn more aggressively if something goes
        // wrong.
        match self.read_persist_file(&self.offset_persist_file) {
            Ok(offset_data) => {
                log::info!("Loaded pipeline offset data.");
                Ok(offset_data)
            }
            Err(Error::IoError(e)) if e.kind() == io::ErrorKind::NotFound => {
                // No normal pipeline offset file, This is expected, so no warning needed
                Ok(HashMap::new())
            }
            Err(error) => {
                log::error!(
                    "Unable to recover pipeline offset data from interrupted process, error: {}.",
                    error
                );
                Err(error)
            }
        }
    }

    fn read_persist_file(&self, path: &Path) -> Result<OffsetData> {
        let reader = io::BufReader::new(fs::File::open(path)?);
        serde_json::from_reader(reader).map_err(|e| Error::SerdeJsonError(e))
    }

    pub async fn save(&mut self, stream_file: &str, position: FilePosition) {
        let mut data = self.offset_data.write().await;
        data.entry(stream_file.to_string())
            .and_modify(|pos| {
                // update the position if the new position is greater than the old one
                // save function will be executed concurrently, so we need to check the position
                // todo: how to confirm the file eof?
                if position > *pos {
                    *pos = position
                }
            })
            .or_insert(position);
    }
    #[allow(dead_code)]
    pub async fn get(&self, stream_file: &str) -> Option<FilePosition> {
        let data = self.offset_data.read().await;
        data.get(stream_file).cloned()
    }

    pub async fn remove(&mut self, stream_file: &str) -> Result<()> {
        let mut data = self.offset_data.write().await;
        data.remove(stream_file);
        Ok(())
    }

    pub async fn flush(&self) -> Result<()> {
        // drop util rename tmp file to stable file
        let data = self.offset_data.write().await;

        // Write the new offset to a tmp file and flush it fully to
        // disk. If o2 dies anywhere during this section, the existing
        // stable file will still be in its current valid state and we'll be
        // able to recover.
        let mut f = io::BufWriter::new(fs::File::create(&self.offset_persist_tmp_file)?);

        serde_json::to_writer(&mut f, &*data)?;
        f.into_inner()
            .map_err(|e| Error::Message(e.to_string()))?
            .sync_all()?;

        // Once the temp file is fully flushed, rename the tmp file to replace
        // the previous stable file. This is an atomic operation on POSIX
        // systems (and the stdlib claims to provide equivalent behavior on
        // Windows), which should prevent scenarios where we don't have at least
        // one full valid file to recover from.
        fs::rename(&self.offset_persist_tmp_file, &self.offset_persist_file)?;
        log::debug!("Offset file saved: {:?}", self.offset_persist_file);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::service::pipeline::pipeline_offset_manager::PipelineOffsetManager;

    #[tokio::test]
    async fn test_load() {
        let pm = PipelineOffsetManager::init().await.unwrap();
        pm.load().unwrap();
    }

    #[tokio::test]
    async fn test_save() {
        let mut pm = PipelineOffsetManager::init().await.unwrap();
        let path = "path-to-remote-wal-file-test";
        pm.save(path, 100).await;
        assert_eq!(pm.get(path).await.unwrap(), 100);
    }

    #[tokio::test]
    async fn test_flush() {
        let mut pm = PipelineOffsetManager::init().await.unwrap();
        let path = "path-to-remote-wal-file-test";
        pm.save(path, 100).await;
        pm.flush().await.unwrap();
        let pm = PipelineOffsetManager::init().await.unwrap();
        assert_eq!(pm.get(path).await.unwrap(), 100);
    }
}
