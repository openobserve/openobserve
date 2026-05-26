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

use anyhow::Context;
use bytes::Bytes;
use config::utils::tantivy::tokenizer::{CollectType, O2_TOKENIZER, o2_tokenizer_build};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use tantivy::directory::MmapDirectory;
use tokio::task::JoinHandle;

use super::{TantivyIndexSchema, convert_batch_to_docs_sync};

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
    workers: usize,
) -> Result<Option<tantivy::Index>, anyhow::Error> {
    // Parse parquet metadata once on a blocking thread (footer decode is sync I/O).
    let num_row_groups = {
        let buf = buf.clone();
        tokio::task::spawn_blocking(move || -> Result<usize, anyhow::Error> {
            let builder = ParquetRecordBatchReaderBuilder::try_new(buf)
                .context("failed to open parquet for metadata")?;
            Ok(builder.metadata().num_row_groups())
        })
        .await??
    };
    if num_row_groups == 0 {
        return Ok(None);
    }

    let workers = workers.max(1).min(num_row_groups);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(workers));

    let start = std::time::Instant::now();
    // (row_group_index, per-row_group Index, row_count) — packaged together so
    // we can reorder the tasks by row_group index after they finish.
    type RgTaskOutput = (usize, tantivy::Index, usize);
    let mut tasks: Vec<JoinHandle<Result<RgTaskOutput, anyhow::Error>>> =
        Vec::with_capacity(num_row_groups);
    for rg_idx in 0..num_row_groups {
        let permit = semaphore.clone().acquire_owned().await?;
        let buf_c = buf.clone();
        let index_schema_c = index_schema.clone();
        tasks.push(tokio::task::spawn_blocking(move || {
            let _permit = permit;
            build_row_group_segment_sync(rg_idx, buf_c, index_schema_c)
        }));
    }

    let mut indexed: Vec<RgTaskOutput> = Vec::with_capacity(tasks.len());
    for t in tasks {
        indexed.push(t.await??);
    }
    // Sort by row_group index to preserve global row order in the merged index.
    indexed.sort_by_key(|(rg, ..)| *rg);
    let total_num_rows: usize = indexed.iter().map(|(_, _, n)| n).sum();
    let indices: Vec<tantivy::Index> = indexed.into_iter().map(|(_, i, _)| i).collect();

    log::info!(
        "parallel::build_index: built {num_row_groups} row_groups, total_rows={total_num_rows}, workers={workers}, elapsed={:?} ms",
        start.elapsed().as_millis()
    );

    let start = std::time::Instant::now();
    // Merge into the puffin directory. `merge_indices` writes a single segment
    // referencing the output `Directory`.
    let merged = tokio::task::spawn_blocking(move || {
        tantivy::indexer::merge_indices(&indices, tantivy_dir)
            .map_err(|e| anyhow::anyhow!("merge_indices failed: {e}"))
    })
    .await??;

    log::info!(
        "parallel::build_index: merged row_group indices into single tantivy index, elapsed={:?} ms",
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

/// Synchronously builds the tantivy segment for exactly one parquet row_group.
/// Runs in `spawn_blocking` — uses only sync APIs and no `.await`.
fn build_row_group_segment_sync(
    rg_idx: usize,
    buf: Bytes,
    index_schema: TantivyIndexSchema,
) -> Result<(usize, tantivy::Index, usize), anyhow::Error> {
    let builder = ParquetRecordBatchReaderBuilder::try_new(buf)
        .with_context(|| format!("worker {rg_idx}: open parquet"))?;
    let reader = builder
        .with_row_groups(vec![rg_idx])
        .build()
        .with_context(|| format!("worker {rg_idx}: build row_group reader"))?;

    // The `TempDir` handle is owned by the directory, so
    // when the directory (and the merged `Index` referencing it)
    // is dropped, the tempdir is cleaned up automatically.
    let dir = MmapDirectory::create_from_tempdir()
        .with_context(|| format!("worker {rg_idx}: create tempdir-backed mmap directory"))?;
    let tokenizer_manager = tantivy::tokenizer::TokenizerManager::default();
    tokenizer_manager.register(O2_TOKENIZER, o2_tokenizer_build(CollectType::Ingest));
    let mut writer = tantivy::IndexBuilder::new()
        .schema(index_schema.schema.clone())
        .tokenizers(tokenizer_manager)
        .single_segment_index_writer::<tantivy::TantivyDocument>(dir, 50_000_000)
        .with_context(|| format!("worker {rg_idx}: create index writer"))?;

    let mut rg_rows: usize = 0;
    for batch_res in reader {
        let batch =
            batch_res.with_context(|| format!("worker {rg_idx}: read batch from row_group"))?;
        if batch.num_rows() == 0 {
            continue;
        }
        rg_rows += batch.num_rows();
        let docs = convert_batch_to_docs_sync(&batch, &index_schema);
        for doc in docs {
            writer
                .add_document(doc)
                .with_context(|| format!("worker {rg_idx}: add_document"))?;
        }
    }

    let index = writer
        .finalize()
        .with_context(|| format!("worker {rg_idx}: finalize"))?;

    Ok((rg_idx, index, rg_rows))
}
