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
use std::{collections::HashMap, sync::Arc};

use config::{datafusion::request::Request, meta::projections::ProjectionColumnMapping};
use datafusion::common::tree_node::TreeNode;

use crate::service::search::{
    cluster::flight::{SearchContextBuilder, register_table},
    sql::Sql,
};

pub async fn get_columns_from_projections(
    sql: Sql,
) -> Result<HashMap<String, Vec<ProjectionColumnMapping>>, anyhow::Error> {
    let sql_arc = Arc::new(sql.clone());
    let ctx = SearchContextBuilder::new()
        .build(&Request::default(), &sql_arc)
        .await?;
    register_table(&ctx, &sql_arc).await?;
    let plan = ctx.state().create_logical_plan(&sql_arc.sql).await?;

    let mut extractor =
        o2_enterprise::enterprise::search::projection_utils::OutputColumnExtractor::default();
    plan.visit(&mut extractor)?;

    Ok(extractor.projection_mappings)
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};
    use config::meta::stream::StreamType;
    use proto::cluster_rpc::SearchQuery;

    use super::*;

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

    fn get_fields_t2() -> Vec<Field> {
        vec![
            Field::new("k8s_namespace_name", DataType::Utf8, false),
            Field::new("k8s_pod_name", DataType::Utf8, false),
            Field::new("floatvalue", DataType::Float32, false),
        ]
    }

    async fn get_sql(sql: &str) -> Sql {
        // Use a simple static flag to initialize only once
        use std::sync::atomic::{AtomicBool, Ordering};
        static INITIALIZED: AtomicBool = AtomicBool::new(false);

        if !INITIALIZED.load(Ordering::Relaxed) {
            let default_schema = Schema::new(get_fields_default());
            let t2_schema = Schema::new(get_fields_t2());

            // Only initialize if not already done
            if INITIALIZED
                .compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed)
                .is_ok()
            {
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
                    "t2",
                    StreamType::Logs,
                    &t2_schema,
                    Some(1752660674351000),
                )
                .await
                .unwrap();
            }
        }

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
    async fn test_simple_projection() {
        let sql = "SELECT k8s_namespace_name, k8s_node_name FROM \"default\"";
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();
        assert!(
            !res.is_empty(),
            "Expected at least 1 table but got empty result"
        );

        // For simple queries, we should have mappings grouped by table name
        let mappings = res.get("default").unwrap();

        let namespace_mapping = mappings
            .iter()
            .find(|m| m.output_field == "k8s_namespace_name")
            .unwrap();
        assert!(
            namespace_mapping
                .source_columns
                .contains("k8s_namespace_name")
        );
        let node_mapping = mappings
            .iter()
            .find(|m| m.output_field == "k8s_node_name")
            .unwrap();
        assert!(node_mapping.source_columns.contains("k8s_node_name"));
    }

    #[tokio::test]
    async fn test_aliased_columns() {
        let sql = "SELECT k8s_namespace_name AS namespace, k8s_node_name AS node FROM \"default\"";
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();
        let mappings = res.get("default").unwrap();
        assert!(!mappings.is_empty());
        let namespace_mapping = mappings
            .iter()
            .find(|m| m.output_field == "namespace")
            .unwrap();
        assert!(
            namespace_mapping
                .source_columns
                .contains("k8s_namespace_name")
        );

        let node_mapping = mappings.iter().find(|m| m.output_field == "node").unwrap();
        assert!(node_mapping.source_columns.contains("k8s_node_name"));
    }

    #[tokio::test]
    async fn test_function_columns() {
        let sql = "SELECT COUNT(k8s_namespace_name), MAX(floatvalue) FROM \"default\"";
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();
        let mappings = res.get("default").unwrap();

        assert!(mappings.len() >= 2);

        assert!(
            mappings
                .iter()
                .any(|m| m.source_columns.contains("k8s_namespace_name"))
        );
        assert!(
            mappings
                .iter()
                .any(|m| m.source_columns.contains("floatvalue"))
        );
    }

    #[tokio::test]
    async fn test_complex_expression() {
        let sql = "SELECT CAST(array_element(regexp_match(log, 'took: ([0-9]+) ms'), 1) AS INTEGER) AS extracted_time FROM \"default\"";
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();
        let mappings = res.get("default").unwrap();

        assert!(!mappings.is_empty());

        let mapping = mappings
            .iter()
            .find(|m| m.source_columns.contains("log"))
            .unwrap();
        assert_eq!(mapping.output_field, "extracted_time");
    }

    #[tokio::test]
    async fn test_case_expression() {
        let sql = "SELECT CASE WHEN k8s_namespace_name = 'test' THEN floatvalue ELSE code END AS conditional_value FROM \"default\"";
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();
        let mappings = res.get("default").unwrap();

        assert!(!mappings.is_empty());

        let mapping = mappings
            .iter()
            .find(|m| {
                m.source_columns.contains("k8s_namespace_name")
                    && m.source_columns.contains("floatvalue")
                    && m.source_columns.contains("code")
            })
            .unwrap();
        assert!(mapping.source_columns.len() == 3);
    }

    #[tokio::test]
    async fn test_multiple_columns_in_expression() {
        let sql =
            "SELECT CONCAT(k8s_namespace_name, '-', k8s_pod_name) AS full_name FROM \"default\"";
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();
        let mappings = res.get("default").unwrap();

        assert!(mappings.len() >= 2);

        assert!(mappings.iter().any(|m| m.output_field == "full_name"));
        assert!(
            mappings
                .iter()
                .any(|m| m.source_columns.contains("k8s_namespace_name"))
        );
        assert!(
            mappings
                .iter()
                .any(|m| m.source_columns.contains("k8s_pod_name"))
        );
    }

    #[tokio::test]
    async fn test_multiple_columns_in_expression_no_alias() {
        let sql = "SELECT k8s_namespace_name, k8s_pod_name FROM \"default\"";
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();
        let mappings = res.get("default").unwrap();

        assert!(mappings.len() >= 2);
        assert!(
            mappings
                .iter()
                .any(|m| m.output_field == "k8s_namespace_name")
        );
        assert!(mappings.iter().any(|m| m.output_field == "k8s_pod_name"));
    }

    #[tokio::test]
    async fn test_cte_with_simple_projection() {
        let sql = r#"
            WITH namespace_stats AS (
                SELECT k8s_namespace_name, COUNT(*) as count
                FROM "default"
                GROUP BY k8s_namespace_name
            )
            SELECT k8s_namespace_name, count FROM namespace_stats
        "#;
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();

        let mappings = res.get("default").unwrap();

        assert!(
            !mappings.is_empty(),
            "Expected at least some mappings but got none"
        );

        assert!(
            mappings
                .iter()
                .any(|m| m.output_field == "k8s_namespace_name")
        );

        assert!(mappings.iter().any(|m| m.output_field == "count"));
    }

    #[tokio::test]
    async fn test_subquery_in_from_clause() {
        let sql = r#"
            SELECT namespace, total_count
            FROM (
                SELECT k8s_namespace_name as namespace, COUNT(*) as total_count
                FROM "default"
                GROUP BY k8s_namespace_name
            ) subq
        "#;
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();

        let mappings = res.get("default").unwrap();

        assert!(mappings.len() >= 2);

        assert!(
            mappings
                .iter()
                .any(|m| m.source_columns.contains("k8s_namespace_name"))
        );

        assert!(mappings.iter().any(|m| m.output_field == "total_count"));
    }

    #[tokio::test]
    async fn test_query_with_aggregation() {
        // Simplify the SQL to avoid parsing issues
        let sql = r#"
            SELECT k8s_namespace_name, MAX(floatvalue) as max_value
            FROM "default"
            GROUP BY k8s_namespace_name
        "#;
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();
        let mappings = res.get("default").unwrap();

        assert!(!mappings.is_empty());

        assert!(
            mappings
                .iter()
                .any(|m| m.source_columns.contains("k8s_namespace_name"))
        );

        assert!(mappings.iter().any(|m| m.output_field == "max_value"));
    }

    #[tokio::test]
    async fn test_cte_with_window_function() {
        let sql = r#"
            WITH ranked_pods AS (
                SELECT 
                    k8s_namespace_name,
                    k8s_pod_name,
                    floatvalue,
                    ROW_NUMBER() OVER (PARTITION BY k8s_namespace_name ORDER BY floatvalue DESC) as rank
                FROM "default"
                WHERE k8s_namespace_name IS NOT NULL
            )
            SELECT k8s_namespace_name, k8s_pod_name, floatvalue
            FROM ranked_pods
            WHERE rank = 1
        "#;
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();
        let mappings = res.get("default").unwrap();

        assert!(!mappings.is_empty());

        let namespace_mapping = mappings
            .iter()
            .find(|m| m.source_columns.contains("k8s_namespace_name"))
            .unwrap();
        assert!(namespace_mapping.output_field == "k8s_namespace_name");

        let pod_mapping = mappings
            .iter()
            .find(|m| m.output_field == "k8s_pod_name")
            .unwrap();
        assert!(pod_mapping.source_columns.contains("k8s_pod_name"));

        let value_mapping = mappings
            .iter()
            .find(|m| m.output_field == "floatvalue")
            .unwrap();
        assert!(value_mapping.source_columns.contains("floatvalue"));
    }

    #[tokio::test]
    async fn test_subquery_in_select_with_join() {
        let sql = r#"
            SELECT 
                n1.k8s_namespace_name,
                n1.k8s_pod_name,
                (SELECT MAX(floatvalue) FROM "default" n2 WHERE n2.k8s_namespace_name = n1.k8s_namespace_name) as max_value
            FROM "t2" n1
            WHERE n1.k8s_pod_name IS NOT NULL
        "#;
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();
        let mappings = res.get("default").unwrap();
        assert!(!mappings.is_empty());
        assert!(mappings.iter().any(|m| m.output_field == "max_value"));

        let mappings = res.get("t2").unwrap();
        assert!(mappings.len() >= 2);

        assert!(
            mappings
                .iter()
                .any(|m| m.output_field == "k8s_namespace_name")
        );
        assert!(mappings.iter().any(|m| m.output_field == "k8s_pod_name"));
    }

    #[tokio::test]
    async fn test_cte_with_union() {
        let sql = r#"
            WITH namespace_data AS (
                SELECT k8s_namespace_name, COUNT(*) as count
                FROM "default"
                GROUP BY k8s_namespace_name
                UNION ALL
                SELECT 'unknown' as k8s_namespace_name, 0 as count
            )
            SELECT k8s_namespace_name, count FROM namespace_data
        "#;
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();

        let mappings = res.get("default").unwrap();

        assert!(
            !mappings.is_empty(),
            "Expected at least some mappings but got none"
        );

        let namespace_mapping = mappings
            .iter()
            .find(|m| m.output_field == "k8s_namespace_name")
            .unwrap();
        assert!(
            namespace_mapping
                .source_columns
                .contains("k8s_namespace_name")
        );

        assert!(mappings.iter().any(|m| m.output_field == "count"));
    }

    #[tokio::test]
    async fn test_group_by_with_aggregate_function() {
        let sql = "SELECT k8s_namespace_name, k8s_namespace_name AS a, MAX(k8s_namespace_name) AS b FROM \"default\" GROUP BY k8s_namespace_name";
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();
        let mappings = res.get("default").unwrap();

        assert!(!mappings.is_empty());

        let direct_mapping = mappings
            .iter()
            .find(|m| m.output_field == "k8s_namespace_name")
            .unwrap();
        assert!(direct_mapping.source_columns.contains("k8s_namespace_name"));

        let aliased_mapping = mappings.iter().find(|m| m.output_field == "a").unwrap();
        assert!(
            aliased_mapping
                .source_columns
                .contains("k8s_namespace_name")
        );

        let aggregate_mapping = mappings.iter().find(|m| m.output_field == "b").unwrap();
        assert!(
            aggregate_mapping
                .source_columns
                .contains("k8s_namespace_name")
        );
        assert!(
            aggregate_mapping
                .projection_expr
                .to_lowercase()
                .contains("max")
        );
    }

    #[tokio::test]
    async fn test_table_alias_resolution_with_grouped_mappings() {
        let sql = r#"
            SELECT t1.k8s_namespace_name AS k1, t2.k8s_namespace_name AS k2
            FROM "default" t1
            JOIN "t2" t2 ON t1.k8s_namespace_name = t2.k8s_namespace_name
        "#;
        let parsed = get_sql(sql).await;
        let grouped_mappings = get_columns_from_projections(parsed).await.unwrap();

        let default_mappings = grouped_mappings.get("default").unwrap();
        assert!(
            default_mappings
                .iter()
                .any(|m| m.source_columns.contains("k8s_namespace_name"))
        );
        assert!(default_mappings.iter().any(|m| m.output_field == "k1"));

        let t2_mappings = grouped_mappings.get("t2").unwrap();
        assert!(
            t2_mappings
                .iter()
                .any(|m| m.source_columns.contains("k8s_namespace_name"))
        );
        assert!(t2_mappings.iter().any(|m| m.output_field == "k2"));
    }

    #[tokio::test]
    async fn test_empty_result_set() {
        let sql = "SELECT k8s_namespace_name FROM \"default\" WHERE 1=0";
        let parsed = get_sql(sql).await;
        let res = get_columns_from_projections(parsed).await.unwrap();
        let mappings = res.get("default").unwrap();

        assert!(
            !mappings.is_empty(),
            "Should still have column mappings even with empty result set"
        );
        assert!(
            mappings
                .iter()
                .any(|m| m.output_field == "k8s_namespace_name")
        );
    }
}
