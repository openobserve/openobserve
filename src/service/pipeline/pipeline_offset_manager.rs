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
    fs,
    fs::remove_file,
    io,
    path::{Path, PathBuf},
    sync::Arc,
};

use async_walkdir::WalkDir;
use futures_util::StreamExt;
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

pub async fn get_pipeline_offset_manager() -> &'static Arc<RwLock<PipelineOffsetManager>> {
    PIPELINE_OFFSET_MANAGER
        .get_or_init(init_pipeline_offset_manager)
        .await
}

#[derive(Debug)]
pub struct PipelineOffsetManager {
    offset_persist_file: PathBuf,
    offset_persist_tmp_file: PathBuf,
    offset_data: RwLock<OffsetData>,
}

impl Default for PipelineOffsetManager {
    fn default() -> Self {
        Self::new()
    }
}

impl PipelineOffsetManager {
    pub fn new() -> Self {
        let config = config::get_config();
        let dir = PathBuf::from(config.pipeline.remote_stream_wal_dir.as_str());
        if !dir.exists() {
            // Create the directory and any necessary parent directories
            fs::create_dir_all(&dir).unwrap();
        }

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
            Ok(mut offset_data) => {
                let mut new_offset_data = OffsetData::new();

                // scan the wal dir to find the wal file that not in the offset json, just a
                // fallback policy if the offset json is lost, we can still recover
                // the offset data from the wal file, but it will cause dup data and
                // we should check the wal file is expired or not
                let _ = p
                    .recover_wal_file_not_in_offset_json(&mut offset_data)
                    .await;

                // notify watcher begin to work
                let watcher = FILE_WATCHER_NOTIFY.write().await;
                for (stream_file, position) in &offset_data {
                    // check the setream file is exist
                    if !Path::new(stream_file).exists()
                        || Self::wal_file_check(stream_file).is_err()
                    {
                        log::warn!(
                            "stream wal file: {:?} not exist, or file path is wrong, remove offset data",
                            stream_file
                        );
                        p.remove(stream_file).await?;
                        continue;
                    }

                    let _ = watcher
                        .clone()
                        .unwrap()
                        .send(WatcherEvent::LoadFromPersistFile((
                            PathBuf::from(stream_file),
                            *position,
                        )))
                        .await;
                    new_offset_data.insert(stream_file.clone(), *position);
                    log::info!("pipeline offset-manager notify offset-watcher to load file: {:?}, position: {:?}", stream_file, position);
                }
                drop(watcher);

                p.offset_data = RwLock::new(new_offset_data);
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
            Err(Error::SerdeJsonError(e)) => {
                log::error!(
                    "Unable to read json file {}, error: {}. move it to back file and create a new one",
                    self.offset_persist_file.display(),
                    e
                );
                fs::rename(
                    &self.offset_persist_file,
                    PathBuf::from(format!("{}.bak", &self.offset_persist_file.display())),
                )?;
                Ok(HashMap::new())
            }
            Err(error) => {
                log::error!(
                    "Unable to read file {}, error: {}.",
                    self.offset_persist_file.display(),
                    error
                );
                Err(error)
            }
        }
    }

    pub async fn get_all_remote_wal_file() -> Vec<PathBuf> {
        let cfg = config::get_config();
        let wal_dir = Path::new(cfg.pipeline.remote_stream_wal_dir.as_str());
        Self::iter_dir_wal_file(wal_dir).await
    }

    pub async fn get_all_remote_tmp_wal_file() -> Vec<PathBuf> {
        let cfg = config::get_config();
        let remote_stream_tmp_wal_dir = &cfg.pipeline.remote_stream_wal_dir.replace(
            crate::service::pipeline::pipeline_wal_writer::REMOTE_REALTIME_STREAM_WAL_DIR,
            crate::service::pipeline::pipeline_wal_writer::REMOTE_QUERY_STREAM_TMP_WAL_DIR,
        );
        let wal_dir = Path::new(remote_stream_tmp_wal_dir.as_str());
        Self::iter_dir_wal_file(wal_dir).await
    }

