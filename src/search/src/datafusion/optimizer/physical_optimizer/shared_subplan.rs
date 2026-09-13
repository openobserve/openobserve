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
    sync::Arc,
};

use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TransformedResult, TreeNode, TreeNodeRecursion},
    },
    config::ConfigOptions,
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{ExecutionPlan, displayable},
};

use crate::datafusion::{
    distributed_plan::remote_scan_exec::RemoteScanExec,
    plan::shared_subplan_exec::{SharedSubplanExec, SharedSubplanMarkerExec},
};

/// Replaces the markers of one shared subplan by a single producer and one reader per other copy.
#[derive(Debug, Default)]
pub struct SharedSubplanRule {
    memory_limit: Option<usize>,
}

impl SharedSubplanRule {
    pub fn new() -> Self {
        Self::default()
    }

    // Overrides the pool-derived materialization budget, meant for tests.
    pub fn with_memory_limit(memory_limit: Option<usize>) -> Self {
        Self { memory_limit }
    }
}

impl PhysicalOptimizerRule for SharedSubplanRule {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let groups = marker_groups(&plan)?;
        if groups.is_empty() {
            return Ok(plan);
        }
        let shareable: HashSet<u64> = groups
            .iter()
            .filter(|(_, inputs)| inputs.len() > 1 && same_plan(inputs))
            .map(|(id, _)| *id)
            .collect();
        let mut producers: HashMap<u64, Arc<SharedSubplanExec>> = HashMap::new();
        plan.transform_down(|node| {
            if is_remote_boundary(&node) {
                return Ok(Transformed::new(node, false, TreeNodeRecursion::Jump));
            }
            let Some(marker) = node.downcast_ref::<SharedSubplanMarkerExec>() else {
                return Ok(Transformed::no(node));
            };
            let id = marker.id();
            if !shareable.contains(&id) {
                return Ok(Transformed::yes(Arc::clone(marker.input())));
            }
            let replacement: Arc<dyn ExecutionPlan> = match producers.get(&id) {
                Some(producer) => Arc::new(producer.reader()),
                None => {
                    let producer = Arc::new(SharedSubplanExec::new(
                        id,
                        groups[&id].len(),
                        self.memory_limit,
                        Arc::clone(marker.input()),
                    ));
                    producers.insert(id, Arc::clone(&producer));
                    producer
                }
            };
            Ok(Transformed::yes(replacement))
        })
        .data()
    }

    fn name(&self) -> &str {
        "SharedSubplanRule"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

fn marker_groups(
    plan: &Arc<dyn ExecutionPlan>,
) -> Result<HashMap<u64, Vec<Arc<dyn ExecutionPlan>>>> {
    let mut groups: HashMap<u64, Vec<Arc<dyn ExecutionPlan>>> = HashMap::new();
    plan.apply(|node| {
        if is_remote_boundary(node) {
            return Ok(TreeNodeRecursion::Jump);
        }
        if let Some(marker) = node.downcast_ref::<SharedSubplanMarkerExec>() {
            groups
                .entry(marker.id())
                .or_default()
                .push(Arc::clone(marker.input()));
        }
        Ok(TreeNodeRecursion::Continue)
    })?;
    Ok(groups)
}

// A remote scan re-serializes its fragment, which only the marker survives; the follower drops it.
fn is_remote_boundary(plan: &Arc<dyn ExecutionPlan>) -> bool {
    plan.downcast_ref::<RemoteScanExec>().is_some()
}

// The physical rules ran on every copy independently, sharing needs them to still be identical.
fn same_plan(inputs: &[Arc<dyn ExecutionPlan>]) -> bool {
    let first = plan_signature(&inputs[0]);
    inputs[1..]
        .iter()
        .all(|input| input.schema() == inputs[0].schema() && plan_signature(input) == first)
}

fn plan_signature(plan: &Arc<dyn ExecutionPlan>) -> String {
    displayable(plan.as_ref()).indent(true).to_string()
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{
        common::ScalarValue,
        logical_expr::Operator,
        physical_plan::{
            empty::EmptyExec,
            expressions::{BinaryExpr, Column, Literal},
            filter::FilterExec,
            union::UnionExec,
        },
    };

    use super::*;
    use crate::datafusion::{
        distributed_plan::node::RemoteScanNode, plan::shared_subplan_exec::SharedSubplanReaderExec,
    };

    #[derive(Debug)]
    struct TestNode;

    impl config::meta::cluster::NodeInfo for TestNode {
        fn get_grpc_addr(&self) -> String {
            "localhost:9090".to_string()
        }
        fn get_auth_token(&self) -> String {
            "token".to_string()
        }
        fn get_name(&self) -> String {
            "test-node".to_string()
        }
        fn is_local(&self) -> bool {
            true
        }
    }

    fn schema() -> Arc<Schema> {
        Arc::new(Schema::new(vec![Field::new("v", DataType::Int64, false)]))
    }

    fn marker(id: u64, input: Arc<dyn ExecutionPlan>) -> Arc<dyn ExecutionPlan> {
        Arc::new(SharedSubplanMarkerExec::new(id, input))
    }

    fn filtered(value: i64) -> Arc<dyn ExecutionPlan> {
        let predicate = Arc::new(BinaryExpr::new(
            Arc::new(Column::new("v", 0)),
            Operator::Gt,
            Arc::new(Literal::new(ScalarValue::Int64(Some(value)))),
        ));
        Arc::new(FilterExec::try_new(predicate, Arc::new(EmptyExec::new(schema()))).unwrap())
    }

    fn count<T: ExecutionPlan + 'static>(plan: &Arc<dyn ExecutionPlan>) -> usize {
        let mut count = 0;
        plan.apply(|node| {
            if node.downcast_ref::<T>().is_some() {
                count += 1;
            }
            Ok(TreeNodeRecursion::Continue)
        })
        .unwrap();
        count
    }

    #[test]
    fn identical_markers_become_one_producer_and_readers() {
        let plan = UnionExec::try_new(vec![
            marker(1, filtered(1)),
            marker(1, filtered(1)),
            marker(1, filtered(1)),
        ])
        .unwrap();
        let plan = SharedSubplanRule::new()
            .optimize(plan, &ConfigOptions::new())
            .unwrap();
        assert_eq!(count::<SharedSubplanExec>(&plan), 1);
        assert_eq!(count::<SharedSubplanReaderExec>(&plan), 2);
        assert_eq!(count::<SharedSubplanMarkerExec>(&plan), 0);
        assert_eq!(count::<FilterExec>(&plan), 1);
        let producer = plan.children()[0]
            .downcast_ref::<SharedSubplanExec>()
            .unwrap();
        assert_eq!(producer.consumers(), 3);
    }

    #[test]
    fn diverged_markers_are_stripped() {
        let plan =
            UnionExec::try_new(vec![marker(1, filtered(1)), marker(1, filtered(2))]).unwrap();
        let plan = SharedSubplanRule::new()
            .optimize(plan, &ConfigOptions::new())
            .unwrap();
        assert_eq!(count::<SharedSubplanExec>(&plan), 0);
        assert_eq!(count::<SharedSubplanMarkerExec>(&plan), 0);
        assert_eq!(count::<FilterExec>(&plan), 2);
    }

    #[test]
    fn single_marker_is_stripped() {
        let plan = SharedSubplanRule::new()
            .optimize(marker(1, filtered(1)), &ConfigOptions::new())
            .unwrap();
        assert_eq!(count::<SharedSubplanMarkerExec>(&plan), 0);
        assert!(plan.downcast_ref::<FilterExec>().is_some());
    }

    fn remote(input: Arc<dyn ExecutionPlan>) -> Arc<dyn ExecutionPlan> {
        let node = RemoteScanNode {
            nodes: vec![Arc::new(TestNode)],
            opentelemetry_context: opentelemetry::Context::current(),
            query_identifier: Default::default(),
            search_infos: Default::default(),
            index_info: Default::default(),
            super_cluster_info: Default::default(),
        };
        Arc::new(RemoteScanExec::new(input, node).unwrap())
    }

    #[test]
    fn markers_inside_remote_fragments_are_left_to_the_follower() {
        let plan = UnionExec::try_new(vec![
            remote(marker(1, filtered(1))),
            remote(marker(1, filtered(1))),
        ])
        .unwrap();
        let plan = SharedSubplanRule::new()
            .optimize(plan, &ConfigOptions::new())
            .unwrap();
        assert_eq!(count::<SharedSubplanExec>(&plan), 0);
        assert_eq!(count::<SharedSubplanReaderExec>(&plan), 0);
        assert_eq!(count::<SharedSubplanMarkerExec>(&plan), 2);
        assert_eq!(count::<RemoteScanExec>(&plan), 2);
    }

    #[test]
    fn marker_inside_a_remote_fragment_does_not_pair_with_one_outside() {
        let plan = UnionExec::try_new(vec![remote(marker(1, filtered(1))), marker(1, filtered(1))])
            .unwrap();
        let plan = SharedSubplanRule::new()
            .optimize(plan, &ConfigOptions::new())
            .unwrap();
        assert_eq!(count::<SharedSubplanExec>(&plan), 0);
        assert_eq!(count::<SharedSubplanMarkerExec>(&plan), 1);
        assert_eq!(count::<FilterExec>(&plan), 2);
    }
}
