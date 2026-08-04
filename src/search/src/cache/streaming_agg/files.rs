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

use std::{
    io::Cursor,
    path::Path,
    sync::{Arc, LazyLock},
};

use arrow::{
    array::{ArrayRef, RecordBatch, RecordBatchOptions},
    compute::cast,
    datatypes::{DataType, Field, SchemaRef},
    ipc::{reader::FileReader as ArrowFileReader, writer::FileWriter as ArrowFileWriter},
};
use config::{
    meta::search::SearchPartitionRequest,
    utils::{
        record_batch_ext::RecordBatchExt,
        time::{now_micros, second_micros},
    },
};
use hashbrown::HashMap;
use infra::cache::file_data::disk;
use tokio::sync::mpsc;

use crate::datafusion::aggregates::gc_string_view_batch;

pub const STREAMING_AGGS_CACHE_DIR: &str = "aggregations";

#[derive(Debug)]
pub struct RecordBatchCacheRequest {
    pub streaming_id: String,
    pub file_path: String,
    pub schema: SchemaRef,
    pub records: Vec<Arc<RecordBatch>>,
    pub overwrite_cache: bool,
}

// Global queue for cache requests
static CACHE_QUEUE: LazyLock<mpsc::UnboundedSender<(String, String)>> = LazyLock::new(|| {
    let (sender, mut receiver) = mpsc::unbounded_channel::<(String, String)>();

    // Spawn background task to process cache requests
    tokio::spawn(async move {
        while let Some((streaming_id, file_key)) = receiver.recv().await {
            log::debug!("[streaming_id: {streaming_id}] Received cache request");
            if let Err(e) = load_record_batches_file_to_disk_cache(&streaming_id, &file_key).await {
                log::error!(
                    "[streaming_id: {streaming_id}] Failed to load record batches file to disk cache: {e:?}"
                );
            }
        }
    });

    sender
});

async fn load_record_batches_file_to_disk_cache(
    streaming_id: &str,
    file_key: &str,
) -> Result<(), std::io::Error> {
    // Skip caching if record batch for the time range is already cached
    let Some(file_path) = disk::get_file_path(file_key) else {
        return Ok(()); // no need to cache, it's not a valid file path
    };
    let Some(file_meta) = config::utils::file::get_file_meta(&file_path).ok() else {
        return Ok(()); // no need to cache, it's not a valid file path
    };
    let file_size = file_meta.len();
    if file_size == 0 {
        return Ok(()); // no need to cache, it's not a valid file
    }

    log::debug!(
        "load_record_batches_file_to_disk_cache: streaming_id: {streaming_id}, file_key: {file_key}, file_size: {file_size}"
    );

    // set to disk cache
    disk::set_size(file_key, file_size as usize)
        .await
        .map_err(|e| std::io::Error::other(format!("Failed to set size to disk cache: {e}")))?;

    Ok(())
}

// Main handler to write record batches to disk
pub fn cache_record_batches_to_disk(
    request: RecordBatchCacheRequest,
) -> Result<(), std::io::Error> {
    let start = std::time::Instant::now();
    let RecordBatchCacheRequest {
        streaming_id,
        file_path,
        schema,
        records,
        overwrite_cache,
    } = request;

    // Skip caching if record batch for the time range is already cached
    let file_key = file_path.clone();
    let Some(file_path) = disk::get_file_path(&file_path) else {
        return Err(std::io::Error::other(
            "ZO_DISK_CACHE_ENABLED is not enabled",
        ));
    };
    let file_meta = config::utils::file::get_file_meta(&file_path).ok();
    let file_exists = file_meta.is_some() && file_meta.unwrap().is_file();
    if file_exists && !overwrite_cache {
        log::warn!(
            "[streaming_id: {streaming_id}] file_exists: {file_exists}, Skipping cache to disk because the data for the time range is already cached",
        );
        return Ok(());
    }

    if file_exists && overwrite_cache {
        log::info!(
            "[streaming_id: {streaming_id}] file_exists: {file_exists}, overwrite_cache: {overwrite_cache}, Overwriting existing cache file",
        );
    }

    let batches_num = records.len();
    let rows_num = records.iter().map(|r| r.num_rows()).sum::<usize>();
    let batches = records
        .iter()
        .map(|r| Arc::new(gc_string_view_batch(r)))
        .collect::<Vec<Arc<RecordBatch>>>();

    // Serialize the record batches into bytes
    let data = match serialize_record_batches(schema, batches) {
        Ok(data) => data,
        Err(e) => {
            log::error!("[streaming_id: {streaming_id}] Failed to serialize record batches: {e:?}",);
            return Err(std::io::Error::other("Serialization failed"));
        }
    };

    // create the directory if it doesn't exist
    std::fs::create_dir_all(Path::new(&file_path).parent().unwrap())?;
    // write the data to the file
    match config::utils::file::put_file_contents(&file_path, &data) {
        Ok(_) => {
            log::info!(
                "cache_record_batches_to_disk: streaming_id: {streaming_id}, file_path: {file_path}, batches: {batches_num}, rows: {rows_num}, write to file took: {} ms",
                start.elapsed().as_millis()
            );

            // add to cache list
            // Send to background queue (non-blocking)
            if let Err(e) = CACHE_QUEUE.send((streaming_id.clone(), file_key)) {
                log::error!(
                    "[streaming_id: {streaming_id}] Failed to queue cache file to disk: {file_path}, error: {e:?}",
                );
            }

            Ok(())
        }
        Err(e) => {
            log::error!("Error caching results to disk: {e:?}");
            Err(std::io::Error::other(format!(
                "[streaming_id: {streaming_id}] Error caching results to disk: file_path={file_path}"
            )))
        }
    }
}

