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
    execution::FunctionRegistry,
    physical_plan::ExecutionPlan,
};
use datafusion_proto::{convert_required, protobuf::proto_error};
use prost::Message;
use proto::cluster_rpc;

use crate::datafusion::distributed_plan::enrichment_exec::EnrichmentExec;

pub fn try_decode(
    node: cluster_rpc::EnrichmentExecNode,
    _inputs: &[Arc<dyn ExecutionPlan>],
    _registry: &dyn FunctionRegistry,
) -> Result<Arc<dyn ExecutionPlan>> {
    if !is_plain_name(&node.org_id) || !is_plain_name(&node.stream_name) {
        return internal_err!(
            "EnrichmentExec invalid table {}/{}",
            node.org_id,
            node.stream_name
        );
    }
    let schema = Arc::new(convert_required!(node.schema)?);
    Ok(Arc::new(EnrichmentExec::new(
        node.trace_id,
        node.org_id,
        node.stream_name,
        schema,
    )))
}

pub fn try_encode(node: Arc<dyn ExecutionPlan>, buf: &mut Vec<u8>) -> Result<()> {
    let Some(node) = node.downcast_ref::<EnrichmentExec>() else {
        return internal_err!("Not supported");
    };
    let plan_node = cluster_rpc::EnrichmentExecNode {
        trace_id: node.trace_id().to_string(),
        org_id: node.org_id().to_string(),
        stream_name: node.stream_name().to_string(),
        schema: Some(node.schema().as_ref().try_into()?),
    };
    let proto = cluster_rpc::PhysicalPlanNode {
        plan: Some(cluster_rpc::physical_plan_node::Plan::EnrichmentExec(
            plan_node,
        )),
    };
    proto.encode(buf).map_err(|e| {
        DataFusionError::Internal(format!(
            "failed to encode EnrichmentExecNode execution plan: {e:?}"
        ))
    })?;
    Ok(())
}

/// Org and table names become local directory names, so they must be a single path segment.
fn is_plain_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\']) && !name.contains("..")
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

        let plan: Arc<dyn ExecutionPlan> = Arc::new(EnrichmentExec::new(
            "test-trace-id".to_string(),
            "test-org".to_string(),
            "test-stream".to_string(),
            Arc::clone(&schema),
        ));

        // encode
        let proto = super::super::get_physical_extension_codec();
        let plan_bytes = physical_plan_to_bytes_with_extension_codec(plan.clone(), &proto).unwrap();

        // decode
        let ctx = datafusion::prelude::SessionContext::new();
        let plan2 =
            physical_plan_from_bytes_with_extension_codec(&plan_bytes, &ctx.task_ctx(), &proto)?;
        let plan2 = plan2.downcast_ref::<EnrichmentExec>().unwrap();
        let plan = plan.downcast_ref::<EnrichmentExec>().unwrap();

        // check
        assert_eq!(plan.trace_id(), plan2.trace_id());
        assert_eq!(plan.org_id(), plan2.org_id());
        assert_eq!(plan.stream_name(), plan2.stream_name());
        assert_eq!(plan.schema(), plan2.schema());

        Ok(())
    }

    #[tokio::test]
    async fn test_decoded_names_escaping_table_dir_are_error() -> Result<()> {
        use config::utils::enrichment_local_cache::get_table_dir;
        use datafusion::arrow::array::{Int32Array, RecordBatch};
        use parquet::arrow::ArrowWriter;

        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        let outside = tempfile::tempdir().unwrap();
        let table_dir = outside.path().join("stolen");
        std::fs::create_dir_all(&table_dir)?;
        let batch =
            RecordBatch::try_new(schema.clone(), vec![Arc::new(Int32Array::from(vec![7]))])?;
        let mut writer = ArrowWriter::try_new(
            std::fs::File::create(table_dir.join("1.parquet"))?,
            schema.clone(),
            None,
        )?;
        writer.write(&batch)?;
        writer.close()?;
        // the OS only resolves `..` through directories that exist, as they do on a live node
        std::fs::create_dir_all(get_table_dir("t9_org"))?;
        let up = "../".repeat(64);
        let outside_rel = outside.path().to_str().unwrap().trim_start_matches('/');
        let cases = [
            ("t9_org".to_string(), format!("{up}{outside_rel}/stolen")),
            (format!("t9_org/{up}{outside_rel}"), "stolen".to_string()),
        ];

        for (org_id, stream_name) in cases {
            let plan: Arc<dyn ExecutionPlan> = Arc::new(EnrichmentExec::new(
                "trace".to_string(),
                org_id.clone(),
                stream_name.clone(),
                schema.clone(),
            ));
            let codec = super::super::get_physical_extension_codec();
            let bytes = physical_plan_to_bytes_with_extension_codec(plan, &codec)?;
            let ctx = datafusion::prelude::SessionContext::new();
            let ret = match physical_plan_from_bytes_with_extension_codec(
                &bytes,
                &ctx.task_ctx(),
                &codec,
            ) {
                Ok(decoded) => datafusion::physical_plan::collect(decoded, ctx.task_ctx())
                    .await
                    .map(|b| b.iter().map(|b| b.num_rows()).sum::<usize>()),
                Err(e) => Err(e),
            };
            assert!(ret.is_err(), "{org_id} / {stream_name} was read: {ret:?}");
        }
        Ok(())
    }
}
