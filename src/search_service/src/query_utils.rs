// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::sync::Arc;

use arrow_schema::{DataType, Field, Schema};
use config::{
    meta::stream::{FileKey, StreamParams, StreamPartition, StreamType},
    utils::schema::filter_source_by_partition_key,
};
use hashbrown::HashMap;
use infra::errors::{Error, ErrorCodes};

#[allow(clippy::too_many_arguments)]
pub async fn match_file(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
    source: &FileKey,
    partition_keys: &[StreamPartition],
    equal_items: &[(String, String)],
) -> bool {
    if partition_keys.is_empty()
        || !source.key.contains('=')
        || stream_type == StreamType::EnrichmentTables
    {
        return true;
    }

    let mut filters = generate_filter_from_equal_items(equal_items);
    let partition_keys: HashMap<&String, &StreamPartition> =
        partition_keys.iter().map(|v| (&v.field, v)).collect();
    for (key, value) in filters.iter_mut() {
        if let Some(partition_key) = partition_keys.get(key) {
            for val in value.iter_mut() {
                *val = partition_key.get_partition_value(val);
            }
        }
    }
    match_source(
        Arc::new(StreamParams::new(org_id, stream_name, stream_type)),
        time_range,
        &filters,
        source,
    )
    .await
}

pub fn generate_filter_from_equal_items(
    equal_items: &[(String, String)],
) -> Vec<(String, Vec<String>)> {
    let mut filters: HashMap<String, Vec<String>> = HashMap::new();
    for (field, value) in equal_items {
        filters
            .entry(field.to_string())
            .or_default()
            .push(value.to_string());
    }
    filters.into_iter().collect()
}

pub async fn match_source(
    stream: Arc<StreamParams>,
    time_range: Option<(i64, i64)>,
    filters: &[(String, Vec<String>)],
    source: &FileKey,
) -> bool {
    if !source.key.starts_with(
        format!(
            "files/{}/{}/{}/",
            stream.org_id, stream.stream_type, stream.stream_name
        )
        .as_str(),
    ) {
        return false;
    }
    if !filter_source_by_partition_key(&source.key, filters) {
        return false;
    }
    if source.meta.min_ts == 0 || source.meta.max_ts == 0 {
        return true;
    }
    if let Some((time_min, time_max)) = time_range {
        if time_min > 0 && time_min > source.meta.max_ts {
            return false;
        }
        if time_max > 0 && time_max < source.meta.min_ts {
            return false;
        }
    }
    true
}

pub fn server_internal_error(error: impl ToString) -> Error {
    Error::ErrorCode(ErrorCodes::ServerInternalError(error.to_string()))
}

pub fn generate_search_schema_diff(
    schema: &Schema,
    latest_schema_map: &HashMap<&String, &Arc<Field>>,
) -> HashMap<String, DataType> {
    let mut diff_fields = HashMap::new();
    for field in schema.fields().iter() {
        if let Some(latest_field) = latest_schema_map.get(field.name())
            && field.data_type() != latest_field.data_type()
        {
            diff_fields.insert(field.name().clone(), latest_field.data_type().clone());
        }
    }
    diff_fields
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_filter_from_equal_items_groups_by_field() {
        let items = vec![
            ("a".to_string(), "3".to_string()),
            ("b".to_string(), "5".to_string()),
            ("a".to_string(), "4".to_string()),
            ("b".to_string(), "6".to_string()),
        ];
        let mut result = generate_filter_from_equal_items(&items);
        result.sort_by(|x, y| x.0.cmp(&y.0));
        assert_eq!(result.len(), 2);
        assert_eq!(
            result[0],
            ("a".to_string(), vec!["3".to_string(), "4".to_string()])
        );
        assert_eq!(
            result[1],
            ("b".to_string(), vec!["5".to_string(), "6".to_string()])
        );
    }

    #[test]
    fn test_generate_search_schema_diff_detects_type_change() {
        let old_field = Arc::new(Field::new("col1", DataType::Utf8, false));
        let new_field = Arc::new(Field::new("col1", DataType::Int64, false));
        let schema = Schema::new(vec![old_field]);
        let map = [(new_field.name(), &new_field)].into_iter().collect();
        assert_eq!(
            generate_search_schema_diff(&schema, &map).get("col1"),
            Some(&DataType::Int64)
        );
    }

    #[test]
    fn test_server_internal_error_contains_message() {
        assert!(
            server_internal_error("disk full")
                .to_string()
                .contains("disk full")
        );
    }
}
