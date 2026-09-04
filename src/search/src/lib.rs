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

pub mod bloom_pruner;
pub mod cache;
pub mod datafusion;
pub mod file_cache;
pub mod index;
pub mod inspector;
pub mod sql;
pub mod tantivy;
pub mod types;
pub mod utils;

use config::meta::{
    search::{Response, ScanStats},
    sql::OrderBy,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub const CAPPED_RESULTS_MSG: &str = "Warn: results are capped to meet default limit";

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct CachedQueryResponse {
    pub cached_response: Response,
    pub deltas: Vec<QueryDelta>,
    pub has_cached_data: bool,
    pub cache_query_response: bool,
    pub response_start_time: i64,
    pub response_end_time: i64,
    pub ts_column: String,
    pub is_descending: bool,
    pub limit: i64,
}
#[derive(
    Clone, Debug, Serialize, Deserialize, ToSchema, Default, Eq, PartialEq, Ord, PartialOrd,
)]
pub struct QueryDelta {
    pub delta_start_time: i64,
    pub delta_end_time: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct CacheQueryRequest {
    pub q_start_time: i64,
    pub q_end_time: i64,
    pub is_aggregate: bool,
    pub ts_column: String,
    pub histogram_interval: i64,
    pub is_descending: bool,
    /// Flag indicating this is a histogram query with non-timestamp column ORDER BY.
    /// When true, cache file timestamps must be calculated by scanning all hits,
    /// not just first/last, since results may not be time-ordered.
    /// Example: SELECT histogram(_timestamp), count(*) ... ORDER BY count DESC
    pub is_histogram_non_ts_order: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct MultiCachedQueryResponse {
    pub cached_response: Vec<CachedQueryResponse>,
    pub deltas: Vec<QueryDelta>,
    pub has_cached_data: bool,
    pub cache_query_response: bool,
    pub ts_column: String,
    pub is_descending: bool,
    pub limit: i64,
    pub took: usize,
    pub histogram_interval: i64,
    pub total_cache_duration: usize,
    pub is_aggregate: bool,
    pub file_path: String,
    pub trace_id: String,
    pub order_by: Vec<(String, OrderBy)>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub enum ResultCacheSelectionStrategy {
    #[serde(rename = "overlap")]
    Overlap,
    #[serde(rename = "duration")]
    Duration,
    #[serde(rename = "both")]
    #[default]
    Both,
}

impl From<&str> for ResultCacheSelectionStrategy {
    fn from(input: &str) -> Self {
        match input {
            "overlap" => ResultCacheSelectionStrategy::Overlap,
            "duration" => ResultCacheSelectionStrategy::Duration,
            "both" => ResultCacheSelectionStrategy::Both,
            _ => ResultCacheSelectionStrategy::Both,
        }
    }
}

/// Represents the type of search result (cached or search)
#[derive(Debug, Clone)]
pub enum SearchResultType {
    Cached(Response),
    Search(Response),
}

/// Audit context for search operations
#[derive(Debug, Clone)]
pub struct AuditContext {
    pub method: String,
    pub path: String,
    pub query_params: String,
    pub body: String,
}

/// Strategy for sorting search results
#[derive(Debug, Clone)]
pub enum SortStrategy {
    SqlOrderBy,
    FallbackColumn(String, OrderBy),
    AutoDetermine(String, bool), // (column, is_string)
    NoSort,
}

impl SearchResultType {
    pub fn stats(&self) -> (ScanStats, usize) {
        let mut hits = 0;
        let mut stats = ScanStats::default();
        let resp = match self {
            SearchResultType::Cached(resp) => resp,
            SearchResultType::Search(resp) => resp,
        };
        stats.original_size += resp.scan_size as i64;
        stats.idx_scan_size += resp.idx_scan_size as i64;
        stats.records += resp.scan_records as i64;
        hits += resp.hits.len();
        (stats, hits)
    }
}

#[cfg(test)]
mod tests {
    use config::meta::search::Response;

    use super::*;

    #[test]
    fn test_cached_query_response() {
        let response = CachedQueryResponse {
            cached_response: Response::default(),
            deltas: vec![QueryDelta {
                delta_start_time: 1000,
                delta_end_time: 2000,
            }],
            has_cached_data: true,
            cache_query_response: true,
            response_start_time: 1000,
            response_end_time: 2000,
            ts_column: "timestamp".to_string(),
            is_descending: false,
            limit: 100,
        };

        assert!(response.has_cached_data);
        assert!(response.cache_query_response);
        assert_eq!(response.response_start_time, 1000);
        assert_eq!(response.response_end_time, 2000);
        assert_eq!(response.ts_column, "timestamp");
        assert!(!response.is_descending);
        assert_eq!(response.limit, 100);
        assert_eq!(response.deltas.len(), 1);
    }

    #[test]
    fn test_query_delta() {
        let delta = QueryDelta {
            delta_start_time: 1000,
            delta_end_time: 2000,
        };

        assert_eq!(delta.delta_start_time, 1000);
        assert_eq!(delta.delta_end_time, 2000);
    }

    #[test]
    fn test_query_delta_ordering() {
        let delta1 = QueryDelta {
            delta_start_time: 1000,
            delta_end_time: 2000,
        };

        let delta2 = QueryDelta {
            delta_start_time: 2000,
            delta_end_time: 3000,
        };

        assert!(delta1 < delta2);
        assert!(delta2 > delta1);
    }

    #[test]
    fn test_cache_query_request() {
        let request = CacheQueryRequest {
            q_start_time: 1000,
            q_end_time: 2000,
            is_aggregate: true,
            ts_column: "timestamp".to_string(),
            histogram_interval: 100,
            is_descending: false,
            is_histogram_non_ts_order: false,
        };

        assert_eq!(request.q_start_time, 1000);
        assert_eq!(request.q_end_time, 2000);
        assert!(request.is_aggregate);
        assert_eq!(request.ts_column, "timestamp");
        assert_eq!(request.histogram_interval, 100);
        assert!(!request.is_descending);
    }

    #[test]
    fn test_multi_cached_query_response() {
        let response = MultiCachedQueryResponse {
            cached_response: vec![CachedQueryResponse::default()],
            deltas: vec![QueryDelta::default()],
            has_cached_data: true,
            cache_query_response: true,
            ts_column: "timestamp".to_string(),
            is_descending: false,
            order_by: vec![],
            limit: 100,
            took: 50,
            histogram_interval: 1000,
            total_cache_duration: 2000,
            is_aggregate: true,
            file_path: "test.json".to_string(),
            trace_id: "trace123".to_string(),
        };

        assert!(response.has_cached_data);
        assert!(response.cache_query_response);
        assert_eq!(response.ts_column, "timestamp");
        assert!(!response.is_descending);
        assert_eq!(response.limit, 100);
        assert_eq!(response.took, 50);
        assert_eq!(response.histogram_interval, 1000);
        assert_eq!(response.total_cache_duration, 2000);
        assert!(response.is_aggregate);
        assert_eq!(response.file_path, "test.json");
        assert_eq!(response.trace_id, "trace123");
        assert_eq!(response.cached_response.len(), 1);
        assert_eq!(response.deltas.len(), 1);
    }

    #[test]
    fn test_result_cache_selection_strategy_from_str() {
        assert_eq!(
            ResultCacheSelectionStrategy::from("overlap"),
            ResultCacheSelectionStrategy::Overlap
        );
        assert_eq!(
            ResultCacheSelectionStrategy::from("duration"),
            ResultCacheSelectionStrategy::Duration
        );
        assert_eq!(
            ResultCacheSelectionStrategy::from("both"),
            ResultCacheSelectionStrategy::Both
        );
        assert_eq!(
            ResultCacheSelectionStrategy::from("invalid"),
            ResultCacheSelectionStrategy::Both
        );
    }

    #[test]
    fn test_result_cache_selection_strategy_default() {
        assert_eq!(
            ResultCacheSelectionStrategy::default(),
            ResultCacheSelectionStrategy::Both
        );
    }

    #[test]
    fn test_result_cache_selection_strategy_serialization() {
        let strategies = vec![
            ResultCacheSelectionStrategy::Overlap,
            ResultCacheSelectionStrategy::Duration,
            ResultCacheSelectionStrategy::Both,
        ];

        for strategy in strategies {
            let serialized = serde_json::to_string(&strategy).unwrap();
            let deserialized: ResultCacheSelectionStrategy =
                serde_json::from_str(&serialized).unwrap();
            assert_eq!(strategy, deserialized);
        }
    }
}
