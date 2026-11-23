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
        sql::{is_complex_query, is_eligible_for_histogram, is_explain_query, is_time_splittable},
    },
};
use infra::errors::Error;
use proto::cluster_rpc;

use crate::{
    cache::{cacher::get_ts_col_order_by, result_utils::is_ts_order_field},
    partition::aggregate::{
        is_ranked_by_non_ts_column, is_ranked_histogram, is_streaming_aggregate,
    },
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
    pub is_ranked_by_non_ts: bool,
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
        let is_ranked_by_non_ts = is_ranked_by_non_ts_column(&sql, ts_column.as_deref());
        let is_streaming_agg = is_streaming_aggregate(
            &req.sql,
            ts_column.as_deref(),
            is_ranked_histogram(&sql, ts_column.as_deref()),
        );
        let apply_over_hits = req.query_fn.as_ref().is_some_and(|v| {
            !v.is_empty()
                && RESULT_ARRAY.is_match(&base64::decode_url(v).unwrap_or_else(|_| v.to_string()))
        });

        // Non-UTC aggregates cannot share the persistent state that merges partition results.
        // Time slices are concatenated, so a non-time ranking needs one slice or the agg cache.
        let use_single_partition = is_explain
            || !is_time_splittable(&req.sql).unwrap_or(false)
            || (is_streaming_agg && sql.histogram_offset != Some(0))
            || ((ts_column.is_none() || apply_over_hits || is_ranked_by_non_ts)
                && !(req.streaming_output && is_streaming_agg));

        let is_histogram_eligible = is_eligible_for_histogram(&req.sql, false).unwrap_or(false);

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
            is_ranked_by_non_ts,
            use_single_partition,
            is_histogram_eligible,
            sql_order_by,
        })
    }
}

#[cfg(test)]
mod tests {
    use config::meta::stream::StreamType;

    use super::*;

    // ── streaming aggregation cache admission ─────────────────────────────────

    async fn ctx_for(sql: &str, timezone: Option<&str>) -> PartitionSqlContext {
        ctx_with_output(sql, timezone, true).await
    }

