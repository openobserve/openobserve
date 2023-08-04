// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use utoipa::ToSchema;

use crate::common::{self, json};
use crate::service::search::datafusion::storage::StorageType;

#[derive(Clone, Debug)]
pub struct Session {
    pub id: String,
    pub storage_type: StorageType,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[schema(as = SearchRequest)]
pub struct Request {
    #[schema(value_type = SearchQuery)]
    pub query: Query,
    #[serde(default)]
    pub aggs: HashMap<String, String>,
    #[serde(default)]
    pub encoding: RequestEncoding,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum RequestEncoding {
    #[serde(rename = "base64")]
    Base64,
    #[default]
    #[serde(rename = "")]
    Empty,
}

impl From<&str> for RequestEncoding {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "base64" => RequestEncoding::Base64,
            _ => RequestEncoding::Empty,
        }
    }
}

impl std::fmt::Display for RequestEncoding {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            RequestEncoding::Base64 => write!(f, "base64"),
            RequestEncoding::Empty => write!(f, ""),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[schema(as = SearchQuery)]
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
    pub sort_by: Option<String>,
    #[serde(default)]
    pub sql_mode: String,
    #[serde(default)]
    pub query_type: String,
    #[serde(default)]
    pub track_total_hits: bool,
    #[serde(default)]
    pub query_context: Option<String>,
    #[serde(default)]
    pub uses_zo_fn: bool,
    #[serde(default)]
    pub query_fn: Option<String>,
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
            sort_by: None,
            sql_mode: "context".to_string(),
            query_type: "logs".to_string(),
            track_total_hits: false,
            query_context: None,
            uses_zo_fn: false,
            query_fn: None,
        }
    }
}

impl Request {
    #[inline]
    pub fn decode(&mut self) -> Result<(), std::io::Error> {
        match self.encoding {
            RequestEncoding::Base64 => {
                self.query.sql = match common::base64::decode(&self.query.sql) {
                    Ok(v) => v,
                    Err(e) => {
                        return Err(e);
                    }
                };
                for (_, v) in self.aggs.iter_mut() {
                    *v = match common::base64::decode(v) {
                        Ok(v) => v,
                        Err(e) => {
                            return Err(e);
                        }
                    };
                }
            }
            RequestEncoding::Empty => {}
        }
        self.encoding = RequestEncoding::Empty;
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, ToSchema)]
#[schema(as = SearchResponse)]
pub struct Response {
    pub took: usize,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub took_detail: Option<ResponseTook>,
    #[schema(value_type = Vec<Object>)]
    pub hits: Vec<json::Value>,
    #[serde(default)]
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    #[schema(value_type = Object)]
    pub aggs: HashMap<String, Vec<json::Value>>,
    pub total: usize,
    pub from: usize,
    pub size: usize,
    #[serde(default)]
    #[serde(skip_serializing)]
    pub file_count: usize,
    pub scan_size: usize,
    #[serde(default)]
    #[serde(skip_serializing_if = "String::is_empty")]
    pub response_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, ToSchema)]
pub struct ResponseTook {
    pub total: usize,
    pub wait_queue: usize,
    pub cluster_total: usize,
    pub cluster_wait_queue: usize,
}

impl Response {
    pub fn new(from: usize, size: usize) -> Self {
        Response {
            took: 0,
            took_detail: None,
            total: 0,
            from,
            size,
            file_count: 0,
            scan_size: 0,
            hits: Vec::new(),
            aggs: HashMap::new(),
            response_type: "".to_string(),
        }
    }

    pub fn add_hit(&mut self, hit: &json::Value) {
        self.hits.push(hit.to_owned());
        self.total += 1;
    }

    pub fn add_agg(&mut self, name: &str, hit: &json::Value) {
        let val = self.aggs.entry(name.to_string()).or_default();
        val.push(hit.to_owned());
    }

    pub fn set_cluster_took(&mut self, val: usize, wait: usize) {
        self.took = val - wait;
        self.took_detail = Some(ResponseTook {
            total: 0,
            wait_queue: 0,
            cluster_total: val,
            cluster_wait_queue: wait,
        });
    }

    pub fn set_local_took(&mut self, val: usize, wait: usize) {
        if self.took_detail.is_some() {
            self.took_detail.as_mut().unwrap().total = val;
            self.took_detail.as_mut().unwrap().wait_queue = wait;
        }
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
    use super::*;

    #[test]
    fn test_response() {
        let mut res = Response::default();
        res.set_total(10);
        res.set_file_count(5);
        let hit = json::json!({"num":12});
        let mut val_map = json::Map::new();
        val_map.insert("id".to_string(), json::json!({"id":1}));
        res.add_agg("count", &json::Value::Object(val_map));
        res.add_hit(&hit); // total+1
        assert_eq!(res.total, 11);
    }

    #[test]
    fn test_request_encoding() {
        let req = json::json!(
            {
                "query": {
                    "sql": "c2VsZWN0ICogZnJvbSB0ZXN0",
                    "from": 0,
                    "size": 10,
                    "start_time": 0,
                    "end_time": 0,
                    "sql_mode": "context",
                    "track_total_hits": false
                },
                "aggs": {
                    "sql": "c2VsZWN0ICogZnJvbSBvbHltcGljcw=="
                },
                "encoding": "base64"
            }
        );
        let mut req: Request = json::from_value(req).unwrap();
        req.decode().unwrap();
        assert_eq!(req.query.sql, "select * from test");
        assert_eq!(req.aggs.get("sql").unwrap(), "select * from olympics");
    }

    #[test]
    fn test_request_no_encoding() {
        let req = json::json!(
            {
                "query": {
                    "sql": "select * from test",
                    "from": 0,
                    "size": 10,
                    "start_time": 0,
                    "end_time": 0,
                    "sql_mode": "context",
                    "track_total_hits": false
                },
                "aggs": {
                    "sql": "select * from olympics"
                },
                "encoding": ""
            }
        );
        let mut req: Request = json::from_value(req).unwrap();
        req.decode().unwrap();
        assert_eq!(req.query.sql, "select * from test");
        assert_eq!(req.aggs.get("sql").unwrap(), "select * from olympics");
    }
}
