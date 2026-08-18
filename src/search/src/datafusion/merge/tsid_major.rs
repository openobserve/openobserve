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
    array::{Array, ArrayRef as ArrowArrayRef, Int64Array, RecordBatch, UInt32Array, UInt64Array},
    compute::{concat_batches, take},
    datatypes::{DataType, Field},
    ipc::{
        CompressionType,
        writer::{FileWriter as ArrowFileWriter, IpcWriteOptions},
    },
};
use config::{
    TIMESTAMP_COL_NAME,
    meta::{
        promql::{
            EXEMPLARS_LABEL, HASH_LABEL, MetricsFileLayout, TSID_SERIES_INDEX_ROW_COUNT,
            TSID_SERIES_INDEX_ROW_START, VALUE_LABEL,
        },
        stream::FileMeta,
    },
    utils::parquet::new_parquet_writer,
};
use datafusion::{
    arrow::datatypes::Schema,
    error::{DataFusionError, Result},
};
use parquet::arrow::AsyncArrowWriter;

use super::{MergedFile, append_metadata};

/// Write a globally hash-sorted metrics stream into size-bounded files.
/// Rotation happens between input record batches. File and row-group
/// boundaries deliberately remain independent of TSID boundaries.
pub(super) async fn write_files(
    schema: &Arc<Schema>,
    bloom_filter_fields: &[String],
    metadata: &FileMeta,
    max_file_size: usize,
    rx: &mut tokio::sync::mpsc::Receiver<RecordBatch>,
    read_task: tokio::task::JoinHandle<Result<()>>,
) -> Result<Vec<MergedFile>> {
    let hash_index = schema.index_of(HASH_LABEL).map_err(|e| {
        DataFusionError::Plan(format!("TSID-major layout requires {HASH_LABEL}: {e}"))
    })?;
    let timestamp_index = schema.index_of(TIMESTAMP_COL_NAME).map_err(|e| {
        DataFusionError::Plan(format!(
            "TSID-major layout requires {TIMESTAMP_COL_NAME}: {e}"
        ))
    })?;
    let max_file_size = max_file_size.max(1);
    let mut active: Option<ActiveSizeTsidWriter> = None;
    let mut previous_hash = None;
    let mut files: Vec<MergedFile> = Vec::new();
    let mut rows_written = 0_i64;

    while let Some(batch) = rx.recv().await {
        let hashes = batch
            .column(hash_index)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .ok_or_else(|| {
                DataFusionError::Plan(format!("TSID-major layout requires UInt64 {HASH_LABEL}"))
            })?;
        let timestamps = batch
            .column(timestamp_index)
            .as_any()
            .downcast_ref::<Int64Array>()
            .ok_or_else(|| {
                DataFusionError::Plan(format!(
                    "TSID-major layout requires Int64 {TIMESTAMP_COL_NAME}"
                ))
            })?;

        if batch.num_rows() == 0 {
            continue;
        }
        if hashes.is_null(0) {
            return Err(DataFusionError::Execution(format!(
                "TSID-major layout found null {HASH_LABEL}"
            )));
        }

        let mut last_hash = previous_hash;
        for row in 0..batch.num_rows() {
            if hashes.is_null(row) {
                return Err(DataFusionError::Execution(format!(
                    "TSID-major layout found null {HASH_LABEL}"
                )));
            }
            let hash = hashes.value(row);
            if last_hash.is_some_and(|previous| hash < previous) {
                return Err(DataFusionError::Execution(format!(
                    "TSID-major merge output is not ordered: previous hash {last_hash:?}, current hash {hash}"
                )));
            }
            last_hash = Some(hash);
        }

        let rotate = active
            .as_ref()
            .is_some_and(|writer| writer.estimated_original_size(metadata) >= max_file_size);
        if rotate {
            files.push(active.take().unwrap().finish().await?);
        }

        if active.is_none() {
            active = Some(ActiveSizeTsidWriter::try_new(
                schema,
                bloom_filter_fields,
                metadata,
            )?);
        }

        write_size_tsid_slice(
            active.as_mut().unwrap(),
            &batch,
            hashes,
            timestamps,
            0,
            batch.num_rows(),
        )
        .await?;
        rows_written += batch.num_rows() as i64;
        previous_hash = last_hash;
    }

    read_task
        .await
        .map_err(|e| DataFusionError::External(Box::new(e)))??;
    if let Some(active) = active.take() {
        files.push(active.finish().await?);
    }
    if files.is_empty() {
        return Err(DataFusionError::Execution(
            "TSID-major merge produced no rows".to_string(),
        ));
    }

    assign_tsid_file_sizes(metadata, rows_written, &mut files);
    Ok(files)
}

