// Copyright 2024 OpenObserve Inc.
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
    search::{ScanStats, SearchEventType},
    stream::FileKey,
};
use datafusion::{
    common::tree_node::TreeNode, physical_plan::ExecutionPlan, prelude::SessionContext,
};
use datafusion_proto::bytes::physical_plan_from_bytes_with_extension_codec;
use infra::{
    errors::{Error, Result},
    schema::get_stream_setting_index_fields,
};
use proto::cluster_rpc::{FlightSearchRequest, KvItem, SearchQuery};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::service::search::{
    cluster::flight::{
        check_work_group, get_inverted_index_file_list, get_online_querier_nodes,
        partition_filt_list,
    },
    datafusion::{
        distributed_plan::{
            codec::{ComposedPhysicalExtensionCodec, EmptyExecPhysicalExtensionCodec},
            empty_exec::NewEmptyExec,
            remote_scan::RemoteScanExec,
            NewEmptyExecVisitor,
        },
        exec::prepare_datafusion_context,
    },
    generate_filter_from_equal_items,
    request::Request,
    utlis::AsyncDefer,
};

/// in cluster search function only single stream take part in
// 1. get nodes
// 2. get file list
// 3. partition file list
// 4. get physical plan
// 5. add remote scan to physical plan
// 6. execute physical plan to get stream
#[tracing::instrument(name = "service:search:grpc:flight:follower:search", skip_all)]
pub async fn search(
    flight_request: &FlightSearchRequest,
) -> Result<(
    SessionContext,
    Arc<dyn ExecutionPlan>,
    AsyncDefer,
    ScanStats,
)> {
    let start = std::time::Instant::now();
    let cfg = config::get_config();
    let mut req: Request = flight_request.clone().into();
    let trace_id = req.trace_id.clone();

    // create datafusion context, just used for decode plan, the params can use default
    let mut ctx =
        prepare_datafusion_context(req.work_group.clone(), vec![], false, cfg.limit.cpu_num)
            .await?;

    // register function
    datafusion_functions_json::register_all(&mut ctx)?;

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
            "flight->follower_leader: physical plan visit error: there is no EmptyTable"
                .to_string(),
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

    // 1. get file id list
    let file_id_list = crate::service::file_list::query_ids(
        &req.org_id,
        req.stream_type,
        stream_name,
        req.time_range,
    )
    .await?;

    let file_id_list_vec = file_id_list.iter().collect::<Vec<_>>();
    let file_id_list_took = start.elapsed().as_millis() as usize;
    log::info!(
        "[trace_id {trace_id}] flight->follower_leader: get file_list time_range: {:?}, num: {}, took: {} ms",
        (flight_request.start_time, flight_request.end_time),
        file_id_list_vec.len(),
        file_id_list_took,
    );
    let mut scan_stats = ScanStats {
        files: file_id_list_vec.len() as i64,
        original_size: file_id_list_vec.iter().map(|v| v.original_size).sum(),
        ..Default::default()
    };

    // 2. get inverted index file list
    let (_use_inverted_index, idx_file_list, idx_scan_size, _idx_took) =
        get_inverted_index_file_lists(
            &trace_id,
            &req,
            stream_name,
            &flight_request.equal_keys,
            &flight_request.match_all_keys,
        )
        .await?;
    scan_stats.idx_scan_size = idx_scan_size as i64;

    // get nodes
    let node_group = req
        .search_event_type
        .as_ref()
        .map(|v| SearchEventType::from_str(v).ok().map(RoleGroup::from))
        .unwrap_or(None);
    let nodes = get_online_querier_nodes(&trace_id, node_group).await?;
    let querier_num = nodes.iter().filter(|node| node.is_querier()).count();
    if querier_num == 0 {
        log::error!("no querier node online");
        return Err(Error::Message("no querier node online".to_string()));
    }

    // check work group
    let (_took_wait, work_group_str, work_group) = check_work_group(
        &req,
        &trace_id,
        &nodes,
        &file_id_list_vec,
        start,
        file_id_list_took,
    )
    .await?;
    // add work_group
    req.add_work_group(Some(work_group_str));

    // release work_group in flight follow search
    let user_id = req.user_id.clone();
    let trace_id_move = trace_id.to_string();
    let defer = AsyncDefer::new({
        async move {
            let _ = work_group
                .as_ref()
                .unwrap()
                .done(&trace_id_move, user_id.as_deref())
                .await
                .map_err(|e| {
                    log::error!(
                        "[trace_id {trace_id_move}] release work_group in flight follow search error: {e}",
                    );
                    e.to_string();
                });
            log::info!("[trace_id {trace_id_move}] release work_group in flight follow search");
        }
    });

    // partition file list
    let partition_file_lists = partition_filt_list(file_id_list, &nodes, node_group).await?;

    // update search session scan stats
    super::super::SEARCH_SERVER
        .add_file_stats(
            &trace_id,
            scan_stats.files,
            scan_stats.records,
            scan_stats.original_size + scan_stats.idx_scan_size,
            scan_stats.compressed_size,
        )
        .await;

    let context = tracing::Span::current().context();
    // add sort preserving merge node to preserving the order
    if physical_plan.name() == "SortPreservingMergeExec" {
        let top_merge_node = physical_plan.clone();
        let remote_scan_exec = Arc::new(RemoteScanExec::new(
            physical_plan,
            partition_file_lists,
            idx_file_list,
            flight_request.equal_keys.clone(),
            flight_request.match_all_keys.clone(),
            false,
            req.clone(),
            nodes.into_arc_vec(),
            context,
        ));
        physical_plan = top_merge_node.with_new_children(vec![remote_scan_exec])?;
    } else {
        physical_plan = Arc::new(RemoteScanExec::new(
            physical_plan,
            partition_file_lists,
            idx_file_list,
            flight_request.equal_keys.clone(),
            flight_request.match_all_keys.clone(),
            false,
            req.clone(),
            nodes.into_arc_vec(),
            context,
        ));
    }

    log::info!("[trace_id {trace_id}] flight->follower_leader: generate physical plan finish",);

    Ok((ctx, physical_plan, defer, scan_stats))
}

