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

use std::{str::FromStr, sync::Arc};

use arrow::array::RecordBatch;
use async_recursion::async_recursion;
use config::{
    get_config,
    meta::{
        bitvec::BitVec,
        cluster::{IntoArcVec, Node, Role, RoleGroup},
        search::{ScanStats, SearchEventType},
        stream::{FileKey, QueryPartitionStrategy, StreamType},
    },
    metrics,
    utils::inverted_index::split_token,
    INDEX_FIELD_NAME_FOR_ALL, QUERY_WITH_NO_LIMIT,
};
use datafusion::{
    common::tree_node::TreeNode,
    error::DataFusionError,
    physical_plan::{displayable, visit_execution_plan, ExecutionPlan},
    prelude::SessionContext,
};
use hashbrown::{HashMap, HashSet};
use infra::{
    dist_lock,
    errors::{Error, Result},
    file_list::FileId,
};
use proto::cluster_rpc::{self, SearchQuery};
use tracing::{info_span, Instrument};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{
    common::infra::cluster as infra_cluster,
    service::search::{
        datafusion::{
            distributed_plan::{remote_scan::RemoteScanExec, rewrite::RemoteScanRewriter},
            exec::{prepare_datafusion_context, register_udf},
            optimizer::generate_optimizer_rules,
            table_provider::empty_table::NewEmptyTable,
        },
        generate_filter_from_equal_items,
        request::Request,
        sql::Sql,
        utlis::{AsyncDefer, ScanStatsVisitor},
        DATAFUSION_RUNTIME,
    },
};

