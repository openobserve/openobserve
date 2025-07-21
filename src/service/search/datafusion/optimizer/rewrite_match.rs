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

use config::get_config;
use datafusion::{
    self,
    common::{
        Column, Result,
        tree_node::{Transformed, TreeNode, TreeNodeRewriter},
    },
    error::DataFusionError,
    logical_expr::{
        BinaryExpr, Expr, Like, LogicalPlan, Operator, expr::ScalarFunction, utils::disjunction,
    },
    optimizer::{OptimizerConfig, OptimizerRule, optimizer::ApplyOrder, utils::NamePreserver},
    scalar::ScalarValue,
};

use crate::service::search::datafusion::udf::{
    fuzzy_match_udf,
    match_all_udf::{FUZZY_MATCH_ALL_UDF_NAME, MATCH_ALL_UDF_NAME},
};

/// Optimization rule that rewrite match_all() to str_match()
#[derive(Default, Debug)]
pub struct RewriteMatch {
    fields: Vec<String>,
}

impl RewriteMatch {
    #[allow(missing_docs)]
    pub fn new(fields: Vec<String>) -> Self {
        Self { fields }
    }
}

impl OptimizerRule for RewriteMatch {
    fn name(&self) -> &str {
        "rewrite_match"
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
            LogicalPlan::Filter(_) => {
                if plan
                    .expressions()
                    .iter()
                    .any(|expr| expr.exists(|expr| Ok(is_match_all(expr))).unwrap())
                {
                    let mut expr_rewriter = MatchToFullTextMatch::new(self.fields.clone());
                    let name_preserver = NamePreserver::new(&plan);
                    plan.map_expressions(|expr| {
                        let original_name = name_preserver.save(&expr);
                        expr.rewrite(&mut expr_rewriter).map(|transformed| {
                            transformed.update_data(|e| original_name.restore(e))
                        })
                    })
                } else {
                    Ok(Transformed::no(plan))
                }
            }
            _ => Ok(Transformed::no(plan)),
        }
    }
}

fn is_match_all(expr: &Expr) -> bool {
    match expr {
        Expr::ScalarFunction(ScalarFunction { func, .. }) => {
            func.name().to_lowercase() == MATCH_ALL_UDF_NAME
                || func.name() == FUZZY_MATCH_ALL_UDF_NAME
        }
        _ => false,
    }
}

// Rewriter for match_all() to str_match()
#[derive(Debug, Clone)]
pub struct MatchToFullTextMatch {
    fields: Vec<String>,
}

impl MatchToFullTextMatch {
    pub fn new(fields: Vec<String>) -> Self {
        Self { fields }
    }
}

impl TreeNodeRewriter for MatchToFullTextMatch {
    type Node = Expr;

