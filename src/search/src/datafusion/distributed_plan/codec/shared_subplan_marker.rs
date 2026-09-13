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
    common::{Result, internal_err},
    error::DataFusionError,
    execution::TaskContext,
    physical_plan::ExecutionPlan,
};
use prost::Message;
use proto::cluster_rpc;

use crate::datafusion::plan::shared_subplan_exec::SharedSubplanMarkerExec;

// A follower never shares, so the marker is dropped and its input runs directly.
pub(super) fn try_decode(
    _node: cluster_rpc::SharedSubplanMarkerNode,
    inputs: &[Arc<dyn ExecutionPlan>],
    _ctx: &TaskContext,
) -> Result<Arc<dyn ExecutionPlan>> {
    let [input] = inputs else {
        return internal_err!(
            "SharedSubplanMarkerExec expected 1 input, got {}",
            inputs.len()
        );
    };
    Ok(Arc::clone(input))
}

pub(super) fn try_encode(node: Arc<dyn ExecutionPlan>, buf: &mut Vec<u8>) -> Result<()> {
    let Some(marker) = node.downcast_ref::<SharedSubplanMarkerExec>() else {
        return internal_err!("Not supported");
    };
    let proto = cluster_rpc::PhysicalPlanNode {
        plan: Some(cluster_rpc::physical_plan_node::Plan::SharedSubplanMarker(
            cluster_rpc::SharedSubplanMarkerNode { id: marker.id() },
        )),
    };
    proto.encode(buf).map_err(|e| {
        DataFusionError::Internal(format!("failed to encode SharedSubplanMarkerNode: {e:?}"))
    })
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};
    use datafusion::physical_plan::empty::EmptyExec;
    use datafusion_proto::bytes::{
        physical_plan_from_bytes_with_extension_codec, physical_plan_to_bytes_with_extension_codec,
    };

    use super::*;

    #[test]
    fn marker_roundtrip_drops_the_marker() {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        let plan: Arc<dyn ExecutionPlan> = Arc::new(SharedSubplanMarkerExec::new(
            3,
            Arc::new(EmptyExec::new(schema)),
        ));
        let proto = crate::datafusion::distributed_plan::codec::get_physical_extension_codec();
        let bytes = physical_plan_to_bytes_with_extension_codec(plan, &proto).unwrap();
        let ctx = datafusion::prelude::SessionContext::new();
        let decoded =
            physical_plan_from_bytes_with_extension_codec(&bytes, &ctx.task_ctx(), &proto).unwrap();
        assert!(decoded.downcast_ref::<EmptyExec>().is_some());
    }
}
