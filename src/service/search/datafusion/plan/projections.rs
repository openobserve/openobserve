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

use std::sync::Arc;

use config::datafusion::request::Request;
use datafusion::{
    common::tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
    logical_expr::LogicalPlan,
    prelude::Expr,
};
use hashbrown::HashSet;

use crate::service::search::{
    cache::cacher::handle_histogram,
    cluster::flight::{SearchContextBuilder, register_table},
    sql::Sql,
};

/// Structure to store the result schema info
#[derive(Debug)]
pub struct ResultSchemaExtractor {
    /// field/alias present in top level projection
    pub projections: Vec<String>,
    /// fields/alias used in group by clause.
    /// this will correspond to the same alias (if present)
    /// in the projections
    pub group_by: HashSet<String>,
    /// internal field, used to store intermediate _timestamp field aliases
    timestamp_alias: Option<String>,
    /// internal field, used to store intermediate histogram(_timestamp) aliases
    ts_hist_alias: Option<String>,
    /// alias for the timeseries field present (either histogram(_timestamp) or _timestamp),
    /// with preference to histogram(_timestamp) if present. This will correspond to same alias
    /// (if present) in projections
    pub timeseries: Option<String>,
}

impl ResultSchemaExtractor {
    fn new() -> Self {
        Self {
            projections: Vec::new(),
            group_by: HashSet::new(),
            timestamp_alias: None,
            ts_hist_alias: None,
            timeseries: None,
        }
    }
}

#[inline]
fn get_col_name(expr: &Expr) -> String {
    match expr {
        Expr::Column(col) => col.name.clone(),
        Expr::Alias(alias) => alias.name.clone(),
        _ => expr.schema_name().to_string(),
    }
}

#[inline]
fn is_ts_hist_udf(e: &Expr, ts_alias: &Option<String>) -> bool {
    // currently histogram errors with anything other than _timestamp, as aliasing does not work,
    // even with CTEs, so we can safely hardcode _timestamp here for now
    match e {
        Expr::ScalarFunction(f) => {
            let ts = match ts_alias {
                Some(v) => v.to_string(),
                None => "_timestamp".to_string(),
            };
            f.name() == "histogram" && f.args.first().map(get_col_name) == Some(ts)
        }
        _ => false,
    }
}

impl<'n> TreeNodeVisitor<'n> for ResultSchemaExtractor {
    type Node = LogicalPlan;