    async fn ctx_with_output(
        sql: &str,
        timezone: Option<&str>,
        streaming_output: bool,
    ) -> PartitionSqlContext {
        use arrow_schema::{DataType, Field, Schema};
        let schema = Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("service", DataType::Utf8, true),
            Field::new("duration", DataType::Int64, true),
        ]);
        infra::db_init().await.unwrap();
        infra::schema::merge(
            "ranked_hist_test",
            "default",
            StreamType::Logs,
            &schema,
            Some(1_700_000_000_000_000),
        )
        .await
        .unwrap();
        let req = SearchPartitionRequest {
            sql: sql.to_string(),
            start_time: 1_700_000_000_000_000,
            end_time: 1_700_086_400_000_000,
            encoding: Default::default(),
            regions: vec![],
            clusters: vec![],
            query_fn: None,
            streaming_output,
            histogram_interval: 0,
            sampling_ratio: None,
            search_type: None,
            timezone: timezone.map(str::to_string),
            raw_streams: None,
        };
        PartitionSqlContext::new(&req, "ranked_hist_test", StreamType::Logs)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn test_ranked_histogram_uses_streaming_aggs() {
        for sql in [
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY c DESC LIMIT 3"#,
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY c ASC LIMIT 3"#,
            r#"SELECT histogram(_timestamp, '1 hour') AS ts, service, count(*) AS c FROM "default" GROUP BY ts, service ORDER BY c DESC, ts DESC LIMIT 5"#,
            r#"SELECT histogram(_timestamp) AS "x_axis_1", count(*) AS "y_axis_1" FROM "default" GROUP BY "x_axis_1" ORDER BY "y_axis_1" DESC"#,
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY 2 DESC LIMIT 3"#,
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY count(*) DESC, 1 LIMIT 3"#,
        ] {
            let ctx = ctx_for(sql, None).await;
            assert!(ctx.ts_column.is_some(), "{sql}");
            assert!(ctx.is_streaming_aggregate, "{sql}");
            assert!(!ctx.use_single_partition, "{sql}");
        }
    }

    #[tokio::test]
    async fn test_non_ts_order_by_uses_single_partition() {
        for sql in [
            r#"SELECT * FROM "default" ORDER BY duration DESC"#,
            r#"SELECT * FROM "default" ORDER BY duration ASC, _timestamp DESC"#,
            r#"SELECT _timestamp, duration FROM "default" ORDER BY duration DESC"#,
            r#"SELECT _timestamp, duration FROM "default" ORDER BY 2 DESC"#,
            r#"SELECT _timestamp AS t, duration AS d FROM "default" ORDER BY d DESC, t DESC"#,
        ] {
            let ctx = ctx_for(sql, None).await;
            assert!(ctx.use_single_partition, "{sql}");
        }
    }

    #[tokio::test]
    async fn test_cross_slice_query_uses_single_partition() {
        for sql in [
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" WHERE service IN (SELECT service FROM "default" WHERE duration > 10) GROUP BY ts ORDER BY ts"#,
            r#"SELECT histogram(_timestamp, '1 day') AS ts, sum(count(*)) OVER (ORDER BY histogram(_timestamp, '1 day')) AS cum FROM "default" GROUP BY ts ORDER BY ts"#,
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) * 100 / sum(count(*)) OVER () AS pct FROM "default" GROUP BY ts ORDER BY ts"#,
            r#"SELECT histogram(a._timestamp, '1 day') AS ts, count(*) AS c FROM "default" a JOIN "default" b ON a.service = b.service GROUP BY ts ORDER BY ts"#,
            r#"SELECT * FROM "default" ORDER BY _timestamp DESC LIMIT 10 OFFSET 5"#,
        ] {
            for streaming_output in [true, false] {
                let ctx = ctx_with_output(sql, None, streaming_output).await;
                assert!(ctx.use_single_partition, "{sql}");
            }
        }
    }

    #[tokio::test]
    async fn test_ranked_histogram_off_streaming_aggs_uses_single_partition() {
        for sql in [
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY c DESC LIMIT 3"#,
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY 2 DESC LIMIT 3"#,
        ] {
            let ctx = ctx_with_output(sql, None, false).await;
            assert!(ctx.is_streaming_aggregate, "{sql}");
            assert!(ctx.use_single_partition, "{sql}");
        }
    }

    #[tokio::test]
    async fn test_time_ordered_query_keeps_partitions() {
        for sql in [
            r#"SELECT * FROM "default" ORDER BY _timestamp DESC"#,
            r#"SELECT * FROM "default" ORDER BY _timestamp ASC, duration DESC"#,
            r#"SELECT _timestamp, duration FROM "default" ORDER BY 1 DESC"#,
            r#"SELECT _timestamp AS t, duration FROM "default" ORDER BY _timestamp DESC"#,
            r#"SELECT _timestamp AS t, duration FROM "default" ORDER BY t ASC"#,
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY ts DESC"#,
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY 1 ASC, 2 DESC LIMIT 3"#,
        ] {
            for streaming_output in [true, false] {
                let ctx = ctx_with_output(sql, None, streaming_output).await;
                assert!(ctx.ts_column.is_some(), "{sql}");
                assert!(!ctx.use_single_partition, "{sql}");
            }
        }
    }

    #[tokio::test]
    async fn test_time_ordered_histogram_keeps_result_cache() {
        for sql in [
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY ts DESC"#,
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY ts ASC, c DESC LIMIT 3"#,
            r#"SELECT histogram(_timestamp) AS "x_axis_1", count(*) AS "y_axis_1" FROM "default" GROUP BY "x_axis_1" ORDER BY "x_axis_1" ASC"#,
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts"#,
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY 1 DESC"#,
            r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY 1 ASC, 2 DESC LIMIT 3"#,
        ] {
            let ctx = ctx_for(sql, None).await;
            assert!(ctx.ts_column.is_some(), "{sql}");
            assert!(!ctx.is_streaming_aggregate, "{sql}");
        }
    }

    #[tokio::test]
    async fn test_histogram_cardinality_skips_time_column() {
        let sql = r#"SELECT histogram(_timestamp, '1 hour') AS ts, service, count(*) AS c FROM "default" GROUP BY ts, service ORDER BY c DESC LIMIT 5"#;
        let ctx = ctx_for(sql, None).await;
        let raw = crate::sql::visitor::group_by::get_group_by_fields(&ctx.sql)
            .await
            .unwrap();
        assert!(raw.contains(&TIMESTAMP_COL_NAME.to_string()), "{raw:?}");
        let fields = crate::partition::aggregate::cardinality_fields(&ctx.sql)
            .await
            .unwrap();
        assert_eq!(fields, vec!["service".to_string()]);

        let sql = r#"SELECT histogram(_timestamp, '1 hour') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY c DESC LIMIT 5"#;
        let ctx = ctx_for(sql, None).await;
        let fields = crate::partition::aggregate::cardinality_fields(&ctx.sql)
            .await
            .unwrap();
        assert!(fields.is_empty(), "{fields:?}");
    }

    #[tokio::test]
    async fn test_ranked_histogram_non_utc_skips_streaming_aggs() {
        let sql = r#"SELECT histogram(_timestamp, '1 day') AS ts, count(*) AS c FROM "default" GROUP BY ts ORDER BY c DESC LIMIT 3"#;
        let ctx = ctx_for(sql, Some("Asia/Kolkata")).await;
        assert_ne!(ctx.sql.histogram_offset, Some(0));
        assert!(ctx.use_single_partition);
        let req = SearchPartitionRequest {
            sql: sql.to_string(),
            start_time: 1_700_000_000_000_000,
            end_time: 1_700_086_400_000_000,
            encoding: Default::default(),
            regions: vec![],
            clusters: vec![],
            query_fn: None,
            streaming_output: true,
            histogram_interval: 0,
            sampling_ratio: None,
            search_type: None,
            timezone: Some("Asia/Kolkata".to_string()),
            raw_streams: None,
        };
        let (streaming_aggs, streaming_id, strategy) =
            crate::partition::aggregate::prepare_streaming_aggregate(
                "t",
                &req,
                &ctx,
                &Default::default(),
                true,
            )
            .await
            .unwrap();
        assert!(!streaming_aggs);
        assert!(streaming_id.is_none());
        assert!(strategy.is_none());
    }
}
