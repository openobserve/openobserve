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

mod generated;

pub use generated::{cluster as cluster_rpc, loki as loki_rpc, prometheus as prometheus_rpc};

impl From<Vec<serde_json::Value>> for cluster_rpc::IngestionData {
    fn from(usages: Vec<serde_json::Value>) -> Self {
        Self {
            data: serde_json::to_vec(&usages).unwrap(),
        }
    }
}

impl cluster_rpc::KvItem {
    pub fn new(key: &str, value: &str) -> Self {
        Self {
            key: key.to_owned(),
            value: value.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_kv_item_new_sets_key_and_value() {
        let item = cluster_rpc::KvItem::new("my_key", "my_value");
        assert_eq!(item.key, "my_key");
        assert_eq!(item.value, "my_value");
    }

    #[test]
    fn test_kv_item_new_empty_strings() {
        let item = cluster_rpc::KvItem::new("", "");
        assert_eq!(item.key, "");
        assert_eq!(item.value, "");
    }

    #[test]
    fn test_ingestion_data_from_empty_vec() {
        let data = cluster_rpc::IngestionData::from(vec![]);
        let decoded: Vec<serde_json::Value> = serde_json::from_slice(&data.data).unwrap();
        assert!(decoded.is_empty());
    }

    #[test]
    fn test_ingestion_data_from_vec_roundtrips() {
        let values = vec![
            serde_json::json!({"level": "error", "count": 5}),
            serde_json::json!({"level": "warn", "count": 10}),
        ];
        let data = cluster_rpc::IngestionData::from(values.clone());
        let decoded: Vec<serde_json::Value> = serde_json::from_slice(&data.data).unwrap();
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0]["level"], "error");
        assert_eq!(decoded[1]["count"], 10);
    }

    #[test]
    fn test_ingestion_data_from_single_item() {
        let values = vec![serde_json::json!({"key": "value"})];
        let data = cluster_rpc::IngestionData::from(values);
        assert!(!data.data.is_empty());
        let decoded: Vec<serde_json::Value> = serde_json::from_slice(&data.data).unwrap();
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0]["key"], "value");
    }
}
