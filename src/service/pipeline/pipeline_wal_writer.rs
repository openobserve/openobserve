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
    fs::Metadata,
    path,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};

use chrono::Utc;
use config::{get_config, meta::stream::RemoteStreamParams, utils::json};
use infra::errors::{Error, Result};
use ingester::{errors::WalSnafu, Entry, WAL_DIR_DEFAULT_PREFIX};
use once_cell::sync::Lazy;
use parquet::data_type::AsBytes;
use snafu::ResultExt;
use tokio::sync::RwLock;

use crate::service::pipeline::pipeline_watcher::{WatcherEvent, FILE_WATCHER_NOTIFY};

// each pipeline has a wal writer, but it still has a write performance issue when the data is ingested concurrently
#[allow(clippy::type_complexity)]
static PIPELINE_WAL_WRITER_MAP: Lazy<Arc<RwLock<HashMap<String, Arc<PipelineWalWriter>>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

pub async fn get_pipeline_wal_writer(
    pipeline_id: String,
    remote_stream_params: RemoteStreamParams,
) -> Result<Arc<PipelineWalWriter>> {
    let mut map = PIPELINE_WAL_WRITER_MAP.write().await;
    if let Some(writer) = map.get(&pipeline_id) {
        Ok(writer.clone())
    } else {
        let writer = PipelineWalWriter::new(pipeline_id.clone(), remote_stream_params)?;

        let writer = Arc::new(writer);
        map.insert(pipeline_id, writer.clone());
        // notify the pipeline_file_watcher begin to read entry.
        let wal_writer = writer.wal_writer.write().await;
        let path = wal_writer.path();
        notify_file_watcher(path.clone()).await;
        drop(wal_writer);

        Ok(writer)
    }
}

async fn notify_file_watcher(path: PathBuf) {
    let watcher = FILE_WATCHER_NOTIFY.write().await;
    if let Some(watcher) = watcher.clone() {
        if let Err(e) = watcher.send(WatcherEvent::NewFile(path.clone())).await {
            log::error!("pipeline_wal_writer notify_file_watcher error: {}", e);
        }
    }
}

pub fn get_metadata_motified(metadata: &Metadata) -> Instant {
    metadata
        .modified()
        .ok()
        .and_then(|mtime| mtime.elapsed().ok())
        .and_then(|diff| Instant::now().checked_sub(diff))
        .unwrap_or_else(Instant::now)
}

pub async fn check_ttl() -> ingester::errors::Result<()> {
    let map = PIPELINE_WAL_WRITER_MAP.read().await;
    for (_, w) in map.iter() {
        let metadata = w.wal_writer.read().await.metadata().unwrap();
        let ts = get_metadata_motified(&metadata);
        log::debug!(
            "pipeline_wal_writer exec check_ttl, motified elapsed: {:?}",
            ts.elapsed().as_millis()
        );
        let _ = w.rotate(0).await;
    }

    Ok(())
}

pub struct PipelineWalWriter {
    pub pipeline_id: String,
    pub remote_stream_params: RemoteStreamParams,
    pub wal_writer: Arc<RwLock<wal::Writer>>,
    next_seq: AtomicU64,
}

impl PipelineWalWriter {
    pub fn new(pipeline_id: String, remote_stream_params: RemoteStreamParams) -> Result<Self> {
        let cfg = &get_config();
        let wal_file_dir =
            path::PathBuf::from(&cfg.pipeline.remote_stream_wal_dir).join(WAL_DIR_DEFAULT_PREFIX);
        let now = Utc::now().timestamp_micros();
        let next_seq = AtomicU64::new(now as u64);
        let wal_id = next_seq.fetch_add(1, Ordering::SeqCst).to_string();
        let writer = Self::wal_writer_build(
            pipeline_id.to_string(),
            wal_file_dir,
            remote_stream_params.clone(),
            wal_id,
            cfg.limit.wal_write_buffer_size,
        )?;
        let wal_writer = Arc::new(RwLock::new(writer));

        Ok(Self {
            pipeline_id,
            remote_stream_params,
            wal_writer,
            next_seq,
        })
    }

