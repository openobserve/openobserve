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

use config::meta::cluster::Role;
use serde::{Deserialize, Serialize};

use crate::service::search::index::IndexCondition;

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SearchInspectorFields {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_role: Option<Vec<Role>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub desc: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_cache_spend_time: Option<usize>, // unit ms
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_cache_reduced_time_range: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_leader_spend_time: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_cache_reduce_time: Option<(usize, usize)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_get_file_id_list: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_file_id_list_took: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_get_node_list_took: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_get_node_list_num: Option<(usize, usize)>, // (node_num, querier_num)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_check_work_group_wait_in_queue: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_run_datafution_took: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_get_ctx_and_physical_plan_took: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_do_get_stream_end_took: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_generated_physical_plan_took: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_inverted_index_reduced_file_list_num: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_inverted_index_idx_took: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_storage_cache_took: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_flighstream_files: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_flighstream_scan_size: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_flighstream_num_rows: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_cached_ids: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_remote_db_left_ids: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_remote_db_files: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_remote_db_query_took: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_set_cached_ids_took: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_wal_parquet_files: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_wal_parquet_files_original_size: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_wal_parquet_compressed_size: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_mem_files: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_mem_files_original_size: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_mem_compressed_size: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_querier_files: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_querier_memory_cached_files: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_querier_disk_cached_files: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_tantivy_querier_files: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_tantivy_querier_memory_cached_files: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_tantivy_querier_disk_cached_files: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_tantivy_index_condition: Option<IndexCondition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_tantivy_total_hits: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_tantivy_is_add_filter_back: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_tantivy_file_num: Option<usize>,
}

impl SearchInspectorFields {
    pub fn new() -> Self {
        Self::default()
    }
}

pub struct SearchInspectorFieldsBuilder {
    fields: SearchInspectorFields,
}

impl Default for SearchInspectorFieldsBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl SearchInspectorFieldsBuilder {
    pub fn new() -> Self {
        Self {
            fields: Default::default(),
        }
    }

    pub fn timestamp(mut self, value: String) -> Self {
        self.fields.timestamp = Some(value);
        self
    }

    pub fn node_role(mut self, role: Vec<Role>) -> Self {
        self.fields.node_role = Some(role);
        self
    }

    pub fn node_name(mut self, value: String) -> Self {
        self.fields.node_name = Some(value);
        self
    }

    pub fn search_role(mut self, search_role: String) -> Self {
        self.fields.search_role = Some(search_role);
        self
    }

    pub fn duration(mut self, duration: usize) -> Self {
        self.fields.duration = Some(duration);
        self
    }

    pub fn component(mut self, component: String) -> Self {
        self.fields.component = Some(component);
        self
    }

    pub fn desc(mut self, value: String) -> Self {
        self.fields.desc = Some(value);
        self
    }

    pub fn search_cache_spend_time(mut self, time: usize) -> Self {
        self.fields.search_cache_spend_time = Some(time);
        self
    }

    pub fn search_cache_reduced_time_range(mut self, time_range: Vec<String>) -> Self {
        self.fields.search_cache_reduced_time_range = Some(time_range);
        self
    }

    pub fn search_leader_spend_time(mut self, time: usize) -> Self {
        self.fields.search_leader_spend_time = Some(time);
        self
    }

    pub fn search_cache_reduce_time(mut self, time: (usize, usize)) -> Self {
        self.fields.search_cache_reduce_time = Some(time);
        self
    }

    pub fn search_get_file_id_list(mut self, list: usize) -> Self {
        self.fields.search_get_file_id_list = Some(list);
        self
    }

    pub fn search_file_id_list_took(mut self, time: usize) -> Self {
        self.fields.search_file_id_list_took = Some(time);
        self
    }

    pub fn search_get_node_list_took(mut self, time: usize) -> Self {
        self.fields.search_get_node_list_took = Some(time);
        self
    }

    pub fn search_get_node_list_num(mut self, time: (usize, usize)) -> Self {
        self.fields.search_get_node_list_num = Some(time);
        self
    }

    pub fn search_check_work_group_wait_in_queue(mut self, time: usize) -> Self {
        self.fields.search_check_work_group_wait_in_queue = Some(time);
        self
    }

