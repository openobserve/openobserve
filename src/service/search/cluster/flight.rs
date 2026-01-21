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

use std::sync::{Arc, atomic::Ordering};

use arrow::array::RecordBatch;
use async_recursion::async_recursion;
use config::{
    cluster::LOCAL_NODE,
    datafusion::request::Request,
    get_config,
    meta::{
        cluster::{IntoArcVec, Node, Role, RoleGroup},
        search::{ScanStats, SearchEventType},
        sql::TableReferenceExt,
        stream::{QueryPartitionStrategy, StreamType},
    },
    metrics,
    utils::{json, time::now_micros, took_watcher::TookWatcher},
};
use datafusion::{
    common::TableReference, physical_plan::visit_execution_plan, prelude::SessionContext,
};
use hashbrown::{HashMap, HashSet};
use infra::{
    cluster,
    errors::{Error, ErrorCodes, Result},
    file_list::FileId,
    runtime::DATAFUSION_RUNTIME,
};
use itertools::Itertools;
use parking_lot::Mutex;
use tracing::{Instrument, info_span};
use tracing_opentelemetry::OpenTelemetrySpanExt;

#[cfg(feature = "enterprise")]
use crate::service::search::SEARCH_SERVER;
use crate::{
    handler::grpc::flight::visitor::get_peak_memory_from_ctx,
    service::{
        db::enrichment_table,
        search::{
            SearchResult,
            datafusion::{
                exec::{DataFusionContextBuilder, register_udf},
                optimizer::{
                    context::{
                        PhysicalOptimizerContext, RemoteScanContext, StreamingAggregationContext,
                    },
                    create_physical_plan, generate_analyzer_rules, generate_optimizer_rules,
                    generate_physical_optimizer_rules,
                },
                table_provider::{catalog::StreamTypeProvider, empty_table::NewEmptyTable},
            },
            inspector::{SearchInspectorFieldsBuilder, search_inspector_fields},
            sql::Sql,
            utils::{ScanStatsVisitor, check_query_default_limit_exceeded},
        },
    },
};

