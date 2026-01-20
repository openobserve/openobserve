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

use std::collections::VecDeque;

use bytes::Bytes as BytesImpl;
use chrono::Duration;
use hashbrown::HashMap;
use proto::cluster_rpc;
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;

use crate::{
    config::get_config,
    meta::{search, sql::OrderBy, stream::StreamType},
    utils::{base64, json},
};

pub const PARTIAL_ERROR_RESPONSE_MESSAGE: &str =
    "Please be aware that the response is based on partial data";

/// To represent the query start and end time based of partition or cache
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TimeOffset {
    pub start_time: i64,
    pub end_time: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageType {
    Memory,
    Wal,
}

#[derive(Clone, Debug)]
pub struct Session {
    pub id: String,
    pub storage_type: StorageType,
    pub work_group: Option<String>,
    pub target_partitions: usize,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
#[schema(as = SearchRequest)]
pub struct Request {
    pub query: Query,
    #[serde(default)]
    pub encoding: RequestEncoding,
    #[serde(default)]
    pub regions: Vec<String>, // default query all regions, local: only query local region clusters
    #[serde(default)]
    pub clusters: Vec<String>, // default query all clusters, local: only query local cluster
    #[serde(default)]
    pub timeout: i64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub search_type: Option<SearchEventType>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub search_event_context: Option<SearchEventContext>,
    #[serde(default = "default_use_cache")]
    pub use_cache: bool,
    #[serde(default)]
    pub clear_cache: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub local_mode: Option<bool>,
}

pub fn default_use_cache() -> bool {
    get_config().common.result_cache_enabled
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
            "base64" => Self::Base64,
            _ => Self::Empty,
        }
    }
}

impl std::fmt::Display for RequestEncoding {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Self::Base64 => write!(f, "base64"),
            Self::Empty => write!(f, ""),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[schema(as = SearchQuery)]
pub struct Query {
    pub sql: String,
    #[serde(default)]
    pub from: i64,
    #[serde(default = "default_size")]
    pub size: i64,
    #[serde(default)]
    pub start_time: i64,
    #[serde(default)]
    pub end_time: i64,
    #[serde(default)]
    pub quick_mode: bool,
    #[serde(default)]
    pub query_type: String,
    #[serde(default)]
    pub track_total_hits: bool,
    #[serde(default)]
    pub uses_zo_fn: bool,
    #[serde(default)]
    pub query_fn: Option<String>,
    #[serde(default)]
    pub action_id: Option<String>,
    #[serde(default)]
    pub skip_wal: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<Object>)]
    pub sampling_config: Option<proto::cluster_rpc::SamplingConfig>,
    /// Simplified sampling API: just specify ratio (0.0-1.0), backend uses optimal defaults
    /// Takes precedence over sampling_config if both are provided
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sampling_ratio: Option<f64>,
    // streaming output
    #[serde(default)]
    pub streaming_output: bool,
    #[serde(default)]
    pub streaming_id: Option<String>,
    #[serde(default)]
    pub histogram_interval: i64,
}

fn default_size() -> i64 {
    crate::get_config().limit.query_default_limit
}

impl Default for Query {
    fn default() -> Self {
        Query {
            sql: "".to_string(),
            from: 0,
            size: 10,
            start_time: 0,
            end_time: 0,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            action_id: None,
            skip_wal: false,
            sampling_config: None,
            sampling_ratio: None,
            streaming_output: false,
            streaming_id: None,
            histogram_interval: 0,
        }
    }
}

impl Request {
    #[inline]
    pub fn decode(&mut self) -> Result<(), std::io::Error> {
        match self.encoding {
            RequestEncoding::Base64 => {
                let decoded = base64::decode_url(&self.query.sql)?;
                self.query.sql =
                    match crate::utils::query_select_utils::replace_o2_custom_patterns(&decoded) {
                        Ok(sql) => sql,
                        Err(e) => {
                            log::error!(
                                "Error replacing o2 custom patterns , returning original sql: {e}"
                            );
                            decoded
                        }
                    };
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
    pub took_detail: ResponseTook,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub columns: Vec<String>,
    #[schema(value_type = Vec<Object>)]
    pub hits: Vec<json::Value>,
    pub total: usize,
    pub from: i64,
    pub size: i64,
    pub cached_ratio: usize,
    #[serde(skip_serializing, default)]
    pub scan_files: usize,
    pub scan_size: usize,
    pub idx_scan_size: usize,
    pub scan_records: usize,
    #[serde(skip_serializing_if = "String::is_empty", default)]
    pub response_type: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "String::is_empty")]
    pub trace_id: String,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub function_error: Vec<String>,
    #[serde(default)]
    pub is_partial: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub histogram_interval: Option<i64>, // seconds, for histogram
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_start_time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_end_time: Option<i64>,
    #[serde(default)]
    pub result_cache_ratio: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order_by: Option<OrderBy>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub order_by_metadata: Vec<(String, OrderBy)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub converted_histogram_query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_histogram_eligible: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peak_memory_usage: Option<f64>,
}

/// Iterator for Streaming response of search `Response`
///
/// This is used to split the search response to smaller chunks based on
/// env variable
/// The format of the iterator is as follows:
/// - Chunk 1: Response Metadata
/// - Chunk 2: Hits (1MB)
/// - Chunk 3: Hits (1MB)
pub struct ResponseChunkIterator {
    // Original response (will be split into chunks)
    response: Response,
    // Target size for each chunk in bytes
    chunk_size: usize,
    // Hits waiting to be processed
    remaining_hits: VecDeque<crate::utils::json::Value>,
    // Whether metadata has been sent
    metadata_sent: bool,
    // Current position in the iteration
    position: usize,
}

impl ResponseChunkIterator {
    /// Create a new response chunk iterator
    pub fn new(mut response: Response, chunk_size: Option<usize>) -> Self {
        // Get the configured chunk size or use the provided one or default
        let chunk_size = chunk_size.unwrap_or_else(|| {
            // Get from config, convert from MB to bytes
            let mb = 1024 * 1024;
            crate::get_config()
                .http_streaming
                .streaming_response_chunk_size
                * mb
        });

        let hits = response.hits.drain(..).collect::<Vec<_>>();

        Self {
            response,
            chunk_size,
            remaining_hits: VecDeque::from(hits),
            metadata_sent: false,
            position: 0,
        }
    }
}

// Define the possible chunk types
#[derive(Debug, Clone)]
pub enum ResponseChunk {
    Metadata {
        response: Box<Response>,
    },
    Hits {
        hits: Vec<crate::utils::json::Value>,
    },
}

impl Iterator for ResponseChunkIterator {
    type Item = ResponseChunk;

