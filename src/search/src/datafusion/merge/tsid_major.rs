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
    compute::{cast, concat_batches, max, min, take},
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
            EXEMPLARS_LABEL, HASH_LABEL, VALUE_LABEL,
            tsid_layout::{MetricsFileLayout, TSID_SERIES_INDEX_ROW_COUNT},
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
    let timestamp_index = schema.index_of(TIMESTAMP_COL_NAME).map_err(|e| {
        DataFusionError::Plan(format!(
            "TSID-major layout requires {TIMESTAMP_COL_NAME}: {e}"
        ))
    })?;
    let max_file_size = i64::try_from(max_file_size).unwrap_or(i64::MAX).max(1);
    let mut active: Option<ActiveSizeTsidWriter> = None;
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
            None => active.insert(ActiveSizeTsidWriter::try_new(
                schema,
                bloom_filter_fields,
                metadata,
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
            "TSID-major merge produced no rows".to_string(),
        ));
    }

    Ok(files)
}

/// One output file in progress: the Parquet writer, its `.midx` series-index
/// writer and the running file meta.
struct ActiveSizeTsidWriter {
    writer: AsyncArrowWriter<Vec<u8>>,
    series_index: TsidSeriesIndexWriter,
    file_meta: FileMeta,
    timestamp_index: usize,
}

impl ActiveSizeTsidWriter {
    fn try_new(
        schema: &Arc<Schema>,
        bloom_filter_fields: &[String],
        metadata: &FileMeta,
        timestamp_index: usize,
    ) -> Result<Self> {
        let writer = new_parquet_writer(
            Vec::new(),
            schema,
            bloom_filter_fields,
            metadata,
            false,
            None,
        );
        Ok(Self {
            writer,
            series_index: TsidSeriesIndexWriter::try_new(schema)?,
            file_meta: FileMeta::default(),
            timestamp_index,
        })
    }

    /// Append one (hash, ts)-ordered batch to the data file, its runs to the
    /// series index and its rows / time range to the file meta.
    async fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        self.writer.write(batch).await?;
        self.series_index.write(batch)?;