    pub fn wal_writer_build(
        pipeline_id: String,
        wal_file_dir: PathBuf,
        remote_stream_params: RemoteStreamParams,
        wal_id: String,
        wal_write_buffer_size: usize,
    ) -> Result<wal::Writer> {
        // query org_id stream_name stream_type from destination_name
        let mut header = wal::FileHeader::new();
        header.insert("pipeline_id".to_string(), pipeline_id);
        header.insert(
            "org_id".to_string(),
            remote_stream_params.org_id.to_string(),
        );
        header.insert(
            "stream_name".to_string(),
            remote_stream_params.stream_name.to_string(),
        );
        header.insert(
            "stream_type".to_string(),
            remote_stream_params.stream_type.to_string(),
        );
        header.insert(
            "destination_name".to_string(),
            remote_stream_params.destination_name.to_string(),
        );

        wal::Writer::build(
            wal_file_dir,
            remote_stream_params.org_id.as_str(),
            remote_stream_params.stream_type.as_str(),
            wal_id,
            0, /* warn: it must be zero, because reader will read init_size with buf, result
                * reader can not read the latest real-time data */
            wal_write_buffer_size,
            Some(header),
        )
        .map_err(|e| Error::WalFileError(e.to_string()))
    }
    pub async fn write_wal(&self, data: Vec<json::Value>) -> Result<()> {
        // write data to wal
        if data.is_empty() {
            return Err(Error::Message("No data to write to WAL".to_string()));
        }

        let mut entry = Entry {
            stream: Arc::from(self.remote_stream_params.stream_name.as_str()),
            schema: None, // empty Schema
            schema_key: Arc::from(self.remote_stream_params.stream_type.as_str()),
            partition_key: Arc::from(""),
            data: data.iter().map(|d| Arc::new(d.clone())).collect(),
            data_size: data.len(),
        };
        let bytes_entries = entry
            .into_bytes()
            .map_err(|e| Error::Message(format!("write_wal entry into bytes error : {}", e)))?;

        // check rotation
        if let Err(err) = self.rotate(bytes_entries.len()).await {
            log::error!("rotate error : {err}");
            return Err(err);
        }

        let mut writer = self.wal_writer.write().await;
        writer
            .write(bytes_entries.as_bytes())
            .map_err(|e| Error::WalFileError(e.to_string()))?;
        let res = writer
            .sync()
            .map_err(|e| Error::WalFileError(e.to_string()));

        log::debug!(
            "Writing WAL for pipeline: {}, wal_file_path: {}, wal_file_postion:{:?}, data: {:?}",
            self.pipeline_id,
            writer.path().clone().display(),
            writer.current_position(),
            data
        );

        res
    }

    fn check_wal_threshold(
        &self,
        written_size: (usize, usize),
        data_size: usize,
        modified: Instant,
    ) -> bool {
        let cfg = get_config();
        let (compressed_size, _uncompressed_size) = written_size;
        log::debug!(
                "PipelineWalWriter check_wal_threshold file modified elapsed: {}, cfg.limit.max_file_retention_time: {}, compressed_size: {compressed_size}, data_size: {data_size}",
                modified.elapsed().as_secs(),
                cfg.limit.max_file_retention_time
            );
        // 1. compressed_size + data_size > cfg.limit.max_file_size_on_disk
        // 2. wal-file modified of metadata is bigger than cfg.limit.max_file_retention_time
        compressed_size + data_size > cfg.limit.max_file_size_on_disk
            || modified.elapsed().as_secs() > cfg.limit.max_file_retention_time
    }