    pub fn search_run_datafution_took(mut self, time: usize) -> Self {
        self.fields.search_run_datafution_took = Some(time);
        self
    }

    pub fn search_get_ctx_and_physical_plan_took(mut self, time: usize) -> Self {
        self.fields.search_get_ctx_and_physical_plan_took = Some(time);
        self
    }

    pub fn search_do_get_stream_end_took(mut self, time: usize) -> Self {
        self.fields.search_do_get_stream_end_took = Some(time);
        self
    }

    pub fn search_generated_physical_plan_took(mut self, time: usize) -> Self {
        self.fields.search_generated_physical_plan_took = Some(time);
        self
    }

    pub fn search_inverted_index_reduced_file_list_num(mut self, num: usize) -> Self {
        self.fields.search_inverted_index_reduced_file_list_num = Some(num);
        self
    }

    pub fn search_inverted_index_idx_took(mut self, took: usize) -> Self {
        self.fields.search_inverted_index_idx_took = Some(took);
        self
    }

    pub fn search_storage_cache_took(mut self, took: usize) -> Self {
        self.fields.search_storage_cache_took = Some(took);
        self
    }

    pub fn search_flighstream_files(mut self, num: usize) -> Self {
        self.fields.search_flighstream_files = Some(num);
        self
    }

    pub fn search_flighstream_scan_size(mut self, size: usize) -> Self {
        self.fields.search_flighstream_scan_size = Some(size);
        self
    }

    pub fn search_flighstream_num_rows(mut self, num: usize) -> Self {
        self.fields.search_flighstream_num_rows = Some(num);
        self
    }

    pub fn search_cached_ids(mut self, len: usize) -> Self {
        self.fields.search_cached_ids = Some(len);
        self
    }

    pub fn search_remote_db_left_ids(mut self, len: usize) -> Self {
        self.fields.search_remote_db_left_ids = Some(len);
        self
    }

    pub fn search_remote_db_files(mut self, len: usize) -> Self {
        self.fields.search_remote_db_files = Some(len);
        self
    }

    pub fn search_remote_db_query_took(mut self, took: usize) -> Self {
        self.fields.search_remote_db_query_took = Some(took);
        self
    }

    pub fn search_set_cached_ids_took(mut self, took: usize) -> Self {
        self.fields.search_set_cached_ids_took = Some(took);
        self
    }

    pub fn search_wal_parquet_files(mut self, num: usize) -> Self {
        self.fields.search_wal_parquet_files = Some(num);
        self
    }

    pub fn search_wal_parquet_files_original_size(mut self, size: usize) -> Self {
        self.fields.search_wal_parquet_files_original_size = Some(size);
        self
    }

    pub fn search_wal_parquet_compressed_size(mut self, size: usize) -> Self {
        self.fields.search_wal_parquet_compressed_size = Some(size);
        self
    }

    pub fn search_mem_files(mut self, num: usize) -> Self {
        self.fields.search_mem_files = Some(num);
        self
    }

    pub fn search_mem_files_original_size(mut self, size: usize) -> Self {
        self.fields.search_mem_files_original_size = Some(size);
        self
    }

    pub fn search_mem_compressed_size(mut self, size: usize) -> Self {
        self.fields.search_mem_compressed_size = Some(size);
        self
    }

    pub fn search_querier_files(mut self, num: usize) -> Self {
        self.fields.search_querier_files = Some(num);
        self
    }

    pub fn search_querier_memory_cached_files(mut self, num: usize) -> Self {
        self.fields.search_querier_memory_cached_files = Some(num);
        self
    }

    pub fn search_querier_disk_cached_files(mut self, num: usize) -> Self {
        self.fields.search_querier_disk_cached_files = Some(num);
        self
    }

    pub fn search_tantivy_querier_files(mut self, num: usize) -> Self {
        self.fields.search_tantivy_querier_files = Some(num);
        self
    }

    pub fn search_tantivy_querier_memory_cached_files(mut self, num: usize) -> Self {
        self.fields.search_tantivy_querier_memory_cached_files = Some(num);
        self
    }

    pub fn search_tantivy_querier_disk_cached_files(mut self, num: usize) -> Self {
        self.fields.search_tantivy_querier_disk_cached_files = Some(num);
        self
    }