// write to arrow ipc format
fn serialize_record_batches(
    schema: SchemaRef,
    batches: Vec<Arc<RecordBatch>>,
) -> arrow::error::Result<Vec<u8>> {
    let mut buffer = Cursor::new(Vec::new());
    let mut writer = ArrowFileWriter::try_new(&mut buffer, &schema)?;

    for batch in batches {
        writer.write(&batch)?;
    }

    writer.finish()?;
    Ok(buffer.into_inner())
}

pub fn get_record_batches(
    streaming_id: &str,
    file_path: &str,
    schema: SchemaRef,
) -> std::io::Result<Vec<RecordBatch>> {
    let start = std::time::Instant::now();
    let file_path = disk::get_file_path(file_path).ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("File not found: {file_path}"),
        )
    })?;
    let data = config::utils::file::get_file_contents(&file_path, None).map_err(|e| {
        log::error!("Error getting file contents: {e}, file_path: {file_path}");
        e
    })?;
    let reader = unsafe {
        ArrowFileReader::try_new(Cursor::new(data), None)
            .map_err(|e| {
                log::error!("Error creating arrow reader: {e}, file_path: {file_path}");
                std::io::Error::other(format!("Arrow error: {e}"))
            })?
            .with_skip_validation(true)
    };
    let schema_field_map = schema
        .fields()
        .iter()
        .map(|f| (f.name(), f.data_type()))
        .collect::<HashMap<&String, &DataType>>();
    let mut batches = Vec::new();
    for batch in reader {
        let batch = batch.map_err(|e| std::io::Error::other(format!("Arrow error: {e}")))?;
        let new_columns: Vec<ArrayRef> = batch
            .columns()
            .iter()
            .zip(batch.schema().fields().iter())
            .map(|(c, f)| {
                let file_datatype = f.data_type();
                let need_datatype = *schema_field_map.get(f.name()).unwrap_or(&&DataType::Null);

                // Use the recursive cast function
                if let Some(casted) = cast_array_recursive(c, file_datatype, need_datatype) {
                    casted
                } else {
                    Arc::clone(c)
                }
            })
            .collect();
        let mut options = RecordBatchOptions::new();
        options = options.with_row_count(Some(batch.num_rows()));
        let batch = RecordBatch::try_new_with_options(schema.clone(), new_columns, &options)
            .expect("Failed to re-create the record batch");

        batches.push(batch);
    }

    log::debug!(
        "get_record_batches: streaming_id: {streaming_id}, file_path: {file_path}, batches: {}, rows: {}, arrow_size: {}, took: {} ms",
        batches.len(),
        batches.iter().map(|r| r.num_rows()).sum::<usize>(),
        batches.iter().map(|r| r.size()).sum::<usize>(),
        start.elapsed().as_millis()
    );

    Ok(batches)
}