#[async_recursion]
#[tracing::instrument(
    name = "service:search:flight:leader",
    skip_all,
    fields(org_id = req.org_id)
)]
pub async fn search(
    trace_id: &str,
    sql: Arc<Sql>,
    mut req: Request,
    query: SearchQuery,
) -> Result<(Vec<RecordBatch>, ScanStats, usize, bool, usize)> {
    let start = std::time::Instant::now();
    let cfg = get_config();
    log::info!("[trace_id {trace_id}] flight->search: start {}", sql);

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
        return Ok((vec![], ScanStats::new(), 0, false, 0));
    }

    // 1. get file id list
    let file_id_list = get_file_id_lists(
        &sql.org_id,
        sql.stream_type,
        &sql.stream_names,
        sql.time_range,
    )
    .await?;
    let file_id_list_vec = file_id_list.values().flatten().collect::<Vec<_>>();
    let file_id_list_took = start.elapsed().as_millis() as usize;
    log::info!(
        "[trace_id {trace_id}] flight->search: get file_list time_range: {:?}, num: {}, took: {} ms",
        sql.time_range,
        file_id_list_vec.len(),
        file_id_list_took,
    );
    let mut scan_stats = ScanStats {
        files: file_id_list_vec.len() as i64,
        original_size: file_id_list_vec.iter().map(|v| v.original_size).sum(),
        ..Default::default()
    };

    // 2. get inverted index file list
    let (use_fst_inverted_index, idx_file_list, idx_scan_size, idx_took) =
        get_inverted_index_file_lists(trace_id, &req, &sql, &query).await?;
    scan_stats.idx_scan_size = idx_scan_size as i64;
    req.set_use_inverted_index(use_fst_inverted_index);

    // 3. get nodes
    let node_group = req
        .search_event_type
        .as_ref()
        .map(|v| SearchEventType::from_str(v).ok().map(RoleGroup::from))
        .unwrap_or(None);
    let nodes = get_online_querier_nodes(trace_id, node_group).await?;
    let querier_num = nodes.iter().filter(|node| node.is_querier()).count();
    if querier_num == 0 {
        log::error!("no querier node online");
        return Err(Error::Message("no querier node online".to_string()));
    }

    // waiting in work group queue
    metrics::QUERY_PENDING_NUMS
        .with_label_values(&[&req.org_id])
        .inc();

    // 4. check work group
    let file_list_took = start.elapsed().as_millis() as usize;
    #[cfg(not(feature = "enterprise"))]
    let (took_wait, work_group_str, locker) =
        check_work_group(&req, trace_id, &nodes, start, file_list_took).await?;
    #[cfg(feature = "enterprise")]
    let (took_wait, work_group_str, work_group) = check_work_group(
        &req,
        trace_id,
        &nodes,
        &file_id_list_vec,
        start,
        file_list_took,
    )
    .await?;
    // add work_group
    req.add_work_group(Some(work_group_str));

    metrics::QUERY_PENDING_NUMS
        .with_label_values(&[&sql.org_id])
        .dec();
    metrics::QUERY_RUNNING_NUMS
        .with_label_values(&[&sql.org_id])
        .inc();

    // release lock when search done or get error
    let trace_id_move = trace_id.to_string();
    #[cfg(not(feature = "enterprise"))]
    let _defer = AsyncDefer::new({
        async move {
            // search done, release lock
            let _ = dist_lock::unlock_with_trace_id(&trace_id_move, &locker)
                .await
                .map_err(|e| {
                    log::error!(
                        "[trace_id {trace_id_move}] release lock in flight search error: {e}"
                    );
                    Error::Message(e.to_string())
                });
            log::info!("[trace_id {trace_id_move}] release lock in flight search");
        }
    });

    #[cfg(feature = "enterprise")]
    let user_id = req.user_id.clone();
    #[cfg(feature = "enterprise")]
    let _defer = AsyncDefer::new({
        async move {
            // search done, release lock
            let _ = work_group
                .as_ref()
                .unwrap()
                .done(&trace_id_move, user_id.as_deref())
                .await
                .map_err(|e| {
                    log::error!(
                        "[trace_id {trace_id_move}] release work group in flight search error: {e}",
                    );
                    e.to_string();
                });
            log::info!("[trace_id {trace_id_move}] release work group in flight search");
        }
    });

    // 5. partition file list
    let partitioned_file_lists = partition_file_lists(file_id_list, &nodes, node_group).await?;

    #[cfg(feature = "enterprise")]
    super::super::SEARCH_SERVER
        .add_file_stats(
            trace_id,
            scan_stats.files,
            scan_stats.records,
            scan_stats.original_size + scan_stats.idx_scan_size,
            scan_stats.compressed_size,
        )
        .await;

    #[cfg(feature = "enterprise")]
    let (abort_sender, abort_receiver) = tokio::sync::oneshot::channel();
    #[cfg(feature = "enterprise")]
    if super::super::SEARCH_SERVER
        .insert_sender(trace_id, abort_sender)
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

    let datafusion_span = info_span!(
        "service:search:flight:datafusion",
        org_id = sql.org_id,
        stream_name = sql.stream_names.first().unwrap(),
        stream_type = sql.stream_type.to_string(),
    );

    let trace_id_move = trace_id.to_string();
    let query_task = DATAFUSION_RUNTIME.spawn(async move {
        run_datafusion(
            trace_id_move,
            req,
            sql,
            nodes,
            partitioned_file_lists,
            idx_file_list,
        )
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
                    log::error!("[trace_id {trace_id}] flight->search: datafusion execute error: {}", err);
                    Err(DataFusionError::Execution(err.to_string()))
                }
            }
        },
        _ = tokio::time::sleep(tokio::time::Duration::from_secs(timeout)) => {
            query_task.abort();
            log::error!("[trace_id {trace_id}] flight->search: search timeout");
            Err(DataFusionError::ResourcesExhausted("flight->search: search timeout".to_string()))
        },
        _ = async {
            #[cfg(feature = "enterprise")]
            let _ = abort_receiver.await;
            #[cfg(not(feature = "enterprise"))]
            futures::future::pending::<()>().await;
        } => {
            query_task.abort();
            log::info!("[trace_id {trace_id}] flight->search: search canceled");
            Err(DataFusionError::ResourcesExhausted("flight->search: search canceled".to_string()))
        }
    };

    // release source
    drop(_defer);

    // 9. get data from datafusion
    let (data, mut scan_stats): (Vec<RecordBatch>, ScanStats) = match task {
        Ok(Ok(data)) => Ok(data),
        Ok(Err(err)) => Err(err),
        Err(err) => Err(Error::Message(err.to_string())),
    }?;

    log::info!("[trace_id {trace_id}] flight->search: search finished");

    scan_stats.format_to_mb();
    Ok((data, scan_stats, took_wait, false, idx_took))
}