async fn write_size_tsid_slice(
    active: &mut ActiveSizeTsidWriter,
    batch: &RecordBatch,
    hashes: &UInt64Array,
    timestamps: &Int64Array,
    start: usize,
    end: usize,
) -> Result<()> {
    active
        .writer
        .write(&batch.slice(start, end - start))
        .await?;
    active.series_index.write_slice(batch, hashes, start, end)?;
    update_tsid_file_meta(&mut active.file_meta, timestamps, start, end);
    Ok(())
}

struct ActiveSizeTsidWriter {
    writer: AsyncArrowWriter<Vec<u8>>,
    file_meta: FileMeta,
    series_index: TsidSeriesIndexWriter,
}

impl ActiveSizeTsidWriter {
    fn try_new(
        schema: &Arc<Schema>,
        bloom_filter_fields: &[String],
        metadata: &FileMeta,
    ) -> Result<Self> {
        let writer = new_parquet_writer(
            Vec::new(),
            schema,
            bloom_filter_fields,
            metadata,
            false,
            None,
        );
        let series_index = TsidSeriesIndexWriter::try_new(schema)?;
        Ok(Self {
            writer,
            file_meta: empty_tsid_file_meta(metadata),
            series_index,
        })
    }

    fn estimated_original_size(&self, source_meta: &FileMeta) -> usize {
        let estimate = (i128::from(source_meta.original_size.max(0))
            * i128::from(self.file_meta.records))
            / i128::from(source_meta.records.max(1));
        usize::try_from(estimate).unwrap_or(usize::MAX)
    }

    async fn finish(self) -> Result<MergedFile> {
        let Self {
            mut writer,
            file_meta,
            series_index,
        } = self;
        append_metadata(&mut writer, &file_meta)?;
        writer.finish().await?;
        Ok(MergedFile {
            buf: writer.into_inner(),
            meta: file_meta,
            layout: MetricsFileLayout::TsidMajor,
            series_index: Some(series_index.finish()?),
        })
    }
}

fn empty_tsid_file_meta(metadata: &FileMeta) -> FileMeta {
    let mut file_meta = metadata.clone();
    file_meta.min_ts = 0;
    file_meta.max_ts = 0;
    file_meta.records = 0;
    file_meta.original_size = 0;
    file_meta.compressed_size = 0;
    file_meta.index_size = 0;
    file_meta
}

fn update_tsid_file_meta(
    file_meta: &mut FileMeta,
    timestamps: &Int64Array,
    start: usize,
    end: usize,
) {
    let first_timestamp = file_meta.records == 0;
    file_meta.records += (end - start) as i64;
    for row in start..end {
        if timestamps.is_null(row) {
            continue;
        }
        let timestamp = timestamps.value(row);
        if first_timestamp && file_meta.min_ts == 0 && file_meta.max_ts == 0 {
            file_meta.min_ts = timestamp;
            file_meta.max_ts = timestamp;
        } else {
            file_meta.min_ts = file_meta.min_ts.min(timestamp);
            file_meta.max_ts = file_meta.max_ts.max(timestamp);
        }
    }
}

/// Split the logical `original_size` of the input over the output files by
/// row count (the last file takes the remainder) and record the physical size.
fn assign_tsid_file_sizes(source_meta: &FileMeta, rows_written: i64, files: &mut [MergedFile]) {
    let denominator = rows_written.max(1) as i128;
    let mut assigned_original_size = 0_i64;
    let file_count = files.len();
    for (index, file) in files.iter_mut().enumerate() {
        file.meta.original_size = if index + 1 == file_count {
            source_meta.original_size - assigned_original_size
        } else {
            ((i128::from(source_meta.original_size) * i128::from(file.meta.records)) / denominator)
                as i64
        };
        assigned_original_size += file.meta.original_size;
        file.meta.compressed_size = file.buf.len() as i64;
    }
}

/// Streaming writer for a TSID-major sidecar. Every row describes one
/// contiguous TSID run in the sibling data file. Runs that cross an input
/// RecordBatch boundary may appear as two adjacent entries; query-time range
/// coalescing makes that representation equivalent without buffering samples.
struct TsidSeriesIndexWriter {
    writer: ArrowFileWriter<Vec<u8>>,
    schema: Arc<Schema>,
    label_indices: Vec<usize>,
    rows_written: u64,
    pending_batches: Vec<RecordBatch>,
    pending_rows: usize,
}

