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

use arrow::{
    array::{Array, Int64Array, RecordBatch, UInt64Array},
    compute::{max, min},
};
use config::{
    FileFormat, TIMESTAMP_COL_NAME, meta::stream::FileMeta, utils::parquet::new_parquet_writer,
};
use datafusion::{
    arrow::datatypes::Schema,
    error::{DataFusionError, Result},
};
use futures::future::BoxFuture;
use metrics_index::MetricsFileLayout;
use parquet::arrow::{AsyncArrowWriter, async_writer::AsyncFileWriter};
use tokio::io::AsyncWriteExt;
use vortex::{
    VortexSessionDefault,
    array::ArrayRef,
    arrow::ArrowSessionExt,
    dtype::DType,
    file::{VortexWriteOptions, Writer as VortexWriter},
    io::session::RuntimeSessionExt,
    session::VortexSession,
};

use super::{
    MergedFile, append_metadata,
    metrics_index::{Blocks, SourceMetadata, VORTEX_SOURCE_SCHEMA_KEY, verify_vortex_source},
    new_temp_file,
};
use crate::datafusion::vortex::{VORTEX_RUNTIME, vortex_write_strategy};

const MAX_SERIES_PER_FILE: usize = 1_000_000;

struct ReadTask {
    handle: tokio::task::JoinHandle<Result<()>>,
}

impl Drop for ReadTask {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

struct VortexTask<T> {
    handle: tokio::task::JoinHandle<anyhow::Result<T>>,
    cancel: Option<tokio::sync::oneshot::Sender<()>>,
}

impl<T> Drop for VortexTask<T> {
    fn drop(&mut self) {
        self.cancel.take();
        self.handle.abort();
    }
}

/// The files a hash-ordered merge is written into: their format, size bound and layout.
#[derive(Debug, Clone)]
pub(super) struct MetricsOutput {
    pub file_format: FileFormat,
    pub max_file_size: usize,
    pub layout: MetricsFileLayout,
}

impl MetricsOutput {
    fn prepare_blocks(&self, schema: &Arc<Schema>, with_index: bool) -> Result<Blocks> {
        if !with_index {
            return Ok(Blocks::NotRequested);
        }
        if let Err(error) = metrics_index::block::identity_label_columns(schema) {
            log::warn!("metrics schema cannot be indexed: {error}");
            return Ok(Blocks::SkippedUnsupported);
        }
        Blocks::try_new(schema).map_err(|error| DataFusionError::External(error.into()))
    }
}

/// The per-file rotation rule derived from a [`MetricsOutput`] and the schema.
#[derive(Debug, Clone, Copy)]
struct FileSplit {
    max_file_size: i64,
    timestamp_index: usize,
    /// Closed-hour outputs attempt MIDX generation; open-hour outputs do not.
    with_index: bool,
}

struct MetricsFileState {
    file_meta: FileMeta,
    timestamp_index: usize,
}

impl MetricsFileState {
    fn new(timestamp_index: usize) -> Self {
        Self {
            file_meta: FileMeta::default(),
            timestamp_index,
        }
    }

    fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        let timestamps = batch
            .column(self.timestamp_index)
            .as_any()
            .downcast_ref::<Int64Array>()
            .ok_or_else(|| {
                DataFusionError::Plan(format!(
                    "indexed metrics layout requires Int64 {TIMESTAMP_COL_NAME}"
                ))
            })?;
        let meta = &mut self.file_meta;
        if let (Some(batch_min), Some(batch_max)) = (min(timestamps), max(timestamps)) {
            if meta.records == 0 {
                (meta.min_ts, meta.max_ts) = (batch_min, batch_max);
            } else {
                meta.min_ts = meta.min_ts.min(batch_min);
                meta.max_ts = meta.max_ts.max(batch_max);
            }
        }
        meta.records += batch.num_rows() as i64;
        Ok(())
    }

    fn finish(mut self, source_meta: &FileMeta, max_file_size: i64) -> FileMeta {
        self.file_meta.original_size =
            proportional_original_size(source_meta, self.file_meta.records).min(max_file_size - 1);
        self.file_meta
    }
}

struct SeriesSplit {
    count: usize,
    last_hash: Option<u64>,
}

impl SeriesSplit {
    fn new() -> Self {
        Self {
            count: 0,
            last_hash: None,
        }
    }

    fn reset(&mut self) {
        self.count = 0;
        self.last_hash = None;
    }

    fn take(&mut self, hashes: &UInt64Array, start: usize) -> usize {
        let mut end = start;
        while end < hashes.len() {
            let hash = hashes.value(end);
            if self.last_hash != Some(hash) {
                if self.count == MAX_SERIES_PER_FILE {
                    break;
                }
                self.count += 1;
                self.last_hash = Some(hash);
            }
            end += 1;
        }
        end - start
    }
}

fn series_hashes(batch: &RecordBatch) -> Result<&UInt64Array> {
    let hashes = batch
        .column_by_name("__hash__")
        .and_then(|column| column.as_any().downcast_ref::<UInt64Array>())
        .ok_or_else(|| {
            DataFusionError::Execution("metrics series split requires UInt64 __hash__".into())
        })?;
    if hashes.null_count() > 0 {
        return Err(DataFusionError::Execution(
            "metrics series split requires non-null __hash__".into(),
        ));
    }
    Ok(hashes)
}

struct ParquetSink {
    file: tokio::fs::File,
    path: tempfile::TempPath,
}

impl ParquetSink {
    fn new() -> Result<Self> {
        let (file, path) = new_temp_file()?;
        Ok(Self { file, path })
    }

    async fn into_path(mut self) -> Result<(tempfile::TempPath, usize)> {
        self.file.shutdown().await?;
        let size = usize::try_from(self.file.metadata().await?.len())
            .map_err(|e| DataFusionError::External(Box::new(e)))?;
        drop(self.file);
        Ok((self.path, size))
    }
}

impl AsyncFileWriter for ParquetSink {
    fn write(&mut self, bytes: bytes::Bytes) -> BoxFuture<'_, parquet::errors::Result<()>> {
        Box::pin(async move {
            self.file.write_all(&bytes).await?;
            Ok(())
        })
    }
    fn complete(&mut self) -> BoxFuture<'_, parquet::errors::Result<()>> {
        Box::pin(async move {
            self.file.flush().await?;
            Ok(())
        })
    }
}

