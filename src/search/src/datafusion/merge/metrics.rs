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
    TIMESTAMP_COL_NAME,
    meta::{promql::layout::MetricsFileLayout, stream::FileMeta},
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
/// boundaries deliberately remain independent of metrics series boundaries.
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
        let writer = active.get_or_insert_with(|| {
            ActiveIndexedMetricsWriter::new(schema, bloom_filter_fields, metadata, timestamp_index)
        });
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

/// One output file in progress: the Parquet writer and the running file meta.
struct ActiveIndexedMetricsWriter {
    writer: AsyncArrowWriter<Vec<u8>>,
    file_meta: FileMeta,
    timestamp_index: usize,
}

impl ActiveIndexedMetricsWriter {
    fn new(
        schema: &Arc<Schema>,
        bloom_filter_fields: &[String],
        metadata: &FileMeta,
        timestamp_index: usize,
    ) -> Self {
        let writer = new_parquet_writer(
            Vec::new(),
            schema,
            bloom_filter_fields,
            metadata,
            false,
            None,
        );
        Self {
            writer,
            file_meta: FileMeta::default(),
            timestamp_index,
        }
    }

    /// Append one (hash, ts)-ordered batch to the data file and its rows /
    /// time range to the file meta.
    async fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        self.writer.write(batch).await?;

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
            mut writer,
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
            layout: MetricsFileLayout::Indexed,
        })
    }
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
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

    use super::*;

    #[tokio::test]
    async fn test_size_split_metrics_rotates_at_batch_boundary() {
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
            f.layout == MetricsFileLayout::Indexed
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
}
