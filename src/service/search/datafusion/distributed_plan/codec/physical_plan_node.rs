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
use datafusion_proto::physical_plan::PhysicalExtensionCodec;
use prost::Message;
use proto::cluster_rpc;
#[cfg(feature = "enterprise")]
use {
    crate::service::search::datafusion::distributed_plan::enrichment_exec::EnrichmentExec,
    o2_enterprise::enterprise::search::datafusion::distributed_plan::{
        agg_topk_exec::AggregateTopkExec, streaming_aggs_exec::exec::StreamingAggsExec,
        tmp_exec::TmpExec,
    },
};

use crate::service::search::datafusion::distributed_plan::empty_exec::NewEmptyExec;

/// A PhysicalExtensionCodec that can serialize and deserialize ChildExec
#[derive(Debug)]
pub struct PhysicalPlanNodePhysicalExtensionCodec {}

impl PhysicalExtensionCodec for PhysicalPlanNodePhysicalExtensionCodec {
    fn try_decode(
        &self,
        buf: &[u8],
        inputs: &[Arc<dyn ExecutionPlan>],
        ctx: &TaskContext,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let proto = cluster_rpc::PhysicalPlanNode::decode(buf).map_err(|e| {
            DataFusionError::Internal(format!(
                "failed to decode PhysicalPlanNode writer execution plan: {e:?}"
            ))
        })?;
        match proto.plan {
            Some(cluster_rpc::physical_plan_node::Plan::EmptyExec(node)) => {
                super::empty_exec::try_decode(node, inputs, ctx)
            }
            #[cfg(feature = "enterprise")]
            Some(cluster_rpc::physical_plan_node::Plan::AggregateTopk(node)) => {
                super::aggregate_topk_exec::try_decode(node, inputs, ctx)
            }
            #[cfg(feature = "enterprise")]
            Some(cluster_rpc::physical_plan_node::Plan::StreamingAggs(node)) => {
                super::streaming_aggs_exec::try_decode(node, inputs, ctx)
            }
            #[cfg(feature = "enterprise")]
            Some(cluster_rpc::physical_plan_node::Plan::TmpExec(node)) => {
                super::tmp_exec::try_decode(node, inputs, ctx)
            }
            #[cfg(feature = "enterprise")]
            Some(cluster_rpc::physical_plan_node::Plan::EnrichmentExec(node)) => {
                super::enrichment_exec::try_decode(node, inputs, ctx)
            }
            #[cfg(not(feature = "enterprise"))]
            Some(_) => {
                internal_err!("Not supported")
            }
            None => {
                internal_err!("PhysicalPlanNode is required")
            }
        }
    }

    fn try_encode(&self, node: Arc<dyn ExecutionPlan>, buf: &mut Vec<u8>) -> Result<()> {
        #[cfg(feature = "enterprise")]
        if node.as_any().downcast_ref::<NewEmptyExec>().is_some() {
            super::empty_exec::try_encode(node, buf)
        } else if node.as_any().downcast_ref::<AggregateTopkExec>().is_some() {
            super::aggregate_topk_exec::try_encode(node, buf)
        } else if node.as_any().downcast_ref::<StreamingAggsExec>().is_some() {
            super::streaming_aggs_exec::try_encode(node, buf)
        } else if node.as_any().downcast_ref::<TmpExec>().is_some() {
            super::tmp_exec::try_encode(node, buf)
        } else if node.as_any().downcast_ref::<EnrichmentExec>().is_some() {
            super::enrichment_exec::try_encode(node, buf)
        } else {
            internal_err!("Not supported")
        }
        #[cfg(not(feature = "enterprise"))]
        if node.as_any().downcast_ref::<NewEmptyExec>().is_some() {
            super::empty_exec::try_encode(node, buf)
        } else {
            internal_err!("Not supported")
        }
    }
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
