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
use proto::cluster_rpc;

use crate::{
    cache::{cacher::get_ts_col_order_by, result_utils::is_ts_order_field},
    partition::aggregate::is_streaming_aggregate,
    sql::Sql,
};

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
            timezone: req.timezone.clone(),
            ..Default::default()
        };
        let sql = Sql::new(&query, org_id, stream_type, None).await?;

        let is_explain = is_explain_query(&req.sql);
        let is_complex = is_complex_query(&req.sql).unwrap_or(false);
        let ts_column = get_ts_col_order_by(&sql, TIMESTAMP_COL_NAME, is_complex).map(|(v, _)| v);
        let is_streaming_agg = is_streaming_aggregate(&req.sql, ts_column.as_deref());
        let apply_over_hits = req.query_fn.as_ref().is_some_and(|v| {
            !v.is_empty()
                && RESULT_ARRAY.is_match(&base64::decode_url(v).unwrap_or_else(|_| v.to_string()))
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
                if ts_column
                    .as_deref()
                    .is_some_and(|ts| is_ts_order_field(field, ts, &sql.aliases))
                    && order_by == &OrderBy::Asc
                {
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
    use crate::sql::Sql;

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
                histogram_offset: Some(0),
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

    async fn execute_timezone_query(sql: &Sql, timestamp: i64) -> Vec<i64> {
        use std::sync::Arc;

        use ::search::datafusion::{
            optimizer::rewrite_histogram::RewriteHistogram, udf::time::histogram,
        };
        use arrow::{
            array::{Int64Array, TimestampMicrosecondArray},
            record_batch::RecordBatch,
        };
        use arrow_schema::{DataType, Field, Schema};
        use datafusion::{datasource::MemTable, prelude::SessionContext};
        let schema = Arc::new(Schema::new(vec![Field::new(
            "_timestamp",
            DataType::Int64,
            false,
        )]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int64Array::from(vec![timestamp]))],
        )
        .unwrap();
        let ctx = SessionContext::new();
        ctx.register_table(
            "t",
            Arc::new(MemTable::try_new(schema, vec![vec![batch]]).unwrap()),
        )
        .unwrap();
        ctx.register_udf(histogram::HISTOGRAM_UDF.clone());
        ctx.add_optimizer_rule(Arc::new(RewriteHistogram::new(
            sql.time_range.0,
            sql.time_range.1,
            sql.histogram_interval.unwrap_or_default(),
            sql.timezone.clone(),
        )));
        let batches = ctx.sql(&sql.sql).await.unwrap().collect().await.unwrap();
        batches[0]
            .columns()
            .iter()
            .filter_map(|column| {
                column
                    .as_any()
                    .downcast_ref::<TimestampMicrosecondArray>()
                    .map(|array| array.value(0))
            })
            .collect()
    }

    #[tokio::test]
    async fn timezone_non_literal_argument_is_rejected() {
        use arrow_schema::{DataType, Field, Schema};
        use infra::schema::{STREAM_SCHEMAS_LATEST, SchemaCache};
        let org = "timezone_non_literal";
        STREAM_SCHEMAS_LATEST.write().await.insert(
            format!("{org}/logs/t"),
            SchemaCache::new(Schema::new(vec![Field::new(
                "_timestamp",
                DataType::Int64,
                false,
            )])),
        );
        let req: SearchPartitionRequest = serde_json::from_value(serde_json::json!({
            "sql": "SELECT histogram(_timestamp, '1 day', CAST('+05:30' AS VARCHAR)) AS ts, count(*) FROM t GROUP BY ts",
            "start_time": 1, "end_time": 2, "timezone": "UTC"
        }))
        .unwrap();
        assert!(
            PartitionSqlContext::new(&req, org, StreamType::Logs)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn timezone_mixed_offsets_use_one_partition() {
        use arrow_schema::{DataType, Field, Schema};
        use infra::schema::{STREAM_SCHEMAS_LATEST, SchemaCache};
        const DAY: i64 = 86_400_000_000;
        const START: i64 = 1_757_376_000_000_000;
        let org = "timezone_mixed_partitions";
        STREAM_SCHEMAS_LATEST.write().await.insert(
            format!("{org}/logs/t"),
            SchemaCache::new(Schema::new(vec![Field::new(
                "_timestamp",
                DataType::Int64,
                false,
            )])),
        );
        let req: SearchPartitionRequest = serde_json::from_value(serde_json::json!({
            "sql": "SELECT histogram(_timestamp, '1 day', 'UTC') AS a, histogram(_timestamp, '1 day', '+05:30') AS b, count(*) FROM t GROUP BY a, b",
            "start_time": START, "end_time": START + 3 * DAY, "histogram_interval": 86400
        }))
        .unwrap();
        let ctx = PartitionSqlContext::new(&req, org, StreamType::Logs)
            .await
            .unwrap();
        assert_eq!(ctx.sql.histogram_offset, None);
        let settings = crate::partition::settings::PartitionSettings {
            min_step: DAY,
            step: DAY,
        };
        assert_eq!(
            crate::partition::generate_partitions(&ctx, &settings),
            vec![[START, START + 3 * DAY]]
        );
    }

    #[tokio::test]
    async fn timezone_later_named_argument_stays_fixed_across_delta_end() {
        use arrow_schema::{DataType, Field, Schema};
        use infra::schema::{STREAM_SCHEMAS_LATEST, SchemaCache};
        const JANUARY: i64 = 1_767_225_600_000_000;
        const JULY: i64 = 1_782_864_000_000_000;
        let org = "timezone_later_named_argument";
        STREAM_SCHEMAS_LATEST.write().await.insert(
            format!("{org}/logs/t"),
            SchemaCache::new(Schema::new(vec![Field::new(
                "_timestamp",
                DataType::Int64,
                false,
            )])),
        );
        let mut request = config::meta::search::Request::default();
        request.query.sql = "SELECT histogram(_timestamp, '1 day') AS first, histogram(_timestamp, '1 day', 'America/Los_Angeles') AS second, count(*) FROM t GROUP BY first, second".to_string();
        request.query.start_time = JANUARY;
        request.query.end_time = JULY;
        request.query.timezone = Some("America/Los_Angeles".to_string());
        request.query.histogram_interval = 86400;
        crate::cache::prepare_cache_response("later", org, StreamType::Logs, &mut request, true)
            .await
            .unwrap();
        request.query.end_time = JANUARY + 8 * 3_600_000_000;
        let ctx = PartitionSqlContext::new(
            &SearchPartitionRequest::from(&request),
            org,
            StreamType::Logs,
        )
        .await
        .unwrap();
        let labels = execute_timezone_query(&ctx.sql, JANUARY + 27_000_000_000).await;
        assert_eq!(labels, vec![JANUARY, JANUARY]);
    }

    #[tokio::test]
    async fn timezone_partitions_keep_bucket_counts_whole() {
        use arrow_schema::{DataType, Field, Schema};
        use infra::schema::{STREAM_SCHEMAS_LATEST, SchemaCache};
        STREAM_SCHEMAS_LATEST.write().await.insert(
            "timezone_partition/logs/t".to_string(),
            SchemaCache::new(Schema::new(vec![Field::new(
                "_timestamp",
                DataType::Int64,
                false,
            )])),
        );
        const HOUR: i64 = 3_600_000_000;
        const DAY: i64 = 24 * HOUR;
        let start = 1_757_376_000_000_000;
        let end = start + 3 * DAY;
        for (zone, offset) in [("+05:30", 11 * HOUR / 2), ("-08:00", -8 * HOUR), ("UTC", 0)] {
            let req: SearchPartitionRequest = serde_json::from_value(serde_json::json!({
                "sql": "SELECT histogram(_timestamp, '1 day') AS ts, count(*) FROM t GROUP BY ts",
                "start_time": start, "end_time": end, "timezone": zone,
                "histogram_interval": 86400
            }))
            .unwrap();
            let ctx = PartitionSqlContext::new(&req, "timezone_partition", StreamType::Logs)
                .await
                .unwrap();
            assert_eq!(ctx.sql.histogram_offset, Some(offset));
            assert_eq!(ctx.sql.timezone.as_deref(), Some(zone));
            let settings = crate::partition::settings::PartitionSettings {
                min_step: DAY,
                step: DAY,
            };
            let mut partitions = crate::partition::generate_partitions(&ctx, &settings);
            partitions.sort();
            assert_eq!(partitions.first().unwrap()[0], start);
            assert_eq!(partitions.last().unwrap()[1], end);
            for pair in partitions.windows(2) {
                assert_eq!(pair[0][1], pair[1][0]);
                assert_eq!(
                    config::meta::histogram_origin::histogram_bucket_offset(
                        pair[0][1] + offset,
                        DAY
                    ),
                    0,
                    "{zone}: {partitions:?}"
                );
            }
            let mut bucket_partitions = std::collections::BTreeMap::new();
            let mut partitioned_counts = std::collections::BTreeMap::new();
            let mut full_counts = std::collections::BTreeMap::new();
            for ts in (start..end).step_by(HOUR as usize) {
                let key = ts + offset
                    - config::meta::histogram_origin::histogram_bucket_offset(ts + offset, DAY);
                *full_counts.entry(key).or_insert(0) += 1;
                let part = partitions
                    .iter()
                    .position(|[a, b]| ts >= *a && ts < *b)
                    .unwrap();
                if let Some(previous) = bucket_partitions.insert(key, part) {
                    assert_eq!(previous, part, "{zone}: bucket {key} split");
                }
                *partitioned_counts.entry(key).or_insert(0) += 1;
            }
            assert_eq!(partitioned_counts, full_counts);
        }
    }

    // Helper: parse SQL string → run ColumnVisitor → return order_by vec.
    // Uses empty schemas so no schema resolution happens, which is fine for
    // ORDER BY extraction (pre_visit_query doesn't touch schemas).
    fn parse_order_by(sql_str: &str) -> Vec<(String, OrderBy)> {
        use ::datafusion::common::TableReference;
        use hashbrown::HashMap;
        use sqlparser::{ast::VisitMut, dialect::GenericDialect, parser::Parser};

        use crate::sql::visitor::column::ColumnVisitor;

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
