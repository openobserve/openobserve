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
    execution::FunctionRegistry,
    physical_plan::ExecutionPlan,
};
use datafusion_proto::physical_plan::PhysicalExtensionCodec;
use o2_enterprise::enterprise::search::datafusion::distributed_plan::aggregate_topk_exec::AggregateTopkExec;
use prost::Message;
use proto::cluster_rpc;

/// A PhysicalExtensionCodec that can serialize and deserialize ChildExec
#[derive(Debug)]
pub struct AggregateTopkExecPhysicalExtensionCodec;

impl PhysicalExtensionCodec for AggregateTopkExecPhysicalExtensionCodec {
    fn try_decode(
        &self,
        buf: &[u8],
        inputs: &[Arc<dyn ExecutionPlan>],
        _registry: &dyn FunctionRegistry,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let proto = cluster_rpc::AggregateTopkExecNode::decode(buf).map_err(|e| {
            DataFusionError::Internal(format!(
                "failed to decode AggregateTopkExecNode writer execution plan: {e:?}"
            ))
        })?;
        Ok(Arc::new(AggregateTopkExec::new(
            inputs[0].clone(),
            &proto.sort_field,
            proto.descending,
            proto.limit,
        )))
    }

    fn try_encode(&self, node: Arc<dyn ExecutionPlan>, buf: &mut Vec<u8>) -> Result<()> {
        let Some(node) = node.as_any().downcast_ref::<AggregateTopkExec>() else {
            return internal_err!("Not supported");
        };
        let proto = cluster_rpc::AggregateTopkExecNode {
            sort_field: node.sort_field().to_string(),
            descending: node.descending(),
            limit: node.limit(),
        };
        proto.encode(buf).map_err(|e| {
            DataFusionError::Internal(format!(
                "failed to encode AggregateTopkExecNode writer execution plan: {e:?}"
            ))
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use datafusion::{
        arrow::datatypes::{DataType, Field, Schema},
        functions_aggregate::count::count_udaf,
        physical_expr::aggregate::AggregateExprBuilder,
        physical_plan::{
            aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
            expressions::{col, lit},
        },
        scalar::ScalarValue,
    };
    use datafusion_proto::bytes::{
        physical_plan_from_bytes_with_extension_codec, physical_plan_to_bytes_with_extension_codec,
    };

    use super::*;

    #[tokio::test]
    async fn test_datafusion_codec() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));

        let grouping_set = PhysicalGroupBy::new(
            vec![
                (col("a", &schema)?, "a".to_string()),
                (col("b", &schema)?, "b".to_string()),
            ],
            vec![
                (lit(ScalarValue::UInt32(None)), "a".to_string()),
                (lit(ScalarValue::Float64(None)), "b".to_string()),
            ],
            vec![
                vec![false, true],  // (a, NULL)
                vec![true, false],  // (NULL, b)
                vec![false, false], // (a,b)
            ],
        );

        let aggregates = vec![Arc::new(
            AggregateExprBuilder::new(count_udaf(), vec![lit(1i8)])
                .schema(Arc::clone(&schema))
                .alias("COUNT(1)")
                .build()?,
        )];

        let agg_plan = AggregateExec::try_new(
            AggregateMode::Partial,
            grouping_set.clone(),
            aggregates.clone(),
            vec![None],
            Arc::new(super::super::super::empty_exec::NewEmptyExec::new(
                "test",
                Arc::clone(&schema),
                Some(&vec![0]),
                &[],
                Some(10),
                false,
                Arc::clone(&schema),
            )),
            Arc::clone(&schema),
        )?;
        let plan: Arc<dyn ExecutionPlan> = Arc::new(AggregateTopkExec::new(
            Arc::new(agg_plan) as Arc<dyn ExecutionPlan>,
            "a",
            false,
            10,
        ));

        // encode
        let proto = super::super::ComposedPhysicalExtensionCodec {
            codecs: vec![Arc::new(AggregateTopkExecPhysicalExtensionCodec {})],
        };
        let plan_bytes = physical_plan_to_bytes_with_extension_codec(plan.clone(), &proto).unwrap();

        // decode
        let ctx = datafusion::prelude::SessionContext::new();
        let plan2 = physical_plan_from_bytes_with_extension_codec(&plan_bytes, &ctx, &proto)?;
        let plan2 = plan2.as_any().downcast_ref::<AggregateTopkExec>().unwrap();
        let plan = plan.as_any().downcast_ref::<AggregateTopkExec>().unwrap();

        // check
        assert_eq!(plan.limit(), plan2.limit());
        assert_eq!(plan.descending(), plan2.descending());

        Ok(())
    }
}
