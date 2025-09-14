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
    common::Result,
    execution::FunctionRegistry,
    physical_plan::ExecutionPlan,
};
use datafusion_proto::physical_plan::PhysicalExtensionCodec;
use prost::Message;
use proto::cluster_rpc;
use crate::service::search::datafusion::distributed_plan::histogram_sort_merge_join_exec::HistogramSortMergeJoinExec;

#[derive(Debug)]
pub struct HistogramSortMergeJoinExecPhysicalExtensionCodec;

impl PhysicalExtensionCodec for HistogramSortMergeJoinExecPhysicalExtensionCodec {
    fn try_decode(
        &self,
        buf: &[u8],
        inputs: &[Arc<dyn ExecutionPlan>],
        _registry: &dyn FunctionRegistry,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let proto = cluster_rpc::HistogramSortMergeJoinExecNode::decode(buf).map_err(|e| {
            datafusion::common::DataFusionError::Internal(format!(
                "failed to decode HistogramSortMergeJoinExecNode: {e:?}"
            ))
        })?;

        if inputs.len() != 2 {
            return Err(datafusion::common::DataFusionError::Internal(format!(
                "HistogramSortMergeJoinExec requires exactly 2 inputs, got {}",
                inputs.len()
            )));
        }

        let join_columns: Vec<(String, String)> = proto
            .join_columns
            .into_iter()
            .map(|pair| (pair.left_column, pair.right_column))
            .collect();

        let histogram_join_exec = HistogramSortMergeJoinExec::new(
            inputs[0].clone(),
            inputs[1].clone(),
            proto.left_time_column,
            proto.right_time_column,
            join_columns,
            proto.time_bin_interval,
            None,
        )?;
        Ok(Arc::new(histogram_join_exec))
    }

    fn try_encode(&self, node: Arc<dyn ExecutionPlan>, buf: &mut Vec<u8>) -> Result<()> {
        let histogram_join = node
            .as_any()
            .downcast_ref::<HistogramSortMergeJoinExec>()
            .ok_or_else(|| {
                datafusion::common::DataFusionError::Internal(
                    "HistogramSortMergeJoinExecPhysicalExtensionCodec can only encode HistogramSortMergeJoinExec".to_string()
                )
            })?;

        let join_columns: Vec<cluster_rpc::JoinColumnPair> = histogram_join
            .join_columns()
            .iter()
            .map(|(left, right)| cluster_rpc::JoinColumnPair {
                left_column: left.clone(),
                right_column: right.clone(),
            })
            .collect();

        let proto = cluster_rpc::HistogramSortMergeJoinExecNode {
            left_time_column: histogram_join.left_time_column().to_string(),
            right_time_column: histogram_join.right_time_column().to_string(),
            join_columns,
            time_bin_interval: histogram_join.time_bin_interval().to_string(),
            left_plan: None,
            right_plan: None,
        };

        proto.encode(buf).map_err(|e| {
            datafusion::common::DataFusionError::Internal(format!(
                "failed to encode HistogramSortMergeJoinExecNode: {e:?}"
            ))
        })?;
        Ok(())
    }

    fn try_decode_udf(&self, _name: &str, _buf: &[u8]) -> Result<Arc<datafusion::logical_expr::ScalarUDF>> {
        Err(datafusion::common::DataFusionError::Internal(
            "HistogramSortMergeJoinExecPhysicalExtensionCodec does not support UDF decoding".to_string()
        ))
    }

    fn try_encode_udf(&self, _node: &datafusion::logical_expr::ScalarUDF, _buf: &mut Vec<u8>) -> Result<()> {
        Err(datafusion::common::DataFusionError::Internal(
            "HistogramSortMergeJoinExecPhysicalExtensionCodec does not support UDF encoding".to_string()
        ))
    }
}

pub fn try_decode(
    node: &cluster_rpc::HistogramSortMergeJoinExecNode,
    inputs: &[Arc<dyn ExecutionPlan>],
    _registry: &dyn FunctionRegistry,
) -> Result<Arc<dyn ExecutionPlan>> {
    if inputs.len() != 2 {
        return Err(datafusion::common::DataFusionError::Internal(format!(
            "HistogramSortMergeJoinExec requires exactly 2 inputs, got {}",
            inputs.len()
        )));
    }

    let join_columns: Vec<(String, String)> = node
        .join_columns
        .iter()
        .map(|pair| (pair.left_column.clone(), pair.right_column.clone()))
        .collect();

    let histogram_join_exec = HistogramSortMergeJoinExec::new(
        inputs[0].clone(),
        inputs[1].clone(),
        node.left_time_column.clone(),
        node.right_time_column.clone(),
        join_columns,
        node.time_bin_interval.clone(),
        None,
    )?;
    Ok(Arc::new(histogram_join_exec))
}

pub fn try_encode(node: Arc<dyn ExecutionPlan>, buf: &mut Vec<u8>) -> Result<()> {
    let histogram_join = node
        .as_any()
        .downcast_ref::<HistogramSortMergeJoinExec>()
        .ok_or_else(|| {
            datafusion::common::DataFusionError::Internal(
                "try_encode can only encode HistogramSortMergeJoinExec".to_string()
            )
        })?;

    let join_columns: Vec<cluster_rpc::JoinColumnPair> = histogram_join
        .join_columns()
        .iter()
        .map(|(left, right)| cluster_rpc::JoinColumnPair {
            left_column: left.clone(),
            right_column: right.clone(),
        })
        .collect();

    let proto = cluster_rpc::HistogramSortMergeJoinExecNode {
        left_time_column: histogram_join.left_time_column().to_string(),
        right_time_column: histogram_join.right_time_column().to_string(),
        join_columns,
        time_bin_interval: histogram_join.time_bin_interval().to_string(),
        left_plan: None,
        right_plan: None,
    };

    proto.encode(buf).map_err(|e| {
        datafusion::common::DataFusionError::Internal(format!(
            "failed to encode HistogramSortMergeJoinExecNode: {e:?}"
        ))
    })?;
    Ok(())
}