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

use std::{
    collections::{HashMap, HashSet},
    hash::{DefaultHasher, Hash, Hasher},
    sync::Arc,
};

use datafusion::{
    common::{
        Column, Result,
        tree_node::{Transformed, TransformedResult, TreeNode, TreeNodeRecursion},
    },
    config::ConfigOptions,
    logical_expr::{Expr, Extension, FetchType, LogicalPlan, LogicalPlanBuilder},
    optimizer::AnalyzerRule,
};

use crate::datafusion::plan::shared_subplan::SharedSubplanNode;

// A limited subplan is worth materializing only while its result stays small.
const MAX_SHARED_FETCH: usize = 1_000_000;

/// Wraps every expensive subquery alias that appears more than once in a shared subplan node.
#[derive(Debug, Default)]
pub struct MarkSharedSubplanRule;

impl MarkSharedSubplanRule {
    pub fn new() -> Self {
        Self
    }
}

impl AnalyzerRule for MarkSharedSubplanRule {
    fn name(&self) -> &str {
        "mark_shared_subplan"
    }

    fn analyze(&self, plan: LogicalPlan, _config: &ConfigOptions) -> Result<LogicalPlan> {
        let shared = shared_candidates(&plan)?;
        if shared.is_empty() {
            return Ok(plan);
        }
        let used = used_column_names(&plan, &shared)?;
        let mut ids: HashMap<u64, u64> = HashMap::new();
        let mut pruned = false;
        let plan = plan.transform_down_with_subqueries(|node| {
            if !is_shared(&node, &shared) {
                return Ok(Transformed::no(node));
            }
            let next_id = ids.len() as u64 + 1;
            let id = *ids.entry(plan_hash(&node)).or_insert(next_id);
            let width = node.schema().fields().len();
            let body = prune_columns(node, &used)?;
            pruned |= body.schema().fields().len() < width;
            let wrapped = LogicalPlan::Extension(Extension {
                node: Arc::new(SharedSubplanNode::new(id, body)),
            });
            // Nested shares are not supported, the wrapped subtree is left as is.
            Ok(Transformed::new(wrapped, true, TreeNodeRecursion::Jump))
        })?;
        if !pruned {
            return Ok(plan.data);
        }
        // transform_down keeps the cached schemas above the narrower body, so rebuild them.
        plan.data
            .transform_up_with_subqueries(|node| node.recompute_schema().map(Transformed::yes))
            .data()
    }
}

fn shared_candidates(plan: &LogicalPlan) -> Result<HashMap<u64, LogicalPlan>> {
    let mut seen: HashMap<u64, (LogicalPlan, usize)> = HashMap::new();
    // Subqueries count too: decorrelation turns them into joins over the same copy.
    plan.apply_with_subqueries(|node| {
        if matches!(node, LogicalPlan::SubqueryAlias(_)) && is_expensive(node)? {
            let hash = plan_hash(node);
            match seen.get_mut(&hash) {
                Some((first, count)) if first == node => *count += 1,
                Some(_) => {}
                None => {
                    seen.insert(hash, (node.clone(), 1));
                }
            }
        }
        Ok(TreeNodeRecursion::Continue)
    })?;
    Ok(seen
        .into_iter()
        .filter(|(_, (_, count))| *count > 1)
        .map(|(hash, (plan, _))| (hash, plan))
        .collect())
}

fn is_shared(node: &LogicalPlan, shared: &HashMap<u64, LogicalPlan>) -> bool {
    matches!(node, LogicalPlan::SubqueryAlias(_))
        && shared
            .get(&plan_hash(node))
            .is_some_and(|first| first == node)
}

// Column names referenced outside the shared subtrees, so the shared body computes only those.
fn used_column_names(
    plan: &LogicalPlan,
    shared: &HashMap<u64, LogicalPlan>,
) -> Result<HashSet<String>> {
    let mut names = HashSet::new();
    plan.apply_with_subqueries(|node| {
        if is_shared(node, shared) {
            return Ok(TreeNodeRecursion::Jump);
        }
        node.apply_expressions(|expr| {
            expr.apply(|expr| {
                if let Expr::Column(column) | Expr::OuterReferenceColumn(_, column) = expr {
                    names.insert(column.name.clone());
                }
                Ok(TreeNodeRecursion::Continue)
            })
        })?;
        Ok(TreeNodeRecursion::Continue)
    })?;
    Ok(names)
}

fn prune_columns(plan: LogicalPlan, used: &HashSet<String>) -> Result<LogicalPlan> {
    let schema = plan.schema();
    let keep: Vec<Expr> = schema
        .iter()
        .filter(|(_, field)| used.contains(field.name()))
        .map(|(qualifier, field)| Expr::Column(Column::from((qualifier, field.as_ref()))))
        .collect();
    if keep.is_empty() || keep.len() == schema.fields().len() {
        return Ok(plan);
    }
    LogicalPlanBuilder::from(plan).project(keep)?.build()
}

// Sharing pays off only when the subplan breaks the pipeline; a plain scan is cheaper inlined.
fn is_expensive(plan: &LogicalPlan) -> Result<bool> {
    let breaks_pipeline = plan.exists(|node| {
        Ok(match node {
            LogicalPlan::Aggregate(_)
            | LogicalPlan::Window(_)
            | LogicalPlan::Distinct(_)
            | LogicalPlan::Join(_) => true,
            LogicalPlan::Limit(limit) => {
                matches!(limit.get_fetch_type()?, FetchType::Literal(Some(fetch)) if fetch <= MAX_SHARED_FETCH)
            }
            LogicalPlan::Sort(sort) => sort.fetch.is_some_and(|fetch| fetch <= MAX_SHARED_FETCH),
            _ => false,
        })
    })?;
    Ok(breaks_pipeline && plan.exists(|node| Ok(matches!(node, LogicalPlan::TableScan(_))))?)
}