    fn f_up(&mut self, expr: Expr) -> Result<Transformed<Expr>, DataFusionError> {
        match &expr {
            Expr::ScalarFunction(ScalarFunction { func, args }) => {
                let name = func.name();
                if name == MATCH_ALL_UDF_NAME {
                    let Expr::Literal(ScalarValue::Utf8(Some(item)), _) = args[0].clone() else {
                        return Err(DataFusionError::Internal(format!(
                            "Unexpected argument type for match_all() keyword: {:?}",
                            args[0]
                        )));
                    };
                    let mut expr_list = Vec::with_capacity(self.fields.len());
                    let item = item
                        .trim_start_matches("re:") // regex
                        .trim_start_matches('*') // contains
                        .trim_end_matches('*') // prefix or contains
                        .to_string(); // remove prefix and suffix *
                    let item = if get_config().common.utf8_view_enabled {
                        Expr::Literal(ScalarValue::Utf8View(Some(format!("%{item}%"))), None)
                    } else {
                        Expr::Literal(ScalarValue::Utf8(Some(format!("%{item}%"))), None)
                    };
                    for field in self.fields.iter() {
                        let new_expr = create_like_expr_with_not_null(field, item.clone());
                        expr_list.push(new_expr);
                    }
                    if expr_list.is_empty() {
                        return Err(DataFusionError::Internal(
                            infra::errors::ErrorCodes::FullTextSearchFieldNotFound.to_string(),
                        ));
                    }
                    let new_expr = disjunction(expr_list).unwrap();
                    Ok(Transformed::yes(new_expr))
                } else if name == FUZZY_MATCH_ALL_UDF_NAME {
                    let Expr::Literal(ScalarValue::Utf8(Some(item)), _) = args[0].clone() else {
                        return Err(DataFusionError::Internal(format!(
                            "Unexpected argument type for fuzzy_match_all() keyword: {:?}",
                            args[0]
                        )));
                    };
                    let Expr::Literal(ScalarValue::Int64(Some(distance)), _) = args[1].clone() else {
                        return Err(DataFusionError::Internal(format!(
                            "Unexpected argument type for fuzzy_match_all() distance: {:?}",
                            args[1]
                        )));
                    };
                    let mut expr_list = Vec::with_capacity(self.fields.len());
                    let item = if get_config().common.utf8_view_enabled {
                        Expr::Literal(ScalarValue::Utf8View(Some(item.to_string())), None)
                    } else {
                        Expr::Literal(ScalarValue::Utf8(Some(item.to_string())), None)
                    };
                    let distance = Expr::Literal(ScalarValue::Int64(Some(distance)), None);
                    let fuzzy_expr = fuzzy_match_udf::FUZZY_MATCH_UDF.clone();
                    for field in self.fields.iter() {
                        let new_expr = fuzzy_expr.call(vec![
                            Expr::Column(Column::new_unqualified(field)),
                            item.clone(),
                            distance.clone(),
                        ]);
                        expr_list.push(new_expr);
                    }
                    if expr_list.is_empty() {
                        return Err(DataFusionError::Internal(
                            infra::errors::ErrorCodes::FullTextSearchFieldNotFound.to_string(),
                        ));
                    }
                    let new_expr = disjunction(expr_list).unwrap();
                    Ok(Transformed::yes(new_expr))
                } else {
                    Ok(Transformed::no(expr))
                }
            }
            _ => Ok(Transformed::no(expr)),
        }
    }
}

