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

//! Unified entry point for parallel tantivy index builders.
//!
//! Routes to a format-specific implementation based on `file_format`:
//!   - Parquet → row-group-direct parallel build ([`parquet::build_index`])
//!   - Vortex (with `vortex` feature) → row-range-direct parallel build ([`vortex::build_index`])
//!   - Vortex (without `vortex` feature) → falls back to the sequential path so callers don't have
//!     to gate themselves on the feature flag.
//!
//! All implementations preserve `doc_id == global_row_index` so the puffin
//! `PROP_ROW_GROUP_SIZE` doc_id → row mapping stays valid downstream.

mod parquet;
#[cfg(all(feature = "vortex", feature = "enterprise"))]
mod vortex;

use std::sync::Arc;

use anyhow::{Context, Error};
use bytes::Bytes;
use config::{
    FileFormat, TIMESTAMP_COL_NAME,
    utils::tantivy::tokenizer::{CollectType, O2_TOKENIZER, o2_tokenizer_build},
};
use tantivy::directory::MmapDirectory;
use tokio::task::JoinHandle;

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
            parquet::build_index(tantivy_dir, buf, index_schema, thread_num).await
        }
        #[cfg(all(feature = "vortex", feature = "enterprise"))]
        FileFormat::Vortex => vortex::build_index(tantivy_dir, buf, index_schema, thread_num).await,
        #[cfg(not(all(feature = "vortex", feature = "enterprise")))]
        FileFormat::Vortex => {
            // Vortex feature disabled — fall through to the single-threaded
            // path. We don't surface this as an error because the same binary
            // is supposed to compile both ways.
            super::sequential::build_index(tantivy_dir, file_format, buf, index_schema).await
        }
    }
}

struct SegmentOutput {
    chunk_idx: usize,
    index: tantivy::Index,
    row_count: usize,
}

/// Common parallel scaffold shared by both format entry points.
///
/// `num_chunks`: how many independent segments to build; `0` returns `Ok(None)`.
/// `make_selector`: called once per chunk index to produce the [`ChunkSelector`]
/// that the segment worker passes to the reader.
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

    // Await all tasks concurrently, then sort to restore chunk order.
    let mut indexed: Vec<SegmentOutput> = Vec::with_capacity(tasks.len());
    for r in futures::future::join_all(tasks).await {
        indexed.push(r??);
    }
    indexed.sort_by_key(|s| s.chunk_idx);
    let total_rows: usize = indexed.iter().map(|s| s.row_count).sum();
    let indices: Vec<tantivy::Index> = indexed.into_iter().map(|s| s.index).collect();

    log::info!(
        "parallel::build_index: built {num_chunks} chunks, rows={total_rows}, thread_num={thread_num}, elapsed={} ms",
        start.elapsed().as_millis()
    );

    let start = std::time::Instant::now();
    let merged = tokio::task::spawn_blocking(move || {
        tantivy::indexer::merge_indices(&indices, tantivy_dir)
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
        let batch = batch_res.with_context(|| format!("chunk {chunk_idx}: scan failed"))?;
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