/// Recursively checks if two data types need casting and performs the cast if needed.
/// This function handles:
/// - String type conversions (Utf8, LargeUtf8, Utf8View)
/// - Nested List types (recursively checks inner types)
/// - Nested Struct types (recursively checks field types)
/// - Other types (returns None if no cast needed)
///
/// # Arguments
/// * `array` - The array to potentially cast
/// * `from_type` - The source data type
/// * `to_type` - The target data type
///
/// # Returns
/// * `Some(ArrayRef)` - If casting was needed and successful
/// * `None` - If no casting is needed (types are compatible)
fn cast_array_recursive(
    array: &ArrayRef,
    from_type: &DataType,
    to_type: &DataType,
) -> Option<ArrayRef> {
    // If types are identical, no cast needed
    if from_type == to_type {
        return None;
    }

    match (from_type, to_type) {
        // Handle string type conversions
        (
            DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View,
            DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View,
        ) => {
            // Cast between string types
            cast(array, to_type).ok()
        }

        // Handle List types recursively
        (DataType::List(from_field), DataType::List(to_field)) => {
            let from_inner = from_field.data_type();
            let to_inner = to_field.data_type();

            // If inner types need casting, create a new List type with the target inner type
            if needs_recursive_cast(from_inner, to_inner) {
                // Create a new field with the target data type
                let new_field = Arc::new(Field::new(
                    to_field.name(),
                    to_inner.clone(),
                    to_field.is_nullable(),
                ));
                let new_list_type = DataType::List(new_field);
                cast(array, &new_list_type).ok()
            } else {
                None
            }
        }

        // Handle LargeList types recursively
        (DataType::LargeList(from_field), DataType::LargeList(to_field)) => {
            let from_inner = from_field.data_type();
            let to_inner = to_field.data_type();

            if needs_recursive_cast(from_inner, to_inner) {
                let new_field = Arc::new(Field::new(
                    to_field.name(),
                    to_inner.clone(),
                    to_field.is_nullable(),
                ));
                let new_list_type = DataType::LargeList(new_field);
                cast(array, &new_list_type).ok()
            } else {
                None
            }
        }

        // Handle Struct types recursively
        (DataType::Struct(from_fields), DataType::Struct(to_fields)) => {
            // Check if any field needs casting
            let needs_cast =
                from_fields
                    .iter()
                    .zip(to_fields.iter())
                    .any(|(from_field, to_field)| {
                        needs_recursive_cast(from_field.data_type(), to_field.data_type())
                    });

            if needs_cast {
                cast(array, to_type).ok()
            } else {
                None
            }
        }

        // For all other type combinations, no cast is performed
        _ => None,
    }
}

/// Helper function to check if two types need recursive casting
fn needs_recursive_cast(from_type: &DataType, to_type: &DataType) -> bool {
    if from_type == to_type {
        return false;
    }

    match (from_type, to_type) {
        // String types can be cast between each other
        (
            DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View,
            DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View,
        ) => true,

        // Recursively check List types
        (DataType::List(from_field), DataType::List(to_field)) => {
            needs_recursive_cast(from_field.data_type(), to_field.data_type())
        }

        // Recursively check LargeList types
        (DataType::LargeList(from_field), DataType::LargeList(to_field)) => {
            needs_recursive_cast(from_field.data_type(), to_field.data_type())
        }

        // Recursively check Struct types
        (DataType::Struct(from_fields), DataType::Struct(to_fields)) => {
            from_fields.len() == to_fields.len()
                && from_fields
                    .iter()
                    .zip(to_fields.iter())
                    .any(|(from_field, to_field)| {
                        needs_recursive_cast(from_field.data_type(), to_field.data_type())
                    })
        }

        _ => false,
    }
}

pub fn create_aggregation_cache_file_path(
    org_id: &str,
    stream_type: &str,
    stream_name: &str,
    hashed_query: u64,
) -> String {
    if org_id.is_empty() || stream_type.is_empty() || stream_name.is_empty() {
        return "".to_string();
    }
    // eg: /org_id/stream_type/stream_name/12345678
    // Note: interval is NOT included in the path anymore - all intervals share the same directory
    format!("{org_id}/{stream_type}/{stream_name}/{hashed_query}")
}

pub fn generate_aggregation_cache_file_name(
    id: &str,
    start_time: i64,
    end_time: i64,
    is_complete_partition_window: bool,
) -> String {
    // set cache as tmp if the time range is within the delay window
    let delay_window_micros = second_micros(config::get_config().limit.cache_delay_secs);
    let skip_cache = now_micros() - delay_window_micros;
    let can_be_cached = end_time < skip_cache;

    let is_tmp_file = if is_complete_partition_window && can_be_cached {
        "".to_string()
    } else {
        format!("_{id}_tmp")
    };
    format!("{start_time}_{end_time}{is_tmp_file}.arrow")
}

