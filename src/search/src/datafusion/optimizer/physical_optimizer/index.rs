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

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use config::tantivy::tokenizer::o2_collect_search_tokens;
use datafusion::{
    common::{
        Result,
        tree_node::{
            Transformed, TransformedResult, TreeNode, TreeNodeRecursion, TreeNodeRewriter,
        },
    },
    config::ConfigOptions,
    logical_expr::Operator,
    physical_expr::{ScalarFunctionExpr, conjunction, split_conjunction},
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{
        ExecutionPlan, PhysicalExpr,
        expressions::{BinaryExpr, Column, InListExpr, LikeExpr, NotExpr},
        filter::{FilterExec, FilterExecBuilder},
        limit::LocalLimitExec,
        projection::ProjectionExec,
    },
};
use hashbrown::HashSet;
use parking_lot::Mutex;

use crate::{
    datafusion::{
        optimizer::physical_optimizer::utils::{
            extract_string_literal, get_column_name, is_column, is_only_timestamp_filter, is_value,
        },
        udf::{
            MATCH_FIELD_IGNORE_CASE_UDF_NAME, MATCH_FIELD_UDF_NAME, STR_MATCH_UDF_IGNORE_CASE_NAME,
            STR_MATCH_UDF_NAME,
            match_all_udf::{FUZZY_MATCH_ALL_UDF_NAME, MATCH_ALL_UDF_NAME},
        },
    },
    index::{Condition, IndexCondition, like_contains_term, like_substring},
};

#[derive(Default, Debug)]
pub struct IndexRule {
    index_fields: HashSet<String>,
    fts_fields: HashSet<String>,
    index_condition: Arc<Mutex<Option<IndexCondition>>>,
    // this set to true when all filter can be extract to
    // index condition(except _timestamp filter)
    pub can_optimize: Arc<AtomicBool>,
}

