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

use std::{collections::HashSet, fmt};

use datafusion::{
    common::{Column, DFSchemaRef, Result, plan_err},
    logical_expr::{
        Distinct, Expr, Join, JoinType, LogicalPlan, UserDefinedLogicalNodeCore, Window,
    },
};

pub const SHARED_SUBPLAN_NODE_NAME: &str = "SharedSubplan";

/// Marks a subplan referenced several times so the physical plan executes it once.
#[derive(Debug, PartialEq, Eq, Hash, PartialOrd)]
pub struct SharedSubplanNode {
    pub id: u64,
    pub input: LogicalPlan,
    unpushable_columns: Vec<String>,
}

impl SharedSubplanNode {
    pub fn new(id: u64, input: LogicalPlan) -> Self {
        let mut unpushable_columns = unpushable_columns(&input);
        unpushable_columns.sort_unstable();
        Self {
            id,
            input,
            unpushable_columns,
        }
    }
}

impl UserDefinedLogicalNodeCore for SharedSubplanNode {
    fn name(&self) -> &str {
        SHARED_SUBPLAN_NODE_NAME
    }

    fn inputs(&self) -> Vec<&LogicalPlan> {
        vec![&self.input]
    }

    fn schema(&self) -> &DFSchemaRef {
        self.input.schema()
    }

    fn expressions(&self) -> Vec<Expr> {
        vec![]
    }

    // A predicate on these columns cannot reach the scan, keeping it above keeps the copies equal.
    fn prevent_predicate_push_down_columns(&self) -> HashSet<String> {
        self.unpushable_columns.iter().cloned().collect()
    }

    fn fmt_for_explain(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{SHARED_SUBPLAN_NODE_NAME}: id={}", self.id)
    }

    fn with_exprs_and_inputs(&self, _exprs: Vec<Expr>, inputs: Vec<LogicalPlan>) -> Result<Self> {
        let Some(input) = inputs.into_iter().next() else {
            return plan_err!("{SHARED_SUBPLAN_NODE_NAME} requires exactly one input");
        };
        Ok(Self::new(self.id, input))
    }
}

/// Output columns of `plan` on which a filter would not reach a table scan anyway.
pub fn unpushable_columns(plan: &LogicalPlan) -> Vec<String> {
    plan.schema()
        .fields()
        .iter()
        .enumerate()
        .filter(|(index, _)| !pushable(plan, *index))
        .map(|(_, field)| field.name().clone())
        .collect()
}

// Conservative mirror of PushDownFilter: pushable means a predicate on it can reach a scan.
fn pushable(plan: &LogicalPlan, index: usize) -> bool {
    match plan {
        LogicalPlan::TableScan(_) | LogicalPlan::EmptyRelation(_) | LogicalPlan::Values(_) => true,
        LogicalPlan::SubqueryAlias(alias) => pushable(&alias.input, index),
        LogicalPlan::Filter(filter) => pushable(&filter.input, index),
        LogicalPlan::Sort(sort) => sort.fetch.is_none() && pushable(&sort.input, index),
        LogicalPlan::Distinct(Distinct::All(input)) => pushable(input, index),
        LogicalPlan::Projection(projection) => projection
            .expr
            .get(index)
            .is_some_and(|expr| refs_pushable(expr, &projection.input)),
        LogicalPlan::Aggregate(aggregate) => {
            !aggregate
                .group_expr
                .iter()
                .any(|expr| matches!(expr, Expr::GroupingSet(_)))
                && aggregate
                    .group_expr
                    .get(index)
                    .is_some_and(|expr| refs_pushable(expr, &aggregate.input))
        }
        LogicalPlan::Window(window) => window_pushable(window, index),
        LogicalPlan::Join(join) => join_pushable(join, index),
        LogicalPlan::Union(union) => union.inputs.iter().all(|input| pushable(input, index)),
        _ => false,
    }
}

fn refs_pushable(expr: &Expr, input: &LogicalPlan) -> bool {
    if expr.is_volatile() {
        return false;
    }
    expr.column_refs().iter().all(|column| {
        input
            .schema()
            .index_of_column_by_name(column.relation.as_ref(), &column.name)
            .is_some_and(|index| pushable(input, index))
    })
}

