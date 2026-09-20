// Copyright 2026 OpenObserve Inc.
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
    io::Write,
    sync::{Arc, LazyLock},
};

use anyhow::Context;
use arrow::array::RecordBatch;
use arrow_schema::Schema;
use config::{FileFormat, PARQUET_MAX_ROW_GROUP_SIZE, get_config, meta::stream::FileMeta};
use datafusion::error::{DataFusionError, Result};
use futures::TryStreamExt;
use metrics_block::{BlockWriter, ParentIdentity};
use metrics_index::MetricsIndexWriter;
use parquet::{
    arrow::arrow_reader::ParquetRecordBatchReaderBuilder, file::metadata::ParquetMetaData,
};
use tokio::{sync::Semaphore, task::JoinHandle};
use vortex::{
    VortexSessionDefault, arrow::ArrowSessionExt, file::OpenOptionsSessionExt,
    io::session::RuntimeSessionExt, session::VortexSession,
};

use super::MergedFile;
use crate::datafusion::vortex::VORTEX_RUNTIME;

pub(super) const VORTEX_SOURCE_SCHEMA_KEY: &str = "o2_metrics_source_schema";

static BLOCK_ENCODING_JOBS: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(get_config().limit.cpu_num.clamp(1, 32))));

#[derive(Clone, Debug, Default)]
pub(super) struct GenerationStats {
    #[cfg(test)]
    pub counters: Arc<GenerationCounters>,
}