    fn f_up(
        &mut self,
        node: &'n Self::Node,
    ) -> Result<TreeNodeRecursion, datafusion::error::DataFusionError> {
        match node {
            LogicalPlan::Projection(proj) => {
                let mut temp = Vec::new();
                for expr in &proj.expr {
                    // we first add the name of this in fields
                    let name = get_col_name(expr);
                    temp.push(name);
                    // Then we process the cases where the timestamp field or
                    // histogram is present or aliased
                    match expr {
                        Expr::Column(col) => {
                            // this can be the case when _timestamp field is not in group by or
                            // aliased, but is present, just as a
                            // column. Not required for histogram, as that will show up as
                            // scalar udf
                            if self.timestamp_alias.is_none() && col.name() == "_timestamp" {
                                self.timestamp_alias = Some("_timestamp".to_string());
                            }
                        }
                        Expr::ScalarFunction(_) => {
                            // this can be the case when we do
                            // ```
                            // select histogram(_timestamp) from "default"
                            // ```
                            // without an alias, or using it in group by clause. In such case,
                            // it shows up as a scalar udf in projection exprs, so we need to handle
                            // and set the ts_hist_alias correctly
                            if is_ts_hist_udf(expr, &self.timestamp_alias)
                                && self.ts_hist_alias.is_none()
                            {
                                self.ts_hist_alias = Some(get_col_name(expr))
                            }
                        }
                        Expr::Alias(alias) => {
                            let original = get_col_name(&alias.expr.clone().unalias_nested().data);

                            // first we check if either of the ts or ts_hist aliases seen before
                            // are re-aliased here. This also covers the case that they are aliased
                            // for the first time after aggregation. In that case we set the alias
                            // to the new name
                            if self.timestamp_alias.as_ref() == Some(&original) {
                                self.timestamp_alias = Some(alias.name.clone());
                            }

                            if self.ts_hist_alias.as_ref() == Some(&original) {
                                self.ts_hist_alias = Some(alias.name.clone());
                            }

                            // then we check for the case where they are not initialized till now,
                            // i.e. they were not in group by clause. If so, we check the original
                            // expr the same way as aggr below, and set the alias values
                            if self.timestamp_alias.is_none() && original == "_timestamp" {
                                self.timestamp_alias = Some(alias.name.clone());
                            }

                            if self.ts_hist_alias.is_none()
                                && is_ts_hist_udf(&alias.expr, &self.timestamp_alias)
                            {
                                self.ts_hist_alias = Some(alias.name.clone());
                            }

                            // finally if any field of group by has been aliased
                            // we remove the original value and add the new alias
                            if self.group_by.contains(&original.to_string()) {
                                self.group_by.remove(&original.to_string());
                                self.group_by.insert(alias.name.clone());
                            }
                        }
                        _ => {}
                    }
                }
                self.projections = temp;
            }
            LogicalPlan::Aggregate(aggr) => {
                let mut temp = HashSet::new();
                for expr in &aggr.group_expr {
                    let name = get_col_name(expr);
                    temp.insert(name);
                    // we need to check if _timestamp or histogram(_timestamp) is there in
                    // aggregates, and if it is, set the alias to its name
                    // because no alias is allowed at group by level, we can be certain
                    // ts col is _timestamp, and is not aliased with some other name
                    let ts = match self.timestamp_alias.as_ref() {
                        Some(v) => v.as_str(),
                        None => "_timestamp",
                    };
                    match expr {
                        Expr::Column(col) => {
                            if col.name() == ts {
                                self.timestamp_alias = Some(col.name.clone())
                            }
                        }
                        Expr::ScalarFunction(_) => {
                            if is_ts_hist_udf(expr, &self.timestamp_alias) {
                                self.ts_hist_alias = Some(get_col_name(expr));
                            }
                        }
                        _ => {}
                    }
                }
                self.group_by = temp;
            }
            _ => {}
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

pub async fn get_result_schema(
    mut sql: Sql,
    is_streaming: bool,
    use_cache: bool,
) -> Result<ResultSchemaExtractor, anyhow::Error> {
    if !is_streaming
        && use_cache
        && let Some(interval) = sql.histogram_interval
    {
        handle_histogram(&mut sql.sql, sql.time_range, interval);
    }

    let sql_arc = Arc::new(sql.clone());
    let ctx = SearchContextBuilder::new()
        .build(&Request::default(), &sql_arc)
        .await?;
    register_table(&ctx, &sql_arc).await?;
    let plan = ctx.state().create_logical_plan(&sql_arc.sql).await?;

    // visit group by fields
    let mut visitor = ResultSchemaExtractor::new();
    plan.visit(&mut visitor)?;

    let mut temp = HashSet::new();
    // filter out duplicates, while retaining the order
    visitor.projections.retain(|f| {
        let t = temp.contains(f);
        temp.insert(f.to_owned());
        // if we have seen this elem already,
        // this instance is duplicate
        !t
    });

    // this is the final timeseries field decision -
    // 1. we should give preference to histogram(_timestamp) when present
    // 2. then we should check if _timestamp is present
    // 3. if neither is in the projections, set it null (default)
    if let Some(alias) = visitor.ts_hist_alias.as_ref()
        && visitor.projections.contains(alias)
    {
        visitor.timeseries = Some(alias.clone());
    } else if let Some(alias) = visitor.timestamp_alias.as_ref()
        && visitor.projections.contains(alias)
    {
        visitor.timeseries = Some(alias.clone());
    }
    Ok(visitor)
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};
    use config::meta::stream::StreamType;
    use proto::cluster_rpc::SearchQuery;

    use super::*;

    macro_rules! hashset {
        {$($v: expr),* $(,)?} => {
            HashSet::from_iter(vec![$($v,)*].into_iter().map(|s|s.to_string()))
        };
    }

    fn get_fields_default() -> Vec<Field> {
        vec![
            Field::new("log", DataType::Utf8, true),
            Field::new("k8s_namespace_name", DataType::Utf8, false),
            Field::new("k8s_node_name", DataType::Utf8, false),
            Field::new("k8s_container_name", DataType::Utf8, false),
            Field::new("k8s_pod_uid", DataType::Utf8, false),
            Field::new("k8s_pod_name", DataType::Utf8, false),
            Field::new("k8s_container_restart_count", DataType::Int32, false),
            Field::new("floatvalue", DataType::Float32, false),
            Field::new("code", DataType::Int16, false),
            Field::new("_timestamp", DataType::Int64, false),
        ]
    }

    fn get_fields_test() -> Vec<Field> {
        vec![
            Field::new("log", DataType::Utf8, true),
            Field::new("kubernetes_namespace_name", DataType::Utf8, false),
            Field::new("kubernetes_node_name", DataType::Utf8, false),
            Field::new("kubernetes_container_name", DataType::Utf8, false),
            Field::new("kubernetes_pod_uid", DataType::Utf8, false),
            Field::new("kubernetes_pod_name", DataType::Utf8, false),
            Field::new("kubernetes_container_restart_count", DataType::Int32, false),
            Field::new("_timestamp", DataType::Int64, false),
        ]
    }

    async fn get_sql(sql: &str) -> Sql {
        let default_schema = Schema::new(get_fields_default());
        let test_schema = Schema::new(get_fields_test());
        infra::db_init().await.unwrap();
        infra::schema::merge(
            "parse_test",
            "default",
            StreamType::Logs,
            &default_schema,
            Some(1752660674351000),
        )
        .await
        .unwrap();

        infra::schema::merge(
            "parse_test",
            "test",
            StreamType::Logs,
            &test_schema,
            Some(1752660674351000),
        )
        .await
        .unwrap();
        let query = SearchQuery {
            sql: sql.to_string(),
            quick_mode: false,
            from: 0,
            size: 100,
            start_time: 0,
            end_time: 0,
            track_total_hits: false,
            query_type: "UI".to_string(),
            uses_zo_fn: false,
            query_fn: "".to_string(),
            skip_wal: false,
            action_id: "".to_string(),
            histogram_interval: 5,
            sampling_ratio: None,
        };
        Sql::new(&query, "parse_test", StreamType::Logs, None)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn test_simple_queries() {
        let sql = r#"WITH FilteredLogs AS (
                    SELECT * FROM "default"
                    WHERE str_match_ignore_case(log, 'err'))
                    SELECT k8s_namespace_name, CAST(array_element(regexp_match(log, 'took: ([0-9]+) ms'), 1) AS INTEGER)
                    FROM FilteredLogs"#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, Some("_timestamp".to_string()));
        assert_eq!(extractor.ts_hist_alias, None);
        assert_eq!(extractor.timestamp_alias, Some("_timestamp".to_string()));
        assert!(extractor.group_by.is_empty());
        assert_eq!(
            extractor.projections,
            vec![
                "_timestamp",
                "k8s_namespace_name",
                "regexp_match(filteredlogs.log,Utf8(\"took: ([0-9]+) ms\"))[Int64(1)]"
            ]
        );

        let sql = r#"select * FROM default 
        WHERE CAST(array_element(regexp_match(log, 'took: ([0-9]+) ms'), 1) AS INTEGER) > 500"#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, Some("_timestamp".to_string()));
        assert_eq!(extractor.ts_hist_alias, None);
        assert_eq!(extractor.timestamp_alias, Some("_timestamp".to_string()));
        assert!(extractor.group_by.is_empty());
        assert_eq!(
            extractor.projections,
            vec![
                "_timestamp",
                "code",
                "floatvalue",
                "k8s_container_name",
                "k8s_container_restart_count",
                "k8s_namespace_name",
                "k8s_node_name",
                "k8s_pod_name",
                "k8s_pod_uid",
                "log"
            ]
        );
    }

    #[tokio::test]
    async fn test_basic_group_by() {
        let sql = r#"select histogram(_timestamp), k8s_namespace_name FROM "default" group by histogram(_timestamp),k8s_namespace_name"#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(
            extractor.timeseries,
            Some("histogram(default._timestamp)".to_string())
        );
        assert_eq!(
            extractor.ts_hist_alias,
            Some("histogram(default._timestamp)".to_string())
        );
        assert_eq!(extractor.timestamp_alias, None);
        assert_eq!(
            extractor.group_by,
            hashset!["histogram(default._timestamp)", "k8s_namespace_name"]
        );
        assert_eq!(
            extractor.projections,
            vec!["histogram(default._timestamp)", "k8s_namespace_name"]
        );

        let sql = r#"select str_match(log,'test') from "default" group by str_match(log,'test')"#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, None);
        assert_eq!(extractor.ts_hist_alias, None);
        assert_eq!(extractor.timestamp_alias, None);
        assert_eq!(
            extractor.group_by,
            hashset!["str_match(default.log,Utf8(\"test\"))"]
        );
        assert_eq!(
            extractor.projections,
            vec!["str_match(default.log,Utf8(\"test\"))"]
        );

        let sql = r#"SELECT histogram(_timestamp), count(_timestamp), k8s_node_name,
            CAST(array_element(regexp_match(log, 'Pulled ([0-9]+) jobs'), 1) AS INTEGER)
            FROM default
            WHERE CAST(array_element(regexp_match(log, 'Pulled ([0-9]+) jobs'), 1) AS INTEGER) > 3     
            GROUP BY histogram(_timestamp), k8s_node_name,
            CAST(array_element(regexp_match(log, 'Pulled ([0-9]+) jobs'), 1) AS INTEGER)
            ORDER BY histogram(_timestamp) ASC"#;

        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(
            extractor.timeseries,
            Some("histogram(default._timestamp)".to_string())
        );
        assert_eq!(
            extractor.ts_hist_alias,
            Some("histogram(default._timestamp)".to_string())
        );
        assert_eq!(extractor.timestamp_alias, None);
        assert_eq!(
            extractor.group_by,
            hashset![
                "histogram(default._timestamp)",
                "k8s_node_name",
                "regexp_match(default.log,Utf8(\"Pulled ([0-9]+) jobs\"))[Int64(1)]"
            ]
        );
        assert_eq!(
            extractor.projections,
            vec![
                "histogram(default._timestamp)",
                "count(default._timestamp)",
                "k8s_node_name",
                "regexp_match(default.log,Utf8(\"Pulled ([0-9]+) jobs\"))[Int64(1)]"
            ]
        );

        let sql = r#"SELECT  'a+b',_timestamp,
        COUNT(CASE WHEN log = 'error' THEN 1 END),
        CAST((COUNT(CASE WHEN log = 'error' THEN 1 END) / (COUNT(*)+1) * 100.0) AS INTEGER) ,
        k8s_namespace_name
        FROM "default" GROUP BY k8s_namespace_name,_timestamp"#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, Some("_timestamp".to_string()));
        assert_eq!(extractor.ts_hist_alias, None);
        assert_eq!(extractor.timestamp_alias, Some("_timestamp".to_string()));
        assert_eq!(
            extractor.group_by,
            hashset!["k8s_namespace_name", "_timestamp"]
        );
        assert_eq!(
            extractor.projections,
            vec![
                "Utf8(\"a+b\")",
                "_timestamp",
                "count(CASE WHEN default.log = Utf8(\"error\") THEN Int64(1) END)",
                "count(CASE WHEN default.log = Utf8(\"error\") THEN Int64(1) END) / count(*) + Int64(1) * Float64(100)",
                "k8s_namespace_name",
            ]
        );
    }

    #[tokio::test]
    async fn test_basic_alias() {
        let sql = r#"select k8s_namespace_name as namespace, _timestamp as ts FROM default"#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, Some("ts".to_string()));
        assert_eq!(extractor.ts_hist_alias, None);
        assert_eq!(extractor.timestamp_alias, Some("ts".to_string()));
        assert!(extractor.group_by.is_empty(),);
        assert_eq!(extractor.projections, vec!["namespace", "ts"]);

        let sql = r#"WITH FilteredLogs AS (
                    SELECT k8s_namespace_name as namespace, _timestamp FROM "default")
                    SELECT namespace as ns, _timestamp as tts
                    FROM FilteredLogs"#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, Some("tts".to_string()));
        assert_eq!(extractor.ts_hist_alias, None);
        assert_eq!(extractor.timestamp_alias, Some("tts".to_string()));
        assert!(extractor.group_by.is_empty(),);
        assert_eq!(extractor.projections, vec!["ns", "tts"]);

        let sql = r#"SELECT histogram(_timestamp) as "x_axis_1", k8s_namespace_name as "x_axis_2", 
        count(k8s_namespace_name) as "y_axis_1" 
        FROM "default" WHERE k8s_namespace_name IN (concat('zinc', '-','cp')) 
        GROUP BY x_axis_1, x_axis_2 ORDER BY
        x_axis_1 ASC"#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, Some("x_axis_1".to_string()));
        assert_eq!(extractor.ts_hist_alias, Some("x_axis_1".to_string()));
        assert_eq!(extractor.timestamp_alias, None);
        assert_eq!(extractor.group_by, hashset!["x_axis_1", "x_axis_2"]);
        assert_eq!(
            extractor.projections,
            vec!["x_axis_1", "x_axis_2", "y_axis_1"]
        );
    }

