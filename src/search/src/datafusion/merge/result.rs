// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use config::{FileFormat, meta::stream::FileMeta};
use datafusion::error::{DataFusionError, Result};
use metrics_index::MetricsFileLayout;

pub struct MergeResult {
    pub files: Vec<MergedFile>,
    pub file_format: FileFormat,
}

impl MergeResult {
    /// The output for callers that always merge into exactly one file.
    pub fn into_single(self) -> Result<(MergedFile, FileFormat)> {
        let Self {
            mut files,
            file_format,
        } = self;
        if files.len() != 1 {
            return Err(DataFusionError::Execution(format!(
                "merge_parquet_files produced {} files, expected exactly one",
                files.len()
            )));
        }
        Ok((files.pop().unwrap(), file_format))
    }
}

/// One file written by [`super::merge_parquet_files`].
pub enum MergedFile {
    /// Ordinary output, including logs, traces and downsampled metrics.
    Standard { data: Vec<u8>, meta: FileMeta },
    /// Metrics output ordered by `(__hash__, _timestamp)` and retained in memory.
    MetricsHashSorted { data: Vec<u8>, meta: FileMeta },
    /// Finalized indexed metrics output spooled to local disk.
    MetricsIndexed {
        data_path: tempfile::TempPath,
        metrics_index_path: tempfile::TempPath,
        meta: FileMeta,
    },
}

impl MergedFile {
    fn metrics_layout(&self) -> Option<MetricsFileLayout> {
        match self {
            Self::Standard { .. } => None,
            Self::MetricsHashSorted { .. } => Some(MetricsFileLayout::HashSorted),
            Self::MetricsIndexed { .. } => Some(MetricsFileLayout::Indexed),
        }
    }

    /// Name this output without exposing a metrics layout to ordinary files.
    pub fn file_name(&self, id: &str, file_format: FileFormat) -> String {
        match self.metrics_layout() {
            Some(layout) => layout.file_name(id, file_format),
            None => format!("{id}{}", file_format.extension()),
        }
    }

    /// Mark an existing object key when this is a metrics-specific layout.
    pub fn mark_file_key(&self, key: &str) -> String {
        match self.metrics_layout() {
            Some(layout) => layout.mark_file_key(key),
            None => key.to_string(),
        }
    }

    /// Consume the single buffered output used by ingester movers.
    pub fn into_buffered(self) -> Result<(Vec<u8>, FileMeta)> {
        match self {
            Self::Standard { data, meta } | Self::MetricsHashSorted { data, meta } => {
                Ok((data, meta))
            }
            Self::MetricsIndexed { .. } => Err(DataFusionError::Execution(
                "ingester cannot consume indexed metrics output".to_string(),
            )),
        }
    }

    /// Materialize an output immediately before the compactor uploads it.
    pub async fn into_upload_parts(
        self,
    ) -> Result<(Vec<u8>, FileMeta, Option<tempfile::TempPath>)> {
        match self {
            Self::Standard { data, meta } | Self::MetricsHashSorted { data, meta } => {
                Ok((data, meta, None))
            }
            Self::MetricsIndexed {
                data_path,
                metrics_index_path,
                meta,
            } => Ok((
                tokio::fs::read(&data_path).await?,
                meta,
                Some(metrics_index_path),
            )),
        }
    }
}