#[tracing::instrument(name = "service:search:cluster:flight:run_datafusion", skip_all)]
pub async fn run_datafusion(
    trace_id: String,
    req: Request,
    sql: Arc<Sql>,
    nodes: Vec<Node>,
    partitioned_file_lists: HashMap<String, Vec<Vec<i64>>>,
    idx_file_list: Vec<FileKey>,
) -> Result<(Vec<RecordBatch>, ScanStats)> {
    let cfg = get_config();
    let ctx = generate_context(&req, &sql, cfg.limit.cpu_num).await?;

    register_table(&ctx, &sql).await?;

    let plan = ctx.state().create_logical_plan(&sql.sql).await?;

    let mut physical_plan = ctx.state().create_physical_plan(&plan).await?;

    if cfg.common.print_key_sql {
        print_plan(&physical_plan, "before");
    }

    // 7. rewrite physical plan
    let match_all_keys = sql.match_items.clone().unwrap_or_default();
    let mut equal_keys = sql
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

    // check inverted index prefix search
    if sql.stream_type == StreamType::Index
        && cfg.common.inverted_index_search_format.to_lowercase() != "contains"
    {
        for (stream, items) in sql.prefix_items.iter() {
            equal_keys
                .entry(stream.to_string())
                .or_insert_with(Vec::new)
                .extend(items.iter().map(|(k, v)| cluster_rpc::KvItem::new(k, v)));
        }
    }

    let context = tracing::Span::current().context();
    let mut rewrite = RemoteScanRewriter::new(
        req,
        nodes.into_arc_vec(),
        partitioned_file_lists,
        idx_file_list,
        equal_keys,
        match_all_keys,
        false, // for super cluster
        context,
    );
    physical_plan = physical_plan.rewrite(&mut rewrite)?.data;

    // add remote scan exec to top if physical plan is not changed
    if !rewrite.is_changed {
        let table_name = sql.stream_names.first().unwrap();
        physical_plan = Arc::new(RemoteScanExec::new(
            physical_plan,
            rewrite.file_id_lists.get(table_name).unwrap().clone(),
            rewrite.idx_file_list.clone(),
            rewrite
                .equal_keys
                .get(table_name)
                .cloned()
                .unwrap_or_default(),
            rewrite.match_all_keys.clone(),
            false,
            rewrite.req,
            rewrite.nodes,
            rewrite.context,
        ));
    }

    if cfg.common.print_key_sql {
        print_plan(&physical_plan, "after");
    }

    // run datafusion
    let ret = datafusion::physical_plan::collect(physical_plan.clone(), ctx.task_ctx()).await;
    let mut visit = ScanStatsVisitor::new();
    let _ = visit_execution_plan(physical_plan.as_ref(), &mut visit);
    if let Err(e) = ret {
        log::error!("[trace_id {trace_id}] flight->search: datafusion collect error: {e}");
        Err(e.into())
    } else {
        log::info!("[trace_id {trace_id}] flight->search: datafusion collect done");
        ret.map(|data| (data, visit.scan_stats))
            .map_err(|e| e.into())
    }
}

