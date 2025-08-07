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
    datasource::physical_plan::{FileMeta, ParquetFileMetrics, ParquetFileReaderFactory},
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

pub(crate) struct ParquetFileReader {
    file_name: String,
    file_metrics: ParquetFileMetrics,
    inner: ParquetObjectReader,
}

impl AsyncFileReader for ParquetFileReader {
    fn get_bytes(&mut self, range: Range<u64>) -> BoxFuture<'_, parquet::errors::Result<Bytes>> {
        self.file_metrics
            .bytes_scanned
            .add((range.end - range.start) as usize);
        self.inner.get_bytes(range)
    }

    fn get_byte_ranges(
        &mut self,
        ranges: Vec<Range<u64>>,
    ) -> BoxFuture<'_, parquet::errors::Result<Vec<Bytes>>>
    where
        Self: Send,
    {
        let total = ranges.iter().map(|r| (r.end - r.start) as usize).sum();
        self.file_metrics.bytes_scanned.add(total);
        self.inner.get_byte_ranges(ranges)
    }

    fn get_metadata<'a>(
        &'a mut self,
        options: Option<&'a ArrowReaderOptions>,
    ) -> BoxFuture<'a, parquet::errors::Result<Arc<ParquetMetaData>>> {
        Box::pin(async move {
            match self.inner.get_metadata(options).await {
                Ok(meta) => Ok(meta),
                Err(e) => {
                    log::error!(
                        "Failed to get metadata for file: {}, error: {}",
                        self.file_name,
                        e
                    );
                    Err(e)
                }
            }
        })
    }
}

impl ParquetFileReaderFactory for NewParquetFileReaderFactory {
    fn create_reader(
        &self,
        partition_index: usize,
        file_meta: FileMeta,
        metadata_size_hint: Option<usize>,
        metrics: &ExecutionPlanMetricsSet,
    ) -> datafusion::common::Result<Box<dyn AsyncFileReader + Send>> {
        let file_name = file_meta.location().to_string();
        let file_metrics =
            ParquetFileMetrics::new(partition_index, file_meta.location().as_ref(), metrics);
        let store = Arc::clone(&self.store);
        // the FileMeta is from PartitionFile, so we can know the file size
        // also we can don't set the file size, the ParquetObjectReader will get the file size from
        // the object store use get_opts()
        let mut inner = ParquetObjectReader::new(store, file_meta.object_meta.location)
            .with_file_size(file_meta.object_meta.size);

        if let Some(hint) = metadata_size_hint {
            inner = inner.with_footer_size_hint(hint);
        };

        Ok(Box::new(ParquetFileReader {
            file_name,
            inner,
            file_metrics,
        }))
    }
}
