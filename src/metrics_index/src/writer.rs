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
    array::{Array, ArrayRef as ArrowArrayRef, RecordBatch, UInt32Array, UInt64Array},
    compute::{concat_batches, take},
    datatypes::{DataType, Field, Schema},
    ipc::{
        CompressionType,
        writer::{FileWriter as ArrowFileWriter, IpcWriteOptions},
    },
};
use config::meta::promql::{HASH_LABEL, is_metrics_hash_excluded_label};
use datafusion::error::{DataFusionError, Result};

use crate::layout::METRICS_INDEX_ROW_COUNT;

/// Writer for an indexed metrics file's `.midx` metrics index. Every row
/// describes one contiguous metrics series run in the data file: its row count plus the
/// label columns of the run's first row (`__hash__` excluded — matchers never
/// reference it). Runs tile the data file, so a run's starting row is the
/// prefix sum of the preceding counts and is not stored. Runs that cross an
/// input RecordBatch boundary appear as two adjacent entries; query-time range
/// coalescing makes that representation equivalent without buffering samples.
///
/// Entries are buffered raw (one row per run) and written as a single
/// ZSTD-compressed IPC batch at [`finish`], giving whole-column compression
/// frames and one decode on read. The buffer is small next to the Parquet
/// file built alongside.
///
/// [`finish`]: MetricsIndexWriter::finish
pub struct MetricsIndexWriter {
    schema: Arc<Schema>,
    hash_index: usize,
    label_indices: Vec<usize>,
    pending_batches: Vec<RecordBatch>,
}

impl MetricsIndexWriter {
    pub fn try_new(source_schema: &Arc<Schema>) -> Result<Self> {
        let hash_index = source_schema.index_of(HASH_LABEL).map_err(|e| {
            DataFusionError::Plan(format!("indexed metrics layout requires {HASH_LABEL}: {e}"))
        })?;
        let label_indices = source_schema
            .fields()
            .iter()
            .enumerate()
            .filter_map(|(index, field)| {
                (!is_metrics_hash_excluded_label(field.name())).then_some(index)
            })
            .collect::<Vec<_>>();

        let mut fields = vec![Arc::new(Field::new(
            METRICS_INDEX_ROW_COUNT,
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

    /// Record the metrics series runs of one hash-ordered batch.
    pub fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        let hashes = batch
            .column(self.hash_index)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .ok_or_else(|| {
                DataFusionError::Plan(format!(
                    "indexed metrics layout requires UInt64 {HASH_LABEL}"
                ))
            })?;
        if hashes.null_count() > 0 {
            return Err(DataFusionError::Execution(format!(
                "indexed metrics layout found null {HASH_LABEL}"
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
                DataFusionError::Execution("metrics series run exceeds u32 row count".to_string())
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

    pub fn finish(self) -> Result<Vec<u8>> {
        let batch = concat_batches(&self.schema, &self.pending_batches)?;
        let options =
            IpcWriteOptions::default().try_with_compression(Some(CompressionType::ZSTD))?;
        let mut writer =
            ArrowFileWriter::try_new_with_options(Vec::new(), batch.schema_ref(), options)?;
        writer.write(&batch)?;
        Ok(writer.into_inner()?)
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use arrow::{
        array::{Float64Array, Int64Array, StringViewArray},
        ipc::reader::FileReader,
    };

    use super::*;

    #[test]
    fn test_metrics_index_records_exact_parquet_ranges() {
        let schema = Arc::new(Schema::new(vec![
            Field::new(HASH_LABEL, DataType::UInt64, false),
            Field::new(config::TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new(config::meta::promql::VALUE_LABEL, DataType::Float64, false),
            Field::new("path", DataType::Utf8View, true),
            Field::new("trace_id", DataType::Utf8View, true),
        ]));
        let batch1 = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(UInt64Array::from(vec![1, 1, 2])),
                Arc::new(Int64Array::from(vec![10, 20, 10])),
                Arc::new(Float64Array::from(vec![1.0, 2.0, 3.0])),
                Arc::new(StringViewArray::from(vec!["a", "a", "b"])),
                // Same hash, different excluded label: the sidecar must not
                // snapshot this column and use it to reject the whole run.
                Arc::new(StringViewArray::from(vec!["trace-a", "trace-b", "trace-c"])),
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
                Arc::new(StringViewArray::from(vec!["trace-d", "trace-e"])),
            ],
        )
        .unwrap();

        let mut writer = MetricsIndexWriter::try_new(&schema).unwrap();
        writer.write(&batch1).unwrap();
        writer.write(&batch2).unwrap();

        let bytes = writer.finish().unwrap();
        let batches = FileReader::try_new(Cursor::new(bytes), None)
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        // the whole index is one batch, no __hash__ column and no stored row
        // starts; the label keeps its source type
        assert_eq!(batches.len(), 1);
        let batch = &batches[0];
        assert!(batch.schema().field_with_name(HASH_LABEL).is_err());
        assert!(batch.schema().field_with_name("trace_id").is_err());
        assert_eq!(batch.num_columns(), 2);
        assert_eq!(
            batch.schema().field_with_name("path").unwrap().data_type(),
            &DataType::Utf8View,
        );

        let counts = batch
            .column_by_name(METRICS_INDEX_ROW_COUNT)
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
            .downcast_ref::<StringViewArray>()
            .unwrap()
            .into_iter()
            .map(|value| value.unwrap().to_string())
            .collect::<Vec<_>>();
        assert_eq!(paths, vec!["a", "b", "b", "c"]);
    }
}
