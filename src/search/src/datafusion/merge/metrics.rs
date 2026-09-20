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
    array::{Array, Int64Array, RecordBatch},
    compute::{max, min},
};
use config::{
    CompactMergeOutput, FileFormat, PARQUET_MAX_ROW_GROUP_SIZE, TIMESTAMP_COL_NAME,
    meta::stream::FileMeta, utils::parquet::new_parquet_writer,
};
use datafusion::{
    arrow::datatypes::Schema,
    error::{DataFusionError, Result},
};
use futures::future::BoxFuture;
use metrics_index::{MetricsFileLayout, MetricsIndexWriter};
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
    metrics_blocks::{Blocks, GenerationStats},
    new_temp_file,
};
use crate::datafusion::vortex::{VORTEX_RUNTIME, vortex_write_strategy};

struct ReadTask {
    handle: tokio::task::JoinHandle<Result<()>>,
}

impl Drop for ReadTask {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

/// The files a hash-ordered merge is written into: their format, size bound and layout.
#[derive(Debug, Clone)]
pub(super) struct MetricsOutput {
    pub file_format: FileFormat,
    pub max_file_size: usize,
    pub layout: MetricsFileLayout,
    pub sink: CompactMergeOutput,
    pub file_key_prefix: Option<Arc<str>>,
    pub blocks_enabled: bool,
    pub stats: GenerationStats,
}

/// The per-file rotation rule derived from a [`MetricsOutput`] and the schema.
#[derive(Debug, Clone, Copy)]
struct FileSplit {
    max_file_size: i64,
    timestamp_index: usize,
    /// Indexed files carry a `.midx`; hash-merged files do not.
    with_index: bool,
}

struct MetricsFileState {
    metrics_index: Option<MetricsIndexWriter>,
    file_meta: FileMeta,
    timestamp_index: usize,
    row_group_size: Option<usize>,
    stats: GenerationStats,
}

impl MetricsFileState {
    fn try_new(
        schema: &Arc<Schema>,
        timestamp_index: usize,
        row_group_size: Option<usize>,
        with_index: bool,
        stats: GenerationStats,
    ) -> Result<Self> {
        if with_index {
            stats.legacy_build();
        }
        Ok(Self {
            metrics_index: with_index
                .then(|| MetricsIndexWriter::try_new(schema))
                .transpose()?,
            file_meta: FileMeta::default(),
            timestamp_index,
            row_group_size,
            stats,
        })
    }

    fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        if let Some(metrics_index) = self.metrics_index.as_mut() {
            metrics_index.write(batch)?;
        }

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

    fn finish(
        self,
        source_meta: &FileMeta,
        max_file_size: i64,
    ) -> Result<(Option<Vec<u8>>, FileMeta)> {
        let Self {
            metrics_index,
            mut file_meta,
            row_group_size,
            ..
        } = self;

        // below the target so an indexed file never advertises >= max_file_size
        file_meta.original_size =
            proportional_original_size(source_meta, file_meta.records).min(max_file_size - 1);
        let metrics_index = metrics_index
            .map(|index| index.finish(file_meta.records, row_group_size))
            .transpose()?;
        Ok((metrics_index, file_meta))
    }
}

enum ParquetSink {
    Memory(Vec<u8>),
    Disk {
        file: tokio::fs::File,
        path: tempfile::TempPath,
    },
}

impl ParquetSink {
    fn new(sink: CompactMergeOutput, stats: &GenerationStats) -> Result<Self> {
        match sink {
            CompactMergeOutput::Memory => Ok(Self::Memory(Vec::new())),
            CompactMergeOutput::Disk => {
                let (file, path) = new_temp_file()?;
                stats.temp(&path);
                #[cfg(test)]
                let file = if stats
                    .counters
                    .parquet_readonly
                    .load(std::sync::atomic::Ordering::SeqCst)
                {
                    drop(file);
                    tokio::fs::File::from_std(std::fs::File::open(&path)?)
                } else {
                    file
                };
                Ok(Self::Disk { file, path })
            }
        }
    }

