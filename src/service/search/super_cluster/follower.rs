// Copyright 2024 Zinc Labs Inc.
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

use std::{collections::HashMap, str::FromStr, sync::Arc};

use config::meta::{
    cluster::{IntoArcVec, RoleGroup},
    search::SearchEventType,
};
use datafusion::{
    common::tree_node::TreeNode, physical_plan::ExecutionPlan, prelude::SessionContext,
};
use datafusion_proto::bytes::physical_plan_from_bytes_with_extension_codec;
use infra::{
    errors::Error,
    schema::{unwrap_partition_time_level, unwrap_stream_settings},
};
use proto::cluster_rpc::FlightSearchRequest;

use crate::service::search::{
    cluster::flight::{get_file_list, get_online_querier_nodes, partition_filt_list},
    datafusion::{
        distributed_plan::{
            codec::{ComposedPhysicalExtensionCodec, EmptyExecPhysicalExtensionCodec},
            empty_exec::NewEmptyExec,
            remote_scan::RemoteScanExec,
            NewEmptyExecVisitor,
        },
        exec::prepare_datafusion_context,
    },
    request::Request,
};

#[allow(dead_code)]
/// in cluster search function only single stream take part in
// 1. get nodes
// 2. get file list
// 3. partition file list
// 4. get physical plan
// 5. add remote scan to physical plan
// 6. execute physical plan to get stream
pub async fn search(
    flight_request: &FlightSearchRequest,
) -> Result<(SessionContext, Arc<dyn ExecutionPlan>), Error> {
    let cfg = config::get_config();
    let req: Request = flight_request.clone().into();

    // create datafusion context, just used for decode plan, the params can use default
    let ctx = prepare_datafusion_context(req.work_group.clone(), vec![], false, cfg.limit.cpu_num)
        .await?;

    // Decode physical plan from bytes
    let proto = ComposedPhysicalExtensionCodec {
        codecs: vec![Arc::new(EmptyExecPhysicalExtensionCodec {})],
    };
    let mut physical_plan =
        physical_plan_from_bytes_with_extension_codec(&flight_request.plan, &ctx, &proto)?;

    // replace empty table to real table
    let mut visitor = NewEmptyExecVisitor::default();
    if physical_plan.visit(&mut visitor).is_err() || visitor.get_data().is_none() {
        return Err(Error::Message(
            "flight->search: physical plan visit error: there is no EmptyTable".to_string(),
        ));
    }
    let empty_exec = visitor
        .get_data()
        .unwrap()
        .as_any()
        .downcast_ref::<NewEmptyExec>()
        .unwrap();

    // get stream name
    let stream_name = empty_exec.name();
    let schema_latest = empty_exec.schema();
    let mut schema_latest_map = HashMap::with_capacity(schema_latest.fields().len());
    for field in schema_latest.fields() {
        schema_latest_map.insert(field.name(), field);
    }

    // construct partition filters
    let search_partition_keys: Option<Vec<(String, String)>> = flight_request
        .partition_keys
        .iter()
        .filter_map(|v| {
            if schema_latest_map.contains_key(&v.key) {
                Some((v.key.to_string(), v.value.to_string()))
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .into();

    let stream_settings = unwrap_stream_settings(schema_latest.as_ref()).unwrap_or_default();
    let partition_time_level =
        unwrap_partition_time_level(stream_settings.partition_time_level, req.stream_type);
    // get file list
    let file_list = get_file_list(
        stream_name,
        &req.org_id,
        req.stream_type,
        req.time_range,
        &search_partition_keys.unwrap_or_default(),
        partition_time_level,
        &stream_settings.partition_keys,
    )
    .await;

    // get nodes
    let node_group = req
        .search_event_type
        .as_ref()
        .map(|v| SearchEventType::from_str(v).ok().map(RoleGroup::from))
        .unwrap_or(None);
    let nodes = get_online_querier_nodes(&req.trace_id, node_group).await?;
    let querier_num = nodes.iter().filter(|node| node.is_querier()).count();
    if querier_num == 0 {
        log::error!("no querier node online");
        return Err(Error::Message("no querier node online".to_string()));
    }

    // TODO
    // req.work_group = xxx; // set work_group to xxx

    // partition file list
    let partition_file_lists = partition_filt_list(file_list, &nodes, node_group).await?;

    // add sort preserving merge node to preserving the order
    if physical_plan.name() == "SortPreservingMergeExec" {
        let top_merge_node = physical_plan.clone();
        let remote_scan_exec = Arc::new(RemoteScanExec::new(
            physical_plan,
            partition_file_lists,
            flight_request.partition_keys.clone(),
            flight_request.match_all_keys.clone(),
            false,
            req.clone(),
            nodes.into_arc_vec(),
        ));
        physical_plan = top_merge_node.with_new_children(vec![remote_scan_exec])?;
    } else {
        physical_plan = Arc::new(RemoteScanExec::new(
            physical_plan,
            partition_file_lists,
            flight_request.partition_keys.clone(),
            flight_request.match_all_keys.clone(),
            false,
            req.clone(),
            nodes.into_arc_vec(),
        ));
    }

    Ok((ctx, physical_plan))
}