    async fn iter_dir_wal_file(wal_dir: &Path) -> Vec<PathBuf> {
        WalkDir::new(wal_dir)
            .filter_map(|entry| async {
                match entry {
                    Ok(entry) => {
                        let path = entry.path();
                        let path_ext = path
                            .extension()
                            .and_then(|s| s.to_str())
                            .unwrap_or_default();

                        if path.is_file() && path_ext == "wal" {
                            Some(path.to_path_buf())
                        } else {
                            None
                        }
                    }
                    Err(_) => None,
                }
            })
            .collect::<Vec<PathBuf>>()
            .await
    }
    async fn recover_wal_file_not_in_offset_json(
        &self,
        offset_data: &mut OffsetData,
    ) -> Result<()> {
        let wal_file_iter = Self::get_all_remote_wal_file().await;

        for wal_file in wal_file_iter.iter() {
            let wal_file_str = wal_file.to_str().unwrap();
            if !offset_data.contains_key(wal_file_str) {
                log::warn!(
                    "wal file: {:?} not in offset json, recover it from beginning",
                    wal_file_str
                );
                offset_data.insert(wal_file_str.to_string(), 0);
            }
        }

        Ok(())
    }

    fn read_persist_file(&self, path: &Path) -> Result<OffsetData> {
        let reader = io::BufReader::new(fs::File::open(path)?);
        serde_json::from_reader(reader).map_err(Error::SerdeJsonError)
    }

    fn wal_file_check(stream_file: &str) -> Result<bool> {
        let stream_file_path = PathBuf::from(stream_file);
        let wal_dir = PathBuf::from(&config::get_config().pipeline.remote_stream_wal_dir)
            .join(ingester::WAL_DIR_DEFAULT_PREFIX);

        let res = stream_file_path
            .strip_prefix(&wal_dir)
            .map_err(|_| {
                Error::Message(format!(
                    "Path does not start with wal_dir: {}, path: {}",
                    wal_dir.display(),
                    stream_file_path.display(),
                ))
            })?
            .to_str()
            .ok_or_else(|| {
                Error::Message(format!(
                    "Invalid UTF-8 in path: {}",
                    stream_file_path.display()
                ))
            })
            .map(|s| s.replace('\\', "/"));

        match res {
            Ok(path) => {
                let file_columns = path.split('/').collect::<Vec<_>>().len();
                if file_columns < 3 {
                    log::warn!("stream file: {:?} dir is not correct", stream_file);
                    return Err(Error::Message(format!(
                        "stream file: {:?} dir is not correct",
                        stream_file
                    )));
                }

                Ok(true)
            }
            Err(e) => {
                log::warn!(
                    "stream file: {:?} dir is not correct, err: {e}",
                    stream_file
                );
                Err(Error::Message(format!(
                    "stream file: {:?} dir is not correct",
                    stream_file
                )))
            }
        }
    }

    pub async fn save(&mut self, stream_file: &str, position: FilePosition) {
        let mut data = self.offset_data.write().await;
        data.entry(stream_file.to_string())
            .and_modify(|pos| {
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
        log::debug!(
            "Flushing pipeline offset data: {:?}, offset_persist_tmp_file: {}",
            data,
            self.offset_persist_tmp_file.display()
        );
        // Write the new offset to a tmp file and flush it fully to
        // disk. If o2 dies anywhere during this section, the existing
        // stable file will still be in its current valid state and we'll be
        // able to recover.
        let mut f = io::BufWriter::new(fs::File::create(&self.offset_persist_tmp_file)?);

        serde_json::to_writer(&mut f, &*data)?;
        log::debug!("pipeline offset manager flush sync begin");
        f.into_inner()
            .map_err(|e| Error::Message(e.to_string()))?
            .sync_all()?;

        // Once the temp file is fully flushed, rename the tmp file to replace
        // the previous stable file. This is an atomic operation on POSIX
        // systems (and the stdlib claims to provide equivalent behavior on
        // Windows), which should prevent scenarios where we don't have at least
        // one full valid file to recover from.
        log::debug!("pipeline offset manager rename tmp offset file");
        fs::rename(&self.offset_persist_tmp_file, &self.offset_persist_file)?;
        log::debug!("Offset file saved: {:?}", self.offset_persist_file);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::service::pipeline::{
        pipeline_offset_manager::PipelineOffsetManager, pipeline_watcher::FILE_WATCHER_NOTIFY,
    };

    async fn init_filewatcher() {
        let (signal_sender, _) = tokio::sync::mpsc::channel(1);
        let mut notify = FILE_WATCHER_NOTIFY.write().await;
        *notify = Some(signal_sender);
    }
    #[tokio::test]
    async fn test_load() {
        init_filewatcher().await;
        let pm = PipelineOffsetManager::init().await.unwrap();
        pm.load().unwrap();
    }

    #[tokio::test]
    async fn test_save() {
        init_filewatcher().await;
        let mut pm = PipelineOffsetManager::init().await.unwrap();
        let path = "path-to-remote-wal-file-test";
        pm.save(path, 100).await;
        assert_eq!(pm.get(path).await.unwrap(), 100);
    }
}
