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

use anyhow::{Context, Error};
use bytes::Bytes;
use config::{
    FileFormat, TIMESTAMP_COL_NAME,
    tantivy::tokenizer::{CollectType, O2_TOKENIZER, o2_tokenizer_build},
};
use futures::future::join_all;
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use tantivy::{directory::MmapDirectory, indexer::merge_indices};
use tokio::task::JoinHandle;
#[cfg(all(feature = "vortex", feature = "enterprise"))]
use {
    config::PARQUET_MAX_ROW_GROUP_SIZE,
    vortex::{
        VortexSessionDefault,
        file::OpenOptionsSessionExt,
        io::{
            runtime::{BlockingRuntime, single::SingleThreadRuntime},
            session::RuntimeSessionExt,
        },
        session::VortexSession,
    },
};

use super::{TantivyIndexSchema, convert_batch_to_docs_sync};
use crate::service::tantivy::reader::{ChunkSelector, chunk_iter};

pub(super) async fn build_index<D: tantivy::Directory + Send + Sync + 'static>(
    tantivy_dir: D,
    file_format: FileFormat,
    buf: Bytes,
    index_schema: TantivyIndexSchema,
    thread_num: usize,
) -> Result<Option<tantivy::Index>, Error> {
    match file_format {
        FileFormat::Parquet => {
            let buf_meta = buf.clone();
            let num_row_groups = tokio::task::spawn_blocking(move || -> Result<usize, Error> {
                ParquetRecordBatchReaderBuilder::try_new(buf_meta)
                    .context("failed to open parquet for metadata")
                    .map(|b| b.metadata().num_row_groups())
            })
            .await??;

            build_parallel_index(
                tantivy_dir,
                buf,
                index_schema,
                thread_num,
                num_row_groups,
                ChunkSelector::Parquet,
            )
            .await
        }
        #[cfg(all(feature = "vortex", feature = "enterprise"))]
        FileFormat::Vortex => {
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

            let chunk_size = PARQUET_MAX_ROW_GROUP_SIZE as u64;
            let num_chunks = row_count.div_ceil(chunk_size) as usize;
            build_parallel_index(
                tantivy_dir,
                buf,
                index_schema,
                thread_num,
                num_chunks,
                move |chunk_idx| {
                    let chunk_start = chunk_idx as u64 * chunk_size;
                    let chunk_end = std::cmp::min(chunk_start + chunk_size, row_count);
                    ChunkSelector::Vortex(chunk_start..chunk_end)
                },
            )
            .await
        }
        #[cfg(not(all(feature = "vortex", feature = "enterprise")))]
        FileFormat::Vortex => Err(anyhow::anyhow!(
            "Vortex file format requires the vortex feature"
        )),
    }
}

struct SegmentOutput {
    chunk_idx: usize,
    index: tantivy::Index,
    row_count: usize,
}

/// Chunk-parallel tantivy index builder shared by the Parquet and Vortex paths.
///
/// ```text
///   Bytes  (reference-counted — each worker gets one cheap clone)
///     │
///     │  build_index dispatches by format:
///     │  ┌─ Parquet ── read metadata ─── num_row_groups → chunks
///     │  └─ Vortex  ── read row_count ── ÷ PARQUET_MAX_ROW_GROUP_SIZE → chunks
///     │
///     ▼  spawn_blocking pool (concurrency = workers)
///   ┌──────────────────────┬──────────────────────┬─────────────────────┐
///   │ chunk_0              │ chunk_1              │ ...                 │
///   │ make_selector(0)     │ make_selector(1)     │                     │
///   │ → ChunkSelector      │ → ChunkSelector      │                     │
///   │ → chunk_iter         │ → chunk_iter         │                     │
///   │ → SingleSegmentIdx   │ → SingleSegmentIdx   │                     │
///   │ → finalize → Index   │ → finalize → Index   │                     │
///   └──────────────────────┴──────────────────────┴─────────────────────┘
///     │
///     ▼  sort by chunk_idx ASC
///   merge_indices([Index_0, Index_1, ...], PuffinDirWriter)
///     │
///     ▼
///   single segment, doc_id == global_row_index
/// ```
async fn build_parallel_index<D, F>(
    tantivy_dir: D,
    buf: Bytes,
    index_schema: TantivyIndexSchema,
    thread_num: usize,
    num_chunks: usize,
    make_selector: F,
) -> Result<Option<tantivy::Index>, Error>
where
    D: tantivy::Directory + Send + Sync + 'static,
    F: Fn(usize) -> ChunkSelector,
{
    if num_chunks == 0 {
        return Ok(None);
    }

    // single chunk fast path — write directly into the caller-supplied dir, no merge
    if num_chunks == 1 {
        let start = std::time::Instant::now();
        let selector = make_selector(0);
        let SegmentOutput {
            index, row_count, ..
        } = tokio::task::spawn_blocking(move || {
            build_segment(0, buf, selector, index_schema, tantivy_dir)
        })
        .await??;
        log::info!(
            "parallel::build_index: single chunk, rows={row_count}, elapsed={} ms",
            start.elapsed().as_millis()
        );
        return Ok(Some(index));
    }

    let thread_num = thread_num.max(1).min(num_chunks);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(thread_num));

    let start = std::time::Instant::now();
    let mut tasks: Vec<JoinHandle<Result<SegmentOutput, Error>>> = Vec::with_capacity(num_chunks);
    for chunk_idx in 0..num_chunks {
        let permit = semaphore.clone().acquire_owned().await?;
        let buf_c = buf.clone();
        let index_schema_c = index_schema.clone();
        let selector = make_selector(chunk_idx);
        tasks.push(tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let dir = MmapDirectory::create_from_tempdir()?;
            build_segment(chunk_idx, buf_c, selector, index_schema_c, dir)
        }));
    }

    // await all tasks concurrently, then sort to restore chunk order.
    let mut indexed: Vec<SegmentOutput> = join_all(tasks)
        .await
        .into_iter()
        .map(|r| -> Result<SegmentOutput, Error> { r? })
        .collect::<Result<_, _>>()?;
    indexed.sort_by_key(|s| s.chunk_idx);
    let total_rows: usize = indexed.iter().map(|s| s.row_count).sum();
    let indices: Vec<tantivy::Index> = indexed.into_iter().map(|s| s.index).collect();

    log::info!(
        "parallel::build_index: built {num_chunks} chunks, rows={total_rows}, thread_num={thread_num}, elapsed={} ms",
        start.elapsed().as_millis()
    );

    let start = std::time::Instant::now();
    let merged = tokio::task::spawn_blocking(move || {
        merge_indices(&indices, tantivy_dir)
            .map_err(|e| anyhow::anyhow!("merge_indices failed: {e}"))
    })
    .await??;

    log::info!(
        "parallel::build_index: merged {num_chunks} segments, elapsed={} ms",
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
    if merged_rows != total_rows {
        return Err(anyhow::anyhow!(
            "merged tantivy index row count mismatch: tantivy={merged_rows}, chunks={total_rows}",
        ));
    }

    Ok(Some(merged))
}

