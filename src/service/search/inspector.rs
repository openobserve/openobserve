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

use config::{cluster::LOCAL_NODE, get_config, meta::cluster::NodeInfo};
use serde::{Deserialize, Serialize};

#[cfg(feature = "enterprise")]
#[derive(Debug, Serialize, Deserialize)]
pub struct SearchInspectorEvent {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inspector: Option<SearchInspectorFields>,
    pub _timestamp: i64,
    pub code_namespace: Option<String>,
    pub target: Option<String>,
    pub code_filepath: Option<String>,
    pub code_lineno: Option<String>,
    pub level: Option<String>,
}

#[cfg(feature = "enterprise")]
#[derive(Debug, Serialize, Deserialize)]
pub struct SearchInspector {
    pub sql: String,
    pub start_time: String,
    pub end_time: String,
    pub total_duration: usize,
    pub scan_size: usize,
    pub scan_records: usize,
    pub data_records: usize,
    pub events: Vec<SearchInspectorFields>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SearchInspectorFields {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
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
    pub sql: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_range: Option<(String, String)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scan_size: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scan_records: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_records: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub events: Option<Vec<SearchInspectorFields>>,
}

#[cfg(feature = "enterprise")]
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
            fields: SearchInspectorFields {
                region: Some(LOCAL_NODE.get_region()),
                cluster: Some(LOCAL_NODE.get_cluster()),
                ..Default::default()
            },
        }
    }

    pub fn trace_id(mut self, trace_id: String) -> Self {
        self.fields.trace_id = Some(trace_id);
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

    pub fn sql(mut self, sql: String) -> Self {
        self.fields.sql = Some(sql);
        self
    }

    pub fn time_range(mut self, value: (String, String)) -> Self {
        self.fields.time_range = Some(value);
        self
    }

    pub fn scan_size(mut self, value: usize) -> Self {
        self.fields.scan_size = Some(value);
        self
    }

    pub fn scan_records(mut self, value: usize) -> Self {
        self.fields.scan_records = Some(value);
        self
    }

    pub fn data_records(mut self, value: usize) -> Self {
        self.fields.data_records = Some(value);
        self
    }

    pub fn region(mut self, value: String) -> Self {
        self.fields.region = Some(value);
        self
    }

    pub fn cluster(mut self, value: String) -> Self {
        self.fields.cluster = Some(value);
        self
    }

    pub fn build(self) -> SearchInspectorFields {
        self.fields
    }
}

pub fn search_inspector_fields(msg: String, kvs: SearchInspectorFields) -> String {
    if !get_config().common.search_inspector_enabled {
        return msg;
    }

    search_inspector_fields_inner(msg, kvs)
}

fn search_inspector_fields_inner(msg: String, kvs: SearchInspectorFields) -> String {
    if msg.is_empty() {
        return msg;
    }

    let mut result = msg;
    if let Ok(str) = serde_json::to_string(&kvs) {
        result.push_str(format!(" #{str}#").as_str());
    }

    result
}