struct ActiveMetricsParquetWriter {
    writer: AsyncArrowWriter<ParquetSink>,
    state: MetricsFileState,
    blocks: Blocks,
}

impl ActiveMetricsParquetWriter {
    fn try_new(
        schema: &Arc<Schema>,
        bloom_filter_fields: &[String],
        metadata: &FileMeta,
        timestamp_index: usize,
        with_index: bool,
        output: &MetricsOutput,
    ) -> Result<Self> {
        let blocks = output.prepare_blocks(schema, with_index)?;
        let sink = ParquetSink::new()?;
        let writer = new_parquet_writer(sink, schema, bloom_filter_fields, metadata, false, None);
        Ok(Self {
            writer,
            state: MetricsFileState::new(timestamp_index),
            blocks,
        })
    }

    async fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        self.writer.write(batch).await?;
        self.state.write(batch)?;
        let blocks = std::mem::replace(&mut self.blocks, Blocks::NotRequested);
        self.blocks = blocks.write(batch.clone()).await?;
        Ok(())
    }

    async fn finish(mut self, source_meta: &FileMeta, max_file_size: i64) -> Result<MergedFile> {
        let mut file_meta = self.state.finish(source_meta, max_file_size);
        append_metadata(&mut self.writer, &file_meta)?;
        let parquet_metadata = self.writer.finish().await?;
        let expected_size = self.writer.bytes_written();
        let (data_path, size) = self.writer.into_inner().into_path().await?;
        if size == 0
            || size != expected_size
            || parquet_metadata.file_metadata().num_rows() != file_meta.records
        {
            return Err(DataFusionError::Execution(
                "completed Parquet identity disagrees with writer output".into(),
            ));
        }
        file_meta.compressed_size =
            i64::try_from(size).map_err(|e| DataFusionError::External(Box::new(e)))?;
        match self.blocks {
            Blocks::NotRequested => Ok(MergedFile::MetricsHashMerged {
                data_path,
                meta: file_meta,
            }),
            Blocks::SkippedUnsupported => Ok(MergedFile::MetricsIndexedNoIndex {
                data_path,
                meta: file_meta,
            }),
            blocks => {
                blocks
                    .finish(
                        data_path,
                        file_meta,
                        SourceMetadata::Parquet(parquet_metadata),
                    )
                    .await
            }
        }
    }
}

struct ActiveMetricsVortexWriter {
    writer: VortexWriter<'static>,
    data_path: tempfile::TempPath,
    state: MetricsFileState,
    blocks: Blocks,
    schema: Arc<Schema>,
}

impl ActiveMetricsVortexWriter {
    fn try_new(
        schema: &Arc<Schema>,
        timestamp_index: usize,
        with_index: bool,
        write_options: VortexWriteOptions,
        dtype: DType,
        output: &MetricsOutput,
    ) -> Result<Self> {
        let blocks = output.prepare_blocks(schema, with_index)?;
        let (file, data_path) = new_temp_file()?;

        let write_options = write_options.with_metadata_segment(
            VORTEX_SOURCE_SCHEMA_KEY,
            serde_json::to_vec(schema.as_ref())
                .map_err(|e| DataFusionError::External(Box::new(e)))?,
        );
        Ok(Self {
            writer: write_options.writer(file, dtype),
            data_path,
            state: MetricsFileState::new(timestamp_index),
            blocks,
            schema: Arc::clone(schema),
        })
    }

    async fn write(&mut self, batch: RecordBatch, session: &VortexSession) -> anyhow::Result<()> {
        let array: ArrayRef = session
            .arrow()
            .from_arrow_record_batch(batch.clone(), self.schema.as_ref())?;
        self.writer.push(array).await?;
        self.state.write(&batch)?;
        let blocks = std::mem::replace(&mut self.blocks, Blocks::NotRequested);
        self.blocks = blocks.write(batch).await?;
        Ok(())
    }

    async fn finish(
        self,
        source_meta: &FileMeta,
        max_file_size: i64,
        session: &VortexSession,
    ) -> anyhow::Result<MergedFile> {
        let mut file_meta = self.state.finish(source_meta, max_file_size);
        let summary = self.writer.finish().await?;
        let size = tokio::fs::metadata(&self.data_path).await?.len();
        anyhow::ensure!(
            size > 0 && size == summary.size(),
            "completed Vortex byte size disagrees with writer"
        );
        anyhow::ensure!(
            summary.row_count() == u64::try_from(file_meta.records)?,
            "completed Vortex writer row count mismatch"
        );
        file_meta.compressed_size = i64::try_from(size)?;
        let schema =
            verify_vortex_source(&self.data_path, &file_meta, &self.schema, session).await?;
        match self.blocks {
            Blocks::NotRequested => Ok(MergedFile::MetricsHashMerged {
                data_path: self.data_path,
                meta: file_meta,
            }),
            Blocks::SkippedUnsupported => Ok(MergedFile::MetricsIndexedNoIndex {
                data_path: self.data_path,
                meta: file_meta,
            }),
            blocks => Ok(blocks
                .finish(self.data_path, file_meta, SourceMetadata::Vortex(schema))
                .await?),
        }
    }
}

/// The finished output: indexed with its `.midx` spooled next to it, or hash-merged.
pub(super) async fn write_files(
    schema: &Arc<Schema>,
    bloom_filter_fields: &[String],
    metadata: &FileMeta,
    output: MetricsOutput,
    rx: tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: tokio::task::JoinHandle<Result<()>>,
) -> Result<Vec<MergedFile>> {
    let read_task = ReadTask { handle: read_task };
    let timestamp_index = schema.index_of(TIMESTAMP_COL_NAME).map_err(|e| {
        DataFusionError::Plan(format!(
            "indexed metrics layout requires {TIMESTAMP_COL_NAME}: {e}"
        ))
    })?;
    let split = FileSplit {
        max_file_size: i64::try_from(output.max_file_size).unwrap(),
        timestamp_index,
        with_index: output.layout == MetricsFileLayout::Indexed,
    };
    let files = match output.file_format {
        FileFormat::Parquet => {
            write_parquet(
                schema,
                bloom_filter_fields,
                metadata,
                split,
                output,
                rx,
                read_task,
            )
            .await?
        }
        FileFormat::Vortex => {
            write_vortex(
                Arc::clone(schema),
                metadata.clone(),
                split,
                output,
                rx,
                read_task,
            )
            .await?
        }
    };
    if files.is_empty() {
        return Err(DataFusionError::Execution(
            "metrics merge produced no rows".to_string(),
        ));
    }

    Ok(files)
}

