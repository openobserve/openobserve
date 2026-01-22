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
    common::{Result, internal_err},
    error::DataFusionError,
    execution::TaskContext,
    physical_plan::ExecutionPlan,
};
use datafusion_proto::{
    convert_required,
    logical_plan::{
        DefaultLogicalExtensionCodec, from_proto::parse_expr, to_proto::serialize_exprs,
    },
    protobuf::proto_error,
};
use prost::Message;
use proto::cluster_rpc;

use super::super::empty_exec::NewEmptyExec;

pub(crate) fn try_decode(
    node: cluster_rpc::NewEmptyExecNode,
    _inputs: &[Arc<dyn ExecutionPlan>],
    ctx: &TaskContext,
) -> Result<Arc<dyn ExecutionPlan>> {
    let schema = Arc::new(convert_required!(node.schema)?);
    let full_schema = Arc::new(convert_required!(node.full_schema)?);
    let extension_codec = DefaultLogicalExtensionCodec {};
    let filters = node
        .filters
        .iter()
        .map(|v| parse_expr(v, ctx, &extension_codec))
        .collect::<Result<Vec<_>, _>>()?;
    let projection = node
        .projection
        .as_ref()
        .map(|p| p.values.iter().map(|v| *v as usize).collect::<Vec<_>>());
    Ok(Arc::new(NewEmptyExec::new(
        &node.name,
        schema,
        projection.as_ref(),
        &filters,
        node.limit.map(|v| v as usize),
        node.sorted_by_time,
        full_schema,
    )))
}

pub(crate) fn try_encode(node: Arc<dyn ExecutionPlan>, buf: &mut Vec<u8>) -> Result<()> {
    let Some(node) = node.as_any().downcast_ref::<NewEmptyExec>() else {
        return internal_err!("Not supported");
    };
    let extension_codec = DefaultLogicalExtensionCodec {};
    let filters = serialize_exprs(node.filters(), &extension_codec)?;
    let plan_node = cluster_rpc::NewEmptyExecNode {
        name: node.name().to_string(),
        schema: Some(node.schema().as_ref().try_into()?),
        projection: node.projection().map(|v| cluster_rpc::Uint64List {
            values: v.iter().map(|v| *v as u64).collect(),
        }),
        filters,
        limit: node.limit().map(|v| v as u64),
        sorted_by_time: node.sorted_by_time(),
        full_schema: Some(node.full_schema().as_ref().try_into()?),
    };
    let proto = cluster_rpc::PhysicalPlanNode {
        plan: Some(cluster_rpc::physical_plan_node::Plan::EmptyExec(plan_node)),
    };
    proto.encode(buf).map_err(|e| {
        DataFusionError::Internal(format!(
            "failed to encode NewEmptyExecNode writer execution plan: {e:?}"
        ))
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use datafusion::arrow::datatypes::{DataType, Field, Schema};
    use datafusion_proto::bytes::{
        physical_plan_from_bytes_with_extension_codec, physical_plan_to_bytes_with_extension_codec,
    };

    use super::*;

    #[tokio::test]
    async fn test_datafusion_codec() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        let plan: Arc<dyn ExecutionPlan> = Arc::new(NewEmptyExec::new(
            "test",
            Arc::clone(&schema),
            Some(&vec![0]),
            &[],
            Some(10),
            false,
            Arc::clone(&schema),
        ));

        // encode
        let proto = super::super::get_physical_extension_codec();
        let plan_bytes = physical_plan_to_bytes_with_extension_codec(plan.clone(), &proto).unwrap();

        // decode
        let ctx = datafusion::prelude::SessionContext::new();
        let plan2 =
            physical_plan_from_bytes_with_extension_codec(&plan_bytes, &ctx.task_ctx(), &proto)?;
        let plan2 = plan2.as_any().downcast_ref::<NewEmptyExec>().unwrap();
        let plan = plan.as_any().downcast_ref::<NewEmptyExec>().unwrap();

        // check
        assert_eq!(plan.name(), plan2.name());
        assert_eq!(plan.schema(), plan2.schema());
        assert_eq!(plan.projection(), plan2.projection());
        assert_eq!(plan.filters(), plan2.filters());
        assert_eq!(plan.limit(), plan2.limit());
        assert_eq!(plan.full_schema(), plan2.full_schema());

        Ok(())
    }
}
