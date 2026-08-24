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
    FileFormat, TIMESTAMP_COL_NAME, meta::stream::FileMeta, utils::parquet::new_parquet_writer,
};
use datafusion::{
    arrow::datatypes::Schema,
    error::{DataFusionError, Result},
};
use metrics_index::MetricsIndexWriter;
use parquet::arrow::AsyncArrowWriter;
use tokio::io::AsyncWriteExt;
use vortex::{
    VortexSessionDefault,
    array::ArrayRef,
    arrow::{FromArrowArray, FromArrowType},
    dtype::DType,
    file::VortexWriteOptions,
    io::session::RuntimeSessionExt,
    session::VortexSession,
};

use super::{MergedFile, append_metadata};
use crate::datafusion::vortex::{VORTEX_RUNTIME, vortex_write_strategy};

/// Write a globally hash-sorted metrics stream into size-bounded files.
/// Rotation happens between input record batches. File and row-group
/// boundaries deliberately remain independent of metrics series boundaries.
pub(super) async fn write_files(
    schema: &Arc<Schema>,
    bloom_filter_fields: &[String],
    metadata: &FileMeta,
    file_format: FileFormat,
    max_file_size: usize,
    rx: &mut tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: tokio::task::JoinHandle<Result<()>>,
) -> Result<Vec<MergedFile>> {
    let timestamp_index = schema.index_of(TIMESTAMP_COL_NAME).map_err(|e| {
        DataFusionError::Plan(format!(
            "indexed metrics layout requires {TIMESTAMP_COL_NAME}: {e}"
        ))
    })?;
    let max_file_size = i64::try_from(max_file_size).unwrap_or(i64::MAX).max(1);
    let mut active: Option<ActiveIndexedMetricsWriter> = None;
    let mut files: Vec<MergedFile> = Vec::new();

    while let Some(batch) = rx.recv().await {
        if batch.num_rows() == 0 {
            continue;
        }
        // rotate between input batches once the logical size target is reached
        if let Some(full) = active.take_if(|writer| {
            proportional_original_size(metadata, writer.file_meta.records) >= max_file_size
        }) {
            files.push(full.finish(metadata, max_file_size).await?);
        }
        let writer = match active.as_mut() {
            Some(writer) => writer,
            None => active.insert(ActiveIndexedMetricsWriter::try_new(
                schema,
                bloom_filter_fields,
                metadata,
                file_format,
                timestamp_index,
            )?),
        };
        writer.write(&batch).await?;
    }

    read_task
        .await
        .map_err(|e| DataFusionError::External(Box::new(e)))??;
    if let Some(active) = active.take() {
        files.push(active.finish(metadata, max_file_size).await?);
    }
    if files.is_empty() {
        return Err(DataFusionError::Execution(
            "indexed metrics merge produced no rows".to_string(),
        ));
    }

    Ok(files)
}

/// One output file in progress: its format-specific data writer, `.midx`
/// metrics-index writer and running file meta.
struct ActiveIndexedMetricsWriter {
    data_writer: IndexedDataWriter,
    metrics_index: MetricsIndexWriter,
    file_meta: FileMeta,
    timestamp_index: usize,
}

impl ActiveIndexedMetricsWriter {
    fn try_new(
        schema: &Arc<Schema>,
        bloom_filter_fields: &[String],
        metadata: &FileMeta,
        file_format: FileFormat,
        timestamp_index: usize,
    ) -> Result<Self> {
        let data_writer =
            IndexedDataWriter::try_new(schema, bloom_filter_fields, metadata, file_format)?;
        Ok(Self {
            data_writer,
            metrics_index: MetricsIndexWriter::try_new(schema)?,
            file_meta: FileMeta::default(),
            timestamp_index,
        })
    }

    /// Append one (hash, ts)-ordered batch to the data file, its runs to the
    /// metrics index and its rows / time range to the file meta.
    async fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        self.data_writer.write(batch).await?;
        self.metrics_index.write(batch)?;

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

    async fn finish(self, source_meta: &FileMeta, max_file_size: i64) -> Result<MergedFile> {
        let Self {
            data_writer,
            metrics_index,
            mut file_meta,
            ..
        } = self;

        // below the target so an indexed file never advertises >= max_file_size
        file_meta.original_size =
            proportional_original_size(source_meta, file_meta.records).min(max_file_size - 1);
        let data_path = data_writer.finish(&file_meta).await?;

        // compressed_size is set by the compactor when it uploads the file
        Ok(MergedFile::MetricsIndexed {
            data_path,
            metrics_index_path: write_temp_file(metrics_index.finish()?).await?,
            meta: file_meta,
        })
    }
}

enum IndexedDataWriter {
    Parquet(Box<IndexedParquetWriter>),
    Vortex(IndexedVortexWriter),
}

