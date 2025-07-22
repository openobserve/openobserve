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

use arrow::array::RecordBatch;
use async_recursion::async_recursion;
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        cluster::{NodeInfo, RoleGroup},
        search::{ScanStats, SearchEventType},
        sql::TableReferenceExt,
    },
    metrics,
    utils::json,
};
use datafusion::{common::tree_node::TreeNode, physical_plan::visit_execution_plan};
use hashbrown::HashMap;
use infra::errors::{Error, ErrorCodes, Result};
use itertools::Itertools;
use o2_enterprise::enterprise::{search::WorkGroup, super_cluster::search::get_cluster_nodes};
use proto::cluster_rpc;
use tracing::{Instrument, info_span};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::service::search::{
    DATAFUSION_RUNTIME, SearchResult,
    cluster::flight::{generate_context, register_table},
    datafusion::distributed_plan::{remote_scan::RemoteScanExec, rewrite::RemoteScanRewriter},
    inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
    request::Request,
    sql::Sql,
    utils::ScanStatsVisitor,
};

#[async_recursion]
#[tracing::instrument(
    name = "service:search:flight:super_cluster_leader",
    skip_all,
    fields(org_id = req.org_id)
)]
pub async fn search(
    trace_id: &str,
    sql: Arc<Sql>,
    mut req: Request,
    _query: cluster_rpc::SearchQuery,
    req_regions: Vec<String>,
    req_clusters: Vec<String>,
) -> Result<SearchResult> {
    let _start = std::time::Instant::now();
    let cfg = get_config();
    log::info!("[trace_id {trace_id}] super cluster leader: start {}", sql);

    let timeout = if req.timeout > 0 {
        req.timeout as u64
    } else {
        cfg.limit.query_timeout
    };
    req.timeout = timeout as _;

    if sql
        .schemas
        .iter()
        .any(|(_, schema)| schema.schema().fields().is_empty())
    {
        return Ok((vec![], ScanStats::new(), 0, false, "".to_string()));
    }

    let (use_inverted_index, _) = super::super::is_use_inverted_index(&sql);
    req.set_use_inverted_index(use_inverted_index);

    // 2. get nodes
    let get_node_start = std::time::Instant::now();
    let role_group = req
        .search_event_type
        .as_ref()
        .map(|v| {
            SearchEventType::try_from(v.as_str())
                .ok()
                .map(RoleGroup::from)
        })
        .unwrap_or(Some(RoleGroup::Interactive));
    let nodes = get_cluster_nodes(trace_id, req_regions, req_clusters, role_group).await?;
    log::info!(
        "{}",
        search_inspector_fields(
            format!("[trace_id {trace_id}] super get nodes: {}", nodes.len()),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("super get nodes".to_string())
                .search_role("super".to_string())
                .duration(get_node_start.elapsed().as_millis() as usize)
                .build()
        )
    );

    metrics::QUERY_RUNNING_NUMS
        .with_label_values(&[&sql.org_id])
        .inc();

    let (abort_sender, abort_receiver) = tokio::sync::oneshot::channel();
    if super::super::SEARCH_SERVER
        .insert_sender(trace_id, abort_sender, true)
        .await
        .is_err()
    {
        log::info!(
            "[trace_id {trace_id}] super cluster leader: search canceled before execution plan"
        );
        return Err(Error::ErrorCode(
            infra::errors::ErrorCodes::SearchCancelQuery(format!(
                "[trace_id {trace_id}] super cluster leader: search canceled before execution plan"
            )),
        ));
    }

    let trace_stream_name = json::to_string(
        &sql.stream_names
            .iter()
            .map(|s| (s.get_stream_type(sql.stream_type), s.stream_name()))
            .collect_vec(),
    )
    .unwrap();
    let datafusion_span = info_span!(
        "service:search:flight:super_cluster::datafusion",
        org_id = sql.org_id,
        stream_name = trace_stream_name,
    );

    let trace_id_move = trace_id.to_string();
    let follower_nodes = nodes.clone();
    let query_task = DATAFUSION_RUNTIME.spawn(async move {
        run_datafusion(trace_id_move, req, sql, follower_nodes)
            .instrument(datafusion_span)
            .await
    });
    tokio::pin!(query_task);

    let task = tokio::select! {
        ret = &mut query_task => {
            match ret {
                Ok(ret) => Ok(ret),
                Err(err) => {
                    log::error!("[trace_id {trace_id}] super cluster leader: datafusion execute error: {}", err);
                    Err(Error::Message(err.to_string()))
                }
            }
        },
        _ = tokio::time::sleep(tokio::time::Duration::from_secs(timeout)) => {
            query_task.abort();
            log::error!("[trace_id {trace_id}] super cluster leader: search timeout");
            Err(Error::ErrorCode(ErrorCodes::SearchTimeout("super cluster leader: search timeout".to_string())))
        },
        _ = abort_receiver => {
            query_task.abort();
            log::info!("[trace_id {trace_id}] super cluster leader: search canceled");
            Err(Error::ErrorCode(ErrorCodes::SearchCancelQuery("super cluster leader: search canceled".to_string())))
        }
    };

    let data = match task {
        Ok(Ok(data)) => Ok(data),
        Ok(Err(err)) => Err(err),
        Err(err) => Err(err),
    };
    let (data, mut scan_stats, partial_err) = match data {
        Ok(v) => v,
        Err(e) => {
            return Err(e);
        }
    };

    let main_trace_id = trace_id.split("-").next().unwrap();
    let stats = super::super::utils::collect_scan_stats(&nodes, main_trace_id, true).await;
    scan_stats.add(&stats);

    log::info!("[trace_id {trace_id}] super cluster leader: search finished");

    scan_stats.format_to_mb();
    Ok((data, scan_stats, 0, !partial_err.is_empty(), partial_err))
}

