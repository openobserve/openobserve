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
    fs::Metadata,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Instant,
};

use chrono::Utc;
use config::{
    get_config,
    meta::{pipeline::components::PipelineSource, stream::RemoteStreamParams},
    utils::json,
    Config,
};
use infra::errors::{Error, Result};
use ingester::{errors::WalSnafu, Entry, WAL_DIR_DEFAULT_PREFIX};
use once_cell::sync::Lazy;
use parquet::data_type::AsBytes;
use snafu::ResultExt;
use tokio::sync::RwLock;

use crate::service::{
    db,
    pipeline::pipeline_watcher::{WatcherEvent, FILE_WATCHER_NOTIFY},
};

pub(crate) const REMOTE_REALTIME_STREAM_WAL_DIR: &str = "remote_stream_wal";
pub(crate) const REMOTE_QUERY_STREAM_TMP_WAL_DIR: &str = "remote_stream_wal_tmp";

// each pipeline has a wal writer, but it still has a write performance issue when the data is
// ingested concurrently
#[allow(clippy::type_complexity)]
static PIPELINE_WAL_WRITER_MAP: Lazy<Arc<RwLock<HashMap<String, Arc<PipelineWalWriter>>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

pub async fn get_pipeline_wal_writer(
    pipeline_id: &str,
    remote_stream_params: RemoteStreamParams,
) -> Result<Arc<PipelineWalWriter>> {
    let key = format!("{pipeline_id}-{}", remote_stream_params.destination_name);
    let mut map = PIPELINE_WAL_WRITER_MAP.write().await;
    if let Some(writer) = map.get(&key) {
        Ok(writer.clone())
    } else {
        let pipeline = db::pipeline::get_by_id(pipeline_id)
            .await
            .map_err(|e| Error::Message(format!("get_pipeline_wal_writer fail: {e}")))?;

        let is_realtime = matches!(&pipeline.source, PipelineSource::Realtime(_));
        let writer = PipelineWalWriter::new(
            pipeline_id.to_string(),
            pipeline.source,
            remote_stream_params,
        )?;
        let writer = Arc::new(writer);
        map.insert(key, writer.clone());

        // only realtime wal-file must notify file wather
        // because scheduled pipeline will not write to real wal file
        // we only notify file watcher when rename the tmp file to real file successfully
        if is_realtime {
            // notify the pipeline_file_watcher begin to read entry.
            let wal_writer = writer.wal_writer.write().await;
            let path = wal_writer.path();
            notify_file_watcher(path.clone()).await;
            drop(wal_writer);
        }

        Ok(writer)
    }
}