    async fn rotate(&self, entry_bytes_size: usize) -> Result<()> {
        let wal_writer = self.wal_writer.read().await;
        let metadata = wal_writer.metadata()?;
        let ts = get_metadata_motified(&metadata);

        if !self.check_wal_threshold(wal_writer.size(), entry_bytes_size, ts) {
            return Ok(());
        }
        drop(wal_writer);

        // rotation wal
        let cfg = get_config();
        let wal_dir =
            path::PathBuf::from(&cfg.pipeline.remote_stream_wal_dir).join(WAL_DIR_DEFAULT_PREFIX);
        let wal_id = self.next_seq.fetch_add(1, Ordering::SeqCst);
        log::info!(
            "[PIPELINE:WAL] create file: {}/{}/{}/{}.wal",
            wal_dir.display().to_string(),
            &self.remote_stream_params.org_id,
            &self.remote_stream_params.stream_type,
            wal_id
        );

        let new_wal_writer = Self::wal_writer_build(
            self.pipeline_id.clone(),
            wal_dir,
            self.remote_stream_params.clone(),
            wal_id.to_string(),
            cfg.limit.wal_write_buffer_size,
        )?;

        let path = new_wal_writer.path().clone();
        let mut wal = self.wal_writer.write().await;
        wal.sync()
            .context(WalSnafu)
            .map_err(|e| Error::WalFileError(e.to_string()))?; // sync wal before rotation
        let _old_wal = std::mem::replace(&mut *wal, new_wal_writer);
        drop(wal);

        // notify the pipeline_file_watcher begin to read entry.
        notify_file_watcher(path.clone()).await;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{env, fs::remove_file, sync::Arc, time::Duration};

    use config::meta::stream::RemoteStreamParams;
    use serde_json::json;
    use tokio::time::sleep;
    use wal::ReadFrom;

    use crate::service::pipeline::{
        pipeline_receiver::PipelineReceiver, pipeline_wal_writer::get_pipeline_wal_writer,
    };

    #[tokio::test]
    async fn test_write_wal() {
        let pipeline_id = "test_pipeline".to_string();
        let remote_stream_params = RemoteStreamParams {
            org_id: "defualt".into(),
            stream_name: "default".into(),
            stream_type: "logs".into(),
            destination_name: "100".into(),
        };

        let data = vec![json!({"key": "value1"}), json!({"key": "value2"})];
        let data_len = data.len();
        let writer = get_pipeline_wal_writer(pipeline_id.clone(), remote_stream_params.clone())
            .await
            .unwrap();

        let result = writer.write_wal(data).await;
        assert!(result.is_ok(), "Expected write_wal to succeed");
        let writer = writer.wal_writer.write().await;
        let path = writer.path();
        let mut fw = PipelineReceiver::new(path.clone(), ReadFrom::Beginning).unwrap();
        while let Ok((Some(entry), _)) = fw.read_entry() {
            assert_eq!(
                entry.stream,
                Arc::from(remote_stream_params.clone().stream_name.as_str())
            );
            assert_eq!(entry.data.len(), data_len);
        }

        remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn test_retention_time_rotate() {
        env::set_var("ZO_MAX_FILE_RETENTION_TIME", "1");
        let pipeline_id = "test_pipeline".to_string();
        let remote_stream_params = RemoteStreamParams {
            org_id: "defualt".into(),
            stream_name: "default".into(),
            stream_type: "logs".into(),
            destination_name: "100".into(),
        };

        let data = vec![json!({"key": "value1"}), json!({"key": "value2"})];
        let writer = get_pipeline_wal_writer(pipeline_id.clone(), remote_stream_params.clone())
            .await
            .unwrap();
        let wal_writer = writer.wal_writer.read().await;
        let path = wal_writer.path().clone();
        drop(wal_writer);
        let wal_file_1 = path.to_str().unwrap().to_string();

        let _ = writer.write_wal(data.clone()).await;

        let wal_writer = writer.wal_writer.read().await;
        let path = wal_writer.path().clone();
        drop(wal_writer);
        let wal_file_2 = path.to_str().unwrap().to_string();
        assert_eq!(wal_file_1, wal_file_2);

        sleep(Duration::from_secs(2)).await;

        let _ = writer.write_wal(data).await;

        let wal_writer = writer.wal_writer.read().await;
        let path = wal_writer.path().clone();
        drop(wal_writer);
        let wal_file_3 = path.to_str().unwrap().to_string();
        assert_ne!(wal_file_2, wal_file_3);
    }
}