    async fn into_path(self, stats: &GenerationStats) -> Result<(tempfile::TempPath, usize)> {
        match self {
            Self::Memory(data) => {
                let size = data.len();
                let path = write_temp_file(data).await?;
                stats.temp(&path);
                Ok((path, size))
            }
            Self::Disk { mut file, path } => {
                file.shutdown().await?;
                let size = usize::try_from(file.metadata().await?.len())
                    .map_err(|e| DataFusionError::External(Box::new(e)))?;
                drop(file);
                Ok((path, size))
            }
        }
    }
}

impl AsyncFileWriter for ParquetSink {
    fn write(&mut self, bytes: bytes::Bytes) -> BoxFuture<'_, parquet::errors::Result<()>> {
        Box::pin(async move {
            match self {
                Self::Memory(data) => data.extend_from_slice(&bytes),
                Self::Disk { file, .. } => file.write_all(&bytes).await?,
            }
            Ok(())
        })
    }
    fn complete(&mut self) -> BoxFuture<'_, parquet::errors::Result<()>> {
        Box::pin(async move {
            if let Self::Disk { file, .. } = self {
                file.flush().await?;
            }
            Ok(())
        })
    }
}

struct ActiveMetricsParquetWriter {
    writer: AsyncArrowWriter<ParquetSink>,
    state: MetricsFileState,
    blocks: Blocks,
    object_key: Option<String>,
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
        let eligible = with_index
            && output.blocks_enabled
            && output.file_key_prefix.is_some()
            && metrics_block::is_supported_schema(schema);
        let object_key = eligible.then(|| {
            format!(
                "{}/{}",
                output.file_key_prefix.as_deref().unwrap(),
                MetricsFileLayout::Indexed
                    .file_name(&config::ider::generate_file_name(), FileFormat::Parquet)
            )
        });
        if object_key
            .as_ref()
            .is_some_and(|key| metrics_block::sidecar_path(key).is_none())
        {
            return Err(DataFusionError::Execution(
                "invalid metrics block destination key".into(),
            ));
        }
        let blocks = if eligible {
            match Blocks::try_new(schema, &output.stats) {
                Ok(blocks) => blocks,
                Err(error) => {
                    log::warn!(
                        "metrics block initialization unavailable; using legacy index: {error}"
                    );
                    Blocks::Disabled
                }
            }
        } else {
            Blocks::Disabled
        };
        let sink = if with_index {
            output.sink
        } else {
            CompactMergeOutput::Disk
        };
        let sink = ParquetSink::new(sink, &output.stats)?;
        let writer = new_parquet_writer(sink, schema, bloom_filter_fields, metadata, false, None);
        let with_legacy = with_index && matches!(blocks, Blocks::Disabled);
        Ok(Self {
            writer,
            state: MetricsFileState::try_new(
                schema,
                timestamp_index,
                Some(PARQUET_MAX_ROW_GROUP_SIZE),
                with_legacy,
                output.stats.clone(),
            )?,
            blocks,
            object_key,
        })
    }

    async fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        self.writer.write(batch).await?;
        self.state.write(batch)?;
        let blocks = std::mem::replace(&mut self.blocks, Blocks::Disabled);
        self.blocks = blocks.write(batch.clone(), &self.state.stats).await?;
        Ok(())
    }

    async fn finish(mut self, source_meta: &FileMeta, max_file_size: i64) -> Result<MergedFile> {
        let stats = self.state.stats.clone();
        let (metrics_index, mut file_meta) = self.state.finish(source_meta, max_file_size)?;
        append_metadata(&mut self.writer, &file_meta)?;
        let parquet_metadata = self.writer.finish().await?;
        let expected_size = self.writer.bytes_written();
        let (data_path, size) = self.writer.into_inner().into_path(&stats).await?;
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
        if matches!(self.blocks, Blocks::Disabled) {
            let mut output = merged_file(data_path, metrics_index, file_meta).await?;
            if let MergedFile::MetricsIndexed {
                object_key,
                metrics_index_path,
                ..
            } = &mut output
            {
                *object_key = self.object_key;
                stats.temp(metrics_index_path);
            }
            Ok(output)
        } else {
            self.blocks
                .finish(
                    data_path,
                    self.object_key.expect("block attempt has an immutable key"),
                    file_meta,
                    parquet_metadata,
                    stats,
                )
                .await
        }
    }
}

