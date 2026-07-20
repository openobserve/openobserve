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

use config::{
    TIMESTAMP_COL_NAME,
    meta::{
        function::RESULT_ARRAY, search::SearchPartitionRequest, sql::OrderBy, stream::StreamType,
    },
    utils::{
        base64,
        sql::{is_complex_query, is_eligible_for_histogram, is_explain_query},
    },
};
use infra::errors::Error;
use openobserve_search_service::cache::cacher::get_ts_col_order_by;
use proto::cluster_rpc;

use crate::search::{partition::aggregate::is_streaming_aggregate, sql::Sql};

/// SQL-derived context for a search partition request.
///
/// Parses the request SQL once and pre-computes all query-characteristic flags
/// needed by the partitioning logic.
pub struct PartitionSqlContext {
    pub sql: Sql,
    pub is_complex_query: bool,
    pub ts_column: Option<String>,
    pub is_streaming_aggregate: bool,
    pub use_single_partition: bool,
    pub is_histogram_eligible: bool,
    pub sql_order_by: OrderBy,
}

impl PartitionSqlContext {
    pub async fn new(
        req: &SearchPartitionRequest,
        org_id: &str,
        stream_type: StreamType,
    ) -> Result<Self, Error> {
        let query = cluster_rpc::SearchQuery {
            start_time: req.start_time,
            end_time: req.end_time,
            sql: req.sql.to_string(),
            histogram_interval: req.histogram_interval,
            ..Default::default()
        };
        let sql = Sql::new(&query, org_id, stream_type, None).await?;

        let is_explain = is_explain_query(&req.sql);
        let is_complex = is_complex_query(&req.sql).unwrap_or(false);
        let ts_column = get_ts_col_order_by(&sql, TIMESTAMP_COL_NAME, is_complex).map(|(v, _)| v);
        let is_streaming_agg = is_streaming_aggregate(&req.sql, ts_column.as_deref());
        let apply_over_hits = req.query_fn.as_ref().is_some_and(|v| {
            !v.is_empty() && RESULT_ARRAY.is_match(&base64::decode_url(v).unwrap_or(v.to_string()))
        });

        let use_single_partition = is_explain
            || ((ts_column.is_none() || apply_over_hits)
                && !(req.streaming_output && is_streaming_agg));

        let (is_histogram_eligible, _) =
            is_eligible_for_histogram(&req.sql, false).unwrap_or((false, false));

        let sql_order_by = sql
            .order_by
            .first()
            .map(|(field, order_by)| {
                if field == &ts_column.clone().unwrap_or_default() && order_by == &OrderBy::Asc {
                    OrderBy::Asc
                } else {
                    OrderBy::Desc
                }
            })
            .unwrap_or(OrderBy::Desc);

        Ok(Self {
            sql,
            is_complex_query: is_complex,
            ts_column,
            is_streaming_aggregate: is_streaming_agg,
            use_single_partition,
            is_histogram_eligible,
            sql_order_by,
        })
    }