    pub fn search_tantivy_index_condition(mut self, confition: Option<IndexCondition>) -> Self {
        self.fields.search_tantivy_index_condition = confition;
        self
    }

    pub fn search_tantivy_total_hits(mut self, num: usize) -> Self {
        self.fields.search_tantivy_total_hits = Some(num);
        self
    }

    pub fn search_tantivy_is_add_filter_back(mut self, is_add_filter_back: bool) -> Self {
        self.fields.search_tantivy_is_add_filter_back = Some(is_add_filter_back);
        self
    }

    pub fn search_tantivy_file_num(mut self, num: usize) -> Self {
        self.fields.search_tantivy_file_num = Some(num);
        self
    }

    pub fn build(self) -> SearchInspectorFields {
        self.fields
    }
}

pub fn search_inspector_fields(msg: String, kvs: SearchInspectorFields) -> String {
    if msg.is_empty() {
        return msg;
    }

    let mut result = msg;
    if let Ok(str) = serde_json::to_string(&kvs) {
        result.push_str(format!(" #{str}#").as_str());
    }

    result
}

pub fn extract_search_inspector_fields(msg: &str) -> Option<SearchInspectorFields> {
    if let Some(start) = msg.find(" #{\"") {
        if let Some(end) = msg[start..].find("}#") {
            let json_str = &msg[start + 2..start + end + 1];
            if let Ok(fields) = serde_json::from_str::<SearchInspectorFields>(json_str) {
                return Some(fields);
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_search_inspector_fields() {
        let msg = "test message".to_string();
        let fields = SearchInspectorFieldsBuilder::new()
            .duration(100)
            .component("search".to_string())
            .search_cache_spend_time(50)
            .build();

        let result = search_inspector_fields(msg.clone(), fields);
        assert!(result.contains("test message"));
        assert!(result.contains("\"duration\":100"));
        assert!(result.contains("\"component\":\"search\""));
        assert!(result.contains("\"search_cache_spend_time\":50"));
    }

    #[test]
    fn test_extract_search_inspector_fields() {
        let msg = "[trace_id abc123] in leader task finish #{\"duration\":180,\"search_cache_spend_time\":180}#";
        let fields = extract_search_inspector_fields(msg).unwrap();

        assert_eq!(fields.duration, Some(180));
        assert_eq!(fields.search_cache_spend_time, Some(180));
        assert_eq!(fields.component, None);
    }

    #[test]
    fn test_extract_search_inspector_fields_empty() {
        let msg = "no fields here";
        assert!(extract_search_inspector_fields(msg).is_none());
    }

    #[test]
    fn test_extract_search_inspector_fields_invalid_json() {
        let msg = "invalid #{\"duration\":invalid}#";
        assert!(extract_search_inspector_fields(msg).is_none());
    }

    #[test]
    fn test_extract_search_inspector_fields_complex() {
        let msg = "[trace_id abc123] complex task #{\"duration\":200,\"component\":\"search\",\"search_cache_spend_time\":150,\"search_cache_reduced_time_range\":[\"2024-01-01\",\"2024-01-02\"]}#";
        let fields = extract_search_inspector_fields(msg).unwrap();

        assert_eq!(fields.duration, Some(200));
        assert_eq!(fields.component, Some("search".to_string()));
        assert_eq!(fields.search_cache_spend_time, Some(150));
        assert_eq!(
            fields.search_cache_reduced_time_range,
            Some(vec!["2024-01-01".to_string(), "2024-01-02".to_string()])
        );
    }

    #[test]
    fn test_search_inspector_fields_builder() {
        let fields = SearchInspectorFieldsBuilder::new()
            .duration(100)
            .component("test".to_string())
            .search_cache_spend_time(50)
            .search_cache_reduced_time_range(vec!["2024-01-01".to_string()])
            .build();

        assert_eq!(fields.duration, Some(100));
        assert_eq!(fields.component, Some("test".to_string()));
        assert_eq!(fields.search_cache_spend_time, Some(50));
        assert_eq!(
            fields.search_cache_reduced_time_range,
            Some(vec!["2024-01-01".to_string()])
        );
    }
}
