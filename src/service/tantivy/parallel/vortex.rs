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

//! Vortex entry point for the parallel tantivy index builder.
//!
//! Reads the vortex file footer once to determine the total row count, splits
//! the row range into fixed-size windows of [`CHUNK_ROWS`] rows — the same
//! constant that controls parquet row_group size — then delegates each window
//! as one chunk to the common parallel scaffold with a
//! [`ChunkSelector::Vortex`] selector.
//!
//! Correctness of `doc_id == global_row_index` is preserved because:
//!   1. each per-chunk `SingleSegmentIndexWriter` writes rows in stored order (vortex
//!      `with_row_range(start..end)` returns rows `[start, end)` in file order with the default
//!      `ordered=true`), so its local doc_ids equal the row's offset inside the chunk;
//!   2. `IndexMerger` stacks input segments in input order;
//!   3. for a fixed window size N, chunk `i`'s row `k` has global row index `i * N + k`.

use anyhow::{Context, Error};
use bytes::Bytes;
use config::PARQUET_MAX_ROW_GROUP_SIZE;
use vortex::{
    VortexSessionDefault,
    file::OpenOptionsSessionExt,
    io::{
        runtime::{BlockingRuntime, single::SingleThreadRuntime},
        session::RuntimeSessionExt,
    },
    session::VortexSession,
};

use crate::service::tantivy::{TantivyIndexSchema, reader::ChunkSelector};

/// Rows per chunk. Shared with parquet so the puffin `PROP_ROW_GROUP_SIZE`
/// reader-side mapping is the same constant for both formats.
const CHUNK_ROWS: u64 = PARQUET_MAX_ROW_GROUP_SIZE as u64;

pub(super) async fn build_index<D: tantivy::Directory + Send + Sync + 'static>(
    tantivy_dir: D,
    buf: Bytes,
    index_schema: TantivyIndexSchema,
    thread_num: usize,
) -> Result<Option<tantivy::Index>, Error> {
    let buf_meta = buf.clone();
    let row_count: u64 = tokio::task::spawn_blocking(move || -> Result<u64, Error> {
        let runtime = SingleThreadRuntime::default();
        let session = VortexSession::default().with_handle(runtime.handle());
        session
            .open_options()
            .open_buffer(buf_meta)
            .context("failed to open vortex file for row_count")
            .map(|vxf| vxf.row_count())
    })
    .await??;

    let num_chunks = row_count.div_ceil(CHUNK_ROWS) as usize;
    super::build_parallel_index(
        tantivy_dir,
        buf,
        index_schema,
        thread_num,
        num_chunks,
        move |chunk_idx| {
            let chunk_start = chunk_idx as u64 * CHUNK_ROWS;
            let chunk_end = std::cmp::min(chunk_start + CHUNK_ROWS, row_count);
            ChunkSelector::Vortex(chunk_start..chunk_end)
        },
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
    use bytes::Bytes;
    use config::TIMESTAMP_COL_NAME;
    use tantivy::directory::RamDirectory;
    use vortex::{
        VortexSessionDefault,
        array::{ArrayRef, arrow::FromArrowArray},
        dtype::{DType, arrow::FromArrowType},
        file::{VortexWriteOptions, WriteStrategyBuilder},
        io::session::RuntimeSessionExt,
        session::VortexSession,
    };

    use super::*;
    use crate::service::tantivy::tests::make_index_schema;

    /// One row per marker, marker text is globally unique → search-by-marker
    /// recovers the row's doc_id so we can assert it equals the global row index.
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

    /// Writes batches into an in-memory vortex file using the default write
    /// strategy. Test helper — production writes go through `write_vortex` in
    /// the enterprise crate.
    async fn create_test_vortex_bytes(batches: Vec<RecordBatch>) -> Bytes {
        let schema = batches[0].schema();
        let session = VortexSession::default().with_tokio();
        let dtype = DType::from_arrow(schema.as_ref());
        let write_options =
            VortexWriteOptions::new(session).with_strategy(WriteStrategyBuilder::default().build());
        let mut buf = Vec::new();
        let mut writer = write_options.writer(&mut buf, dtype);
        for batch in batches {
            let array: ArrayRef = ArrayRef::from_arrow(batch, false).unwrap();
            writer.push(array).await.unwrap();
        }
        writer.finish().await.unwrap();
        Bytes::from(buf)
    }

    /// Core invariant test: parallel chunks (possibly out of order) must yield
    /// `doc_id == global_row_index` after merge.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_vortex_parallel_preserves_row_order() {
        // Total rows that span ≥ 2 chunks so the merge path runs. CHUNK_ROWS
        // is PARQUET_MAX_ROW_GROUP_SIZE (128k) — using a small multiple keeps
        // the test fast while still exercising multi-chunk merge.
        let total_rows = (CHUNK_ROWS as usize) * 2 + 137;
        let buf = create_test_vortex_bytes(vec![create_marker_batch(0, total_rows)]).await;

        let stream_schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("marker", DataType::Utf8, false),
        ]));

        let index = build_index(
            RamDirectory::create(),
            buf,
            make_index_schema(&[], &["marker".to_string()], &stream_schema),
            3, // force out-of-order chunk completion
        )
        .await
        .expect("vortex parallel build must succeed")
        .expect("vortex parallel build must return Some(index)");

        let segs = index.searchable_segments().unwrap();
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].meta().max_doc() as usize, total_rows);

        let reader = index.reader().unwrap();
        let searcher = reader.searcher();
        let marker_field = index.schema().get_field("marker").unwrap();

        // Spot-check evenly along the range — full scan of 256k+ rows is too
        // slow for a unit test.
        let probes = [
            0,
            1,
            CHUNK_ROWS as usize - 1,
            CHUNK_ROWS as usize,
            CHUNK_ROWS as usize * 2 - 1,
            CHUNK_ROWS as usize * 2,
            total_rows - 1,
        ];
        for row in probes {
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

    /// Total rows < CHUNK_ROWS ⇒ single-chunk fast path that bypasses
    /// `merge_indices` and writes the segment straight into the caller-supplied
    /// directory.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn test_vortex_parallel_single_chunk_fast_path() {
        let total_rows = 1234usize;
        let buf = create_test_vortex_bytes(vec![create_marker_batch(0, total_rows)]).await;

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
        .expect("single chunk build must succeed")
        .expect("single chunk build must return Some(index)");

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

    /// Zero-row file ⇒ Ok(None), no panic.
    #[tokio::test]
    async fn test_vortex_parallel_empty_file() {
        let empty = create_marker_batch(0, 0);
        let buf = create_test_vortex_bytes(vec![empty.clone()]).await;
        let stream_schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("marker", DataType::Utf8, false),
        ]));
        let result = build_index(
            RamDirectory::create(),
            buf,
            make_index_schema(&[], &["marker".to_string()], &stream_schema),
            2,
        )
        .await
        .expect("empty build must succeed");
        assert!(result.is_none());
    }
}
