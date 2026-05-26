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

//! Single-segment, stream-order tantivy index builder.
//!
//! Consumes a [`RecordBatchStream`] sequentially and feeds documents to a
//! single [`SingleSegmentIndexWriter`] in stream order. This is what runs when
//! `compact.tantivy_parallel_build_workers == 0` (default) and also the
//! fallback for non-parquet inputs (e.g. Vortex) where row_group dispatch is
//! not applicable.
//!
//! Pipeline:
//!   async producer (stream pull)  ──mpsc(RecordBatch, cap=2)──▶  blocking worker
//!                                                                (convert + add_doc)
//!
//! The blocking worker owns the `SingleSegmentIndexWriter` and runs all of the
//! per-row CPU work — batch→docs conversion and `add_document` encoding — on a
//! `spawn_blocking` thread. This is the same shape `parallel.rs` uses; the only
//! reason there is one worker here instead of N is that the legacy path must
//! preserve global row order for non-parquet inputs.
//!
//! See [`super::parallel`] for the row_group-parallel path enabled by the
//! `workers > 0` config.

use std::sync::Arc;

use anyhow::Context;
use arrow::array::RecordBatch;
use arrow_schema::Schema;
use config::utils::parquet::RecordBatchStream;
use futures::TryStreamExt;
use tokio::task::JoinHandle;

use super::{
    build_tantivy_schema_for_index, convert_batch_to_docs_sync, make_index_tokenizer_manager,
};

/// Create a tantivy index in the given directory for the record batch stream.
///
/// Single producer task pulls `RecordBatch`es from `reader` and forwards them
/// over a small bounded channel to one `spawn_blocking` writer worker that
/// converts each batch into `TantivyDocument`s and feeds them to a
/// `SingleSegmentIndexWriter` in arrival order.
pub(super) async fn generate_tantivy_index<D: tantivy::Directory>(
    tantivy_dir: D,
    reader: RecordBatchStream,
    full_text_search_fields: &[String],
    index_fields: &[String],
    schema: Arc<Schema>,
) -> Result<Option<tantivy::Index>, anyhow::Error> {
    let Some((tantivy_schema, tantivy_fields, fts_field)) =
        build_tantivy_schema_for_index(full_text_search_fields, index_fields, &schema)
    else {
        return Ok(None);
    };

    let tokenizer_manager = make_index_tokenizer_manager();
    let index_writer = tantivy::IndexBuilder::new()
        .schema(tantivy_schema.clone())
        .tokenizers(tokenizer_manager)
        .single_segment_index_writer(tantivy_dir, 50_000_000)
        .context("failed to create index builder")?;

    log::debug!("start write documents to tantivy index");

    // Cap=2 gives one batch in flight for the worker plus one queued, which is
    // enough to overlap stream I/O with indexing CPU without piling up memory.
    let (tx, rx) = tokio::sync::mpsc::channel::<RecordBatch>(2);

    // Async producer: pulls batches off the (possibly I/O-bound) stream and
    // forwards them. send().await applies backpressure when the worker falls
    // behind. The producer holds the only `tx`; dropping it on completion is
    // what signals end-of-stream to the worker.
    let producer: JoinHandle<Result<usize, anyhow::Error>> = tokio::task::spawn(async move {
        let mut total_num_rows = 0usize;
        let mut reader = reader;
        while let Some(batch) = reader.try_next().await? {
            let num_rows = batch.num_rows();
            if num_rows == 0 {
                continue;
            }
            total_num_rows += num_rows;
            if tx.send(batch).await.is_err() {
                // Worker exited (likely an error on its side); stop reading.
                break;
            }
        }
        Ok(total_num_rows)
    });

    // Blocking writer worker: owns the SingleSegmentIndexWriter and runs all
    // per-row CPU work off the runtime. Eliminates both the per-row
    // consume_budget.await overhead of the previous implementation and the
    // tail-latency hit from doing tantivy's synchronous add_document on a
    // runtime thread.
    let mut rx = rx;
    let schema_for_worker = tantivy_schema.clone();
    let writer_task: JoinHandle<Result<_, anyhow::Error>> =
        tokio::task::spawn_blocking(move || {
            let mut writer = index_writer;
            while let Some(batch) = rx.blocking_recv() {
                let docs = convert_batch_to_docs_sync(
                    &batch,
                    &schema_for_worker,
                    &tantivy_fields,
                    fts_field,
                );
                for doc in docs {
                    writer
                        .add_document(doc)
                        .map_err(|e| anyhow::anyhow!("Failed to add document to index: {}", e))?;
                }
            }
            Ok(writer)
        });

    // Producer finishes first (drains the stream and drops tx); the worker
    // then sees the channel close and exits.
    let total_num_rows = producer.await??;
    let index_writer = writer_task.await??;

    // Create index even with 0 rows since we have valid configured fields in stream schema
    // (empty index acts as a marker to prevent expensive DataFusion scans)
    log::debug!(
        "write documents to tantivy index success (rows: {}, empty_index: {})",
        total_num_rows,
        total_num_rows == 0
    );

    let index = tokio::task::spawn_blocking(move || {
        index_writer.finalize().map_err(|e| {
            log::error!("generate_tantivy_index: Failed to finalize the index writer: {e}");
            anyhow::anyhow!("Failed to finalize the index writer: {}", e)
        })
    })
    .await??;

    Ok(Some(index))
}
