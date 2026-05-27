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

//! Row-group-direct parallel tantivy index builder.
//!
//! Activated when `compact.tantivy_parallel_build_workers > 0` and the input
//! file format is parquet. Each parquet row_group becomes one independent
//! chunk segment built off the runtime in `tokio::task::spawn_blocking`; the
//! resulting per-row_group segments are stitched together by
//! `tantivy::indexer::merge_indices` in row_group order.
//!
//! Correctness of `doc_id == global_row_index` is preserved because:
//!   1. each per-row_group `SingleSegmentIndexWriter` writes rows in stored order, so its local
//!      doc_ids equal the row's offset inside that row_group;
//!   2. `IndexMerger` stacks input segments in input order (current tantivy has no `sort_by_field`
//!      path), so segment `i`'s doc_ids land at `[Σ_{j<i} rg_size_j, Σ_{j≤i} rg_size_j)`;
//!   3. parquet stores row_groups in row order, so the global row index of row_group `i`'s row `k`
//!      is exactly `Σ_{j<i} rg_size_j + k`.

use std::sync::Arc;

use anyhow::{Context, Error};
use bytes::Bytes;
use config::utils::tantivy::tokenizer::{CollectType, O2_TOKENIZER, o2_tokenizer_build};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use tantivy::directory::MmapDirectory;
use tokio::task::JoinHandle;

use super::{TantivyIndexSchema, convert_batch_to_docs_sync};

type TaskOutput = (usize, tantivy::Index, usize);

/// Row-group-direct parallel tantivy index builder.
///
/// ```text
///   parquet (Bytes)
///     │
///     ├─ open ParquetRecordBatchReaderBuilder ── read metadata ── num_row_groups
///     │
///     ▼  spawn_blocking pool (concurrency = workers)
///   ┌──────────────────────┬──────────────────────┬─────────────────────┐
///   │ rg_0                 │ rg_1                 │ ...                 │
///   │ builder              │ builder              │                     │
///   │   .with_row_groups   │   .with_row_groups   │                     │
///   │   ([0]).build()      │   ([1]).build()      │                     │
///   │ → SingleSegmentIdx   │ → SingleSegmentIdx   │                     │
///   │ → finalize → Index   │ → finalize → Index   │                     │
///   └──────────────────────┴──────────────────────┴─────────────────────┘
///     │
///     ▼  sort by rg_idx ASC
///   merge_indices([Index_0, Index_1, ...], PuffinDirWriter)
///     │
///     ▼
///   single segment, doc_id == global_row_index
/// ```
///
/// `Bytes` is reference-counted, so handing one clone per worker is cheap.
pub(super) async fn build_index<D: tantivy::Directory + Send + Sync + 'static>(
    tantivy_dir: D,
    buf: Bytes,
    index_schema: TantivyIndexSchema,
    thread_num: usize,
) -> Result<Option<tantivy::Index>, Error> {
    // Parse parquet metadata once on a blocking thread (footer decode is sync I/O).
    let num_row_groups = {
        let buf = buf.clone();
        tokio::task::spawn_blocking(move || -> Result<usize, Error> {
            let builder = ParquetRecordBatchReaderBuilder::try_new(buf)
                .context("failed to open parquet for metadata")?;
            Ok(builder.metadata().num_row_groups())
        })
        .await??
    };
    if num_row_groups == 0 {
        return Ok(None);
    }

    // single row_group fast path
    if num_row_groups == 1 {
        let start = std::time::Instant::now();
        let (_, index, num_rows) = tokio::task::spawn_blocking(move || {
            build_row_group_segment(0, buf, index_schema, tantivy_dir)
        })
        .await??;
        log::info!(
            "parallel::build_index: single row_group fast path, rows={num_rows}, elapsed={} ms",
            start.elapsed().as_millis()
        );
        return Ok(Some(index));
    }

    let thread_num = thread_num.max(1).min(num_row_groups);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(thread_num));

    let start = std::time::Instant::now();
    let mut tasks: Vec<JoinHandle<Result<TaskOutput, Error>>> = Vec::with_capacity(num_row_groups);
    for rg_idx in 0..num_row_groups {
        let permit = semaphore.clone().acquire_owned().await?;
        let buf_c = buf.clone();
        let index_schema_c = index_schema.clone();
        tasks.push(tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let dir = MmapDirectory::create_from_tempdir()?;
            build_row_group_segment(rg_idx, buf_c, index_schema_c, dir)
        }));
    }

    let mut indexed: Vec<TaskOutput> = Vec::with_capacity(tasks.len());
    for t in tasks {
        indexed.push(t.await??);
    }
    // Sort by row_group index to preserve global row order in the merged index.
    indexed.sort_by_key(|(rg, ..)| *rg);
    let total_num_rows: usize = indexed.iter().map(|(_, _, n)| n).sum();
    let indices: Vec<tantivy::Index> = indexed.into_iter().map(|(_, i, _)| i).collect();

    log::info!(
        "parallel::build_index: built {num_row_groups} row_groups, total_rows={total_num_rows}, thread_num={thread_num}, elapsed={} ms",
        start.elapsed().as_millis()
    );

    // merge all row_group indices into a single index.
    let start = std::time::Instant::now();
    let merged = tokio::task::spawn_blocking(move || {
        tantivy::indexer::merge_indices(&indices, tantivy_dir)
            .map_err(|e| anyhow::anyhow!("merge_indices failed: {e}"))
    })
    .await??;

    log::info!(
        "parallel::build_index: merged row_group indices into single tantivy index, elapsed={} ms",
        start.elapsed().as_millis()
    );

    let merged_segs = merged.searchable_segments()?;
    if merged_segs.len() != 1 {
        return Err(anyhow::anyhow!(
            "merged tantivy index produced {} segments (expected 1)",
            merged_segs.len()
        ));
    }
    let merged_rows = merged_segs[0].meta().max_doc() as usize;
    if merged_rows != total_num_rows {
        return Err(anyhow::anyhow!(
            "merged tantivy index row count mismatch: tantivy={merged_rows}, parquet={total_num_rows}",
        ));
    }

    Ok(Some(merged))
}