        let timestamps = batch
            .column(self.timestamp_index)
            .as_any()
            .downcast_ref::<Int64Array>()
            .ok_or_else(|| {
                DataFusionError::Plan(format!(
                    "TSID-major layout requires Int64 {TIMESTAMP_COL_NAME}"
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
            mut writer,
            series_index,
            mut file_meta,
            ..
        } = self;

        // below the target so a finalized file never advertises >= max_file_size
        file_meta.original_size =
            proportional_original_size(source_meta, file_meta.records).min(max_file_size - 1);
        append_metadata(&mut writer, &file_meta)?;
        writer.finish().await?;

        let buf = writer.into_inner();
        file_meta.compressed_size = buf.len() as i64;
        Ok(MergedFile {
            buf,
            meta: file_meta,
            layout: MetricsFileLayout::TsidMajor,
            series_index: Some(series_index.finish()?),
        })
    }
}

/// The share of the source `original_size` that `records` rows carry.
fn proportional_original_size(source_meta: &FileMeta, records: i64) -> i64 {
    let estimate = (i128::from(source_meta.original_size.max(0)) * i128::from(records.max(0)))
        / i128::from(source_meta.records.max(1));
    i64::try_from(estimate).unwrap_or(i64::MAX)
}

/// Streaming writer for a TSID-major `.midx` series index. Every row
/// describes one contiguous TSID run in the data file: its row count plus the
/// label columns of the run's first row (`__hash__` excluded — matchers never
/// reference it). Runs tile the data file, so a run's starting row is the
/// prefix sum of the preceding counts and is not stored. Runs that cross an
/// input RecordBatch boundary appear as two adjacent entries; query-time range
/// coalescing makes that representation equivalent without buffering samples.
///
/// Entries are buffered raw (one row per run) and written as a single
/// dictionary-encoded, ZSTD-compressed IPC batch at [`finish`]: adjacent runs
/// are different series, so raw label rows have no locality for the
/// compressor, while label cardinality is far below the run count. One batch
/// per file also means one dictionary per column and whole-column compression
/// frames. The buffer is small next to the Parquet file built alongside.
///
/// [`finish`]: TsidSeriesIndexWriter::finish
struct TsidSeriesIndexWriter {
    schema: Arc<Schema>,
    hash_index: usize,
    label_indices: Vec<usize>,
    pending_batches: Vec<RecordBatch>,
}

impl TsidSeriesIndexWriter {
    fn try_new(source_schema: &Arc<Schema>) -> Result<Self> {
        let hash_index = source_schema.index_of(HASH_LABEL).map_err(|e| {
            DataFusionError::Plan(format!("TSID-major layout requires {HASH_LABEL}: {e}"))
        })?;
        let label_indices = source_schema
            .fields()
            .iter()
            .enumerate()
            .filter_map(|(index, field)| {
                (!matches!(
                    field.name().as_str(),
                    TIMESTAMP_COL_NAME | VALUE_LABEL | EXEMPLARS_LABEL | HASH_LABEL
                ))
                .then_some(index)
            })
            .collect::<Vec<_>>();

        let mut fields = vec![Arc::new(Field::new(
            TSID_SERIES_INDEX_ROW_COUNT,
            DataType::UInt32,
            false,
        ))];
        fields.extend(
            label_indices
                .iter()
                .map(|index| source_schema.fields()[*index].clone()),
        );
        Ok(Self {
            schema: Arc::new(Schema::new(fields)),
            hash_index,
            label_indices,
            pending_batches: Vec::new(),
        })
    }

    /// Record the TSID runs of one hash-ordered batch.
    fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        let hashes = batch
            .column(self.hash_index)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .ok_or_else(|| {
                DataFusionError::Plan(format!("TSID-major layout requires UInt64 {HASH_LABEL}"))
            })?;
        if hashes.null_count() > 0 {
            return Err(DataFusionError::Execution(format!(
                "TSID-major layout found null {HASH_LABEL}"
            )));
        }
        let num_rows = batch.num_rows();
        let mut first_rows = Vec::new();
        let mut row_counts = Vec::new();
        let mut run_start = 0;
        while run_start < num_rows {
            let hash = hashes.value(run_start);
            let mut run_end = run_start + 1;
            while run_end < num_rows && hashes.value(run_end) == hash {
                run_end += 1;
            }
            first_rows.push(u32::try_from(run_start).map_err(|_| {
                DataFusionError::Execution("metrics batch exceeds u32 row index".to_string())
            })?);
            row_counts.push(u32::try_from(run_end - run_start).map_err(|_| {
                DataFusionError::Execution("TSID run exceeds u32 row count".to_string())
            })?);
            run_start = run_end;
        }

        let indices = UInt32Array::from(first_rows);
        let mut columns: Vec<ArrowArrayRef> = vec![Arc::new(UInt32Array::from(row_counts))];
        for index in &self.label_indices {
            columns.push(take(batch.column(*index).as_ref(), &indices, None)?);
        }
        self.pending_batches
            .push(RecordBatch::try_new(Arc::clone(&self.schema), columns)?);
        Ok(())
    }

    fn finish(self) -> Result<Vec<u8>> {
        let batch = dictionary_encode(&concat_batches(&self.schema, &self.pending_batches)?)?;
        let options =
            IpcWriteOptions::default().try_with_compression(Some(CompressionType::ZSTD))?;
        let mut writer =
            ArrowFileWriter::try_new_with_options(Vec::new(), batch.schema_ref(), options)?;
        writer.write(&batch)?;
        Ok(writer.into_inner()?)
    }
}

/// Dictionary-encode the string label columns as `Dictionary(Int32, Utf8)`.
fn dictionary_encode(batch: &RecordBatch) -> Result<RecordBatch> {
    let mut fields = Vec::with_capacity(batch.num_columns());
    let mut columns = Vec::with_capacity(batch.num_columns());
    for (field, column) in batch.schema().fields().iter().zip(batch.columns()) {
        let (field, column) = match field.data_type() {
            DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View => {
                let dictionary =
                    DataType::Dictionary(Box::new(DataType::Int32), Box::new(DataType::Utf8));
                let column = cast(&cast(column, &DataType::Utf8)?, &dictionary)?;
                (
                    Arc::new(field.as_ref().clone().with_data_type(dictionary)),
                    column,
                )
            }
            _ => (Arc::clone(field), Arc::clone(column)),
        };
        fields.push(field);
        columns.push(column);
    }
    Ok(RecordBatch::try_new(
        Arc::new(Schema::new(fields)),
        columns,
    )?)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Float64Array, Int64Array, StringViewArray, UInt64Array};
    use arrow_schema::{DataType, Field, Schema};
    use config::meta::promql::{HASH_LABEL, VALUE_LABEL};
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

