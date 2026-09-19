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

use std::{cmp::Ordering, collections::BinaryHeap, sync::Arc};

use ::search::SortStrategy;
use config::{
    meta::{search::Response, sql::OrderBy},
    utils::json::Value,
};
use log;

/// Determines and applies sorting to search results
pub fn order_search_results(
    mut search_res: Response,
    fallback_order_by_col: Option<String>,
) -> Response {
    if search_res.hits.is_empty() {
        return search_res;
    }

    let strategy = determine_sort_strategy(&search_res, fallback_order_by_col);
    apply_sort_strategy(&mut search_res, strategy);

    search_res
}

/// Determines which sorting strategy to use
fn determine_sort_strategy(
    search_res: &Response,
    fallback_order_by_col: Option<String>,
) -> SortStrategy {
    // The engine already sorted an explicit ORDER BY; re-sorting could only get it wrong.
    if search_res.order_by.is_some() || !search_res.order_by_metadata.is_empty() {
        log::info!(
            "[trace_id: {}] Using user-specified ORDER BY: {:?}",
            search_res.trace_id,
            search_res.order_by_metadata
        );
        return SortStrategy::SqlOrderBy;
    }

    // Check fallback column
    // Default to descending order
    if let Some(col) = find_fallback_column(search_res, fallback_order_by_col) {
        return SortStrategy::FallbackColumn(col, OrderBy::Desc);
    }

    SortStrategy::NoSort
}

/// Applies the chosen sort strategy to results
fn apply_sort_strategy(search_res: &mut Response, strategy: SortStrategy) {
    let SortStrategy::FallbackColumn(col, order) = strategy else {
        return;
    };
    let is_string = search_res
        .hits
        .first()
        .and_then(|hit| hit.get(&col))
        .map(|v| !v.is_number())
        .unwrap_or(true);
    // String fallback columns always sort ascending; only numeric ones follow the direction.
    let is_descending = !is_string && order == OrderBy::Desc;
    sort_by_column(search_res, &col, is_descending);
    if search_res.order_by.is_none() {
        search_res.order_by = Some(order);
        search_res.order_by_metadata.push((col, order));
    }
}

/// Finds and validates fallback column in results
fn find_fallback_column(search_res: &Response, fallback_col: Option<String>) -> Option<String> {
    let fallback_col = fallback_col?;
    let first_hit = search_res.hits.first()?.as_object()?;

    // Find case-insensitive match
    first_hit
        .keys()
        .find(|k| k.eq_ignore_ascii_case(&fallback_col))
        .map(|k| {
            log::info!(
                "[trace_id: {}] Using fallback ORDER BY: {}",
                search_res.trace_id,
                k
            );
            k.to_string()
        })
}

fn sort_by_column(search_res: &mut Response, column: &str, descending: bool) {
    let cols = [(column.to_string(), descending)];
    search_res.hits.sort_by(|a, b| compare_hits(a, b, &cols));
}

/// Orders two hits by ORDER BY columns given as (name, is_descending), first difference wins.
pub fn compare_hits(a: &Value, b: &Value, cols: &[(String, bool)]) -> Ordering {
    for (col, descending) in cols {
        let ord = compare_hit_values(a.get(col), b.get(col), *descending);
        if ord != Ordering::Equal {
            return ord;
        }
    }
    Ordering::Equal
}

/// Nulls last in either direction; numbers numerically, strings lexically, numbers first.
pub fn compare_hit_values(a: Option<&Value>, b: Option<&Value>, descending: bool) -> Ordering {
    let (a, b) = match (a.filter(|v| !v.is_null()), b.filter(|v| !v.is_null())) {
        (None, None) => return Ordering::Equal,
        (None, Some(_)) => return Ordering::Greater,
        (Some(_), None) => return Ordering::Less,
        (Some(a), Some(b)) => (a, b),
    };
    let ord = compare_values(a, b);
    if descending { ord.reverse() } else { ord }
}