const TSID_SERIES_INDEX_BATCH_ROWS: usize = 4096;

impl TsidSeriesIndexWriter {
    fn try_new(source_schema: &Arc<Schema>) -> Result<Self> {
        let label_indices = source_schema
            .fields()
            .iter()
            .enumerate()
            .filter_map(|(index, field)| {
                (!matches!(
                    field.name().as_str(),
                    TIMESTAMP_COL_NAME | VALUE_LABEL | EXEMPLARS_LABEL
                ))
                .then_some(index)
            })
            .collect::<Vec<_>>();

        let mut fields = vec![
            Arc::new(Field::new(
                TSID_SERIES_INDEX_ROW_START,
                DataType::UInt64,
                false,
            )),
            Arc::new(Field::new(
                TSID_SERIES_INDEX_ROW_COUNT,
                DataType::UInt32,
                false,
            )),
        ];
        fields.extend(
            label_indices
                .iter()
                .map(|index| source_schema.fields()[*index].clone()),
        );
        let schema = Arc::new(Schema::new(fields));
        let options =
            IpcWriteOptions::default().try_with_compression(Some(CompressionType::ZSTD))?;
        let writer = ArrowFileWriter::try_new_with_options(Vec::new(), &schema, options)?;
        Ok(Self {
            writer,
            schema,
            label_indices,
            rows_written: 0,
            pending_batches: Vec::new(),
            pending_rows: 0,
        })
    }

    fn write_slice(
        &mut self,
        batch: &RecordBatch,
        hashes: &UInt64Array,
        start: usize,
        end: usize,
    ) -> Result<()> {
        let mut first_rows = Vec::new();
        let mut row_starts = Vec::new();
        let mut row_counts = Vec::new();
        let mut run_start = start;
        while run_start < end {
            let hash = hashes.value(run_start);
            let mut run_end = run_start + 1;
            while run_end < end && hashes.value(run_end) == hash {
                run_end += 1;
            }
            first_rows.push(u32::try_from(run_start).map_err(|_| {
                DataFusionError::Execution("metrics batch exceeds u32 row index".to_string())
            })?);
            row_starts.push(self.rows_written + (run_start - start) as u64);
            row_counts.push(u32::try_from(run_end - run_start).map_err(|_| {
                DataFusionError::Execution("TSID run exceeds u32 row count".to_string())
            })?);
            run_start = run_end;
        }

        let indices = UInt32Array::from(first_rows);
        let mut columns: Vec<ArrowArrayRef> = vec![
            Arc::new(UInt64Array::from(row_starts)),
            Arc::new(UInt32Array::from(row_counts)),
        ];
        for index in &self.label_indices {
            columns.push(take(batch.column(*index).as_ref(), &indices, None)?);
        }
        let sidecar_batch = RecordBatch::try_new(Arc::clone(&self.schema), columns)?;
        self.pending_rows += sidecar_batch.num_rows();
        self.pending_batches.push(sidecar_batch);
        if self.pending_rows >= TSID_SERIES_INDEX_BATCH_ROWS {
            self.flush_pending()?;
        }
        self.rows_written += (end - start) as u64;
        Ok(())
    }

    fn flush_pending(&mut self) -> Result<()> {
        if self.pending_batches.is_empty() {
            return Ok(());
        }
        let batch = concat_batches(&self.schema, &self.pending_batches)?;
        self.writer.write(&batch)?;
        self.pending_batches.clear();
        self.pending_rows = 0;
        Ok(())
    }

    fn finish(mut self) -> Result<Vec<u8>> {
        self.flush_pending()?;
        Ok(self.writer.into_inner()?)
    }
}

#[cfg(test)]
mod tests {
    use std::{io::Cursor, sync::Arc};

    use arrow::{
        array::{Float64Array, Int64Array, StringViewArray},
        ipc::reader::FileReader as ArrowFileReader,
    };
    use arrow_schema::{DataType, Field, Schema};
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

    use super::*;