pub async fn get_online_querier_nodes(
    trace_id: &str,
    node_group: Option<RoleGroup>,
) -> Result<Vec<Node>> {
    // get nodes from cluster
    let mut nodes = match infra_cluster::get_cached_online_query_nodes(node_group).await {
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
    let nodes = nodes;

    let querier_num = nodes.iter().filter(|node| node.is_querier()).count();
    if querier_num == 0 {
        log::error!("no querier node online");
        return Err(Error::Message("no querier node online".to_string()));
    }
    Ok(nodes)
}

#[cfg(not(feature = "enterprise"))]
#[tracing::instrument(name = "service:search:cluster:flight:check_work_group", skip_all)]
pub async fn check_work_group(
    req: &Request,
    trace_id: &str,
    nodes: &[Node],
    start: std::time::Instant,
    file_list_took: usize, // the time took to get file list
) -> Result<(usize, String, Option<infra::dist_lock::Locker>)> {
    let cfg = get_config();
    let work_group_str = "global".to_string();

    let locker_key = format!("/search/cluster_queue/{}", work_group_str);
    let locker = if cfg.common.local_mode || !cfg.common.feature_query_queue_enabled {
        None
    } else {
        let node_ids = nodes
            .iter()
            .map(|node| node.uuid.to_string())
            .collect::<HashSet<_>>();
        dist_lock::lock_with_trace_id(trace_id, &locker_key, req.timeout as u64, Some(node_ids))
            .await
            .map_err(|e| {
                metrics::QUERY_PENDING_NUMS
                    .with_label_values(&[&req.org_id])
                    .dec();
                Error::Message(e.to_string())
            })?
    };

    // done in the queue
    let took_wait = start.elapsed().as_millis() as usize - file_list_took;
    log::info!(
        "[trace_id {trace_id}] search: wait in queue took: {} ms",
        took_wait,
    );
    Ok((took_wait, work_group_str, locker))
}

#[cfg(feature = "enterprise")]
#[tracing::instrument(name = "service:search:cluster:flight:check_work_group", skip_all)]
pub async fn check_work_group(
    req: &Request,
    trace_id: &str,
    nodes: &[Node],
    file_id_list_vec: &[&FileId],
    start: std::time::Instant,
    file_list_took: usize, // the time took to get file list
) -> Result<(
    usize,
    String,
    Option<o2_enterprise::enterprise::search::WorkGroup>,
)> {
    let cfg = get_config();
    let user_id = req.user_id.clone();
    let user_id = user_id.as_deref();

    // 1. get work group
    let work_group: Option<o2_enterprise::enterprise::search::WorkGroup> = Some(
        o2_enterprise::enterprise::search::work_group::predict(nodes, file_id_list_vec),
    );

    super::super::SEARCH_SERVER
        .add_work_group(trace_id, work_group.clone())
        .await;

    let work_group_str = work_group.as_ref().unwrap().to_string();

    let locker_key = format!("/search/cluster_queue/{}", work_group_str);
    // 2. get a cluster search queue lock
    let locker = if cfg.common.local_mode || !cfg.common.feature_query_queue_enabled {
        None
    } else {
        let node_ids = nodes
            .iter()
            .map(|node| node.uuid.to_string())
            .collect::<HashSet<_>>();
        dist_lock::lock_with_trace_id(trace_id, &locker_key, req.timeout as u64, Some(node_ids))
            .await
            .map_err(|e| {
                metrics::QUERY_PENDING_NUMS
                    .with_label_values(&[&req.org_id])
                    .dec();
                Error::Message(e.to_string())
            })?
    };

    // 3. check global concurrency
    super::work_group_checking(trace_id, start, req, &work_group, &locker, None).await?;

    // 4. check user concurrency
    if user_id.is_some() {
        super::work_group_checking(trace_id, start, req, &work_group, &locker, user_id).await?;
    }

    // 5. process the search in the work group
    if let Err(e) = work_group
        .as_ref()
        .unwrap()
        .process(trace_id, user_id)
        .await
    {
        metrics::QUERY_PENDING_NUMS
            .with_label_values(&[&req.org_id])
            .dec();
        dist_lock::unlock_with_trace_id(trace_id, &locker).await?;
        return Err(Error::Message(e.to_string()));
    }

    // 6. unlock the queue in no enterprise version,
    if let Err(e) = dist_lock::unlock_with_trace_id(trace_id, &locker).await {
        metrics::QUERY_PENDING_NUMS
            .with_label_values(&[&req.org_id])
            .dec();
        work_group
            .as_ref()
            .unwrap()
            .done(trace_id, user_id)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        return Err(e);
    }

    // done in the queue
    let took_wait = start.elapsed().as_millis() as usize - file_list_took;
    log::info!(
        "[trace_id {trace_id}] search: wait in queue took: {} ms",
        took_wait,
    );
    Ok((took_wait, work_group_str, work_group))
}

#[tracing::instrument(name = "service:search:cluster:flight:partition_file_lists", skip_all)]
pub async fn partition_file_lists(
    file_id_lists: HashMap<String, Vec<FileId>>,
    nodes: &[Node],
    group: Option<RoleGroup>,
) -> Result<HashMap<String, Vec<Vec<i64>>>> {
    let mut file_partitions = HashMap::with_capacity(file_id_lists.len());
    for (stream_name, file_id_list) in file_id_lists {
        let partitions = partition_filt_list(file_id_list, nodes, group).await?;
        file_partitions.insert(stream_name, partitions);
    }
    Ok(file_partitions)
}

pub async fn partition_filt_list(
    file_id_list: Vec<FileId>,
    nodes: &[Node],
    group: Option<RoleGroup>,
) -> Result<Vec<Vec<i64>>> {
    let cfg = get_config();
    let querier_num = nodes.iter().filter(|node| node.is_querier()).count();
    let mut partition_strategy =
        QueryPartitionStrategy::from(&cfg.common.feature_query_partition_strategy);
    if cfg.memory_cache.cache_latest_files {
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
            infra_cluster::get_node_from_consistent_hash(&fk.id.to_string(), &Role::Querier, group)
                .await
                .expect("there is no querier node in consistent hash ring");
        let idx = match node_idx.get(&node_name) {
            Some(idx) => *idx,
            None => {
                log::error!(
                    "partition_file_by_hash: {} not found in node_idx",
                    node_name
                );
                0
            }
        };
        partitions[idx].push(fk.id);
    }
    partitions
}

pub async fn generate_context(
    req: &Request,
    sql: &Arc<Sql>,
    target_partitions: usize,
) -> Result<SessionContext> {
    let optimizer_rules = generate_optimizer_rules(sql);
    let mut ctx = prepare_datafusion_context(
        req.work_group.clone(),
        optimizer_rules,
        sql.sorted_by_time,
        target_partitions,
    )
    .await?;

    // register udf
    register_udf(&ctx, &req.org_id)?;
    datafusion_functions_json::register_all(&mut ctx)?;

    Ok(ctx)
}

pub async fn register_table(ctx: &SessionContext, sql: &Sql) -> Result<()> {
    for (stream_name, schema) in &sql.schemas {
        let schema = schema
            .schema()
            .as_ref()
            .clone()
            .with_metadata(std::collections::HashMap::new());
        let table = Arc::new(
            NewEmptyTable::new(stream_name, Arc::new(schema))
                .with_partitions(ctx.state().config().target_partitions())
                .with_sorted_by_time(sql.sorted_by_time),
        );
        ctx.register_table(stream_name, table)?;
    }
    Ok(())
}

#[tracing::instrument(name = "service:search:cluster:flight:get_file_id_lists", skip_all)]
pub async fn get_file_id_lists(
    org_id: &str,
    stream_type: StreamType,
    stream_names: &[String],
    time_range: Option<(i64, i64)>,
) -> Result<HashMap<String, Vec<FileId>>> {
    let mut file_lists = HashMap::with_capacity(stream_names.len());
    for name in stream_names {
        // get file list
        let file_id_list =
            crate::service::file_list::query_ids(org_id, stream_type, name, time_range).await?;
        file_lists.insert(name.clone(), file_id_list);
    }
    Ok(file_lists)
}

#[tracing::instrument(
    name = "service:search:cluster:flight:get_inverted_index_file_list",
    skip_all
)]
async fn get_inverted_index_file_lists(
    trace_id: &str,
    req: &Request,
    sql: &Arc<Sql>,
    query: &SearchQuery,
) -> Result<(bool, Vec<FileKey>, usize, usize)> {
    let cfg = get_config();
    let inverted_index_type = if req.inverted_index_type.is_none()
        || req.inverted_index_type.as_ref().unwrap().is_empty()
    {
        cfg.common.inverted_index_search_format.clone()
    } else {
        req.inverted_index_type.as_ref().unwrap().to_string()
    };
    let (use_inverted_index, index_terms) = super::super::is_use_inverted_index(sql);
    let use_parquet_inverted_index =
        use_inverted_index && (inverted_index_type == "parquet" || inverted_index_type == "both");
    let use_fst_inverted_index =
        use_inverted_index && (inverted_index_type == "fst" || inverted_index_type == "both");
    log::info!(
        "[trace_id {trace_id}] flight->search: use_inverted_index with parquet format {}",
        use_parquet_inverted_index
    );

    if !use_parquet_inverted_index {
        return Ok((use_fst_inverted_index, vec![], 0, 0));
    }

    let stream_name = sql.stream_names.first().unwrap();
    let match_terms = sql.match_items.clone().unwrap_or_default();
    let index_terms = generate_filter_from_equal_items(&index_terms);
    let (idx_file_list, idx_scan_size, idx_took) = get_inverted_index_file_list(
        req.clone(),
        query.clone(),
        stream_name,
        &match_terms,
        &index_terms,
    )
    .await?;
    log::info!(
        "[trace_id {trace_id}] flight->search: get file_list from inverted index time_range: {:?}, num: {}, scan_size: {}, took: {} ms",
        sql.time_range,
        idx_file_list.len(),
        idx_scan_size,
        idx_took,
    );

    Ok((
        use_fst_inverted_index,
        idx_file_list,
        idx_scan_size,
        idx_took,
    ))
}

