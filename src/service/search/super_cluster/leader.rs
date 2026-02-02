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
    datafusion::request::Request,
    get_config,
    meta::{
        cluster::{NodeInfo, RoleGroup},
        search::{ScanStats, SearchEventType},
        sql::TableReferenceExt,
    },
    metrics,
    utils::json,
};
use datafusion::physical_plan::visit_execution_plan;
use hashbrown::HashMap;
use infra::{
    errors::{Error, ErrorCodes, Result},
    runtime::DATAFUSION_RUNTIME,
};
use itertools::Itertools;
use o2_enterprise::enterprise::{search::WorkGroup, super_cluster::search::get_cluster_nodes};
use parking_lot::Mutex;
use proto::cluster_rpc;
use tracing::{Instrument, info_span};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::service::search::{
    SEARCH_SERVER, SearchResult,
    cluster::flight::{SearchContextBuilder, register_table},
    datafusion::optimizer::{
        context::{PhysicalOptimizerContext, RemoteScanContext, StreamingAggregationContext},
        create_physical_plan,
    },
    inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
    sql::Sql,
    utils::{AsyncDefer, ScanStatsVisitor, check_query_default_limit_exceeded},
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
    log::info!("[trace_id {trace_id}] super cluster leader: start {sql}");

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

    // 2. get clusters
    let get_cluster_start = std::time::Instant::now();
    let role_group = req
        .search_event_type
        .as_ref()
        .map(|v| {
            SearchEventType::try_from(v.as_str())
                .ok()
                .map(RoleGroup::from)
        })
        .unwrap_or(Some(RoleGroup::Interactive));
    let clusters = get_cluster_nodes(trace_id, req_regions, req_clusters, role_group).await?;
    let clusters_num = clusters.len();
    log::info!(
        "{}",
        search_inspector_fields(
            format!("[trace_id {trace_id}] super get clusters: {clusters_num}"),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("super get clusters".to_string())
                .search_role("super".to_string())
                .duration(get_cluster_start.elapsed().as_millis() as usize)
                .build()
        )
    );

    metrics::QUERY_RUNNING_NUMS
        .with_label_values(&[&sql.org_id])
        .inc();

    let org_id_move = sql.org_id.clone();
    let _defer = AsyncDefer::new({
        async move {
            metrics::QUERY_RUNNING_NUMS
                .with_label_values(&[&org_id_move])
                .dec();
        }
    });

    let (abort_sender, abort_receiver) = tokio::sync::oneshot::channel();
    if SEARCH_SERVER
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
    let query_task = DATAFUSION_RUNTIME.spawn(async move {
        run_datafusion(trace_id_move, req, sql, clusters)
            .instrument(datafusion_span)
            .await
    });
    tokio::pin!(query_task);

    let task = tokio::select! {
        ret = &mut query_task => {
            match ret {
                Ok(ret) => Ok(ret),
                Err(err) => {
                    log::error!("[trace_id {trace_id}] super cluster leader: datafusion execute error: {err}");
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

    drop(_defer);

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
    let is_complete_cache_hit = Arc::new(Mutex::new(false));
    let ctx = SearchContextBuilder::new()
        .target_partitions(cfg.limit.cpu_num)
        .add_context(PhysicalOptimizerContext::RemoteScan(RemoteScanContext {
            nodes,
            partitioned_file_lists: HashMap::new(),
            context: tracing::Span::current().context(),
            is_leader: true,
        }))
        .add_context(PhysicalOptimizerContext::StreamingAggregation(
            StreamingAggregationContext::new(&req, is_complete_cache_hit.clone()).await?,
        ))
        .add_context(PhysicalOptimizerContext::AggregateTopk)
        .build(&req, &sql)
        .await?;

    // register table
    register_table(&ctx, &sql).await?;

    // create physical plan
    let physical_plan = create_physical_plan(&ctx, &sql.sql).await?;

    if cfg.common.print_key_sql {
        log::info!("[trace_id {trace_id}] super cluster leader: physical plan");
        log::info!(
            "{}",
            config::meta::plan::generate_plan_string(&trace_id, physical_plan.as_ref())
        );
    }

    let mut aggs_cache_ratio = 0;
    if *is_complete_cache_hit.lock() {
        aggs_cache_ratio = 100;
    }
    // run datafusion
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
        ret.map(|data| {
            check_query_default_limit_exceeded(
                data.iter().fold(0, |acc, batch| acc + batch.num_rows()),
                &mut visit.partial_err,
                &sql,
            );
            (data, visit.scan_stats, visit.partial_err)
        })
        .map_err(|e| e.into())
    }
}
