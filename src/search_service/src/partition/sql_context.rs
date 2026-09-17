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
    cache::cacher::{get_ts_col_order_by, time_direction},
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
                && !(req.streaming_output && is_streaming_agg))
            || order_by_merge(&sql, is_complex, ts_column.as_deref())
                == OrderByMerge::SinglePartition;

        let (is_histogram_eligible, _) =
            is_eligible_for_histogram(&req.sql, false).unwrap_or((false, false));

        let sql_order_by = time_direction(&sql).unwrap_or(OrderBy::Desc);

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

    pub fn order_by_merge(&self) -> OrderByMerge {
        order_by_merge(&self.sql, self.is_complex_query, self.ts_column.as_deref())
    }
}

/// How the leader combines partition results, decided by the primary ORDER BY key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrderByMerge {
    ByTime,
    ByHeap,
    SinglePartition,
}

fn order_by_merge(sql: &Sql, is_complex: bool, ts_column: Option<&str>) -> OrderByMerge {
    let Some((first, _)) = sql.order_by.first() else {
        return OrderByMerge::ByTime;
    };
    if is_complex
        || sql.histogram_interval.is_some()
        || sql.is_timestamp_key(first)
        || ts_column == Some(first.as_str())
    {
        return OrderByMerge::ByTime;
    }
    // The heap merges by hit fields, so every key has to be a projected column.
    let has_wildcard = sql.projection.iter().any(|col| col == "*");
    let projected = |key: &String| {
        sql.projection.contains(key)
            || (has_wildcard && sql.schemas.values().any(|s| s.contains_field(key)))
    };
    if sql.order_by.iter().all(|(key, _)| projected(key)) {
        OrderByMerge::ByHeap
    } else {
        OrderByMerge::SinglePartition
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
                projection: vec![],
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

    fn with_projection(mut ctx: PartitionSqlContext, projection: &[&str]) -> PartitionSqlContext {
        use arrow_schema::{DataType, Field, Schema};
        ctx.sql.projection = projection.iter().map(|s| s.to_string()).collect();
        ctx.sql.schemas.insert(
            ::datafusion::common::TableReference::from("t"),
            std::sync::Arc::new(infra::schema::SchemaCache::new(Schema::new(vec![
                Field::new("_timestamp", DataType::Int64, false),
                Field::new("duration", DataType::Int64, false),
            ]))),
        );
        ctx
    }

    #[test]
    fn test_no_order_by_or_timestamp_primary_merges_by_time() {
        use OrderByMerge::ByTime;
        assert_eq!(mk(vec![], false, None, None).order_by_merge(), ByTime);
        let ctx = mk(vec![ob("_timestamp", OrderBy::Desc)], false, None, None);
        assert_eq!(ctx.order_by_merge(), ByTime);
        let order_by = vec![
            ob("_timestamp", OrderBy::Asc),
            ob("duration + 1", OrderBy::Asc),
        ];
        assert_eq!(mk(order_by, false, None, None).order_by_merge(), ByTime);
        let ctx = mk(vec![ob("time", OrderBy::Desc)], false, None, Some("time"));
        assert_eq!(ctx.order_by_merge(), ByTime);
        let mut ctx = mk(vec![ob("ts", OrderBy::Asc)], false, None, None);
        ctx.sql.aliases = vec![("_timestamp".to_string(), "ts".to_string())];
        assert_eq!(ctx.order_by_merge(), ByTime);
    }

    #[test]
    fn test_complex_and_histogram_queries_merge_by_time() {
        use OrderByMerge::ByTime;
        let ctx = with_projection(
            mk(vec![ob("duration", OrderBy::Desc)], true, None, None),
            &["*"],
        );
        assert_eq!(ctx.order_by_merge(), ByTime);
        let ctx = mk(vec![ob("duration", OrderBy::Desc)], false, Some(60), None);
        assert_eq!(ctx.order_by_merge(), ByTime);
        let order_by =
            parse_order_by("SELECT count(*) AS cnt, name FROM t GROUP BY name ORDER BY cnt DESC");
        assert_eq!(mk(order_by, true, None, None).order_by_merge(), ByTime);
    }

    #[test]
    fn test_projected_non_ts_order_by_merges_by_heap() {
        use OrderByMerge::ByHeap;
        let order_by = vec![
            ob("duration", OrderBy::Desc),
            ob("_timestamp", OrderBy::Desc),
        ];
        let ctx = with_projection(mk(order_by.clone(), false, None, None), &["*"]);
        assert_eq!(ctx.order_by_merge(), ByHeap);
        let ctx = with_projection(
            mk(order_by, false, None, Some("time")),
            &["duration", "_timestamp"],
        );
        assert_eq!(ctx.order_by_merge(), ByHeap);
        let order_by = parse_order_by(
            "WITH t AS (SELECT * FROM logs) SELECT duration FROM t ORDER BY duration ASC",
        );
        let ctx = with_projection(mk(order_by, false, None, None), &["duration"]);
        assert_eq!(ctx.order_by_merge(), ByHeap);
    }

    #[test]
    fn test_unprojected_or_expression_order_by_uses_single_partition() {
        use OrderByMerge::SinglePartition;
        // duration is a stream column but not projected, so the rows will not carry it
        let ctx = mk(vec![ob("duration", OrderBy::Desc)], false, None, None);
        let ctx = with_projection(ctx, &["_timestamp", "message"]);
        assert_eq!(ctx.order_by_merge(), SinglePartition);
        let ctx = mk(vec![ob("duration + 1", OrderBy::Desc)], false, None, None);
        assert_eq!(
            with_projection(ctx, &["*"]).order_by_merge(),
            SinglePartition
        );
        let order_by = vec![
            ob("duration", OrderBy::Desc),
            ob("lower(name)", OrderBy::Asc),
        ];
        let ctx = with_projection(mk(order_by, false, None, None), &["*"]);
        assert_eq!(ctx.order_by_merge(), SinglePartition);
    }
}
