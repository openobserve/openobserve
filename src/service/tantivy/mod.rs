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
use arrow::array::{Array, BooleanArray, Float64Array, Int64Array, StringArray, UInt64Array};
use arrow_schema::{DataType, Schema};
use bytes::Bytes;
use config::{
    INDEX_FIELD_NAME_FOR_ALL, TIMESTAMP_COL_NAME, get_config,
    utils::{
        inverted_index::convert_parquet_file_name_to_tantivy_file,
        tantivy::tokenizer::{CollectType, O2_TOKENIZER, o2_tokenizer_build},
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
    let Some(idx_file_name) = convert_parquet_file_name_to_tantivy_file(parquet_file_name) else {
        return Ok(0);
    };

    let cfg = get_config();
    if cfg.cache_latest_files.enabled
        && cfg.cache_latest_files.cache_index
        && cfg.cache_latest_files.download_from_node
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
            log::error!("{caller} generated tantivy index file error: {e}");
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
                .map(|v| v.data_type() == &DataType::Utf8 || v.data_type() == &DataType::LargeUtf8)
                .is_some()
        })
        .map(String::from)
        .collect::<HashSet<_>>();
    let index_fields = index_fields
        .iter()
        .filter(|f| schema_fields.contains_key(f))
        .map(String::from)
        .collect::<HashSet<_>>();
    let tantivy_fields = fts_fields
        .union(&index_fields)
        .cloned()
        .collect::<HashSet<_>>();

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

    let index_opts = tantivy::schema::TextOptions::default()
        .set_indexing_options(
            tantivy::schema::TextFieldIndexing::default()
                .set_index_option(tantivy::schema::IndexRecordOption::Basic)
                .set_tokenizer("raw")
                .set_fieldnorms(false),
        )
        .set_fast(None);
    for field in index_fields.iter() {
        if field == TIMESTAMP_COL_NAME {
            continue;
        }
        tantivy_schema_builder.add_text_field(field, index_opts.clone());
    }
    // add _timestamp field to tantivy schema
    tantivy_schema_builder.add_i64_field(TIMESTAMP_COL_NAME, tantivy::schema::FAST);
    let tantivy_schema = tantivy_schema_builder.build();
    let fts_field = tantivy_schema.get_field(INDEX_FIELD_NAME_FOR_ALL).ok();

    let tokenizer_manager = tantivy::tokenizer::TokenizerManager::default();
    tokenizer_manager.register(O2_TOKENIZER, o2_tokenizer_build(CollectType::Ingest));
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
                // utf8, uint64, int64, float64, boolean
                let column_data = match inverted_idx_batch.column_by_name(column_name) {
                    Some(data) => {
                        if let Some(array) = data.as_any().downcast_ref::<StringArray>() {
                            array
                        } else if let Some(array) = data.as_any().downcast_ref::<Int64Array>() {
                            // convert to string array
                            &StringArray::from(
                                array
                                    .values()
                                    .iter()
                                    .map(|v| v.to_string())
                                    .collect::<Vec<_>>(),
                            )
                        } else if let Some(array) = data.as_any().downcast_ref::<UInt64Array>() {
                            // convert to string array
                            &StringArray::from(
                                array
                                    .values()
                                    .iter()
                                    .map(|v| v.to_string())
                                    .collect::<Vec<_>>(),
                            )
                        } else if let Some(array) = data.as_any().downcast_ref::<BooleanArray>() {
                            // convert to string array
                            &StringArray::from(
                                array
                                    .values()
                                    .iter()
                                    .map(|v| v.to_string())
                                    .collect::<Vec<_>>(),
                            )
                        } else if let Some(array) = data.as_any().downcast_ref::<Float64Array>() {
                            // convert to string array
                            &StringArray::from(
                                array
                                    .values()
                                    .iter()
                                    .map(|v| v.to_string())
                                    .collect::<Vec<_>>(),
                            )
                        } else {
                            // generate empty array to ensure the tantivy and parquet have same rows
                            &StringArray::from(vec![""; num_rows])
                        }
                    }
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

#[cfg(test)]
mod tests {
    use std::{io::Cursor, sync::Arc};

    use arrow::{
        array::{Int64Array, StringArray},
        datatypes::{DataType, Field, Schema},
        record_batch::RecordBatch,
    };
    use bytes::Bytes;
    use config::{INDEX_FIELD_NAME_FOR_ALL, TIMESTAMP_COL_NAME};
    use parquet::arrow::async_reader::ParquetRecordBatchStream;
    use tantivy::directory::RamDirectory;

    use super::*;

    // Helper function to create test record batches
    fn create_test_batch(
        num_rows: usize,
        include_timestamp: bool,
        include_fts_field: bool,
        include_index_field: bool,
    ) -> RecordBatch {
        let mut fields = Vec::new();
        let mut columns: Vec<Arc<dyn arrow::array::Array>> = Vec::new();

        // Add timestamp field if requested
        if include_timestamp {
            fields.push(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false));
            let timestamps: Vec<i64> = (0..num_rows).map(|i| 1000 + i as i64).collect();
            columns.push(Arc::new(Int64Array::from(timestamps)));
        }

        // Add full-text search field if requested
        if include_fts_field {
            fields.push(Field::new("content", DataType::Utf8, false));
            let content: Vec<String> = (0..num_rows)
                .map(|i| format!("Test content number {i}"))
                .collect();
            columns.push(Arc::new(StringArray::from(content)));
        }

        // Add index field if requested
        if include_index_field {
            fields.push(Field::new("status", DataType::Utf8, false));
            let status: Vec<String> = (0..num_rows)
                .map(|i| {
                    if i.is_multiple_of(2) {
                        "success".to_string()
                    } else {
                        "error".to_string()
                    }
                })
                .collect();
            columns.push(Arc::new(StringArray::from(status)));
        }

        let schema = Arc::new(Schema::new(fields));
        RecordBatch::try_new(schema, columns).unwrap()
    }

    // Helper function to create a mock ParquetRecordBatchStream
    async fn create_test_stream(
        batches: Vec<RecordBatch>,
    ) -> ParquetRecordBatchStream<Cursor<Bytes>> {
        // Create a simple parquet file from the batches
        let schema = batches[0].schema();
        let mut buffer = Vec::new();

        // Use the parquet writer utilities from config
        let file_meta = config::meta::stream::FileMeta {
            min_ts: 1000,
            max_ts: 2000,
            records: batches.iter().map(|b| b.num_rows()).sum::<usize>() as i64,
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

        for batch in batches {
            writer.write(&batch).await.unwrap();
        }
        writer.close().await.unwrap();

        // Create stream from the buffer
        let bytes = Bytes::from(buffer);
        let cursor = Cursor::new(bytes);
        parquet::arrow::async_reader::ParquetRecordBatchStreamBuilder::new(cursor)
            .await
            .unwrap()
            .with_batch_size(1000)
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_empty_data() {
        let dir = RamDirectory::create();
        let empty_batch = create_test_batch(0, true, true, true);
        let stream = create_test_stream(vec![empty_batch.clone()]).await;

        let result = generate_tantivy_index(
            dir,
            stream,
            &["content".to_string()],
            &["status".to_string()],
            empty_batch.schema(),
        )
        .await;

        assert!(result.is_ok());
        // Should create empty index when fields are configured (even with 0 rows)
        assert!(result.unwrap().is_some());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_no_fields() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, true, true, true);
        let stream = create_test_stream(vec![batch.clone()]).await;

        let result = generate_tantivy_index(
            dir,
            stream,
            &[], // No full-text search fields
            &[], // No index fields
            batch.schema(),
        )
        .await;

        assert!(result.is_ok());
        assert!(result.unwrap().is_none()); // Should return None when no fields to index
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_with_fts_fields() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, true, true, false);
        let stream = create_test_stream(vec![batch.clone()]).await;

        let result =
            generate_tantivy_index(dir, stream, &["content".to_string()], &[], batch.schema())
                .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        // Verify the index has the expected schema
        let index = index.unwrap();
        let schema = index.schema();
        assert!(schema.get_field(INDEX_FIELD_NAME_FOR_ALL).is_ok());
        assert!(schema.get_field(TIMESTAMP_COL_NAME).is_ok());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_with_index_fields() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, true, false, true);
        let stream = create_test_stream(vec![batch.clone()]).await;

        let result =
            generate_tantivy_index(dir, stream, &[], &["status".to_string()], batch.schema()).await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        // Verify the index has the expected schema
        let index = index.unwrap();
        let schema = index.schema();
        assert!(schema.get_field("status").is_ok());
        assert!(schema.get_field(TIMESTAMP_COL_NAME).is_ok());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_with_both_field_types() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, true, true, true);
        let stream = create_test_stream(vec![batch.clone()]).await;

        let result = generate_tantivy_index(
            dir,
            stream,
            &["content".to_string()],
            &["status".to_string()],
            batch.schema(),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        // Verify the index has the expected schema
        let index = index.unwrap();
        let schema = index.schema();
        assert!(schema.get_field(INDEX_FIELD_NAME_FOR_ALL).is_ok());
        assert!(schema.get_field("status").is_ok());
        assert!(schema.get_field(TIMESTAMP_COL_NAME).is_ok());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_missing_fields_in_schema() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, true, true, true);
        let stream = create_test_stream(vec![batch.clone()]).await;

        // Request fields that don't exist in the schema at all
        let result = generate_tantivy_index(
            dir,
            stream,
            &["nonexistent_field".to_string()],
            &["another_nonexistent_field".to_string()],
            batch.schema(),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        // Should NOT create index when configured fields don't exist in stream schema
        // (this indicates a configuration error, not just missing data)
        assert!(index.is_none());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_mixed_existing_and_missing_fields() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, true, true, true);
        let stream = create_test_stream(vec![batch.clone()]).await;

        // Mix of existing and non-existing fields
        let result = generate_tantivy_index(
            dir,
            stream,
            &["content".to_string(), "nonexistent_field".to_string()],
            &[
                "status".to_string(),
                "another_nonexistent_field".to_string(),
            ],
            batch.schema(),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        // Verify the index has only the existing fields
        let index = index.unwrap();
        let schema = index.schema();
        assert!(schema.get_field(INDEX_FIELD_NAME_FOR_ALL).is_ok());
        assert!(schema.get_field("status").is_ok());
        assert!(schema.get_field(TIMESTAMP_COL_NAME).is_ok());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_multiple_batches() {
        let dir = RamDirectory::create();
        let batch1 = create_test_batch(5, true, true, true);
        let batch2 = create_test_batch(5, true, true, true);
        let stream = create_test_stream(vec![batch1.clone(), batch2.clone()]).await;

        let result = generate_tantivy_index(
            dir,
            stream,
            &["content".to_string()],
            &["status".to_string()],
            batch1.schema(),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        // Verify the index was created successfully
        let index = index.unwrap();
        let schema = index.schema();
        assert!(schema.get_field(INDEX_FIELD_NAME_FOR_ALL).is_ok());
        assert!(schema.get_field("status").is_ok());
        assert!(schema.get_field(TIMESTAMP_COL_NAME).is_ok());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_without_timestamp() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, false, true, true);
        let stream = create_test_stream(vec![batch.clone()]).await;

        let result = generate_tantivy_index(
            dir,
            stream,
            &["content".to_string()],
            &["status".to_string()],
            batch.schema(),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        // Verify the index has the expected schema (including timestamp field added by the
        // function)
        let index = index.unwrap();
        let schema = index.schema();
        assert!(schema.get_field(INDEX_FIELD_NAME_FOR_ALL).is_ok());
        assert!(schema.get_field("status").is_ok());
        assert!(schema.get_field(TIMESTAMP_COL_NAME).is_ok());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_non_string_fields() {
        // Create a batch with non-string fields in the schema
        let fields = vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("content", DataType::Utf8, false),
            Field::new("number_field", DataType::Int32, false), // Non-string field
        ];

        let schema = Arc::new(Schema::new(fields));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1000, 1001, 1002])),
                Arc::new(StringArray::from(vec!["content1", "content2", "content3"])),
                Arc::new(arrow::array::Int32Array::from(vec![1, 2, 3])),
            ],
        )
        .unwrap();

        let dir = RamDirectory::create();
        let stream = create_test_stream(vec![batch.clone()]).await;

        // Try to index the non-string field
        let result = generate_tantivy_index(
            dir,
            stream,
            &["content".to_string()],
            &["number_field".to_string()], // This field is not Utf8
            batch.schema(),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        // Verify that both fields are indexed (index fields are not filtered by data type)
        let index = index.unwrap();
        let schema = index.schema();
        assert!(schema.get_field(INDEX_FIELD_NAME_FOR_ALL).is_ok());
        assert!(schema.get_field("number_field").is_ok()); // Non-string fields are still indexed
        assert!(schema.get_field(TIMESTAMP_COL_NAME).is_ok());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_timestamp_field_handling() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, true, true, true);
        let stream = create_test_stream(vec![batch.clone()]).await;

        // Try to index the timestamp field as a regular index field
        let result = generate_tantivy_index(
            dir,
            stream,
            &["content".to_string()],
            &[TIMESTAMP_COL_NAME.to_string()], // This should be ignored
            batch.schema(),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        // Verify that timestamp field is handled specially
        let index = index.unwrap();
        let schema = index.schema();
        assert!(schema.get_field(INDEX_FIELD_NAME_FOR_ALL).is_ok());
        assert!(schema.get_field(TIMESTAMP_COL_NAME).is_ok());

        // Verify that the timestamp field is indexed as Int64, not as text
        let ts_field = schema.get_field(TIMESTAMP_COL_NAME).unwrap();
        assert!(matches!(
            schema.get_field_entry(ts_field).field_type(),
            tantivy::schema::FieldType::I64(_)
        ));
    }

    #[tokio::test]
    async fn test_create_tantivy_index_with_empty_data() {
        let empty_batch = create_test_batch(0, true, true, true);
        let stream = create_test_stream(vec![empty_batch.clone()]).await;

        // Test that create_tantivy_index returns 0 for empty data
        let result = create_tantivy_index(
            "test_caller",
            "test_file.parquet",
            &["content".to_string()],
            &["status".to_string()],
            empty_batch.schema(),
            stream,
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0); // Should return 0 for empty data
    }

    #[tokio::test]
    async fn test_create_tantivy_index_with_no_fields() {
        let batch = create_test_batch(10, true, true, true);
        let stream = create_test_stream(vec![batch.clone()]).await;

        // Test that create_tantivy_index returns 0 when no fields to index
        let result = create_tantivy_index(
            "test_caller",
            "test_file.parquet",
            &[], // No FTS fields
            &[], // No index fields
            batch.schema(),
            stream,
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0); // Should return 0 when no fields to index
    }

    #[tokio::test]
    async fn test_create_tantivy_index_with_invalid_parquet_filename() {
        let batch = create_test_batch(10, true, true, true);
        let stream = create_test_stream(vec![batch.clone()]).await;

        // Test with an invalid parquet filename that won't convert to tantivy filename
        let result = create_tantivy_index(
            "test_caller",
            "invalid_filename", // This won't convert to a valid tantivy filename
            &["content".to_string()],
            &["status".to_string()],
            batch.schema(),
            stream,
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0); // Should return 0 when filename conversion fails
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_stream_schema_vs_parquet_schema() {
        // This test validates the critical fix where we pass stream schema (with all
        // configured fields) instead of parquet schema (only fields in actual data).
        //
        // Scenario: Stream settings configure `continent`, `name`, `flag_url` as secondary
        // index fields, but the parquet data only contains `name` and `flag_url`.
        // The missing field `continent` should still be included in the .ttv schema.

        let dir = RamDirectory::create();

        // Create parquet data with only `name` and `flag_url` (no `continent`)
        let parquet_fields = vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("flag_url", DataType::Utf8, false),
        ];
        let parquet_schema = Arc::new(Schema::new(parquet_fields));

        let timestamps: Vec<i64> = (0..10).map(|i| 1000 + i as i64).collect();
        let names: Vec<String> = (0..10).map(|i| format!("Name {i}")).collect();
        let flag_urls: Vec<String> = (0..10)
            .map(|i| format!("https://example.com/{i}"))
            .collect();

        let parquet_batch = RecordBatch::try_new(
            parquet_schema.clone(),
            vec![
                Arc::new(Int64Array::from(timestamps)),
                Arc::new(StringArray::from(names)),
                Arc::new(StringArray::from(flag_urls)),
            ],
        )
        .unwrap();

        // Create stream schema with all configured fields including `continent`
        let stream_fields = vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("continent", DataType::Utf8, false), // Configured but not in data
            Field::new("name", DataType::Utf8, false),
            Field::new("flag_url", DataType::Utf8, false),
        ];
        let stream_schema = Arc::new(Schema::new(stream_fields));

        let stream = create_test_stream(vec![parquet_batch]).await;

        // Generate index with stream schema (all configured fields)
        let result = generate_tantivy_index(
            dir,
            stream,
            &[], // No FTS fields
            &[
                "continent".to_string(),
                "name".to_string(),
                "flag_url".to_string(),
            ],
            stream_schema.clone(), // Pass stream schema, not parquet schema
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        let index = index.unwrap();
        let tantivy_schema = index.schema();

        // Verify that ALL configured fields are in the tantivy schema,
        // including `continent` which is missing from the parquet data
        assert!(
            tantivy_schema.get_field("continent").is_ok(),
            "continent field should be in tantivy schema even though it's not in parquet data"
        );
        assert!(
            tantivy_schema.get_field("name").is_ok(),
            "name field should be in tantivy schema"
        );
        assert!(
            tantivy_schema.get_field("flag_url").is_ok(),
            "flag_url field should be in tantivy schema"
        );
        assert!(tantivy_schema.get_field(TIMESTAMP_COL_NAME).is_ok());

        // Verify we have 10 documents
        let reader = index.reader().unwrap();
        let searcher = reader.searcher();
        assert_eq!(searcher.num_docs(), 10);
    }

    // Note: Full testing of create_tantivy_index with storage operations would require
    // mocking the storage layer, which is complex for unit tests. The main logic is
    // tested in generate_tantivy_index. Integration tests would be more appropriate
    // for testing the full create_tantivy_index function with actual storage operations.
}