// PushDownFilter only moves predicates through a window on columns every window partitions by.
fn window_pushable(window: &Window, index: usize) -> bool {
    let input_schema = window.input.schema();
    if index >= input_schema.fields().len() {
        return false;
    }
    let (qualifier, field) = input_schema.qualified_field(index);
    let column = Column::new(qualifier.cloned(), field.name());
    window
        .window_expr
        .iter()
        .all(|expr| partition_columns(expr).contains(&column))
        && pushable(&window.input, index)
}

fn partition_columns(expr: &Expr) -> HashSet<Column> {
    let func = match expr {
        Expr::WindowFunction(func) => func,
        Expr::Alias(alias) => match alias.expr.as_ref() {
            Expr::WindowFunction(func) => func,
            _ => return HashSet::new(),
        },
        _ => return HashSet::new(),
    };
    func.params
        .partition_by
        .iter()
        .filter_map(|expr| match expr {
            Expr::Column(column) => Some(column.clone()),
            _ => None,
        })
        .collect()
}

fn join_pushable(join: &Join, index: usize) -> bool {
    let left_len = join.left.schema().fields().len();
    match join.join_type {
        JoinType::Inner => {
            if index < left_len {
                pushable(&join.left, index)
            } else {
                pushable(&join.right, index - left_len)
            }
        }
        JoinType::Left | JoinType::LeftSemi | JoinType::LeftAnti => {
            index < left_len && pushable(&join.left, index)
        }
        JoinType::Right => index >= left_len && pushable(&join.right, index - left_len),
        JoinType::RightSemi | JoinType::RightAnti => pushable(&join.right, index),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{
        functions_aggregate::expr_fn::{count, sum},
        logical_expr::{LogicalPlanBuilder, lit, table_scan},
        prelude::col,
    };

    use super::*;

    fn scan() -> LogicalPlan {
        let schema = Schema::new(vec![
            Field::new("name", DataType::Utf8, false),
            Field::new("id", DataType::Utf8, false),
            Field::new("v", DataType::Int64, false),
        ]);
        table_scan(Some("t"), &schema, None)
            .unwrap()
            .build()
            .unwrap()
    }

    fn aggregate_cte() -> LogicalPlan {
        LogicalPlanBuilder::from(scan())
            .filter(col("id").eq(lit("x")))
            .unwrap()
            .aggregate(
                vec![col("name")],
                vec![count(lit(1)).alias("cnt"), sum(col("v")).alias("sv")],
            )
            .unwrap()
            .project(vec![col("name"), col("cnt"), col("sv")])
            .unwrap()
            .alias("c")
            .unwrap()
            .build()
            .unwrap()
    }

    #[test]
    fn aggregate_outputs_are_unpushable_but_group_keys_are_pushable() {
        assert_eq!(unpushable_columns(&aggregate_cte()), vec!["cnt", "sv"]);
    }

    #[test]
    fn plain_projection_is_fully_pushable() {
        let plan = LogicalPlanBuilder::from(scan())
            .project(vec![col("name"), (col("v") + lit(1)).alias("v1")])
            .unwrap()
            .alias("c")
            .unwrap()
            .build()
            .unwrap();
        assert!(unpushable_columns(&plan).is_empty());
    }

    #[test]
    fn limit_blocks_every_column() {
        let plan = LogicalPlanBuilder::from(scan())
            .limit(0, Some(10))
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(unpushable_columns(&plan), vec!["name", "id", "v"]);
    }

    #[test]
    fn left_join_blocks_right_side_columns() {
        let right = LogicalPlanBuilder::from(scan())
            .alias("r")
            .unwrap()
            .build()
            .unwrap();
        let plan = LogicalPlanBuilder::from(scan())
            .join(right, JoinType::Left, (vec!["name"], vec!["name"]), None)
            .unwrap()
            .build()
            .unwrap();
        assert_eq!(unpushable_columns(&plan), vec!["name", "id", "v"]);
        assert_eq!(plan.schema().fields().len(), 6);
    }

    #[test]
    fn node_keeps_id_and_recomputes_columns_on_new_input() {
        let node = SharedSubplanNode::new(7, aggregate_cte());
        assert_eq!(node.id, 7);
        let rebuilt = node.with_exprs_and_inputs(vec![], vec![scan()]).unwrap();
        assert_eq!(rebuilt.id, 7);
        assert!(rebuilt.prevent_predicate_push_down_columns().is_empty());
        assert_eq!(
            node.prevent_predicate_push_down_columns(),
            HashSet::from(["cnt".to_string(), "sv".to_string()])
        );
    }
}