fn create_like_expr_with_not_null(field: &str, item: Expr) -> Expr {
    Expr::BinaryExpr(BinaryExpr {
        left: Box::new(Expr::IsNotNull(Box::new(Expr::Column(
            Column::new_unqualified(field),
        )))),
        right: Box::new(Expr::Like(Like {
            negated: false,
            expr: Box::new(Expr::Column(Column::new_unqualified(field))),
            pattern: Box::new(item),
            escape_char: None,
            case_insensitive: true,
        })),
        op: Operator::And,
    })
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Array, Int64Array, StringArray, StringViewArray};
    use arrow_schema::DataType;
    use config::get_config;
    use datafusion::{
        arrow::{
            datatypes::{Field, Schema},
            record_batch::RecordBatch,
        },
        assert_batches_eq,
        datasource::MemTable,
        execution::{runtime_env::RuntimeEnvBuilder, session_state::SessionStateBuilder},
        prelude::{SessionConfig, SessionContext},
    };

    use super::*;
    use crate::service::search::datafusion::{
        optimizer::rewrite_match::RewriteMatch, udf::match_all_udf,
    };

    #[tokio::test]
    async fn test_rewrite_match() {
        let sqls = [
            (
                "select * from t where match_all('open')",
                vec![
                    "+------------+-------------+-------------+",
                    "| _timestamp | name        | log         |",
                    "+------------+-------------+-------------+",
                    "| 1          | open        | o2          |",
                    "| 3          | openobserve | openobserve |",
                    "+------------+-------------+-------------+",
                ],
            ),
            (
                "select _timestamp from t where match_all('open')",
                vec![
                    "+------------+",
                    "| _timestamp |",
                    "+------------+",
                    "| 1          |",
                    "| 3          |",
                    "+------------+",
                ],
            ),
        ];

        let schema = if get_config().common.utf8_view_enabled {
            // define a schema.
            Arc::new(Schema::new(vec![
                Field::new("_timestamp", DataType::Int64, false),
                Field::new("name", DataType::Utf8View, false),
                Field::new("log", DataType::Utf8View, false),
            ]))
        } else {
            Arc::new(Schema::new(vec![
                Field::new("_timestamp", DataType::Int64, false),
                Field::new("name", DataType::Utf8, false),
                Field::new("log", DataType::Utf8, false),
            ]))
        };

        let name_array: Arc<dyn Array> = if get_config().common.utf8_view_enabled {
            Arc::new(StringViewArray::from(vec![
                "open",
                "observe",
                "openobserve",
                "OBserve",
                "oo",
            ]))
        } else {
            Arc::new(StringArray::from(vec![
                "open",
                "observe",
                "openobserve",
                "OBserve",
                "oo",
            ]))
        };

        let log_array: Arc<dyn Array> = if get_config().common.utf8_view_enabled {
            Arc::new(StringViewArray::from(vec![
                "o2",
                "obSERVE",
                "openobserve",
                "o2",
                "oo",
            ]))
        } else {
            Arc::new(StringArray::from(vec![
                "o2",
                "obSERVE",
                "openobserve",
                "o2",
                "oo",
            ]))
        };

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1, 2, 3, 4, 5])),
                name_array,
                log_array,
            ],
        )
        .unwrap();

        let fields = vec!["name".to_string(), "log".to_string()];

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new())
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .with_optimizer_rules(vec![Arc::new(RewriteMatch::new(fields.clone()))])
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();
        ctx.register_udf(match_all_udf::MATCH_ALL_UDF.clone());
        ctx.register_udf(match_all_udf::FUZZY_MATCH_ALL_UDF.clone());

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    #[tokio::test]
    async fn test_rewrite_not_match() {
        let sqls = [(
            "select * from t where not match_all('open')",
            vec![
                "+------------+---------+---------+",
                "| _timestamp | name    | log     |",
                "+------------+---------+---------+",
                "| 2          | observe |         |",
                "| 4          |         | obSERVE |",
                "+------------+---------+---------+",
            ],
        )];

        let schema = if get_config().common.utf8_view_enabled {
            // define a schema.
            Arc::new(Schema::new(vec![
                Field::new("_timestamp", DataType::Int64, false),
                Field::new("name", DataType::Utf8View, true),
                Field::new("log", DataType::Utf8View, true),
            ]))
        } else {
            Arc::new(Schema::new(vec![
                Field::new("_timestamp", DataType::Int64, false),
                Field::new("name", DataType::Utf8, true),
                Field::new("log", DataType::Utf8, true),
            ]))
        };

        let name_array: Arc<dyn Array> = if get_config().common.utf8_view_enabled {
            Arc::new(StringViewArray::from(vec![
                Some("open"),
                Some("observe"),
                Some("openobserve"),
                None,
                None,
            ]))
        } else {
            Arc::new(StringArray::from(vec![
                Some("open"),
                Some("observe"),
                Some("openobserve"),
                None,
                None,
            ]))
        };

        let log_array: Arc<dyn Array> = if get_config().common.utf8_view_enabled {
            Arc::new(StringViewArray::from(vec![
                None,
                None,
                Some("o2"),
                Some("obSERVE"),
                Some("openobserve"),
            ]))
        } else {
            Arc::new(StringArray::from(vec![
                None,
                None,
                Some("o2"),
                Some("obSERVE"),
                Some("openobserve"),
            ]))
        };

        // define data.
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1, 2, 3, 4, 5])),
                name_array,
                log_array,
            ],
        )
        .unwrap();

        let fields = vec!["name".to_string(), "log".to_string()];

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new())
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .with_optimizer_rules(vec![Arc::new(RewriteMatch::new(fields.clone()))])
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();
        ctx.register_udf(match_all_udf::MATCH_ALL_UDF.clone());
        ctx.register_udf(match_all_udf::FUZZY_MATCH_ALL_UDF.clone());

        for item in sqls {
            let df = ctx.sql(item.0).await.unwrap();
            let data = df.collect().await.unwrap();
            assert_batches_eq!(item.1, &data);
        }
    }

    #[tokio::test]
    async fn test_create_like_expr_with_not_null() {
        let field = "name";
        let item = Expr::Literal(ScalarValue::Utf8(Some("open".to_string())), None);
        let expr = create_like_expr_with_not_null(field, item.clone());
        assert_eq!(
            expr,
            Expr::BinaryExpr(BinaryExpr {
                left: Box::new(Expr::IsNotNull(Box::new(Expr::Column(
                    Column::new_unqualified(field),
                )))),
                right: Box::new(Expr::Like(Like {
                    negated: false,
                    expr: Box::new(Expr::Column(Column::new_unqualified(field))),
                    pattern: Box::new(item),
                    escape_char: None,
                    case_insensitive: true,
                })),
                op: Operator::And,
            }),
        );
    }
}