impl IndexRule {
    pub fn new(
        index_fields: HashSet<String>,
        fts_fields: HashSet<String>,
        index_condition: Arc<Mutex<Option<IndexCondition>>>,
    ) -> Self {
        Self {
            index_fields,
            fts_fields,
            index_condition,
            can_optimize: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn can_optimize(&self) -> bool {
        self.can_optimize.load(Ordering::Relaxed)
    }
}

impl PhysicalOptimizerRule for IndexRule {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        if !config::get_config().search.inverted_index_enabled {
            return Ok(plan);
        }

        let mut rewriter = IndexOptimizer::new(
            self.index_fields.clone(),
            self.fts_fields.clone(),
            self.index_condition.clone(),
        );
        let plan = plan.rewrite(&mut rewriter).data()?;

        // If no filter was found at all (e.g., SELECT count(*) FROM table),
        // and optimizer is enabled, we can still optimize
        if !rewriter.has_filter && rewriter.optimizer_enabled {
            rewriter.can_optimize = true;
        }

        // if all filter can be used in index, we can
        // use index optimizer rule to optimize the query
        if self.index_condition.lock().is_none() && rewriter.can_optimize {
            *self.index_condition.lock() = Some(IndexCondition {
                conditions: vec![Condition::All()],
            });
        }

        // set can_optimize to the index_rule
        self.can_optimize
            .store(rewriter.can_optimize, Ordering::Relaxed);

        Ok(plan)
    }

    fn name(&self) -> &str {
        "IndexConditionRule"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

struct IndexOptimizer {
    index_fields: HashSet<String>,
    fts_fields: HashSet<String>,
    index_condition: Arc<Mutex<Option<IndexCondition>>>,
    // set to true when the filter only have _timestamp filter
    can_optimize: bool,
    // set to true when the plan contains a FilterExec
    has_filter: bool,
    is_remove_filter: bool,
    optimizer_enabled: bool,
}

impl IndexOptimizer {
    pub fn new(
        index_fields: HashSet<String>,
        fts_fields: HashSet<String>,
        index_condition: Arc<Mutex<Option<IndexCondition>>>,
    ) -> Self {
        Self {
            index_fields,
            fts_fields,
            index_condition,
            can_optimize: false,
            has_filter: false,
            is_remove_filter: config::get_config()
                .search
                .feature_query_remove_filter_with_index,
            optimizer_enabled: config::get_config()
                .search
                .inverted_index_count_optimizer_enabled,
        }
    }

    #[cfg(test)]
    fn new_with_config(
        index_fields: HashSet<String>,
        fts_fields: HashSet<String>,
        index_condition: Arc<Mutex<Option<IndexCondition>>>,
        is_remove_filter: bool,
        optimizer_enabled: bool,
    ) -> Self {
        Self {
            index_fields,
            fts_fields,
            index_condition,
            can_optimize: false,
            has_filter: false,
            is_remove_filter,
            optimizer_enabled,
        }
    }
}

impl TreeNodeRewriter for IndexOptimizer {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Self::Node) -> Result<Transformed<Self::Node>> {
        if let Some(filter) = node.downcast_ref::<FilterExec>() {
            self.has_filter = true;
            let mut index_conditions = IndexCondition::new();
            let mut other_conditions = Vec::new();
            for expr in split_conjunction(filter.predicate()) {
                if is_expr_valid_for_index(expr, &self.index_fields, &self.fts_fields) {
                    let condition = Condition::from_physical_expr(expr, &self.index_fields);
                    if condition.requires_filter() {
                        other_conditions.push(expr.clone());
                    }
                    index_conditions.add_condition(condition);
                } else {
                    other_conditions.push(expr.clone());
                }
            }

            // check if we can remove the filter
            let is_remove_filter = self.is_remove_filter || index_conditions.can_remove_filter();

            // set the index condition
            if !index_conditions.is_empty() {
                *self.index_condition.lock() = Some(index_conditions);
            }

            if is_remove_filter {
                // if all filter can be used in index, we can
                // use index optimizer rule to optimize the query
                if self.optimizer_enabled
                    && is_only_timestamp_filter(&other_conditions.iter().collect::<Vec<_>>())
                {
                    self.can_optimize = true;
                }
                let plan = construct_filter_exec(filter, other_conditions)?;
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            } else {
                return Ok(Transformed::new(node, false, TreeNodeRecursion::Stop));
            }
        }
        Ok(Transformed::no(node))
    }
}

fn construct_filter_exec(
    filter: &FilterExec,
    exprs: Vec<Arc<dyn PhysicalExpr>>,
) -> Result<Arc<dyn ExecutionPlan>> {
    if exprs.is_empty() {
        let mut plan = match filter.projection() {
            Some(projection_indices) => {
                let filter_child_schema = filter.input().schema();
                let proj_exprs = projection_indices
                    .iter()
                    .map(|p| {
                        let field = filter_child_schema.field(*p).clone();
                        (
                            Arc::new(Column::new(field.name(), *p)) as Arc<dyn PhysicalExpr>,
                            field.name().to_string(),
                        )
                    })
                    .collect::<Vec<_>>();
                Arc::new(ProjectionExec::try_new(proj_exprs, filter.input().clone())?)
            }
            None => filter.input().clone(),
        };
        if let Some(fetch) = filter.fetch() {
            plan = Arc::new(LocalLimitExec::new(plan, fetch));
        }
        Ok(plan)
    } else {
        // TODO: remove the unused column after extract index condition
        let plan = FilterExecBuilder::new(conjunction(exprs), filter.input().clone())
            .apply_projection_by_ref(filter.projection().as_ref())?
            .with_fetch(filter.fetch())
            .build()?;
        Ok(Arc::new(plan))
    }
}

// Check if the expression is valid for the index.
fn is_expr_valid_for_index(
    expr: &Arc<dyn PhysicalExpr>,
    index_fields: &HashSet<String>,
    fts_fields: &HashSet<String>,
) -> bool {
    is_valid_for_index(expr, index_fields, fts_fields, false)
}

// `negated` is set below a NOT, where a superset index result would turn into a subset.
fn is_valid_for_index(
    expr: &Arc<dyn PhysicalExpr>,
    index_fields: &HashSet<String>,
    fts_fields: &HashSet<String>,
    negated: bool,
) -> bool {
    if let Some(expr) = expr.downcast_ref::<BinaryExpr>() {
        match expr.op() {
            Operator::Eq | Operator::NotEq => {
                let column = if is_value(expr.left()) && is_column(expr.right()) {
                    get_column_name(expr.right())
                } else if is_value(expr.right()) && is_column(expr.left()) {
                    get_column_name(expr.left())
                } else {
                    return false;
                };

                if !index_fields.contains(column) {
                    return false;
                }
            }
            Operator::And | Operator::Or => {
                return is_valid_for_index(expr.left(), index_fields, fts_fields, negated)
                    && is_valid_for_index(expr.right(), index_fields, fts_fields, negated);
            }
            _ => return false,
        }
    } else if let Some(expr) = expr.downcast_ref::<InListExpr>() {
        if !is_column(expr.expr()) || !index_fields.contains(get_column_name(expr.expr())) {
            return false;
        }

        for value in expr.list() {
            if !is_value(value) {
                return false;
            }
        }
    } else if let Some(expr) = expr.downcast_ref::<ScalarFunctionExpr>() {
        let name = expr.name();
        return match name {
            MATCH_ALL_UDF_NAME => {
                expr.args().len() == 1
                    && extract_string_literal(&expr.args()[0])
                        .map(|s| !o2_collect_search_tokens(&s).is_empty())
                        .unwrap_or(false)
            }
            FUZZY_MATCH_ALL_UDF_NAME => expr.args().len() == 2,
            STR_MATCH_UDF_NAME
            | STR_MATCH_UDF_IGNORE_CASE_NAME
            | MATCH_FIELD_UDF_NAME
            | MATCH_FIELD_IGNORE_CASE_UDF_NAME => {
                expr.args().len() == 2 && index_fields.contains(get_column_name(&expr.args()[0]))
            }
            _ => false,
        };
    } else if let Some(expr) = expr.downcast_ref::<LikeExpr>() {
        return is_like_valid_for_index(expr, index_fields, fts_fields, negated);
    } else if let Some(expr) = expr.downcast_ref::<NotExpr>() {
        return is_valid_for_index(expr.arg(), index_fields, fts_fields, true);
    } else {
        return false;
    }
    true
}

// only `col [I]LIKE '%x%'` on a plain column, since the index stores the uncast value
fn is_like_valid_for_index(
    expr: &LikeExpr,
    index_fields: &HashSet<String>,
    fts_fields: &HashSet<String>,
    negated: bool,
) -> bool {
    let Some(column) = expr.expr().downcast_ref::<Column>() else {
        return false;
    };
    let Ok(pattern) = extract_string_literal(expr.pattern()) else {
        return false;
    };
    if expr.negated() {
        return false;
    }
    if index_fields.contains(column.name()) {
        // exact like `str_match`, but the index folds ASCII case only
        like_substring(&pattern).is_some_and(|x| !expr.case_insensitive() || x.is_ascii())
    } else {
        // a superset from `_all` turns into a subset under NOT
        !negated && fts_fields.contains(column.name()) && like_contains_term(&pattern).is_some()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int64Array, RecordBatch, StringArray};
    use arrow_schema::{DataType, Field, FieldRef, Schema};
    use datafusion::{
        catalog::MemTable,
        logical_expr::Operator,
        physical_expr::{
            PhysicalExpr,
            expressions::{BinaryExpr, Column, Literal},
        },
        physical_optimizer::PhysicalOptimizerRule,
        prelude::SessionContext,
        scalar::ScalarValue,
    };

    use super::{is_expr_valid_for_index, *};
    use crate::{
        datafusion::{
            optimizer::physical_optimizer::utils::is_only_timestamp_filter,
            udf::{
                match_all_udf::{self, MATCH_ALL_UDF},
                str_match_udf::{self, STR_MATCH_UDF},
            },
        },
        index::Condition,
    };

    fn eq(left: Arc<dyn PhysicalExpr>, right: Arc<dyn PhysicalExpr>) -> Arc<dyn PhysicalExpr> {
        Arc::new(BinaryExpr::new(left, Operator::Eq, right))
    }

    fn ne(left: Arc<dyn PhysicalExpr>, right: Arc<dyn PhysicalExpr>) -> Arc<dyn PhysicalExpr> {
        Arc::new(BinaryExpr::new(left, Operator::NotEq, right))
    }

    fn gt(left: Arc<dyn PhysicalExpr>, right: Arc<dyn PhysicalExpr>) -> Arc<dyn PhysicalExpr> {
        Arc::new(BinaryExpr::new(left, Operator::Gt, right))
    }

    fn lt(left: Arc<dyn PhysicalExpr>, right: Arc<dyn PhysicalExpr>) -> Arc<dyn PhysicalExpr> {
        Arc::new(BinaryExpr::new(left, Operator::Lt, right))
    }

    fn column(name: &str) -> Arc<dyn PhysicalExpr> {
        Arc::new(Column::new(name, 0))
    }

    fn literal(value: &str) -> Arc<dyn PhysicalExpr> {
        Arc::new(Literal::new(ScalarValue::Utf8(Some(value.to_string()))))
    }

    fn and(left: Arc<dyn PhysicalExpr>, right: Arc<dyn PhysicalExpr>) -> Arc<dyn PhysicalExpr> {
        Arc::new(BinaryExpr::new(left, Operator::And, right))
    }

    fn or(left: Arc<dyn PhysicalExpr>, right: Arc<dyn PhysicalExpr>) -> Arc<dyn PhysicalExpr> {
        Arc::new(BinaryExpr::new(left, Operator::Or, right))
    }

    fn not(expr: Arc<dyn PhysicalExpr>) -> Arc<dyn PhysicalExpr> {
        Arc::new(NotExpr::new(expr))
    }

    fn match_all(lit: &str) -> Arc<dyn PhysicalExpr> {
        Arc::new(ScalarFunctionExpr::new(
            MATCH_ALL_UDF_NAME,
            Arc::new(MATCH_ALL_UDF.clone()),
            vec![literal(lit)],
            FieldRef::new(Field::new("name", DataType::Utf8, true)),
            Arc::new(ConfigOptions::default()),
        ))
    }

    fn str_match(field: &str, lit: &str) -> Arc<dyn PhysicalExpr> {
        Arc::new(ScalarFunctionExpr::new(
            STR_MATCH_UDF_NAME,
            Arc::new(STR_MATCH_UDF.clone()),
            vec![column(field), literal(lit)],
            FieldRef::new(Field::new(field, DataType::Utf8, true)),
            Arc::new(ConfigOptions::default()),
        ))
    }

    fn like(field: &str, pattern: &str, negated: bool, ilike: bool) -> Arc<dyn PhysicalExpr> {
        Arc::new(LikeExpr::new(
            negated,
            ilike,
            column(field),
            literal(pattern),
        ))
    }

    fn in_list(field: &str, list: Vec<&str>) -> Arc<dyn PhysicalExpr> {
        Arc::new(
            InListExpr::try_new(
                column(field),
                list.iter().map(|lit| literal(lit)).collect(),
                false,
                &Schema::new(vec![Field::new(field, DataType::Utf8, true)]),
            )
            .unwrap(),
        )
    }

    #[test]
    fn test_is_only_timestamp_filter() {
        // Create timestamp filter expressions
        let timestamp_col = column("_timestamp");
        let timestamp_literal = Arc::new(Literal::new(ScalarValue::Int64(Some(1234567890))));
        let timestamp_gt = gt(timestamp_col.clone(), timestamp_literal.clone());
        let timestamp_lt = lt(timestamp_col, timestamp_literal);

        let timestamp_filters = vec![&timestamp_gt, &timestamp_lt];
        assert!(is_only_timestamp_filter(&timestamp_filters));

        // Create non-timestamp filter
        let name_col = column("name");
        let name_literal = Arc::new(Literal::new(ScalarValue::Utf8(Some("test".to_string()))));
        let name_eq = eq(name_col, name_literal);

        let mixed_filters = vec![&timestamp_gt, &name_eq];
        assert!(!is_only_timestamp_filter(&mixed_filters));
    }

    #[test]
    fn test_is_expr_valid_for_index() {
        let index_fields = HashSet::from(["name".to_string(), "id".to_string()]);
        let fts_fields = HashSet::new();
        // PhysicalExpr, is_valid, Condition
        let case = vec![
            // name = 'test'
            (
                eq(column("name"), literal("test")),
                true,
                Some(Condition::Equal("name".to_string(), "test".to_string())),
            ),
            // name > 'test'
            (gt(column("name"), literal("test")), false, None),
            // name = 'bar' and match_all('error')
            (
                and(eq(column("name"), literal("bar")), match_all("error")),
                true,
                Some(Condition::And(vec![
                    Condition::Equal("name".to_string(), "bar".to_string()),
                    Condition::MatchAll("error".to_string()),
                ])),
            ),
            // name = 'bar' or match_all('error')
            (
                or(eq(column("name"), literal("bar")), match_all("error")),
                true,
                Some(Condition::Or(vec![
                    Condition::Equal("name".to_string(), "bar".to_string()),
                    Condition::MatchAll("error".to_string()),
                ])),
            ),
            // not(name = 'bar') and match_all('error') and str_match('name', 'test')
            (
                and(
                    not(eq(column("name"), literal("bar"))),
                    and(match_all("error"), str_match("name", "test")),
                ),
                true,
                Some(Condition::And(vec![
                    Condition::Not(Box::new(Condition::Equal(
                        "name".to_string(),
                        "bar".to_string(),
                    ))),
                    Condition::MatchAll("error".to_string()),
                    Condition::StrMatch("name".to_string(), "test".to_string(), true),
                ])),
            ),
            // name != 'bar' and match_all('error') and str_match('name', 'test')
            (
                and(
                    ne(column("name"), literal("bar")),
                    and(match_all("error"), str_match("name", "test")),
                ),
                true,
                Some(Condition::And(vec![
                    Condition::NotEqual("name".to_string(), "bar".to_string()),
                    Condition::MatchAll("error".to_string()),
                    Condition::StrMatch("name".to_string(), "test".to_string(), true),
                ])),
            ),
            // name in ('bar', 'test') and match_all('error')
            (
                and(in_list("name", vec!["bar", "test"]), match_all("error")),
                true,
                Some(Condition::And(vec![
                    Condition::In(
                        "name".to_string(),
                        vec!["bar".to_string(), "test".to_string()],
                        false,
                    ),
                    Condition::MatchAll("error".to_string()),
                ])),
            ),
            // match_all('c') should be invalid because tokens are empty
            (match_all("c"), false, None),
            // match_all('a') should be invalid because tokens are empty
            (match_all("a"), false, None),
            // status = 'test'
            (eq(column("status"), literal("test")), false, None),
        ];

        for (expr, is_valid, condition) in case {
            if is_valid {
                assert!(is_expr_valid_for_index(&expr, &index_fields, &fts_fields));
            } else {
                assert!(!is_expr_valid_for_index(&expr, &index_fields, &fts_fields));
            }
            if let Some(condition) = condition {
                assert_eq!(
                    Condition::from_physical_expr(&expr, &index_fields),
                    condition
                );
            }
        }
    }

    #[test]
    fn test_is_expr_valid_for_index_like() {
        let index_fields = HashSet::from(["name".to_string(), "both".to_string()]);
        let fts_fields = HashSet::from(["message".to_string(), "both".to_string()]);
        let like_condition = |field: &str, value: &str, case_insensitive| Condition::Like {
            field: field.to_string(),
            value: value.to_string(),
            case_insensitive,
        };
        let str_match = |field: &str, value: &str, case_sensitive| {
            Condition::StrMatch(field.to_string(), value.to_string(), case_sensitive)
        };
        let long_term = format!("%{}%", "a".repeat(64));
        let max_term = format!("%{}%", "a".repeat(63));
        let column_pattern: Arc<dyn PhysicalExpr> = Arc::new(LikeExpr::new(
            false,
            false,
            column("message"),
            column("name"),
        ));
        // PhysicalExpr, is_valid, Condition
        let cases = vec![
            (
                like("name", "%open%", false, false),
                true,
                Some(str_match("name", "open", true)),
            ),
            (
                like("name", "%auth-gw%", false, true),
                true,
                Some(str_match("name", "auth-gw", false)),
            ),
            (
                like("name", "%é%", false, false),
                true,
                Some(str_match("name", "é", true)),
            ),
            (
                like("both", "%open%", false, false),
                true,
                Some(str_match("both", "open", true)),
            ),
            (
                not(like("name", "%err%", false, false)),
                true,
                Some(Condition::Not(Box::new(str_match("name", "err", true)))),
            ),
            (
                like("message", "%Err42%", false, true),
                true,
                Some(like_condition("message", "Err42", true)),
            ),
            (
                like("message", &max_term, false, false),
                true,
                Some(like_condition("message", &"a".repeat(63), false)),
            ),
            (
                or(
                    eq(column("name"), literal("a")),
                    like("message", "%err%", false, false),
                ),
                true,
                Some(Condition::Or(vec![
                    Condition::Equal("name".to_string(), "a".to_string()),
                    like_condition("message", "err", false),
                ])),
            ),
            (like("name", "%é%", false, true), false, None),
            (like("name", "%a_b%", false, false), false, None),
            (like("name", "open%", false, false), false, None),
            (like("name", "%err%", true, false), false, None),
            (like("message", &long_term, false, false), false, None),
            (like("message", "%e%", false, false), false, None),
            (like("message", "%auth-gw%", false, false), false, None),
            (like("message", "err%", false, false), false, None),
            (like("message", "%err%", true, false), false, None),
            (like("message", "%err%", true, true), false, None),
            (not(like("message", "%err%", false, false)), false, None),
            (
                not(or(
                    eq(column("name"), literal("a")),
                    like("message", "%err%", false, false),
                )),
                false,
                None,
            ),
            (like("status", "%err%", false, false), false, None),
            (column_pattern, false, None),
        ];

        for (expr, is_valid, condition) in cases {
            assert_eq!(
                is_expr_valid_for_index(&expr, &index_fields, &fts_fields),
                is_valid,
                "{expr}"
            );
            if let Some(condition) = condition {
                assert_eq!(
                    Condition::from_physical_expr(&expr, &index_fields),
                    condition
                );
            }
        }
    }

    #[tokio::test]
    async fn test_index_optimizer_like_keeps_fts_filter() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("message", DataType::Utf8, false),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1])),
                Arc::new(StringArray::from(vec!["openobserve"])),
                Arc::new(StringArray::from(vec!["an error"])),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new();
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let name_like = Condition::StrMatch("name".to_string(), "open".to_string(), false);
        let message_like = Condition::Like {
            field: "message".to_string(),
            value: "error".to_string(),
            case_insensitive: false,
        };
        // sql, expected conditions, can_optimize, LIKE left in the plan
        let cases = vec![
            (
                "SELECT count(*) FROM t WHERE message LIKE '%error%' AND _timestamp > 1",
                Some(vec![message_like.clone()]),
                false,
                Some("LIKE %error%"),
            ),
            (
                "SELECT count(*) FROM t WHERE name ILIKE '%open%' AND _timestamp > 1",
                Some(vec![name_like.clone()]),
                true,
                None,
            ),
            (
                "SELECT count(*) FROM t WHERE name ILIKE '%open%' AND message LIKE '%error%'",
                Some(vec![name_like, message_like]),
                false,
                Some("LIKE %error%"),
            ),
            (
                "SELECT count(*) FROM t WHERE message NOT LIKE '%error%'",
                None,
                false,
                Some("NOT LIKE %error%"),
            ),
        ];

        for is_remove_filter in [true, false] {
            for (sql, conditions, can_optimize, kept_like) in cases.clone() {
                let plan = ctx.state().create_logical_plan(sql).await.unwrap();
                let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();
                let index_condition = Arc::new(Mutex::new(None));
                let mut rewriter = IndexOptimizer::new_with_config(
                    HashSet::from(["name".to_string()]),
                    HashSet::from(["message".to_string()]),
                    index_condition.clone(),
                    is_remove_filter,
                    true,
                );
                let plan = physical_plan.rewrite(&mut rewriter).unwrap().data;
                let plan = datafusion::physical_plan::displayable(plan.as_ref())
                    .indent(false)
                    .to_string();

                assert_eq!(
                    index_condition.lock().clone().map(|c| c.conditions),
                    conditions,
                    "{sql}"
                );
                assert_eq!(rewriter.can_optimize, can_optimize, "{sql}");
                match kept_like {
                    Some(like) => assert!(plan.contains(like), "{sql}\n{plan}"),
                    None => assert!(!plan.contains("LIKE"), "{sql}\n{plan}"),
                }
            }
        }
    }

    #[test]
    fn test_index_rule_name_returns_expected() {
        let rule = IndexRule::new(
            HashSet::new(),
            HashSet::new(),
            Arc::new(parking_lot::Mutex::new(None)),
        );
        assert_eq!(rule.name(), "IndexConditionRule");
    }

    #[test]
    fn test_index_rule_schema_check_returns_true() {
        let rule = IndexRule::new(
            HashSet::new(),
            HashSet::new(),
            Arc::new(parking_lot::Mutex::new(None)),
        );
        assert!(rule.schema_check());
    }

    #[test]
    fn test_index_rule_can_optimize_initial_false() {
        let rule = IndexRule::new(
            HashSet::new(),
            HashSet::new(),
            Arc::new(parking_lot::Mutex::new(None)),
        );
        assert!(!rule.can_optimize());
    }

    #[tokio::test]
    async fn test_index_optimizer_optimizer_enabled() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("id", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1])),
                Arc::new(StringArray::from(vec!["openobserve"])),
                Arc::new(StringArray::from(vec!["1"])),
                Arc::new(StringArray::from(vec!["success"])),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(match_all_udf::MATCH_ALL_UDF.clone());
        ctx.register_udf(str_match_udf::STR_MATCH_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        // sql, can_optimizer, except_condition
        let cases = vec![
            (
                "SELECT count(*) from t where name = 'openobserve' and _timestamp > 1715395200000",
                true,
                Some(IndexCondition {
                    conditions: vec![Condition::Equal(
                        "name".to_string(),
                        "openobserve".to_string(),
                    )],
                }),
            ),
            (
                "SELECT count(*) from t where (name = 'openobserve' or match_all('error')) and _timestamp > 1715395200000",
                true,
                Some(IndexCondition {
                    conditions: vec![Condition::Or(vec![
                        Condition::Equal("name".to_string(), "openobserve".to_string()),
                        Condition::MatchAll("error".to_string()),
                    ])],
                }),
            ),
            (
                "SELECT count(*) from t where status = 'openobserve' or match_all('error') and _timestamp > 1715395200000",
                false,
                None,
            ),
        ];

        for (sql, can_optimizer, except_condition) in cases {
            let plan = ctx.state().create_logical_plan(sql).await.unwrap();
            let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();
            let index_fields = HashSet::from(["name".to_string(), "id".to_string()]);
            let index_condition = Arc::new(Mutex::new(None));
            let is_remove_filter = true;
            let optimizer_enabled = true;
            let mut rewriter = IndexOptimizer::new_with_config(
                index_fields,
                HashSet::new(),
                index_condition.clone(),
                is_remove_filter,
                optimizer_enabled,
            );
            let _physical_plan = physical_plan.rewrite(&mut rewriter).unwrap().data;

            assert_eq!(index_condition.lock().clone(), except_condition);
            assert_eq!(rewriter.can_optimize, can_optimizer);
        }
    }

    #[tokio::test]
    async fn test_index_optimizer_remove_filter_disabled() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("id", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1])),
                Arc::new(StringArray::from(vec!["openobserve"])),
                Arc::new(StringArray::from(vec!["1"])),
                Arc::new(StringArray::from(vec!["success"])),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        ctx.register_udf(match_all_udf::MATCH_ALL_UDF.clone());
        ctx.register_udf(str_match_udf::STR_MATCH_UDF.clone());
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        // sql, can_optimizer, except_condition
        let cases = vec![
            (
                "SELECT count(*) from t where name = 'openobserve' and _timestamp > 1715395200000",
                true,
                Some(IndexCondition {
                    conditions: vec![Condition::Equal(
                        "name".to_string(),
                        "openobserve".to_string(),
                    )],
                }),
            ),
            (
                "SELECT count(*) from t where (name = 'openobserve' or match_all('error')) and _timestamp > 1715395200000",
                true,
                Some(IndexCondition {
                    conditions: vec![Condition::Or(vec![
                        Condition::Equal("name".to_string(), "openobserve".to_string()),
                        Condition::MatchAll("error".to_string()),
                    ])],
                }),
            ),
            (
                "SELECT count(*) from t where _timestamp > 1715395200000",
                true,
                None,
            ),
            (
                "SELECT count(*) from t where match_all('response node') and _timestamp > 1715395200000",
                false,
                Some(IndexCondition {
                    conditions: vec![Condition::MatchAll("response node".to_string())],
                }),
            ),
        ];

        for (sql, can_optimizer, except_condition) in cases {
            let plan = ctx.state().create_logical_plan(sql).await.unwrap();
            let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();
            let index_fields = HashSet::from(["name".to_string(), "id".to_string()]);
            let index_condition = Arc::new(Mutex::new(None));
            let is_remove_filter = false;
            let optimizer_enabled = true;
            let mut rewriter = IndexOptimizer::new_with_config(
                index_fields,
                HashSet::new(),
                index_condition.clone(),
                is_remove_filter,
                optimizer_enabled,
            );
            let _physical_plan = physical_plan.rewrite(&mut rewriter).unwrap().data;

            assert_eq!(index_condition.lock().clone(), except_condition);
            assert_eq!(rewriter.can_optimize, can_optimizer);
        }
    }

    #[tokio::test]
    async fn test_index_optimizer_no_filter_count_star() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("id", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
        ]));

        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(Int64Array::from(vec![1])),
                Arc::new(StringArray::from(vec!["openobserve"])),
                Arc::new(StringArray::from(vec!["1"])),
                Arc::new(StringArray::from(vec!["success"])),
            ],
        )
        .unwrap();

        let ctx = SessionContext::new();
        let provider = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(provider)).unwrap();

        // sql, optimizer_enabled, can_optimize, expected_condition
        let cases = vec![
            // SELECT count(*) with no filter should be optimizable
            (
                "SELECT count(*) from t",
                true,
                true,
                Some(IndexCondition {
                    conditions: vec![Condition::All()],
                }),
            ),
            // SELECT count(*) with no filter but optimizer disabled
            ("SELECT count(*) from t", false, false, None),
        ];

        for (sql, optimizer_enabled, expected_can_optimize, expected_condition) in cases {
            let plan = ctx.state().create_logical_plan(sql).await.unwrap();
            let physical_plan = ctx.state().create_physical_plan(&plan).await.unwrap();
            let index_fields = HashSet::from(["name".to_string(), "id".to_string()]);
            let index_condition = Arc::new(Mutex::new(None));
            let mut rewriter = IndexOptimizer::new_with_config(
                index_fields,
                HashSet::new(),
                index_condition.clone(),
                false,
                optimizer_enabled,
            );
            let _physical_plan = physical_plan.rewrite(&mut rewriter).unwrap().data;

            // Apply the same post-rewrite logic as IndexRule::optimize
            if !rewriter.has_filter && rewriter.optimizer_enabled {
                rewriter.can_optimize = true;
            }
            if index_condition.lock().is_none() && rewriter.can_optimize {
                *index_condition.lock() = Some(IndexCondition {
                    conditions: vec![Condition::All()],
                });
            }

            assert_eq!(
                index_condition.lock().clone(),
                expected_condition,
                "Failed for sql: {}",
                sql
            );
            assert_eq!(
                rewriter.can_optimize, expected_can_optimize,
                "Failed for sql: {}",
                sql
            );
        }
    }
}