    #[tokio::test]
    async fn test_basic_joins() {
        let sql = r#"SELECT *
        FROM "default" t1 INNER JOIN "default" t2
        ON t1.k8s_namespace_name = t2.k8s_namespace_name"#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, Some("_timestamp".to_string()));
        assert_eq!(extractor.ts_hist_alias, None);
        assert_eq!(extractor.timestamp_alias, Some("_timestamp".to_string()));
        assert!(extractor.group_by.is_empty());
        assert_eq!(
            extractor.projections,
            vec![
                "_timestamp",
                "code",
                "floatvalue",
                "k8s_container_name",
                "k8s_container_restart_count",
                "k8s_namespace_name",
                "k8s_node_name",
                "k8s_pod_name",
                "k8s_pod_uid",
                "log"
            ]
        );

        let sql = r#"SELECT
                t1.k8s_pod_uid,
                t1.k8s_pod_name,
                count(t1.k8s_node_name),
                count(t1.k8s_container_name),
                count(t1.k8s_container_restart_count)
            FROM
                "default" t1
            INNER JOIN
                "default" t2
            ON
                t1.k8s_namespace_name = t2.k8s_namespace_name
            group by
            t1.k8s_pod_uid,
            t1.k8s_pod_name
            "#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, None);
        assert_eq!(extractor.ts_hist_alias, None);
        assert_eq!(extractor.timestamp_alias, None);
        assert_eq!(extractor.group_by, hashset!["k8s_pod_uid", "k8s_pod_name"]);
        assert_eq!(
            extractor.projections,
            vec![
                "k8s_pod_uid",
                "k8s_pod_name",
                "count(t1.k8s_node_name)",
                "count(t1.k8s_container_name)",
                "count(t1.k8s_container_restart_count)",
            ]
        );
    }

