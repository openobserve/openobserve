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

use std::{collections::HashMap, sync::Arc};

use arrow_schema::DataType;
use datafusion::{
    common::{
        Result, TableReference,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion},
    },
    logical_expr::{
        BinaryExpr, Expr, Like, LogicalPlan, Operator, cast, expr::ScalarFunction, lit,
    },
    optimizer::{OptimizerConfig, OptimizerRule, optimizer::ApplyOrder},
};
use hashbrown::HashSet;

use crate::{
    datafusion::udf::fulltext::str_match::{STR_MATCH_IGNORE_CASE_UDF, STR_MATCH_UDF},
    index::like_substring,
};

/// Rewrites `col [I]LIKE '%x%'` on a secondary index field to the equivalent `str_match`.
#[derive(Debug)]
pub struct RewriteLikeToStrMatch {
    index_fields: HashMap<TableReference, HashSet<String>>,
}

impl RewriteLikeToStrMatch {
    pub fn new(index_fields: HashMap<TableReference, HashSet<String>>) -> Self {
        Self { index_fields }
    }

    // stays out of NOT: `Not(StrMatch)` on the index also returns rows whose field is NULL
    fn rewrite_predicate(&self, expr: Expr) -> Result<Transformed<Expr>> {
        expr.transform_down(|expr| match &expr {
            Expr::BinaryExpr(BinaryExpr {
                op: Operator::And | Operator::Or,
                ..
            }) => Ok(Transformed::no(expr)),
            Expr::Like(like) => Ok(match self.str_match_for(like) {
                Some(str_match) => Transformed::yes(str_match),
                None => Transformed::no(expr),
            }),
            _ => Ok(Transformed::new(expr, false, TreeNodeRecursion::Jump)),
        })
    }

    fn str_match_for(&self, like: &Like) -> Option<Expr> {
        if like.negated || like.escape_char.is_some() {
            return None;
        }
        let Expr::Column(column) = like.expr.as_ref() else {
            return None;
        };
        let Expr::Literal(pattern, _) = like.pattern.as_ref() else {
            return None;
        };
        let value = like_substring(pattern.try_as_str().flatten()?)?;
        // `str_match_ignore_case` folds only the ASCII letters of the needle
        if like.case_insensitive && !value.is_ascii() {
            return None;
        }
        let index_fields = self.index_fields.get(column.relation.as_ref()?)?;
        if !index_fields.contains(&column.name) {
            return None;
        }
        let udf = if like.case_insensitive {
            STR_MATCH_IGNORE_CASE_UDF.clone()
        } else {
            STR_MATCH_UDF.clone()
        };
        // `str_match` only accepts Utf8
        let args = vec![
            cast(Expr::Column(column.clone()), DataType::Utf8),
            lit(value),
        ];
        Some(Expr::ScalarFunction(ScalarFunction::new_udf(
            Arc::new(udf),
            args,
        )))
    }
}

impl OptimizerRule for RewriteLikeToStrMatch {
    fn name(&self) -> &str {
        "rewrite_like_to_str_match"
    }

    fn apply_order(&self) -> Option<ApplyOrder> {
        Some(ApplyOrder::BottomUp)
    }

    fn supports_rewrite(&self) -> bool {
        true
    }

    fn rewrite(
        &self,
        plan: LogicalPlan,
        _config: &dyn OptimizerConfig,
    ) -> Result<Transformed<LogicalPlan>> {
        match plan {
            LogicalPlan::Filter(_) | LogicalPlan::TableScan(_) => {
                plan.map_expressions(|expr| self.rewrite_predicate(expr))
            }
            _ => Ok(Transformed::no(plan)),
        }
    }
}

#[cfg(test)]
mod tests {
    use arrow::{
        array::{ArrayRef, LargeStringArray, RecordBatch, StringArray, StringViewArray},
        util::pretty::pretty_format_batches,
    };
    use arrow_schema::{Field, Schema};
    use datafusion::{
        datasource::MemTable,
        execution::SessionStateBuilder,
        optimizer::{push_down_filter::PushDownFilter, simplify_expressions::SimplifyExpressions},
        prelude::SessionContext,
    };

    use super::*;