#[tracing::instrument(
    name = "service:search:super_cluster:follower:get_inverted_index_file_lists",
    skip_all
)]
async fn get_inverted_index_file_lists(
    trace_id: &str,
    req: &Request,
    stream_name: &str,
    equal_terms: &[KvItem],
    match_terms: &[String],
) -> Result<(bool, Vec<FileKey>, usize, usize)> {
    let cfg = config::get_config();
    let inverted_index_type = if req.inverted_index_type.is_none()
        || req.inverted_index_type.as_ref().unwrap().is_empty()
    {
        cfg.common.inverted_index_search_format.clone()
    } else {
        req.inverted_index_type.as_ref().unwrap().to_string()
    };
    let use_inverted_index = req.use_inverted_index
        && (inverted_index_type == "parquet" || inverted_index_type == "both");
    log::info!(
        "[trace_id {trace_id}] flight->follower_leader: use_inverted_index with parquet format {}",
        use_inverted_index
    );

    if !use_inverted_index {
        return Ok((false, vec![], 0, 0));
    }

    // construct partition filters
    let equal_terms: Vec<(String, String)> = equal_terms
        .iter()
        .map(|v| (v.key.to_string(), v.value.to_string()))
        .collect::<Vec<_>>();
    // filter equal_items with index_fields
    let schema = infra::schema::get(&req.org_id, stream_name, req.stream_type).await?;
    let stream_settings = infra::schema::unwrap_stream_settings(&schema);
    let index_fields = get_stream_setting_index_fields(&stream_settings);
    let index_terms = super::super::filter_index_fields(&equal_terms, &index_fields);

    // construct SearchQuery for inverted index search
    let (start_time, end_time) = req.time_range.unwrap_or((0, 0));
    let query = SearchQuery {
        start_time,
        end_time,
        ..Default::default()
    };

    // use inverted index to filter file list
    let index_terms = generate_filter_from_equal_items(&index_terms);
    let (idx_file_list, idx_scan_size, idx_took) =
        get_inverted_index_file_list(req.clone(), query, stream_name, match_terms, &index_terms)
            .await?;

    log::info!(
        "[trace_id {trace_id}] flight->follower_leader: get file_list from inverted index time_range: {:?}, num: {}, scan_size: {}, took: {} ms",
        req.time_range,
        idx_file_list.len(),
        idx_scan_size,
        idx_took,
    );

    Ok((true, idx_file_list, idx_scan_size, idx_took))
}
