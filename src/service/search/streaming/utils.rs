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

use config::{
    meta::sql::OrderBy,
    utils::json::{Value, get_string_value},
};
use log;
use serde_json::Map;

/// Calculate the progress percentage based on the search type and current partition
pub fn calculate_progress_percentage(
    partition_start_time: i64,
    partition_end_time: i64,
    req_start_time: i64,
    req_end_time: i64,
    partition_order_by: &OrderBy,
) -> usize {
    if req_end_time <= req_start_time {
        return 0;
    }

    let percentage = if *partition_order_by == OrderBy::Desc {
        // For dashboards/histograms partitions processed newest to oldest
        (req_end_time - partition_start_time) as f32 / (req_end_time - req_start_time) as f32
    } else {
        // For regular searches partitions processed oldest to newest
        (partition_end_time - req_start_time) as f32 / (req_end_time - req_start_time) as f32
    };
    if percentage < 0.5 {
        ((percentage * 100.0).ceil() as usize).min(100)
    } else {
        ((percentage * 100.0).floor() as usize).min(100)
    }
}

/// This function will compute top k values for values request
#[tracing::instrument(name = "service:search:stream_utils:get_top_k_values", skip_all)]
pub fn get_top_k_values(
    hits: &Vec<Value>,
    field: &str,
    _top_k: i64,
    _no_count: bool,
) -> Result<(Vec<Value>, u64), infra::errors::Error> {
    let mut top_k_values: Vec<Value> = Vec::new();

    if field.is_empty() {
        log::error!("Field is empty for values search");
        return Err(infra::errors::Error::Message("field is empty".to_string()));
    }

    let mut search_result_hits = Vec::with_capacity(hits.len());
    for hit in hits {
        let key: String = hit
            .get("zo_sql_key")
            .map(get_string_value)
            .unwrap_or_default();
        let num = hit
            .get("zo_sql_num")
            .and_then(Value::as_i64)
            .unwrap_or_default();
        search_result_hits.push((key, num));
    }

    let top_hits = search_result_hits
        .into_iter()
        .map(|(k, v)| {
            let mut item = Map::new();
            item.insert("zo_sql_key".to_string(), Value::String(k));
            item.insert("zo_sql_num".to_string(), Value::Number(v.into()));
            Value::Object(item)
        })
        .collect::<Vec<_>>();

    let result_count = top_hits.len();
    let mut field_value: Map<String, Value> = Map::new();
    field_value.insert("field".to_string(), Value::String(field.to_string()));
    field_value.insert("values".to_string(), Value::Array(top_hits));
    top_k_values.push(Value::Object(field_value));

    Ok((top_k_values, result_count as u64))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn test_get_top_k_values_success() {
        let hits = vec![
            json!({
                "zo_sql_key": "key1",
                "zo_sql_num": 10
            }),
            json!({
                "zo_sql_key": "key2",
                "zo_sql_num": 20
            }),
            json!({
                "zo_sql_key": "key3",
                "zo_sql_num": 15
            }),
        ];

        let (result, count) = get_top_k_values(&hits, "test_field", 5, false).unwrap();

        assert_eq!(count, 3);
        assert_eq!(result.len(), 1);

        let field_obj = result[0].as_object().unwrap();
        assert_eq!(field_obj["field"], "test_field");

        let values = field_obj["values"].as_array().unwrap();
        assert_eq!(values.len(), 3);

        // Check first value structure
        let first_value = values[0].as_object().unwrap();
        assert_eq!(first_value["zo_sql_key"], "key1");
        assert_eq!(first_value["zo_sql_num"], 10);
    }

    #[test]
    fn test_get_top_k_values_empty_field() {
        let hits = vec![json!({"zo_sql_key": "key1", "zo_sql_num": 10})];

        let result = get_top_k_values(&hits, "", 5, false);
        assert!(result.is_err());
        // The actual error message includes "Error# " prefix
        assert!(result.unwrap_err().to_string().contains("field is empty"));
    }

    #[test]
    fn test_get_top_k_values_empty_hits() {
        let hits = vec![];

        let (result, count) = get_top_k_values(&hits, "test_field", 5, false).unwrap();

        assert_eq!(count, 0);
        assert_eq!(result.len(), 1);

        let field_obj = result[0].as_object().unwrap();
        assert_eq!(field_obj["field"], "test_field");

        let values = field_obj["values"].as_array().unwrap();
        assert_eq!(values.len(), 0);
    }

    #[test]
    fn test_get_top_k_values_missing_fields() {
        let hits = vec![
            json!({"zo_sql_key": "key1"}), // Missing zo_sql_num
            json!({"zo_sql_num": 20}),     // Missing zo_sql_key
            json!({}),                     // Empty object
        ];

        let (result, count) = get_top_k_values(&hits, "test_field", 5, false).unwrap();

        assert_eq!(count, 3);
        assert_eq!(result.len(), 1);

        let values = result[0]["values"].as_array().unwrap();
        assert_eq!(values.len(), 3);

        // Check that missing fields are handled gracefully
        let first_value = values[0].as_object().unwrap();
        assert_eq!(first_value["zo_sql_key"], "key1");
        assert_eq!(first_value["zo_sql_num"], 0); // Default value for missing num

        let second_value = values[1].as_object().unwrap();
        assert_eq!(second_value["zo_sql_key"], ""); // Default value for missing key
        assert_eq!(second_value["zo_sql_num"], 20);
    }

    #[test]
    fn test_get_top_k_values_with_top_k_limit() {
        let hits = vec![
            json!({"zo_sql_key": "key1", "zo_sql_num": 10}),
            json!({"zo_sql_key": "key2", "zo_sql_num": 20}),
            json!({"zo_sql_key": "key3", "zo_sql_num": 15}),
            json!({"zo_sql_key": "key4", "zo_sql_num": 25}),
            json!({"zo_sql_key": "key5", "zo_sql_num": 5}),
        ];

        let (result, count) = get_top_k_values(&hits, "test_field", 3, false).unwrap();

        // Note: The current implementation doesn't actually limit by top_k
        // It returns all hits, but this test documents the current behavior
        assert_eq!(count, 5);
        assert_eq!(result.len(), 1);

        let values = result[0]["values"].as_array().unwrap();
        assert_eq!(values.len(), 5);
    }

    #[test]
    fn test_get_top_k_values_no_count_flag() {
        let hits = vec![
            json!({"zo_sql_key": "key1", "zo_sql_num": 10}),
            json!({"zo_sql_key": "key2", "zo_sql_num": 20}),
        ];

        let (result, count) = get_top_k_values(&hits, "test_field", 5, true).unwrap();

        // The no_count flag doesn't affect the current implementation
        // but this test documents the current behavior
        assert_eq!(count, 2);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn test_get_top_k_values_large_numbers() {
        let hits = vec![
            json!({"zo_sql_key": "key1", "zo_sql_num": i64::MAX}),
            json!({"zo_sql_key": "key2", "zo_sql_num": i64::MIN}),
            json!({"zo_sql_key": "key3", "zo_sql_num": 0}),
        ];

        let (result, count) = get_top_k_values(&hits, "test_field", 5, false).unwrap();

        assert_eq!(count, 3);
        let values = result[0]["values"].as_array().unwrap();
        assert_eq!(values.len(), 3);

        // Check that large numbers are handled correctly
        let first_value = values[0].as_object().unwrap();
        assert_eq!(first_value["zo_sql_num"], i64::MAX);

        let second_value = values[1].as_object().unwrap();
        assert_eq!(second_value["zo_sql_num"], i64::MIN);
    }
}
