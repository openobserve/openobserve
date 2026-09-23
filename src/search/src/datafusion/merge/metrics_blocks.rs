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

use std::sync::Arc;

use anyhow::Context;
use arrow::array::RecordBatch;
use arrow_schema::Schema;
use config::{get_config, meta::stream::FileMeta};
use datafusion::error::{DataFusionError, Result};
use metrics_block::{BlockWriter, ParentMetadata};
use parquet::file::metadata::ParquetMetaData;
use tokio::task::JoinHandle;
use vortex::{arrow::ArrowSessionExt, file::OpenOptionsSessionExt, session::VortexSession};

use super::MergedFile;

pub(super) const VORTEX_SOURCE_SCHEMA_KEY: &str = "o2_metrics_source_schema";

pub(super) enum SourceMetadata {
    Parquet(ParquetMetaData),
    Vortex(Arc<Schema>),
}

impl SourceMetadata {
    fn finish(
        self,
        writer: BlockWriter<std::fs::File>,
        parent: ParentMetadata,
    ) -> anyhow::Result<std::fs::File> {
        match self {
            Self::Parquet(metadata) => writer.finish_for_parquet(parent, metadata),
            Self::Vortex(schema) => writer.finish_for_vortex(parent, schema),
        }
    }
}

pub(super) enum Blocks {
    NotRequested,
    Disabled,
    Active(Box<BlockFile>),
}

impl Blocks {
    pub fn try_new(schema: &Arc<Schema>) -> anyhow::Result<Self> {
        let (file, path) = new_file()?;
        let writer =
            BlockWriter::new_pending(file, Arc::clone(schema), metrics_block::MAX_BLOCK_ROWS)?;

        Ok(Self::Active(Box::new(BlockFile { writer, path })))
    }

    pub async fn write(self, batch: RecordBatch) -> Result<Self> {
        let Self::Active(mut active) = self else {
            return Ok(self);
        };
        match EncodingJob::run(move || {
            active.writer.write(&batch)?;
            Ok(active)
        })
        .await?
        {
            Ok(active) => Ok(Self::Active(active)),
            Err(error) => {
                log::warn!("metrics block write unavailable; skipping metrics index: {error}");
                Ok(Self::Disabled)
            }
        }
    }

    pub async fn finish(
        self,
        data_path: tempfile::TempPath,
        meta: FileMeta,
        source_metadata: SourceMetadata,
    ) -> Result<MergedFile> {
        EncodingJob::run(move || {
            let Self::Active(active) = self else {
                return match self {
                    Self::Disabled => Ok(MergedFile::MetricsFinalUnindexed { data_path, meta }),
                    Self::NotRequested => anyhow::bail!("block finalization was not requested"),
                    Self::Active(_) => unreachable!(),
                };
            };
            let parent = ParentMetadata {
                rows: u64::try_from(meta.records)?,
                compressed_size: u64::try_from(meta.compressed_size)?,
            };
            let BlockFile { writer, path } = *active;
            match source_metadata.finish(writer, parent) {
                Ok(file) => {
                    drop(file);
                    Ok(MergedFile::MetricsIndexed {
                        data_path,
                        metrics_index_path: path,
                        meta,
                    })
                }
                Err(error) => {
                    log::warn!("metrics index finalization failed; skipping index: {error}");
                    Ok(MergedFile::MetricsFinalUnindexed { data_path, meta })
                }
            }
        })
        .await?
        .map_err(|error| DataFusionError::External(error.into()))
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
        let mut job = Self {
            handle: tokio::task::spawn_blocking(work),
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

fn new_file() -> anyhow::Result<(std::fs::File, tempfile::TempPath)> {
    let tmp_dir = &get_config().common.data_tmp_dir;
    std::fs::create_dir_all(tmp_dir)?;
    let (file, path) = tempfile::NamedTempFile::new_in(tmp_dir)?.into_parts();

    Ok((file, path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn running_encoding_job_retains_temp_file_until_work_exits() {
        let (file, path) = new_file().unwrap();
        let observed = path.to_path_buf();
        let (entered, ready) = tokio::sync::oneshot::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let (done, closed) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(EncodingJob::run(move || {
            let _ = entered.send(());
            wait.recv()?;
            drop(file);
            drop(path);
            let _ = done.send(());
            Ok(())
        }));
        ready.await.unwrap();
        task.abort();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(observed.exists());
        release.send(()).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), closed)
            .await
            .unwrap()
            .unwrap();
        assert!(!observed.exists());
    }
}
