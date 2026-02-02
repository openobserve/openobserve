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
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter},
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
            let plan = node.rewrite(&mut rewriter)?.data;

            // 3. replace the HashJoinExec to EnrichBroadcastJoinExec
            let hash_join = remote_scan_to_top_if_needed(plan, self.remote_scan_nodes.clone())?;

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
                    table_name.table().to_string(),
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
    if count != 1 {
        return false;
    }

    let mut result = false;
    let _ = plan.apply(|node| {
        Ok(if node.name() == "HashJoinExec" {
            if let Some(hash_join) = node.as_any().downcast_ref::<HashJoinExec>() {
                result = is_enrichment_table(hash_join.left())
                    && is_valid_enrich_broadcast_right(hash_join.right());
            }
            TreeNodeRecursion::Stop
        } else {
            TreeNodeRecursion::Continue
        })
    });

    result
}

pub fn is_enrichment_table(plan: &Arc<dyn ExecutionPlan>) -> bool {
    let mut found_enrichment = false;
    let _ = plan.apply(|node| {
        Ok(
            if let Some(new_empty) = node.as_any().downcast_ref::<NewEmptyExec>() {
                let table_name = TableReference::parse_str(new_empty.name());
                if matches!(
                    table_name.schema(),
                    Some("enrichment_tables") | Some("enrich") // TODO: use TableReferenceExt
                ) {
                    found_enrichment = true;
                    TreeNodeRecursion::Stop
                } else {
                    TreeNodeRecursion::Continue
                }
            } else {
                TreeNodeRecursion::Continue
            },
        )
    });
    found_enrichment
}

fn is_valid_enrich_broadcast_right(plan: &Arc<dyn ExecutionPlan>) -> bool {
    let mut is_valid = true;
    let _ = plan.apply(|node| {
        Ok(
            if let Some(new_empty) = node.as_any().downcast_ref::<NewEmptyExec>() {
                let table_name = TableReference::parse_str(new_empty.name());
                if matches!(
                    table_name.schema(),
                    Some("enrichment_tables") | Some("enrich") // TODO: use TableReferenceExt
                ) {
                    is_valid = false;
                    TreeNodeRecursion::Stop
                } else {
                    TreeNodeRecursion::Continue
                }
            } else if !(node.name() == "NewEmptyExec"
                || node.name() == "FilterExec"
                || node.name() == "CooperativeExec"
                || node.name() == "RepartitionExec"
                || node.name() == "CoalesceBatchesExec")
            {
                is_valid = false;
                TreeNodeRecursion::Stop
            } else {
                TreeNodeRecursion::Continue
            },
        )
    });
    is_valid
}
