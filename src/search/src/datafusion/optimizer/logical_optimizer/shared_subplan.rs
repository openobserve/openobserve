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

use std::collections::{HashMap, HashSet};

use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TreeNodeRecursion},
    },
    logical_expr::LogicalPlan,
    optimizer::{OptimizerConfig, OptimizerRule, optimizer::ApplyOrder},
};

use crate::datafusion::plan::shared_subplan::SharedSubplanNode;

/// Unwraps a shared subplan whose copies stopped matching after the other rules ran.
#[derive(Debug, Default)]
pub struct StripDivergedSharedSubplanRule;

impl StripDivergedSharedSubplanRule {
    pub fn new() -> Self {
        Self
    }
}

impl OptimizerRule for StripDivergedSharedSubplanRule {
    fn name(&self) -> &str {
        "strip_diverged_shared_subplan"
    }

    fn apply_order(&self) -> Option<ApplyOrder> {
        None
    }

    fn supports_rewrite(&self) -> bool {
        true
    }

    fn rewrite(
        &self,
        plan: LogicalPlan,
        _config: &dyn OptimizerConfig,
    ) -> Result<Transformed<LogicalPlan>> {
        let diverged = diverged_ids(&plan)?;
        if diverged.is_empty() {
            return Ok(Transformed::no(plan));
        }
        plan.transform_down_with_subqueries(|node| {
            let Some(shared) = shared_node(&node) else {
                return Ok(Transformed::no(node));
            };
            if !diverged.contains(&shared.id) {
                return Ok(Transformed::no(node));
            }
            Ok(Transformed::yes(shared.input.clone()))
        })
    }
}

pub fn shared_node(plan: &LogicalPlan) -> Option<&SharedSubplanNode> {
    let LogicalPlan::Extension(extension) = plan else {
        return None;
    };
    extension.node.as_any().downcast_ref::<SharedSubplanNode>()
}

// An id is diverged when fewer than two copies remain or their inputs differ.
fn diverged_ids(plan: &LogicalPlan) -> Result<HashSet<u64>> {
    let mut copies: HashMap<u64, (LogicalPlan, usize, bool)> = HashMap::new();
    plan.apply_with_subqueries(|node| {
        if let Some(shared) = shared_node(node) {
            let entry = copies
                .entry(shared.id)
                .or_insert_with(|| (shared.input.clone(), 0, true));
            entry.1 += 1;
            entry.2 &= entry.0 == shared.input;
        }
        Ok(TreeNodeRecursion::Continue)
    })?;
    Ok(copies
        .into_iter()
        .filter(|(_, (_, count, same))| *count < 2 || !*same)
        .map(|(id, _)| id)
        .collect())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use datafusion::{
        logical_expr::{Extension, JoinType, LogicalPlanBuilder, lit, table_scan},
        optimizer::OptimizerContext,
        prelude::col,
    };

    use super::*;

    fn scan() -> LogicalPlan {
        let schema = arrow_schema::Schema::new(vec![
            arrow_schema::Field::new("name", arrow_schema::DataType::Utf8, false),
            arrow_schema::Field::new("v", arrow_schema::DataType::Int64, false),
        ]);
        table_scan(Some("t"), &schema, None)
            .unwrap()
            .build()
            .unwrap()
    }

    fn shared(id: u64, input: LogicalPlan) -> LogicalPlan {
        LogicalPlan::Extension(Extension {
            node: Arc::new(SharedSubplanNode::new(id, input)),
        })
    }

    fn join(left: LogicalPlan, right: LogicalPlan) -> LogicalPlan {
        let left = LogicalPlanBuilder::from(left)
            .alias("c1")
            .unwrap()
            .build()
            .unwrap();
        let right = LogicalPlanBuilder::from(right)
            .alias("c2")
            .unwrap()
            .build()
            .unwrap();
        LogicalPlanBuilder::from(left)
            .join(right, JoinType::Inner, (vec!["name"], vec!["name"]), None)
            .unwrap()
            .build()
            .unwrap()
    }

    fn rewrite(plan: LogicalPlan) -> String {
        StripDivergedSharedSubplanRule::new()
            .rewrite(plan, &OptimizerContext::new())
            .unwrap()
            .data
            .display_indent()
            .to_string()
    }

    #[test]
    fn identical_copies_are_kept() {
        let cte = LogicalPlanBuilder::from(scan())
            .alias("c")
            .unwrap()
            .build()
            .unwrap();
        let plan = rewrite(join(shared(1, cte.clone()), shared(1, cte)));
        assert_eq!(plan.matches("SharedSubplan: id=1").count(), 2, "{plan}");
    }

    #[test]
    fn diverged_copies_are_unwrapped() {
        let cte = LogicalPlanBuilder::from(scan())
            .alias("c")
            .unwrap()
            .build()
            .unwrap();
        let filtered = LogicalPlanBuilder::from(scan())
            .filter(col("v").gt(lit(1)))
            .unwrap()
            .alias("c")
            .unwrap()
            .build()
            .unwrap();
        let plan = rewrite(join(shared(1, cte), shared(1, filtered)));
        assert!(!plan.contains("SharedSubplan"), "{plan}");
        assert!(plan.contains("Filter: t.v > Int32(1)"), "{plan}");
    }

    #[test]
    fn single_copy_is_unwrapped() {
        let cte = LogicalPlanBuilder::from(scan())
            .alias("c")
            .unwrap()
            .build()
            .unwrap();
        let plan = rewrite(join(shared(1, cte), scan()));
        assert!(!plan.contains("SharedSubplan"), "{plan}");
    }
}