impl IndexedDataWriter {
    fn try_new(
        schema: &Arc<Schema>,
        bloom_filter_fields: &[String],
        metadata: &FileMeta,
        file_format: FileFormat,
    ) -> Result<Self> {
        match file_format {
            FileFormat::Parquet => Ok(Self::Parquet(Box::new(IndexedParquetWriter::try_new(
                schema,
                bloom_filter_fields,
                metadata,
            )?))),
            FileFormat::Vortex => Ok(Self::Vortex(IndexedVortexWriter::try_new(schema)?)),
        }
    }

    async fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        match self {
            Self::Parquet(writer) => writer.write(batch).await,
            Self::Vortex(writer) => writer.write(batch).await,
        }
    }

    async fn finish(self, file_meta: &FileMeta) -> Result<tempfile::TempPath> {
        match self {
            Self::Parquet(writer) => (*writer).finish(file_meta).await,
            Self::Vortex(writer) => writer.finish().await,
        }
    }
}

/// Parquet keeps its writer in the merge task and appends the exact output
/// metadata when the active file rotates.
struct IndexedParquetWriter {
    writer: AsyncArrowWriter<tokio::fs::File>,
    data_path: tempfile::TempPath,
}

impl IndexedParquetWriter {
    fn try_new(
        schema: &Arc<Schema>,
        bloom_filter_fields: &[String],
        metadata: &FileMeta,
    ) -> Result<Self> {
        let (file, data_path) = new_temp_file()?;
        let writer = new_parquet_writer(file, schema, bloom_filter_fields, metadata, false, None);
        Ok(Self { writer, data_path })
    }

    async fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        self.writer.write(batch).await.map_err(Into::into)
    }

    async fn finish(mut self, file_meta: &FileMeta) -> Result<tempfile::TempPath> {
        append_metadata(&mut self.writer, file_meta)?;
        self.writer.finish().await?;
        drop(self.writer.into_inner());
        Ok(self.data_path)
    }
}

/// Vortex runs on its dedicated runtime and receives Arrow batches through a
/// bounded channel, matching the existing merge Vortex writer. Metrics Vortex
/// files intentionally have no embedded `o2_file_meta`; file-list owns the
/// exact metadata calculated when the active file rotates.
struct IndexedVortexWriter {
    tx: tokio::sync::mpsc::Sender<RecordBatch>,
    writer_task: tokio::task::JoinHandle<anyhow::Result<()>>,
    data_path: tempfile::TempPath,
}

impl IndexedVortexWriter {
    fn try_new(schema: &Arc<Schema>) -> Result<Self> {
        let (file, data_path) = new_temp_file()?;
        let (tx, mut rx) = tokio::sync::mpsc::channel::<RecordBatch>(2);
        let schema = Arc::clone(schema);
        let writer_task = VORTEX_RUNTIME.spawn_blocking(move || {
            VORTEX_RUNTIME.block_on(async move {
                let session = VortexSession::default().with_tokio();
                let dtype = DType::from_arrow(schema.as_ref());
                let write_options =
                    VortexWriteOptions::new(session).with_strategy(vortex_write_strategy());
                let mut writer = write_options.writer(file, dtype);

                while let Some(batch) = rx.recv().await {
                    let array: ArrayRef = ArrayRef::from_arrow(batch, false)?;
                    writer.push(array).await?;
                }
                writer.finish().await?;
                Ok::<(), anyhow::Error>(())
            })
        });
        Ok(Self {
            tx,
            writer_task,
            data_path,
        })
    }

    async fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        self.tx
            .send(batch.clone())
            .await
            .map_err(|e| DataFusionError::Execution(format!("Vortex writer channel closed: {e}")))
    }

    async fn finish(self) -> Result<tempfile::TempPath> {
        drop(self.tx);
        self.writer_task
            .await
            .map_err(|e| DataFusionError::Execution(format!("Vortex runtime task failed: {e}")))?
            .map_err(|e| DataFusionError::Execution(format!("Failed to write vortex file: {e}")))?;
        Ok(self.data_path)
    }
}

fn new_temp_file() -> Result<(tokio::fs::File, tempfile::TempPath)> {
    // spool under data_tmp_dir, not the OS temp dir (often a RAM-backed
    // tmpfs); it is wiped at startup, reclaiming files a crash orphaned
    let tmp_dir = &config::get_config().common.data_tmp_dir;
    std::fs::create_dir_all(tmp_dir)?;
    let (file, path) = tempfile::NamedTempFile::new_in(tmp_dir)?.into_parts();
    Ok((tokio::fs::File::from_std(file), path))
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
        let (tx, mut rx) = tokio::sync::mpsc::channel(3);
        tx.send(batch1).await.unwrap();
        tx.send(batch2).await.unwrap();
        tx.send(batch3).await.unwrap();
        drop(tx);

        let max_file_size = 151;
        let files = write_files(
            &schema,
            &[],
            &metadata,
            file_format,
            max_file_size,
            &mut rx,
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