struct ActiveMetricsVortexWriter {
    writer: VortexWriter<'static>,
    data_path: tempfile::TempPath,
    state: MetricsFileState,
}

impl ActiveMetricsVortexWriter {
    fn try_new(
        schema: &Arc<Schema>,
        timestamp_index: usize,
        with_index: bool,
        write_options: VortexWriteOptions,
        dtype: DType,
        stats: GenerationStats,
    ) -> Result<Self> {
        let (file, data_path) = new_temp_file()?;
        Ok(Self {
            writer: write_options.writer(file, dtype),
            data_path,
            state: MetricsFileState::try_new(schema, timestamp_index, None, with_index, stats)?,
        })
    }

    async fn write(&mut self, batch: RecordBatch, session: &VortexSession) -> anyhow::Result<()> {
        let schema = batch.schema();
        self.state.write(&batch)?;
        let array: ArrayRef = session
            .arrow()
            .from_arrow_record_batch(batch, schema.as_ref())?;
        self.writer.push(array).await?;
        Ok(())
    }

    async fn finish(
        self,
        source_meta: &FileMeta,
        max_file_size: i64,
    ) -> anyhow::Result<MergedFile> {
        let (metrics_index, file_meta) = self.state.finish(source_meta, max_file_size)?;
        self.writer.finish().await?;
        Ok(merged_file(self.data_path, metrics_index, file_meta).await?)
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
                output.stats,
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

    while let Some(batch) = rx.recv().await {
        if batch.num_rows() == 0 {
            continue;
        }
        if let Some(full) = active.take_if(|writer| {
            proportional_original_size(metadata, writer.state.file_meta.records) >= max_file_size
        }) {
            files.push(full.finish(metadata, max_file_size).await?);
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
        writer.write(&batch).await?;
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
    stats: GenerationStats,
    mut rx: tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: ReadTask,
) -> Result<Vec<MergedFile>> {
    let FileSplit {
        max_file_size,
        timestamp_index,
        with_index,
    } = split;
    let writer_task = VORTEX_RUNTIME.spawn_blocking(move || {
        VORTEX_RUNTIME.block_on(async move {
            let session = VortexSession::default().with_tokio();
            let dtype = session.arrow().from_arrow_schema(schema.as_ref())?;
            let strategy = vortex_write_strategy(&session);
            let mut active: Option<ActiveMetricsVortexWriter> = None;
            let mut files = Vec::new();

            while let Some(batch) = rx.recv().await {
                if batch.num_rows() == 0 {
                    continue;
                }
                if let Some(full) = active.take_if(|writer| {
                    proportional_original_size(&metadata, writer.state.file_meta.records)
                        >= max_file_size
                }) {
                    files.push(full.finish(&metadata, max_file_size).await?);
                }
                let writer = match active.as_mut() {
                    Some(writer) => writer,
                    None => {
                        let write_options = VortexWriteOptions::new(session.clone())
                            .with_strategy(strategy.clone());
                        active.insert(ActiveMetricsVortexWriter::try_new(
                            &schema,
                            timestamp_index,
                            with_index,
                            write_options,
                            dtype.clone(),
                            stats.clone(),
                        )?)
                    }
                };
                writer.write(batch, &session).await?;
            }

            if let Some(active) = active {
                files.push(active.finish(&metadata, max_file_size).await?);
            }
            Ok::<Vec<MergedFile>, anyhow::Error>(files)
        })
    });

    let files = writer_task
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

async fn merged_file(
    data_path: tempfile::TempPath,
    metrics_index: Option<Vec<u8>>,
    meta: FileMeta,
) -> Result<MergedFile> {
    Ok(match metrics_index {
        Some(metrics_index) => MergedFile::MetricsIndexed {
            data_path,
            metrics_index_path: write_temp_file(metrics_index).await?,
            object_key: None,
            meta,
        },
        None => MergedFile::MetricsHashMerged { data_path, meta },
    })
}

async fn write_temp_file(buf: Vec<u8>) -> Result<tempfile::TempPath> {
    let (mut file, path) = new_temp_file()?;
    file.write_all(&buf).await?;
    file.shutdown().await?;
    Ok(path)
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
    use config::meta::promql::{HASH_LABEL, VALUE_LABEL};
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
            fields.push(Field::new("trace_id", DataType::Utf8, true));
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
            columns.push(Arc::new(arrow::array::StringArray::from(vec![
                Some(
                    "per-point"
                );
                rows.len()
            ])));
        }
        RecordBatch::try_new(Arc::clone(schema), columns).unwrap()
    }

    fn block_output(sink: CompactMergeOutput, stats: GenerationStats) -> MetricsOutput {
        MetricsOutput {
            file_format: FileFormat::Parquet,
            max_file_size: 1024 * 1024 * 1024,
            layout: MetricsFileLayout::Indexed,
            sink,
            file_key_prefix: Some(Arc::from("files/single-pass/metrics/m/2026/09/20/00")),
            blocks_enabled: true,
            stats,
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

    async fn check_block_files(
        files: Vec<MergedFile>,
        expected: &[SourceRow],
        stats: &GenerationStats,
    ) {
        use std::sync::atomic::Ordering;
        let count = files.len();
        let mut actual = Vec::new();
        for (position, file) in files.into_iter().enumerate() {
            let key = file
                .file_key(
                    "files/single-pass/metrics/m/2026/09/20/00",
                    "ignored",
                    FileFormat::Parquet,
                )
                .unwrap();
            assert!(
                file.file_key(
                    "files/wrong/metrics/m/2026/09/20/00",
                    "ignored",
                    FileFormat::Parquet
                )
                .is_err()
            );
            let (data, meta, path) = file.into_upload_parts().await.unwrap();
            let data = bytes::Bytes::from(data);
            let encoded = tokio::fs::read(path.unwrap()).await.unwrap();
            let parent = metrics_block::ParentIdentity {
                object_key: key,
                rows: meta.records as u64,
                compressed_size: data.len() as u64,
            };
            let reference =
                metrics_block::build_from_parquet(data.clone(), parent.clone()).unwrap();
            assert_eq!(encoded, reference, "file {position}");
            let footer = metrics_block::read_footer(
                &encoded[encoded.len() - metrics_block::FOOTER_LEN..],
                encoded.len() as u64,
            )
            .unwrap();
            let index = metrics_block::decode_index(
                bytes::Bytes::copy_from_slice(
                    &encoded
                        [footer.metadata_range.start as usize..footer.metadata_range.end as usize],
                ),
                &footer,
                &parent,
                &["tag".into()],
            )
            .unwrap();
            assert_eq!(index.parent.rows, meta.records as u64);
            assert_eq!(
                index.row_group_size,
                Some(meta.records.min(PARQUET_MAX_ROW_GROUP_SIZE as i64) as u32)
            );
            let mut decoded = Vec::new();
            for block in &index.blocks {
                let range = block.payload_range();
                let samples = metrics_block::decode_block(
                    &encoded[range.start as usize..range.end as usize],
                    block,
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
        assert_eq!(stats.counters.block_builds.load(Ordering::SeqCst), count);
        assert_eq!(stats.counters.legacy_builds.load(Ordering::SeqCst), 0);
        assert_eq!(stats.counters.parquet_replays.load(Ordering::SeqCst), 0);
        assert_eq!(stats.counters.fallbacks.load(Ordering::SeqCst), 0);
        assert!(
            stats
                .counters
                .paths
                .lock()
                .unwrap()
                .iter()
                .all(|path| !path.exists())
        );
    }

    #[tokio::test]
    async fn single_pass_rotation_preserves_bits_and_fragments_without_legacy_or_replay() {
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
        for sink in [CompactMergeOutput::Memory, CompactMergeOutput::Disk] {
            let stats = GenerationStats::default();
            let mut output = block_output(sink, stats.clone());
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
            check_block_files(files, &rows, &stats).await;
        }
    }

    #[tokio::test]
    async fn single_pass_crosses_real_row_groups_in_both_sinks() {
        let schema = block_schema(None, false);
        let rows = (0..PARQUET_MAX_ROW_GROUP_SIZE + 11)
            .map(|i| (1, i as i64, Some((i as f64).to_bits())))
            .collect::<Vec<_>>();
        for sink in [CompactMergeOutput::Memory, CompactMergeOutput::Disk] {
            let stats = GenerationStats::default();
            let batches = rows
                .chunks(8192)
                .map(|rows| block_batch(&schema, rows))
                .collect();
            let files = produce(&schema, batches, block_output(sink, stats.clone()))
                .await
                .unwrap();
            assert_eq!(files.len(), 1);
            check_block_files(files, &rows, &stats).await;
        }
    }

    #[tokio::test]
    async fn single_pass_selects_legacy_directly_when_disabled_or_schema_unsupported() {
        use std::sync::atomic::Ordering;
        for (enabled, unsupported) in [(false, false), (true, true)] {
            let schema = block_schema(None, unsupported);
            let rows = [(1, 10, Some(1f64.to_bits())), (1, 20, Some(2f64.to_bits()))];
            let stats = GenerationStats::default();
            let mut output = block_output(CompactMergeOutput::Disk, stats.clone());
            output.blocks_enabled = enabled;
            let file = produce(&schema, vec![block_batch(&schema, &rows)], output)
                .await
                .unwrap()
                .remove(0);
            let (data, meta, path) = file.into_upload_parts().await.unwrap();
            assert!(
                tokio::fs::read(path.unwrap())
                    .await
                    .unwrap()
                    .starts_with(b"ARROW1")
            );
            assert_eq!(sample_rows(bytes::Bytes::from(data)), rows);
            assert_eq!(meta.records, 2);
            assert_eq!(stats.counters.legacy_builds.load(Ordering::SeqCst), 1);
            assert_eq!(stats.counters.block_builds.load(Ordering::SeqCst), 0);
            assert_eq!(stats.counters.parquet_replays.load(Ordering::SeqCst), 0);
        }
    }

    #[tokio::test]
    async fn single_pass_replays_only_after_midstream_or_finish_capacity_failure() {
        use std::sync::atomic::Ordering;
        for finish_failure in [false, true] {
            let schema = block_schema(finish_failure.then(|| "x".repeat(1024 * 1024 + 128)), false);
            let rows = [
                (1, 10, Some(1f64.to_bits())),
                (2, 10, Some((-0f64).to_bits())),
                (
                    2,
                    20,
                    if finish_failure {
                        Some(2f64.to_bits())
                    } else {
                        None
                    },
                ),
            ];
            for sink in [CompactMergeOutput::Memory, CompactMergeOutput::Disk] {
                let stats = GenerationStats::default();
                let file = produce(
                    &schema,
                    vec![
                        block_batch(&schema, &rows[..2]),
                        block_batch(&schema, &rows[2..]),
                    ],
                    block_output(sink, stats.clone()),
                )
                .await
                .unwrap()
                .remove(0);
                let (data, meta, path) = file.into_upload_parts().await.unwrap();
                let index = tokio::fs::read(path.unwrap()).await.unwrap();
                assert!(index.starts_with(b"ARROW1"));
                let reader =
                    arrow::ipc::reader::FileReader::try_new(std::io::Cursor::new(index), None)
                        .unwrap();
                let covered = reader
                    .map(|batch| {
                        let batch = batch.unwrap();
                        batch
                            .column(0)
                            .as_any()
                            .downcast_ref::<arrow::array::UInt32Array>()
                            .unwrap()
                            .values()
                            .iter()
                            .map(|v| *v as u64)
                            .sum::<u64>()
                    })
                    .sum::<u64>();
                assert_eq!(covered, meta.records as u64);
                assert_eq!(sample_rows(bytes::Bytes::from(data)), rows);
                assert_eq!(stats.counters.block_builds.load(Ordering::SeqCst), 1);
                assert_eq!(stats.counters.legacy_builds.load(Ordering::SeqCst), 1);
                assert_eq!(stats.counters.parquet_replays.load(Ordering::SeqCst), 1);
                assert_eq!(stats.counters.fallbacks.load(Ordering::SeqCst), 1);
                assert!(
                    stats
                        .counters
                        .paths
                        .lock()
                        .unwrap()
                        .iter()
                        .all(|path| !path.exists())
                );
            }
        }
    }

    #[tokio::test]
    async fn single_pass_vortex_uses_legacy_without_attempting_blocks() {
        use std::sync::atomic::Ordering;
        let schema = block_schema(None, false);
        let stats = GenerationStats::default();
        let mut output = block_output(CompactMergeOutput::Disk, stats.clone());
        output.file_format = FileFormat::Vortex;
        let file = produce(
            &schema,
            vec![block_batch(&schema, &[(1, 10, Some(1f64.to_bits()))])],
            output,
        )
        .await
        .unwrap()
        .remove(0);
        let (_, meta, path) = file.into_upload_parts().await.unwrap();
        assert_eq!(meta.records, 1);
        assert!(
            tokio::fs::read(path.unwrap())
                .await
                .unwrap()
                .starts_with(b"ARROW1")
        );
        assert_eq!(stats.counters.legacy_builds.load(Ordering::SeqCst), 1);
        assert_eq!(stats.counters.block_builds.load(Ordering::SeqCst), 0);
        assert_eq!(stats.counters.parquet_replays.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn single_pass_parquet_io_failure_does_not_trigger_successful_fallback() {
        use std::sync::atomic::Ordering;
        let schema = block_schema(None, false);
        let stats = GenerationStats::default();
        stats
            .counters
            .parquet_readonly
            .store(true, Ordering::SeqCst);
        let result = produce(
            &schema,
            vec![block_batch(&schema, &[(1, 10, Some(1f64.to_bits()))])],
            block_output(CompactMergeOutput::Disk, stats.clone()),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(stats.counters.block_builds.load(Ordering::SeqCst), 1);
        assert_eq!(stats.counters.legacy_builds.load(Ordering::SeqCst), 0);
        assert_eq!(stats.counters.parquet_replays.load(Ordering::SeqCst), 0);
        assert_eq!(stats.counters.fallbacks.load(Ordering::SeqCst), 0);
        assert!(
            stats
                .counters
                .paths
                .lock()
                .unwrap()
                .iter()
                .all(|path| !path.exists())
        );
    }

    #[tokio::test]
    async fn single_pass_cancellation_keeps_running_block_job_paths_owned_until_exit() {
        struct ReaderDropped(Option<tokio::sync::oneshot::Sender<()>>);
        impl Drop for ReaderDropped {
            fn drop(&mut self) {
                if let Some(tx) = self.0.take() {
                    let _ = tx.send(());
                }
            }
        }
        for sink in [CompactMergeOutput::Memory, CompactMergeOutput::Disk] {
            let schema = block_schema(None, false);
            let stats = GenerationStats::default();
            let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = std::sync::mpsc::channel();
            *stats.counters.block_gate.lock().unwrap() = Some((entered_tx, release_rx));
            let (reader_tx, reader_rx) = tokio::sync::oneshot::channel();
            let (tx, rx) = tokio::sync::mpsc::channel(2);
            let batch = block_batch(
                &schema,
                &[(1, 10, Some(1f64.to_bits())), (2, 10, Some(2f64.to_bits()))],
            );
            let read_task = tokio::spawn(async move {
                let _dropped = ReaderDropped(Some(reader_tx));
                tx.send(batch).await.unwrap();
                std::future::pending::<()>().await;
                Ok(())
            });
            let output = block_output(sink, stats.clone());
            let producer = tokio::spawn(async move {
                write_files(
                    &schema,
                    &[],
                    &FileMeta {
                        records: 2,
                        original_size: 128,
                        ..Default::default()
                    },
                    output,
                    rx,
                    read_task,
                )
                .await
            });
            entered_rx.await.unwrap();
            producer.abort();
            assert!(matches!(producer.await,Err(error) if error.is_cancelled()));
            tokio::time::timeout(std::time::Duration::from_secs(5), reader_rx)
                .await
                .unwrap()
                .unwrap();
            let paths = stats.counters.paths.lock().unwrap().clone();
            assert!(paths[0].exists());
            release_tx.send(()).unwrap();
            tokio::time::timeout(std::time::Duration::from_secs(5), async {
                while paths.iter().any(|path| path.exists()) {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .unwrap();
        }
    }

    /// An open-hour round writes the same size-split, hash-ordered files without a `.midx`.
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
                sink: CompactMergeOutput::Disk,
                file_key_prefix: None,
                blocks_enabled: false,
                stats: GenerationStats::default(),
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
                sink: CompactMergeOutput::Disk,
                file_key_prefix: None,
                blocks_enabled: false,
                stats: GenerationStats::default(),
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
            assert!(!metrics_index.is_empty());
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
}
