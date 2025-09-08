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

use std::{
    collections::HashSet,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

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
        expressions::{BinaryExpr, Column, InListExpr, NotExpr},
        filter::FilterExec,
        projection::ProjectionExec,
    },
};
use parking_lot::Mutex;

use crate::service::search::{
    datafusion::{
        optimizer::physical_optimizer::utils::{
            get_column_name, is_column, is_only_timestamp_filter, is_value,
        },
        udf::{
            MATCH_FIELD_IGNORE_CASE_UDF_NAME, MATCH_FIELD_UDF_NAME, STR_MATCH_UDF_IGNORE_CASE_NAME,
            STR_MATCH_UDF_NAME,
            match_all_udf::{FUZZY_MATCH_ALL_UDF_NAME, MATCH_ALL_UDF_NAME},
        },
    },
    index::{Condition, IndexCondition},
};

#[derive(Default, Debug)]
pub struct IndexRule {
    index_fields: HashSet<String>,
    index_condition: Arc<Mutex<Option<IndexCondition>>>,
    // this set to true when all filter can be extract to
    // index condition(except _timestamp filter)
    pub can_optimize: Arc<AtomicBool>,
}

impl IndexRule {
    pub fn new(
        index_fields: HashSet<String>,
        index_condition: Arc<Mutex<Option<IndexCondition>>>,
    ) -> Self {
        Self {
            index_fields,
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
        if !config::get_config().common.inverted_index_enabled {
            return Ok(plan);
        }

        let mut rewriter =
            IndexOptimizer::new(self.index_fields.clone(), self.index_condition.clone());
        let plan = plan.rewrite(&mut rewriter).data()?;

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
        "index"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

struct IndexOptimizer {
    index_fields: HashSet<String>,
    index_condition: Arc<Mutex<Option<IndexCondition>>>,
    // set to true when the filter only have _timestamp filter
    can_optimize: bool,
    is_remove_filter: bool,
    optimizer_enabled: bool,
}

impl IndexOptimizer {
    pub fn new(
        index_fields: HashSet<String>,
        index_condition: Arc<Mutex<Option<IndexCondition>>>,
    ) -> Self {
        Self {
            index_fields,
            index_condition,
            can_optimize: false,
            is_remove_filter: config::get_config()
                .common
                .feature_query_remove_filter_with_index,
            optimizer_enabled: config::get_config()
                .common
                .inverted_index_count_optimizer_enabled,
        }
    }
}

impl TreeNodeRewriter for IndexOptimizer {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Self::Node) -> Result<Transformed<Self::Node>> {
        if let Some(filter) = node.as_any().downcast_ref::<FilterExec>() {
            let mut index_conditions = IndexCondition::new();
            let mut other_conditions = Vec::new();
            for expr in split_conjunction(filter.predicate()) {
                if is_expr_valid_for_index(expr, &self.index_fields) {
                    let condition = Condition::from_physical_expr(expr);
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
        match filter.projection() {
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
                Ok(Arc::new(ProjectionExec::try_new(
                    proj_exprs,
                    filter.input().clone(),
                )?))
            }
            None => Ok(filter.input().clone()),
        }
    } else {
        // TODO: remove the unused column after extract index condition
        let plan = FilterExec::try_new(conjunction(exprs), filter.input().clone())?
            .with_projection(filter.projection().cloned())?;
        Ok(Arc::new(plan))
    }
}

// Check if the expression is valid for the index.
fn is_expr_valid_for_index(expr: &Arc<dyn PhysicalExpr>, index_fields: &HashSet<String>) -> bool {
    if let Some(expr) = expr.as_any().downcast_ref::<BinaryExpr>() {
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
                return is_expr_valid_for_index(expr.left(), index_fields)
                    && is_expr_valid_for_index(expr.right(), index_fields);
            }
            _ => return false,
        }
    } else if let Some(expr) = expr.as_any().downcast_ref::<InListExpr>() {
        if !is_column(expr.expr()) || !index_fields.contains(get_column_name(expr.expr())) {
            return false;
        }

        for value in expr.list() {
            if !is_value(value) {
                return false;
            }
        }
    } else if let Some(expr) = expr.as_any().downcast_ref::<ScalarFunctionExpr>() {
        let name = expr.name();
        return match name {
            MATCH_ALL_UDF_NAME => expr.args().len() == 1,
            FUZZY_MATCH_ALL_UDF_NAME => expr.args().len() == 2,
            STR_MATCH_UDF_NAME
            | STR_MATCH_UDF_IGNORE_CASE_NAME
            | MATCH_FIELD_UDF_NAME
            | MATCH_FIELD_IGNORE_CASE_UDF_NAME => {
                expr.args().len() == 2 && index_fields.contains(get_column_name(&expr.args()[0]))
            }
            _ => false,
        };
    } else if let Some(expr) = expr.as_any().downcast_ref::<NotExpr>() {
        return is_expr_valid_for_index(expr.arg(), index_fields);
    } else {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, sync::Arc};

    use datafusion::{
        logical_expr::Operator,
        physical_expr::{
            PhysicalExpr,
            expressions::{BinaryExpr, Column, Literal},
        },
        scalar::ScalarValue,
    };

    use super::is_expr_valid_for_index;
    use crate::service::search::{
        datafusion::optimizer::physical_optimizer::utils::{
            get_column_name, is_column, is_only_timestamp_filter, is_value,
        },
        index::{Condition, IndexCondition},
    };

    // Helper function to create binary expression
    fn create_binary_expr(
        left: Arc<dyn PhysicalExpr>,
        op: Operator,
        right: Arc<dyn PhysicalExpr>,
    ) -> Arc<dyn PhysicalExpr> {
        Arc::new(BinaryExpr::new(left, op, right))
    }

    // Helper function to create column expression
    fn create_column_expr(name: &str) -> Arc<dyn PhysicalExpr> {
        Arc::new(Column::new(name, 0))
    }

    // Helper function to create literal expression
    fn create_literal_expr(value: ScalarValue) -> Arc<dyn PhysicalExpr> {
        Arc::new(Literal::new(value))
    }

    #[test]
    fn test_is_expr_valid_for_index_binary_eq() {
        let index_fields = HashSet::from(["name".to_string()]);

        // Valid: name = 'test'
        let name_col = create_column_expr("name");
        let test_literal = create_literal_expr(ScalarValue::Utf8(Some("test".to_string())));
        let eq_expr = create_binary_expr(name_col, Operator::Eq, test_literal.clone());

        assert!(is_expr_valid_for_index(&eq_expr, &index_fields));

        // Invalid: unknown_field = 'test'
        let unknown_col = create_column_expr("unknown_field");
        let unknown_eq_expr = create_binary_expr(unknown_col, Operator::Eq, test_literal);

        assert!(!is_expr_valid_for_index(&unknown_eq_expr, &index_fields));
    }

    #[test]
    fn test_is_expr_valid_for_index_binary_not_eq() {
        let index_fields = HashSet::from(["age".to_string()]);

        // Valid: age != 25
        let age_col = create_column_expr("age");
        let age_literal = create_literal_expr(ScalarValue::Int32(Some(25)));
        let not_eq_expr = create_binary_expr(age_col, Operator::NotEq, age_literal);

        assert!(is_expr_valid_for_index(&not_eq_expr, &index_fields));
    }

    #[test]
    fn test_is_expr_valid_for_index_binary_and() {
        let index_fields = HashSet::from(["name".to_string(), "age".to_string()]);

        // Valid: name = 'test' AND age = 25
        let name_col = create_column_expr("name");
        let name_literal = create_literal_expr(ScalarValue::Utf8(Some("test".to_string())));
        let name_eq = create_binary_expr(name_col, Operator::Eq, name_literal);

        let age_col = create_column_expr("age");
        let age_literal = create_literal_expr(ScalarValue::Int32(Some(25)));
        let age_eq = create_binary_expr(age_col, Operator::Eq, age_literal);

        let and_expr = create_binary_expr(name_eq, Operator::And, age_eq);

        assert!(is_expr_valid_for_index(&and_expr, &index_fields));
    }

    #[test]
    fn test_is_expr_valid_for_index_binary_or() {
        let index_fields = HashSet::from(["name".to_string()]);

        // Valid: name = 'test' OR name = 'other'
        let name_col1 = create_column_expr("name");
        let test_literal = create_literal_expr(ScalarValue::Utf8(Some("test".to_string())));
        let name_eq1 = create_binary_expr(name_col1, Operator::Eq, test_literal.clone());

        let name_col2 = create_column_expr("name");
        let other_literal = create_literal_expr(ScalarValue::Utf8(Some("other".to_string())));
        let name_eq2 = create_binary_expr(name_col2, Operator::Eq, other_literal);

        let or_expr = create_binary_expr(name_eq1, Operator::Or, name_eq2);

        assert!(is_expr_valid_for_index(&or_expr, &index_fields));
    }

    #[test]
    fn test_is_expr_valid_for_index_invalid_operators() {
        let index_fields = HashSet::from(["name".to_string()]);

        // Invalid: name > 'test' (not supported for index)
        let name_col = create_column_expr("name");
        let test_literal = create_literal_expr(ScalarValue::Utf8(Some("test".to_string())));
        let gt_expr = create_binary_expr(name_col, Operator::Gt, test_literal);

        assert!(!is_expr_valid_for_index(&gt_expr, &index_fields));
    }

    // Note: construct_filter_exec tests are skipped due to complex DataFusion setup requirements
    // These would require proper FilterExec creation with valid schemas and expressions

    #[test]
    fn test_index_condition_from_physical_expr_equal() {
        let name_col = create_column_expr("name");
        let test_literal = create_literal_expr(ScalarValue::Utf8(Some("test".to_string())));
        let eq_expr = create_binary_expr(name_col, Operator::Eq, test_literal);

        let condition = Condition::from_physical_expr(&eq_expr);

        match condition {
            Condition::Equal(field, value) => {
                assert_eq!(field, "name");
                assert_eq!(value, "test");
            }
            _ => panic!("Expected Equal condition"),
        }
    }

    #[test]
    fn test_index_condition_from_physical_expr_not_equal() {
        let age_col = create_column_expr("age");
        let age_literal = create_literal_expr(ScalarValue::Utf8(Some("25".to_string())));
        let not_eq_expr = create_binary_expr(age_col, Operator::NotEq, age_literal);

        let condition = Condition::from_physical_expr(&not_eq_expr);

        match condition {
            Condition::NotEqual(field, value) => {
                assert_eq!(field, "age");
                assert_eq!(value, "25");
            }
            _ => panic!("Expected NotEqual condition"),
        }
    }

    #[test]
    fn test_index_condition_add_condition() {
        let mut index_condition = IndexCondition::new();

        let condition1 = Condition::Equal("name".to_string(), "test".to_string());
        let condition2 = Condition::Equal("age".to_string(), "25".to_string());

        index_condition.add_condition(condition1);
        index_condition.add_condition(condition2);

        assert!(!index_condition.is_empty());
        assert_eq!(index_condition.conditions.len(), 2);
    }

    #[test]
    fn test_index_condition_can_remove_filter() {
        let mut index_condition = IndexCondition::new();

        // With no conditions, should be able to remove filter (empty condition means all)
        assert!(index_condition.can_remove_filter());

        // With conditions, should be able to remove filter
        let condition = Condition::Equal("name".to_string(), "test".to_string());
        index_condition.add_condition(condition);
        assert!(index_condition.can_remove_filter());
    }

    #[test]
    fn test_is_only_timestamp_filter() {
        // Create timestamp filter expressions
        let timestamp_col = create_column_expr("_timestamp");
        let timestamp_literal = create_literal_expr(ScalarValue::Int64(Some(1234567890)));
        let timestamp_gt = create_binary_expr(
            timestamp_col.clone(),
            Operator::Gt,
            timestamp_literal.clone(),
        );
        let timestamp_lt = create_binary_expr(timestamp_col, Operator::Lt, timestamp_literal);

        let timestamp_filters = vec![&timestamp_gt, &timestamp_lt];
        assert!(is_only_timestamp_filter(&timestamp_filters));

        // Create non-timestamp filter
        let name_col = create_column_expr("name");
        let name_literal = create_literal_expr(ScalarValue::Utf8(Some("test".to_string())));
        let name_eq = create_binary_expr(name_col, Operator::Eq, name_literal);

        let mixed_filters = vec![&timestamp_gt, &name_eq];
        assert!(!is_only_timestamp_filter(&mixed_filters));
    }

    #[test]
    fn test_utils_functions() {
        // Test is_column
        let name_col = create_column_expr("name");
        assert!(is_column(&name_col));

        let test_literal = create_literal_expr(ScalarValue::Utf8(Some("test".to_string())));
        assert!(!is_column(&test_literal));

        // Test get_column_name
        assert_eq!(get_column_name(&name_col), "name");
        assert_eq!(get_column_name(&test_literal), "__o2_unknown_column__");

        // Test is_value
        assert!(!is_value(&name_col));
        assert!(is_value(&test_literal));
    }
}