#[async_recursion]
#[tracing::instrument(
    name = "service:search:flight:leader",
    skip_all,
    fields(org_id = req.org_id)
)]
pub async fn search(trace_id: &str, sql: Arc<Sql>, mut req: Request) -> Result<SearchResult> {
    let mut took_watch = TookWatcher::new();
    let cfg = get_config();
    log::info!("[trace_id {trace_id}] flight->search: start {sql}");

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

    // 1. get file id list
    let file_id_list = get_file_id_lists(
        trace_id,
        &sql.org_id,
        sql.stream_type,
        &sql.stream_names,
        sql.time_range.unwrap_or_default(),
    )
    .await?;
    let file_id_list_vec = file_id_list.values().flatten().collect::<Vec<_>>();
    let file_id_list_num = file_id_list_vec.len();
    let file_id_list_records = file_id_list_vec.iter().map(|v| v.records).sum::<i64>();
    let file_id_list_took = took_watch.record_split("get_file_list").as_millis() as usize;
    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] flight->search: get file_list time_range: {:?}, files: {}, records: {}, took: {} ms",
                sql.time_range, file_id_list_num, file_id_list_records, file_id_list_took,
            ),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("flight:leader get file id".to_string())
                .search_role("leader".to_string())
                .duration(file_id_list_took)
                .desc(format!(
                    "get files {file_id_list_num} ids, records {file_id_list_records}"
                ))
                .build()
        )
    );

    #[cfg(feature = "enterprise")]
    let scan_stats = ScanStats {
        files: file_id_list_num as i64,
        original_size: file_id_list_vec.iter().map(|v| v.original_size).sum(),
        file_list_took: file_id_list_took as i64,
        ..Default::default()
    };

    // 3. get nodes
    let is_local_mode = req.local_mode.unwrap_or_default();
    let role_group = if is_local_mode {
        None
    } else {
        req.search_event_type
            .as_ref()
            .map(|v| {
                SearchEventType::try_from(v.as_str())
                    .ok()
                    .map(RoleGroup::from)
            })
            .unwrap_or(Some(RoleGroup::Interactive))
    };
    let mut nodes = get_online_querier_nodes(trace_id, role_group).await?;

    // local mode, only use local node as querier node
    if req.local_mode.unwrap_or_default() {
        if LOCAL_NODE.is_querier() {
            nodes.retain(|n| n.name.eq(&LOCAL_NODE.name));
        } else {
            nodes = nodes
                .into_iter()
                .filter(|n| n.is_querier())
                .take(1)
                .collect();
        }
    }

    let querier_num = nodes.iter().filter(|node| node.is_querier()).count();
    if querier_num == 0 {
        log::error!("no querier node online");
        return Err(Error::Message("no querier node online".to_string()));
    }

    log::info!(
        "{}",
        search_inspector_fields(
            format!(
                "[trace_id {trace_id}] flight->search: get nodes num: {}, querier num: {}",
                nodes.len(),
                querier_num,
            ),
            SearchInspectorFieldsBuilder::new()
                .node_name(LOCAL_NODE.name.clone())
                .component("flight:leader get nodes".to_string())
                .search_role("leader".to_string())
                .duration(took_watch.record_split("get_nodes").as_millis() as usize)
                .desc(format!(
                    "get nodes num: {}, querier num: {}",
                    nodes.len(),
                    querier_num
                ))
                .build()
        )
    );

    // waiting in work group queue
    metrics::QUERY_PENDING_NUMS
        .with_label_values(&[&req.org_id])
        .inc();

    let _lock = crate::service::search::work_group::acquire_work_group_lock(
        trace_id,
        &req,
        &mut took_watch,
        "logs",
        &nodes,
        &file_id_list_vec,
    )
    .await?;

    let took_wait = _lock.took_wait;
    let work_group_str = _lock.work_group_str.clone();

    // add work_group
    req.add_work_group(Some(work_group_str));

    metrics::QUERY_PENDING_NUMS
        .with_label_values(&[&sql.org_id])
        .dec();
    metrics::QUERY_RUNNING_NUMS
        .with_label_values(&[&sql.org_id])
        .inc();

    // 5. partition file list
    let partitioned_file_lists = partition_file_lists(file_id_list, &nodes, role_group).await?;
    let mut need_ingesters = 0;
    let mut need_queriers = 0;
    for (i, node) in nodes.iter().enumerate() {
        if node.is_ingester() {
            need_ingesters += 1;
            continue;
        }
        if node.is_querier()
            && partitioned_file_lists
                .values()
                .any(|v| v.get(i).map(|v| !v.is_empty()).unwrap_or_default())
        {
            need_queriers += 1;
        }
    }
    log::info!(
        "[trace_id {trace_id}] flight->search: get files num: {file_id_list_num}, need ingester num: {need_ingesters}, need querier num: {need_queriers}",
    );

    #[cfg(feature = "enterprise")]
    SEARCH_SERVER.add_file_stats(trace_id, &scan_stats).await;

    #[cfg(feature = "enterprise")]
    let (abort_sender, abort_receiver) = tokio::sync::oneshot::channel();
    #[cfg(feature = "enterprise")]
    if SEARCH_SERVER
        .insert_sender(trace_id, abort_sender, true)
        .await
        .is_err()
    {
        log::info!(
            "[trace_id {trace_id}] flight->search: search canceled before call flight->search"
        );
        return Err(Error::ErrorCode(
            infra::errors::ErrorCodes::SearchCancelQuery(format!(
                "[trace_id {trace_id}] flight->search: search canceled before call flight->search"
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
        "service:search:flight:datafusion",
        org_id = sql.org_id,
        stream_name = trace_stream_name,
        stream_type = sql.stream_type.to_string(),
    );

    let trace_id_move = trace_id.to_string();
    let query_task = DATAFUSION_RUNTIME.spawn(async move {
        run_datafusion(trace_id_move, req, sql, nodes, partitioned_file_lists)
            .instrument(datafusion_span)
            .await
    });
    tokio::pin!(query_task);

    // 8. execute physical plan
    let task = tokio::select! {
        ret = &mut query_task => {
            match ret {
                Ok(ret) => Ok(ret),
                Err(err) => {
                    log::error!("[trace_id {trace_id}] flight->search: datafusion execute error: {err}");
                    Err(Error::Message(err.to_string()))
                }
            }
        },
        _ = tokio::time::sleep(tokio::time::Duration::from_secs(timeout)) => {
            query_task.abort();
            log::error!("[trace_id {trace_id}] flight->search: search timeout");
            Err(Error::ErrorCode(ErrorCodes::SearchTimeout("flight->search: search timeout".to_string())))
        },
        _ = async {
            #[cfg(feature = "enterprise")]
            let _ = abort_receiver.await;
            #[cfg(not(feature = "enterprise"))]
            futures::future::pending::<()>().await;
        } => {
            query_task.abort();
            log::info!("[trace_id {trace_id}] flight->search: search canceled");
            Err(Error::ErrorCode(ErrorCodes::SearchCancelQuery("flight->search: search canceled".to_string())))
        }
    };

    // release lock
    drop(_lock);

    // 9. get data from datafusion
    let (data, mut scan_stats, partial_err): (Vec<RecordBatch>, ScanStats, String) = match task {
        Ok(Ok(data)) => Ok(data),
        Ok(Err(err)) => Err(err),
        Err(err) => Err(err),
    }?;

    log::info!(
        "[trace_id {trace_id}] flight->search: search finished, {}",
        took_watch.get_summary()
    );

    scan_stats.format_to_mb();
    scan_stats.file_list_took += file_id_list_took as i64;
    Ok((
        data,
        scan_stats,
        took_wait,
        !partial_err.is_empty(),
        partial_err,
    ))
}

#[tracing::instrument(name = "service:search:cluster:flight:run_datafusion", skip_all)]
pub async fn run_datafusion(
    trace_id: String,
    req: Request,
    sql: Arc<Sql>,
    nodes: Vec<Node>,
    partitioned_file_lists: HashMap<TableReference, Vec<Vec<i64>>>,
) -> Result<(Vec<RecordBatch>, ScanStats, String)> {
    let cfg = get_config();

    let is_complete_cache_hit = Arc::new(Mutex::new(false));
    let ctx = SearchContextBuilder::new()
        .target_partitions(cfg.limit.cpu_num)
        .add_context(PhysicalOptimizerContext::RemoteScan(RemoteScanContext {
            nodes: nodes.into_arc_vec(),
            partitioned_file_lists,
            context: tracing::Span::current().context(),
            is_leader: false,
        }))
        .add_context(PhysicalOptimizerContext::StreamingAggregation(
            StreamingAggregationContext::new(&req, is_complete_cache_hit.clone()).await?,
        ))
        .add_context(PhysicalOptimizerContext::AggregateTopk)
        .build(&req, &sql)
        .await?;

    log::info!(
        "[trace_id {trace_id}] flight->search: datafusion context created with target_partitions: {}",
        ctx.state().config().target_partitions(),
    );

    // register table
    register_table(&ctx, &sql).await?;

    // create physical plan
    let physical_plan = create_physical_plan(&ctx, &sql.sql).await?;

    if cfg.common.print_key_sql {
        log::info!("[trace_id {trace_id}] leader physical plan");
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
    let peak_memory = get_peak_memory_from_ctx(&ctx).load(Ordering::Relaxed);
    let mut visit = ScanStatsVisitor::new();
    let _ = visit_execution_plan(physical_plan.as_ref(), &mut visit);
    if let Err(e) = ret {
        log::error!("[trace_id {trace_id}] flight->search: datafusion collect error: {e}");
        Err(e.into())
    } else {
        log::info!(
            "{}",
            search_inspector_fields(
                format!("[trace_id {trace_id}] flight->search: datafusion collect done"),
                SearchInspectorFieldsBuilder::new()
                    .node_name(LOCAL_NODE.name.clone())
                    .component("flight:run_datafusion collect done".to_string())
                    .search_role("follower".to_string())
                    .duration(datafusion_start.elapsed().as_millis() as usize)
                    .build()
            )
        );
        visit.scan_stats.aggs_cache_ratio = aggs_cache_ratio;
        visit.scan_stats.peak_memory_usage = peak_memory.max(visit.peak_memory) as i64;
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

pub async fn get_online_querier_nodes(
    trace_id: &str,
    role_group: Option<RoleGroup>,
) -> Result<Vec<Node>> {
    // get nodes from cluster
    let cfg = get_config();
    let nodes = if cfg.common.feature_query_skip_wal {
        cluster::get_cached_online_querier_nodes(role_group).await
    } else {
        cluster::get_cached_online_query_nodes(role_group).await
    };
    let mut nodes = match nodes {
        Some(nodes) => nodes,
        None => {
            log::error!("[trace_id {trace_id}] flight->search: no querier node online");
            return Err(Error::Message("no querier node online".to_string()));
        }
    };
    // sort nodes by node_id this will improve hit cache ratio
    nodes.sort_by(|a, b| a.grpc_addr.cmp(&b.grpc_addr));
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);
    nodes.sort_by_key(|x| x.id);

    let querier_num = nodes.iter().filter(|node| node.is_querier()).count();
    if querier_num == 0 {
        log::error!("no querier node online");
        return Err(Error::Message("no querier node online".to_string()));
    }

    // use enterprise scheduler to filter nodes
    #[cfg(feature = "enterprise")]
    {
        nodes = o2_enterprise::enterprise::search::scheduler::filter_nodes_by_cpu(nodes);
    }

    Ok(nodes)
}

#[tracing::instrument(name = "service:search:cluster:flight:partition_file_lists", skip_all)]
pub async fn partition_file_lists(
    file_id_lists: HashMap<TableReference, Vec<FileId>>,
    nodes: &[Node],
    group: Option<RoleGroup>,
) -> Result<HashMap<TableReference, Vec<Vec<i64>>>> {
    let mut file_partitions = HashMap::with_capacity(file_id_lists.len());
    for (stream_name, file_id_list) in file_id_lists {
        let partitions = partition_file_list(file_id_list, nodes, group).await?;
        file_partitions.insert(stream_name, partitions);
    }
    Ok(file_partitions)
}

pub async fn partition_file_list(
    file_id_list: Vec<FileId>,
    nodes: &[Node],
    group: Option<RoleGroup>,
) -> Result<Vec<Vec<i64>>> {
    let cfg = get_config();
    let querier_num = nodes.iter().filter(|node| node.is_querier()).count();
    let mut partition_strategy = cfg.common.feature_query_partition_strategy.clone();
    if cfg.cache_latest_files.enabled {
        partition_strategy = QueryPartitionStrategy::FileHash;
    }
    let partitions = match partition_strategy {
        QueryPartitionStrategy::FileNum => partition_file_by_nums(file_id_list, querier_num),
        QueryPartitionStrategy::FileSize => partition_file_by_bytes(file_id_list, querier_num),
        QueryPartitionStrategy::FileHash => {
            partition_file_by_hash(file_id_list, nodes, group).await
        }
    };
    let mut partition_file_list = Vec::with_capacity(nodes.len());
    let mut partitions = partitions.into_iter();
    // partition file list, push file list to querier node
    for node in nodes {
        if node.is_querier() {
            partition_file_list.push(partitions.next().unwrap());
        } else {
            partition_file_list.push(vec![]);
        }
    }
    Ok(partition_file_list)
}

pub(crate) fn partition_file_by_nums(
    file_id_list: Vec<FileId>,
    querier_num: usize,
) -> Vec<Vec<i64>> {
    let file_distribute = distribute(file_id_list.len(), querier_num);

    let mut partitions = vec![Vec::new(); querier_num];

    for (i, num) in file_distribute.iter().enumerate() {
        if *num == 0 {
            break;
        }
        let start = file_distribute.iter().take(i).sum::<usize>();
        let end = start + num;
        partitions[i] = file_id_list[start..end].iter().map(|f| f.id).collect();
    }

    partitions
}

fn distribute(total: usize, n: usize) -> Vec<usize> {
    let base_value = total / n;
    let remainder = total % n;
    let mut buckets = vec![base_value; n];
    for item in buckets.iter_mut().take(remainder) {
        *item += 1;
    }
    buckets
}

pub(crate) fn partition_file_by_bytes(
    file_id_list: Vec<FileId>,
    querier_num: usize,
) -> Vec<Vec<i64>> {
    let mut partitions = vec![Vec::new(); querier_num];
    let sum_original_size = file_id_list.iter().map(|fk| fk.original_size).sum::<i64>();
    let avg_size = sum_original_size / querier_num as i64;
    let mut node_size = 0;
    let mut node_k = 0;
    for fk in file_id_list {
        node_size += fk.original_size;
        if node_size >= avg_size && node_k != querier_num - 1 && !partitions[node_k].is_empty() {
            node_size = fk.original_size;
            node_k += 1;
            partitions[node_k].push(fk.id);
            continue;
        }
        partitions[node_k].push(fk.id);
    }
    partitions
}

pub(crate) async fn partition_file_by_hash(
    file_id_list: Vec<FileId>,
    nodes: &[Node],
    group: Option<RoleGroup>,
) -> Vec<Vec<i64>> {
    let mut node_idx = HashMap::with_capacity(nodes.len());
    let mut idx = 0;
    for node in nodes {
        if !node.is_querier() {
            continue;
        }
        node_idx.insert(&node.name, idx);
        idx += 1;
    }
    let mut partitions = vec![Vec::new(); idx];
    for fk in file_id_list {
        let node_name =
            cluster::get_node_from_consistent_hash(&fk.id.to_string(), &Role::Querier, group).await;
        let idx = match node_name {
            Some(node_name) => match node_idx.get(&node_name) {
                Some(idx) => *idx,
                None => {
                    log::warn!("partition_file_by_hash: {node_name} not found in node_idx");
                    0
                }
            },
            None => {
                log::warn!(
                    "partition_file_by_hash: {} can't get a node from consistent hashing",
                    fk.id
                );
                0
            }
        };
        partitions[idx].push(fk.id);
    }
    partitions
}

pub struct SearchContextBuilder {
    pub target_partitions: usize,
    pub contexts: Vec<PhysicalOptimizerContext>,
}

impl SearchContextBuilder {
    pub fn new() -> Self {
        Self {
            target_partitions: 0,
            contexts: vec![],
        }
    }

    pub fn target_partitions(mut self, target_partitions: usize) -> Self {
        self.target_partitions = target_partitions;
        self
    }

    pub fn add_context(mut self, context: PhysicalOptimizerContext) -> Self {
        self.contexts.push(context);
        self
    }

    pub async fn build(self, req: &Request, sql: &Arc<Sql>) -> Result<SessionContext> {
        let analyzer_rules = generate_analyzer_rules(sql);
        let optimizer_rules = generate_optimizer_rules(sql);
        let physical_optimizer_rules = generate_physical_optimizer_rules(req, sql, self.contexts);
        let mut ctx = DataFusionContextBuilder::new()
            .trace_id(&req.trace_id)
            .work_group(req.work_group.clone())
            .analyzer_rules(analyzer_rules)
            .optimizer_rules(optimizer_rules)
            .physical_optimizer_rules(physical_optimizer_rules)
            .sorted_by_time(sql.sorted_by_time)
            .build(self.target_partitions)
            .await?;

        // register udf
        register_udf(&ctx, &req.org_id)?;
        datafusion_functions_json::register_all(&mut ctx)?;

        Ok(ctx)
    }
}

pub async fn register_table(ctx: &SessionContext, sql: &Sql) -> Result<()> {
    // register schema provider
    let mut registed_schema = HashSet::new();
    for (stream, _) in &sql.schemas {
        let stream_type = stream.stream_type();
        if !stream.has_stream_type() || registed_schema.contains(&stream_type) {
            continue;
        }
        registed_schema.insert(stream_type.clone());
        let schema_provider = StreamTypeProvider::create(&stream_type).await?;
        let _ = ctx
            .catalog("datafusion")
            .unwrap()
            .as_ref()
            .register_schema(&stream_type, schema_provider);
    }

    // register table
    for (stream, schema) in &sql.schemas {
        let schema = schema
            .schema()
            .as_ref()
            .clone()
            .with_metadata(Default::default());
        let stream_name = stream.to_quoted_string();
        let table = Arc::new(
            NewEmptyTable::new(&stream_name, Arc::new(schema))
                .with_partitions(ctx.state().config().target_partitions())
                .with_sorted_by_time(sql.sorted_by_time),
        );
        ctx.register_table(&stream_name, table)?;
    }

    Ok(())
}

#[tracing::instrument(name = "service:search:cluster:flight:get_file_id_lists", skip_all)]
pub async fn get_file_id_lists(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    stream_names: &[TableReference],
    mut time_range: (i64, i64),
) -> Result<HashMap<TableReference, Vec<FileId>>> {
    let mut file_lists = HashMap::with_capacity(stream_names.len());
    for stream in stream_names {
        let name = stream.stream_name();
        let stream_type = stream.get_stream_type(stream_type);
        // if stream is enrich, rewrite the time_range
        if let Some(schema) = stream.schema()
            && (schema == "enrich" || schema == "enrichment_tables")
        {
            let start = enrichment_table::get_start_time(org_id, &name).await;
            let end = now_micros();
            time_range = (start, end);
        }
        // get file list
        let file_id_list =
            crate::service::file_list::query_ids(trace_id, org_id, stream_type, &name, time_range)
                .await?;
        file_lists.insert(stream.clone(), file_id_list);
    }
    Ok(file_lists)
}