async fn run_datafusion(
    trace_id: String,
    mut req: Request,
    sql: Arc<Sql>,
    nodes: Vec<Arc<dyn NodeInfo>>,
) -> Result<(Vec<RecordBatch>, ScanStats, String)> {
    let cfg = get_config();
    // set work group
    let work_group = if sql.is_complex {
        WorkGroup::Long.to_string()
    } else {
        WorkGroup::Short.to_string()
    };
    req.add_work_group(Some(work_group));

    // construct physical plan
    let ctx = match generate_context(&req, &sql, cfg.limit.cpu_num).await {
        Ok(v) => v,
        Err(e) => {
            return Err(e);
        }
    };

    // register table
    register_table(&ctx, &sql).await?;

    // create physical plan
    let plan = match ctx.state().create_logical_plan(&sql.sql).await {
        Ok(v) => v,
        Err(e) => {
            return Err(e.into());
        }
    };
    let mut physical_plan = match ctx.state().create_physical_plan(&plan).await {
        Ok(v) => v,
        Err(e) => {
            return Err(e.into());
        }
    };

    if cfg.common.print_key_sql {
        log::info!("[trace_id {trace_id}] leader physical plan before rewrite");
        log::info!(
            "{}",
            config::meta::plan::generate_plan_string(&trace_id, physical_plan.as_ref())
        );
    }

    // 6. rewrite physical plan
    let match_all_keys = sql.match_items.clone().unwrap_or_default();
    let partition_keys = sql
        .equal_items
        .iter()
        .map(|(stream_name, fields)| {
            (
                stream_name.clone(),
                fields
                    .iter()
                    .map(|(k, v)| cluster_rpc::KvItem::new(k, v))
                    .collect::<Vec<_>>(),
            )
        })
        .collect::<HashMap<_, _>>();

    let (start_time, end_time) = req.time_range.unwrap_or((0, 0));
    let streaming_output = req.streaming_output;
    let streaming_id = req.streaming_id.clone();
    let use_cache = req.use_cache;
    let org_id = req.org_id.clone();

    let context = tracing::Span::current().context();
    let mut rewrite = RemoteScanRewriter::new(
        req,
        nodes,
        HashMap::new(),
        Vec::new(),
        partition_keys,
        match_all_keys,
        sql.index_condition.clone(),
        sql.index_optimize_mode.clone(),
        true,
        context,
    );
    physical_plan = match physical_plan.rewrite(&mut rewrite) {
        Ok(v) => v.data,
        Err(e) => {
            return Err(e.into());
        }
    };

    // add remote scan exec to top if physical plan is not changed
    if !rewrite.is_changed {
        let table_name = sql.stream_names.first().unwrap();
        physical_plan = Arc::new(RemoteScanExec::new(
            physical_plan,
            rewrite.remote_scan_nodes.get_remote_node(table_name),
        )?);
    }

    // check for streaming aggregation query
    let mut aggs_cache_ratio = 0;

    if streaming_output {
        let Some(streaming_id) = streaming_id else {
            return Err(Error::Message(
                "streaming_id is required for streaming aggregation query".to_string(),
            ));
        };

        // NOTE: temporary check
        let org_settings = crate::service::db::organization::get_org_setting(&org_id)
            .await
            .unwrap_or_default();
        let use_cache = use_cache && org_settings.aggregation_cache_enabled;
        let target_partitions = ctx.state().config().target_partitions();
        let (plan, is_complete_cache_hit, is_complete_cache_hit_with_no_data) =
            o2_enterprise::enterprise::search::datafusion::rewrite::rewrite_streaming_agg_plan(
                streaming_id,
                start_time,
                end_time,
                use_cache,
                target_partitions,
                physical_plan,
            )
            .await?;
        physical_plan = plan;
        // Check for aggs cache hit
        if is_complete_cache_hit {
            aggs_cache_ratio = 100;
        }

        // no need to run datafusion, return empty result
        if is_complete_cache_hit_with_no_data {
            let scan_stats = ScanStats {
                aggs_cache_ratio,
                ..Default::default()
            };
            return Ok((vec![], scan_stats, "".to_string()));
        }
    }

    // rewrite physical plan for merge aggregation and get topk
    let plan = o2_enterprise::enterprise::search::datafusion::rewrite::rewrite_topk_agg_plan(
        sql.limit,
        physical_plan,
    )
    .await?;
    physical_plan = plan;

    if cfg.common.print_key_sql {
        log::info!("[trace_id {trace_id}] leader physical plan after rewrite");
        log::info!(
            "{}",
            config::meta::plan::generate_plan_string(&trace_id, physical_plan.as_ref())
        );
    }

    let datafusion_start = std::time::Instant::now();
    let ret = datafusion::physical_plan::collect(physical_plan.clone(), ctx.task_ctx()).await;
    let mut visit = ScanStatsVisitor::new();
    let _ = visit_execution_plan(physical_plan.as_ref(), &mut visit);
    if let Err(e) = ret {
        log::error!("[trace_id {trace_id}] super cluster leader: datafusion collect error: {e}");
        Err(e.into())
    } else {
        log::info!(
            "{}",
            search_inspector_fields(
                format!("[trace_id {trace_id}] super cluster leader: datafusion collect done"),
                SearchInspectorFieldsBuilder::new()
                    .node_name(LOCAL_NODE.name.clone())
                    .component("super:leader:run_datafusion collect done".to_string())
                    .search_role("super".to_string())
                    .duration(datafusion_start.elapsed().as_millis() as usize)
                    .build()
            )
        );
        visit.scan_stats.aggs_cache_ratio = aggs_cache_ratio;
        ret.map(|data| (data, visit.scan_stats, visit.partial_err))
            .map_err(|e| e.into())
    }
}
