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

pub mod puffin;
pub mod puffin_directory;

// Two build paths for the per-parquet tantivy (.ttv / puffin) index. The
// orchestrator [`create_tantivy_index`] below picks one based on the
// `compact.tantivy_parallel_build_workers` config:
//   - `sequential` — legacy single-threaded `RecordBatchStream` consumer
//   - `parallel`   — row_group-direct, one worker per parquet row_group
//
// Both paths share the schema/tokenizer helpers defined in this file
// (`build_tantivy_schema_for_index`, `make_index_tokenizer_manager`).
mod parallel;
mod sequential;

// Bring the two path entry points into this module's namespace so
// `create_tantivy_index` below can call them by short name, and so the
// `tests` submodule reaches them via `super::*` without explicit path
// qualifiers. The submodules declare the items as `pub(super)`, which makes
// them visible exactly to this module and its children — broader visibility
// is unnecessary because `create_tantivy_index` is the only public entry.
use std::{collections::HashMap, sync::Arc};

use arrow_schema::{DataType, Schema};
use bytes::Bytes;
use config::{
    FileFormat, INDEX_FIELD_NAME_FOR_ALL, PARQUET_MAX_ROW_GROUP_SIZE, TIMESTAMP_COL_NAME,
    get_config,
    utils::{
        inverted_index::convert_parquet_file_name_to_tantivy_file,
        parquet::get_recordbatch_reader_from_bytes,
        tantivy::tokenizer::{CollectType, O2_TOKENIZER, o2_tokenizer_build},
    },
};
use hashbrown::HashSet;
use infra::storage;
use parallel::generate_tantivy_index_parallel_row_groups;
use puffin_directory::writer::PuffinDirWriter;
use sequential::generate_tantivy_index;

