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

use std::sync::Arc;

use datafusion::{
    common::tree_node::{TreeNode, TreeNodeRecursion},
    physical_plan::ExecutionPlan,
};
use flight::common::NodeRole;
use search::datafusion::distributed_plan::remote_scan_exec::RemoteScanExec;
pub use search::datafusion::plan_metrics::get_peak_memory_from_ctx;

/// Only a super cluster's cluster leader runs a plan with a remote scan in it.
pub fn node_role(plan: &Arc<dyn ExecutionPlan>) -> NodeRole {
    let mut role = NodeRole::Follower;
    let _ = plan.apply(|node| {
        let Some(remote_scan) = node.downcast_ref::<RemoteScanExec>() else {
            return Ok(TreeNodeRecursion::Continue);
        };
        role = NodeRole::ClusterLeader(remote_scan.state.clone());
        Ok(TreeNodeRecursion::Stop)
    });
    role
}

#[cfg(test)]
mod tests {
    use arrow::datatypes::{DataType, Field, Schema};
    use datafusion::physical_plan::empty::EmptyExec;

    use super::*;

    #[test]
    fn test_plan_without_remote_scan_is_follower() {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        let plan: Arc<dyn ExecutionPlan> = Arc::new(EmptyExec::new(schema));
        assert!(matches!(node_role(&plan), NodeRole::Follower));
    }
}