    fn next(&mut self) -> Option<Self::Item> {
        // First send metadata
        if !self.metadata_sent {
            self.metadata_sent = true;
            self.position += 1;

            // Clone response but remove hits
            let mut metadata_response = self.response.clone();
            metadata_response.hits = vec![];

            return Some(ResponseChunk::Metadata {
                response: Box::new(metadata_response),
            });
        }

        // If we have no hits left, we're done
        if self.remaining_hits.is_empty() {
            return None;
        }

        // Create the next chunk of hits
        let mut current_chunk: Vec<crate::utils::json::Value> = Vec::with_capacity(self.chunk_size);
        let mut current_chunk_size: usize = 0;

        // Keep adding hits until we reach the target chunk size
        while !self.remaining_hits.is_empty() {
            // Peek at the front hit
            let hit = &self.remaining_hits[0];
            let hit_size = crate::utils::json::estimate_json_bytes(hit);

            if hit_size > self.chunk_size {
                return Some(ResponseChunk::Hits {
                    hits: vec![hit.to_owned()],
                });
            }

            // If adding this hit would exceed target size, break
            if !current_chunk.is_empty() && current_chunk_size + hit_size > self.chunk_size {
                break;
            }

            // Add hit to current chunk - using pop_front() for O(1) complexity
            if let Some(hit) = self.remaining_hits.pop_front() {
                current_chunk.push(hit);
                current_chunk_size += hit_size;
            }
        }

        self.position += 1;

        // Return the hits chunk
        Some(ResponseChunk::Hits {
            hits: current_chunk,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, ToSchema)]
pub struct ResponseTook {
    pub total: usize,
    pub cache_took: usize,
    pub file_list_took: usize,
    pub wait_in_queue: usize,
    pub idx_took: usize,
    pub search_took: usize,
}

impl ResponseTook {
    pub fn add(&mut self, other: &ResponseTook) {
        self.cache_took += other.cache_took;
        self.file_list_took += other.file_list_took;
        self.wait_in_queue += other.wait_in_queue;
        self.idx_took += other.idx_took;
        self.search_took += other.search_took;
    }
}

impl Response {
    pub fn new(from: i64, size: i64) -> Self {
        Response {
            took: 0,
            took_detail: ResponseTook::default(),
            total: 0,
            from,
            size,
            scan_files: 0,
            cached_ratio: 0,
            scan_size: 0,
            idx_scan_size: 0,
            scan_records: 0,
            columns: Vec::new(),
            hits: Vec::new(),
            response_type: "".to_string(),
            trace_id: "".to_string(),
            function_error: Vec::new(),
            is_partial: false,
            histogram_interval: None,
            new_start_time: None,
            new_end_time: None,
            result_cache_ratio: 0,
            work_group: None,
            order_by: None,
            order_by_metadata: Vec::new(),
            converted_histogram_query: None,
            is_histogram_eligible: None,
            query_index: None,
            peak_memory_usage: None,
        }
    }

    pub fn pagination(&mut self, from: i64, size: i64) {
        self.from = from;
        self.size = size;
        if from >= self.total as i64 {
            self.hits = Vec::new();
            self.total = 0;
            return;
        }

        self.hits = self
            .hits
            .iter()
            .skip(from as usize)
            .take(size as usize)
            .cloned()
            .collect();
    }

    pub fn add_hit(&mut self, hit: &json::Value) {
        self.hits.push(hit.to_owned());
        self.total += 1;
    }

    // set the total took time of the search request, it includes everything.
    pub fn set_took(&mut self, val: usize) {
        self.took = val;
        self.took_detail.total = val;
    }

    pub fn set_cache_took(&mut self, val: usize) {
        self.took_detail.cache_took = val;
    }

    pub fn set_wait_in_queue(&mut self, val: usize) {
        self.took_detail.wait_in_queue = val;
    }

    pub fn set_search_took(&mut self, total: usize, file_list: usize, idx: usize) {
        self.took_detail.search_took = total - file_list - idx;
        self.took_detail.file_list_took = file_list;
        self.took_detail.idx_took = idx;
    }

    pub fn set_total(&mut self, val: usize) {
        self.total = val;
    }

    pub fn set_scan_files(&mut self, val: usize) {
        self.scan_files = val;
    }

    pub fn set_cached_ratio(&mut self, val: usize) {
        self.cached_ratio = val;
    }

    pub fn set_scan_size(&mut self, val: usize) {
        self.scan_size = val;
    }

    pub fn set_idx_scan_size(&mut self, val: usize) {
        self.idx_scan_size = val;
    }

    pub fn set_scan_records(&mut self, val: usize) {
        self.scan_records = val;
    }

    pub fn set_trace_id(&mut self, trace_id: String) {
        self.trace_id = trace_id;
    }

    pub fn set_partial(&mut self, is_partial: bool, msg: String) {
        self.is_partial = is_partial;
        if !msg.is_empty() {
            if self.function_error.is_empty() {
                self.function_error = vec![msg];
            } else {
                self.function_error.push(msg);
            }
        }
    }

    pub fn set_histogram_interval(&mut self, val: Option<i64>) {
        self.histogram_interval = val;
    }

    pub fn set_work_group(&mut self, val: Option<String>) {
        self.work_group = val;
    }

    pub fn set_order_by(&mut self, val: Option<OrderBy>) {
        self.order_by = val;
    }

    pub fn set_result_cache_ratio(&mut self, val: usize) {
        self.result_cache_ratio = val;
    }

    pub fn set_order_by_metadata(&mut self, val: Vec<(String, OrderBy)>) {
        self.order_by_metadata = val;
    }

    pub fn set_peak_memory_usage(&mut self, val: f64) {
        self.peak_memory_usage = Some(val);
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct SearchPartitionRequest {
    pub sql: String,
    pub start_time: i64,
    pub end_time: i64,
    #[serde(default)]
    pub encoding: RequestEncoding,
    #[serde(default)]
    pub regions: Vec<String>,
    #[serde(default)]
    pub clusters: Vec<String>,
    #[serde(default)]
    pub query_fn: Option<String>,
    #[serde(default)]
    pub streaming_output: bool,
    #[serde(default)]
    pub histogram_interval: i64,
    #[serde(default)]
    pub sampling_ratio: Option<f64>,
}

impl SearchPartitionRequest {
    #[inline]
    pub fn decode(&mut self) -> Result<(), std::io::Error> {
        match self.encoding {
            RequestEncoding::Base64 => {
                self.sql = match base64::decode_url(&self.sql) {
                    Ok(v) => v,
                    Err(e) => {
                        return Err(e);
                    }
                };
            }
            RequestEncoding::Empty => {}
        }
        self.encoding = RequestEncoding::Empty;
        Ok(())
    }
}

impl From<&Request> for SearchPartitionRequest {
    fn from(req: &Request) -> Self {
        SearchPartitionRequest {
            sql: req.query.sql.clone(),
            start_time: req.query.start_time,
            end_time: req.query.end_time,
            encoding: req.encoding,
            regions: req.regions.clone(),
            clusters: req.clusters.clone(),
            query_fn: req.query.query_fn.clone(),
            streaming_output: req.query.streaming_output,
            histogram_interval: req.query.histogram_interval,
            sampling_ratio: req.query.sampling_ratio,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct SearchPartitionResponse {
    pub trace_id: String,
    pub file_num: usize,
    pub records: usize,
    pub original_size: usize,
    pub compressed_size: usize,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub histogram_interval: Option<i64>, // seconds, for histogram
    pub max_query_range: i64, // hours, for histogram
    pub partitions: Vec<[i64; 2]>,
    pub order_by: OrderBy,
    pub limit: i64,
    pub streaming_output: bool,
    pub streaming_aggs: bool,
    pub streaming_id: Option<String>,
    #[serde(default)]
    pub is_histogram_eligible: bool,
}

/// Request parameters for querying search history
#[derive(Clone, Debug, Default, Deserialize, ToSchema)]
pub struct SearchHistoryRequest {
    /// Organization ID to filter search history by
    pub org_id: Option<String>,
    /// Type of stream to filter by (e.g., logs, metrics, traces)
    pub stream_type: Option<String>,
    /// Name of the specific stream to filter by
    pub stream_name: Option<String>,
    /// start time in micro seconds
    pub start_time: i64,
    /// end time in micro seconds
    pub end_time: i64,
    /// Trace ID to filter search history by
    pub trace_id: Option<String>,
    /// Email of the user to filter search history by
    pub user_email: Option<String>,
    /// Maximum number of search history records to return
    #[serde(default = "default_size")]
    pub size: i64,
}

impl SearchHistoryRequest {
    pub fn validate(&self) -> Result<bool, String> {
        if self.start_time >= self.end_time {
            return Err("start_time must be less than end_time".to_string());
        }
        Ok(true)
    }

    fn build_query(&self, search_stream_name: &str) -> Result<String, String> {
        self.validate()?;

        // Create the query
        let query = search_history_utils::SearchHistoryQueryBuilder::new()
            .with_org_id(&self.org_id)
            .with_stream_type(&self.stream_type)
            .with_stream_name(&self.stream_name)
            .with_trace_id(&self.trace_id)
            .with_user_email(&self.user_email)
            .build(search_stream_name);

        Ok(query)
    }

    pub fn to_query_req(&self, search_stream_name: &str) -> Result<Request, String> {
        let sql = self.build_query(search_stream_name)?;

        let search_req = Request {
            query: Query {
                sql,
                from: 0,
                size: self.size,
                start_time: self.start_time,
                end_time: self.end_time,
                quick_mode: false,
                query_type: "".to_string(),
                track_total_hits: false,
                uses_zo_fn: false,
                query_fn: None,
                action_id: None,
                skip_wal: false,
                sampling_config: None,
                sampling_ratio: None,
                streaming_output: false,
                streaming_id: None,
                histogram_interval: 0,
            },
            encoding: RequestEncoding::Empty,
            regions: Vec::new(),
            clusters: Vec::new(),
            timeout: 0,
            search_type: Some(SearchEventType::Other),
            search_event_context: None,
            use_cache: default_use_cache(),
            clear_cache: false,
            local_mode: None,
        };
        Ok(search_req)
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct SearchHistoryHitResponse {
    pub org_id: String,
    pub stream_type: String,
    pub stream_name: String,
    #[serde(rename = "start_time")]
    pub min_ts: i64,
    #[serde(rename = "end_time")]
    pub max_ts: i64,
    #[serde(rename = "sql")]
    pub request_body: String,
    #[serde(rename = "scan_size")]
    pub size: f64,
    #[serde(rename = "scan_records")]
    pub num_records: i64,
    #[serde(rename = "took")]
    pub response_time: f64,
    pub cached_ratio: i64,
    pub trace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub _timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event: Option<String>,
}

impl TryFrom<json::Value> for SearchHistoryHitResponse {
    type Error = String;

    fn try_from(value: json::Value) -> Result<Self, Self::Error> {
        Ok(SearchHistoryHitResponse {
            org_id: value
                .get("org_id")
                .and_then(json::Value::as_str)
                .ok_or("org_id missing")?
                .to_string(),
            stream_type: value
                .get("stream_type")
                .and_then(json::Value::as_str)
                .ok_or("stream_type missing")?
                .to_string(),
            stream_name: value
                .get("stream_name")
                .and_then(json::Value::as_str)
                .ok_or("stream_name missing")?
                .to_string(),
            min_ts: value
                .get("min_ts")
                .and_then(json::Value::as_i64)
                .ok_or("min_ts missing")?,
            max_ts: value
                .get("max_ts")
                .and_then(json::Value::as_i64)
                .ok_or("max_ts missing")?,
            request_body: value
                .get("request_body")
                .and_then(json::Value::as_str)
                .ok_or("request_body missing")?
                .to_string(),
            size: value
                .get("size")
                .and_then(json::Value::as_f64)
                .ok_or("size missing")?,
            num_records: value
                .get("num_records")
                .and_then(json::Value::as_i64)
                .ok_or("num_records missing")?,
            response_time: value
                .get("response_time")
                .and_then(json::Value::as_f64)
                .ok_or("response_time missing")?,
            cached_ratio: value
                .get("cached_ratio")
                .and_then(json::Value::as_i64)
                .ok_or("cached_ratio missing")?,
            trace_id: value
                .get("trace_id")
                .and_then(json::Value::as_str)
                .ok_or("trace_id missing")?
                .to_string(),
            function: value
                .get("function")
                .and_then(json::Value::as_str)
                .map(|v| v.to_string()),
            _timestamp: value.get("_timestamp").and_then(json::Value::as_i64),
            unit: value
                .get("unit")
                .and_then(json::Value::as_str)
                .map(|v| v.to_string()),
            event: value
                .get("event")
                .and_then(json::Value::as_str)
                .map(|v| v.to_string()),
        })
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct QueryStatusResponse {
    pub status: Vec<QueryStatus>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct QueryStatus {
    pub trace_id: String,
    pub status: String,
    pub created_at: i64,
    pub started_at: i64,
    pub work_group: String,
    pub user_id: Option<String>,
    pub org_id: Option<String>,
    pub stream_type: Option<String>,
    pub query: Option<QueryInfo>,
    pub scan_stats: Option<ScanStats>,
    pub search_type: Option<SearchEventType>,
    pub search_event_context: Option<search::SearchEventContext>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct QueryInfo {
    pub sql: String,
    pub start_time: i64,
    pub end_time: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct CancelQueryResponse {
    pub trace_id: String,
    pub is_success: bool,
}

#[derive(Clone, Debug, Copy, Default, Serialize, Deserialize, ToSchema)]
pub struct ScanStats {
    pub files: i64,
    pub records: i64,
    pub original_size: i64,
    pub compressed_size: i64,
    pub querier_files: i64,
    pub querier_memory_cached_files: i64,
    pub querier_disk_cached_files: i64,
    pub idx_scan_size: i64,
    pub idx_took: i64,
    pub file_list_took: i64,
    pub aggs_cache_ratio: i64,
    pub peak_memory_usage: i64,
}

impl ScanStats {
    pub fn new() -> Self {
        ScanStats::default()
    }

    pub fn add(&mut self, other: &ScanStats) {
        self.files += other.files;
        self.records += other.records;
        self.original_size += other.original_size;
        self.compressed_size += other.compressed_size;
        self.querier_files += other.querier_files;
        self.querier_memory_cached_files += other.querier_memory_cached_files;
        self.querier_disk_cached_files += other.querier_disk_cached_files;
        self.idx_scan_size += other.idx_scan_size;
        self.idx_took = std::cmp::max(self.idx_took, other.idx_took);
        self.file_list_took = std::cmp::max(self.file_list_took, other.file_list_took);
        self.aggs_cache_ratio = if self.aggs_cache_ratio == 0 {
            other.aggs_cache_ratio
        } else if other.aggs_cache_ratio == 0 {
            self.aggs_cache_ratio
        } else {
            std::cmp::min(self.aggs_cache_ratio, other.aggs_cache_ratio)
        };
        self.peak_memory_usage = std::cmp::max(self.peak_memory_usage, other.peak_memory_usage);
    }

    pub fn format_to_mb(&mut self) {
        self.original_size = self.original_size / 1024 / 1024;
        self.compressed_size = self.compressed_size / 1024 / 1024;
        self.idx_scan_size = self.idx_scan_size / 1024 / 1024;
        self.peak_memory_usage = self.peak_memory_usage / 1024 / 1024;
    }
}

impl From<Query> for cluster_rpc::SearchQuery {
    fn from(query: Query) -> Self {
        cluster_rpc::SearchQuery {
            sql: query.sql,
            quick_mode: query.quick_mode,
            query_type: query.query_type,
            from: query.from as i32,
            size: query.size as i32,
            start_time: query.start_time,
            end_time: query.end_time,
            track_total_hits: query.track_total_hits,
            uses_zo_fn: query.uses_zo_fn,
            query_fn: query.query_fn.unwrap_or_default(),
            action_id: query.action_id.unwrap_or_default(),
            skip_wal: query.skip_wal,
            histogram_interval: query.histogram_interval,
            sampling_ratio: query.sampling_ratio,
        }
    }
}

impl From<&ScanStats> for cluster_rpc::ScanStats {
    fn from(req: &ScanStats) -> Self {
        cluster_rpc::ScanStats {
            files: req.files,
            records: req.records,
            original_size: req.original_size,
            compressed_size: req.compressed_size,
            querier_files: req.querier_files,
            querier_memory_cached_files: req.querier_memory_cached_files,
            querier_disk_cached_files: req.querier_disk_cached_files,
            idx_scan_size: req.idx_scan_size,
            idx_took: req.idx_took,
            file_list_took: req.file_list_took,
            aggs_cache_ratio: req.aggs_cache_ratio,
            peak_memory_usage: req.peak_memory_usage,
        }
    }
}

impl From<&cluster_rpc::ScanStats> for ScanStats {
    fn from(req: &cluster_rpc::ScanStats) -> Self {
        ScanStats {
            files: req.files,
            records: req.records,
            original_size: req.original_size,
            compressed_size: req.compressed_size,
            querier_files: req.querier_files,
            querier_memory_cached_files: req.querier_memory_cached_files,
            querier_disk_cached_files: req.querier_disk_cached_files,
            idx_scan_size: req.idx_scan_size,
            idx_took: req.idx_took,
            file_list_took: req.file_list_took,
            aggs_cache_ratio: req.aggs_cache_ratio,
            peak_memory_usage: req.peak_memory_usage,
        }
    }
}

#[derive(Hash, Clone, Copy, Debug, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SearchEventType {
    UI,
    Dashboards,
    Reports,
    Alerts,
    Values,
    Other,
    RUM,
    DerivedStream,
    SearchJob,
    Download,
}

impl<'de> Deserialize<'de> for SearchEventType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct FieldVisitor;

        impl serde::de::Visitor<'_> for FieldVisitor {
            type Value = SearchEventType;

            fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
                formatter.write_str("Invalid SearchEventType")
            }

            fn visit_str<E>(self, value: &str) -> Result<SearchEventType, E>
            where
                E: serde::de::Error,
            {
                SearchEventType::try_from(value).map_err(serde::de::Error::custom)
            }
        }

        deserializer.deserialize_identifier(FieldVisitor)
    }
}

impl std::fmt::Display for SearchEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            Self::UI => write!(f, "ui"),
            Self::Dashboards => write!(f, "dashboards"),
            Self::Reports => write!(f, "reports"),
            Self::Alerts => write!(f, "alerts"),
            Self::Values => write!(f, "_values"),
            Self::Other => write!(f, "other"),
            Self::RUM => write!(f, "rum"),
            Self::DerivedStream => write!(f, "derived_stream"),
            Self::SearchJob => write!(f, "search_job"),
            Self::Download => write!(f, "download"),
        }
    }
}

impl TryFrom<&str> for SearchEventType {
    type Error = String;
    fn try_from(s: &str) -> std::result::Result<Self, Self::Error> {
        match s.to_lowercase().as_str() {
            "ui" => Ok(Self::UI),
            "dashboards" => Ok(Self::Dashboards),
            "reports" => Ok(Self::Reports),
            "alerts" => Ok(Self::Alerts),
            "values" | "_values" => Ok(Self::Values),
            "other" => Ok(Self::Other),
            "rum" => Ok(Self::RUM),
            "derived_stream" | "derivedstream" => Ok(Self::DerivedStream),
            "search_job" | "searchjob" => Ok(Self::SearchJob),
            "download" => Ok(Self::Download),
            _ => Err(format!(
                "invalid SearchEventType `{s}`, expected one of `ui`, `dashboards`, `reports`, `alerts`, `values`, `other`, `rum`, `derived_stream`, `search_job`"
            )),
        }
    }
}

impl SearchEventType {
    /// Background tasks include: Alerts, Reports, and DerivedStream.
    pub fn is_background(&self) -> bool {
        matches!(
            self,
            Self::Alerts | Self::Reports | Self::DerivedStream | Self::SearchJob
        )
    }
}

#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct ValuesEventContext {
    pub field: String,
    pub top_k: Option<i64>,
    pub no_count: bool,
}

#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct SearchEventContext {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub alert_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub alert_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub derived_stream_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "report_id")]
    pub report_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub dashboard_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub dashboard_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "folder_id")]
    pub dashboard_folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "folder_name")]
    pub dashboard_folder_name: Option<String>,
}

impl SearchEventContext {
    pub fn with_alert(alert_key: Option<String>) -> Self {
        Self {
            alert_key,
            ..Default::default()
        }
    }

