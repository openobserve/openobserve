use ahash::AHashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use crate::common::json::unflatten_json;
use crate::service::search::datafusion::storage::file_list;

#[derive(Clone, Debug)]
pub struct Session {
    pub id: String,
    pub data_type: file_list::SessionType,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Request {
    pub query: Query,
    #[serde(default)]
    pub aggs: AHashMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Query {
    pub sql: String,
    #[serde(default)]
    pub from: usize,
    #[serde(default = "default_size")]
    pub size: usize,
    #[serde(default)]
    pub start_time: i64,
    #[serde(default)]
    pub end_time: i64,
    #[serde(default)]
    pub sql_mode: String,
    #[serde(default)]
    pub track_total_hits: bool,
}

fn default_size() -> usize {
    10
}

impl Default for Query {
    fn default() -> Self {
        Query {
            sql: "".to_string(),
            from: 0,
            size: 10,
            start_time: 0,
            end_time: 0,
            sql_mode: "context".to_string(),
            track_total_hits: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Response {
    pub took: usize,
    pub hits: Vec<Value>,
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub aggs: AHashMap<String, Vec<Value>>,
    pub total: usize,
    pub from: usize,
    pub size: usize,
    #[serde(skip_serializing)]
    pub file_count: usize,
    pub scan_size: usize,
}

impl Default for Response {
    fn default() -> Self {
        Response {
            took: 0,
            total: 0,
            from: 0,
            size: 0,
            file_count: 0,
            scan_size: 0,
            hits: Vec::new(),
            aggs: AHashMap::new(),
        }
    }
}

impl Response {
    pub fn new(from: usize, size: usize) -> Self {
        Response {
            took: 0,
            total: 0,
            from,
            size,
            file_count: 0,
            scan_size: 0,
            hits: Vec::new(),
            aggs: AHashMap::new(),
        }
    }

    pub fn add_hit(&mut self, hit: &Value) {
        let hit = unflatten_json(hit);
        self.hits.push(hit);
        self.total += 1;
    }

    pub fn add_agg(&mut self, name: &str, hit: &Value) {
        let val = self.aggs.entry(name.to_string()).or_default();
        val.push(hit.to_owned());
    }

    pub fn set_took(&mut self, val: usize) {
        self.took = val;
    }

    pub fn set_total(&mut self, val: usize) {
        self.total = val;
    }

    pub fn set_file_count(&mut self, val: usize) {
        self.file_count = val;
    }

    pub fn set_scan_size(&mut self, val: usize) {
        self.scan_size = val;
    }
}

#[cfg(test)]
mod test {
    use serde_json::json;

    use super::*;

    #[test]
    fn test_response() {
        let mut res = Response::default();
        res.set_total(10);
        res.set_file_count(5);
        let hit = json!({"num":12});
        let mut val_map = serde_json::Map::new();
        val_map.insert("id".to_string(), json!({"id":1}));
        res.add_agg("count", &serde_json::Value::Object(val_map));
        res.add_hit(&hit); // total+1
        assert_eq!(res.total, 11);
    }
}