async fn write_parquet(
    schema: &Arc<Schema>,
    bloom_filter_fields: &[String],
    metadata: &FileMeta,
    split: FileSplit,
    output: MetricsOutput,
    mut rx: tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: ReadTask,
) -> Result<Vec<MergedFile>> {
    let FileSplit {
        max_file_size,
        timestamp_index,
        with_index,
    } = split;
    let mut active: Option<ActiveMetricsParquetWriter> = None;
    let mut files = Vec::new();
    let mut series = SeriesSplit::new();

    while let Some(batch) = rx.recv().await {
        if batch.num_rows() == 0 {
            continue;
        }
        let hashes = series_hashes(&batch)?;
        let mut start = 0;
        while start < batch.num_rows() {
            if let Some(full) = active.take_if(|writer| {
                proportional_original_size(metadata, writer.state.file_meta.records)
                    >= max_file_size
            }) {
                files.push(full.finish(metadata, max_file_size).await?);
                series.reset();
            }
            let len = series.take(hashes, start);
            if len == 0 {
                let full = active
                    .take()
                    .expect("series limit requires an active writer");
                files.push(full.finish(metadata, max_file_size).await?);
                series.reset();
                continue;
            }
            let writer = match active.as_mut() {
                Some(writer) => writer,
                None => active.insert(ActiveMetricsParquetWriter::try_new(
                    schema,
                    bloom_filter_fields,
                    metadata,
                    timestamp_index,
                    with_index,
                    &output,
                )?),
            };
            writer.write(&batch.slice(start, len)).await?;
            start += len;
        }
    }

    await_read_task(read_task).await?;
    if let Some(active) = active {
        files.push(active.finish(metadata, max_file_size).await?);
    }
    Ok(files)
}

async fn write_vortex(
    schema: Arc<Schema>,
    metadata: FileMeta,
    split: FileSplit,
    output: MetricsOutput,
    mut rx: tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: ReadTask,
) -> Result<Vec<MergedFile>> {
    let FileSplit {
        max_file_size,
        timestamp_index,
        with_index,
    } = split;
    let (cancel, cancelled) = tokio::sync::oneshot::channel::<()>();
    let writer_task = VORTEX_RUNTIME.spawn_blocking(move || {
        VORTEX_RUNTIME.block_on(async move {
            tokio::select! {
                _ = cancelled => Err(anyhow::anyhow!("Vortex writer cancelled")),
                result = async move {
            let session = VortexSession::default().with_tokio();
            let dtype = session.arrow().from_arrow_schema(schema.as_ref())?;
            let strategy = vortex_write_strategy(&session);
            let mut active: Option<ActiveMetricsVortexWriter> = None;
            let mut files = Vec::new();
            let mut series = SeriesSplit::new();

            while let Some(batch) = rx.recv().await {
                if batch.num_rows() == 0 {
                    continue;
                }
                let hashes = series_hashes(&batch)?;
                let mut start = 0;
                while start < batch.num_rows() {
                    if let Some(full) = active.take_if(|writer| {
                        proportional_original_size(&metadata, writer.state.file_meta.records) >= max_file_size
                    }) {
                        files.push(full.finish(&metadata, max_file_size, &session).await?);
                        series.reset();
                    }
                    let len = series.take(hashes, start);
                    if len == 0 {
                        let full = active.take().expect("series limit requires an active writer");
                        files.push(full.finish(&metadata, max_file_size, &session).await?);
                        series.reset();
                        continue;
                    }
                    let writer = match active.as_mut() {
                        Some(writer) => writer,
                        None => {
                            let options = VortexWriteOptions::new(session.clone()).with_strategy(strategy.clone());
                            active.insert(ActiveMetricsVortexWriter::try_new(
                                &schema, timestamp_index, with_index, options, dtype.clone(), &output,
                            )?)
                        }
                    };
                    writer.write(batch.slice(start, len), &session).await?;
                    start += len;
                }
            }

            if let Some(active) = active {
                files.push(active.finish(&metadata, max_file_size, &session).await?);
            }
            Ok::<Vec<MergedFile>, anyhow::Error>(files)
                } => result,
            }
        })
    });

    let mut writer_task = VortexTask {
        handle: writer_task,
        cancel: Some(cancel),
    };
    let files = (&mut writer_task.handle)
        .await
        .map_err(|e| DataFusionError::Execution(format!("Vortex runtime task failed: {e}")))?
        .map_err(|e| DataFusionError::Execution(format!("Failed to write vortex files: {e}")))?;
    await_read_task(read_task).await?;
    Ok(files)
}

async fn await_read_task(mut read_task: ReadTask) -> Result<()> {
    (&mut read_task.handle)
        .await
        .map_err(|e| DataFusionError::External(Box::new(e)))?
}