/// Synchronously builds one tantivy segment from the rows described by
/// `selector`. Used by both the parquet and vortex parallel paths.
fn build_segment<D: tantivy::Directory>(
    chunk_idx: usize,
    buf: Bytes,
    selector: ChunkSelector,
    index_schema: TantivyIndexSchema,
    dir: D,
) -> Result<SegmentOutput, Error> {
    let mut projection: Vec<String> = index_schema.fields.iter().cloned().collect();
    projection.push(TIMESTAMP_COL_NAME.to_string());

    let iter = chunk_iter(selector, buf, Some(&projection))
        .with_context(|| format!("chunk {chunk_idx}: reader build failed"))?;

    let tokenizer_manager = tantivy::tokenizer::TokenizerManager::default();
    tokenizer_manager.register(O2_TOKENIZER, o2_tokenizer_build(CollectType::Ingest));
    let mut writer = tantivy::IndexBuilder::new()
        .schema(index_schema.schema.clone())
        .tokenizers(tokenizer_manager)
        .single_segment_index_writer::<tantivy::TantivyDocument>(dir, 50_000_000)?;

    let mut row_count: usize = 0;
    for batch_res in iter {
        let batch = batch_res?;
        if batch.num_rows() == 0 {
            continue;
        }
        row_count += batch.num_rows();
        let docs = convert_batch_to_docs_sync(&batch, &index_schema);
        for doc in docs {
            writer.add_document(doc)?;
        }
    }

    let index = writer
        .finalize()
        .map_err(|e| anyhow::anyhow!("chunk {chunk_idx}: finalize failed: {e}"))?;

    Ok(SegmentOutput {
        chunk_idx,
        index,
        row_count,
    })
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
    use parquet::{
        arrow::{AsyncArrowWriter, arrow_reader::ParquetRecordBatchReaderBuilder},
        file::properties::WriterProperties,
    };
    use tantivy::directory::RamDirectory;

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

        let index = super::build_index(
            RamDirectory::create(),
            FileFormat::Parquet,
            buf,
            make_index_schema(&[], &["marker".to_string()], &stream_schema),
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

        let index = super::build_index(
            RamDirectory::create(),
            FileFormat::Parquet,
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

        let par = super::build_index(
            RamDirectory::create(),
            FileFormat::Parquet,
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

    #[cfg(all(feature = "vortex", feature = "enterprise"))]
    mod vortex_tests {
        use std::sync::Arc;

        use arrow::{
            array::{Int64Array, StringArray},
            datatypes::{DataType, Field, Schema},
            record_batch::RecordBatch,
        };
        use bytes::Bytes;
        use config::{FileFormat, PARQUET_MAX_ROW_GROUP_SIZE, TIMESTAMP_COL_NAME};
        use tantivy::directory::RamDirectory;
        use vortex::{
            VortexSessionDefault,
            array::{ArrayRef, arrow::FromArrowArray},
            dtype::{DType, arrow::FromArrowType},
            file::{VortexWriteOptions, WriteStrategyBuilder},
            io::session::RuntimeSessionExt,
            session::VortexSession,
        };

        const CHUNK_ROWS: u64 = PARQUET_MAX_ROW_GROUP_SIZE as u64;

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
            let write_options = VortexWriteOptions::new(session)
                .with_strategy(WriteStrategyBuilder::default().build());
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

            let index = super::super::build_index(
                RamDirectory::create(),
                FileFormat::Vortex,
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

            let index = super::super::build_index(
                RamDirectory::create(),
                FileFormat::Vortex,
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
            let result = super::super::build_index(
                RamDirectory::create(),
                FileFormat::Vortex,
                buf,
                make_index_schema(&[], &["marker".to_string()], &stream_schema),
                2,
            )
            .await
            .expect("empty build must succeed");
            assert!(result.is_none());
        }
    }
}
