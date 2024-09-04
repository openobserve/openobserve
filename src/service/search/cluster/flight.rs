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
        stream::{
            FileKey, PartitionTimeLevel, QueryPartitionStrategy, StreamPartition, StreamType,
        },
    },
    metrics,
    utils::inverted_index::split_token,
    INDEX_FIELD_NAME_FOR_ALL, QUERY_WITH_NO_LIMIT,
};
use datafusion::{
    common::tree_node::TreeNode,
    physical_plan::{displayable, visit_execution_plan, ExecutionPlan},
    prelude::SessionContext,
};
use hashbrown::{HashMap, HashSet};
use infra::{
    dist_lock,
    errors::{Error, Result},
    schema::{
        get_stream_setting_index_fields, unwrap_partition_time_level, unwrap_stream_settings,
        SchemaCache,
    },
};
use proto::cluster_rpc::{self, SearchQuery};
use tracing::{info_span, Instrument};

use crate::{
    common::infra::cluster as infra_cluster,
    service::search::{
        datafusion::{
            distributed_plan::{remote_scan::RemoteScanExec, rewrite::RemoteScanRewriter},
            exec::{prepare_datafusion_context, register_udf},
            optimizer::generate_optimizer_rules,
            table_provider::empty_table::NewEmptyTable,
        },
        generate_filter_from_equal_items, match_file,
        new_sql::NewSql,
        request::Request,
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
    sql: Arc<NewSql>,
    mut req: Request,
    query: SearchQuery,
) -> Result<(Vec<RecordBatch>, ScanStats, usize, bool, usize)> {
    let start = std::time::Instant::now();
    let cfg = get_config();
    log::info!("[trace_id {trace_id}] flight->leader: start {}", sql);

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

    // 1. get file list
    let mut file_list = get_file_lists(
        &sql.stream_names,
        &sql.schemas,
        &sql.org_id,
        sql.stream_type,
        sql.time_range,
        &sql.equal_items,
    )
    .await?;

    let file_list_vec = file_list.values().flatten().collect::<Vec<_>>();
    let file_list_took = start.elapsed().as_millis() as usize;
    log::info!(
        "[trace_id {trace_id}] flight->leader: get file_list time_range: {:?}, num: {}, took: {} ms",
        sql.time_range,
        file_list_vec.len(),
        file_list_took,
    );

    // 2. filter file list using inverted index
    let (_use_inverted_index, _scan_stats, idx_took) =
        get_file_list_from_inverted_index(trace_id, &req, &sql, &query, &mut file_list).await?;

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
    #[cfg(not(feature = "enterprise"))]
    let (took_wait, work_group_str, locker) =
        check_work_group(&req, trace_id, &nodes, start, file_list_took).await?;
    #[cfg(feature = "enterprise")]
    let file_list_vec = file_list.values().flatten().collect::<Vec<_>>();
    #[cfg(feature = "enterprise")]
    let (took_wait, work_group_str, work_group) = check_work_group(
        &req,
        trace_id,
        &nodes,
        &file_list_vec,
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

    // TODO: split it to two function for enterprise and non enterprise
    // release lock when search done or get error
    #[cfg(feature = "enterprise")]
    let user_id = req.user_id.clone();
    let trace_id_move = trace_id.to_string();
    let _defer = AsyncDefer::new({
        async move {
            // search done, release lock
            #[cfg(not(feature = "enterprise"))]
            let _ = dist_lock::unlock(&locker).await.map_err(|e| {
                log::error!(
                    "[trace_id {trace_id_move}] release work group in flight search error: {e}",
                );
                Error::Message(e.to_string())
            });
            #[cfg(feature = "enterprise")]
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
            #[cfg(not(feature = "enterprise"))]
            log::info!("[trace_id {trace_id_move}] release lock in flight search",);
            #[cfg(feature = "enterprise")]
            log::info!("[trace_id {trace_id_move}] release work group in flight search",);
        }
    });

    // 5. partition file list
    let partition_file_lists = partition_file_lists(file_list, &nodes, node_group).await?;

    #[cfg(feature = "enterprise")]
    super::super::SEARCH_SERVER
        .add_file_stats(
            trace_id,
            _scan_stats.files,
            _scan_stats.records,
            _scan_stats.original_size,
            _scan_stats.compressed_size,
        )
        .await;

    // 6. construct physical plan
    let ctx = generate_context(&req, &sql, cfg.limit.cpu_num).await?;

    register_table(&ctx, &sql).await?;

    let plan = ctx.state().create_logical_plan(&sql.sql).await?;

    let mut physical_plan = ctx.state().create_physical_plan(&plan).await?;

    if cfg.common.print_key_sql {
        print_plan(&physical_plan, "before");
    }

    // 7. rewrite physical plan
    let match_all_keys = sql.match_items.clone().unwrap_or_default();
    let equal_keys = sql
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
    let mut rewrite = RemoteScanRewriter::new(
        req,
        nodes.into_arc_vec(),
        partition_file_lists,
        equal_keys,
        match_all_keys,
        false, // for super cluster
    );
    physical_plan = physical_plan.rewrite(&mut rewrite)?.data;

    // add remote scan exec to top if physical plan is not changed
    if !rewrite.is_changed {
        let table_name = sql.stream_names.first().unwrap();
        physical_plan = Arc::new(RemoteScanExec::new(
            physical_plan,
            rewrite.file_lists.get(table_name).unwrap().clone(),
            rewrite
                .equal_keys
                .get(table_name)
                .cloned()
                .unwrap_or_default(),
            rewrite.match_all_keys.clone(),
            false,
            rewrite.req,
            rewrite.nodes,
        ));
    }

    if cfg.common.print_key_sql {
        print_plan(&physical_plan, "after");
    }

    #[cfg(feature = "enterprise")]
    let (abort_sender, abort_receiver) = tokio::sync::oneshot::channel();
    #[cfg(feature = "enterprise")]
    if super::super::SEARCH_SERVER
        .insert_sender(trace_id, abort_sender)
        .await
        .is_err()
    {
        log::info!(
            "[trace_id {trace_id}] flight->leader: search canceled before call flight->search"
        );
        return Err(Error::ErrorCode(
            infra::errors::ErrorCodes::SearchCancelQuery(format!(
                "[trace_id {trace_id}] flight->leader: search canceled before call flight->search"
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
        let ret = datafusion::physical_plan::collect(physical_plan.clone(), ctx.task_ctx())
            .instrument(datafusion_span)
            .await;
        let mut visit = ScanStatsVisitor::new();
        let _ = visit_execution_plan(physical_plan.as_ref(), &mut visit);
        log::info!("[trace_id {trace_id_move}] flight->leader: datafusion collect done");
        ret.map(|data| (data, visit.scan_stats))
    });
    tokio::pin!(query_task);

    // 8. execute physical plan
    let task = tokio::select! {
        ret = &mut query_task => {
            match ret {
                Ok(ret) => Ok(ret),
                Err(err) => {
                    log::error!("[trace_id {trace_id}] flight->leader: datafusion execute error: {}", err);
                    Err(datafusion::error::DataFusionError::Execution(err.to_string()))
                }
            }
        },
        _ = tokio::time::sleep(tokio::time::Duration::from_secs(timeout)) => {
            query_task.abort();
            log::error!("[trace_id {trace_id}] flight->leader: search timeout");
            Err(datafusion::error::DataFusionError::ResourcesExhausted("flight->leader: search timeout".to_string()))
        },
        _ = async {
            #[cfg(feature = "enterprise")]
            let _ = abort_receiver.await;
            #[cfg(not(feature = "enterprise"))]
            futures::future::pending::<()>().await;
        } => {
            query_task.abort();
            log::info!("[trace_id {trace_id}] flight->leader: search canceled");
            Err(datafusion::error::DataFusionError::ResourcesExhausted("flight->leader: search canceled".to_string()))
        }
    };

    // 9. get data from datafusion
    let (data, mut scan_stats): (Vec<RecordBatch>, ScanStats) = match task {
        Ok(Ok(data)) => Ok(data),
        Ok(Err(err)) => Err(err.into()),
        Err(err) => Err(Error::Message(err.to_string())),
    }?;

    log::info!("[trace_id {trace_id}] flight->leader: search finished");

    scan_stats.format_to_mb();
    Ok((data, scan_stats, took_wait, false, idx_took))
}

pub async fn get_online_querier_nodes(
    trace_id: &str,
    node_group: Option<RoleGroup>,
) -> Result<Vec<Node>> {
    // get nodes from cluster
    let mut nodes = match infra_cluster::get_cached_online_query_nodes(node_group).await {
        Some(nodes) => nodes,
        None => {
            log::error!("[trace_id {trace_id}] flight->leader: no querier node online");
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

pub async fn get_file_lists(
    stream_names: &[String],
    schemas: &HashMap<String, Arc<SchemaCache>>,
    org_id: &str,
    stream_type: StreamType,
    time_range: Option<(i64, i64)>,
    equal_items: &HashMap<String, Vec<(String, String)>>,
) -> Result<HashMap<String, Vec<FileKey>>> {
    let mut file_lists = HashMap::with_capacity(stream_names.len());
    for name in stream_names {
        // stream settings
        let stream_settings =
            unwrap_stream_settings(schemas.get(name).unwrap().schema()).unwrap_or_default();
        let partition_time_level =
            unwrap_partition_time_level(stream_settings.partition_time_level, stream_type);

        let empty_filters = vec![];
        // get file list
        let file_list = get_file_list(
            name,
            org_id,
            stream_type,
            time_range,
            equal_items.get(name).unwrap_or(&empty_filters),
            partition_time_level,
            &stream_settings.partition_keys,
        )
        .await;
        file_lists.insert(name.clone(), file_list);
    }
    Ok(file_lists)
}

#[tracing::instrument(name = "service:search:cluster:flight:get_file_list", skip_all, fields(org_id = org_id, stream_name = stream_name))]
pub(crate) async fn get_file_list(
    stream_name: &str,
    org_id: &str,
    stream_type: StreamType,
    time_range: Option<(i64, i64)>,
    equal_items: &[(String, String)],
    time_level: PartitionTimeLevel,
    partition_keys: &[StreamPartition],
) -> Vec<FileKey> {
    let is_local = get_config().common.meta_store_external
        || infra_cluster::get_cached_online_querier_nodes(Some(RoleGroup::Interactive))
            .await
            .unwrap_or_default()
            .len()
            <= 1;
    let (time_min, time_max) = time_range.unwrap();
    let file_list = crate::service::file_list::query(
        org_id,
        stream_name,
        stream_type,
        time_level,
        time_min,
        time_max,
        is_local,
    )
    .await
    .unwrap_or_default();

    let mut files = Vec::with_capacity(file_list.len());
    for file in file_list {
        if match_file(
            stream_name,
            org_id,
            time_range,
            &file,
            false,
            false,
            stream_type,
            partition_keys,
            equal_items,
        )
        .await
        {
            files.push(file.to_owned());
        }
    }
    files.sort_by(|a, b| a.key.cmp(&b.key));
    files.dedup_by(|a, b| a.key == b.key);
    files
}

pub async fn get_file_list_from_inverted_index(
    trace_id: &str,
    req: &Request,
    sql: &Arc<NewSql>,
    query: &SearchQuery,
    file_list: &mut HashMap<String, Vec<FileKey>>,
) -> Result<(bool, ScanStats, usize)> {
    let cfg = get_config();
    let inverted_index_type = if req.inverted_index_type.is_none()
        || req.inverted_index_type.as_ref().unwrap().is_empty()
    {
        cfg.common.inverted_index_search_format.clone()
    } else {
        req.inverted_index_type.as_ref().unwrap().to_string()
    };
    let (use_inverted_index, index_terms) = is_use_inverted_index(sql);
    let use_inverted_index =
        use_inverted_index && (inverted_index_type == "parquet" || inverted_index_type == "both");
    log::info!(
        "[trace_id {trace_id}] flight->leader: use_inverted_index {} with parquet format",
        use_inverted_index
    );

    // use inverted index to filter file list
    // If the query is of type inverted index and this is not an aggregations request,
    // then filter the file list based on the inverted index.
    let mut idx_scan_size = 0;
    let mut idx_took = 0;
    let mut file_list_vec = file_list.values().flatten().collect::<Vec<_>>();
    if use_inverted_index {
        let stream_file_list;
        let stream_name = sql.stream_names.first().unwrap();
        let match_terms = sql.match_items.clone().unwrap_or_default();
        let index_terms = generate_filter_from_equal_items(&index_terms);
        (stream_file_list, idx_scan_size, idx_took) = get_file_list_by_inverted_index(
            req.clone(),
            query.clone(),
            stream_name,
            &file_list_vec,
            &match_terms,
            &index_terms,
        )
        .await?;
        log::info!(
            "[trace_id {trace_id}] flight->leader: get file_list from inverted index time_range: {:?}, num: {}, scan_size: {}, took: {} ms",
            sql.time_range,
            stream_file_list.len(),
            idx_scan_size,
            idx_took,
        );
        file_list.insert(stream_name.to_string(), stream_file_list);
        file_list_vec = file_list.values().flatten().collect::<Vec<_>>();
    }

    // calculate records, original_size, compressed_size
    let mut scan_stats = ScanStats::new();
    scan_stats.files = file_list_vec.len() as i64;
    for file in file_list_vec.iter() {
        let file_meta = &file.meta;
        scan_stats.records += file_meta.records;
        scan_stats.original_size += file_meta.original_size;
        scan_stats.compressed_size += file_meta.compressed_size;
    }
    scan_stats.original_size += idx_scan_size as i64;
    scan_stats.idx_scan_size = idx_scan_size as i64;

    Ok((use_inverted_index, scan_stats, idx_took))
}

#[cfg(not(feature = "enterprise"))]
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
        dist_lock::lock(&locker_key, req.timeout as u64, Some(node_ids))
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
pub async fn check_work_group(
    req: &Request,
    trace_id: &str,
    nodes: &[Node],
    file_list_vec: &[&FileKey],
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
        o2_enterprise::enterprise::search::work_group::predict(nodes, file_list_vec),
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
        dist_lock::lock(&locker_key, req.timeout as u64, Some(node_ids))
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
        dist_lock::unlock(&locker).await?;
        return Err(Error::Message(e.to_string()));
    }

    // 6. unlock the queue in no enterprise version,
    if let Err(e) = dist_lock::unlock(&locker).await {
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

pub async fn partition_file_lists(
    file_lists: HashMap<String, Vec<FileKey>>,
    nodes: &[Node],
    group: Option<RoleGroup>,
) -> Result<HashMap<String, Vec<Vec<FileKey>>>> {
    let mut file_partitions = HashMap::with_capacity(file_lists.len());
    for (stream_name, file_list) in file_lists {
        let partitions = partition_filt_list(file_list, nodes, group).await?;
        file_partitions.insert(stream_name, partitions);
    }
    Ok(file_partitions)
}

pub async fn partition_filt_list(
    file_list: Vec<FileKey>,
    nodes: &[Node],
    group: Option<RoleGroup>,
) -> Result<Vec<Vec<FileKey>>> {
    let cfg = get_config();
    let querier_num = nodes.iter().filter(|node| node.is_querier()).count();
    let mut partition_strategy =
        QueryPartitionStrategy::from(&cfg.common.feature_query_partition_strategy);
    if cfg.memory_cache.cache_latest_files {
        partition_strategy = QueryPartitionStrategy::FileHash;
    }
    let partitions = match partition_strategy {
        QueryPartitionStrategy::FileNum => partition_file_by_nums(file_list, querier_num),
        QueryPartitionStrategy::FileSize => partition_file_by_bytes(file_list, querier_num),
        QueryPartitionStrategy::FileHash => partition_file_by_hash(file_list, nodes, group).await,
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
    file_keys: Vec<FileKey>,
    querier_num: usize,
) -> Vec<Vec<FileKey>> {
    let file_distribute = distribute(file_keys.len(), querier_num);

    let mut partitions = vec![Vec::new(); querier_num];

    for (i, num) in file_distribute.iter().enumerate() {
        if *num == 0 {
            break;
        }
        let start = file_distribute.iter().take(i).sum::<usize>();
        let end = start + num;
        partitions[i] = file_keys[start..end].to_vec();
    }

    partitions
}

pub fn distribute(total: usize, n: usize) -> Vec<usize> {
    let base_value = total / n;
    let remainder = total % n;
    let mut buckets = vec![base_value; n];
    for item in buckets.iter_mut().take(remainder) {
        *item += 1;
    }
    buckets
}

pub(crate) fn partition_file_by_bytes(
    file_keys: Vec<FileKey>,
    querier_num: usize,
) -> Vec<Vec<FileKey>> {
    let mut partitions = vec![Vec::new(); querier_num];
    let sum_original_size = file_keys
        .iter()
        .map(|fk| fk.meta.original_size)
        .sum::<i64>();
    let avg_size = sum_original_size / querier_num as i64;
    let mut node_size = 0;
    let mut node_k = 0;
    for fk in file_keys {
        node_size += fk.meta.original_size;
        if node_size >= avg_size && node_k != querier_num - 1 && !partitions[node_k].is_empty() {
            node_size = fk.meta.original_size;
            node_k += 1;
            partitions[node_k].push(fk);
            continue;
        }
        partitions[node_k].push(fk);
    }
    partitions
}

pub(crate) async fn partition_file_by_hash(
    file_keys: Vec<FileKey>,
    nodes: &[Node],
    group: Option<RoleGroup>,
) -> Vec<Vec<FileKey>> {
    let mut node_idx = HashMap::with_capacity(nodes.len());
    let mut idx = 0;
    for node in nodes {
        if !node.is_querier() {
            continue;
        }
        node_idx.insert(&node.uuid, idx);
        idx += 1;
    }
    let mut partitions = vec![Vec::new(); idx];
    for fk in file_keys {
        let node_uuid =
            infra_cluster::get_node_from_consistent_hash(&fk.key, &Role::Querier, group)
                .await
                .expect("there is no querier node in consistent hash ring");
        let idx = node_idx.get(&node_uuid).unwrap_or(&0);
        partitions[*idx].push(fk);
    }
    partitions
}

pub async fn generate_context(
    req: &Request,
    sql: &Arc<NewSql>,
    target_partitions: usize,
) -> Result<SessionContext> {
    let optimizer_rules = generate_optimizer_rules(sql);
    let ctx = prepare_datafusion_context(
        req.work_group.clone(),
        optimizer_rules,
        sql.sorted_by_time,
        target_partitions,
    )
    .await?;

    // register udf
    register_udf(&ctx, &req.org_id)?;

    Ok(ctx)
}

pub async fn register_table(ctx: &SessionContext, sql: &NewSql) -> Result<()> {
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

pub fn filter_index_fields(
    items: &[(String, String)],
    index_fields: &[String],
) -> Vec<(String, String)> {
    let mut result = Vec::new();
    for item in items {
        if index_fields.contains(&item.0) {
            result.push(item.clone());
        }
    }
    result
}

pub async fn get_file_list_by_inverted_index(
    mut req: Request,
    mut query: SearchQuery,
    stream_name: &str,
    file_list: &[&FileKey],
    match_terms: &[String],
    index_terms: &[(String, Vec<String>)],
) -> Result<(Vec<FileKey>, usize, usize)> {
    let start = std::time::Instant::now();
    let cfg = get_config();

    let org_id = req.org_id.clone();
    let stream_type = req.stream_type;
    let file_list_map = file_list
        .iter()
        .map(|f| (&f.key, &f.meta))
        .collect::<HashMap<_, _>>();

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
        .map(|x| format!("term LIKE '%{x}%'"))
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
            return Ok((
                file_list.iter().map(|v| (*v).clone()).collect::<Vec<_>>(),
                0,
                0,
            ));
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
        "SELECT file_name, deleted, segment_ids FROM \"{}\" WHERE {}",
        index_stream_name, search_condition,
    );

    req.stream_type = StreamType::Index;
    query.sql = sql;
    query.from = 0;
    query.size = QUERY_WITH_NO_LIMIT;
    query.track_total_hits = false;
    query.uses_zo_fn = false;
    query.query_fn = "".to_string();

    let resp = super::http::search(req, query, vec![], vec![]).await?;
    // get deleted file
    let deleted_files = resp
        .hits
        .iter()
        .filter_map(|hit| {
            if hit.get("deleted").unwrap().as_bool().unwrap() {
                Some(hit.get("file_name").unwrap().as_str().unwrap().to_string())
            } else {
                None
            }
        })
        .collect::<HashSet<_>>();

    // Merge bitmap segment_ids of the same file
    let mut idx_file_list: HashMap<String, FileKey> = HashMap::default();
    for item in resp.hits.iter() {
        let filename = match item.get("file_name") {
            None => continue,
            Some(v) => v.as_str().unwrap(),
        };
        if deleted_files.contains(filename) {
            continue;
        }
        let prefixed_filename = format!(
            "files/{}/{}/{}/{}",
            &org_id, stream_type, stream_name, filename
        );
        let Some(file_meta) = file_list_map.get(&prefixed_filename) else {
            continue;
        };
        let segment_ids = match item.get("segment_ids") {
            None => None,
            Some(v) => hex::decode(v.as_str().unwrap()).ok(),
        };
        let entry = idx_file_list
            .entry(prefixed_filename.clone())
            .or_insert(FileKey {
                key: prefixed_filename,
                meta: (*file_meta).clone(),
                deleted: false,
                segment_ids: None,
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
        .set_show_schema(false)
        .indent(true)
        .to_string();
    println!("+---------------------------+----------+");
    println!("leader physical plan {stage} rewrite");
    println!("+---------------------------+----------+");
    println!("{}", plan);
}

pub fn is_use_inverted_index(sql: &Arc<NewSql>) -> (bool, Vec<(String, String)>) {
    let cfg = get_config();
    let index_terms = if sql.equal_items.len() == 1 {
        let schema = sql.schemas.values().next().unwrap().schema();
        let stream_settings = infra::schema::unwrap_stream_settings(schema);
        let index_fields = get_stream_setting_index_fields(&stream_settings);
        filter_index_fields(sql.equal_items.values().next().unwrap(), &index_fields)
    } else {
        vec![]
    };

    let use_inverted_index = sql.stream_type != StreamType::Index
        && sql.use_inverted_index
        && cfg.common.inverted_index_enabled
        && !cfg.common.feature_query_without_index
        && (sql.match_items.is_some() || !index_terms.is_empty());

    (use_inverted_index, index_terms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_partition_file_by_bytes() {
        use config::meta::stream::FileMeta;

        let vec = vec![
            FileKey::new(
                "",
                FileMeta {
                    min_ts: -1,
                    max_ts: -1,
                    records: -1,
                    original_size: 256,
                    compressed_size: -1,
                    flattened: false,
                },
                false,
            ),
            FileKey::new(
                "",
                FileMeta {
                    min_ts: -1,
                    max_ts: -1,
                    records: -1,
                    original_size: 256,
                    compressed_size: -1,
                    flattened: false,
                },
                false,
            ),
            FileKey::new(
                "",
                FileMeta {
                    min_ts: -1,
                    max_ts: -1,
                    records: -1,
                    original_size: 100,
                    compressed_size: -1,
                    flattened: false,
                },
                false,
            ),
            FileKey::new(
                "",
                FileMeta {
                    min_ts: -1,
                    max_ts: -1,
                    records: -1,
                    original_size: 256,
                    compressed_size: -1,
                    flattened: false,
                },
                false,
            ),
            FileKey::new(
                "",
                FileMeta {
                    min_ts: -1,
                    max_ts: -1,
                    records: -1,
                    original_size: 1,
                    compressed_size: -1,
                    flattened: false,
                },
                false,
            ),
            FileKey::new(
                "",
                FileMeta {
                    min_ts: -1,
                    max_ts: -1,
                    records: -1,
                    original_size: 256,
                    compressed_size: -1,
                    flattened: false,
                },
                false,
            ),
            FileKey::new(
                "",
                FileMeta {
                    min_ts: -1,
                    max_ts: -1,
                    records: -1,
                    original_size: 200,
                    compressed_size: -1,
                    flattened: false,
                },
                false,
            ),
            FileKey::new(
                "",
                FileMeta {
                    min_ts: -1,
                    max_ts: -1,
                    records: -1,
                    original_size: 30,
                    compressed_size: -1,
                    flattened: false,
                },
                false,
            ),
            FileKey::new(
                "",
                FileMeta {
                    min_ts: -1,
                    max_ts: -1,
                    records: -1,
                    original_size: 90,
                    compressed_size: -1,
                    flattened: false,
                },
                false,
            ),
            FileKey::new(
                "",
                FileMeta {
                    min_ts: -1,
                    max_ts: -1,
                    records: -1,
                    original_size: 256,
                    compressed_size: -1,
                    flattened: false,
                },
                false,
            ),
            FileKey::new(
                "",
                FileMeta {
                    min_ts: -1,
                    max_ts: -1,
                    records: -1,
                    original_size: 5,
                    compressed_size: -1,
                    flattened: false,
                },
                false,
            ),
            FileKey::new(
                "",
                FileMeta {
                    min_ts: -1,
                    max_ts: -1,
                    records: -1,
                    original_size: 150,
                    compressed_size: -1,
                    flattened: false,
                },
                false,
            ),
        ];
        let expected: Vec<Vec<i64>> = vec![
            vec![256, 256, 100],
            vec![256, 1, 256],
            vec![200, 30, 90, 256, 5, 150],
        ];
        let byte = partition_file_by_bytes(vec, 3);
        for value in byte
            .iter()
            .map(|x| x.iter().map(|v| v.meta.original_size).collect::<Vec<i64>>())
            .enumerate()
        {
            assert_eq!(value.1, expected.get(value.0).unwrap().clone());
        }
    }
}