fn compare_values(a: &Value, b: &Value) -> Ordering {
    if let (Some(x), Some(y)) = (a.as_i64(), b.as_i64()) {
        return x.cmp(&y);
    }
    if let (Some(x), Some(y)) = (a.as_u64(), b.as_u64()) {
        return x.cmp(&y);
    }
    match (a.as_f64(), b.as_f64()) {
        (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(Ordering::Equal),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => match (a.as_str(), b.as_str()) {
            (Some(x), Some(y)) => x.cmp(y),
            _ => a.to_string().cmp(&b.to_string()),
        },
    }
}

/// Incremental top-k heap for merging hits across partitions.
///
/// Feed one partition at a time via `push_hits` — the heap never exceeds k elements
/// regardless of how many partitions exist. Peak memory = k + one_partition_size,
/// not total_partitions × partition_size.
///
/// Honors all N ORDER BY columns in order: primary sort first, secondary as tiebreaker,
/// and so on — matching the SQL semantics of multi-column ORDER BY.
pub struct TopKHeap {
    heap: BinaryHeap<std::cmp::Reverse<HeapHit>>,
    k: usize,
    cols: Arc<[(String, bool)]>,
}

impl TopKHeap {
    /// `order_by_cols`: all ORDER BY columns as (name, is_descending), in query order.
    /// `k=0` is invalid (heap would never accept any row); falls back to `ZO_QUERY_DEFAULT_LIMIT`.
    pub fn new(k: usize, order_by_cols: &[(String, bool)]) -> Self {
        let default_k = config::get_config().limit.query_default_limit as usize;
        let k = if k == 0 { default_k } else { k };
        Self {
            // k comes from size or SQL LIMIT, so grow on demand instead of pre-reserving it.
            heap: BinaryHeap::with_capacity(k.min(default_k) + 1),
            k,
            cols: order_by_cols.into(),
        }
    }

    pub fn push_hits(&mut self, hits: Vec<Value>) {
        for hit in hits {
            let candidate = HeapHit {
                hit,
                cols: Arc::clone(&self.cols),
            };
            if self.heap.len() < self.k {
                self.heap.push(std::cmp::Reverse(candidate));
            } else if let Some(std::cmp::Reverse(min)) = self.heap.peek()
                && candidate > *min
            {
                self.heap.pop();
                self.heap.push(std::cmp::Reverse(candidate));
            }
        }
    }

    pub fn into_sorted_vec(self, from: usize) -> Vec<Value> {
        let cols = self.cols;
        let mut result: Vec<Value> = self
            .heap
            .into_iter()
            .map(|std::cmp::Reverse(h)| h.hit)
            .collect();
        result.sort_by(|a, b| compare_hits(a, b, &cols));
        if from >= result.len() {
            return vec![];
        }
        result[from..].to_vec()
    }
}

struct HeapHit {
    hit: Value,
    cols: Arc<[(String, bool)]>,
}

impl PartialEq for HeapHit {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}

impl Eq for HeapHit {}

impl PartialOrd for HeapHit {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for HeapHit {
    // The min-heap evicts its smallest entry, so the row that sorts first must compare greatest.
    fn cmp(&self, other: &Self) -> Ordering {
        compare_hits(&self.hit, &other.hit, &self.cols).reverse()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn create_test_response() -> Response {
        Response {
            hits: vec![
                json!({
                    "timestamp": 1000,
                    "level": "info",
                    "message": "test message 1",
                    "count": 5
                }),
                json!({
                    "timestamp": 2000,
                    "level": "error",
                    "message": "test message 2",
                    "count": 10
                }),
                json!({
                    "timestamp": 1500,
                    "level": "warn",
                    "message": "test message 3",
                    "count": 7
                }),
            ],
            trace_id: "test-123".to_string(),
            ..Default::default()
        }
    }

    #[test]
    fn test_order_search_results_empty_hits() {
        let response = Response {
            hits: vec![],
            trace_id: "test-123".to_string(),
            ..Default::default()
        };

        let result = order_search_results(response.clone(), None);

        // Should return unchanged response for empty hits
        assert_eq!(result.hits.len(), 0);
    }

    #[test]
    fn test_order_search_results_with_sql_order_by() {
        let mut response = create_test_response();
        response.order_by = Some(OrderBy::Desc);

        let result = order_search_results(response.clone(), Some("timestamp".to_string()));

        // Should respect SQL ORDER BY and ignore fallback
        assert_eq!(result.order_by, Some(OrderBy::Desc));
        assert_eq!(result.order_by_metadata.len(), 0);
    }

    #[test]
    fn test_order_search_results_with_fallback_column() {
        let mut response = create_test_response();
        response.order_by = None;

        let result = order_search_results(response.clone(), Some("timestamp".to_string()));

        // Should use fallback column with descending order
        assert_eq!(result.order_by, Some(OrderBy::Desc));
        assert_eq!(result.order_by_metadata.len(), 1);
        assert_eq!(result.order_by_metadata[0].0, "timestamp");
        assert_eq!(result.order_by_metadata[0].1, OrderBy::Desc);
    }

    #[test]
    fn test_order_search_results_without_order_info_keeps_engine_order() {
        let mut response = create_test_response();
        response.order_by = None;
        let original = response.hits.clone();

        let result = order_search_results(response, None);

        assert_eq!(result.order_by, None);
        assert_eq!(result.order_by_metadata.len(), 0);
        assert_eq!(result.hits, original);
    }

    #[test]
    fn test_order_search_results_metadata_only_keeps_engine_order() {
        let mut response = create_test_response();
        response.order_by = None;
        response.order_by_metadata = vec![("count(*)".to_string(), OrderBy::Asc)];
        let original = response.hits.clone();

        let result = order_search_results(response, Some("timestamp".to_string()));

        assert_eq!(result.hits, original);
    }

    #[test]
    fn test_determine_sort_strategy_sql_order_by() {
        let mut response = create_test_response();
        response.order_by = Some(OrderBy::Asc);

        let strategy = determine_sort_strategy(&response, Some("timestamp".to_string()));

        match strategy {
            SortStrategy::SqlOrderBy => (),
            _ => panic!("Expected SqlOrderBy strategy"),
        }
    }

    #[test]
    fn test_determine_sort_strategy_fallback_column() {
        let response = create_test_response();

        let strategy = determine_sort_strategy(&response, Some("timestamp".to_string()));

        match strategy {
            SortStrategy::FallbackColumn(col, order) => {
                assert_eq!(col, "timestamp");
                assert_eq!(order, OrderBy::Desc);
            }
            _ => panic!("Expected FallbackColumn strategy"),
        }
    }

    #[test]
    fn test_find_fallback_column_success() {
        let response = create_test_response();

        let result = find_fallback_column(&response, Some("timestamp".to_string()));

        assert_eq!(result, Some("timestamp".to_string()));
    }

    #[test]
    fn test_find_fallback_column_case_insensitive() {
        let response = create_test_response();

        let result = find_fallback_column(&response, Some("TIMESTAMP".to_string()));

        assert_eq!(result, Some("timestamp".to_string()));
    }

    #[test]
    fn test_find_fallback_column_not_found() {
        let response = create_test_response();

        let result = find_fallback_column(&response, Some("nonexistent".to_string()));

        assert_eq!(result, None);
    }

    #[test]
    fn test_find_fallback_column_none() {
        let response = create_test_response();

        let result = find_fallback_column(&response, None);

        assert_eq!(result, None);
    }

    #[test]
    fn test_sort_by_column_string_ascending() {
        let mut response = create_test_response();

        sort_by_column(&mut response, "level", false);

        // String columns should always sort ascending regardless of descending flag
        let levels: Vec<&str> = response
            .hits
            .iter()
            .map(|hit| hit["level"].as_str().unwrap())
            .collect();

        assert_eq!(levels, vec!["error", "info", "warn"]);
    }

    #[test]
    fn test_sort_by_column_numeric_descending() {
        let mut response = create_test_response();

        sort_by_column(&mut response, "count", true);

        // Numeric columns should respect the descending flag
        let counts: Vec<i64> = response
            .hits
            .iter()
            .map(|hit| hit["count"].as_i64().unwrap())
            .collect();

        assert_eq!(counts, vec![10, 7, 5]);
    }

    #[test]
    fn test_sort_by_column_numeric_ascending() {
        let mut response = create_test_response();

        sort_by_column(&mut response, "count", false);

        let counts: Vec<i64> = response
            .hits
            .iter()
            .map(|hit| hit["count"].as_i64().unwrap())
            .collect();

        assert_eq!(counts, vec![5, 7, 10]);
    }

    #[test]
    fn test_compare_hit_values_ordering() {
        use std::cmp::Ordering::*;
        let n = |v: i64| json!(v);
        let s = |v: &str| json!(v);
        assert_eq!(compare_hit_values(Some(&n(1)), Some(&n(2)), false), Less);
        assert_eq!(compare_hit_values(Some(&n(1)), Some(&n(2)), true), Greater);
        assert_eq!(compare_hit_values(Some(&n(2)), Some(&n(2)), false), Equal);
        assert_eq!(
            compare_hit_values(Some(&s("a")), Some(&s("b")), false),
            Less
        );
        assert_eq!(compare_hit_values(Some(&n(1)), Some(&s("a")), false), Less);
        assert_eq!(compare_hit_values(Some(&json!(null)), None, false), Equal);
    }

    #[test]
    fn test_integers_compare_without_float_rounding() {
        use std::cmp::Ordering::*;
        let a = json!(9007199254740992_i64);
        let b = json!(9007199254740993_i64);
        assert_eq!(compare_hit_values(Some(&a), Some(&b), false), Less);
        let a = json!(18446744073709551614_u64);
        let b = json!(18446744073709551615_u64);
        assert_eq!(compare_hit_values(Some(&a), Some(&b), true), Greater);
        assert_eq!(
            compare_hit_values(Some(&json!(1.5)), Some(&json!(1)), false),
            Greater
        );
    }

    #[test]
    fn test_nulls_sort_last_in_both_directions() {
        use std::cmp::Ordering::*;
        let one = json!(1);
        for descending in [false, true] {
            assert_eq!(compare_hit_values(Some(&one), None, descending), Less);
            assert_eq!(compare_hit_values(None, Some(&one), descending), Greater);
            assert_eq!(
                compare_hit_values(Some(&json!(null)), Some(&one), descending),
                Greater
            );
        }
        let mut hits = vec![json!({"c": null}), json!({"c": 1}), json!({"c": 2})];
        hits.sort_by(|a, b| compare_hits(a, b, &[("c".to_string(), true)]));
        assert_eq!(
            hits,
            vec![json!({"c": 2}), json!({"c": 1}), json!({"c": null})]
        );
    }

    #[test]
    fn test_sort_by_column_missing_field() {
        let mut response = create_test_response();

        sort_by_column(&mut response, "nonexistent", false);

        // Should not panic, should maintain original order
        assert_eq!(response.hits.len(), 3);
    }

    #[test]
    fn test_sort_by_column_mixed_types() {
        let mut response = Response {
            hits: vec![
                json!({"field": "string"}),
                json!({"field": 42}),
                json!({"field": "another"}),
            ],
            trace_id: "test-123".to_string(),
            ..Default::default()
        };

        sort_by_column(&mut response, "field", false);

        // Should handle mixed types gracefully
        assert_eq!(response.hits.len(), 3);
    }

    #[test]
    fn test_order_search_results_complex_scenario() {
        let response = Response {
            hits: vec![
                json!({
                    "timestamp": 3000,
                    "level": "debug",
                    "count": 1
                }),
                json!({
                    "timestamp": 1000,
                    "level": "info",
                    "count": 5
                }),
                json!({
                    "timestamp": 2000,
                    "level": "warn",
                    "count": 3
                }),
            ],
            order_by: None,
            trace_id: "test-123".to_string(),
            ..Default::default()
        };

        let result = order_search_results(response.clone(), Some("timestamp".to_string()));

        // Should use fallback column and sort by timestamp descending
        assert_eq!(result.order_by, Some(OrderBy::Desc));
        assert_eq!(result.order_by_metadata.len(), 1);
        assert_eq!(result.order_by_metadata[0].0, "timestamp");
        assert_eq!(result.order_by_metadata[0].1, OrderBy::Desc);

        // Verify sorting
        let timestamps: Vec<i64> = result
            .hits
            .iter()
            .map(|hit| hit["timestamp"].as_i64().unwrap())
            .collect();

        assert_eq!(timestamps, vec![3000, 2000, 1000]);
    }

    // ── TopKHeap tests ────────────────────────────────────────────────────────

    fn make_hits(pairs: &[(&str, i64)]) -> Vec<Value> {
        pairs
            .iter()
            .map(|(level, cnt)| json!({"level": level, "cnt": cnt}))
            .collect()
    }

    #[test]
    fn test_topk_heap_zero_k_falls_back_to_default_limit() {
        // k=0 is invalid — heap would never accept rows. Must fall back to query_default_limit.
        let mut heap = TopKHeap::new(0, &[("cnt".to_string(), true)]);
        heap.push_hits(make_hits(&[("info", 955), ("error", 382), ("warn", 100)]));
        let result = heap.into_sorted_vec(0);
        assert!(
            !result.is_empty(),
            "k=0 must fall back to default limit, not drop all rows"
        );
        assert_eq!(result[0]["cnt"].as_i64().unwrap(), 955);
    }

    #[test]
    fn test_topk_heap_bounded_keeps_top_k() {
        // k=2 DESC: should keep the 2 largest cnt values
        let mut heap = TopKHeap::new(2, &[("cnt".to_string(), true)]);
        heap.push_hits(make_hits(&[("info", 955), ("error", 382), ("warn", 382)]));
        let result = heap.into_sorted_vec(0);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0]["cnt"].as_i64().unwrap(), 955);
        assert_eq!(result[1]["cnt"].as_i64().unwrap(), 382);
    }

    #[test]
    fn test_topk_heap_unlimited_keeps_all() {
        // size==-1 path: heap_k == query_default_limit (e.g. 1000), all 3 hits fit
        let k = 1000; // mirrors ZO_QUERY_DEFAULT_LIMIT default
        let mut heap = TopKHeap::new(k, &[("cnt".to_string(), true)]);
        heap.push_hits(make_hits(&[("info", 955), ("error", 382), ("warn", 382)]));
        let result = heap.into_sorted_vec(0);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0]["cnt"].as_i64().unwrap(), 955);
    }

    #[test]
    fn test_topk_heap_from_skips_correctly() {
        // from=1: skip first sorted row
        let k = 1000;
        let mut heap = TopKHeap::new(k, &[("cnt".to_string(), true)]);
        heap.push_hits(make_hits(&[("info", 955), ("error", 382), ("warn", 100)]));
        let result = heap.into_sorted_vec(1); // skip rank-0 (955)
        assert_eq!(result.len(), 2);
        assert_eq!(result[0]["cnt"].as_i64().unwrap(), 382);
    }

    #[test]
    fn test_topk_heap_asc_order() {
        // is_descending=false → ASC sort
        let mut heap = TopKHeap::new(1000, &[("cnt".to_string(), false)]);
        heap.push_hits(make_hits(&[("info", 955), ("error", 382), ("warn", 100)]));
        let result = heap.into_sorted_vec(0);
        assert_eq!(result[0]["cnt"].as_i64().unwrap(), 100);
        assert_eq!(result[2]["cnt"].as_i64().unwrap(), 955);
    }

    #[test]
    fn test_topk_heap_multiple_partitions_unlimited() {
        // Simulates multi-partition push with size==-1 (k = default limit)
        let mut heap = TopKHeap::new(1000, &[("cnt".to_string(), true)]);
        heap.push_hits(make_hits(&[("info", 955)])); // partition 1
        heap.push_hits(make_hits(&[("error", 382)])); // partition 2
        heap.push_hits(make_hits(&[("warn", 100)])); // partition 3
        let result = heap.into_sorted_vec(0);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0]["cnt"].as_i64().unwrap(), 955);
    }

    #[test]
    fn test_topk_heap_unlimited_non_ts_order_by() {
        // Non-ts ORDER BY with size==-1 (e.g. plain aggregate query, not CTE):
        // heap_k == query_default_limit, all rows from all partitions must survive.
        // Note: CTE queries now short-circuit via is_aggregate=true and never reach
        // the TopKHeap path.
        let mut heap = TopKHeap::new(1000, &[("level_count".to_string(), true)]);
        heap.push_hits(vec![
            json!({"level": "info",  "level_count": 955}),
            json!({"level": "error", "level_count": 382}),
        ]);
        heap.push_hits(vec![json!({"level": "warn", "level_count": 100})]);
        let result = heap.into_sorted_vec(0);
        assert_eq!(result.len(), 3, "all rows must survive with unlimited size");
        assert_eq!(result[0]["level"].as_str().unwrap(), "info");
        assert_eq!(result[0]["level_count"].as_i64().unwrap(), 955);
    }
}