pub async fn get_inverted_index_file_list(
    mut req: Request,
    mut query: SearchQuery,
    stream_name: &str,
    match_terms: &[String],
    index_terms: &[(String, Vec<String>)],
) -> Result<(Vec<FileKey>, usize, usize)> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let org_id = req.org_id.clone();
    let stream_type = req.stream_type;

    // Get all the unique terms which the user has searched.
    let terms = match_terms
        .iter()
        .filter_map(|t| {
            let tokens = split_token(t, &cfg.common.inverted_index_split_chars);
            if tokens.is_empty() {
                None
            } else {
                Some(
                    tokens
                        .into_iter()
                        .max_by_key(|key| key.len())
                        .unwrap_or_default(),
                )
            }
        })
        .collect::<HashSet<String>>();

    let fts_condition = terms
        .iter()
        .map(|x| match cfg.common.full_text_search_type.as_str() {
            "eq" => format!("term = '{x}'"),
            "contains" => format!("term LIKE '%{x}%'"),
            _ => format!("term LIKE '{x}%'"),
        })
        .collect::<Vec<_>>()
        .join(" OR ");
    let fts_condition = if fts_condition.is_empty() {
        fts_condition
    } else if cfg.common.inverted_index_old_format && stream_type == StreamType::Logs {
        format!(
            "((field = '{}' OR field IS NULL) AND ({}))",
            INDEX_FIELD_NAME_FOR_ALL, fts_condition
        )
    } else {
        format!(
            "(field = '{}' AND ({}))",
            INDEX_FIELD_NAME_FOR_ALL, fts_condition
        )
    };

    // Process index terms
    let index_terms = index_terms
        .iter()
        .map(|(field, values)| {
            if values.len() > 1 {
                format!("(field = '{field}' AND term IN ('{}'))", values.join("','"))
            } else {
                format!(
                    "(field = '{field}' AND term = '{}')",
                    values.first().unwrap()
                )
            }
        })
        .collect::<Vec<_>>();
    let index_condition = index_terms.join(" OR ");
    // If both empty return original file list with other params as 0
    let search_condition = match (index_condition.is_empty(), fts_condition.is_empty()) {
        (true, true) => {
            return Ok((vec![], 0, 0));
        }
        (true, false) => fts_condition,
        (false, true) => index_condition,
        _ => {
            format!("{} OR {}", fts_condition, index_condition)
        }
    };

    let index_stream_name =
        if get_config().common.inverted_index_old_format && stream_type == StreamType::Logs {
            stream_name.to_string()
        } else {
            format!("{}_{}", stream_name, stream_type)
        };
    let sql = format!(
        "SELECT file_name, segment_ids FROM \"{}\" WHERE {}",
        index_stream_name, search_condition
    );

    req.stream_type = StreamType::Index;
    query.sql = sql;
    query.from = 0;
    query.size = QUERY_WITH_NO_LIMIT;
    query.track_total_hits = false;
    query.uses_zo_fn = false;
    query.query_fn = "".to_string();
    let resp = super::http::search(req, query, vec![], vec![]).await?;

    // Merge bitmap segment_ids of the same file
    let mut idx_file_list: HashMap<String, FileKey> = HashMap::default();
    for item in resp.hits.iter() {
        let filename = match item.get("file_name") {
            None => continue,
            Some(v) => v.as_str().unwrap(),
        };
        let prefixed_filename = format!(
            "files/{}/{}/{}/{}",
            &org_id, stream_type, stream_name, filename
        );
        let segment_ids = match item.get("segment_ids") {
            None => None,
            Some(v) => hex::decode(v.as_str().unwrap()).ok(),
        };
        let entry = idx_file_list
            .entry(prefixed_filename.clone())
            .or_insert(FileKey {
                key: prefixed_filename,
                ..Default::default()
            });
        match (&entry.segment_ids, &segment_ids) {
            (Some(_), None) => {}
            (Some(bin_data), Some(segment_ids)) => {
                let mut bv = BitVec::from_slice(bin_data);
                bv |= BitVec::from_slice(segment_ids);
                entry.segment_ids = Some(bv.into_vec());
            }
            (None, _) => {
                entry.segment_ids = segment_ids;
            }
        }
    }
    let mut idx_file_list = idx_file_list
        .into_iter()
        .map(|(_, f)| f)
        .collect::<Vec<_>>();
    // sorted by _timestamp
    idx_file_list.sort_by(|a, b| a.meta.min_ts.cmp(&b.meta.min_ts));
    Ok((
        idx_file_list,
        resp.scan_size,
        start.elapsed().as_millis() as usize,
    ))
}

fn print_plan(physical_plan: &Arc<dyn ExecutionPlan>, stage: &str) {
    let plan = displayable(physical_plan.as_ref())
        .indent(false)
        .to_string();
    println!("+---------------------------+----------+");
    println!("leader physical plan {stage} rewrite");
    println!("+---------------------------+----------+");
    println!("{}", plan);
}
