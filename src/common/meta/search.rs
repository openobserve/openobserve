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

use std::str::FromStr;

use config::meta::search::Response;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

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
    pub delta_removed_hits: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct CacheQueryRequest {
    pub q_start_time: i64,
    pub q_end_time: i64,
    pub is_aggregate: bool,
    pub ts_column: String,
    pub discard_interval: i64,
    pub is_descending: bool,
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

// Implementing FromStr for ResultCacheSelectionStrategy
impl FromStr for ResultCacheSelectionStrategy {
    type Err = ();

    fn from_str(input: &str) -> Result<ResultCacheSelectionStrategy, Self::Err> {
        match input {
            "overlap" => Ok(ResultCacheSelectionStrategy::Overlap),
            "duration" => Ok(ResultCacheSelectionStrategy::Duration),
            "both" => Ok(ResultCacheSelectionStrategy::Both),
            _ => Ok(ResultCacheSelectionStrategy::Both),
        }
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
                delta_removed_hits: false,
            }],
            has_cached_data: true,
            cache_query_response: true,
            response_start_time: 1000,
            response_end_time: 2000,
            ts_column: "timestamp".to_string(),
            is_descending: false,
            limit: 100,
        };

        assert_eq!(response.has_cached_data, true);
        assert_eq!(response.cache_query_response, true);
        assert_eq!(response.response_start_time, 1000);
        assert_eq!(response.response_end_time, 2000);
        assert_eq!(response.ts_column, "timestamp");
        assert_eq!(response.is_descending, false);
        assert_eq!(response.limit, 100);
        assert_eq!(response.deltas.len(), 1);
    }

    #[test]
    fn test_query_delta() {
        let delta = QueryDelta {
            delta_start_time: 1000,
            delta_end_time: 2000,
            delta_removed_hits: true,
        };

        assert_eq!(delta.delta_start_time, 1000);
        assert_eq!(delta.delta_end_time, 2000);
        assert_eq!(delta.delta_removed_hits, true);
    }

    #[test]
    fn test_query_delta_ordering() {
        let delta1 = QueryDelta {
            delta_start_time: 1000,
            delta_end_time: 2000,
            delta_removed_hits: false,
        };

        let delta2 = QueryDelta {
            delta_start_time: 2000,
            delta_end_time: 3000,
            delta_removed_hits: false,
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
            discard_interval: 100,
            is_descending: false,
        };

        assert_eq!(request.q_start_time, 1000);
        assert_eq!(request.q_end_time, 2000);
        assert_eq!(request.is_aggregate, true);
        assert_eq!(request.ts_column, "timestamp");
        assert_eq!(request.discard_interval, 100);
        assert_eq!(request.is_descending, false);
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
            limit: 100,
            took: 50,
            histogram_interval: 1000,
            total_cache_duration: 2000,
            is_aggregate: true,
            file_path: "test.json".to_string(),
            trace_id: "trace123".to_string(),
        };

        assert_eq!(response.has_cached_data, true);
        assert_eq!(response.cache_query_response, true);
        assert_eq!(response.ts_column, "timestamp");
        assert_eq!(response.is_descending, false);
        assert_eq!(response.limit, 100);
        assert_eq!(response.took, 50);
        assert_eq!(response.histogram_interval, 1000);
        assert_eq!(response.total_cache_duration, 2000);
        assert_eq!(response.is_aggregate, true);
        assert_eq!(response.file_path, "test.json");
        assert_eq!(response.trace_id, "trace123");
        assert_eq!(response.cached_response.len(), 1);
        assert_eq!(response.deltas.len(), 1);
    }

    #[test]
    fn test_result_cache_selection_strategy_from_str() {
        assert_eq!(
            ResultCacheSelectionStrategy::from_str("overlap").unwrap(),
            ResultCacheSelectionStrategy::Overlap
        );
        assert_eq!(
            ResultCacheSelectionStrategy::from_str("duration").unwrap(),
            ResultCacheSelectionStrategy::Duration
        );
        assert_eq!(
            ResultCacheSelectionStrategy::from_str("both").unwrap(),
            ResultCacheSelectionStrategy::Both
        );
        assert_eq!(
            ResultCacheSelectionStrategy::from_str("invalid").unwrap(),
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

#[cfg(test)]
#[cfg(feature = "enterprise")]
mod enterprise_tests {
    use arrow_schema::{DataType, Field};
    #[cfg(feature = "enterprise")]
    use o2_enterprise::enterprise::common::streaming_agg_cache::{
        StreamingAggsCacheResultRecordBatch, calculate_record_batches_deltas,
    };

    #[test]
    fn test_calculate_record_batches_deltas() {
        use std::sync::Arc;

        use arrow::{
            array::{Int64Array, StringArray},
            datatypes::Schema,
        };

        // Create a simple schema for testing
        let schema = Arc::new(Schema::new(vec![
            Field::new("status", DataType::Utf8, false),
            Field::new("count", DataType::Int64, false),
        ]));

        // Create test record batches
        let batch1 = arrow::array::RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["200", "404"])),
                Arc::new(Int64Array::from(vec![100, 50])),
            ],
        )
        .unwrap();

        let batch2 = arrow::array::RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["200", "500"])),
                Arc::new(Int64Array::from(vec![80, 20])),
            ],
        )
        .unwrap();

        // Test case: Query: 10:00 - 16:00, Cache: 11:00 - 12:00, 14:00 - 15:00
        // Expected Deltas: 10:00 - 11:00, 12:00 - 14:00, 15:00 - 16:00
        let cache_result = vec![
            StreamingAggsCacheResultRecordBatch {
                record_batch: batch1,
                cache_start_time: 11_000_000, // 11:00 in microseconds
                cache_end_time: 12_000_000,   // 12:00 in microseconds
            },
            StreamingAggsCacheResultRecordBatch {
                record_batch: batch2,
                cache_start_time: 14_000_000, // 14:00 in microseconds
                cache_end_time: 15_000_000,   // 15:00 in microseconds
            },
        ];

        let query_start_time = 10_000_000; // 10:00 in microseconds
        let query_end_time = 16_000_000; // 16:00 in microseconds

        let deltas =
            calculate_record_batches_deltas(query_start_time, query_end_time, &cache_result);

        // Should have 3 deltas
        assert_eq!(deltas.len(), 3);

        // Delta 1: 10:00 - 11:00 (before first cache)
        assert_eq!(deltas[0].delta_start_time, 10_000_000);
        assert_eq!(deltas[0].delta_end_time, 11_000_000);

        // Delta 2: 12:00 - 14:00 (between caches)
        assert_eq!(deltas[1].delta_start_time, 12_000_000);
        assert_eq!(deltas[1].delta_end_time, 14_000_000);

        // Delta 3: 15:00 - 16:00 (after last cache)
        assert_eq!(deltas[2].delta_start_time, 15_000_000);
        assert_eq!(deltas[2].delta_end_time, 16_000_000);
    }

    #[test]
    fn test_calculate_record_batches_deltas_no_cache() {
        // Test case: No cache, entire query range should be a delta
        let cache_result = vec![];
        let query_start_time = 10_000_000;
        let query_end_time = 16_000_000;

        let deltas =
            calculate_record_batches_deltas(query_start_time, query_end_time, &cache_result);

        assert_eq!(deltas.len(), 1);
        assert_eq!(deltas[0].delta_start_time, 10_000_000);
        assert_eq!(deltas[0].delta_end_time, 16_000_000);
    }

    #[test]
    fn test_calculate_record_batches_deltas_complete_cache() {
        use std::sync::Arc;

        use arrow::{
            array::{Int64Array, StringArray},
            datatypes::Schema,
        };

        let schema = Arc::new(Schema::new(vec![
            Field::new("status", DataType::Utf8, false),
            Field::new("count", DataType::Int64, false),
        ]));

        let batch = arrow::array::RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["200"])),
                Arc::new(Int64Array::from(vec![100])),
            ],
        )
        .unwrap();

        // Test case: Cache covers entire query range
        let cache_result = vec![StreamingAggsCacheResultRecordBatch {
            record_batch: batch,
            cache_start_time: 10_000_000, // Same as query start
            cache_end_time: 16_000_000,   // Same as query end
        }];

        let query_start_time = 10_000_000;
        let query_end_time = 16_000_000;

        let deltas =
            calculate_record_batches_deltas(query_start_time, query_end_time, &cache_result);

        // Should have no deltas (complete cache hit)
        assert_eq!(deltas.len(), 0);
    }

    #[test]
    fn test_calculate_record_batches_deltas_unsorted_cache() {
        use std::sync::Arc;

        use arrow::{
            array::{Int64Array, StringArray},
            datatypes::Schema,
        };

        let schema = Arc::new(Schema::new(vec![
            Field::new("status", DataType::Utf8, false),
            Field::new("count", DataType::Int64, false),
        ]));

        let batch1 = arrow::array::RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["200"])),
                Arc::new(Int64Array::from(vec![100])),
            ],
        )
        .unwrap();

        let batch2 = arrow::array::RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from(vec!["404"])),
                Arc::new(Int64Array::from(vec![50])),
            ],
        )
        .unwrap();

        // Test case: Cache results in wrong order (should be sorted internally)
        let cache_result = vec![
            StreamingAggsCacheResultRecordBatch {
                record_batch: batch1,
                cache_start_time: 14_000_000, // Second cache range
                cache_end_time: 15_000_000,
            },
            StreamingAggsCacheResultRecordBatch {
                record_batch: batch2,
                cache_start_time: 11_000_000, // First cache range
                cache_end_time: 12_000_000,
            },
        ];

        let query_start_time = 10_000_000;
        let query_end_time = 16_000_000;

        let deltas =
            calculate_record_batches_deltas(query_start_time, query_end_time, &cache_result);

        // Should still produce correct deltas despite unsorted input
        assert_eq!(deltas.len(), 3);
        assert_eq!(deltas[0].delta_start_time, 10_000_000); // Before first
        assert_eq!(deltas[0].delta_end_time, 11_000_000);
        assert_eq!(deltas[1].delta_start_time, 12_000_000); // Between
        assert_eq!(deltas[1].delta_end_time, 14_000_000);
        assert_eq!(deltas[2].delta_start_time, 15_000_000); // After last
        assert_eq!(deltas[2].delta_end_time, 16_000_000);
    }
}
