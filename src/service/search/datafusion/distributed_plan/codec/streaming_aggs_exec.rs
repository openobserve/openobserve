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
    physical_plan::{ExecutionPlan, aggregates::AggregateExec},
};
use datafusion_proto::{physical_plan::AsExecutionPlan, protobuf::PhysicalPlanNode};
use o2_enterprise::enterprise::search::datafusion::distributed_plan::streaming_aggs_exec::exec::StreamingAggsExec;
use prost::Message;
use proto::cluster_rpc;

pub(crate) fn try_decode(
    node: cluster_rpc::StreamingAggsExecNode,
    inputs: &[Arc<dyn ExecutionPlan>],
    ctx: &TaskContext,
) -> Result<Arc<dyn ExecutionPlan>> {
    let Some(aggregate_plan) = node.aggregate_plan else {
        return internal_err!("aggregate_plan is required");
    };
    let extension_codec = super::get_physical_extension_codec();
    let aggregate_plan = aggregate_plan.try_into_physical_plan(ctx, &extension_codec)?;
    let Some(aggregate_plan) = aggregate_plan.as_any().downcast_ref::<AggregateExec>() else {
        return internal_err!("aggregate_plan is not an AggregateExec");
    };
    let aggregate_plan = Arc::new(aggregate_plan.clone());

    let cached_files = node
        .cached_files
        .iter()
        .map(|v| Arc::new(v.clone()))
        .collect();

    Ok(Arc::new(StreamingAggsExec::new(
        node.id.clone(),
        node.start_time,
        node.end_time,
        cached_files,
        inputs[0].clone(),
        node.target_partitions as usize,
        node.is_complete_cache_hit,
        aggregate_plan,
        node.overwrite_cache,
    )))
}