/// The share of the source `original_size` that `records` rows carry.
fn proportional_original_size(source_meta: &FileMeta, records: i64) -> i64 {
    let estimate = (i128::from(source_meta.original_size.max(0)) * i128::from(records.max(0)))
        / i128::from(source_meta.records.max(1));
    i64::try_from(estimate).unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {

    use std::sync::Arc;

    use arrow::array::{Float64Array, Int64Array, StringViewArray, UInt64Array};
    use arrow_schema::{DataType, Field, Schema};
    use config::{
        PARQUET_MAX_ROW_GROUP_SIZE,
        meta::promql::{HASH_LABEL, VALUE_LABEL},
    };
    use futures::TryStreamExt;
    use vortex::file::OpenOptionsSessionExt;

    use super::*;

    type SourceRow = (u64, i64, Option<u64>);

    fn block_schema(semantic: Option<String>, unsupported: bool) -> Arc<Schema> {
        let mut fields = vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(VALUE_LABEL, DataType::Float64, true),
            Field::new("tag", DataType::Utf8, true),
        ];
        if unsupported {
            fields.push(Field::new("__oo_midx_bad", DataType::Utf8, true));
        }
        let metadata = semantic
            .into_iter()
            .map(|value| ("semantic".to_owned(), value))
            .collect::<std::collections::HashMap<_, _>>();
        Arc::new(Schema::new_with_metadata(fields, metadata))
    }

    fn block_batch(schema: &Arc<Schema>, rows: &[SourceRow]) -> RecordBatch {
        let mut columns: Vec<arrow::array::ArrayRef> = vec![
            Arc::new(UInt64Array::from_iter_values(rows.iter().map(|row| row.0))),
            Arc::new(Int64Array::from_iter_values(rows.iter().map(|row| row.1))),
            Arc::new(Float64Array::from_iter(
                rows.iter().map(|row| row.2.map(f64::from_bits)),
            )),
            Arc::new(arrow::array::StringArray::from(vec![Some("x"); rows.len()])),
        ];
        if schema.fields().len() == 5 {
            columns.push(Arc::new(arrow::array::StringArray::from_iter_values(
                (0..rows.len()).map(|i| {
                    if i % 2 == 0 {
                        "per-point-a"
                    } else {
                        "per-point-b"
                    }
                }),
            )));
        }
        RecordBatch::try_new(Arc::clone(schema), columns).unwrap()
    }

    fn build_from_parquet(
        bytes: bytes::Bytes,
        parent: metrics_index::block::ParentMetadata,
    ) -> anyhow::Result<Vec<u8>> {
        use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
        anyhow::ensure!(
            bytes.len() as u64 == parent.compressed_size,
            "source size mismatch"
        );
        let builder = ParquetRecordBatchReaderBuilder::try_new(bytes)?;
        let schema = builder.schema().clone();
        let metadata = builder.metadata().as_ref().clone();
        let mut writer = metrics_index::block::BlockWriter::new_pending(
            Vec::new(),
            schema.clone(),
            metrics_index::block::MAX_BLOCK_ROWS,
        )?;
        for batch in builder
            .with_batch_size(metrics_index::block::MAX_BLOCK_ROWS)
            .build()?
        {
            let batch = batch?;
            let batch = RecordBatch::try_new(schema.clone(), batch.columns().to_vec())?;
            writer.write(&batch)?;
        }
        writer.finish_for_parquet(parent, metadata)
    }

    fn block_output() -> MetricsOutput {
        MetricsOutput {
            file_format: FileFormat::Parquet,
            max_file_size: 1024 * 1024 * 1024,
            layout: MetricsFileLayout::Indexed,
        }
    }

    async fn produce(
        schema: &Arc<Schema>,
        batches: Vec<RecordBatch>,
        output: MetricsOutput,
    ) -> Result<Vec<MergedFile>> {
        let rows = batches.iter().map(RecordBatch::num_rows).sum::<usize>();
        let metadata = FileMeta {
            records: rows as i64,
            original_size: rows as i64 * 64,
            ..Default::default()
        };
        let (tx, rx) = tokio::sync::mpsc::channel(2);
        let read = tokio::spawn(async move {
            for batch in batches {
                tx.send(batch)
                    .await
                    .map_err(|error| DataFusionError::External(Box::new(error)))?;
            }
            Ok(())
        });
        write_files(schema, &[], &metadata, output, rx, read).await
    }

    async fn sample_rows_for(format: FileFormat, data: bytes::Bytes) -> Vec<SourceRow> {
        let (_, mut reader) =
            config::utils::parquet::get_recordbatch_reader_from_bytes(format, data)
                .await
                .unwrap();
        let mut rows = Vec::new();
        while let Some(batch) = reader.try_next().await.unwrap() {
            let hashes = batch
                .column_by_name(HASH_LABEL)
                .unwrap()
                .as_any()
                .downcast_ref::<UInt64Array>()
                .unwrap();
            let times = batch
                .column_by_name(TIMESTAMP_COL_NAME)
                .unwrap()
                .as_any()
                .downcast_ref::<Int64Array>()
                .unwrap();
            let values = batch
                .column_by_name(VALUE_LABEL)
                .unwrap()
                .as_any()
                .downcast_ref::<Float64Array>()
                .unwrap();
            rows.extend((0..batch.num_rows()).map(|i| {
                (
                    hashes.value(i),
                    times.value(i),
                    (!values.is_null(i)).then(|| values.value(i).to_bits()),
                )
            }));
        }
        rows
    }

    fn sample_rows(bytes: bytes::Bytes) -> Vec<SourceRow> {
        use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
        ParquetRecordBatchReaderBuilder::try_new(bytes)
            .unwrap()
            .build()
            .unwrap()
            .flat_map(|batch| {
                let batch = batch.unwrap();
                let hashes = batch
                    .column_by_name(HASH_LABEL)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<UInt64Array>()
                    .unwrap();
                let times = batch
                    .column_by_name(TIMESTAMP_COL_NAME)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<Int64Array>()
                    .unwrap();
                let values = batch
                    .column_by_name(VALUE_LABEL)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<Float64Array>()
                    .unwrap();
                (0..batch.num_rows())
                    .map(|row| {
                        (
                            hashes.value(row),
                            times.value(row),
                            (!values.is_null(row)).then(|| values.value(row).to_bits()),
                        )
                    })
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    async fn check_block_files(files: Vec<MergedFile>, expected: &[SourceRow]) {
        let mut actual = Vec::new();
        for (position, file) in files.into_iter().enumerate() {
            let (data, meta, path) = file.into_upload_parts().await.unwrap();
            let data = bytes::Bytes::from(data);
            let encoded = tokio::fs::read(path.unwrap()).await.unwrap();
            let parent = metrics_index::block::ParentMetadata {
                rows: meta.records as u64,
                compressed_size: data.len() as u64,
            };
            let reference = build_from_parquet(data.clone(), parent.clone()).unwrap();
            assert_eq!(encoded, reference, "file {position}");
            let index =
                metrics_index::block::decode_file(&encoded, &parent, &["tag".into()]).unwrap();
            assert_eq!(index.parent.rows, meta.records as u64);
            assert_eq!(
                index.row_group_size,
                Some(meta.records.min(PARQUET_MAX_ROW_GROUP_SIZE as i64) as u32)
            );
            let mut decoded = Vec::new();
            for block in &index.blocks {
                let range = block.block_range();
                let samples = metrics_index::block::decode_block(
                    &encoded[range.start as usize..range.end as usize],
                    &block,
                )
                .unwrap();
                decoded.extend(
                    samples
                        .timestamps
                        .into_iter()
                        .zip(samples.value_bits)
                        .map(|(time, value)| (block.hash, time, Some(value))),
                );
            }
            let parquet = sample_rows(data);
            assert_eq!(decoded, parquet);
            actual.extend(parquet);
        }
        assert_eq!(actual, expected);
    }

    #[tokio::test]
    async fn invalid_series_identity_fails_merge() {
        let mut fields = block_schema(None, false).fields().to_vec();
        fields.push(Arc::new(Field::new("zone", DataType::Utf8, false)));
        let schema = Arc::new(Schema::new(fields));
        let rows = (0..6)
            .map(|row| (1, 10 + row * 10, Some((row as f64).to_bits())))
            .collect::<Vec<_>>();
        let mut columns = block_batch(&schema, &rows).columns().to_vec();
        columns[3] = Arc::new(arrow::array::StringArray::from(vec![
            Some("a"),
            Some("b"),
            Some("b"),
            None,
            Some(""),
            Some("b"),
        ]));
        columns[4] = Arc::new(arrow::array::StringArray::from(vec![
            "x", "x", "y", "y", "y", "y",
        ]));
        let batch = RecordBatch::try_new(Arc::clone(&schema), columns).unwrap();
        for format in [FileFormat::Parquet, FileFormat::Vortex] {
            let mut output = block_output();
            output.file_format = format;
            let error = produce(&schema, vec![batch.slice(0, 1), batch.slice(1, 5)], output)
                .await
                .err()
                .expect("invalid series identity must fail the merge");
            assert!(error.to_string().contains("identity label changes"));
        }
    }

    #[tokio::test]
    async fn rotation_preserves_bits_and_fragments_on_disk() {
        let schema = block_schema(Some("preserved".into()), false);
        let rows = vec![
            (1, i64::MIN, Some((-0f64).to_bits())),
            (1, -1, Some(0x7ff8000000000021)),
            (1, 0, Some(f64::INFINITY.to_bits())),
            (1, 0, Some(1f64.to_bits())),
            (1, 10, Some(2f64.to_bits())),
            (2, i64::MIN, Some(f64::NEG_INFINITY.to_bits())),
            (2, i64::MAX, Some(0x7ff8000000000042)),
            (3, i64::MAX, Some(1)),
        ];
        let mut output = block_output();
        output.max_file_size = 129;
        let files = produce(
            &schema,
            vec![
                block_batch(&schema, &rows[..4]),
                block_batch(&schema, &rows[4..7]),
                block_batch(&schema, &rows[7..]),
            ],
            output,
        )
        .await
        .unwrap();
        assert_eq!(files.len(), 3);
        check_block_files(files, &rows).await;
    }

    #[tokio::test]
    async fn single_pass_crosses_real_row_groups_on_disk() {
        let schema = block_schema(None, false);
        let rows = (0..PARQUET_MAX_ROW_GROUP_SIZE + 11)
            .map(|i| (1, i as i64, Some((i as f64).to_bits())))
            .collect::<Vec<_>>();
        let batches = rows
            .chunks(8192)
            .map(|rows| block_batch(&schema, rows))
            .collect();
        let files = produce(&schema, batches, block_output()).await.unwrap();
        assert_eq!(files.len(), 1);
        check_block_files(files, &rows).await;
    }

    #[tokio::test]
    async fn configured_metrics_index_dispatch_controls_block_generation() {
        use config::meta::stream::StreamType;
        use datafusion::datasource::MemTable;

        use super::super::{MergeMode, MergeOutput, merge_parquet_files};

        let schema = block_schema(None, false);
        let rows = [(1, 10, Some(1f64.to_bits())), (1, 20, Some(2f64.to_bits()))];
        let enabled = config::get_config().compact.metrics_index_enabled;
        for configured_format in [FileFormat::Parquet, FileFormat::Vortex] {
            for (ingester, closed_hour) in [(false, true), (false, false), (true, false)] {
                let (mode, output) = if ingester {
                    (
                        MergeMode::for_ingester(StreamType::Metrics, "dispatch", &schema),
                        MergeOutput::for_ingester(StreamType::Metrics),
                    )
                } else {
                    let mut output = MergeOutput::for_compactor(StreamType::Metrics);
                    output.file_format = configured_format;
                    (
                        MergeMode::for_compactor(
                            StreamType::Metrics,
                            "dispatch",
                            &schema,
                            0,
                            closed_hour,
                        ),
                        output,
                    )
                };
                let format = output.file_format;
                let table = Arc::new(
                    MemTable::try_new(schema.clone(), vec![vec![block_batch(&schema, &rows)]])
                        .unwrap(),
                );
                let file = merge_parquet_files(
                    schema.clone(),
                    vec![table],
                    &[],
                    FileMeta {
                        records: 2,
                        original_size: 128,
                        ..Default::default()
                    },
                    &mode,
                    output,
                )
                .await
                .unwrap()
                .files
                .remove(0);
                let (data, meta, path) = file.into_upload_parts().await.unwrap();
                let mut actual = sample_rows_for(format, bytes::Bytes::from(data.clone())).await;
                actual.sort_unstable();
                assert_eq!(actual, rows);
                assert_eq!(path.is_some(), enabled && closed_hour && !ingester);
                if let Some(path) = path {
                    let encoded = tokio::fs::read(path).await.unwrap();
                    assert!(!encoded.starts_with(b"ARROW1"));
                    let parent = metrics_index::block::ParentMetadata {
                        rows: meta.records as u64,
                        compressed_size: data.len() as u64,
                    };
                    let index =
                        metrics_index::block::decode_file(&encoded, &parent, &["tag".into()])
                            .unwrap();
                    let mut decoded_rows = Vec::new();
                    for block in &index.blocks {
                        let range = block.block_range();
                        let decoded = metrics_index::block::decode_block(
                            &encoded[range.start as usize..range.end as usize],
                            &block,
                        )
                        .unwrap();
                        decoded_rows.extend(
                            decoded
                                .timestamps
                                .into_iter()
                                .zip(decoded.value_bits)
                                .map(|(time, value)| (block.hash, time, Some(value))),
                        );
                    }
                    assert_eq!(decoded_rows, rows);
                }
            }
        }
    }

    #[tokio::test]
    async fn open_hour_and_ingester_outputs_do_not_generate_blocks() {
        let schema = block_schema(None, false);
        let rows = [(1, 10, Some(1f64.to_bits()))];
        let ingester =
            super::super::MergeOutput::for_ingester(config::meta::stream::StreamType::Metrics);
        assert_eq!(ingester.file_format, FileFormat::Parquet);
        for format in [FileFormat::Parquet, FileFormat::Vortex] {
            let mut output = block_output();
            output.file_format = format;
            output.layout = MetricsFileLayout::HashMerged;
            let file = produce(&schema, vec![block_batch(&schema, &rows)], output)
                .await
                .unwrap()
                .remove(0);
            let (bytes, _, index) = file.into_upload_parts().await.unwrap();
            assert!(index.is_none());
            assert_eq!(
                sample_rows_for(format, bytes::Bytes::from(bytes)).await,
                rows
            );
        }
    }

    #[tokio::test]
    async fn unsupported_schema_keeps_source_without_index() {
        for format in [FileFormat::Parquet, FileFormat::Vortex] {
            let schema = block_schema(None, true);
            let rows = [(1, 10, Some(1f64.to_bits())), (1, 20, Some(2f64.to_bits()))];

            let mut output = block_output();
            output.file_format = format;
            let file = produce(&schema, vec![block_batch(&schema, &rows)], output)
                .await
                .unwrap()
                .remove(0);
            assert!(matches!(file, MergedFile::MetricsIndexedNoIndex { .. }));
            assert!(file.file_name("example", format).starts_with("indexed-v1-"));
            let (data, meta, path) = file.into_upload_parts().await.unwrap();
            assert!(path.is_none());
            assert_eq!(
                sample_rows_for(format, bytes::Bytes::from(data)).await,
                rows
            );
            assert_eq!(meta.records, 2);
        }
    }

    #[tokio::test]
    async fn otlp_per_point_column_keeps_index() {
        let mut fields = block_schema(None, false).fields().to_vec();
        fields.push(Arc::new(Field::new("start_time", DataType::Utf8, true)));
        let schema = Arc::new(Schema::new(fields));
        let rows = [(1, 10, Some(1f64.to_bits())), (1, 20, Some(2f64.to_bits()))];
        for format in [FileFormat::Parquet, FileFormat::Vortex] {
            let mut output = block_output();
            output.file_format = format;
            let file = produce(&schema, vec![block_batch(&schema, &rows)], output)
                .await
                .unwrap()
                .remove(0);
            assert!(matches!(file, MergedFile::MetricsIndexed { .. }));
        }
    }

    #[tokio::test]
    async fn invalid_samples_fail_merge() {
        for format in [FileFormat::Parquet, FileFormat::Vortex] {
            let schema = block_schema(None, false);
            let rows = [(1, 10, Some(1f64.to_bits())), (2, 20, None)];
            let mut output = block_output();
            output.file_format = format;
            let error = produce(&schema, vec![block_batch(&schema, &rows)], output)
                .await
                .err()
                .expect("invalid samples must fail the merge");
            assert!(error.to_string().contains("nullable samples unsupported"));
        }
    }

    #[test]
    fn million_series_boundary_counts_series_not_samples() {
        let mut split = SeriesSplit::new();
        let hashes = UInt64Array::from_iter_values(0..1_000_000);
        assert_eq!(split.take(&hashes, 0), 1_000_000);
        let next = UInt64Array::from(vec![999_999, 999_999, 1_000_000]);
        assert_eq!(split.take(&next, 0), 2);
        assert_eq!(split.take(&next, 2), 0);
        split.reset();
        assert_eq!(split.take(&next, 2), 1);
        assert_eq!(split.count, 1);
    }

    #[tokio::test]
    async fn single_pass_vortex_blocks_preserve_bits_and_schema() {
        let schema = block_schema(Some("preserved semantic metadata".into()), false);
        let rows = vec![
            (1, 10, Some(0f64.to_bits())),
            (1, 20, Some((-0f64).to_bits())),
            (1, 30, Some(0x7ff8_0000_0000_1234)),
            (2, 10, Some(1)),
            (2, 20, Some(f64::INFINITY.to_bits())),
            (2, 30, Some(f64::NEG_INFINITY.to_bits())),
        ];
        let mut output = block_output();
        output.file_format = FileFormat::Vortex;
        let file = produce(
            &schema,
            vec![
                block_batch(&schema, &rows[..2]),
                block_batch(&schema, &rows[2..]),
            ],
            output,
        )
        .await
        .unwrap()
        .remove(0);
        let (data, _meta, path) = file.into_upload_parts().await.unwrap();
        let encoded = tokio::fs::read(path.unwrap()).await.unwrap();
        let parent = metrics_index::block::ParentMetadata {
            rows: rows.len() as u64,
            compressed_size: data.len() as u64,
        };
        let index = metrics_index::block::decode_file(&encoded, &parent, &["tag".into()]).unwrap();
        assert_eq!(index.row_group_size, None);
        assert_eq!(index.source_schema.as_ref(), schema.as_ref());
        let mut native_rows = Vec::new();
        for block in &index.blocks {
            let range = block.block_range();
            let decoded = metrics_index::block::decode_block(
                &encoded[range.start as usize..range.end as usize],
                &block,
            )
            .unwrap();
            native_rows.extend(
                decoded
                    .timestamps
                    .into_iter()
                    .zip(decoded.value_bits)
                    .map(|(t, v)| (block.hash, t, Some(v))),
            );
        }
        assert_eq!(native_rows, rows);
        let (_, mut reader) = config::utils::parquet::get_recordbatch_reader_from_bytes(
            FileFormat::Vortex,
            bytes::Bytes::from(data.clone()),
        )
        .await
        .unwrap();
        let mut stored_rows = Vec::new();
        while let Some(batch) = reader.try_next().await.unwrap() {
            let hashes = batch
                .column_by_name(HASH_LABEL)
                .unwrap()
                .as_any()
                .downcast_ref::<UInt64Array>()
                .unwrap();
            let times = batch
                .column_by_name(TIMESTAMP_COL_NAME)
                .unwrap()
                .as_any()
                .downcast_ref::<Int64Array>()
                .unwrap();
            let values = batch
                .column_by_name(VALUE_LABEL)
                .unwrap()
                .as_any()
                .downcast_ref::<Float64Array>()
                .unwrap();
            stored_rows.extend((0..batch.num_rows()).map(|i| {
                (
                    hashes.value(i),
                    times.value(i),
                    Some(values.value(i).to_bits()),
                )
            }));
        }
        assert_eq!(stored_rows, rows);
    }

    #[tokio::test]
    async fn single_pass_vortex_splits_data_and_native_indexes_at_batch_boundaries() {
        let schema = block_schema(None, false);
        let rows = (0..20)
            .map(|i| ((i / 5) as u64, i, Some((i as f64).to_bits())))
            .collect::<Vec<_>>();
        let mut output = block_output();
        output.file_format = FileFormat::Vortex;
        output.max_file_size = 129;
        let files = produce(
            &schema,
            rows.chunks(7).map(|r| block_batch(&schema, r)).collect(),
            output,
        )
        .await
        .unwrap();
        assert_eq!(files.len(), 3);
        let mut actual = Vec::new();
        for file in files {
            let (data, meta, path) = file.into_upload_parts().await.unwrap();
            let stored =
                sample_rows_for(FileFormat::Vortex, bytes::Bytes::from(data.clone())).await;
            let encoded = tokio::fs::read(path.unwrap()).await.unwrap();
            let parent = metrics_index::block::ParentMetadata {
                rows: meta.records as u64,
                compressed_size: data.len() as u64,
            };
            let index =
                metrics_index::block::decode_file(&encoded, &parent, &["tag".into()]).unwrap();
            assert_eq!(index.row_group_size, None);
            let mut native = Vec::new();
            for block in &index.blocks {
                let range = block.block_range();
                let payload = metrics_index::block::decode_block(
                    &encoded[range.start as usize..range.end as usize],
                    &block,
                )
                .unwrap();
                native.extend(
                    payload
                        .timestamps
                        .into_iter()
                        .zip(payload.value_bits)
                        .map(|(t, v)| (block.hash, t, Some(v))),
                );
            }
            assert_eq!(native, stored);
            actual.extend(stored);
        }
        assert_eq!(actual, rows);
    }

    #[tokio::test]
    async fn test_size_split_hash_merged_files_carry_no_index() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
        ]));
        let batch = |hashes: Vec<u64>, times: Vec<i64>| {
            RecordBatch::try_new(
                Arc::clone(&schema),
                vec![
                    Arc::new(UInt64Array::from(hashes)),
                    Arc::new(Int64Array::from(times.clone())),
                    Arc::new(Float64Array::from(vec![1.0; times.len()])),
                ],
            )
            .unwrap()
        };
        let metadata = FileMeta {
            min_ts: 10,
            max_ts: 40,
            records: 4,
            original_size: 400,
            compressed_size: 200,
            ..Default::default()
        };
        let (tx, rx) = tokio::sync::mpsc::channel(2);
        tx.send(batch(vec![1, 1], vec![10, 20])).await.unwrap();
        tx.send(batch(vec![2, 3], vec![30, 40])).await.unwrap();
        drop(tx);
        let files = write_files(
            &schema,
            &[],
            &metadata,
            MetricsOutput {
                file_format: FileFormat::Parquet,
                max_file_size: 200,
                layout: MetricsFileLayout::HashMerged,
            },
            rx,
            tokio::spawn(async { Ok(()) }),
        )
        .await
        .unwrap();
        assert_eq!(
            files.len(),
            2,
            "rotates once the first file reaches the size"
        );
        let mut records = 0;
        for file in &files {
            let MergedFile::MetricsHashMerged { data_path, meta } = file else {
                panic!("hash-merged output expected");
            };
            assert!(data_path.is_file());
            assert!(meta.original_size < 200);
            records += meta.records;
            assert_eq!(
                file.file_name("1", FileFormat::Parquet),
                "hash-merged-v1-1.parquet"
            );
        }
        assert_eq!(records, 4);
    }

    #[tokio::test]
    async fn test_size_split_metrics_rotates_at_batch_boundary() {
        for file_format in [FileFormat::Parquet, FileFormat::Vortex] {
            assert_size_split_metrics_rotates_at_batch_boundary(file_format).await;
        }
    }

    async fn assert_size_split_metrics_rotates_at_batch_boundary(file_format: FileFormat) {
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
            Field::new("path", DataType::Utf8View, true),
        ]));
        let batch1 = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(UInt64Array::from(vec![1, 1])),
                Arc::new(Int64Array::from(vec![10, 20])),
                Arc::new(Float64Array::from(vec![1.0, 2.0])),
                Arc::new(StringViewArray::from(vec!["a", "a"])),
            ],
        )
        .unwrap();
        let batch2 = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(UInt64Array::from(vec![1, 2, 2])),
                Arc::new(Int64Array::from(vec![30, 10, 20])),
                Arc::new(Float64Array::from(vec![3.0, 4.0, 5.0])),
                Arc::new(StringViewArray::from(vec!["a", "b", "b"])),
            ],
        )
        .unwrap();
        let batch3 = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(UInt64Array::from(vec![3])),
                Arc::new(Int64Array::from(vec![10])),
                Arc::new(Float64Array::from(vec![6.0])),
                Arc::new(StringViewArray::from(vec!["c"])),
            ],
        )
        .unwrap();
        let metadata = FileMeta {
            min_ts: 10,
            max_ts: 30,
            records: 6,
            original_size: 600,
            compressed_size: 300,
            ..Default::default()
        };
        let (tx, rx) = tokio::sync::mpsc::channel(3);
        tx.send(batch1).await.unwrap();
        tx.send(batch2).await.unwrap();
        tx.send(batch3).await.unwrap();
        drop(tx);

        let max_file_size = 151;
        let files = write_files(
            &schema,
            &[],
            &metadata,
            MetricsOutput {
                file_format,
                max_file_size,
                layout: MetricsFileLayout::Indexed,
            },
            rx,
            tokio::spawn(async { Ok(()) }),
        )
        .await
        .unwrap();

        assert_eq!(files.len(), 3);
        assert_eq!(
            files
                .iter()
                .map(|file| match file {
                    MergedFile::MetricsIndexed { meta, .. } => meta.records,
                    _ => unreachable!(),
                })
                .sum::<i64>(),
            6
        );
        assert_eq!(
            files
                .iter()
                .map(|file| match file {
                    MergedFile::MetricsIndexed { meta, .. } => meta.original_size,
                    _ => unreachable!(),
                })
                .collect::<Vec<_>>(),
            vec![150, 150, 100]
        );
        assert!(files.iter().all(|file| {
            let MergedFile::MetricsIndexed {
                data_path,
                metrics_index_path,
                meta,
                ..
            } = file
            else {
                return false;
            };
            data_path.is_file()
                && metrics_index_path.is_file()
                && meta.original_size < max_file_size as i64
        }));
        assert!(files.iter().all(|file| file.file_name("1", file_format)
            == format!("indexed-v1-1{}", file_format.extension())));

        let mut file_hashes = Vec::new();
        for file in files {
            let MergedFile::MetricsIndexed {
                data_path,
                metrics_index_path,
                meta,
                ..
            } = file
            else {
                unreachable!()
            };
            let persisted_data_path = data_path.to_path_buf();
            let persisted_metrics_index_path = metrics_index_path.to_path_buf();
            let bytes = bytes::Bytes::from(tokio::fs::read(&data_path).await.unwrap());
            drop(data_path);
            assert!(!persisted_data_path.exists());
            match file_format {
                FileFormat::Parquet => {
                    let footer = config::utils::parquet::read_metadata_from_bytes(&bytes)
                        .await
                        .unwrap();
                    assert_eq!(footer.min_ts, meta.min_ts);
                    assert_eq!(footer.max_ts, meta.max_ts);
                    assert_eq!(footer.records, meta.records);
                    assert_eq!(footer.original_size, meta.original_size);
                }
                FileFormat::Vortex => {
                    let session = VortexSession::default().with_tokio();
                    let vxf = session
                        .open_options()
                        .include_metadata()
                        .open_buffer(vortex::buffer::Buffer::from(bytes.to_vec()))
                        .unwrap();
                    assert!(
                        vxf.metadata_segment(config::utils::parquet::VORTEX_FILE_META_KEY)
                            .is_none()
                    );
                }
            }

            let metrics_index = tokio::fs::read(&metrics_index_path).await.unwrap();
            drop(metrics_index_path);
            let parent = metrics_index::block::ParentMetadata {
                rows: meta.records as u64,
                compressed_size: bytes.len() as u64,
            };
            let index =
                metrics_index::block::decode_file(&metrics_index, &parent, &["path".into()])
                    .unwrap();
            assert_eq!(
                index.blocks.row_counts().map(u64::from).sum::<u64>(),
                meta.records as u64
            );
            assert!(!persisted_metrics_index_path.exists());

            let (_, reader) =
                config::utils::parquet::get_recordbatch_reader_from_bytes(file_format, bytes)
                    .await
                    .unwrap();
            let mut hashes_in_file = Vec::new();
            for batch in reader.try_collect::<Vec<_>>().await.unwrap() {
                let hashes = batch
                    .column_by_name(HASH_LABEL)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<UInt64Array>()
                    .unwrap();
                hashes_in_file.extend_from_slice(hashes.values());
            }
            file_hashes.push(hashes_in_file);
        }
        assert_eq!(file_hashes, vec![vec![1, 1], vec![1, 2, 2], vec![3]]);
        assert!(file_hashes[0].contains(&1) && file_hashes[1].contains(&1));
    }
    #[tokio::test]
    async fn parquet_sink_reports_read_only_write_error_and_cleans_up() {
        let (file, path) = new_temp_file().unwrap();
        let observed = path.to_path_buf();
        drop(file);
        let file = tokio::fs::File::from_std(std::fs::File::open(&path).unwrap());
        let mut sink = ParquetSink { file, path };
        let result = async {
            AsyncFileWriter::write(&mut sink, bytes::Bytes::from_static(b"data")).await?;
            AsyncFileWriter::complete(&mut sink).await
        }
        .await;
        assert!(result.is_err());
        drop(sink);
        assert!(!observed.exists());
    }

    #[tokio::test]
    async fn vortex_writer_reports_read_only_output_error() {
        let (file, path) = new_temp_file().unwrap();
        let observed = path.to_path_buf();
        drop(file);
        let schema = block_schema(None, false);
        let session = VortexSession::default().with_tokio();
        let dtype = session.arrow().from_arrow_schema(schema.as_ref()).unwrap();
        let file = tokio::fs::File::from_std(std::fs::File::open(&path).unwrap());
        let mut writer = VortexWriteOptions::new(session.clone())
            .with_strategy(vortex_write_strategy(&session))
            .writer(file, dtype);
        let batch = block_batch(&schema, &[(1, 10, Some(1f64.to_bits()))]);
        let array = session
            .arrow()
            .from_arrow_record_batch(batch, schema.as_ref())
            .unwrap();
        let result = async move {
            writer.push(array).await?;
            writer.finish().await
        }
        .await;
        assert!(result.is_err());
        drop(path);
        assert!(!observed.exists());
    }

    #[tokio::test]
    async fn read_task_drop_aborts_its_upstream() {
        struct Dropped(Option<tokio::sync::oneshot::Sender<()>>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                if let Some(tx) = self.0.take() {
                    let _ = tx.send(());
                }
            }
        }
        let (entered, ready) = tokio::sync::oneshot::channel();
        let (done, closed) = tokio::sync::oneshot::channel();
        let task = ReadTask {
            handle: tokio::spawn(async move {
                let _owned = Dropped(Some(done));
                let _ = entered.send(());
                std::future::pending::<()>().await;
                Ok(())
            }),
        };
        ready.await.unwrap();
        drop(task);
        tokio::time::timeout(std::time::Duration::from_secs(5), closed)
            .await
            .unwrap()
            .unwrap();
    }
}