    fn register_table(ctx: &SessionContext) {
        let schema = Arc::new(Schema::new(vec![
            Field::new("name", DataType::Utf8, true),
            Field::new("view", DataType::Utf8View, true),
            Field::new("large", DataType::LargeUtf8, true),
            Field::new("message", DataType::Utf8, true),
        ]));
        let rows = [
            Some("auth-gw"),
            Some("AUTH"),
            Some("Auth é"),
            Some("billing"),
            Some("a_b"),
            Some(""),
            None,
        ];
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(StringArray::from_iter(rows)) as ArrayRef,
                Arc::new(StringViewArray::from_iter(rows)),
                Arc::new(LargeStringArray::from_iter(rows)),
                Arc::new(StringArray::from_iter(rows)),
            ],
        )
        .unwrap();
        let table = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(table)).unwrap();
    }

    fn context_with_rule() -> SessionContext {
        let index_fields = HashMap::from([(
            TableReference::from("t"),
            HashSet::from(["name".to_string(), "view".to_string(), "large".to_string()]),
        )]);
        let state = SessionStateBuilder::new()
            .with_default_features()
            .with_optimizer_rules(vec![
                Arc::new(SimplifyExpressions::new()),
                Arc::new(PushDownFilter::new()),
                Arc::new(RewriteLikeToStrMatch::new(index_fields)),
            ])
            .build();
        let ctx = SessionContext::new_with_state(state);
        register_table(&ctx);
        ctx
    }

    async fn optimized_plan(ctx: &SessionContext, sql: &str) -> String {
        let plan = ctx.state().create_logical_plan(sql).await.unwrap();
        ctx.state()
            .optimize(&plan)
            .unwrap()
            .display_indent()
            .to_string()
    }

    #[tokio::test]
    async fn test_rewrites_positive_like_on_index_field() {
        let ctx = context_with_rule();
        for predicate in [
            "name LIKE '%auth%'",
            "name ILIKE '%AUTH%'",
            "name LIKE '%é%'",
            "name LIKE '%auth-gw%'",
            "view LIKE '%auth%'",
            "large ILIKE '%auth%'",
            "name LIKE '%auth%' OR name LIKE '%bill%'",
            "name LIKE '%auth%' AND view ILIKE '%gw%'",
        ] {
            let sql = format!("SELECT * FROM t WHERE {predicate}");
            let plan = optimized_plan(&ctx, &sql).await;
            assert!(plan.contains("str_match"), "{predicate}\n{plan}");
            assert!(!plan.contains("LIKE"), "{predicate}\n{plan}");
        }
        let plan = optimized_plan(&ctx, "SELECT * FROM t AS a WHERE a.name LIKE '%auth%'").await;
        assert!(plan.contains("str_match"), "{plan}");
    }

    #[tokio::test]
    async fn test_keeps_like_that_str_match_can_not_replace() {
        let ctx = context_with_rule();
        for predicate in [
            "message LIKE '%auth%'",
            "name NOT LIKE '%auth%'",
            "NOT (name LIKE '%auth%')",
            "name ILIKE '%é%'",
            "name LIKE 'auth%'",
            "name LIKE '%auth'",
            "name LIKE '%a_b%'",
            "name LIKE '%a%b%'",
            r"name LIKE '%a\_b%'",
            "name LIKE '%a$_b%' ESCAPE '$'",
            "name LIKE message",
            "CASE WHEN name LIKE '%auth%' THEN true ELSE false END",
        ] {
            let sql = format!("SELECT * FROM t WHERE {predicate}");
            let plan = optimized_plan(&ctx, &sql).await;
            assert!(plan.contains("LIKE"), "{predicate}\n{plan}");
            assert!(!plan.contains("str_match"), "{predicate}\n{plan}");
        }
        let plan = optimized_plan(&ctx, "SELECT name LIKE '%auth%' FROM t").await;
        assert!(!plan.contains("str_match"), "{plan}");
    }

    #[tokio::test]
    async fn test_rewrites_only_the_index_field_in_a_mixed_or() {
        let ctx = context_with_rule();
        let sql = "SELECT * FROM t WHERE name LIKE '%auth%' OR message LIKE '%bill%'";
        let plan = optimized_plan(&ctx, sql).await;
        assert!(plan.contains("str_match"), "{plan}");
        assert!(plan.contains("message LIKE"), "{plan}");
    }

    #[tokio::test]
    async fn test_rewrite_returns_the_same_rows_as_like() {
        let rewritten = context_with_rule();
        let original = SessionContext::new();
        register_table(&original);
        for column in ["name", "view", "large"] {
            for predicate in [
                format!("{column} LIKE '%Auth%'"),
                format!("{column} LIKE '%a_b%'"),
                format!("{column} LIKE '%é%'"),
                format!("{column} ILIKE '%AUTH%'"),
                format!("{column} ILIKE '%gw%' OR {column} LIKE '%bill%'"),
                format!("{column} LIKE '%Auth%' AND {column} ILIKE '%é%'"),
                format!("({column} LIKE '%Auth%') IS NULL"),
            ] {
                let sql = format!("SELECT message FROM t WHERE {predicate} ORDER BY message");
                let expected = original.sql(&sql).await.unwrap().collect().await.unwrap();
                let actual = rewritten.sql(&sql).await.unwrap().collect().await.unwrap();
                assert_eq!(
                    pretty_format_batches(&actual).unwrap().to_string(),
                    pretty_format_batches(&expected).unwrap().to_string(),
                    "{predicate}"
                );
            }
        }
    }
}