pub(crate) async fn create_tantivy_index(
    caller: &str,
    org_id: &str,
    parquet_file_name: &str,
    full_text_search_fields: &[String],
    index_fields: &[String],
    schema: Arc<Schema>,
    buf: Bytes,
) -> Result<usize, anyhow::Error> {
    let start = std::time::Instant::now();
    let caller = format!("[{caller}:JOB]");

    let dir = PuffinDirWriter::new();
    let cfg = get_config();
    let file_format = FileFormat::from_extension(parquet_file_name).unwrap_or_default();
    let parallel_workers = cfg.compact.tantivy_parallel_build_workers;

    let index = if parallel_workers > 0 && matches!(file_format, FileFormat::Parquet) {
        log::debug!(
            "{caller} using row_group-parallel tantivy index build: workers={parallel_workers}"
        );
        generate_tantivy_index_parallel_row_groups(
            dir.clone(),
            buf,
            full_text_search_fields,
            index_fields,
            schema,
            parallel_workers,
        )
        .await?
    } else {
        let (_, reader) = get_recordbatch_reader_from_bytes(file_format, buf).await?;
        generate_tantivy_index(
            dir.clone(),
            reader,
            full_text_search_fields,
            index_fields,
            schema,
        )
        .await?
    };
    if index.is_none() {
        return Ok(0);
    }

    // Record the parquet row group size in effect at index build time so the
    // reader can map doc_ids back to row groups even if the constant changes.
    dir.set_property(
        puffin_directory::PROP_ROW_GROUP_SIZE,
        PARQUET_MAX_ROW_GROUP_SIZE.to_string(),
    );
    let puffin_bytes = dir.to_puffin_bytes()?;
    let index_size = puffin_bytes.len();

    // write fst bytes into disk
    let Some(idx_file_name) = convert_parquet_file_name_to_tantivy_file(parquet_file_name) else {
        return Ok(0);
    };

    let buf = Bytes::from(puffin_bytes);
    let cfg = get_config();
    if cfg.cache_latest_files.enabled
        && cfg.cache_latest_files.cache_index
        && cfg.cache_latest_files.download_from_node
    {
        infra::cache::file_data::disk::set(&idx_file_name, buf.clone()).await?;
        log::info!("file: {idx_file_name} file_data::disk::set success");
    }

    // the index file is stored in the same account as the parquet file
    let account = storage::get_account(org_id, parquet_file_name).unwrap_or_default();
    match storage::put(&account, &idx_file_name, buf).await {
        Ok(_) => {
            log::info!(
                "{caller} generated tantivy index file: {idx_file_name}, size {index_size}, took: {} ms",
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

/// Builds the tantivy `Schema` shared by both index-build paths.
///
/// Returns `None` when there are no fields to index (configured fields don't
/// intersect with the stream schema). Otherwise returns
/// `(tantivy_schema, indexed_field_names, fts_field_opt)`:
/// - `tantivy_schema`: the built schema
/// - `indexed_field_names`: the set of column names we must populate per row (union of fts fields
///   and secondary index fields, filtered by data type)
/// - `fts_field_opt`: the field handle for `INDEX_FIELD_NAME_FOR_ALL`, present when there is at
///   least one full-text-search field
fn build_tantivy_schema_for_index(
    full_text_search_fields: &[String],
    index_fields: &[String],
    arrow_schema: &Schema,
) -> Option<(
    tantivy::schema::Schema,
    HashSet<String>,
    Option<tantivy::schema::Field>,
)> {
    let mut tantivy_schema_builder = tantivy::schema::SchemaBuilder::new();
    let schema_fields = arrow_schema
        .fields()
        .iter()
        .map(|f| (f.name(), f))
        .collect::<HashMap<_, _>>();

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
    let index_fields_filtered = index_fields
        .iter()
        .filter(|f| schema_fields.contains_key(f))
        .map(String::from)
        .collect::<HashSet<_>>();
    let tantivy_fields = fts_fields
        .union(&index_fields_filtered)
        .cloned()
        .collect::<HashSet<_>>();

    if tantivy_fields.is_empty() {
        return None;
    }

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
    for field in index_fields_filtered.iter() {
        if field == TIMESTAMP_COL_NAME {
            continue;
        }
        tantivy_schema_builder.add_text_field(field, index_opts.clone());
    }
    tantivy_schema_builder.add_i64_field(TIMESTAMP_COL_NAME, tantivy::schema::FAST);
    let tantivy_schema = tantivy_schema_builder.build();
    let fts_field = tantivy_schema.get_field(INDEX_FIELD_NAME_FOR_ALL).ok();
    Some((tantivy_schema, tantivy_fields, fts_field))
}

/// Creates a `TokenizerManager` matching what the indexer needs (O2 tokenizer
/// registered). Built fresh per use so it is `Send` and can move into
/// `spawn_blocking`.
fn make_index_tokenizer_manager() -> tantivy::tokenizer::TokenizerManager {
    let tokenizer_manager = tantivy::tokenizer::TokenizerManager::default();
    tokenizer_manager.register(O2_TOKENIZER, o2_tokenizer_build(CollectType::Ingest));
    tokenizer_manager
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::{
        array::{Int64Array, StringArray},
        datatypes::{DataType, Field, Schema},
        record_batch::RecordBatch,
    };
    use config::{
        FileFormat, INDEX_FIELD_NAME_FOR_ALL, TIMESTAMP_COL_NAME, utils::parquet::RecordBatchStream,
    };
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
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

    // Helper: serializes `batches` to an in-memory parquet file and returns
    // the raw bytes. Shared by both the stream-based and the new
    // row_group-direct parallel tests.
    async fn create_test_parquet_bytes(batches: Vec<RecordBatch>) -> bytes::Bytes {
        let schema = batches[0].schema();
        let mut buffer = Vec::new();
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
        bytes::Bytes::from(buffer)
    }

    // Helper function to create a mock RecordBatchStream (for legacy-path tests).
    async fn create_test_stream(batches: Vec<RecordBatch>) -> RecordBatchStream {
        let bytes = create_test_parquet_bytes(batches).await;
        let (_schema, stream) =
            config::utils::parquet::get_recordbatch_reader_from_bytes(FileFormat::Parquet, bytes)
                .await
                .unwrap();
        stream
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
        let buf = create_test_parquet_bytes(vec![empty_batch.clone()]).await;

        // Test that create_tantivy_index returns 0 for empty data
        let result = create_tantivy_index(
            "test_caller",
            "default",
            "test_file.parquet",
            &["content".to_string()],
            &["status".to_string()],
            empty_batch.schema(),
            buf,
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0); // Should return 0 for empty data
    }

    #[tokio::test]
    async fn test_create_tantivy_index_with_no_fields() {
        let batch = create_test_batch(10, true, true, true);
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;

        // Test that create_tantivy_index returns 0 when no fields to index
        let result = create_tantivy_index(
            "test_caller",
            "default",
            "test_file.parquet",
            &[], // No FTS fields
            &[], // No index fields
            batch.schema(),
            buf,
        )
        .await;

        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0); // Should return 0 when no fields to index
    }

    #[tokio::test]
    async fn test_create_tantivy_index_with_invalid_parquet_filename() {
        let batch = create_test_batch(10, true, true, true);
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;

        // Test with an invalid parquet filename that won't convert to tantivy filename
        let result = create_tantivy_index(
            "test_caller",
            "default",
            "invalid_filename", // This won't convert to a valid tantivy filename
            &["content".to_string()],
            &["status".to_string()],
            batch.schema(),
            buf,
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

    // ---- L3 row_group-parallel build path tests ----

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

        let index = generate_tantivy_index_parallel_row_groups(
            RamDirectory::create(),
            buf,
            &[],
            &["marker".to_string()],
            stream_schema,
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

    /// No-fields case: parallel path must match sequential — return Ok(None).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn test_row_group_parallel_no_fields_returns_none() {
        let batch = create_test_batch(10, true, true, true);
        let buf = create_test_parquet_bytes(vec![batch.clone()]).await;
        let res = generate_tantivy_index_parallel_row_groups(
            RamDirectory::create(),
            buf,
            &[],
            &[],
            batch.schema(),
            2,
        )
        .await
        .unwrap();
        assert!(res.is_none(), "no fields → no index");
    }

    /// Empty data + configured fields: still produces a single-segment empty
    /// marker index (matches legacy behavior).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn test_row_group_parallel_empty_data_marker() {
        let empty_batch = create_test_batch(0, true, true, true);
        let buf = create_test_parquet_bytes(vec![empty_batch.clone()]).await;
        let res = generate_tantivy_index_parallel_row_groups(
            RamDirectory::create(),
            buf,
            &["content".to_string()],
            &["status".to_string()],
            empty_batch.schema(),
            2,
        )
        .await
        .unwrap();
        assert!(res.is_some(), "configured fields → empty marker index");
        let index = res.unwrap();
        let segs = index.searchable_segments().unwrap();
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].meta().max_doc(), 0);
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
        let stream_seq = create_test_stream(vec![
            create_marker_batch(0, 250),
            create_marker_batch(250, 250),
            create_marker_batch(500, 250),
        ])
        .await;
        let schema = Arc::new(Schema::new(vec![
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("marker", DataType::Utf8, false),
        ]));

        let par = generate_tantivy_index_parallel_row_groups(
            RamDirectory::create(),
            buf_par,
            &[],
            &["marker".to_string()],
            schema.clone(),
            3,
        )
        .await
        .unwrap()
        .unwrap();
        let seq = generate_tantivy_index(
            RamDirectory::create(),
            stream_seq,
            &[],
            &["marker".to_string()],
            schema,
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
