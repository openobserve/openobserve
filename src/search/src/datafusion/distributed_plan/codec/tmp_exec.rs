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

use crate::datafusion::distributed_plan::tmp_exec::TmpExec;

pub fn try_decode(
    node: cluster_rpc::TmpExecNode,
    _inputs: &[Arc<dyn ExecutionPlan>],
    _registry: &dyn FunctionRegistry,
) -> Result<Arc<dyn ExecutionPlan>> {
    if !is_join_result_path(&node.path) {
        return internal_err!("TmpExec path is not a join result path: {}", node.path);
    }
    let schema = Arc::new(convert_required!(node.schema)?);
    Ok(Arc::new(TmpExec::new(
        node.trace_id,
        node.cluster,
        node.path,
        node.data,
        schema,
    )))
}

pub fn try_encode(node: Arc<dyn ExecutionPlan>, buf: &mut Vec<u8>) -> Result<()> {
    let Some(node) = node.downcast_ref::<TmpExec>() else {
        return internal_err!("Not supported");
    };
    let plan_node = cluster_rpc::TmpExecNode {
        trace_id: node.trace_id().to_string(),
        cluster: node.cluster().to_string(),
        path: node.path().to_string(),
        data: node.data().clone(),
        schema: Some(node.schema().as_ref().try_into()?),
    };
    let proto = cluster_rpc::PhysicalPlanNode {
        plan: Some(cluster_rpc::physical_plan_node::Plan::TmpExec(plan_node)),
    };
    proto.encode(buf).map_err(|e| {
        DataFusionError::Internal(format!(
            "failed to encode TmpExecNode writer execution plan: {e:?}"
        ))
    })?;
    Ok(())
}

/// Only broadcast-join results under `join/` may be read back from object storage.
pub fn is_join_result_path(path: &str) -> bool {
    use std::path::{Component, Path};
    path.starts_with("join/")
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use arrow::{
        array::{Int32Array, RecordBatch},
        ipc::writer::FileWriter,
    };
    use datafusion::arrow::datatypes::{DataType, Field, Schema};
    use datafusion_proto::bytes::{
        physical_plan_from_bytes_with_extension_codec, physical_plan_to_bytes_with_extension_codec,
    };

    use super::*;

    #[tokio::test]
    async fn test_datafusion_codec() -> Result<()> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![Arc::new(Int32Array::from(vec![
                0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
            ]))],
        )
        .unwrap();
        // write to buffer
        let mut buffer = Cursor::new(Vec::new());
        let mut writer = FileWriter::try_new(&mut buffer, &schema)?;
        writer.write(&batch)?;
        writer.finish()?;
        let buf = buffer.into_inner();

        let plan: Arc<dyn ExecutionPlan> = Arc::new(TmpExec::new(
            "test-trace-id".to_string(),
            "test".to_string(),
            "join/2025/01/01/test.arrow".to_string(),
            Some(buf),
            Arc::clone(&schema),
        ));

        // encode
        let proto = super::super::get_physical_extension_codec();
        let plan_bytes = physical_plan_to_bytes_with_extension_codec(plan.clone(), &proto).unwrap();

        // decode
        let ctx = datafusion::prelude::SessionContext::new();
        let plan2 =
            physical_plan_from_bytes_with_extension_codec(&plan_bytes, &ctx.task_ctx(), &proto)?;
        let plan2 = plan2.downcast_ref::<TmpExec>().unwrap();
        let plan = plan.downcast_ref::<TmpExec>().unwrap();

        // check
        assert_eq!(plan.trace_id(), plan2.trace_id());
        assert_eq!(plan.cluster(), plan2.cluster());
        assert_eq!(plan.schema(), plan2.schema());
        assert_eq!(plan.path(), plan2.path());
        assert_eq!(plan.data(), plan2.data());

        Ok(())
    }

    fn invalid_utf8_ipc() -> (Arc<Schema>, Vec<u8>) {
        use arrow::array::{Array, BinaryArray, StringArray};

        let schema = Arc::new(Schema::new(vec![Field::new("s", DataType::Utf8, true)]));
        let binary = BinaryArray::from_iter_values([b"ok".as_slice(), &[0xff, 0xfe, 0xfd]]);
        // SAFETY: deliberately invalid UTF-8 to exercise the reader's validation
        let strings = unsafe {
            StringArray::new_unchecked(
                binary.offsets().clone(),
                binary.values().clone(),
                binary.nulls().cloned(),
            )
        };
        let batch = RecordBatch::try_new(schema.clone(), vec![Arc::new(strings)]).unwrap();
        let mut buffer = Cursor::new(Vec::new());
        let mut writer = FileWriter::try_new(&mut buffer, &schema).unwrap();
        writer.write(&batch).unwrap();
        writer.finish().unwrap();
        (schema, buffer.into_inner())
    }

    async fn decode_and_collect(schema: Arc<Schema>, data: Vec<u8>) -> Result<Vec<RecordBatch>> {
        let plan: Arc<dyn ExecutionPlan> = Arc::new(TmpExec::new(
            "trace".to_string(),
            config::get_cluster_name(),
            "join/x.arrow".to_string(),
            Some(data),
            schema,
        ));
        let codec = super::super::get_physical_extension_codec();
        let bytes = physical_plan_to_bytes_with_extension_codec(plan, &codec)?;
        let ctx = datafusion::prelude::SessionContext::new();
        let decoded =
            physical_plan_from_bytes_with_extension_codec(&bytes, &ctx.task_ctx(), &codec)?;
        let stream = decoded.execute(0, ctx.task_ctx())?;
        datafusion::physical_plan::common::collect(stream).await
    }

    #[tokio::test]
    async fn test_decoded_invalid_ipc_data_is_error() {
        let (schema, data) = invalid_utf8_ipc();

        let ret = decode_and_collect(schema, data).await;

        assert!(
            ret.is_err(),
            "invalid IPC data was accepted: {:?}",
            ret.map(|b| b.iter().map(|b| b.num_rows()).sum::<usize>())
        );
    }

    #[tokio::test]
    async fn test_decoded_path_outside_join_prefix_is_error() {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        let batch = RecordBatch::try_new(schema.clone(), vec![Arc::new(Int32Array::from(vec![7]))])
            .unwrap();
        let mut buffer = Cursor::new(Vec::new());
        let mut writer = FileWriter::try_new(&mut buffer, &schema).unwrap();
        writer.write(&batch).unwrap();
        writer.finish().unwrap();
        let secret = "files/t9_other_org/secret.arrow";
        infra::storage::put("", secret, buffer.into_inner().into())
            .await
            .unwrap();

        for path in [
            secret,
            "join/../files/t9_other_org/secret.arrow",
            "/join/x.arrow",
        ] {
            let plan: Arc<dyn ExecutionPlan> = Arc::new(TmpExec::new(
                "trace".to_string(),
                config::get_cluster_name(),
                path.to_string(),
                None,
                schema.clone(),
            ));
            let codec = super::super::get_physical_extension_codec();
            let bytes = physical_plan_to_bytes_with_extension_codec(plan, &codec).unwrap();
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
            assert!(ret.is_err(), "{path} was read: {ret:?}");
        }
        let _ = infra::storage::del(vec![("", secret)]).await;
    }

    #[tokio::test]
    async fn test_decoded_truncated_ipc_data_is_error() {
        let (schema, mut data) = invalid_utf8_ipc();
        data.truncate(data.len() / 2);

        assert!(decode_and_collect(schema, data).await.is_err());
    }
}
