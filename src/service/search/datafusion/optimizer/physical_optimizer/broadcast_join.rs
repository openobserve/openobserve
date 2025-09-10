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

use chrono::{DateTime, Datelike, Utc};
use config::ider::uuid;
use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter},
    },
    physical_plan::ExecutionPlan,
};

use crate::service::search::datafusion::{
    distributed_plan::{
        broadcast_join_exec::BroadcastJoinExec, node::RemoteScanNodes, tmp_exec::TmpExec,
    },
    optimizer::physical_optimizer::remote_scan::{
        RemoteScanRewriter, remote_scan_to_top_if_needed,
    },
};

pub fn broadcast_join_rewrite(
    plan: Arc<dyn ExecutionPlan>,
    remote_scan_nodes: Arc<RemoteScanNodes>,
) -> Result<Arc<dyn ExecutionPlan>> {
    let mut rewriter = BroadcastJoinRewriter::new(remote_scan_nodes);
    let plan = plan.rewrite(&mut rewriter)?.data;
    Ok(plan)
}

#[derive(Debug, Clone)]
pub struct BroadcastJoinRewriter {
    remote_scan_nodes: Arc<RemoteScanNodes>,
}

impl BroadcastJoinRewriter {
    pub fn new(remote_scan_nodes: Arc<RemoteScanNodes>) -> Self {
        Self { remote_scan_nodes }
    }
}

impl TreeNodeRewriter for BroadcastJoinRewriter {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Self::Node>> {
        if node.name() == "HashJoinExec" {
            // 1. get the left table, and rewrite it use RemoteScanRewriter
            let left = node.children()[0].clone();
            let mut rewriter = RemoteScanRewriter::new(self.remote_scan_nodes.clone());
            let left = left.rewrite(&mut rewriter)?.data;

            // 2. replace the left table to TmpExec
            let trace_id = &self.remote_scan_nodes.req.trace_id;
            let cluster_name = config::get_cluster_name();
            let result_path = generate_result_path(trace_id);
            let tmp_exec = Arc::new(TmpExec::new(
                cluster_name.clone(),
                result_path.clone(),
                left.schema(),
            ));

            // 3. add remoteScan at the top of the hash join
            let right = node.children()[1].clone();
            let hash_join = node.with_new_children(vec![tmp_exec, right])?;
            let hash_join =
                remote_scan_to_top_if_needed(hash_join, self.remote_scan_nodes.clone())?;

            // 4. replace the HashJoinExec to BroadcastJoinExec
            let broadcast_join = Arc::new(BroadcastJoinExec::new(
                left,
                hash_join,
                cluster_name,
                result_path,
            ));
            return Ok(Transformed::yes(broadcast_join));
        }
        Ok(Transformed::no(node))
    }
}

// check if the plan can use broadcast join
// TODO: add check for left table should have limit
// TODO: add check for right table should be simple table scan and filter
pub fn should_use_broadcast_join(plan: &Arc<dyn ExecutionPlan>) -> bool {
    let mut count = 0;
    plan.apply(|node| {
        Ok(if node.name() == "HashJoinExec" {
            count += 1;
            TreeNodeRecursion::Stop
        } else {
            TreeNodeRecursion::Continue
        })
    })
    .unwrap();
    count == 1
}

fn generate_result_path(trace_id: &str) -> String {
    let datetime: DateTime<Utc> = Utc::now();

    let id = uuid();
    format!(
        "join/{}/{}/{}/{trace_id}-{id}.arrow",
        datetime.year(),
        datetime.month(),
        datetime.day(),
    )
}