/// Synchronously builds the tantivy segment for exactly one parquet row_group
/// into the caller-supplied directory.
/// Return: (row_group_index, per-row_group Index, row_count)
fn build_row_group_segment<D: tantivy::Directory>(
    rg_idx: usize,
    buf: Bytes,
    index_schema: TantivyIndexSchema,
    dir: D,
) -> Result<(usize, tantivy::Index, usize), Error> {
    let builder = ParquetRecordBatchReaderBuilder::try_new(buf)?;
    let reader = builder.with_row_groups(vec![rg_idx]).build()?;

    let tokenizer_manager = tantivy::tokenizer::TokenizerManager::default();
    tokenizer_manager.register(O2_TOKENIZER, o2_tokenizer_build(CollectType::Ingest));
    let mut writer = tantivy::IndexBuilder::new()
        .schema(index_schema.schema.clone())
        .tokenizers(tokenizer_manager)
        .single_segment_index_writer::<tantivy::TantivyDocument>(dir, 50_000_000)?;

    let mut rg_rows: usize = 0;
    for batch_res in reader {
        let batch = batch_res?;
        if batch.num_rows() == 0 {
            continue;
        }
        rg_rows += batch.num_rows();
        let docs = convert_batch_to_docs_sync(&batch, &index_schema);
        for doc in docs {
            writer.add_document(doc)?;
        }
    }

    let index = writer
        .finalize()
        .map_err(|e| anyhow::anyhow!("worker {rg_idx}: finalize failed: {e}"))?;

    Ok((rg_idx, index, rg_rows))
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

    /// Writes a parquet file with explicit row_group boundaries. Each inner
    /// `Vec<RecordBatch>` is concatenated into exactly one row_group via
    /// `writer.flush()` between groups. Used to exercise the multi-row_group
    /// parallel path deterministically without writing 100k+ rows.
    async fn create_test_parquet_bytes_multi_rg(groups: Vec<Vec<RecordBatch>>) -> bytes::Bytes {
        let schema = groups[0][0].schema();
        let mut buffer = Vec::new();
        let file_meta = config::meta::stream::FileMeta {
            min_ts: 1000,
            max_ts: 2000,
            records: groups.iter().flatten().map(|b| b.num_rows()).sum::<usize>() as i64,
            original_size: 1000,
            ..Default::default()
        };
        let mut writer = config::utils::parquet::new_parquet_writer(
            &mut buffer,
            &schema,
            &[],
            &file_meta,
            false,
            None,
        );
        let num_groups = groups.len();
        for (i, batches) in groups.into_iter().enumerate() {
            for batch in batches {
                writer.write(&batch).await.unwrap();
            }
            // flush() closes the in-progress row_group, forcing the next
            // batch to start a new one. Skip after the last group; close()
            // handles the tail.
            if i + 1 < num_groups {
                writer.flush().await.unwrap();
            }
        }
        writer.close().await.unwrap();
        bytes::Bytes::from(buffer)
    }

    /// The core invariant test: with multiple row_groups parsed by
    /// per-row_group workers (potentially out of order), every marker's
    /// `doc_id` must equal its original global row index after merge.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn test_row_group_parallel_preserves_row_order() {
        // 4 row_groups of varied sizes, total 2137 rows. The middle row_groups
        // have multiple batches each to exercise the per-row_group batch loop.
        let rg0 = vec![create_marker_batch(0, 500)];
        let rg1 = vec![create_marker_batch(500, 300), create_marker_batch(800, 200)];
        let rg2 = vec![create_marker_batch(1000, 1000)];
        let rg3 = vec![create_marker_batch(2000, 137)]; // partial tail
        let total_rows = 500 + 500 + 1000 + 137;
        let buf = create_test_parquet_bytes_multi_rg(vec![rg0, rg1, rg2, rg3]).await;

        // Verify the parquet really has 4 row_groups (test the test).
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
        assert_eq!(metadata_num_rg, 4, "test setup must yield 4 row_groups");

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
        let rg0 = vec![create_marker_batch(0, 321)];
        let total_rows = 321;
        let buf = create_test_parquet_bytes_multi_rg(vec![rg0]).await;

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
        let rg0 = vec![create_marker_batch(0, 250)];
        let rg1 = vec![create_marker_batch(250, 250)];
        let rg2 = vec![create_marker_batch(500, 250)];
        let total = 750;

        let buf_par =
            create_test_parquet_bytes_multi_rg(vec![rg0.clone(), rg1.clone(), rg2.clone()]).await;
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
