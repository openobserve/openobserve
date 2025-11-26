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

use std::{fmt::Debug, ops::Range, sync::Arc};

use bytes::Bytes;
use datafusion::{
    datasource::{
        listing::PartitionedFile,
        physical_plan::{ParquetFileMetrics, ParquetFileReaderFactory},
    },
    physical_plan::metrics::ExecutionPlanMetricsSet,
};
use futures::future::BoxFuture;
use object_store::ObjectStore;
use parquet::{
    arrow::{
        arrow_reader::ArrowReaderOptions,
        async_reader::{AsyncFileReader, ParquetObjectReader},
    },
    file::metadata::ParquetMetaData,
};

#[derive(Debug)]
pub struct NewParquetFileReaderFactory {
    store: Arc<dyn ObjectStore>,
}

impl NewParquetFileReaderFactory {
    pub fn new(store: Arc<dyn ObjectStore>) -> Self {
        Self { store }
    }
}

// improve error messages by logging file name
pub struct ParquetFileReader {
    pub file_name: String,
    pub file_metrics: ParquetFileMetrics,
    pub inner: ParquetObjectReader,
}

impl AsyncFileReader for ParquetFileReader {
    fn get_bytes(&mut self, range: Range<u64>) -> BoxFuture<'_, parquet::errors::Result<Bytes>> {
        let bytes_scanned = range.end - range.start;
        self.file_metrics.bytes_scanned.add(bytes_scanned as usize);
        self.inner.get_bytes(range)
    }

    fn get_byte_ranges(
        &mut self,
        ranges: Vec<Range<u64>>,
    ) -> BoxFuture<'_, parquet::errors::Result<Vec<Bytes>>>
    where
        Self: Send,
    {
        let total: u64 = ranges.iter().map(|r| r.end - r.start).sum();
        self.file_metrics.bytes_scanned.add(total as usize);
        self.inner.get_byte_ranges(ranges)
    }

    // improve error messages by logging file name
    fn get_metadata<'a>(
        &'a mut self,
        options: Option<&'a ArrowReaderOptions>,
    ) -> BoxFuture<'a, parquet::errors::Result<Arc<ParquetMetaData>>> {
        Box::pin(async move {
            match self.inner.get_metadata(options).await {
                Ok(meta) => Ok(meta),
                Err(e) => {
                    log::error!(
                        "Failed to get metadata for file: {}, error: {e}",
                        self.file_name,
                    );
                    Err(e)
                }
            }
        })
    }
}

// improve error messages by logging file name
impl ParquetFileReaderFactory for NewParquetFileReaderFactory {
    fn create_reader(
        &self,
        partition_index: usize,
        partitioned_file: PartitionedFile,
        metadata_size_hint: Option<usize>,
        metrics: &ExecutionPlanMetricsSet,
    ) -> datafusion::common::Result<Box<dyn AsyncFileReader + Send>> {
        let file_metrics = ParquetFileMetrics::new(
            partition_index,
            partitioned_file.object_meta.location.as_ref(),
            metrics,
        );
        let store = Arc::clone(&self.store);
        let mut inner =
            ParquetObjectReader::new(store, partitioned_file.object_meta.location.clone())
                .with_file_size(partitioned_file.object_meta.size);

        if let Some(hint) = metadata_size_hint {
            inner = inner.with_footer_size_hint(hint)
        };

        Ok(Box::new(ParquetFileReader {
            file_name: partitioned_file.object_meta.location.to_string(),
            inner,
            file_metrics,
        }))
    }
}