pub(crate) fn try_encode(node: Arc<dyn ExecutionPlan>, buf: &mut Vec<u8>) -> Result<()> {
    let Some(node) = node.as_any().downcast_ref::<StreamingAggsExec>() else {
        return internal_err!("Not supported");
    };

    // serialize execution plan to proto
    let extension_codec = super::get_physical_extension_codec();
    let aggregate_plan =
        PhysicalPlanNode::try_from_physical_plan(node.aggregate_plan().clone(), &extension_codec)?;
    let plan_node = cluster_rpc::StreamingAggsExecNode {
        id: node.id().to_string(),
        start_time: node.start_time(),
        end_time: node.end_time(),
        target_partitions: node.target_partitions() as u64,
        is_complete_cache_hit: node.is_complete_cache_hit(),
        cached_files: node
            .cached_files()
            .iter()
            .map(|v| v.as_ref().to_string())
            .collect(),
        aggregate_plan: Some(aggregate_plan),
        overwrite_cache: node.overwrite_cache(),
    };
    let proto = cluster_rpc::PhysicalPlanNode {
        plan: Some(cluster_rpc::physical_plan_node::Plan::StreamingAggs(
            plan_node,
        )),
    };
    proto.encode(buf).map_err(|e| {
        DataFusionError::Internal(format!(
            "failed to encode StreamingAggsExecNode writer execution plan: {e:?}"
        ))
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use datafusion::{
        arrow::datatypes::{DataType, Field, Schema},
        common::config::ConfigOptions,
        functions_aggregate::count::count_udaf,
        physical_expr::{
            ScalarFunctionExpr,
            aggregate::AggregateExprBuilder,
            expressions::{col, lit},
        },
        physical_plan::{
            aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
            empty::EmptyExec,
            filter::FilterExec,
        },
    };
    use datafusion_proto::bytes::{
        physical_plan_from_bytes_with_extension_codec, physical_plan_to_bytes_with_extension_codec,
    };
    use o2_enterprise::enterprise::search::datafusion::distributed_plan::streaming_aggs_exec::exec::StreamingAggsExec;

    use super::*;
    use crate::service::search::datafusion::udf::str_match_udf::STR_MATCH_UDF;

    #[tokio::test]
    async fn test_datafusion_codec() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));

        let grouping_set = PhysicalGroupBy::new(
            vec![(col("a", &schema)?, "a".to_string())],
            vec![],
            vec![vec![false]],
            false,
        );

        let aggregates = vec![Arc::new(
            AggregateExprBuilder::new(count_udaf(), vec![lit(1i32)])
                .schema(Arc::clone(&schema))
                .alias("COUNT(1)")
                .build()?,
        )];

        let agg_plan = AggregateExec::try_new(
            AggregateMode::Partial,
            grouping_set.clone(),
            aggregates.clone(),
            vec![None],
            Arc::new(EmptyExec::new(Arc::clone(&schema))),
            Arc::clone(&schema),
        )?;
        let start_time = config::utils::time::now_micros();
        let end_time = start_time + 1000;
        let plan: Arc<dyn ExecutionPlan> = Arc::new(StreamingAggsExec::new(
            "123".to_string(),
            start_time,
            end_time,
            vec![],
            Arc::new(agg_plan.clone()) as Arc<dyn ExecutionPlan>,
            1,
            false,
            Arc::new(agg_plan),
            false,
        ));

        // encode
        let proto = super::super::get_physical_extension_codec();
        let plan_bytes = physical_plan_to_bytes_with_extension_codec(plan.clone(), &proto).unwrap();

        // decode
        let ctx = datafusion::prelude::SessionContext::new();
        let plan2 =
            physical_plan_from_bytes_with_extension_codec(&plan_bytes, &ctx.task_ctx(), &proto)?;
        let plan2 = plan2.as_any().downcast_ref::<StreamingAggsExec>().unwrap();
        let plan = plan.as_any().downcast_ref::<StreamingAggsExec>().unwrap();

        // check
        assert_eq!(plan.id(), plan2.id());
        assert_eq!(plan.start_time(), plan2.start_time());
        assert_eq!(plan.end_time(), plan2.end_time());
        assert_eq!(plan.target_partitions(), plan2.target_partitions());
        assert_eq!(plan.is_complete_cache_hit(), plan2.is_complete_cache_hit());
        assert_eq!(plan.cached_files(), plan2.cached_files());

        Ok(())
    }

    #[tokio::test]
    async fn test_datafusion_codec_with_filter() -> Result<()> {
        // Create schema with string field for str_match UDF
        let schema = Arc::new(Schema::new(vec![
            Field::new("a", DataType::Int32, false),
            Field::new("message", DataType::Utf8, false),
        ]));

        // Create str_match UDF expression: str_match(message, "test")
        let str_match_expr = Arc::new(ScalarFunctionExpr::try_new(
            STR_MATCH_UDF.clone().into(),
            vec![col("message", &schema)?, lit("test")],
            &schema,
            Arc::new(ConfigOptions::default()),
        )?);

        // Create FilterExec with str_match UDF
        let filter_exec = Arc::new(FilterExec::try_new(
            str_match_expr,
            Arc::new(EmptyExec::new(Arc::clone(&schema))),
        )?);

        // Create grouping set for aggregation
        let grouping_set = PhysicalGroupBy::new(
            vec![(col("a", &schema)?, "a".to_string())],
            vec![],
            vec![vec![false]],
            false,
        );

        // Create aggregates
        let aggregates = vec![Arc::new(
            AggregateExprBuilder::new(count_udaf(), vec![lit(1i32)])
                .schema(Arc::clone(&schema))
                .alias("COUNT(1)")
                .build()?,
        )];

        // Create AggregateExec with FilterExec as input
        let agg_plan = AggregateExec::try_new(
            AggregateMode::Partial,
            grouping_set.clone(),
            aggregates.clone(),
            vec![None],
            filter_exec.clone(),
            Arc::clone(&schema),
        )?;

        let start_time = config::utils::time::now_micros();
        let end_time = start_time + 1000;
        let plan: Arc<dyn ExecutionPlan> = Arc::new(StreamingAggsExec::new(
            "456".to_string(),
            start_time,
            end_time,
            vec![],
            Arc::new(agg_plan.clone()) as Arc<dyn ExecutionPlan>,
            1,
            false,
            Arc::new(agg_plan),
            false,
        ));

        // encode
        let proto = super::super::get_physical_extension_codec();
        let plan_bytes = physical_plan_to_bytes_with_extension_codec(plan.clone(), &proto).unwrap();

        // decode
        let ctx = datafusion::prelude::SessionContext::new();
        // Register UDFs in the context
        ctx.register_udf(STR_MATCH_UDF.clone());
        let plan2 =
            physical_plan_from_bytes_with_extension_codec(&plan_bytes, &ctx.task_ctx(), &proto)?;
        let plan2 = plan2.as_any().downcast_ref::<StreamingAggsExec>().unwrap();
        let plan = plan.as_any().downcast_ref::<StreamingAggsExec>().unwrap();

        // check
        assert_eq!(plan.id(), plan2.id());
        assert_eq!(plan.start_time(), plan2.start_time());
        assert_eq!(plan.end_time(), plan2.end_time());
        assert_eq!(plan.target_partitions(), plan2.target_partitions());
        assert_eq!(plan.is_complete_cache_hit(), plan2.is_complete_cache_hit());
        assert_eq!(plan.cached_files(), plan2.cached_files());

        // Verify that the aggregate plan contains a FilterExec
        let agg_plan_decoded = plan2.aggregate_plan();
        let agg_exec = agg_plan_decoded
            .as_any()
            .downcast_ref::<AggregateExec>()
            .unwrap();
        let input_plan = agg_exec.input();

        // The input should be a FilterExec
        assert!(input_plan.as_any().downcast_ref::<FilterExec>().is_some());

        Ok(())
    }
}
