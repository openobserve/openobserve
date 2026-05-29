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

//! Parquet entry point for the parallel tantivy index builder.
//!
//! Reads the parquet footer once to determine `num_row_groups`, then delegates
//! each row_group as one chunk to the common parallel scaffold with a
//! [`ChunkSelector::Parquet`] selector.
//!
//! Correctness of `doc_id == global_row_index` is preserved because:
//!   1. each per-row_group `SingleSegmentIndexWriter` writes rows in stored order, so its local
//!      doc_ids equal the row's offset inside that row_group;
//!   2. `IndexMerger` stacks input segments in input order, so each segment's doc_ids land at `i *
//!      PARQUET_MAX_ROW_GROUP_SIZE`;
//!   3. parquet stores row_groups in row order, so the global row index of row_group `i`'s row `k`
//!      is `i * PARQUET_MAX_ROW_GROUP_SIZE + k`.

use anyhow::{Context, Error};
use bytes::Bytes;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;

use crate::service::tantivy::{TantivyIndexSchema, reader::ChunkSelector};

pub(super) async fn build_index<D: tantivy::Directory + Send + Sync + 'static>(
    tantivy_dir: D,
    buf: Bytes,
    index_schema: TantivyIndexSchema,
    thread_num: usize,
) -> Result<Option<tantivy::Index>, Error> {
    let buf_meta = buf.clone();
    let num_row_groups = tokio::task::spawn_blocking(move || -> Result<usize, Error> {
        ParquetRecordBatchReaderBuilder::try_new(buf_meta)
            .context("failed to open parquet for metadata")
            .map(|b| b.metadata().num_row_groups())
    })
    .await??;

    super::build_parallel_index(
        tantivy_dir,
        buf,
        index_schema,
        thread_num,
        num_row_groups,
        ChunkSelector::Parquet,
    )
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{Int64Array, StringArray},
        datatypes::{DataType, Field, Schema},
        record_batch::RecordBatch,
    };
    use config::{FileFormat, TIMESTAMP_COL_NAME};
    use parquet::{arrow::AsyncArrowWriter, file::properties::WriterProperties};
    use tantivy::directory::RamDirectory;

    use super::*;
    use crate::service::tantivy::{
        sequential,
        tests::{create_test_parquet_bytes, make_index_schema},
    };

    /// Build a record batch where every row has a globally-unique marker token
    /// in the `marker` column. The marker is what we search to recover the
    /// doc_id, so we can assert `doc_id == global_row_index`.
    fn create_marker_batch(start: usize, num_rows: usize) -> RecordBatch {
        let fields = vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("marker", DataType::Utf8, false),
        ];
        let timestamps: Vec<i64> = (0..num_rows).map(|i| (start + i) as i64).collect();
        let markers: Vec<String> = (0..num_rows)
            .map(|i| format!("row{:09}", start + i))
            .collect();
        let schema = Arc::new(Schema::new(fields));
        RecordBatch::try_new(
            schema,
            vec![
                Arc::new(Int64Array::from(timestamps)),
                Arc::new(StringArray::from(markers)),
            ],
        )
        .unwrap()
    }

    /// Writes batches to an in-memory parquet file with a caller-specified
    /// fixed row_group row count. We deliberately bypass
    /// `config::utils::parquet::new_parquet_writer` because it hard-codes the
    /// row_group cap to `PARQUET_MAX_ROW_GROUP_SIZE` (128k). The parallel
    /// builder's `doc_id == i * row_group_size + k` invariant only holds when
    /// every non-tail row_group has the same row count, so the test needs to
    /// drive that exact splitting boundary at a size small enough to keep the
    /// test fast.
    async fn create_test_parquet_bytes_fixed_rg(
        batches: Vec<RecordBatch>,
        row_group_row_count: usize,
    ) -> bytes::Bytes {
        let schema = batches[0].schema();
        let mut buffer = Vec::new();
        let writer_props = WriterProperties::builder()
            .set_max_row_group_row_count(Some(row_group_row_count))
            .build();
        let mut writer =
            AsyncArrowWriter::try_new(&mut buffer, schema, Some(writer_props)).unwrap();
        for batch in batches {
            writer.write(&batch).await.unwrap();
        }
        writer.close().await.unwrap();
        bytes::Bytes::from(buffer)
    }

    /// The core invariant test: with multiple row_groups parsed by
    /// per-row_group workers (potentially out of order), every marker's
    /// `doc_id` must equal its original global row index after merge.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_row_group_parallel_preserves_row_order() {
        // Fixed row_group size of 500 + 2137 total rows ⇒ 5 row_groups of
        // exactly 500 rows and a 137-row partial tail. This matches the
        // production layout where every non-tail row_group has the same size.
        let row_group_size = 500usize;
        let total_rows = 2137usize;
        let buf = create_test_parquet_bytes_fixed_rg(
            vec![create_marker_batch(0, total_rows)],
            row_group_size,
        )
        .await;

        // Verify the parquet split into the expected fixed-size row_groups.
        let expected_num_rg = total_rows.div_ceil(row_group_size);
        let metadata_num_rg = {
            let buf = buf.clone();
            tokio::task::spawn_blocking(move || {
                ParquetRecordBatchReaderBuilder::try_new(buf)
                    .unwrap()
                    .metadata()
                    .num_row_groups()
            })
            .await
            .unwrap()
        };
        assert_eq!(
            metadata_num_rg, expected_num_rg,
            "test setup must yield {expected_num_rg} fixed-size row_groups"
        );

        let stream_schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("marker", DataType::Utf8, false),
        ]));

        let index = build_index(
            RamDirectory::create(),
            buf,
            make_index_schema(&[], &["marker".to_string()], &stream_schema),
            // workers
            3, // force out-of-order completion
        )
        .await
        .expect("parallel build must succeed")
        .expect("parallel build must return Some(index)");

        let segs = index.searchable_segments().unwrap();
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].meta().max_doc() as usize, total_rows);

        let reader = index.reader().unwrap();
        let searcher = reader.searcher();
        let marker_field = index.schema().get_field("marker").unwrap();

        for row in 0..total_rows {
            let m = format!("row{:09}", row);
            let q = tantivy::query::TermQuery::new(
                tantivy::Term::from_field_text(marker_field, &m),
                tantivy::schema::IndexRecordOption::Basic,
            );
            let hits = searcher
                .search(&q, &tantivy::collector::DocSetCollector)
                .unwrap();
            assert_eq!(
                hits.len(),
                1,
                "marker for row {row} must match exactly 1 doc"
            );
            let addr = *hits.iter().next().unwrap();
            assert_eq!(addr.segment_ord, 0);
            assert_eq!(
                addr.doc_id as usize, row,
                "INVARIANT VIOLATION: doc_id != row_index at row {row}"
            );
        }
    }

    /// Single row_group hits the fast path that bypasses `merge_indices` and
    /// writes the segment straight into the caller-supplied directory.
    /// Validates that the resulting index lands in `tantivy_dir` and that
    /// `doc_id == row_index` is preserved.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn test_row_group_parallel_single_row_group_fast_path() {
        // 321 rows with a 500-row max row_group ⇒ exactly 1 row_group, so the
        // builder takes the single-row_group fast path.
        let total_rows = 321usize;
        let buf =
            create_test_parquet_bytes_fixed_rg(vec![create_marker_batch(0, total_rows)], 500).await;

        let stream_schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("marker", DataType::Utf8, false),
        ]));

        let index = build_index(
            RamDirectory::create(),
            buf,
            make_index_schema(&[], &["marker".to_string()], &stream_schema),
            4,
        )
        .await
        .expect("single row_group build must succeed")
        .expect("single row_group build must return Some(index)");

        let segs = index.searchable_segments().unwrap();
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].meta().max_doc() as usize, total_rows);

        let reader = index.reader().unwrap();
        let searcher = reader.searcher();
        let marker_field = index.schema().get_field("marker").unwrap();
        for row in 0..total_rows {
            let m = format!("row{:09}", row);
            let q = tantivy::query::TermQuery::new(
                tantivy::Term::from_field_text(marker_field, &m),
                tantivy::schema::IndexRecordOption::Basic,
            );
            let hits = searcher
                .search(&q, &tantivy::collector::DocSetCollector)
                .unwrap();
            assert_eq!(hits.len(), 1);
            let addr = *hits.iter().next().unwrap();
            assert_eq!(addr.segment_ord, 0);
            assert_eq!(addr.doc_id as usize, row);
        }
    }

    /// Same data through parallel-row_group path and sequential path must
    /// yield the same `(marker → doc_id)` mapping for every row. Verifies
    /// behavioural equivalence end-to-end.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_row_group_parallel_matches_sequential() {
        // 750 rows, fixed row_group size 250 ⇒ 3 full row_groups of 250 each.
        let total = 750usize;
        let buf_par =
            create_test_parquet_bytes_fixed_rg(vec![create_marker_batch(0, total)], 250).await;
        let buf_seq = create_test_parquet_bytes(vec![
            create_marker_batch(0, 250),
            create_marker_batch(250, 250),
            create_marker_batch(500, 250),
        ])
        .await;
        let schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("marker", DataType::Utf8, false),
        ]));

        let par = build_index(
            RamDirectory::create(),
            buf_par,
            make_index_schema(&[], &["marker".to_string()], &schema),
            3,
        )
        .await
        .unwrap()
        .unwrap();
        let seq = sequential::build_index(
            RamDirectory::create(),
            FileFormat::Parquet,
            buf_seq,
            make_index_schema(&[], &["marker".to_string()], &schema),
        )
        .await
        .unwrap()
        .unwrap();

        let par_total: usize = par
            .searchable_segments()
            .unwrap()
            .iter()
            .map(|s| s.meta().max_doc() as usize)
            .sum();
        let seq_total: usize = seq
            .searchable_segments()
            .unwrap()
            .iter()
            .map(|s| s.meta().max_doc() as usize)
            .sum();
        assert_eq!(par_total, total);
        assert_eq!(seq_total, total);

        let par_reader = par.reader().unwrap();
        let par_searcher = par_reader.searcher();
        let par_marker = par.schema().get_field("marker").unwrap();
        let seq_reader = seq.reader().unwrap();
        let seq_searcher = seq_reader.searcher();
        let seq_marker = seq.schema().get_field("marker").unwrap();

        for row in 0..total {
            let m = format!("row{:09}", row);
            let q_par = tantivy::query::TermQuery::new(
                tantivy::Term::from_field_text(par_marker, &m),
                tantivy::schema::IndexRecordOption::Basic,
            );
            let q_seq = tantivy::query::TermQuery::new(
                tantivy::Term::from_field_text(seq_marker, &m),
                tantivy::schema::IndexRecordOption::Basic,
            );
            let hits_par = par_searcher
                .search(&q_par, &tantivy::collector::DocSetCollector)
                .unwrap();
            let hits_seq = seq_searcher
                .search(&q_seq, &tantivy::collector::DocSetCollector)
                .unwrap();
            assert_eq!(hits_par.len(), 1);
            assert_eq!(hits_seq.len(), 1);
            let addr_par = *hits_par.iter().next().unwrap();
            let addr_seq = *hits_seq.iter().next().unwrap();
            assert_eq!(addr_par.doc_id as usize, row);
            assert_eq!(addr_seq.doc_id as usize, row);
        }
    }
}