    #[tokio::test]
    async fn test_size_split_tsid_major_rotates_at_batch_boundary() {
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

        let files = write_files(
            &schema,
            &[],
            &metadata,
            1,
            &mut rx,
            tokio::spawn(async { Ok(()) }),
        )
        .await
        .unwrap();

        assert_eq!(files.len(), 3);
        assert_eq!(files.iter().map(|f| f.meta.records).sum::<i64>(), 6);
        assert_eq!(
            files
                .iter()
                .map(|f| f.meta.original_size)
                .collect::<Vec<_>>(),
            vec![200, 300, 100]
        );
        assert!(files.iter().all(|f| {
            f.layout == MetricsFileLayout::TsidMajor
                && f.series_index.is_some()
                && f.meta.compressed_size == f.buf.len() as i64
        }));

        let mut file_hashes = Vec::new();
        for file in files {
            let reader = ParquetRecordBatchReaderBuilder::try_new(bytes::Bytes::from(file.buf))
                .unwrap()
                .build()
                .unwrap();
            let mut hashes_in_file = Vec::new();
            for batch in reader {
                let batch = batch.unwrap();
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

    #[test]
    fn test_tsid_series_index_records_exact_parquet_ranges() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
            Field::new("path", DataType::Utf8View, true),
        ]));
        let batch1 = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(UInt64Array::from(vec![1, 1, 2])),
                Arc::new(Int64Array::from(vec![10, 20, 10])),
                Arc::new(Float64Array::from(vec![1.0, 2.0, 3.0])),
                Arc::new(StringViewArray::from(vec!["a", "a", "b"])),
            ],
        )
        .unwrap();
        let batch2 = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(UInt64Array::from(vec![2, 3])),
                Arc::new(Int64Array::from(vec![20, 10])),
                Arc::new(Float64Array::from(vec![4.0, 5.0])),
                Arc::new(StringViewArray::from(vec!["b", "c"])),
            ],
        )
        .unwrap();

        let mut writer = TsidSeriesIndexWriter::try_new(&schema).unwrap();
        writer
            .write_slice(
                &batch1,
                batch1
                    .column_by_name(HASH_LABEL)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<UInt64Array>()
                    .unwrap(),
                0,
                batch1.num_rows(),
            )
            .unwrap();
        writer
            .write_slice(
                &batch2,
                batch2
                    .column_by_name(HASH_LABEL)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<UInt64Array>()
                    .unwrap(),
                0,
                batch2.num_rows(),
            )
            .unwrap();

        let bytes = writer.finish().unwrap();
        let batches = ArrowFileReader::try_new(Cursor::new(bytes), None)
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(batches.len(), 1);
        assert_eq!(
            batches[0]
                .schema()
                .field_with_name("path")
                .unwrap()
                .data_type(),
            &DataType::Utf8View,
            "the sidecar preserves the label view type"
        );

        let starts = batches
            .iter()
            .flat_map(|batch| {
                batch
                    .column_by_name(TSID_SERIES_INDEX_ROW_START)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<UInt64Array>()
                    .unwrap()
                    .values()
                    .iter()
                    .copied()
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        let counts = batches
            .iter()
            .flat_map(|batch| {
                batch
                    .column_by_name(TSID_SERIES_INDEX_ROW_COUNT)
                    .unwrap()
                    .as_any()
                    .downcast_ref::<UInt32Array>()
                    .unwrap()
                    .values()
                    .iter()
                    .copied()
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>();
        assert_eq!(starts, vec![0, 2, 3, 4]);
        assert_eq!(counts, vec![2, 1, 1, 1]);
    }

    #[test]
    fn test_tsid_series_index_coalesces_many_small_writes() {
        let row_count = TSID_SERIES_INDEX_BATCH_ROWS + 1;
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(VALUE_LABEL, DataType::Float64, false),
        ]));
        let batch = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(UInt64Array::from_iter_values(
                    (0..row_count).map(|value| value as u64),
                )),
                Arc::new(Int64Array::from_iter_values(
                    (0..row_count).map(|value| value as i64),
                )),
                Arc::new(Float64Array::from_iter_values(
                    (0..row_count).map(|value| value as f64),
                )),
            ],
        )
        .unwrap();
        let hashes = batch
            .column_by_name(HASH_LABEL)
            .unwrap()
            .as_any()
            .downcast_ref::<UInt64Array>()
            .unwrap();

        let mut writer = TsidSeriesIndexWriter::try_new(&schema).unwrap();
        for row in 0..row_count {
            writer.write_slice(&batch, hashes, row, row + 1).unwrap();
        }

        let bytes = writer.finish().unwrap();
        let batches = ArrowFileReader::try_new(Cursor::new(bytes), None)
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(batches.len(), 2);
        assert_eq!(
            batches.iter().map(RecordBatch::num_rows).sum::<usize>(),
            row_count
        );
    }
}