async fn notify_file_watcher(path: PathBuf) {
    let watcher = FILE_WATCHER_NOTIFY.write().await;
    if let Some(watcher) = watcher.clone() {
        log::debug!("notify file watcher to watch newfile: {:?}", path);
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
    // only for realtime ingest writer
    for (_, w) in map
        .iter()
        .filter(|(_, w)| matches!(w.pipeline_source_type, PipelineSource::Realtime(_)))
    {
        let metadata = w.wal_writer.read().await.metadata().unwrap();
        let ts = get_metadata_motified(&metadata);
        log::debug!(
            "pipeline_wal_writer exec check_ttl, motified elapsed: {:?}",
            ts.elapsed().as_millis()
        );
        let _ = w.rotate(0, false).await;
    }

    Ok(())
}

pub struct PipelineWalWriter {
    pub pipeline_id: String,
    pub pipeline_source_type: PipelineSource,
    pub remote_stream_params: RemoteStreamParams,
    pub wal_writer: Arc<RwLock<wal::Writer>>,
    next_seq: AtomicU64,
}

impl PipelineWalWriter {
    pub fn new(
        pipeline_id: String,
        pipeline_source_type: PipelineSource,
        remote_stream_params: RemoteStreamParams,
    ) -> Result<Self> {
        let cfg = &get_config();

        let wal_file_dir = Self::build_wal_dir(&pipeline_source_type, cfg);

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
            pipeline_source_type,
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
            "destination_name".to_string(),
            remote_stream_params.destination_name.to_string(),
        );

        wal::Writer::build(
            wal_file_dir,
            remote_stream_params.org_id.as_str(),
            "pipeline",
            wal_id,
            0, /* warn: it must be zero, because reader will read init_size with buf, result
                * reader can not read the latest real-time data */
            wal_write_buffer_size,
            Some(header),
        )
        .map_err(|e| Error::WalFileError(format!("wal::Writer::build error: {e}")))
    }
    pub async fn write_wal(&self, data: Vec<json::Value>) -> Result<()> {
        // write data to wal
        if data.is_empty() {
            log::warn!("No data to write to WAL");
            return Ok(());
        }

        let mut entry = Entry {
            stream: Arc::from(""),
            schema: None, // empty Schema
            schema_key: Arc::from(""),
            partition_key: Arc::from(""),
            data: data.iter().map(|d| Arc::new(d.clone())).collect(),
            data_size: data.len(),
        };
        let bytes_entries = entry
            .into_bytes()
            .map_err(|e| Error::Message(format!("write_wal entry into bytes error : {}", e)))?;

        // check rotation
        if let Err(err) = self.rotate(bytes_entries.len(), false).await {
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
        let path = writer.path().clone();
        let current_position = writer.current_position();
        if let PipelineSource::Scheduled(_) = self.pipeline_source_type {
            // rename tmp remote wal file to remote wal file
            // scheduled pipeline will not write to real wal file, so rename the tmp file to remote
            // file
            let path_str = path.to_str().unwrap_or_default();
            // Replace the segment
            let new_path_str = path_str.replace(
                REMOTE_QUERY_STREAM_TMP_WAL_DIR,
                REMOTE_REALTIME_STREAM_WAL_DIR,
            );
            let persist_path = PathBuf::from(new_path_str);

            if let Some(dir) = persist_path.parent() {
                // Check if the directory exists
                if !dir.exists() {
                    fs::create_dir_all(dir)?;
                }
            }
            log::debug!(
                "rename tmp wal file to remote wal file: {path_str} -> {}",
                persist_path.display()
            );
            fs::rename(writer.path(), persist_path.clone()).map_err(|e| {
                Error::Message(format!(
                    "rename {path_str} to persist_path {} fail, error: {e}",
                    persist_path.display()
                ))
            })?;
            // notify file watcher watch persist_path
            notify_file_watcher(persist_path).await;
            // notify file watcher stop watch tmp wal file
            // everytime query stream should write just one wal file, and next time use a new wal
            // drop writer lock and then force rotate
            drop(writer);
            // force rotate
            self.rotate(0, true).await?;
        }

        log::debug!(
            "Writing WAL for pipeline: {}, wal_file_path: {}, wal_file_postion:{:?}, data: {:?}",
            self.pipeline_id,
            path.display(),
            current_position,
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

    fn build_wal_dir(pipeline_source_type: &PipelineSource, cfg: &Arc<Config>) -> PathBuf {
        let path = match pipeline_source_type {
            PipelineSource::Scheduled(_) => &cfg.pipeline.remote_stream_wal_dir.replace(
                REMOTE_REALTIME_STREAM_WAL_DIR,
                REMOTE_QUERY_STREAM_TMP_WAL_DIR,
            ),
            PipelineSource::Realtime(_) => &cfg.pipeline.remote_stream_wal_dir,
        };

        let path = PathBuf::from(path).join(WAL_DIR_DEFAULT_PREFIX);
        if !path.exists() {
            fs::create_dir_all(&path).unwrap();
        }
        path
    }

    async fn rotate(&self, entry_bytes_size: usize, force_rotate: bool) -> Result<()> {
        let wal_writer = self.wal_writer.read().await;
        let metadata = wal_writer.metadata()?;
        let ts = get_metadata_motified(&metadata);

        if !force_rotate && !self.check_wal_threshold(wal_writer.size(), entry_bytes_size, ts) {
            return Ok(());
        }
        drop(wal_writer);

        // rotation wal
        let cfg = get_config();
        let wal_dir = Self::build_wal_dir(&self.pipeline_source_type, &config::get_config());
        let wal_id = self.next_seq.fetch_add(1, Ordering::SeqCst);
        log::info!(
            "[PIPELINE:WAL] create file: {}/{}/pipeline/{}.wal",
            wal_dir.display().to_string(),
            &self.remote_stream_params.org_id,
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

        if let PipelineSource::Realtime(_) = self.pipeline_source_type {
            // notify the pipeline_file_watcher begin to read entry.
            notify_file_watcher(path.clone()).await;
        }

        Ok(())
    }
}
