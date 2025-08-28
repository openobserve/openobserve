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

use std::{collections::HashSet, sync::Arc};

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
        expressions::{BinaryExpr, Column, InListExpr, Literal, NotExpr},
        filter::FilterExec,
        projection::ProjectionExec,
    },
};
use parking_lot::Mutex;

use crate::service::search::{
    datafusion::udf::{
        MATCH_FIELD_IGNORE_CASE_UDF_NAME, MATCH_FIELD_UDF_NAME, STR_MATCH_UDF_IGNORE_CASE_NAME,
        STR_MATCH_UDF_NAME,
        match_all_udf::{FUZZY_MATCH_ALL_UDF_NAME, MATCH_ALL_UDF_NAME},
    },
    index::{Condition, IndexCondition},
};

#[derive(Default, Debug)]
pub struct IndexRule {
    index_fields: HashSet<String>,
    index_condition: Arc<Mutex<Option<IndexCondition>>>,
}

impl IndexRule {
    pub fn new(
        index_fields: HashSet<String>,
        index_condition: Arc<Mutex<Option<IndexCondition>>>,
    ) -> Self {
        Self {
            index_fields,
            index_condition,
        }
    }
}

impl PhysicalOptimizerRule for IndexRule {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let mut rewriter =
            IndexOptimizer::new(self.index_fields.clone(), self.index_condition.clone());
        plan.rewrite(&mut rewriter).data()
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
}

impl IndexOptimizer {
    pub fn new(
        index_fields: HashSet<String>,
        index_condition: Arc<Mutex<Option<IndexCondition>>>,
    ) -> Self {
        Self {
            index_fields,
            index_condition,
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

            if !index_conditions.is_empty() {
                *self.index_condition.lock() = Some(index_conditions);
            }

            let plan = construct_filter_exec(filter, other_conditions)?;
            return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
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
    }
    true
}

fn is_column(expr: &Arc<dyn PhysicalExpr>) -> bool {
    expr.as_any().downcast_ref::<Column>().is_some()
}

fn get_column_name(expr: &Arc<dyn PhysicalExpr>) -> &str {
    expr.as_any().downcast_ref::<Column>().unwrap().name()
}

fn is_value(expr: &Arc<dyn PhysicalExpr>) -> bool {
    expr.as_any().downcast_ref::<Literal>().is_some()
}
