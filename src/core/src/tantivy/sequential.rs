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

use anyhow::Context;
use arrow::array::RecordBatch;
use bytes::Bytes;
use config::{
    FileFormat, TIMESTAMP_COL_NAME,
    tantivy::tokenizer::{CollectType, O2_TOKENIZER, o2_tokenizer_build},
};
use futures::TryStreamExt;
use tokio::task::JoinHandle;

use super::{TantivyIndexSchema, convert_batch_to_docs_sync};
use crate::tantivy::reader::file_stream;

/// Create a tantivy index in the given directory for the input file bytes.
pub(super) async fn build_index<D: tantivy::Directory>(
    tantivy_dir: D,
    file_format: FileFormat,
    buf: Bytes,
    index_schema: TantivyIndexSchema,
) -> Result<Option<tantivy::Index>, anyhow::Error> {
    let start = std::time::Instant::now();
    let mut projection: Vec<String> = index_schema.fields.iter().cloned().collect();
    projection.push(TIMESTAMP_COL_NAME.to_string());
    let reader = file_stream(file_format, buf, Some(&projection)).await?;
    let tokenizer_manager = tantivy::tokenizer::TokenizerManager::default();
    tokenizer_manager.register(O2_TOKENIZER, o2_tokenizer_build(CollectType::Ingest));
    let index_writer = tantivy::IndexBuilder::new()
        .schema(index_schema.schema.clone())
        .tokenizers(tokenizer_manager)
        .single_segment_index_writer(tantivy_dir, 50_000_000)
        .context("failed to create index builder")?;

    let (tx, mut rx) = tokio::sync::mpsc::channel::<RecordBatch>(2);

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

    let writer_task: JoinHandle<Result<_, anyhow::Error>> =
        tokio::task::spawn_blocking(move || {
            let mut writer = index_writer;
            while let Some(batch) = rx.blocking_recv() {
                let docs = convert_batch_to_docs_sync(&batch, &index_schema);
                for doc in docs {
                    writer
                        .add_document(doc)
                        .map_err(|e| anyhow::anyhow!("Failed to add document to index: {e}"))?;
                }
            }
            Ok(writer)
        });

    producer.await??;
    let index_writer = writer_task.await??;

    log::info!(
        "sequential::build_index: index building completed in {} ms",
        start.elapsed().as_millis()
    );

    let start = std::time::Instant::now();
    let index = tokio::task::spawn_blocking(move || {
        index_writer.finalize().map_err(|e| {
            log::error!("sequential::build_index: Failed to finalize the index writer: {e}");
            anyhow::anyhow!("Failed to finalize the index writer: {e}")
        })
    })
    .await??;

    log::info!(
        "sequential::build_index: finalizing index in {}",
        start.elapsed().as_millis()
    );

    Ok(Some(index))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{Int64Array, StringArray},
        datatypes::{DataType, Field, Schema},
        record_batch::RecordBatch,
    };
    use config::{FileFormat, INDEX_FIELD_NAME_FOR_ALL, TIMESTAMP_COL_NAME};
    use tantivy::directory::RamDirectory;

    use super::*;
    use crate::tantivy::tests::{create_test_batch, create_test_parquet_bytes, make_index_schema};

    #[tokio::test]
    async fn test_generate_tantivy_index_empty_data() {
        let dir = RamDirectory::create();
        let empty_batch = create_test_batch(0, true, true, true);
        let buf = create_test_parquet_bytes(vec![empty_batch.clone()]).await;

        let result = build_index(
            dir,
            FileFormat::Parquet,
            buf,
            make_index_schema(
                &["content".to_string()],
                &["status".to_string()],
                &empty_batch.schema(),
            ),
        )
        .await;

        assert!(result.is_ok());
        // Should create empty index when fields are configured (even with 0 rows)
        assert!(result.unwrap().is_some());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_with_fts_fields() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, true, true, false);
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;

        let result = build_index(
            dir,
            FileFormat::Parquet,
            buf,
            make_index_schema(&["content".to_string()], &[], &batch.schema()),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        let index = index.unwrap();
        let schema = index.schema();
        assert!(schema.get_field(INDEX_FIELD_NAME_FOR_ALL).is_ok());
        assert!(schema.get_field(TIMESTAMP_COL_NAME).is_ok());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_with_index_fields() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, true, false, true);
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;

        let result = build_index(
            dir,
            FileFormat::Parquet,
            buf,
            make_index_schema(&[], &["status".to_string()], &batch.schema()),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        let index = index.unwrap();
        let schema = index.schema();
        assert!(schema.get_field("status").is_ok());
        assert!(schema.get_field(TIMESTAMP_COL_NAME).is_ok());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_with_both_field_types() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, true, true, true);
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;

        let result = build_index(
            dir,
            FileFormat::Parquet,
            buf,
            make_index_schema(
                &["content".to_string()],
                &["status".to_string()],
                &batch.schema(),
            ),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        let index = index.unwrap();
        let schema = index.schema();
        assert!(schema.get_field(INDEX_FIELD_NAME_FOR_ALL).is_ok());
        assert!(schema.get_field("status").is_ok());
        assert!(schema.get_field(TIMESTAMP_COL_NAME).is_ok());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_mixed_existing_and_missing_fields() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, true, true, true);
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;

        // Mix of existing and non-existing fields
        let result = build_index(
            dir,
            FileFormat::Parquet,
            buf,
            make_index_schema(
                &["content".to_string(), "nonexistent_field".to_string()],
                &[
                    "status".to_string(),
                    "another_nonexistent_field".to_string(),
                ],
                &batch.schema(),
            ),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

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
        let buf = create_test_parquet_bytes(vec![batch1.clone(), batch2.clone()]).await;

        let result = build_index(
            dir,
            FileFormat::Parquet,
            buf,
            make_index_schema(
                &["content".to_string()],
                &["status".to_string()],
                &batch1.schema(),
            ),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        let index = index.unwrap();
        let schema = index.schema();
        assert!(schema.get_field(INDEX_FIELD_NAME_FOR_ALL).is_ok());
        assert!(schema.get_field("status").is_ok());
        assert!(schema.get_field(TIMESTAMP_COL_NAME).is_ok());
    }

    #[tokio::test]
    async fn test_generate_tantivy_index_without_timestamp() {
        let dir = RamDirectory::create();
        let batch = create_test_batch(10, true, true, true);
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;

        let result = build_index(
            dir,
            FileFormat::Parquet,
            buf,
            make_index_schema(
                &["content".to_string()],
                &["status".to_string()],
                &batch.schema(),
            ),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

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
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;

        let result = build_index(
            dir,
            FileFormat::Parquet,
            buf,
            make_index_schema(
                &["content".to_string()],
                &["number_field".to_string()], // This field is not Utf8
                &batch.schema(),
            ),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

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
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;

        // Try to index the timestamp field as a regular index field
        let result = build_index(
            dir,
            FileFormat::Parquet,
            buf,
            make_index_schema(
                &["content".to_string()],
                &[TIMESTAMP_COL_NAME.to_string()], // This should be ignored
                &batch.schema(),
            ),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

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
    async fn test_generate_tantivy_index_stream_schema_vs_parquet_schema() {
        // This test validates the critical fix where we pass stream schema (with all
        // configured fields) instead of parquet schema (only fields in actual data).
        //
        // Scenario: Stream settings configure `continent`, `name`, `flag_url` as secondary
        // index fields, but the parquet data only contains `name` and `flag_url`.
        // The missing field `continent` should still be included in the .ttv schema.

        let dir = RamDirectory::create();

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

        let stream_fields = vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("continent", DataType::Utf8, false), // Configured but not in data
            Field::new("name", DataType::Utf8, false),
            Field::new("flag_url", DataType::Utf8, false),
        ];
        let stream_schema = Arc::new(Schema::new(stream_fields));

        let buf = create_test_parquet_bytes(vec![parquet_batch]).await;

        let result = build_index(
            dir,
            FileFormat::Parquet,
            buf,
            make_index_schema(
                &[], // No FTS fields
                &[
                    "continent".to_string(),
                    "name".to_string(),
                    "flag_url".to_string(),
                ],
                &stream_schema, // Pass stream schema, not parquet schema
            ),
        )
        .await;

        assert!(result.is_ok());
        let index = result.unwrap();
        assert!(index.is_some());

        let index = index.unwrap();
        let tantivy_schema = index.schema();

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

        let reader = index.reader().unwrap();
        let searcher = reader.searcher();
        assert_eq!(searcher.num_docs(), 10);
    }
}