    /// Returns true when the primary ORDER BY column is not a timestamp column,
    /// meaning per-partition `hits_to_skip` is incorrect and the TopKHeap merge path
    /// must be used instead.
    ///
    /// Only the first ORDER BY column is evaluated; secondary columns are not compared.
    /// Complex and histogram queries always return false — their partitioning is not
    /// affected by non-ts ORDER BY.
    pub fn detect_non_ts_order_by(&self) -> bool {
        if self.is_complex_query || self.sql.histogram_interval.is_some() {
            return false;
        }
        self.sql
            .order_by
            .first()
            .map(|(field, _)| {
                field.as_str() != TIMESTAMP_COL_NAME
                    && self.ts_column.as_deref() != Some(field.as_str())
            })
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use config::meta::stream::StreamType;

    use super::*;
    use crate::search::sql::Sql;

    fn ob(col: &str, dir: OrderBy) -> (String, OrderBy) {
        (col.to_string(), dir)
    }

    fn mk(
        order_by: Vec<(String, OrderBy)>,
        is_complex: bool,
        histogram_interval: Option<i64>,
        ts_column: Option<&str>,
    ) -> PartitionSqlContext {
        PartitionSqlContext {
            sql: Sql {
                sql: String::new(),
                is_complex: false,
                org_id: String::new(),
                stream_type: StreamType::Logs,
                stream_names: Default::default(),
                has_match_all: false,
                equal_items: Default::default(),
                columns: Default::default(),
                aliases: Default::default(),
                schemas: Default::default(),
                limit: -1,
                offset: 0,
                time_range: (0, 0),
                group_by: Default::default(),
                order_by,
                histogram_interval,
                timezone: None,
                sorted_by_time: false,
                sampling_config: None,
            },
            is_complex_query: is_complex,
            ts_column: ts_column.map(str::to_string),
            is_streaming_aggregate: false,
            use_single_partition: false,
            is_histogram_eligible: false,
            sql_order_by: OrderBy::Desc,
        }
    }

    // Helper: parse SQL string → run ColumnVisitor → return order_by vec.
    // Uses empty schemas so no schema resolution happens, which is fine for
    // ORDER BY extraction (pre_visit_query doesn't touch schemas).
    fn parse_order_by(sql_str: &str) -> Vec<(String, OrderBy)> {
        use ::datafusion::common::TableReference;
        use hashbrown::HashMap;
        use sqlparser::{ast::VisitMut, dialect::GenericDialect, parser::Parser};

        use crate::search::sql::visitor::column::ColumnVisitor;

        let mut stmt = Parser::parse_sql(&GenericDialect {}, sql_str)
            .unwrap()
            .pop()
            .unwrap();
        let schemas = HashMap::<TableReference, _>::new();
        let mut visitor = ColumnVisitor::new(&schemas);
        let _ = stmt.visit(&mut visitor);
        visitor.order_by
    }

    // ── PartitionSqlContext::detect_non_ts_order_by tests ─────────────────────

    #[test]
    fn test_detect_no_order_by_returns_false() {
        assert!(!mk(vec![], false, None, None).detect_non_ts_order_by());
    }

    #[test]
    fn test_detect_timestamp_order_by_returns_false() {
        assert!(
            !mk(vec![ob("_timestamp", OrderBy::Desc)], false, None, None).detect_non_ts_order_by()
        );
    }

    #[test]
    fn test_detect_non_ts_desc_returns_true() {
        assert!(
            mk(vec![ob("duration", OrderBy::Desc)], false, None, None).detect_non_ts_order_by()
        );
    }

    #[test]
    fn test_detect_non_ts_asc_returns_true() {
        assert!(mk(vec![ob("duration", OrderBy::Asc)], false, None, None).detect_non_ts_order_by());
    }

    #[test]
    fn test_detect_aggregate_always_false() {
        assert!(
            !mk(vec![ob("duration", OrderBy::Desc)], true, None, None).detect_non_ts_order_by()
        );
    }

    #[test]
    fn test_detect_histogram_always_false() {
        assert!(
            !mk(vec![ob("duration", OrderBy::Desc)], false, Some(60), None)
                .detect_non_ts_order_by()
        );
    }

    #[test]
    fn test_detect_custom_ts_column_returns_false() {
        // stream uses "time" as its timestamp column
        assert!(
            !mk(vec![ob("time", OrderBy::Desc)], false, None, Some("time"))
                .detect_non_ts_order_by()
        );
    }

    #[test]
    fn test_detect_custom_ts_column_other_col_returns_true() {
        assert!(
            mk(
                vec![ob("duration", OrderBy::Desc)],
                false,
                None,
                Some("time")
            )
            .detect_non_ts_order_by()
        );
    }

    #[test]
    fn test_detect_multi_col_first_is_ts_returns_false() {
        // ORDER BY _timestamp DESC, duration ASC — primary is ts → false
        let order_by = vec![
            ob("_timestamp", OrderBy::Desc),
            ob("duration", OrderBy::Asc),
        ];
        assert!(!mk(order_by, false, None, None).detect_non_ts_order_by());
    }

    #[test]
    fn test_detect_multi_col_first_is_non_ts_returns_true() {
        // ORDER BY duration DESC, _timestamp DESC — primary is non-ts → true
        // secondary _timestamp is ignored (known limitation: ties break arbitrarily)
        let order_by = vec![
            ob("duration", OrderBy::Desc),
            ob("_timestamp", OrderBy::Desc),
        ];
        assert!(mk(order_by, false, None, None).detect_non_ts_order_by());
    }

    // ── SQL-parsing integration tests (via ColumnVisitor + is_complex_query) ──

    #[test]
    fn test_detect_sql_multi_col_non_ts_primary() {
        // ORDER BY duration DESC, _timestamp DESC — primary non-ts → true
        // _timestamp as secondary is honored by the heap but irrelevant for detection
        let sql = "SELECT * FROM logs ORDER BY duration DESC, _timestamp DESC";
        let order_by = parse_order_by(sql);
        assert_eq!(order_by[0].0, "duration");
        assert_eq!(order_by[1].0, "_timestamp");
        assert!(mk(order_by, false, None, None).detect_non_ts_order_by());
    }

    #[test]
    fn test_detect_sql_multi_col_ts_primary() {
        // ORDER BY _timestamp DESC, duration DESC — primary ts → false
        let sql = "SELECT * FROM logs ORDER BY _timestamp DESC, duration DESC";
        let order_by = parse_order_by(sql);
        assert_eq!(order_by[0].0, "_timestamp");
        assert!(!mk(order_by, false, None, None).detect_non_ts_order_by());
    }

    #[test]
    fn test_detect_sql_three_col_non_ts_primary() {
        // ORDER BY total_amt DESC, status ASC, _timestamp DESC — primary non-ts → true
        let sql = "SELECT * FROM logs ORDER BY total_amt DESC, status ASC, _timestamp DESC";
        let order_by = parse_order_by(sql);
        assert_eq!(order_by[0].0, "total_amt");
        assert_eq!(order_by.len(), 3);
        assert!(mk(order_by, false, None, None).detect_non_ts_order_by());
    }

    #[test]
    fn test_detect_sql_aggregate_with_count_order() {
        // is_complex_query returns true for GROUP BY → detect always false
        let sql = "SELECT count(*), status FROM logs GROUP BY status ORDER BY count(*) DESC";
        let is_complex = config::utils::sql::is_complex_query(sql).unwrap_or(false);
        assert!(is_complex, "GROUP BY query must be detected as complex");
        let order_by = parse_order_by(sql);
        assert!(!mk(order_by, is_complex, None, None).detect_non_ts_order_by());
    }

    #[test]
    fn test_detect_sql_join_is_complex_short_circuits() {
        // is_complex_query returns true for JOINs → detect always false regardless of ORDER BY
        let sql = "SELECT a.duration, b.name FROM logs a \
                   JOIN users b ON a.user_id = b.id \
                   ORDER BY duration DESC";
        let is_complex = config::utils::sql::is_complex_query(sql).unwrap_or(false);
        assert!(is_complex, "JOIN query must be detected as complex");
        let order_by = parse_order_by(sql);
        assert!(!mk(order_by, is_complex, None, None).detect_non_ts_order_by());
    }

    #[test]
    fn test_detect_sql_subquery_is_complex_short_circuits() {
        // is_complex_query returns true for subqueries → detect always false
        let sql = "SELECT * FROM (SELECT * FROM logs WHERE status = 200) sub \
                   ORDER BY duration DESC";
        let is_complex = config::utils::sql::is_complex_query(sql).unwrap_or(false);
        assert!(is_complex, "subquery must be detected as complex");
        let order_by = parse_order_by(sql);
        assert!(!mk(order_by, is_complex, None, None).detect_non_ts_order_by());
    }

    #[test]
    fn test_detect_sql_cte_outer_ts_order_by() {
        // CTE: pre_visit_query is top-down → outer ORDER BY _timestamp first → false
        let sql = "WITH t AS (SELECT * FROM logs ORDER BY duration DESC) \
                   SELECT * FROM t ORDER BY _timestamp DESC";
        let order_by = parse_order_by(sql);
        assert_eq!(order_by[0].0, "_timestamp");
        assert!(!mk(order_by, false, None, None).detect_non_ts_order_by());
    }

    #[test]
    fn test_detect_sql_cte_outer_non_ts_order_by() {
        // CTE: outer ORDER BY duration first → true
        // Note: is_complex_query may return true for CTEs with subquery body;
        // in that case the complex-query guard fires before this helper.
        let sql = "WITH t AS (SELECT * FROM logs ORDER BY _timestamp DESC) \
                   SELECT * FROM t ORDER BY duration DESC";
        let order_by = parse_order_by(sql);
        assert_eq!(order_by[0].0, "duration");
        assert!(mk(order_by, false, None, None).detect_non_ts_order_by());
    }
}