pub fn get_cache_file_path(file_path: &str, file_name: &str) -> String {
    format!("{STREAMING_AGGS_CACHE_DIR}/{file_path}/{file_name}")
}

pub fn get_aggregation_cache_key_from_request(req: &SearchPartitionRequest) -> u64 {
    let origin_sql = req.sql.clone();

    let mut hash_body = vec![origin_sql];
    if let Some(vrl_function) = &req.query_fn {
        hash_body.push(vrl_function.to_string());
    }
    if !req.regions.is_empty() {
        hash_body.extend(req.regions.clone());
    }
    if !req.clusters.is_empty() {
        hash_body.extend(req.clusters.clone());
    }
    config::utils::hash::sum64(&hash_body.join(","))
}

#[cfg(test)]
mod tests {
    use arrow::array::StringArray;

    use super::*;

    #[test]
    fn test_cast_array_recursive_string_types() {
        use arrow::array::StringArray;

        // Test Utf8 to Utf8View
        let array: ArrayRef = Arc::new(StringArray::from(vec!["hello", "world"]));
        let result = cast_array_recursive(&array, &DataType::Utf8, &DataType::Utf8View);
        assert!(result.is_some());
        let casted = result.unwrap();
        assert_eq!(casted.data_type(), &DataType::Utf8View);

        // Test Utf8View to LargeUtf8
        let array: ArrayRef = Arc::new(StringArray::from(vec!["foo", "bar"]));
        let result = cast_array_recursive(&array, &DataType::Utf8View, &DataType::LargeUtf8);
        assert!(result.is_some());

        // Test LargeUtf8 to Utf8
        let array: ArrayRef = Arc::new(StringArray::from(vec!["test"]));
        let result = cast_array_recursive(&array, &DataType::LargeUtf8, &DataType::Utf8);
        assert!(result.is_some());
    }

    #[test]
    fn test_cast_array_recursive_identical_types() {
        use arrow::array::Int32Array;

        // Test that identical types return None (no cast needed)
        let array: ArrayRef = Arc::new(Int32Array::from(vec![1, 2, 3]));
        let result = cast_array_recursive(&array, &DataType::Int32, &DataType::Int32);
        assert!(result.is_none());

        // Test string types
        let array: ArrayRef = Arc::new(StringArray::from(vec!["test"]));
        let result = cast_array_recursive(&array, &DataType::Utf8, &DataType::Utf8);
        assert!(result.is_none());
    }

    #[test]
    fn test_cast_array_recursive_list_with_string() {
        use arrow::array::{ListArray, StringArray};

        // Create a List<Utf8> array
        let values = StringArray::from(vec!["a", "b", "c", "d"]);
        let offsets = arrow::buffer::OffsetBuffer::new(vec![0, 2, 4].into());
        let field = Arc::new(Field::new("item", DataType::Utf8, true));
        let list_array = ListArray::new(field.clone(), offsets, Arc::new(values), None);
        let array: ArrayRef = Arc::new(list_array);

        // Cast from List<Utf8> to List<Utf8View>
        let from_type = DataType::List(Arc::new(Field::new("item", DataType::Utf8, true)));
        let to_type = DataType::List(Arc::new(Field::new("item", DataType::Utf8View, true)));

        let result = cast_array_recursive(&array, &from_type, &to_type);
        assert!(result.is_some());

        let casted = result.unwrap();
        if let DataType::List(inner_field) = casted.data_type() {
            assert_eq!(inner_field.data_type(), &DataType::Utf8View);
        } else {
            panic!("Expected List type");
        }
    }

    #[test]
    fn test_cast_array_recursive_nested_list() {
        use arrow::array::{ListArray, StringArray};

        // Create a List<List<Utf8>> structure
        let inner_values = StringArray::from(vec!["x", "y"]);
        let inner_offsets = arrow::buffer::OffsetBuffer::new(vec![0, 1, 2].into());
        let inner_field = Arc::new(Field::new("item", DataType::Utf8, true));
        let inner_list = ListArray::new(
            inner_field.clone(),
            inner_offsets,
            Arc::new(inner_values),
            None,
        );

        let outer_offsets = arrow::buffer::OffsetBuffer::new(vec![0, 2].into());
        let outer_field = Arc::new(Field::new(
            "item",
            DataType::List(inner_field.clone()),
            true,
        ));
        let outer_list = ListArray::new(outer_field, outer_offsets, Arc::new(inner_list), None);
        let array: ArrayRef = Arc::new(outer_list);

        // Cast from List<List<Utf8>> to List<List<LargeUtf8>>
        let from_type = DataType::List(Arc::new(Field::new(
            "item",
            DataType::List(Arc::new(Field::new("item", DataType::Utf8, true))),
            true,
        )));
        let to_type = DataType::List(Arc::new(Field::new(
            "item",
            DataType::List(Arc::new(Field::new("item", DataType::LargeUtf8, true))),
            true,
        )));

        let result = cast_array_recursive(&array, &from_type, &to_type);
        assert!(result.is_some());
    }