    #[tokio::test]
    async fn test_complex_queries() {
        let sql = r#"SELECT d1.k8s_pod_name, d1.code, COUNT(d1._timestamp) AS log_count,
                AVG(d2.floatvalue) AS avg_floatvalue
                FROM "default" AS d1 JOIN "default" AS d2
                ON d1.k8s_pod_name = d2.k8s_pod_name
                GROUP BY d1.k8s_pod_name, d1.code
                UNION ALL
                SELECT d2.k8s_pod_name, d2.code, COUNT(d2._timestamp) AS log_count,
                AVG(d1.floatvalue) AS avg_floatvalue
                FROM "default" AS d2 JOIN "default"
                AS d1 ON d2.k8s_pod_name = d1.k8s_pod_name
                GROUP BY d2.k8s_pod_name, d2.code"#;

        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, None);
        assert_eq!(extractor.ts_hist_alias, None);
        assert_eq!(extractor.timestamp_alias, None);
        assert_eq!(extractor.group_by, hashset!["k8s_pod_name", "code"]);
        assert_eq!(
            extractor.projections,
            vec!["k8s_pod_name", "code", "log_count", "avg_floatvalue",]
        );

        let sql = r#"with test as (SELECT histogram(_timestamp) as h,
        k8s_namespace_name as k,
        _timestamp as ts,
        count(k8s_namespace_name) as c
        FROM "default" WHERE k8s_namespace_name IN (concat('zinc', '-','cp'))
        GROUP BY _timestamp, k8s_namespace_name ORDER BY histogram(_timestamp) ASC)
        select h,c,k, ts as tts from test"#;

        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, Some("h".to_string()));
        assert_eq!(extractor.ts_hist_alias, Some("h".to_string()));
        assert_eq!(extractor.timestamp_alias, Some("tts".to_string()));
        assert_eq!(extractor.group_by, hashset!["tts", "k"]);
        assert_eq!(extractor.projections, vec!["h", "c", "k", "tts"]);

        let sql = r#"WITH pulled_jobs_logs AS (
                SELECT 
                    _timestamp AS "log_time",
                    k8s_node_name AS "node_name",
                    CAST(array_element(regexp_match(log, 'Pulled ([0-9]+) jobs'), 1) AS INTEGER) AS "pulled_jobs"
                FROM default
                WHERE CAST(array_element(regexp_match(log, 'Pulled ([0-9]+) jobs'), 1) AS INTEGER) > 3
                )
                SELECT
                histogram(log_time) AS "time_bucket",
                COUNT(log_time) AS "logs_count",
                node_name AS "node_name",
                pulled_jobs AS "pulled_jobs"
                FROM pulled_jobs_logs
                GROUP BY time_bucket, node_name, pulled_jobs
                ORDER BY time_bucket ASC"#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, Some("time_bucket".to_string()));
        assert_eq!(extractor.ts_hist_alias, Some("time_bucket".to_string()));
        assert_eq!(extractor.timestamp_alias, Some("log_time".to_string()));
        assert_eq!(
            extractor.group_by,
            hashset!["time_bucket", "node_name", "pulled_jobs"]
        );
        assert_eq!(
            extractor.projections,
            vec!["time_bucket", "logs_count", "node_name", "pulled_jobs"]
        );

        let sql = r#"WITH ErrorLogs AS (
                SELECT 
                    COALESCE(k8s_container_name, 'Unknown Container') AS container,
                    COUNT(*) AS error_count
                FROM "default"
                GROUP BY container
            )
            SELECT * 
            FROM ErrorLogs
            WHERE error_count > 10"#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, None);
        assert_eq!(extractor.ts_hist_alias, None);
        assert_eq!(extractor.timestamp_alias, None);
        assert_eq!(extractor.group_by, hashset!["container"]);
        assert_eq!(extractor.projections, vec!["container", "error_count"]);

        let sql = r#"SELECT 
        a.k8s_namespace_name AS "a", b.kubernetes_namespace_name AS "b"
        FROM "default" AS a
        FULL OUTER JOIN "test" AS b
        ON a.k8s_namespace_name = b.kubernetes_namespace_name"#;
        let parsed = get_sql(sql).await;
        let extractor = get_result_schema(parsed, false, false).await.unwrap();
        assert_eq!(extractor.timeseries, None);
        assert_eq!(extractor.ts_hist_alias, None);
        assert_eq!(extractor.timestamp_alias, None);
        assert!(extractor.group_by.is_empty());
        assert_eq!(extractor.projections, vec!["a", "b"]);
    }
}