impl GenerationStats {
    pub fn legacy_build(&self) {
        #[cfg(test)]
        self.counters
            .legacy_builds
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
    pub fn block_build(&self) {
        #[cfg(test)]
        self.counters
            .block_builds
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
    pub fn fallback(&self) {
        #[cfg(test)]
        self.counters
            .fallbacks
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
    pub fn temp(&self, path: &std::path::Path) {
        #[cfg(test)]
        self.counters.paths.lock().unwrap().push(path.to_path_buf());
        #[cfg(not(test))]
        let _ = path;
    }
    fn before_block_write(&self) {
        #[cfg(test)]
        if let Some((entered, released)) = self.counters.block_gate.lock().unwrap().take() {
            let _ = entered.send(());
            let _ = released.recv();
        }
    }
    fn replay(&self, format: FileFormat) {
        #[cfg(test)]
        match format {
            FileFormat::Parquet => &self.counters.parquet_replays,
            FileFormat::Vortex => &self.counters.vortex_replays,
        }
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        #[cfg(not(test))]
        let _ = format;
    }
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(super) struct GenerationCounters {
    pub legacy_builds: std::sync::atomic::AtomicUsize,
    pub block_builds: std::sync::atomic::AtomicUsize,
    pub fallbacks: std::sync::atomic::AtomicUsize,
    pub parquet_replays: std::sync::atomic::AtomicUsize,
    pub vortex_replays: std::sync::atomic::AtomicUsize,
    pub paths: std::sync::Mutex<Vec<std::path::PathBuf>>,
    pub block_gate: std::sync::Mutex<
        Option<(
            tokio::sync::oneshot::Sender<()>,
            std::sync::mpsc::Receiver<()>,
        )>,
    >,
    pub parquet_readonly: std::sync::atomic::AtomicBool,
    pub vortex_readonly: std::sync::atomic::AtomicBool,
}

pub(super) enum SourceMetadata {
    Parquet(ParquetMetaData),
    Vortex(Arc<Schema>),
}

impl SourceMetadata {
    fn format(&self) -> FileFormat {
        match self {
            Self::Parquet(_) => FileFormat::Parquet,
            Self::Vortex(_) => FileFormat::Vortex,
        }
    }

    fn finish(
        self,
        writer: BlockWriter<std::fs::File>,
        parent: ParentIdentity,
    ) -> anyhow::Result<std::fs::File> {
        match self {
            Self::Parquet(metadata) => writer.finish_for_parquet(parent, metadata),
            Self::Vortex(schema) => writer.finish_for_source(parent, schema, None),
        }
    }
}

pub(super) enum Blocks {
    Disabled,
    Active(Box<BlockFile>),
    Replay,
}

impl Blocks {
    pub fn try_new(schema: &Arc<Schema>, stats: &GenerationStats) -> anyhow::Result<Self> {
        let (file, path) = new_file(stats)?;
        let writer =
            BlockWriter::new_pending(file, Arc::clone(schema), metrics_block::MAX_BLOCK_ROWS)?;
        stats.block_build();
        Ok(Self::Active(Box::new(BlockFile { writer, path })))
    }

    pub async fn write(self, batch: RecordBatch, stats: &GenerationStats) -> Result<Self> {
        let Self::Active(mut active) = self else {
            return Ok(self);
        };
        let progress = stats.clone();
        match EncodingJob::run(move || {
            progress.before_block_write();
            active.writer.write(&batch)?;
            Ok(active)
        })
        .await?
        {
            Ok(active) => Ok(Self::Active(active)),
            Err(error) => {
                stats.fallback();
                log::warn!(
                    "metrics block write unavailable; retaining completed source for legacy-index replay: {error}"
                );
                Ok(Self::Replay)
            }
        }
    }

    pub async fn finish(
        self,
        data_path: tempfile::TempPath,
        object_key: String,
        meta: FileMeta,
        source_metadata: SourceMetadata,
        stats: GenerationStats,
    ) -> Result<MergedFile> {
        EncodingJob::run(move || {
            let format = source_metadata.format();
            let block_path = match self {
                Self::Active(active) => {
                    let parent = ParentIdentity { object_key: object_key.clone(), rows: u64::try_from(meta.records)?, compressed_size: u64::try_from(meta.compressed_size)? };
                    let BlockFile { writer, path } = *active;
                    match source_metadata.finish(writer, parent) {
                        Ok(file) => { drop(file); Some(path) }
                        Err(error) => {
                            stats.fallback();
                            log::warn!("metrics block finalization unavailable; rebuilding legacy index from completed source: {error}");
                            drop(path);
                            None
                        }
                    }
                }
                Self::Replay => None,
                Self::Disabled => anyhow::bail!("block finalization without a block attempt"),
            };
            let metrics_index_path = match block_path {
                Some(path) => path,
                None => replay_legacy(&data_path, &meta, format, &stats)?,
            };
            Ok(MergedFile::MetricsIndexed { data_path, metrics_index_path, object_key: Some(object_key), meta })
        }).await?.map_err(|error| DataFusionError::External(error.into()))
    }
}

pub(super) struct BlockFile {
    writer: BlockWriter<std::fs::File>,
    path: tempfile::TempPath,
}

struct EncodingJob<T> {
    handle: JoinHandle<anyhow::Result<T>>,
}

impl<T: Send + 'static> EncodingJob<T> {
    async fn run(
        work: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
    ) -> Result<anyhow::Result<T>> {
        let permit = Arc::clone(&BLOCK_ENCODING_JOBS)
            .acquire_owned()
            .await
            .map_err(|error| DataFusionError::External(Box::new(error)))?;
        let mut job = Self {
            handle: tokio::task::spawn_blocking(move || {
                let _permit = permit;
                work()
            }),
        };
        (&mut job.handle)
            .await
            .map_err(|error| DataFusionError::External(Box::new(error)))
    }
}

impl<T> Drop for EncodingJob<T> {
    fn drop(&mut self) {
        // Running jobs own their temp paths until exit; queued jobs can still be aborted.
        self.handle.abort();
    }
}

pub(super) async fn verify_vortex_source(
    data_path: &std::path::Path,
    meta: &FileMeta,
    expected: &Arc<Schema>,
    session: &VortexSession,
) -> anyhow::Result<Arc<Schema>> {
    anyhow::ensure!(
        tokio::fs::metadata(data_path).await?.len() == u64::try_from(meta.compressed_size)?,
        "completed Vortex size changed"
    );
    let file = session
        .open_options()
        .include_metadata()
        .open_path(data_path.to_path_buf())
        .await?;
    anyhow::ensure!(
        file.row_count() == u64::try_from(meta.records)?,
        "completed Vortex row count changed"
    );
    anyhow::ensure!(
        *file.dtype() == session.arrow().from_arrow_schema(expected)?,
        "completed Vortex dtype changed"
    );
    let stored = file
        .metadata_segment(VORTEX_SOURCE_SCHEMA_KEY)
        .context("missing Vortex source schema")?;
    let schema: Schema = serde_json::from_slice(stored)?;
    anyhow::ensure!(
        &schema == expected.as_ref(),
        "completed Vortex source schema changed"
    );
    Ok(Arc::new(schema))
}

fn new_file(stats: &GenerationStats) -> anyhow::Result<(std::fs::File, tempfile::TempPath)> {
    let tmp_dir = &get_config().common.data_tmp_dir;
    std::fs::create_dir_all(tmp_dir)?;
    let (file, path) = tempfile::NamedTempFile::new_in(tmp_dir)?.into_parts();
    stats.temp(&path);
    Ok((file, path))
}

fn replay_parquet(
    data_path: &std::path::Path,
    meta: &FileMeta,
    stats: &GenerationStats,
) -> anyhow::Result<tempfile::TempPath> {
    let file = std::fs::File::open(data_path)?;
    anyhow::ensure!(
        file.metadata()?.len() == u64::try_from(meta.compressed_size)?,
        "completed Parquet size changed"
    );
    let builder = ParquetRecordBatchReaderBuilder::try_new(file)?;
    anyhow::ensure!(
        builder.metadata().file_metadata().num_rows() == meta.records,
        "completed Parquet row count changed"
    );
    stats.legacy_build();
    let mut index = MetricsIndexWriter::try_new(builder.schema())?;
    stats.replay(FileFormat::Parquet);
    for batch in builder
        .with_batch_size(metrics_block::MAX_BLOCK_ROWS)
        .build()?
    {
        index.write_with_label_boundaries(&batch.context("failed to replay completed Parquet")?)?;
    }
    let bytes = index.finish(meta.records, Some(PARQUET_MAX_ROW_GROUP_SIZE))?;
    let (mut file, path) = new_file(stats)?;
    file.write_all(&bytes)?;
    drop(file);
    Ok(path)
}

fn replay_legacy(
    data_path: &std::path::Path,
    meta: &FileMeta,
    format: FileFormat,
    stats: &GenerationStats,
) -> anyhow::Result<tempfile::TempPath> {
    match format {
        FileFormat::Parquet => replay_parquet(data_path, meta, stats),
        FileFormat::Vortex => VORTEX_RUNTIME.block_on(replay_vortex(data_path, meta, stats)),
    }
}

async fn replay_vortex(
    data_path: &std::path::Path,
    meta: &FileMeta,
    stats: &GenerationStats,
) -> anyhow::Result<tempfile::TempPath> {
    anyhow::ensure!(
        tokio::fs::metadata(data_path).await?.len() == u64::try_from(meta.compressed_size)?,
        "completed Vortex size changed"
    );
    let session = VortexSession::default().with_tokio();
    let file = session
        .open_options()
        .open_path(data_path.to_path_buf())
        .await?;
    anyhow::ensure!(
        file.row_count() == u64::try_from(meta.records)?,
        "completed Vortex row count changed"
    );
    let schema = Arc::new(session.arrow().to_arrow_schema(file.dtype())?);
    let dtype = arrow::datatypes::DataType::Struct(schema.fields().clone());
    stats.legacy_build();
    let mut index = MetricsIndexWriter::try_new(&schema)?;
    stats.replay(FileFormat::Vortex);
    let stream = file
        .scan()?
        .with_split_by(vortex::layout::scan::split_by::SplitBy::RowCount(
            metrics_block::MAX_BLOCK_ROWS,
        ))
        .with_concurrency(1)
        .with_ordered(true)
        .into_array_stream()?;
    futures::pin_mut!(stream);
    while let Some(array) = stream.try_next().await? {
        let batch = config::utils::parquet::vortex_array_to_record_batch(&session, array, &dtype)?;
        index.write_with_label_boundaries(&batch)?;
    }
    let bytes = index.finish(meta.records, None)?;
    let (mut file, path) = new_file(stats)?;
    file.write_all(&bytes)?;
    drop(file);
    Ok(path)
}