    #[test]
    fn test_cast_array_recursive_struct_with_string() {
        use arrow::{
            array::{Int32Array, StringArray, StructArray},
            datatypes::Fields,
        };

        // Create a Struct with (name: Utf8, age: Int32)
        let name_array = Arc::new(StringArray::from(vec!["Alice", "Bob"]));
        let age_array = Arc::new(Int32Array::from(vec![30, 25]));

        let from_fields = Fields::from(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("age", DataType::Int32, false),
        ]);
        let struct_array = StructArray::new(
            from_fields.clone(),
            vec![name_array as ArrayRef, age_array as ArrayRef],
            None,
        );
        let array: ArrayRef = Arc::new(struct_array);

        // Cast to Struct with (name: Utf8View, age: Int32)
        let from_type = DataType::Struct(from_fields);
        let to_fields = Fields::from(vec![
            Field::new("name", DataType::Utf8View, false),
            Field::new("age", DataType::Int32, false),
        ]);
        let to_type = DataType::Struct(to_fields.clone());

        let result = cast_array_recursive(&array, &from_type, &to_type);
        assert!(result.is_some());

        let casted = result.unwrap();
        if let DataType::Struct(fields) = casted.data_type() {
            assert_eq!(fields[0].data_type(), &DataType::Utf8View);
            assert_eq!(fields[1].data_type(), &DataType::Int32);
        } else {
            panic!("Expected Struct type");
        }
    }

    #[test]
    fn test_needs_recursive_cast_string_types() {
        // String type variations should return true
        assert!(needs_recursive_cast(&DataType::Utf8, &DataType::Utf8View));
        assert!(needs_recursive_cast(&DataType::LargeUtf8, &DataType::Utf8));
        assert!(needs_recursive_cast(
            &DataType::Utf8View,
            &DataType::LargeUtf8
        ));

        // Same string type should return false
        assert!(!needs_recursive_cast(&DataType::Utf8, &DataType::Utf8));
    }

    #[test]
    fn test_needs_recursive_cast_list_types() {
        // List with different inner types
        let from_list = DataType::List(Arc::new(Field::new("item", DataType::Utf8, true)));
        let to_list = DataType::List(Arc::new(Field::new("item", DataType::Utf8View, true)));
        assert!(needs_recursive_cast(&from_list, &to_list));

        // List with same inner types
        let same_list = DataType::List(Arc::new(Field::new("item", DataType::Int32, true)));
        assert!(!needs_recursive_cast(&same_list, &same_list));
    }

    #[test]
    fn test_needs_recursive_cast_struct_types() {
        use arrow::datatypes::Fields;

        // Struct with different field types
        let from_fields = Fields::from(vec![Field::new("name", DataType::Utf8, false)]);
        let to_fields = Fields::from(vec![Field::new("name", DataType::Utf8View, false)]);
        let from_struct = DataType::Struct(from_fields);
        let to_struct = DataType::Struct(to_fields);
        assert!(needs_recursive_cast(&from_struct, &to_struct));

        // Struct with same field types
        let same_fields = Fields::from(vec![Field::new("id", DataType::Int32, false)]);
        let same_struct = DataType::Struct(same_fields);
        assert!(!needs_recursive_cast(&same_struct, &same_struct));
    }

    #[test]
    fn test_cast_array_recursive_incompatible_types() {
        use arrow::array::{Int32Array, StringArray};

        // Test that incompatible types return None
        let array: ArrayRef = Arc::new(Int32Array::from(vec![1, 2, 3]));
        let result = cast_array_recursive(&array, &DataType::Int32, &DataType::Float64);
        assert!(result.is_none());

        // Test string to int (should return None as we don't handle this)
        let array: ArrayRef = Arc::new(StringArray::from(vec!["test"]));
        let result = cast_array_recursive(&array, &DataType::Utf8, &DataType::Int32);
        assert!(result.is_none());
    }
}
