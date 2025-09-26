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

use std::sync::Arc;

use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter, TreeNodeVisitor},
    },
    physical_plan::{ExecutionPlan, joins::HashJoinExec},
    sql::TableReference,
};

use crate::service::search::datafusion::{
    distributed_plan::{
        empty_exec::NewEmptyExec, enrichment_exec::EnrichmentExec, node::RemoteScanNodes,
    },
    optimizer::physical_optimizer::remote_scan::remote_scan_to_top_if_needed,
};

pub fn enrichment_broadcast_join_rewrite(
    plan: Arc<dyn ExecutionPlan>,
    remote_scan_nodes: Arc<RemoteScanNodes>,
) -> Result<Arc<dyn ExecutionPlan>> {
    let mut rewriter = EnrichBroadcastJoinRewriter::new(remote_scan_nodes);
    let plan = plan.rewrite(&mut rewriter)?.data;
    Ok(plan)
}

#[derive(Debug, Clone)]
pub struct EnrichBroadcastJoinRewriter {
    remote_scan_nodes: Arc<RemoteScanNodes>,
}

impl EnrichBroadcastJoinRewriter {
    pub fn new(remote_scan_nodes: Arc<RemoteScanNodes>) -> Self {
        Self { remote_scan_nodes }
    }
}

impl TreeNodeRewriter for EnrichBroadcastJoinRewriter {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Self::Node>> {
        // TODO: avoid get file list for enrich broadcast join
        if node.name() == "HashJoinExec" {
            // 1. replace enrich's NewEmptyExec to EnrichmentExec
            let org_id = self.remote_scan_nodes.req.org_id.clone();
            let trace_id = self.remote_scan_nodes.req.trace_id.clone();
            let mut rewriter = EnrichmentExecRewriter::new(trace_id.clone(), org_id);
            let hash_join = node.rewrite(&mut rewriter)?.data;

            // 2. replace the HashJoinExec to EnrichBroadcastJoinExec
            let hash_join =
                remote_scan_to_top_if_needed(hash_join, self.remote_scan_nodes.clone())?;

            return Ok(Transformed::yes(hash_join));
        }
        Ok(Transformed::no(node))
    }
}

#[derive(Debug)]
struct EnrichmentExecRewriter {
    trace_id: String,
    org_id: String,
}

impl EnrichmentExecRewriter {
    fn new(trace_id: String, org_id: String) -> Self {
        EnrichmentExecRewriter { trace_id, org_id }
    }
}

impl TreeNodeRewriter for EnrichmentExecRewriter {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Self::Node>> {
        if let Some(new_empty) = node.as_any().downcast_ref::<NewEmptyExec>() {
            let table_name = TableReference::parse_str(new_empty.name());
            if matches!(
                table_name.schema(),
                Some("enrichment_tables") | Some("enrich") // TODO: use TableReferenceExt
            ) {
                let enrichment_exec = Arc::new(EnrichmentExec::new(
                    self.trace_id.clone(),
                    self.org_id.clone(),
                    new_empty.name().to_string(),
                    new_empty.schema().clone(),
                ));
                return Ok(Transformed::new(
                    enrichment_exec as _,
                    true,
                    TreeNodeRecursion::Stop,
                ));
            }
        }
        Ok(Transformed::no(node))
    }
}

// check if the plan can use broadcast join
pub fn should_use_enrichment_broadcast_join(plan: &Arc<dyn ExecutionPlan>) -> bool {
    let mut count = 0;
    // 1. check if only one HashJoinExec and no other multi table ExecutionPlan
    plan.apply(|node| {
        Ok(if node.name() == "HashJoinExec" {
            count += 1;
            TreeNodeRecursion::Continue
        } else if node.name().contains("Join")
            || node.name() == "UnionExec"
            || node.name() == "InterleaveExec"
            || node.name() == "RecursiveQueryExec"
        {
            count += 2;
            TreeNodeRecursion::Continue
        } else {
            TreeNodeRecursion::Continue
        })
    })
    .unwrap();

    // 2. check if the left table and the right table satisfy the condition
    let mut visitor = EnrichBroadcastJoinVisitor::new();
    plan.visit(&mut visitor)
        .is_ok_and(|_| visitor.use_broadcast_join && count == 1)
}

#[derive(Debug)]
struct EnrichBroadcastJoinVisitor {
    use_broadcast_join: bool,
}

impl EnrichBroadcastJoinVisitor {
    fn new() -> Self {
        EnrichBroadcastJoinVisitor {
            use_broadcast_join: false,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for EnrichBroadcastJoinVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Arc<dyn ExecutionPlan>) -> Result<TreeNodeRecursion> {
        if node.name() == "HashJoinExec" {
            let hash_join = node.as_any().downcast_ref::<HashJoinExec>().unwrap();
            let left = hash_join.left();
            let right = hash_join.right();
            if is_enrich_broadcast_left(left) && is_enrich_broadcast_right(right) {
                self.use_broadcast_join = true;
            }
            return Ok(TreeNodeRecursion::Stop);
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

// left table should be enrichment table
fn is_enrich_broadcast_left(left: &Arc<dyn ExecutionPlan>) -> bool {
    let mut visitor = LeftVisitor::new();
    left.visit(&mut visitor)
        .is_ok_and(|_| visitor.is_enrichment_table)
}

struct LeftVisitor {
    is_enrichment_table: bool,
}

impl LeftVisitor {
    fn new() -> Self {
        Self {
            is_enrichment_table: false,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for LeftVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Arc<dyn ExecutionPlan>) -> Result<TreeNodeRecursion> {
        if let Some(new_empty) = node.as_any().downcast_ref::<NewEmptyExec>() {
            let table_name = TableReference::parse_str(new_empty.name());
            self.is_enrichment_table = matches!(
                table_name.schema(),
                Some("enrichment_tables") | Some("enrich") // TODO: use TableReferenceExt
            );
            return Ok(TreeNodeRecursion::Continue);
        }
        Ok(TreeNodeRecursion::Continue)
    }
}

// right table should be table scan and filter
fn is_enrich_broadcast_right(right: &Arc<dyn ExecutionPlan>) -> bool {
    let mut visitor = RightVisitor::new();
    right
        .visit(&mut visitor)
        .is_ok_and(|_| visitor.is_broadcast_right)
}

struct RightVisitor {
    is_broadcast_right: bool,
}

impl RightVisitor {
    fn new() -> Self {
        Self {
            is_broadcast_right: true,
        }
    }
}

impl<'n> TreeNodeVisitor<'n> for RightVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Arc<dyn ExecutionPlan>) -> Result<TreeNodeRecursion> {
        if let Some(new_empty) = node.as_any().downcast_ref::<NewEmptyExec>() {
            let table_name = TableReference::parse_str(new_empty.name());
            if matches!(
                table_name.schema(),
                Some("enrichment_tables") | Some("enrich") // TODO: use TableReferenceExt
            ) {
                self.is_broadcast_right = false;
                return Ok(TreeNodeRecursion::Stop);
            }
        }
        if !(node.name() == "NewEmptyExec"
            || node.name() == "FilterExec"
            || node.name() == "CooperativeExec"
            || node.name() == "CoalesceBatchesExec")
        {
            self.is_broadcast_right = false;
            return Ok(TreeNodeRecursion::Stop);
        }
        Ok(TreeNodeRecursion::Continue)
    }
}