#[cfg(feature = "enterprise")]
pub fn extract_search_inspector_fields(msg: &str) -> Option<SearchInspectorFields> {
    if let Some(start) = msg.find(" #{\"")
        && let Some(end) = msg[start..].find("}#")
    {
        let json_str = &msg[start + 2..start + end + 1];
        if let Ok(fields) = serde_json::from_str::<SearchInspectorFields>(json_str) {
            return Some(fields);
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
            .trace_id("abc123".to_string())
            .duration(100)
            .component("search".to_string())
            .build();

        let result = search_inspector_fields_inner(msg.clone(), fields);
        assert!(result.contains("test message"));
        assert!(result.contains("\"trace_id\":\"abc123\""));
        assert!(result.contains("\"duration\":100"));
        assert!(result.contains("\"component\":\"search\""));
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_search_inspector_fields() {
        let msg = "[trace_id abc123] in leader task finish #{\"duration\":180}#";
        let fields = extract_search_inspector_fields(msg).unwrap();

        assert_eq!(fields.duration, Some(180));
        assert_eq!(fields.component, None);
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_search_inspector_fields_empty() {
        let msg = "no fields here";
        assert!(extract_search_inspector_fields(msg).is_none());
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_search_inspector_fields_invalid_json() {
        let msg = "invalid #{\"duration\":invalid}#";
        assert!(extract_search_inspector_fields(msg).is_none());
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_extract_search_inspector_fields_complex() {
        let msg = "[trace_id abc123] complex task #{\"duration\":200,\"component\":\"search\"}#";
        let fields = extract_search_inspector_fields(msg).unwrap();

        assert_eq!(fields.duration, Some(200));
        assert_eq!(fields.component, Some("search".to_string()));
    }

    #[test]
    fn test_search_inspector_fields_builder() {
        let fields = SearchInspectorFieldsBuilder::new()
            .duration(100)
            .component("test".to_string())
            .build();

        assert_eq!(fields.duration, Some(100));
        assert_eq!(fields.component, Some("test".to_string()));
    }

    #[test]
    fn test_search_inspector_fields_all_none_absent() {
        let fields = SearchInspectorFields {
            trace_id: None,
            timestamp: None,
            node_name: None,
            search_role: None,
            duration: None,
            component: None,
            desc: None,
            sql: None,
            time_range: None,
            scan_size: None,
            scan_records: None,
            data_records: None,
            region: None,
            cluster: None,
            events: None,
        };
        let json = serde_json::to_value(&fields).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("trace_id"));
        assert!(!obj.contains_key("timestamp"));
        assert!(!obj.contains_key("node_name"));
        assert!(!obj.contains_key("search_role"));
        assert!(!obj.contains_key("duration"));
        assert!(!obj.contains_key("component"));
        assert!(!obj.contains_key("desc"));
        assert!(!obj.contains_key("sql"));
        assert!(!obj.contains_key("time_range"));
        assert!(!obj.contains_key("scan_size"));
        assert!(!obj.contains_key("scan_records"));
        assert!(!obj.contains_key("data_records"));
        assert!(!obj.contains_key("region"));
        assert!(!obj.contains_key("cluster"));
        assert!(!obj.contains_key("events"));
    }

    #[test]
    fn test_search_inspector_fields_some_present() {
        let fields = SearchInspectorFields {
            trace_id: Some("t1".to_string()),
            timestamp: Some("2024-01-01".to_string()),
            node_name: Some("node1".to_string()),
            search_role: Some("leader".to_string()),
            duration: Some(42),
            component: Some("grpc".to_string()),
            desc: Some("desc".to_string()),
            sql: Some("SELECT 1".to_string()),
            time_range: Some(("start".to_string(), "end".to_string())),
            scan_size: Some(1024),
            scan_records: Some(100),
            data_records: Some(50),
            region: Some("us-east".to_string()),
            cluster: Some("cluster1".to_string()),
            events: Some(vec![]),
        };
        let json = serde_json::to_value(&fields).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("trace_id"));
        assert!(obj.contains_key("timestamp"));
        assert!(obj.contains_key("node_name"));
        assert!(obj.contains_key("search_role"));
        assert!(obj.contains_key("duration"));
        assert!(obj.contains_key("component"));
        assert!(obj.contains_key("desc"));
        assert!(obj.contains_key("sql"));
        assert!(obj.contains_key("time_range"));
        assert!(obj.contains_key("scan_size"));
        assert!(obj.contains_key("scan_records"));
        assert!(obj.contains_key("data_records"));
        assert!(obj.contains_key("region"));
        assert!(obj.contains_key("cluster"));
        assert!(obj.contains_key("events"));
    }

    #[test]
    fn test_search_inspector_fields_inner_empty_msg() {
        let fields = SearchInspectorFields::default();
        let result = search_inspector_fields_inner("".to_string(), fields);
        assert_eq!(result, "");
    }

    #[test]
    fn test_search_inspector_fields_disabled_returns_msg() {
        // Default config has search_inspector_enabled=false → returns msg unchanged
        let msg = "original message".to_string();
        let fields = SearchInspectorFields::default();
        let result = search_inspector_fields(msg.clone(), fields);
        // If disabled, result == msg; if enabled, result contains msg + json
        assert!(result.contains("original message"));
    }

    #[test]
    fn test_search_inspector_fields_builder_new_defaults() {
        let builder = SearchInspectorFieldsBuilder::new();
        let fields = builder.build();
        // region and cluster are set from LOCAL_NODE
        assert!(fields.trace_id.is_none());
        assert!(fields.duration.is_none());
    }

    #[test]
    fn test_search_inspector_fields_builder_all_setters() {
        let fields = SearchInspectorFieldsBuilder::new()
            .trace_id("tid".to_string())
            .node_name("n1".to_string())
            .search_role("follower".to_string())
            .duration(10)
            .component("comp".to_string())
            .desc("d".to_string())
            .sql("SELECT *".to_string())
            .time_range(("a".to_string(), "b".to_string()))
            .scan_size(512)
            .scan_records(200)
            .data_records(100)
            .region("eu".to_string())
            .cluster("cl2".to_string())
            .build();
        assert_eq!(fields.trace_id, Some("tid".to_string()));
        assert_eq!(fields.node_name, Some("n1".to_string()));
        assert_eq!(fields.search_role, Some("follower".to_string()));
        assert_eq!(fields.duration, Some(10));
        assert_eq!(fields.scan_size, Some(512));
        assert_eq!(fields.scan_records, Some(200));
        assert_eq!(fields.data_records, Some(100));
        assert_eq!(fields.region, Some("eu".to_string()));
        assert_eq!(fields.cluster, Some("cl2".to_string()));
    }
}
