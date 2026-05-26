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

//! Legacy single-threaded tantivy index builder.
//!
//! Consumes a [`RecordBatchStream`] sequentially and feeds documents to a
//! single [`SingleSegmentIndexWriter`] in stream order. This is what runs when
//! `compact.tantivy_parallel_build_workers == 0` (default) and also the
//! fallback for non-parquet inputs (e.g. Vortex) where row_group dispatch is
//! not applicable.
//!
//! See [`super::parallel`] for the row_group-parallel path enabled by the
//! `workers > 0` config.

use std::sync::Arc;

use anyhow::Context;
use arrow::array::{
    Array, BooleanArray, Float64Array, Int64Array, LargeStringArray, StringArray, StringViewArray,
    UInt64Array,
};
use arrow_schema::Schema;
use config::{TIMESTAMP_COL_NAME, utils::parquet::RecordBatchStream};
use futures::TryStreamExt;
use tokio::task::JoinHandle;

use super::{build_tantivy_schema_for_index, make_index_tokenizer_manager};

// macro to reduce duplication in array processing
macro_rules! process_string_array {
    ($data:expr, $array_type:ty, $docs:expr, $field:expr) => {
        if let Some(array) = $data.as_any().downcast_ref::<$array_type>() {
            for (i, doc) in $docs.iter_mut().enumerate() {
                if array.is_null(i) {
                    doc.add_text($field, "");
                } else {
                    doc.add_text($field, array.value(i));
                }
                tokio::task::coop::consume_budget().await;
            }
            continue;
        }
    };
}

// macro to reduce duplication in array processing
macro_rules! process_numeric_array {
    ($data:expr, $array_type:ty, $docs:expr, $field:expr) => {
        if let Some(array) = $data.as_any().downcast_ref::<$array_type>() {
            for (i, doc) in $docs.iter_mut().enumerate() {
                if array.is_null(i) {
                    doc.add_text($field, "");
                } else {
                    let text = array.value(i).to_string();
                    doc.add_text($field, &text);
                }
                tokio::task::coop::consume_budget().await;
            }
            continue;
        }
    };
}

/// Create a tantivy index in the given directory for the record batch stream.
///
/// This is the legacy path: a single producer task pulls `RecordBatch`es from
/// `reader`, converts them to `TantivyDocument`s on the runtime thread, and
/// pushes them through a small mpsc channel to a single `SingleSegmentIndexWriter`
/// that processes them in arrival order.
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
    let mut index_writer = tantivy::IndexBuilder::new()
        .schema(tantivy_schema.clone())
        .tokenizers(tokenizer_manager)
        .single_segment_index_writer(tantivy_dir, 50_000_000)
        .context("failed to create index builder")?;

    // docs per row to be added in the tantivy index
    log::debug!("start write documents to tantivy index");
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<tantivy::TantivyDocument>>(2);
    let task: JoinHandle<Result<usize, anyhow::Error>> = tokio::task::spawn(async move {
        let mut total_num_rows = 0;
        let mut reader = reader;
        loop {
            let batch = reader.try_next().await?;
            let Some(inverted_idx_batch) = batch else {
                break;
            };
            let num_rows = inverted_idx_batch.num_rows();
            if num_rows == 0 {
                continue;
            }

            // update total_num_rows
            total_num_rows += num_rows;

            // process full text search fields
            let mut docs = vec![tantivy::doc!(); num_rows];
            for column_name in tantivy_fields.iter() {
                // get field
                let field = match tantivy_schema.get_field(column_name) {
                    Ok(f) => f,
                    Err(_) => fts_field.unwrap(),
                };

                // get column data and convert to strings for indexing
                if let Some(data) = inverted_idx_batch.column_by_name(column_name) {
                    // handle string types directly
                    process_string_array!(data, StringViewArray, docs, field);
                    process_string_array!(data, StringArray, docs, field);
                    process_string_array!(data, LargeStringArray, docs, field);

                    // handle numeric and boolean types with to_string conversion
                    process_numeric_array!(data, Int64Array, docs, field);
                    process_numeric_array!(data, UInt64Array, docs, field);
                    process_numeric_array!(data, Float64Array, docs, field);
                    process_numeric_array!(data, BooleanArray, docs, field);

                    // unsupported type, add empty string
                    for doc in docs.iter_mut() {
                        doc.add_text(field, "");
                        tokio::task::coop::consume_budget().await;
                    }
                } else {
                    // column not found, add empty string
                    for doc in docs.iter_mut() {
                        doc.add_text(field, "");
                        tokio::task::coop::consume_budget().await;
                    }
                }
            }

            // process _timestamp field
            let column_data = match inverted_idx_batch.column_by_name(TIMESTAMP_COL_NAME) {
                Some(column_data) => match column_data.as_any().downcast_ref::<Int64Array>() {
                    Some(column_data) => column_data,
                    None => {
                        // generate empty array to ensure the tantivy and parquet have same rows
                        &Int64Array::from(vec![0; num_rows])
                    }
                },
                None => {
                    // generate empty array to ensure the tantivy and parquet have same rows
                    &Int64Array::from(vec![0; num_rows])
                }
            };
            let ts_field = tantivy_schema.get_field(TIMESTAMP_COL_NAME).unwrap(); // unwrap directly since added above
            const YIELD_THRESHOLD: usize = 100;
            let mut batch_size = 0;
            for (i, doc) in docs.iter_mut().enumerate() {
                doc.add_i64(ts_field, column_data.value(i));
                batch_size += 1;
                if batch_size >= YIELD_THRESHOLD {
                    tokio::task::coop::consume_budget().await;
                    batch_size = 0;
                }
            }

            tx.send(docs).await?;
        }
        Ok(total_num_rows)
    });

    while let Some(docs) = rx.recv().await {
        for doc in docs {
            if let Err(e) = index_writer.add_document(doc) {
                log::error!("generate_tantivy_index: Failed to add document to index: {e}");
                return Err(anyhow::anyhow!("Failed to add document to index: {}", e));
            }
            tokio::task::coop::consume_budget().await;
        }
    }
    let total_num_rows = task.await??;
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
