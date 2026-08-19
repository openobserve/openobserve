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
    TIMESTAMP_COL_NAME,
    meta::{
        promql::{HASH_LABEL, tsid_layout::MetricsFileLayout},
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
        if batch.num_rows() == 0 {
            continue;
        }
        let hashes = hash_column(&batch, hash_index)?;
        // the merge query sorts by (__hash__, _timestamp); a null or a
        // decreasing hash means the input was not the sorted merge output
        let mut last_hash = previous_hash;
        for hash in hashes.iter() {
            let hash = hash.ok_or_else(|| {
                DataFusionError::Execution(format!("TSID-major layout found null {HASH_LABEL}"))
            })?;
            if last_hash.is_some_and(|previous| hash < previous) {
                return Err(DataFusionError::Execution(format!(
                    "TSID-major merge output is not ordered: previous hash {last_hash:?}, current hash {hash}"
                )));
            }
            last_hash = Some(hash);
        }

        // rotate between input batches once the logical size target is reached
        if active
            .as_ref()
            .is_some_and(|writer| writer.estimated_original_size(metadata) >= max_file_size)
        {
            files.push(active.take().unwrap().finish().await?);
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

fn hash_column(batch: &RecordBatch, hash_index: usize) -> Result<&UInt64Array> {
    batch
        .column(hash_index)
        .as_any()
        .downcast_ref::<UInt64Array>()
        .ok_or_else(|| {
            DataFusionError::Plan(format!("TSID-major layout requires UInt64 {HASH_LABEL}"))
        })
}

/// One output file in progress: the Parquet writer and the running file meta.
struct ActiveSizeTsidWriter {
    writer: AsyncArrowWriter<Vec<u8>>,
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
            file_meta: FileMeta {
                min_ts: 0,
                max_ts: 0,
                records: 0,
                original_size: 0,
                compressed_size: 0,
                index_size: 0,
                ..metadata.clone()
            },
            timestamp_index,
        })
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
                    "TSID-major layout requires Int64 {TIMESTAMP_COL_NAME}"
                ))
            })?;
        let meta = &mut self.file_meta;
        let (mut min_ts, mut max_ts) = if meta.records == 0 {
            (i64::MAX, i64::MIN)
        } else {
            (meta.min_ts, meta.max_ts)
        };
        if let (Some(min), Some(max)) = (min(timestamps), max(timestamps)) {
            min_ts = min_ts.min(min);
            max_ts = max_ts.max(max);
        }
        if min_ts <= max_ts {
            (meta.min_ts, meta.max_ts) = (min_ts, max_ts);
        }
        meta.records += batch.num_rows() as i64;
        Ok(())
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
            ..
        } = self;
        append_metadata(&mut writer, &file_meta)?;
        writer.finish().await?;
        Ok(MergedFile {
            buf: writer.into_inner(),
            meta: file_meta,
            layout: MetricsFileLayout::TsidMajor,
        })
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Float64Array, Int64Array, StringViewArray};
    use arrow_schema::{DataType, Field, Schema};
    use config::meta::promql::VALUE_LABEL;
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
            f.layout == MetricsFileLayout::TsidMajor && f.meta.compressed_size == f.buf.len() as i64
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
}
