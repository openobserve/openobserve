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

use config::{cluster::LOCAL_NODE, meta::cluster::NodeInfo};
use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SearchInspectorFields {
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
    pub region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster: Option<String>,
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
        let mut ret = Self::new();
        ret.fields.cluster = Some(LOCAL_NODE.get_cluster_name());
        #[cfg(feature = "enterprise")]
        {
            ret.fields.region = Some(
                o2_enterprise::enterprise::common::infra::config::get_config()
                    .super_cluster
                    .region
                    .clone(),
            );
        }
        ret
    }
}

impl SearchInspectorFieldsBuilder {
    pub fn new() -> Self {
        let mut ret = Self {
            fields: Default::default(),
        };
        ret.fields.cluster = Some(LOCAL_NODE.get_cluster_name());
        #[cfg(feature = "enterprise")]
        {
            ret.fields.region = Some(
                o2_enterprise::enterprise::common::infra::config::get_config()
                    .super_cluster
                    .region
                    .clone(),
            );
        }
        ret
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

    #[allow(unused)]
    pub fn cluster(mut self, value: String) -> Self {
        self.fields.cluster = Some(value);
        self
    }

    #[allow(unused)]
    pub fn region(mut self, value: String) -> Self {
        self.fields.region = Some(value);
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
            .build();

        let result = search_inspector_fields(msg.clone(), fields);
        assert!(result.contains("test message"));
        assert!(result.contains("\"duration\":100"));
        assert!(result.contains("\"component\":\"search\""));
    }

    #[test]
    fn test_extract_search_inspector_fields() {
        let msg = "[trace_id abc123] in leader task finish #{\"duration\":180}#";
        let fields = extract_search_inspector_fields(msg).unwrap();

        assert_eq!(fields.duration, Some(180));
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
}
