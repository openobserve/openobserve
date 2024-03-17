// Copyright 2023 Zinc Labs Inc.
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

use std::collections::HashMap;

use config::utils::{base64, json};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::service::search::datafusion::storage::StorageType;

#[derive(Clone, Debug)]
pub struct Session {
    pub id: String,
    pub storage_type: StorageType,
    pub search_type: SearchType,
    pub work_group: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SearchType {
    Normal,
    Aggregation,
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
    #[serde(default)]
    pub timeout: i64,
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
    pub fast_mode: bool,
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
            sql_mode: "".to_string(),
            fast_mode: false,
            query_type: "".to_string(),
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
                self.query.sql = match base64::decode(&self.query.sql) {
                    Ok(v) => v,
                    Err(e) => {
                        return Err(e);
                    }
                };
                for (_, v) in self.aggs.iter_mut() {
                    *v = match base64::decode(v) {
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
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub columns: Vec<String>,
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
    pub scan_records: usize,
    #[serde(default)]
    #[serde(skip_serializing_if = "String::is_empty")]
    pub response_type: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "String::is_empty")]
    pub session_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub function_error: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, ToSchema)]
pub struct ResponseTook {
    pub total: usize,
    pub wait_queue: usize,
    pub cluster_total: usize,
    pub cluster_wait_queue: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub nodes: Vec<ResponseNodeTook>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, ToSchema)]
pub struct ResponseNodeTook {
    pub node: String,
    pub is_ingester: bool,
    pub took: usize,
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
            scan_records: 0,
            columns: Vec::new(),
            hits: Vec::new(),
            aggs: HashMap::new(),
            response_type: "".to_string(),
            session_id: "".to_string(),
            function_error: "".to_string(),
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
            nodes: Vec::new(),
        });
    }

    pub fn set_local_took(&mut self, val: usize, wait: usize) {
        if self.took_detail.is_some() {
            self.took_detail.as_mut().unwrap().total = val;
            if wait > 0 {
                self.took_detail.as_mut().unwrap().wait_queue = wait;
            }
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

    pub fn set_scan_records(&mut self, val: usize) {
        self.scan_records = val;
    }

    pub fn set_session_id(&mut self, session_id: String) {
        self.session_id = session_id;
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct SearchPartitionRequest {
    pub sql: String,
    pub start_time: i64,
    pub end_time: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct SearchPartitionResponse {
    pub session_id: String,
    pub file_num: usize,
    pub records: usize,
    pub original_size: usize,
    pub compressed_size: usize,
    pub partitions: Vec<[i64; 2]>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct MultiSearchPartitionRequest {
    pub sql: Vec<String>,
    pub start_time: i64,
    pub end_time: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct MultiSearchPartitionResponse {
    pub success: hashbrown::HashMap<String, SearchPartitionResponse>,
    pub error: hashbrown::HashMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[schema(as = SearchRequest)]
pub struct MultiStreamRequest {
    #[serde(default)]
    pub sql: Vec<String>,
    #[serde(default)]
    pub aggs: HashMap<String, String>,
    #[serde(default)]
    pub encoding: RequestEncoding,
    #[serde(default)]
    pub timeout: i64,
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

impl MultiStreamRequest {
    pub fn to_query_req(&mut self) -> Vec<Request> {
        let mut res = vec![];
        for query in &self.sql {
            res.push(Request {
                query: Query {
                    sql: query.to_string(),
                    from: self.from,
                    size: self.size,
                    start_time: self.start_time,
                    end_time: self.end_time,
                    sort_by: self.sort_by.clone(),
                    sql_mode: self.sql_mode.clone(),
                    query_type: self.query_type.clone(),
                    track_total_hits: self.track_total_hits,
                    query_context: self.query_context.clone(),
                    uses_zo_fn: self.uses_zo_fn,
                    query_fn: self.query_fn.clone(),
                },
                aggs: self.aggs.clone(),
                encoding: self.encoding,
                timeout: self.timeout,
            });
        }
        res
    }
}
#[cfg(test)]
mod tests {
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
