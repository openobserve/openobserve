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
    execution::TaskContext,
    physical_plan::{ExecutionPlan, expressions::Column},
};
use prost::Message;
use proto::cluster_rpc;

use crate::service::search::datafusion::plan::deduplication_exec::DeduplicationExec;

pub(super) fn try_decode(
    node: cluster_rpc::DeduplicationExecNode,
    inputs: &[Arc<dyn ExecutionPlan>],
    _ctx: &TaskContext,
) -> Result<Arc<dyn ExecutionPlan>> {
    if inputs.len() != 1 {
        return internal_err!("DeduplicationExec expected 1 input, got {}", inputs.len());
    }

    let input = inputs[0].clone();

    // Parse deduplication columns from PhysicalExprNode
    let mut deduplication_columns = Vec::new();
    for expr_proto in node.deduplication_columns {
        // Extract Column from PhysicalExprNode
        if let Some(datafusion_proto::protobuf::physical_expr_node::ExprType::Column(col)) =
            expr_proto.expr_type
        {
            deduplication_columns.push(Column::new(&col.name, col.index as usize));
        } else {
            return internal_err!("DeduplicationExec only supports Column expressions");
        }
    }

    Ok(Arc::new(DeduplicationExec::new(
        input,
        deduplication_columns,
        node.max_rows as usize,
    )))
}

pub(super) fn try_encode(node: Arc<dyn ExecutionPlan>, buf: &mut Vec<u8>) -> Result<()> {
    let exec = node
        .as_any()
        .downcast_ref::<DeduplicationExec>()
        .ok_or_else(|| {
            datafusion::error::DataFusionError::Internal(
                "Failed to downcast to DeduplicationExec".to_string(),
            )
        })?;

    // Encode deduplication columns as PhysicalExprNodes
    let mut deduplication_columns_proto = Vec::new();
    for column in exec.deduplication_columns() {
        let expr_proto = datafusion_proto::protobuf::PhysicalExprNode {
            expr_type: Some(
                datafusion_proto::protobuf::physical_expr_node::ExprType::Column(
                    datafusion_proto::protobuf::PhysicalColumn {
                        name: column.name().to_string(),
                        index: column.index() as u32,
                    },
                ),
            ),
        };
        deduplication_columns_proto.push(expr_proto);
    }

    let proto = cluster_rpc::PhysicalPlanNode {
        plan: Some(cluster_rpc::physical_plan_node::Plan::DeduplicationExec(
            cluster_rpc::DeduplicationExecNode {
                deduplication_columns: deduplication_columns_proto,
                max_rows: exec.max_rows() as u64,
            },
        )),
    };

    proto.encode(buf).map_err(|e| {
        datafusion::error::DataFusionError::Internal(format!(
            "Failed to encode DeduplicationExec: {}",
            e
        ))
    })
}
