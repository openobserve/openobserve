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

use std::{cmp::Reverse, collections::BinaryHeap};

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
    top_k: i64,
    no_count: bool,
) -> Result<(Vec<Value>, u64), infra::errors::Error> {
    let mut top_k_values: Vec<Value> = Vec::new();

    if field.is_empty() {
        log::error!("Field is empty for values search");
        return Err(infra::errors::Error::Message("field is empty".to_string()));
    }

    let mut search_result_hits = Vec::new();
    for hit in hits {
        let key: String = hit
            .get("zo_sql_key")
            .map(get_string_value)
            .unwrap_or_default();
        let num = hit
            .get("zo_sql_num")
            .and_then(|v| v.as_i64())
            .unwrap_or_default();
        search_result_hits.push((key, num));
    }

    let result_count;
    if no_count {
        // For alphabetical sorting, collect all entries first
        let mut all_entries: Vec<_> = search_result_hits;
        all_entries.sort_by(|a, b| a.0.cmp(&b.0));
        all_entries.truncate(top_k as usize);

        let top_hits = all_entries
            .into_iter()
            .map(|(k, v)| {
                let mut item = Map::new();
                item.insert("zo_sql_key".to_string(), Value::String(k));
                item.insert("zo_sql_num".to_string(), Value::Number(v.into()));
                Value::Object(item)
            })
            .collect::<Vec<_>>();

        result_count = top_hits.len();
        let mut field_value: Map<String, Value> = Map::new();
        field_value.insert("field".to_string(), Value::String(field.to_string()));
        field_value.insert("values".to_string(), Value::Array(top_hits));
        top_k_values.push(Value::Object(field_value));
    } else {
        // For value-based sorting, use a min heap to get top k elements
        let mut min_heap: BinaryHeap<Reverse<(i64, String)>> =
            BinaryHeap::with_capacity(top_k as usize);
        for (k, v) in search_result_hits {
            if min_heap.len() < top_k as usize {
                // If heap not full, just add
                min_heap.push(Reverse((v, k)));
            } else if v > min_heap.peek().unwrap().0.0 {
                // If current value is larger than smallest in heap, replace it
                min_heap.pop();
                min_heap.push(Reverse((v, k)));
            }
        }

        // Convert heap to vector and sort in descending order
        let mut top_elements: Vec<_> = min_heap.into_iter().map(|Reverse((v, k))| (k, v)).collect();
        top_elements.sort_by(|a, b| b.1.cmp(&a.1));

        let top_hits = top_elements
            .into_iter()
            .map(|(k, v)| {
                let mut item = Map::new();
                item.insert("zo_sql_key".to_string(), Value::String(k));
                item.insert("zo_sql_num".to_string(), Value::Number(v.into()));
                Value::Object(item)
            })
            .collect::<Vec<_>>();

        result_count = top_hits.len();
        let mut field_value: Map<String, Value> = Map::new();
        field_value.insert("field".to_string(), Value::String(field.to_string()));
        field_value.insert("values".to_string(), Value::Array(top_hits));
        top_k_values.push(Value::Object(field_value));
    }

    Ok((top_k_values, result_count as u64))
}