        let max_file_size = 151;
        let files = write_files(
            &schema,
            &[],
            &metadata,
            max_file_size,
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
            vec![150, 150, 100]
        );
        assert!(files.iter().all(|f| {
            f.layout == MetricsFileLayout::TsidMajor
                && f.series_index.is_some()
                && f.meta.original_size < max_file_size as i64
                && f.meta.compressed_size == f.buf.len() as i64
        }));

        let mut file_hashes = Vec::new();
        for file in files {
            let bytes = bytes::Bytes::from(file.buf);
            let footer = config::utils::parquet::read_metadata_from_bytes(&bytes)
                .await
                .unwrap();
            assert_eq!(footer.min_ts, file.meta.min_ts);
            assert_eq!(footer.max_ts, file.meta.max_ts);
            assert_eq!(footer.records, file.meta.records);
            assert_eq!(footer.original_size, file.meta.original_size);

            let reader = ParquetRecordBatchReaderBuilder::try_new(bytes)
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
        use std::io::Cursor;

        use arrow::{array::DictionaryArray, datatypes::Int32Type, ipc::reader::FileReader};

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
        writer.write(&batch1).unwrap();
        writer.write(&batch2).unwrap();

        let bytes = writer.finish().unwrap();
        let batches = FileReader::try_new(Cursor::new(bytes), None)
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        // the whole index is one batch, labels dictionary-encoded, no
        // __hash__ column and no stored row starts
        assert_eq!(batches.len(), 1);
        let batch = &batches[0];
        assert!(batch.schema().field_with_name(HASH_LABEL).is_err());
        assert_eq!(batch.num_columns(), 2);
        assert_eq!(
            batch.schema().field_with_name("path").unwrap().data_type(),
            &DataType::Dictionary(Box::new(DataType::Int32), Box::new(DataType::Utf8)),
        );

        let counts = batch
            .column_by_name(config::meta::promql::tsid_layout::TSID_SERIES_INDEX_ROW_COUNT)
            .unwrap()
            .as_any()
            .downcast_ref::<UInt32Array>()
            .unwrap()
            .values()
            .to_vec();
        // runs: hash 1 rows 0..2, hash 2 rows 2..3 and 3..4 (split at the
        // batch boundary), hash 3 rows 4..5; starts are the prefix sums
        assert_eq!(counts, vec![2, 1, 1, 1]);

        let paths = batch
            .column_by_name("path")
            .unwrap()
            .as_any()
            .downcast_ref::<DictionaryArray<Int32Type>>()
            .unwrap()
            .downcast_dict::<arrow::array::StringArray>()
            .unwrap()
            .into_iter()
            .map(|value| value.unwrap().to_string())
            .collect::<Vec<_>>();
        assert_eq!(paths, vec!["a", "b", "b", "c"]);
    }
}
