// Copyright 2025 OpenObserve Inc.
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

pub mod puffin;
pub mod puffin_directory;

use std::{collections::HashMap, sync::Arc};

use anyhow::Context;
use arrow::array::{Array, Int64Array, StringArray};
use arrow_schema::{DataType, Schema};
use bytes::Bytes;
use config::{
    INDEX_FIELD_NAME_FOR_ALL, TIMESTAMP_COL_NAME, get_config,
    utils::{
        inverted_index::convert_parquet_idx_file_name_to_tantivy_file,
        tantivy::tokenizer::{O2_TOKENIZER, o2_tokenizer_build},
    },
};
use futures::TryStreamExt;
use hashbrown::HashSet;
use infra::storage;
use parquet::arrow::async_reader::ParquetRecordBatchStream;
use puffin_directory::writer::PuffinDirWriter;
use tokio::task::JoinHandle;

pub(crate) async fn create_tantivy_index(
    caller: &str,
    parquet_file_name: &str,
    full_text_search_fields: &[String],
    index_fields: &[String],
    schema: Arc<Schema>,
    reader: ParquetRecordBatchStream<std::io::Cursor<Bytes>>,
) -> Result<usize, anyhow::Error> {
    let start = std::time::Instant::now();
    let caller = format!("[{caller}:JOB]");

    let dir = PuffinDirWriter::new();
    let index = generate_tantivy_index(
        dir.clone(),
        reader,
        full_text_search_fields,
        index_fields,
        schema,
    )
    .await?;
    if index.is_none() {
        return Ok(0);
    }
    let puffin_bytes = dir.to_puffin_bytes()?;
    let index_size = puffin_bytes.len();

    // write fst bytes into disk
    let Some(idx_file_name) = convert_parquet_idx_file_name_to_tantivy_file(parquet_file_name)
    else {
        return Ok(0);
    };

    if get_config().cache_latest_files.cache_index
        && get_config().cache_latest_files.download_from_node
    {
        infra::cache::file_data::disk::set(&idx_file_name, Bytes::from(puffin_bytes.clone()))
            .await?;
        log::info!("file: {idx_file_name} file_data::disk::set success");
    }

    // the index file is stored in the same account as the parquet file
    let account = storage::get_account(parquet_file_name).unwrap_or_default();
    match storage::put(&account, &idx_file_name, Bytes::from(puffin_bytes)).await {
        Ok(_) => {
            log::info!(
                "{} generated tantivy index file: {}, size {}, took: {} ms",
                caller,
                idx_file_name,
                index_size,
                start.elapsed().as_millis()
            );
        }
        Err(e) => {
            log::error!(
                "{} generated tantivy index file error: {}",
                caller,
                e.to_string()
            );
            return Err(e.into());
        }
    }
    Ok(index_size)
}

/// Create a tantivy index in the given directory for the record batch
pub(crate) async fn generate_tantivy_index<D: tantivy::Directory>(
    tantivy_dir: D,
    mut reader: ParquetRecordBatchStream<std::io::Cursor<Bytes>>,
    full_text_search_fields: &[String],
    index_fields: &[String],
    schema: Arc<Schema>,
) -> Result<Option<tantivy::Index>, anyhow::Error> {
    let mut tantivy_schema_builder = tantivy::schema::SchemaBuilder::new();
    let schema_fields = schema
        .fields()
        .iter()
        .map(|f| (f.name(), f))
        .collect::<HashMap<_, _>>();

    // filter out fields that are not in schema & not of type Utf8
    let fts_fields = full_text_search_fields
        .iter()
        .filter(|f| {
            schema_fields
                .get(f)
                .map(|v| v.data_type() == &DataType::Utf8)
                .is_some()
        })
        .map(|f| f.to_string())
        .collect::<HashSet<_>>();
    let index_fields = index_fields
        .iter()
        .map(|f| f.to_string())
        .collect::<HashSet<_>>();
    let tantivy_fields = fts_fields
        .union(&index_fields)
        .cloned()
        .collect::<HashSet<_>>();
    // no fields need to create index, return
    if tantivy_fields.is_empty() {
        return Ok(None);
    }

    // add fields to tantivy schema
    if !full_text_search_fields.is_empty() {
        let fts_opts = tantivy::schema::TextOptions::default().set_indexing_options(
            tantivy::schema::TextFieldIndexing::default()
                .set_index_option(tantivy::schema::IndexRecordOption::Basic)
                .set_tokenizer(O2_TOKENIZER)
                .set_fieldnorms(false),
        );
        tantivy_schema_builder.add_text_field(INDEX_FIELD_NAME_FOR_ALL, fts_opts);
    }
    for field in index_fields.iter() {
        if field == TIMESTAMP_COL_NAME {
            continue;
        }
        let index_opts = tantivy::schema::TextOptions::default().set_indexing_options(
            tantivy::schema::TextFieldIndexing::default()
                .set_index_option(tantivy::schema::IndexRecordOption::Basic)
                .set_tokenizer("raw")
                .set_fieldnorms(false),
        );
        tantivy_schema_builder.add_text_field(field, index_opts);
    }
    // add _timestamp field to tantivy schema
    tantivy_schema_builder.add_i64_field(TIMESTAMP_COL_NAME, tantivy::schema::FAST);
    let tantivy_schema = tantivy_schema_builder.build();
    let fts_field = tantivy_schema.get_field(INDEX_FIELD_NAME_FOR_ALL).ok();

    let tokenizer_manager = tantivy::tokenizer::TokenizerManager::default();
    tokenizer_manager.register(O2_TOKENIZER, o2_tokenizer_build());
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
                let column_data = match inverted_idx_batch.column_by_name(column_name) {
                    Some(column_data) => match column_data.as_any().downcast_ref::<StringArray>() {
                        Some(column_data) => column_data,
                        None => {
                            // generate empty array to ensure the tantivy and parquet have same rows
                            &StringArray::from(vec![""; num_rows])
                        }
                    },
                    None => {
                        // generate empty array to ensure the tantivy and parquet have same rows
                        &StringArray::from(vec![""; num_rows])
                    }
                };

                // get field
                let field = match tantivy_schema.get_field(column_name) {
                    Ok(f) => f,
                    Err(_) => fts_field.unwrap(),
                };
                for (i, doc) in docs.iter_mut().enumerate() {
                    doc.add_text(field, column_data.value(i));
                    tokio::task::coop::consume_budget().await;
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
                log::error!(
                    "generate_tantivy_index: Failed to add document to index: {}",
                    e
                );
                return Err(anyhow::anyhow!("Failed to add document to index: {}", e));
            }
            tokio::task::coop::consume_budget().await;
        }
    }
    let total_num_rows = task.await??;
    // no docs need to create index, return
    if total_num_rows == 0 {
        return Ok(None);
    }
    log::debug!("write documents to tantivy index success");

    let index = tokio::task::spawn_blocking(move || {
        index_writer.finalize().map_err(|e| {
            log::error!(
                "generate_tantivy_index: Failed to finalize the index writer: {}",
                e
            );
            anyhow::anyhow!("Failed to finalize the index writer: {}", e)
        })
    })
    .await??;

    Ok(Some(index))
}