fn plan_hash(plan: &LogicalPlan) -> u64 {
    let mut hasher = DefaultHasher::new();
    plan.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use datafusion::{
        logical_expr::{JoinType, LogicalPlanBuilder, lit, table_scan},
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

    fn cte(aggregate: bool) -> LogicalPlan {
        let builder = LogicalPlanBuilder::from(scan());
        let builder = if aggregate {
            builder
                .aggregate(
                    vec![col("name")],
                    vec![datafusion::functions_aggregate::expr_fn::sum(col("v")).alias("sv")],
                )
                .unwrap()
        } else {
            builder.filter(col("v").gt(lit(1))).unwrap()
        };
        builder.alias("c").unwrap().build().unwrap()
    }

    fn self_join(cte: LogicalPlan, aliases: (&str, &str)) -> LogicalPlan {
        let left = LogicalPlanBuilder::from(cte.clone())
            .alias(aliases.0)
            .unwrap()
            .build()
            .unwrap();
        let right = LogicalPlanBuilder::from(cte)
            .alias(aliases.1)
            .unwrap()
            .build()
            .unwrap();
        LogicalPlanBuilder::from(left)
            .join(right, JoinType::Inner, (vec!["name"], vec!["name"]), None)
            .unwrap()
            .build()
            .unwrap()
    }

    fn analyze(plan: LogicalPlan) -> String {
        MarkSharedSubplanRule::new()
            .analyze(plan, &ConfigOptions::new())
            .unwrap()
            .display_indent()
            .to_string()
    }

    #[test]
    fn duplicated_aggregate_cte_is_wrapped_once_per_reference() {
        let plan = analyze(self_join(cte(true), ("c1", "c2")));
        assert_eq!(plan.matches("SharedSubplan: id=1").count(), 2, "{plan}");
        assert!(!plan.contains("id=2"), "{plan}");
    }

    #[test]
    fn plain_filter_cte_is_left_inlined() {
        let plan = analyze(self_join(cte(false), ("c1", "c2")));
        assert!(!plan.contains("SharedSubplan"), "{plan}");
    }

    #[test]
    fn single_reference_is_not_wrapped() {
        let plan = analyze(cte(true));
        assert!(!plan.contains("SharedSubplan"), "{plan}");
    }

    fn pruned_self_join() -> LogicalPlan {
        let cte = LogicalPlanBuilder::from(scan())
            .aggregate(
                vec![col("name")],
                vec![
                    datafusion::functions_aggregate::expr_fn::sum(col("v")).alias("sv"),
                    datafusion::functions_aggregate::expr_fn::count(lit(1)).alias("cnt"),
                ],
            )
            .unwrap()
            .alias("c")
            .unwrap()
            .build()
            .unwrap();
        LogicalPlanBuilder::from(self_join(cte, ("c1", "c2")))
            .project(vec![col("c1.name"), col("c2.sv")])
            .unwrap()
            .build()
            .unwrap()
    }

    #[test]
    fn shared_body_is_pruned_to_the_columns_used_outside() {
        let plan = analyze(pruned_self_join());
        assert_eq!(
            plan.matches("Projection: c.name, c.sv\n").count(),
            2,
            "{plan}"
        );
        assert!(!plan.contains("Projection: c.name, c.sv, c.cnt"), "{plan}");
    }

    #[test]
    fn pruning_rebuilds_the_schemas_above_the_shared_body() {
        let plan = MarkSharedSubplanRule::new()
            .analyze(pruned_self_join(), &ConfigOptions::new())
            .unwrap();
        plan.apply(|node| {
            if let LogicalPlan::SubqueryAlias(alias) = node {
                assert_eq!(
                    alias.schema.fields().len(),
                    alias.input.schema().fields().len(),
                    "{alias:?}"
                );
            }
            Ok(TreeNodeRecursion::Continue)
        })
        .unwrap();
        assert_eq!(plan.inputs()[0].schema().fields().len(), 4, "{plan}");
    }

    #[test]
    fn large_limit_is_left_inlined() {
        let cte = LogicalPlanBuilder::from(scan())
            .limit(0, Some(MAX_SHARED_FETCH + 1))
            .unwrap()
            .alias("c")
            .unwrap()
            .build()
            .unwrap();
        let plan = analyze(self_join(cte, ("c1", "c2")));
        assert!(!plan.contains("SharedSubplan"), "{plan}");
        let cte = LogicalPlanBuilder::from(scan())
            .limit(0, Some(10))
            .unwrap()
            .alias("c")
            .unwrap()
            .build()
            .unwrap();
        let plan = analyze(self_join(cte, ("c1", "c2")));
        assert_eq!(plan.matches("SharedSubplan: id=1").count(), 2, "{plan}");
    }

    #[test]
    fn different_ctes_get_different_ids() {
        let other = LogicalPlanBuilder::from(scan())
            .aggregate(
                vec![col("name")],
                vec![datafusion::functions_aggregate::expr_fn::count(lit(1)).alias("cnt")],
            )
            .unwrap()
            .alias("d")
            .unwrap()
            .build()
            .unwrap();
        let plan = LogicalPlanBuilder::from(self_join(cte(true), ("c1", "c2")))
            .join(
                self_join(other, ("d1", "d2")),
                JoinType::Inner,
                (vec!["c1.name"], vec!["d1.name"]),
                None,
            )
            .unwrap()
            .build()
            .unwrap();
        let plan = analyze(plan);
        assert_eq!(plan.matches("SharedSubplan: id=1").count(), 2, "{plan}");
        assert_eq!(plan.matches("SharedSubplan: id=2").count(), 2, "{plan}");
    }
}