    pub fn with_derived_stream(derived_stream_key: Option<String>) -> Self {
        Self {
            derived_stream_key,
            ..Default::default()
        }
    }

    pub fn with_report(report_key: Option<String>) -> Self {
        Self {
            report_key,
            ..Default::default()
        }
    }

    pub fn with_dashboard(
        dashboard_id: Option<String>,
        dashboard_name: Option<String>,
        dashboard_folder_id: Option<String>,
        dashboard_folder_name: Option<String>,
    ) -> Self {
        Self {
            dashboard_id,
            dashboard_name,
            dashboard_folder_id,
            dashboard_folder_name,
            ..Default::default()
        }
    }

    pub fn enrich_for_dashboard(
        &mut self,
        dashboard_title: String,
        folder_name: String,
        folder_id: String,
    ) {
        self.dashboard_name = Some(dashboard_title);
        self.dashboard_folder_name = Some(folder_name);
        self.dashboard_folder_id = Some(folder_id);
    }
}

impl From<proto::cluster_rpc::SearchEventContext> for SearchEventContext {
    fn from(proto_sec: proto::cluster_rpc::SearchEventContext) -> Self {
        Self {
            alert_key: proto_sec.alert_key,
            alert_name: proto_sec.alert_name,
            derived_stream_key: proto_sec.derived_stream_key,
            report_key: proto_sec.report_key,
            dashboard_id: proto_sec.dashboard_id,
            dashboard_name: proto_sec.dashboard_name,
            dashboard_folder_id: proto_sec.dashboard_folder_id,
            dashboard_folder_name: proto_sec.dashboard_folder_name,
        }
    }
}

impl From<SearchEventContext> for proto::cluster_rpc::SearchEventContext {
    fn from(sec: SearchEventContext) -> Self {
        Self {
            alert_key: sec.alert_key,
            alert_name: sec.alert_name,
            derived_stream_key: sec.derived_stream_key,
            report_key: sec.report_key,
            dashboard_id: sec.dashboard_id,
            dashboard_name: sec.dashboard_name,
            dashboard_folder_id: sec.dashboard_folder_id,
            dashboard_folder_name: sec.dashboard_folder_name,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct MultiSearchPartitionRequest {
    pub sql: Vec<String>,
    pub start_time: i64,
    pub end_time: i64,
    #[serde(default)]
    pub encoding: RequestEncoding,
    #[serde(default)]
    pub regions: Vec<String>,
    #[serde(default)]
    pub clusters: Vec<String>,
    #[serde(default)]
    pub query_fn: Option<String>,
    #[serde(default)]
    pub streaming_output: bool,
    #[serde(default)]
    pub histogram_interval: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct MultiSearchPartitionResponse {
    pub success: hashbrown::HashMap<String, SearchPartitionResponse>,
    pub error: hashbrown::HashMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct SqlQuery {
    pub sql: String,
    #[serde(default)]
    pub start_time: Option<i64>,
    #[serde(default)]
    pub end_time: Option<i64>,
    #[serde(default)]
    pub query_fn: Option<String>,
    #[serde(default)]
    pub is_old_format: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[schema(as = SearchRequest)]
pub struct MultiStreamRequest {
    #[serde(default, deserialize_with = "deserialize_sql")]
    pub sql: Vec<SqlQuery>, // Use the new struct for SQL queries
    #[serde(default)]
    pub encoding: RequestEncoding,
    #[serde(default)]
    pub timeout: i64,
    #[serde(default)]
    pub from: i64,
    #[serde(default = "default_size")]
    pub size: i64,
    pub start_time: i64,
    pub end_time: i64,
    #[serde(default)]
    pub sort_by: Option<String>,
    #[serde(default)]
    pub quick_mode: bool,
    #[serde(default)]
    pub query_type: String,
    #[serde(default)]
    pub track_total_hits: bool,
    #[serde(default)]
    pub uses_zo_fn: bool,
    #[serde(default)]
    pub query_fn: Option<String>,
    #[serde(default)]
    pub skip_wal: bool,
    #[serde(default)]
    pub regions: Vec<String>, // default query all regions, local: only query local region clusters
    #[serde(default)]
    pub clusters: Vec<String>, // default query all clusters, local: only query local cluster
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_type: Option<SearchEventType>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search_event_context: Option<SearchEventContext>,
    #[serde(default)]
    pub index_type: String, // parquet(default) or fst
    #[serde(default)]
    pub per_query_response: bool,
}

fn deserialize_sql<'de, D>(deserializer: D) -> Result<Vec<SqlQuery>, D::Error>
where
    D: Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum SqlOrSqlQuery {
        OldFormat(String),
        NewFormat(SqlQuery),
    }

    let v: Vec<SqlOrSqlQuery> = Vec::deserialize(deserializer)?;

    // Convert old format into the new format
    let result: Vec<SqlQuery> = v
        .into_iter()
        .map(|item| match item {
            SqlOrSqlQuery::OldFormat(sql) => SqlQuery {
                sql,
                start_time: None,
                end_time: None,
                query_fn: None,
                is_old_format: true,
            },
            SqlOrSqlQuery::NewFormat(query) => query,
        })
        .collect();

    Ok(result)
}

impl MultiStreamRequest {
    pub fn to_query_req(&self) -> Vec<Request> {
        let mut res = vec![];
        for query in &self.sql {
            let query_fn = if query.is_old_format {
                self.query_fn
                    .as_ref()
                    .and_then(|v| base64::decode_url(v).ok())
            } else {
                query
                    .query_fn
                    .as_ref()
                    .and_then(|v| base64::decode_url(v).ok())
            };
            let sql = if let Ok(sql) =
                crate::utils::query_select_utils::replace_o2_custom_patterns(&query.sql)
            {
                sql
            } else {
                query.sql.clone()
            };
            res.push(Request {
                query: Query {
                    sql,
                    from: self.from,
                    size: self.size,
                    start_time: query.start_time.unwrap_or(self.start_time),
                    end_time: query.end_time.unwrap_or(self.end_time),
                    quick_mode: self.quick_mode,
                    query_type: self.query_type.clone(),
                    track_total_hits: self.track_total_hits,
                    uses_zo_fn: self.uses_zo_fn,
                    query_fn,
                    action_id: None,
                    skip_wal: self.skip_wal,
                    sampling_config: None,
                    sampling_ratio: None,
                    streaming_output: false,
                    streaming_id: None,
                    histogram_interval: 0,
                },
                regions: self.regions.clone(),
                clusters: self.clusters.clone(),
                encoding: self.encoding,
                timeout: self.timeout,
                search_type: self.search_type,
                search_event_context: self.search_event_context.clone(),
                use_cache: default_use_cache(),
                clear_cache: false,
                local_mode: None,
            });
        }
        res
    }
}

// for search job pagination
#[derive(Debug, Deserialize)]
pub struct PaginationQuery {
    pub from: Option<i64>,
    pub size: Option<i64>,
}

#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct ValuesRequest {
    pub fields: Vec<String>,
    #[serde(default)]
    pub from: Option<i64>,
    #[serde(default)]
    pub size: Option<i64>,
    pub no_count: bool,
    #[serde(default)]
    pub regions: Vec<String>,
    #[serde(default)]
    pub clusters: Vec<String>,
    #[serde(default)]
    pub vrl_fn: Option<String>,
    #[serde(default)]
    pub start_time: Option<i64>,
    #[serde(default)]
    pub end_time: Option<i64>,
    #[serde(default)]
    pub filter: Option<String>,
    #[serde(default)]
    pub timeout: Option<i64>,
    #[serde(default)]
    pub use_cache: bool,
    #[serde(default)]
    pub clear_cache: bool,
    pub stream_name: String,
    pub stream_type: StreamType,
    pub sql: String,
}

#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct HashFileRequest {
    pub files: Vec<String>,
}

#[derive(Debug, Default, Deserialize, Clone, Serialize)]
pub struct HashFileResponse {
    pub files: HashMap<String, HashMap<String, String>>,
}

#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct ResultSchemaResponse {
    pub projections: Vec<String>,
    pub group_by: Vec<String>,
    pub timeseries_field: Option<String>,
}

const AGGREGATION_CACHE_INTERVALS: [(Option<Duration>, Interval); 6] = [
    (Duration::try_days(31), Interval::OneDay),
    (Duration::try_days(8), Interval::SixHours),
    (Duration::try_hours(23), Interval::TwoHours),
    (Duration::try_hours(6), Interval::OneHour),
    (Duration::try_hours(1), Interval::ThirtyMinutes),
    (Duration::try_minutes(15), Interval::FiveMinutes),
];

#[derive(Debug, Clone, Copy, PartialEq, PartialOrd)]
pub enum Interval {
    Zero = 0,
    FiveMinutes = 5,
    TenMinutes = 10,
    ThirtyMinutes = 30,
    OneHour = 60,
    TwoHours = 120,
    SixHours = 360,
    TwelveHours = 720,
    OneDay = 1440,
}

impl Interval {
    pub fn get_duration_minutes(&self) -> i64 {
        *self as i64
    }

    pub fn get_interval_seconds(&self) -> i64 {
        self.get_duration_minutes() * 60
    }

    pub fn get_interval_microseconds(&self) -> i64 {
        self.get_duration_minutes() * 60 * 1_000_000
    }
}

impl std::fmt::Display for Interval {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?} minutes", self.get_duration_minutes())
    }
}

impl From<i64> for Interval {
    fn from(minutes: i64) -> Self {
        match minutes {
            0 => Interval::Zero,
            5 => Interval::FiveMinutes,
            10 => Interval::TenMinutes,
            30 => Interval::ThirtyMinutes,
            60 => Interval::OneHour,
            120 => Interval::TwoHours,
            360 => Interval::SixHours,
            720 => Interval::TwelveHours,
            1440 => Interval::OneDay,
            _ => {
                log::warn!("Unknown cache interval: {minutes} minutes, defaulting to Zero");
                Interval::Zero
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CardinalityLevel {
    Low,
    Medium,
    High,
    Huge,
}

impl From<f64> for CardinalityLevel {
    fn from(value: f64) -> Self {
        if value < 10000.0 {
            CardinalityLevel::Low
        } else if value < 1000000.0 {
            CardinalityLevel::Medium
        } else if value < 5000000.0 {
            CardinalityLevel::High
        } else {
            CardinalityLevel::Huge
        }
    }
}

pub fn generate_aggregation_search_interval(
    start_time: i64,
    end_time: i64,
    cardinality_level: CardinalityLevel,
) -> Interval {
    let timers = AGGREGATION_CACHE_INTERVALS.iter();
    let timers = match cardinality_level {
        #[allow(clippy::iter_skip_zero)]
        CardinalityLevel::Low => timers.skip(0),
        CardinalityLevel::Medium => timers.skip(1),
        CardinalityLevel::High => timers.skip(2),
        CardinalityLevel::Huge => return Interval::Zero,
    };

    for (time, value) in timers {
        let time = time.unwrap().num_microseconds().unwrap();
        if (end_time - start_time) >= time {
            return *value;
        }
    }
    Interval::FiveMinutes
}

mod search_history_utils {
    pub struct SearchHistoryQueryBuilder {
        pub org_id: Option<String>,
        pub stream_type: Option<String>,
        pub stream_name: Option<String>,
        pub user_email: Option<String>,
        pub trace_id: Option<String>,
    }

    impl SearchHistoryQueryBuilder {
        pub fn new() -> Self {
            Self {
                org_id: None,
                stream_type: None,
                stream_name: None,
                user_email: None,
                trace_id: None,
            }
        }

        pub fn with_org_id(mut self, org_id: &Option<String>) -> Self {
            self.org_id = org_id.to_owned();
            self
        }

        pub fn with_stream_type(mut self, stream_type: &Option<String>) -> Self {
            self.stream_type = stream_type.to_owned();
            self
        }

        pub fn with_stream_name(mut self, stream_name: &Option<String>) -> Self {
            self.stream_name = stream_name.to_owned();
            self
        }

        pub fn with_trace_id(mut self, trace_id: &Option<String>) -> Self {
            self.trace_id = trace_id.to_owned();
            self
        }

        pub fn with_user_email(mut self, email: &Option<String>) -> Self {
            self.user_email = email.to_owned();
            self
        }

        // Method to build the SQL query
        pub fn build(self, search_stream_name: &str) -> String {
            let mut query = format!("SELECT * FROM {search_stream_name} WHERE event='Search'");

            if let Some(org_id) = self.org_id.filter(|s| !s.is_empty()) {
                query.push_str(&format!(" AND org_id = '{org_id}'"));
            }
            if let Some(stream_type) = self.stream_type.filter(|s| !s.is_empty()) {
                query.push_str(&format!(" AND stream_type = '{stream_type}'"));
            }
            if let Some(stream_name) = self.stream_name.filter(|s| !s.is_empty()) {
                query.push_str(&format!(" AND stream_name = '{stream_name}'"));
            }
            if let Some(user_email) = self.user_email.filter(|s| !s.is_empty()) {
                query.push_str(&format!(" AND user_email = '{user_email}'"));
            }
            if let Some(trace_id) = self.trace_id.filter(|s| !s.is_empty()) {
                query.push_str(&format!(" AND trace_id = '{trace_id}'"));
            }

            query
        }
    }

    #[cfg(test)]
    mod tests {
        use super::SearchHistoryQueryBuilder;
        const SEARCH_STREAM_NAME: &str = "usage";

        #[test]
        fn test_empty_query() {
            let query = SearchHistoryQueryBuilder::new().build(SEARCH_STREAM_NAME);
            assert_eq!(query, "SELECT * FROM usage WHERE event='Search'");
        }

        #[test]
        fn test_with_org_id() {
            let query = SearchHistoryQueryBuilder::new()
                .with_org_id(&Some("org123".to_string()))
                .build(SEARCH_STREAM_NAME);
            assert_eq!(
                query,
                "SELECT * FROM usage WHERE event='Search' AND org_id = 'org123'"
            );
        }

        #[test]
        fn test_with_stream_type() {
            let query = SearchHistoryQueryBuilder::new()
                .with_stream_type(&Some("logs".to_string()))
                .build(SEARCH_STREAM_NAME);
            assert_eq!(
                query,
                "SELECT * FROM usage WHERE event='Search' AND stream_type = 'logs'"
            );
        }

        #[test]
        fn test_with_stream_name() {
            let query = SearchHistoryQueryBuilder::new()
                .with_stream_name(&Some("streamA".to_string()))
                .build(SEARCH_STREAM_NAME);
            assert_eq!(
                query,
                "SELECT * FROM usage WHERE event='Search' AND stream_name = 'streamA'"
            );
        }

        #[test]
        fn test_with_user_email() {
            let query = SearchHistoryQueryBuilder::new()
                .with_user_email(&Some("user123@gmail.com".to_string()))
                .build(SEARCH_STREAM_NAME);
            assert_eq!(
                query,
                "SELECT * FROM usage WHERE event='Search' AND user_email = 'user123@gmail.com'"
            );
        }

        #[test]
        fn test_with_trace_id() {
            let query = SearchHistoryQueryBuilder::new()
                .with_trace_id(&Some("trace123".to_string()))
                .build(SEARCH_STREAM_NAME);
            assert_eq!(
                query,
                "SELECT * FROM usage WHERE event='Search' AND trace_id = 'trace123'"
            );
        }

        #[test]
        fn test_combined_query() {
            let query = SearchHistoryQueryBuilder::new()
                .with_org_id(&Some("org123".to_string()))
                .with_stream_type(&Some("logs".to_string()))
                .with_stream_name(&Some("streamA".to_string()))
                .with_user_email(&Some("user123@gmail.com".to_string()))
                .with_trace_id(&Some("trace123".to_string()))
                .build(SEARCH_STREAM_NAME);

            let expected_query = "SELECT * FROM usage WHERE event='Search' \
            AND org_id = 'org123' \
            AND stream_type = 'logs' \
            AND stream_name = 'streamA' \
            AND user_email = 'user123@gmail.com' \
            AND trace_id = 'trace123'";

            assert_eq!(query, expected_query);
        }

        #[test]
        fn test_partial_query() {
            let query = SearchHistoryQueryBuilder::new()
                .with_org_id(&Some("org123".to_string()))
                .with_user_email(&Some("user123@gmail.com".to_string()))
                .build(SEARCH_STREAM_NAME);

            let expected_query = "SELECT * FROM usage WHERE event='Search' \
            AND org_id = 'org123' \
            AND user_email = 'user123@gmail.com'";

            assert_eq!(query, expected_query);
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum StreamResponses {
    // Original variant - to be deprecated but kept for backward compatibility
    SearchResponse {
        results: Response,
        streaming_aggs: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        streaming_id: Option<String>,
        time_offset: TimeOffset,
    },
    // New focused variants
    SearchResponseMetadata {
        results: Response,
        streaming_aggs: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        streaming_id: Option<String>,
        time_offset: TimeOffset,
    },
    SearchResponseHits {
        hits: Vec<json::Value>,
    },
    PromqlResponse {
        data: super::promql::QueryResult,
        #[serde(skip_serializing_if = "Option::is_none")]
        trace_id: Option<String>,
    },
    PromqlMetadata {
        step: i64,
        #[serde(skip_serializing_if = "Option::is_none")]
        trace_id: Option<String>,
    },
    Progress {
        percent: usize,
    },
    Error {
        code: u16,
        message: String,
        error_detail: Option<String>,
    },
    PatternExtractionResult {
        patterns: json::Value,
    },
    Done,
    Cancelled,
}

/// An iterator that yields formatted chunks from a StreamResponse
pub struct StreamResponseChunks {
    /// The inner iterator for search responses with multiple chunks
    chunks_iter: Option<Box<dyn Iterator<Item = Result<BytesImpl, std::io::Error>> + Send>>,
    /// Single chunk for simple responses
    single_chunk: Option<Result<BytesImpl, std::io::Error>>,
}

impl Iterator for StreamResponseChunks {
    type Item = Result<BytesImpl, std::io::Error>;

    fn next(&mut self) -> Option<Self::Item> {
        if let Some(iter) = &mut self.chunks_iter {
            iter.next()
        } else {
            self.single_chunk.take()
        }
    }
}

impl StreamResponses {
    /// Convert a response to an iterator of formatted chunks
    /// For SearchResponse, this will apply the ResponseChunkIterator to break it into multiple
    /// chunks For other response types, this will return an iterator with a single chunk
    pub fn to_chunks(&self) -> StreamResponseChunks {
        // Helper function to format event data
        let format_event = |event_type: &str, data: &str| -> BytesImpl {
            let formatted = format!("event: {event_type}\ndata: {data}\n\n");
            BytesImpl::from(formatted.into_bytes())
        };

        match self {
            // Handle search responses with chunking
            StreamResponses::SearchResponse {
                results,
                streaming_aggs,
                time_offset,
                streaming_id,
            } => {
                log::info!(
                    "[HTTP2_STREAM] Chunking search response with {} hits using ResponseChunkIterator",
                    results.hits.len()
                );

                // Create the iterator
                let iterator = ResponseChunkIterator::new(
                    results.clone(),
                    None, // Use configured chunk size from environment
                );

                // Add a log message to show the chunk size being used
                log::info!(
                    "[HTTP2_STREAM] Using chunk size of {}MB from configuration",
                    get_config().http_streaming.streaming_response_chunk_size
                );

                // Capture needed values for the closure
                let streaming_aggs = *streaming_aggs;
                let time_offset = time_offset.clone();
                let streaming_id = streaming_id.clone();

                if results.hits.is_empty() {
                    // Send metadata first
                    let metadata = StreamResponses::SearchResponseMetadata {
                        results: results.clone(),
                        streaming_aggs,
                        time_offset: time_offset.clone(),
                        streaming_id: streaming_id.clone(),
                    };
                    let metadata_data = serde_json::to_string(&metadata).unwrap_or_else(|_| {
                        log::error!("Failed to serialize metadata: {metadata:?}");
                        String::new()
                    });
                    let metadata_bytes = format_event("search_response_metadata", &metadata_data);

                    // Send empty hits
                    let hits = StreamResponses::SearchResponseHits {
                        hits: results.hits.clone(),
                    };
                    let hits_data = serde_json::to_string(&hits).unwrap_or_else(|_| {
                        log::error!("Failed to serialize hits: {hits:?}");
                        String::new()
                    });
                    let hits_bytes = format_event("search_response_hits", &hits_data);

                    // Return both chunks in sequence
                    let chunks_iter =
                        std::iter::once(Ok(metadata_bytes)).chain(std::iter::once(Ok(hits_bytes)));

                    return StreamResponseChunks {
                        chunks_iter: Some(Box::new(chunks_iter)),
                        single_chunk: None,
                    };
                }

                // Create an iterator that maps each chunk to a formatted BytesImpl
                let chunks_iter = iterator.map(move |chunk| {
                    let (event_type, data) = match chunk {
                        ResponseChunk::Metadata { response } => {
                            // Add streaming_aggs and time_offset from the original response
                            let metadata = StreamResponses::SearchResponseMetadata {
                                results: *response,
                                streaming_aggs,
                                streaming_id: streaming_id.clone(),
                                time_offset: time_offset.clone(),
                            };
                            let data = serde_json::to_string(&metadata).unwrap_or_else(|_| {
                                log::error!("Failed to serialize metadata: {metadata:?}");
                                String::new()
                            });
                            ("search_response_metadata", data)
                        }
                        ResponseChunk::Hits { hits } => {
                            let data =
                                serde_json::to_string(&StreamResponses::SearchResponseHits {
                                    hits,
                                })
                                .unwrap_or_else(|e| {
                                    log::error!("Failed to serialize hits: {e}");
                                    String::new()
                                });
                            ("search_response_hits", data)
                        }
                    };

                    // Format and encode the chunk
                    Ok(format_event(event_type, &data))
                });

                StreamResponseChunks {
                    chunks_iter: Some(Box::new(chunks_iter)),
                    single_chunk: None,
                }
            }

            // Handle other response types with a single chunk
            StreamResponses::SearchResponseMetadata { .. } => {
                let data = serde_json::to_string(self).unwrap_or_default();
                let bytes = format_event("search_response_metadata", &data);
                StreamResponseChunks {
                    chunks_iter: None,
                    single_chunk: Some(Ok(bytes)),
                }
            }
            StreamResponses::SearchResponseHits { .. } => {
                let data = serde_json::to_string(self).unwrap_or_default();
                let bytes = format_event("search_response_hits", &data);
                StreamResponseChunks {
                    chunks_iter: None,
                    single_chunk: Some(Ok(bytes)),
                }
            }
            StreamResponses::PromqlResponse { .. } => {
                let data = serde_json::to_string(self).unwrap_or_default();
                let bytes = format_event("promql_response", &data);
                StreamResponseChunks {
                    chunks_iter: None,
                    single_chunk: Some(Ok(bytes)),
                }
            }
            StreamResponses::PromqlMetadata { .. } => {
                let data = serde_json::to_string(self).unwrap_or_default();
                let bytes = format_event("promql_metadata", &data);
                StreamResponseChunks {
                    chunks_iter: None,
                    single_chunk: Some(Ok(bytes)),
                }
            }
            StreamResponses::Progress { .. } => {
                let data = serde_json::to_string(self).unwrap_or_default();
                let bytes = format_event("progress", &data);
                StreamResponseChunks {
                    chunks_iter: None,
                    single_chunk: Some(Ok(bytes)),
                }
            }
            StreamResponses::Error { .. } => {
                let data = serde_json::to_string(self).unwrap_or_default();
                let bytes = format_event("error", &data);
                StreamResponseChunks {
                    chunks_iter: None,
                    single_chunk: Some(Ok(bytes)),
                }
            }
            StreamResponses::PatternExtractionResult { patterns } => {
                let data = serde_json::to_string(patterns).unwrap_or_else(|_| {
                    log::error!("Failed to serialize pattern extraction result: {patterns:?}");
                    String::new()
                });
                let bytes = format_event("pattern_extraction_result", &data);
                StreamResponseChunks {
                    chunks_iter: None,
                    single_chunk: Some(Ok(bytes)),
                }
            }
            StreamResponses::Done => {
                let bytes = BytesImpl::from("data: [[DONE]]\n\n");
                StreamResponseChunks {
                    chunks_iter: None,
                    single_chunk: Some(Ok(bytes)),
                }
            }
            StreamResponses::Cancelled => {
                let bytes = BytesImpl::from("data: [[CANCELLED]]\n\n");
                StreamResponseChunks {
                    chunks_iter: None,
                    single_chunk: Some(Ok(bytes)),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_response() {
        let mut res = Response::default();
        res.set_total(10);
        res.set_scan_files(5);
        let hit = json::json!({"num":12});
        let mut val_map = json::Map::new();
        val_map.insert("id".to_string(), json::json!({"id":1}));
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
                    "track_total_hits": false
                },
                "encoding": "base64"
            }
        );
        let mut req: Request = json::from_value(req).unwrap();
        req.decode().unwrap();
        assert_eq!(req.query.sql, "select * from test");
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
                    "track_total_hits": false
                },
                "encoding": ""
            }
        );
        let mut req: Request = json::from_value(req).unwrap();
        req.decode().unwrap();
        assert_eq!(req.query.sql, "select * from test");
    }

    #[test]
    fn test_request_encoding_from_str() {
        assert_eq!(RequestEncoding::from("base64"), RequestEncoding::Base64);
        assert_eq!(RequestEncoding::from("BASE64"), RequestEncoding::Base64);
        assert_eq!(RequestEncoding::from(""), RequestEncoding::Empty);
        assert_eq!(RequestEncoding::from("unknown"), RequestEncoding::Empty);
    }

    #[test]
    fn test_request_encoding_display() {
        assert_eq!(RequestEncoding::Base64.to_string(), "base64");
        assert_eq!(RequestEncoding::Empty.to_string(), "");
    }

    #[test]
    fn test_query_default() {
        let query = Query::default();
        assert_eq!(query.sql, "");
        assert_eq!(query.from, 0);
        assert_eq!(query.size, 10);
        assert_eq!(query.start_time, 0);
        assert_eq!(query.end_time, 0);
        assert!(!query.quick_mode);
        assert_eq!(query.query_type, "");
        assert!(!query.track_total_hits);
        assert!(!query.uses_zo_fn);
        assert!(query.query_fn.is_none());
        assert!(query.action_id.is_none());
        assert!(!query.skip_wal);
        assert!(!query.streaming_output);
        assert!(query.streaming_id.is_none());
        assert_eq!(query.histogram_interval, 0);
    }

    #[test]
    fn test_response_new() {
        let response = Response::new(5, 20);
        assert_eq!(response.from, 5);
        assert_eq!(response.size, 20);
        assert_eq!(response.total, 0);
        assert_eq!(response.took, 0);
        assert!(response.hits.is_empty());
        assert!(response.columns.is_empty());
    }

    #[test]
    fn test_response_pagination() {
        let mut response = Response::new(0, 10);
        response.hits = vec![
            json::json!({"id": 1}),
            json::json!({"id": 2}),
            json::json!({"id": 3}),
            json::json!({"id": 4}),
            json::json!({"id": 5}),
        ];
        response.total = 5;

        // Test normal pagination
        response.pagination(1, 2);
        assert_eq!(response.from, 1);
        assert_eq!(response.size, 2);
        assert_eq!(response.hits.len(), 2);
        assert_eq!(response.hits[0]["id"], 2);
        assert_eq!(response.hits[1]["id"], 3);

        // Test pagination beyond total
        response.pagination(10, 5);
        assert_eq!(response.from, 10);
        assert_eq!(response.size, 5);
        assert!(response.hits.is_empty());
        assert_eq!(response.total, 0);
    }

    #[test]
    fn test_response_setters() {
        let mut response = Response::new(0, 10);

        response.set_took(100);
        assert_eq!(response.took, 100);
        assert_eq!(response.took_detail.total, 100);

        response.set_cache_took(20);
        assert_eq!(response.took_detail.cache_took, 20);

        response.set_wait_in_queue(30);
        assert_eq!(response.took_detail.wait_in_queue, 30);

        response.set_search_took(100, 10, 5);
        assert_eq!(response.took_detail.search_took, 85);
        assert_eq!(response.took_detail.file_list_took, 10);
        assert_eq!(response.took_detail.idx_took, 5);

        response.set_total(50);
        assert_eq!(response.total, 50);

        response.set_scan_files(25);
        assert_eq!(response.scan_files, 25);

        response.set_cached_ratio(75);
        assert_eq!(response.cached_ratio, 75);

        response.set_scan_size(1024);
        assert_eq!(response.scan_size, 1024);

        response.set_idx_scan_size(512);
        assert_eq!(response.idx_scan_size, 512);

        response.set_scan_records(1000);
        assert_eq!(response.scan_records, 1000);

        response.set_trace_id("trace123".to_string());
        assert_eq!(response.trace_id, "trace123");

        response.set_partial(true, "Partial data warning".to_string());
        assert!(response.is_partial);
        assert_eq!(response.function_error.len(), 1);
        assert_eq!(response.function_error[0], "Partial data warning");

        response.set_partial(false, "Another warning".to_string());
        assert!(!response.is_partial);
        assert_eq!(response.function_error.len(), 2);

        response.set_histogram_interval(Some(3600));
        assert_eq!(response.histogram_interval, Some(3600));

        response.set_work_group(Some("workgroup1".to_string()));
        assert_eq!(response.work_group, Some("workgroup1".to_string()));

        response.set_order_by(Some(OrderBy::Asc));
        assert_eq!(response.order_by, Some(OrderBy::Asc));

        response.set_result_cache_ratio(90);
        assert_eq!(response.result_cache_ratio, 90);
    }

    #[test]
    fn test_response_took_add() {
        let mut took1 = ResponseTook {
            total: 100,
            cache_took: 10,
            file_list_took: 20,
            wait_in_queue: 5,
            idx_took: 15,
            search_took: 50,
        };

        let took2 = ResponseTook {
            total: 200,
            cache_took: 15,
            file_list_took: 25,
            wait_in_queue: 10,
            idx_took: 20,
            search_took: 130,
        };

        took1.add(&took2);
        assert_eq!(took1.cache_took, 25);
        assert_eq!(took1.file_list_took, 45);
        assert_eq!(took1.wait_in_queue, 15);
        assert_eq!(took1.idx_took, 35);
        assert_eq!(took1.search_took, 180);
    }

    #[test]
    fn test_search_partition_request_decode() {
        let mut req = SearchPartitionRequest {
            sql: "c2VsZWN0ICogZnJvbSB0ZXN0".to_string(),
            start_time: 0,
            end_time: 1000,
            encoding: RequestEncoding::Base64,
            regions: vec!["region1".to_string()],
            clusters: vec!["cluster1".to_string()],
            query_fn: Some("fn1".to_string()),
            streaming_output: false,
            histogram_interval: 0,
            sampling_ratio: None,
        };

        req.decode().unwrap();
        assert_eq!(req.sql, "select * from test");
        assert_eq!(req.encoding, RequestEncoding::Empty);
    }

    #[test]
    fn test_search_partition_request_from_request() {
        let request = Request {
            query: Query {
                sql: "SELECT * FROM test".to_string(),
                start_time: 100,
                end_time: 200,
                query_fn: Some("test_fn".to_string()),
                streaming_output: true,
                histogram_interval: 3600,
                ..Default::default()
            },
            encoding: RequestEncoding::Base64,
            regions: vec!["region1".to_string()],
            clusters: vec!["cluster1".to_string()],
            ..Default::default()
        };

        let partition_req: SearchPartitionRequest = (&request).into();
        assert_eq!(partition_req.sql, "SELECT * FROM test");
        assert_eq!(partition_req.start_time, 100);
        assert_eq!(partition_req.end_time, 200);
        assert_eq!(partition_req.encoding, RequestEncoding::Base64);
        assert_eq!(partition_req.regions, vec!["region1".to_string()]);
        assert_eq!(partition_req.clusters, vec!["cluster1".to_string()]);
        assert_eq!(partition_req.query_fn, Some("test_fn".to_string()));
        assert!(partition_req.streaming_output);
        assert_eq!(partition_req.histogram_interval, 3600);
    }

    #[test]
    fn test_search_history_request_validate() {
        let valid_req = SearchHistoryRequest {
            start_time: 100,
            end_time: 200,
            ..Default::default()
        };
        assert!(valid_req.validate().unwrap());

        let invalid_req = SearchHistoryRequest {
            start_time: 200,
            end_time: 100,
            ..Default::default()
        };
        assert!(invalid_req.validate().is_err());
    }

    #[test]
    fn test_search_history_request_to_query_req() {
        let req = SearchHistoryRequest {
            org_id: Some("org1".to_string()),
            stream_type: Some("logs".to_string()),
            start_time: 100,
            end_time: 200,
            size: 50,
            ..Default::default()
        };

        let query_req = req.to_query_req("usage").unwrap();
        assert_eq!(query_req.query.start_time, 100);
        assert_eq!(query_req.query.end_time, 200);
        assert_eq!(query_req.query.size, 50);
        assert!(query_req.query.sql.contains("org_id = 'org1'"));
        assert!(query_req.query.sql.contains("stream_type = 'logs'"));
    }

    #[test]
    fn test_search_history_hit_response_try_from() {
        let json_value = json::json!({
            "org_id": "org1",
            "stream_type": "logs",
            "stream_name": "test_stream",
            "min_ts": 100,
            "max_ts": 200,
            "request_body": "SELECT * FROM test",
            "size": 1024.5,
            "num_records": 1000,
            "response_time": 50.0,
            "cached_ratio": 75,
            "trace_id": "trace123",
            "function": "test_fn",
            "_timestamp": 150,
            "unit": "bytes",
            "event": "search"
        });

        let response: SearchHistoryHitResponse = json_value.try_into().unwrap();
        assert_eq!(response.org_id, "org1");
        assert_eq!(response.stream_type, "logs");
        assert_eq!(response.stream_name, "test_stream");
        assert_eq!(response.min_ts, 100);
        assert_eq!(response.max_ts, 200);
        assert_eq!(response.request_body, "SELECT * FROM test");
        assert_eq!(response.size, 1024.5);
        assert_eq!(response.num_records, 1000);
        assert_eq!(response.response_time, 50.0);
        assert_eq!(response.cached_ratio, 75);
        assert_eq!(response.trace_id, "trace123");
        assert_eq!(response.function, Some("test_fn".to_string()));
        assert_eq!(response._timestamp, Some(150));
        assert_eq!(response.unit, Some("bytes".to_string()));
        assert_eq!(response.event, Some("search".to_string()));
    }

    #[test]
    fn test_scan_stats_new() {
        let stats = ScanStats::new();
        assert_eq!(stats.files, 0);
        assert_eq!(stats.records, 0);
        assert_eq!(stats.original_size, 0);
        assert_eq!(stats.compressed_size, 0);
    }

    #[test]
    fn test_scan_stats_add() {
        let mut stats1 = ScanStats {
            files: 10,
            records: 100,
            original_size: 1024,
            compressed_size: 512,
            querier_files: 5,
            querier_memory_cached_files: 3,
            querier_disk_cached_files: 2,
            idx_scan_size: 256,
            idx_took: 50,
            file_list_took: 30,
            aggs_cache_ratio: 80,
            peak_memory_usage: 1024000,
        };

        let stats2 = ScanStats {
            files: 20,
            records: 200,
            original_size: 2048,
            compressed_size: 1024,
            querier_files: 10,
            querier_memory_cached_files: 6,
            querier_disk_cached_files: 4,
            idx_scan_size: 512,
            idx_took: 60,
            file_list_took: 40,
            aggs_cache_ratio: 90,
            peak_memory_usage: 2048000,
        };

        stats1.add(&stats2);
        assert_eq!(stats1.files, 30);
        assert_eq!(stats1.records, 300);
        assert_eq!(stats1.original_size, 3072);
        assert_eq!(stats1.compressed_size, 1536);
        assert_eq!(stats1.querier_files, 15);
        assert_eq!(stats1.querier_memory_cached_files, 9);
        assert_eq!(stats1.querier_disk_cached_files, 6);
        assert_eq!(stats1.idx_scan_size, 768);
        assert_eq!(stats1.idx_took, 60); // max
        assert_eq!(stats1.file_list_took, 40); // max
        assert_eq!(stats1.aggs_cache_ratio, 80); // min
        assert_eq!(stats1.peak_memory_usage, 2048000); // max
    }

    #[test]
    fn test_scan_stats_format_to_mb() {
        let mut stats = ScanStats {
            original_size: 1048576,  // 1MB in bytes
            compressed_size: 524288, // 0.5MB in bytes
            idx_scan_size: 2097152,  // 2MB in bytes
            ..Default::default()
        };

        stats.format_to_mb();
        assert_eq!(stats.original_size, 1);
        assert_eq!(stats.compressed_size, 0);
        assert_eq!(stats.idx_scan_size, 2);
    }

    #[test]
    fn test_search_event_type_try_from() {
        type SET = SearchEventType; // Saving line too long
        assert_eq!(SET::try_from("ui").unwrap(), SET::UI);
        assert_eq!(SET::try_from("dashboards").unwrap(), SET::Dashboards);
        assert_eq!(SET::try_from("reports").unwrap(), SET::Reports);
        assert_eq!(SET::try_from("alerts").unwrap(), SET::Alerts);
        assert_eq!(SET::try_from("values").unwrap(), SET::Values);
        assert_eq!(SET::try_from("_values").unwrap(), SET::Values);
        assert_eq!(SET::try_from("other").unwrap(), SET::Other);
        assert_eq!(SET::try_from("rum").unwrap(), SET::RUM);
        assert_eq!(SET::try_from("derived_stream").unwrap(), SET::DerivedStream);
        assert_eq!(SET::try_from("derivedstream").unwrap(), SET::DerivedStream);
        assert_eq!(SET::try_from("search_job").unwrap(), SET::SearchJob);
        assert_eq!(SET::try_from("searchjob").unwrap(), SET::SearchJob);
        assert!(SearchEventType::try_from("invalid").is_err());
    }

    #[test]
    fn test_search_event_type_display() {
        assert_eq!(SearchEventType::UI.to_string(), "ui");
        assert_eq!(SearchEventType::Dashboards.to_string(), "dashboards");
        assert_eq!(SearchEventType::Reports.to_string(), "reports");
        assert_eq!(SearchEventType::Alerts.to_string(), "alerts");
        assert_eq!(SearchEventType::Values.to_string(), "_values");
        assert_eq!(SearchEventType::Other.to_string(), "other");
        assert_eq!(SearchEventType::RUM.to_string(), "rum");
        assert_eq!(SearchEventType::DerivedStream.to_string(), "derived_stream");
        assert_eq!(SearchEventType::SearchJob.to_string(), "search_job");
    }

    #[test]
    fn test_search_event_type_is_background() {
        // Background tasks
        assert!(SearchEventType::Alerts.is_background());
        assert!(SearchEventType::Reports.is_background());
        assert!(SearchEventType::DerivedStream.is_background());
        assert!(SearchEventType::SearchJob.is_background());

        // Non-background tasks
        assert!(!SearchEventType::UI.is_background());
        assert!(!SearchEventType::Dashboards.is_background());
        assert!(!SearchEventType::Values.is_background());
        assert!(!SearchEventType::Other.is_background());
        assert!(!SearchEventType::RUM.is_background());
        assert!(!SearchEventType::Download.is_background());
    }

    #[test]
    fn test_search_event_context_builder_methods() {
        let alert_ctx = SearchEventContext::with_alert(Some("alert123".to_string()));
        assert_eq!(alert_ctx.alert_key, Some("alert123".to_string()));

        let derived_ctx = SearchEventContext::with_derived_stream(Some("stream123".to_string()));
        assert_eq!(
            derived_ctx.derived_stream_key,
            Some("stream123".to_string())
        );

        let report_ctx = SearchEventContext::with_report(Some("report123".to_string()));
        assert_eq!(report_ctx.report_key, Some("report123".to_string()));

        let dashboard_ctx = SearchEventContext::with_dashboard(
            Some("dashboard123".to_string()),
            Some("Dashboard Name".to_string()),
            Some("folder123".to_string()),
            Some("Folder Name".to_string()),
        );
        assert_eq!(dashboard_ctx.dashboard_id, Some("dashboard123".to_string()));
        assert_eq!(
            dashboard_ctx.dashboard_name,
            Some("Dashboard Name".to_string())
        );
        assert_eq!(
            dashboard_ctx.dashboard_folder_id,
            Some("folder123".to_string())
        );
        assert_eq!(
            dashboard_ctx.dashboard_folder_name,
            Some("Folder Name".to_string())
        );
    }

    #[test]
    fn test_search_event_context_enrich_for_dashboard() {
        let mut ctx = SearchEventContext::default();
        ctx.enrich_for_dashboard(
            "New Dashboard".to_string(),
            "New Folder".to_string(),
            "new_folder_id".to_string(),
        );
        assert_eq!(ctx.dashboard_name, Some("New Dashboard".to_string()));
        assert_eq!(ctx.dashboard_folder_name, Some("New Folder".to_string()));
        assert_eq!(ctx.dashboard_folder_id, Some("new_folder_id".to_string()));
    }

    #[test]
    fn test_query_to_cluster_rpc() {
        let query = Query {
            sql: "SELECT * FROM test".to_string(),
            quick_mode: true,
            query_type: "test".to_string(),
            from: 10,
            size: 20,
            start_time: 100,
            end_time: 200,
            track_total_hits: true,
            uses_zo_fn: true,
            query_fn: Some("test_fn".to_string()),
            action_id: Some("action123".to_string()),
            skip_wal: true,
            histogram_interval: 3600,
            ..Default::default()
        };

        let cluster_query: cluster_rpc::SearchQuery = query.into();
        assert_eq!(cluster_query.sql, "SELECT * FROM test");
        assert!(cluster_query.quick_mode);
        assert_eq!(cluster_query.query_type, "test");
        assert_eq!(cluster_query.from, 10);
        assert_eq!(cluster_query.size, 20);
        assert_eq!(cluster_query.start_time, 100);
        assert_eq!(cluster_query.end_time, 200);
        assert!(cluster_query.track_total_hits);
        assert!(cluster_query.uses_zo_fn);
        assert_eq!(cluster_query.query_fn, "test_fn");
        assert_eq!(cluster_query.action_id, "action123");
        assert!(cluster_query.skip_wal);
        assert_eq!(cluster_query.histogram_interval, 3600);
    }

    #[test]
    fn test_scan_stats_conversions() {
        let stats = ScanStats {
            files: 10,
            records: 100,
            original_size: 1024,
            compressed_size: 512,
            querier_files: 5,
            querier_memory_cached_files: 3,
            querier_disk_cached_files: 2,
            idx_scan_size: 256,
            idx_took: 50,
            file_list_took: 30,
            aggs_cache_ratio: 80,
            peak_memory_usage: 1024000,
        };

        // Test conversion to cluster_rpc::ScanStats
        let cluster_stats: cluster_rpc::ScanStats = (&stats).into();
        assert_eq!(cluster_stats.files, 10);
        assert_eq!(cluster_stats.records, 100);
        assert_eq!(cluster_stats.original_size, 1024);
        assert_eq!(cluster_stats.compressed_size, 512);
        assert_eq!(cluster_stats.querier_files, 5);
        assert_eq!(cluster_stats.querier_memory_cached_files, 3);
        assert_eq!(cluster_stats.querier_disk_cached_files, 2);
        assert_eq!(cluster_stats.idx_scan_size, 256);
        assert_eq!(cluster_stats.idx_took, 50);
        assert_eq!(cluster_stats.file_list_took, 30);
        assert_eq!(cluster_stats.aggs_cache_ratio, 80);

        // Test conversion from cluster_rpc::ScanStats
        let converted_stats: ScanStats = (&cluster_stats).into();
        assert_eq!(converted_stats.files, 10);
        assert_eq!(converted_stats.records, 100);
        assert_eq!(converted_stats.original_size, 1024);
        assert_eq!(converted_stats.compressed_size, 512);
        assert_eq!(converted_stats.querier_files, 5);
        assert_eq!(converted_stats.querier_memory_cached_files, 3);
        assert_eq!(converted_stats.querier_disk_cached_files, 2);
        assert_eq!(converted_stats.idx_scan_size, 256);
        assert_eq!(converted_stats.idx_took, 50);
        assert_eq!(converted_stats.file_list_took, 30);
        assert_eq!(converted_stats.aggs_cache_ratio, 80);
    }

    #[test]
    fn test_response_chunk_iterator() {
        let mut response = Response::new(0, 10);
        response.hits = vec![
            json::json!({"id": 1, "data": "small"}),
            json::json!({"id": 2, "data": "small"}),
            json::json!({"id": 3, "data": "small"}),
        ];
        response.total = 3;

        let iterator = ResponseChunkIterator::new(response, Some(100)); // Small chunk size
        let chunks: Vec<ResponseChunk> = iterator.collect();

        // Should have metadata chunk + hits chunks
        assert!(!chunks.is_empty());

        // First chunk should be metadata
        if let ResponseChunk::Metadata { response } = &chunks[0] {
            assert!(response.hits.is_empty());
            assert_eq!(response.total, 3);
        } else {
            panic!("First chunk should be metadata");
        }
    }

    #[test]
    fn test_stream_response_chunks_iterator() {
        let chunks = StreamResponseChunks {
            chunks_iter: None,
            single_chunk: Some(Ok(BytesImpl::from("test data"))),
        };

        let items: Vec<Result<BytesImpl, std::io::Error>> = chunks.collect();
        assert_eq!(items.len(), 1);
        assert!(items[0].is_ok());
    }

    #[test]
    fn test_multi_stream_request_to_query_req() {
        let request = MultiStreamRequest {
            sql: vec![
                SqlQuery {
                    sql: "SELECT * FROM table1".to_string(),
                    start_time: Some(100),
                    end_time: Some(200),
                    query_fn: Some("fn1".to_string()),
                    is_old_format: false,
                },
                SqlQuery {
                    sql: "SELECT * FROM table2".to_string(),
                    start_time: None,
                    end_time: None,
                    query_fn: None,
                    is_old_format: true,
                },
            ],
            encoding: RequestEncoding::Base64,
            timeout: 30,
            from: 5,
            size: 25,
            start_time: 50,
            end_time: 250,
            sort_by: Some("timestamp".to_string()),
            quick_mode: true,
            query_type: "test".to_string(),
            track_total_hits: true,
            uses_zo_fn: true,
            query_fn: Some("global_fn".to_string()),
            skip_wal: true,
            regions: vec!["region1".to_string()],
            clusters: vec!["cluster1".to_string()],
            search_type: Some(SearchEventType::UI),
            search_event_context: Some(SearchEventContext::default()),
            index_type: "parquet".to_string(),
            per_query_response: true,
        };

        let query_reqs = request.to_query_req();
        assert_eq!(query_reqs.len(), 2);

        // Check first query
        let first_req = &query_reqs[0];
        assert_eq!(first_req.query.sql, "SELECT * FROM table1");
        assert_eq!(first_req.query.start_time, 100);
        assert_eq!(first_req.query.end_time, 200);
        assert_eq!(first_req.query.from, 5);
        assert_eq!(first_req.query.size, 25);
        assert!(first_req.query.quick_mode);
        assert_eq!(first_req.query.query_type, "test");
        assert!(first_req.query.track_total_hits);
        assert!(first_req.query.uses_zo_fn);
        assert!(first_req.query.skip_wal);
        assert_eq!(first_req.encoding, RequestEncoding::Base64);
        assert_eq!(first_req.timeout, 30);
        assert_eq!(first_req.regions, vec!["region1".to_string()]);
        assert_eq!(first_req.clusters, vec!["cluster1".to_string()]);
        assert_eq!(first_req.search_type, Some(SearchEventType::UI));

        // Check second query
        let second_req = &query_reqs[1];
        assert_eq!(second_req.query.sql, "SELECT * FROM table2");
        assert_eq!(second_req.query.start_time, 50); // Uses global start_time
        assert_eq!(second_req.query.end_time, 250); // Uses global end_time
    }

    #[test]
    fn test_time_offset() {
        let time_offset = TimeOffset {
            start_time: 100,
            end_time: 200,
        };
        assert_eq!(time_offset.start_time, 100);
        assert_eq!(time_offset.end_time, 200);
    }

    #[test]
    fn test_storage_type() {
        assert_eq!(StorageType::Memory, StorageType::Memory);
        assert_eq!(StorageType::Wal, StorageType::Wal);
        assert_ne!(StorageType::Memory, StorageType::Wal);
    }

    #[test]
    fn test_session() {
        let session = Session {
            id: "session123".to_string(),
            storage_type: StorageType::Memory,
            work_group: Some("workgroup1".to_string()),
            target_partitions: 4,
        };
        assert_eq!(session.id, "session123");
        assert_eq!(session.storage_type, StorageType::Memory);
        assert_eq!(session.work_group, Some("workgroup1".to_string()));
        assert_eq!(session.target_partitions, 4);
    }

    #[test]
    fn test_values_event_context() {
        let ctx = ValuesEventContext {
            field: "test_field".to_string(),
            top_k: Some(10),
            no_count: true,
        };
        assert_eq!(ctx.top_k, Some(10));
        assert!(ctx.no_count);
        assert_eq!(ctx.field, "test_field");
    }

    #[test]
    fn test_values_request() {
        let request = ValuesRequest {
            fields: vec!["field1".to_string(), "field2".to_string()],
            from: None,
            size: Some(100),
            no_count: true,
            regions: vec!["region1".to_string()],
            clusters: vec!["cluster1".to_string()],
            vrl_fn: Some("vrl_fn".to_string()),
            start_time: Some(100),
            end_time: Some(200),
            filter: Some("filter_expr".to_string()),
            timeout: Some(30),
            use_cache: true,
            stream_name: "test_stream".to_string(),
            stream_type: StreamType::Logs,
            sql: "SELECT * FROM test".to_string(),
            clear_cache: false,
        };

        assert_eq!(request.fields.len(), 2);
        assert_eq!(request.size, Some(100));
        assert!(request.no_count);
        assert_eq!(request.regions.len(), 1);
        assert_eq!(request.clusters.len(), 1);
        assert_eq!(request.vrl_fn, Some("vrl_fn".to_string()));
        assert_eq!(request.start_time, Some(100));
        assert_eq!(request.end_time, Some(200));
        assert_eq!(request.filter, Some("filter_expr".to_string()));
        assert_eq!(request.timeout, Some(30));
        assert!(request.use_cache);
        assert_eq!(request.stream_name, "test_stream");
        assert_eq!(request.stream_type, StreamType::Logs);
        assert_eq!(request.sql, "SELECT * FROM test");
    }

    #[test]
    fn test_hash_file_request_response() {
        let request = HashFileRequest {
            files: vec!["file1.txt".to_string(), "file2.txt".to_string()],
        };
        assert_eq!(request.files.len(), 2);

        let mut response = HashFileResponse::default();
        response.files.insert(
            "file1.txt".to_string(),
            [("hash".to_string(), "abc123".to_string())]
                .into_iter()
                .collect(),
        );
        assert_eq!(response.files.len(), 1);
        assert!(response.files.contains_key("file1.txt"));
    }

    #[test]
    fn test_pagination_query() {
        let query = PaginationQuery {
            from: Some(10),
            size: Some(20),
        };
        assert_eq!(query.from, Some(10));
        assert_eq!(query.size, Some(20));
    }

    #[test]
    fn test_sql_query() {
        let query = SqlQuery {
            sql: "SELECT * FROM test".to_string(),
            start_time: Some(100),
            end_time: Some(200),
            query_fn: Some("test_fn".to_string()),
            is_old_format: false,
        };
        assert_eq!(query.sql, "SELECT * FROM test");
        assert_eq!(query.start_time, Some(100));
        assert_eq!(query.end_time, Some(200));
        assert_eq!(query.query_fn, Some("test_fn".to_string()));
        assert!(!query.is_old_format);
    }

    #[test]
    fn test_multi_search_partition_request() {
        let request = MultiSearchPartitionRequest {
            sql: vec![
                "SELECT * FROM table1".to_string(),
                "SELECT * FROM table2".to_string(),
            ],
            start_time: 100,
            end_time: 200,
            encoding: RequestEncoding::Base64,
            regions: vec!["region1".to_string()],
            clusters: vec!["cluster1".to_string()],
            query_fn: Some("test_fn".to_string()),
            streaming_output: true,
            histogram_interval: 3600,
        };
        assert_eq!(request.sql.len(), 2);
        assert_eq!(request.start_time, 100);
        assert_eq!(request.end_time, 200);
        assert_eq!(request.encoding, RequestEncoding::Base64);
        assert_eq!(request.regions.len(), 1);
        assert_eq!(request.clusters.len(), 1);
        assert_eq!(request.query_fn, Some("test_fn".to_string()));
        assert!(request.streaming_output);
        assert_eq!(request.histogram_interval, 3600);
    }

    #[test]
    fn test_multi_search_partition_response() {
        let mut response = MultiSearchPartitionResponse::default();
        let partition_response = SearchPartitionResponse {
            trace_id: "trace123".to_string(),
            file_num: 10,
            records: 100,
            original_size: 1024,
            compressed_size: 512,
            histogram_interval: Some(3600),
            max_query_range: 24,
            partitions: vec![[100, 200]],
            order_by: OrderBy::Asc,
            limit: 1000,
            streaming_output: true,
            streaming_aggs: false,
            streaming_id: Some("stream123".to_string()),
            is_histogram_eligible: false,
        };

        response
            .success
            .insert("query1".to_string(), partition_response);
        response
            .error
            .insert("query2".to_string(), "Error message".to_string());

        assert_eq!(response.success.len(), 1);
        assert_eq!(response.error.len(), 1);
        assert!(response.success.contains_key("query1"));
        assert!(response.error.contains_key("query2"));
    }

    #[test]
    fn test_query_status_response() {
        let response = QueryStatusResponse {
            status: vec![QueryStatus {
                trace_id: "trace123".to_string(),
                status: "running".to_string(),
                created_at: 100,
                started_at: 110,
                work_group: "workgroup1".to_string(),
                user_id: Some("user123".to_string()),
                org_id: Some("org123".to_string()),
                stream_type: Some("logs".to_string()),
                query: Some(QueryInfo {
                    sql: "SELECT * FROM test".to_string(),
                    start_time: 100,
                    end_time: 200,
                }),
                scan_stats: Some(ScanStats::new()),
                search_type: Some(SearchEventType::UI),
                search_event_context: None,
            }],
        };
        assert_eq!(response.status.len(), 1);
        assert_eq!(response.status[0].trace_id, "trace123");
        assert_eq!(response.status[0].status, "running");
    }

    #[test]
    fn test_cancel_query_response() {
        let response = CancelQueryResponse {
            trace_id: "trace123".to_string(),
            is_success: true,
        };
        assert_eq!(response.trace_id, "trace123");
        assert!(response.is_success);
    }

    #[test]
    fn test_query_info() {
        let info = QueryInfo {
            sql: "SELECT * FROM test".to_string(),
            start_time: 100,
            end_time: 200,
        };
        assert_eq!(info.sql, "SELECT * FROM test");
        assert_eq!(info.start_time, 100);
        assert_eq!(info.end_time, 200);
    }

    #[test]
    fn test_interval_duration_conversions() {
        // Test duration in minutes
        assert_eq!(Interval::FiveMinutes.get_duration_minutes(), 5);
        assert_eq!(Interval::OneHour.get_duration_minutes(), 60);
        assert_eq!(Interval::OneDay.get_duration_minutes(), 1440);

        // Test duration in seconds
        assert_eq!(Interval::FiveMinutes.get_interval_seconds(), 300);
        assert_eq!(Interval::OneHour.get_interval_seconds(), 3600);
        assert_eq!(Interval::OneDay.get_interval_seconds(), 86400);

        // Test duration in microseconds
        assert_eq!(
            Interval::FiveMinutes.get_interval_microseconds(),
            300_000_000
        );
        assert_eq!(Interval::OneHour.get_interval_microseconds(), 3_600_000_000);
        assert_eq!(Interval::OneDay.get_interval_microseconds(), 86_400_000_000);
    }

    #[test]
    fn test_interval_display() {
        // Test Display implementation
        assert_eq!(format!("{}", Interval::FiveMinutes), "5 minutes");
        assert_eq!(format!("{}", Interval::OneHour), "60 minutes");
        assert_eq!(format!("{}", Interval::OneDay), "1440 minutes");
    }

    #[test]
    fn test_cardinality_level_from_f64() {
        // Test cardinality level conversion from f64
        assert_eq!(CardinalityLevel::from(1000.0), CardinalityLevel::Low);
        assert_eq!(CardinalityLevel::from(50000.0), CardinalityLevel::Medium);
        assert_eq!(CardinalityLevel::from(2000000.0), CardinalityLevel::High);
        assert_eq!(CardinalityLevel::from(10000000.0), CardinalityLevel::Huge);

        // Test boundary values
        assert_eq!(CardinalityLevel::from(9999.9), CardinalityLevel::Low);
        assert_eq!(CardinalityLevel::from(10000.0), CardinalityLevel::Medium);
        assert_eq!(CardinalityLevel::from(999999.9), CardinalityLevel::Medium);
        assert_eq!(CardinalityLevel::from(1000000.0), CardinalityLevel::High);
        assert_eq!(CardinalityLevel::from(4999999.9), CardinalityLevel::High);
        assert_eq!(CardinalityLevel::from(5000000.0), CardinalityLevel::Huge);
    }

    #[test]
    fn test_generate_aggregation_search_interval() {
        // Test CardinalityLevel::Low (skips 0 intervals)
        let test_cases_low = vec![
            // (time_range, expected_interval)
            // 45 days range -> OneDay interval
            (
                (
                    0,
                    Duration::try_days(45).unwrap().num_microseconds().unwrap(),
                ),
                Interval::OneDay,
            ),
            // 15 days range -> SixHours interval
            (
                (
                    0,
                    Duration::try_days(15).unwrap().num_microseconds().unwrap(),
                ),
                Interval::SixHours,
            ),
            // 3 days range -> TwoHours interval
            (
                (
                    0,
                    Duration::try_days(3).unwrap().num_microseconds().unwrap(),
                ),
                Interval::TwoHours,
            ),
            // 1 day range -> TwoHours interval
            (
                (
                    0,
                    Duration::try_hours(24).unwrap().num_microseconds().unwrap(),
                ),
                Interval::TwoHours,
            ),
            // 8 hours range -> OneHour interval
            (
                (
                    0,
                    Duration::try_hours(8).unwrap().num_microseconds().unwrap(),
                ),
                Interval::OneHour,
            ),
            // 6 hours range -> OneHour interval
            (
                (
                    0,
                    Duration::try_hours(6).unwrap().num_microseconds().unwrap(),
                ),
                Interval::OneHour,
            ),
            // 2 hours range -> ThirtyMinutes interval
            (
                (
                    0,
                    Duration::try_hours(2).unwrap().num_microseconds().unwrap(),
                ),
                Interval::ThirtyMinutes,
            ),
            // 1 hour range -> ThirtyMinutes interval
            (
                (
                    0,
                    Duration::try_hours(1).unwrap().num_microseconds().unwrap(),
                ),
                Interval::ThirtyMinutes,
            ),
            // 30 minutes range -> FiveMinutes interval
            (
                (
                    0,
                    Duration::try_minutes(30)
                        .unwrap()
                        .num_microseconds()
                        .unwrap(),
                ),
                Interval::FiveMinutes,
            ),
            // 15 minutes range -> FiveMinutes interval
            (
                (
                    0,
                    Duration::try_minutes(15)
                        .unwrap()
                        .num_microseconds()
                        .unwrap(),
                ),
                Interval::FiveMinutes,
            ),
            // Less than 15 minutes -> FiveMinutes interval (default)
            (
                (
                    0,
                    Duration::try_minutes(10)
                        .unwrap()
                        .num_microseconds()
                        .unwrap(),
                ),
                Interval::FiveMinutes,
            ),
        ];

        for (time_range, expected_interval) in test_cases_low {
            let result = generate_aggregation_search_interval(
                time_range.0,
                time_range.1,
                CardinalityLevel::Low,
            );
            assert_eq!(
                result, expected_interval,
                "CardinalityLevel::Low - Time range {time_range:?} should return {expected_interval}, but got {result}"
            );
        }

        // Test CardinalityLevel::Medium (skips 1 interval - OneDay)
        let test_cases_medium = vec![
            // 45 days range -> SixHours interval (OneDay skipped)
            (
                (
                    0,
                    Duration::try_days(45).unwrap().num_microseconds().unwrap(),
                ),
                Interval::SixHours,
            ),
            // 15 days range -> SixHours interval
            (
                (
                    0,
                    Duration::try_days(15).unwrap().num_microseconds().unwrap(),
                ),
                Interval::SixHours,
            ),
            // 3 days range -> TwoHours interval
            (
                (
                    0,
                    Duration::try_days(3).unwrap().num_microseconds().unwrap(),
                ),
                Interval::TwoHours,
            ),
        ];

        for (time_range, expected_interval) in test_cases_medium {
            let result = generate_aggregation_search_interval(
                time_range.0,
                time_range.1,
                CardinalityLevel::Medium,
            );
            assert_eq!(
                result, expected_interval,
                "CardinalityLevel::Medium -  Time range {time_range:?} should return {expected_interval}, but got {result}"
            );
        }

        // Test CardinalityLevel::High (skips 2 intervals - OneDay, SixHours)
        let test_cases_high = vec![
            // 45 days range -> TwoHours interval (OneDay, SixHours skipped)
            (
                (0, Duration::days(45).num_microseconds().unwrap()),
                Interval::TwoHours,
            ),
            // 3 days range -> TwoHours interval
            (
                (0, Duration::days(3).num_microseconds().unwrap()),
                Interval::TwoHours,
            ),
            // 1 day range -> TwoHours interval
            (
                (0, Duration::hours(24).num_microseconds().unwrap()),
                Interval::TwoHours,
            ),
        ];

        for (time_range, expected_interval) in test_cases_high {
            let result = generate_aggregation_search_interval(
                time_range.0,
                time_range.1,
                CardinalityLevel::High,
            );
            assert_eq!(
                result, expected_interval,
                "CardinalityLevel::High -  Time range {time_range:?} should return {expected_interval}, but got {result}"
            );
        }

        // Test CardinalityLevel::Huge (we do not cache for huge cardinality)
        let test_cases_huge = vec![
            // 45 days range -> Zero interval
            (
                (
                    0,
                    Duration::try_days(45).unwrap().num_microseconds().unwrap(),
                ),
                Interval::Zero,
            ),
            // 8 hours range -> Zero interval
            (
                (
                    0,
                    Duration::try_hours(8).unwrap().num_microseconds().unwrap(),
                ),
                Interval::Zero,
            ),
            // 6 hours range -> Zero interval
            (
                (
                    0,
                    Duration::try_hours(6).unwrap().num_microseconds().unwrap(),
                ),
                Interval::Zero,
            ),
            // 2 hours range -> Zero interval
            (
                (
                    0,
                    Duration::try_hours(2).unwrap().num_microseconds().unwrap(),
                ),
                Interval::Zero,
            ),
        ];

        for (time_range, expected_interval) in test_cases_huge {
            let result = generate_aggregation_search_interval(
                time_range.0,
                time_range.1,
                CardinalityLevel::Huge,
            );
            assert_eq!(
                result, expected_interval,
                "CardinalityLevel::Huge -  Time range {time_range:?} should return {expected_interval}, but got {result}"
            );
        }

        // Test edge cases
        // Zero time range should return FiveMinutes (default)
        let result = generate_aggregation_search_interval(100, 100, CardinalityLevel::Low);
        assert_eq!(
            result,
            Interval::FiveMinutes,
            "Zero time range should return FiveMinutes"
        );

        // Negative time range should return FiveMinutes (default)
        let result = generate_aggregation_search_interval(200, 100, CardinalityLevel::Low);
        assert_eq!(
            result,
            Interval::FiveMinutes,
            "Negative time range should return FiveMinutes"
        );
    }
}
