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

use arrow::array::RecordBatch;
use config::{
    get_config,
    meta::{
        cluster::{Node, Role, RoleGroup},
        search::{ScanStats, SearchEventType},
        stream::{
            FileKey, PartitionTimeLevel, QueryPartitionStrategy, StreamPartition, StreamType,
        },
    },
    metrics,
};
use datafusion::{
    common::tree_node::TreeNode, physical_plan::displayable, prelude::SessionContext,
};
use hashbrown::HashSet;
use infra::{
    dist_lock,
    errors::{Error, Result},
    schema::{unwrap_partition_time_level, unwrap_stream_settings},
};
use proto::cluster_rpc::{self, SearchRequest};
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
        new_sql::NewSql,
    },
};

pub async fn search(
    trace_id: &str,
    sql: Arc<NewSql>,
    mut req: cluster_rpc::SearchRequest,
) -> Result<(Vec<RecordBatch>, ScanStats, usize, bool, usize)> {
    let start = std::time::Instant::now();
    log::info!(
        "[trace_id {trace_id}] search->flight[leader]: start, sql: {}",
        sql
    );

    let cfg = get_config();
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

    let trace_id = req.job.as_ref().unwrap().trace_id.clone();
    #[cfg(feature = "enterprise")]
    let user_id = req.user_id.clone();
    #[cfg(feature = "enterprise")]
    let user_id = user_id.as_deref();
    let node_group = req
        .search_event_type
        .as_ref()
        .map(|v| SearchEventType::from_str(v).ok().map(RoleGroup::from))
        .unwrap_or(None);

    // 1. get nodes
    let nodes = get_online_querier_nodes(&trace_id, node_group).await?;
    let querier_num = nodes.iter().filter(|node| node.is_querier()).count();
    if querier_num == 0 {
        log::error!("no querier node online");
        return Err(Error::Message("no querier node online".to_string()));
    }

    // 2. get file list
    let file_list = get_file_lists(&req, sql.clone()).await?;

    // 3. partition file list
    let partition_file_lists = partition_file_lists(file_list, &nodes, node_group).await?;

    let file_list_vec = partition_file_lists
        .values()
        .flatten()
        .flatten()
        .collect::<Vec<_>>();
    let file_list_took = start.elapsed().as_millis() as usize;
    log::info!(
        "[trace_id {trace_id}] search->flight[leader]: get file_list time_range: {:?}, num: {}, took: {} ms",
        sql.time_range,
        file_list_vec.len(),
        file_list_took,
    );

    // waiting in work group queue
    metrics::QUERY_PENDING_NUMS
        .with_label_values(&[&req.org_id])
        .inc();

    #[cfg(not(feature = "enterprise"))]
    let work_group: Option<String> = None;
    // 1. get work group
    #[cfg(feature = "enterprise")]
    let work_group: Option<o2_enterprise::enterprise::search::WorkGroup> = Some(
        o2_enterprise::enterprise::search::work_group::predict(&nodes, &file_list_vec),
    );
    #[cfg(feature = "enterprise")]
    super::super::SEARCH_SERVER
        .add_work_group(&trace_id, work_group.clone())
        .await;
    // 2. check concurrency
    let work_group_str = if let Some(wg) = &work_group {
        wg.to_string()
    } else {
        "global".to_string()
    };

    let locker_key = format!("/search/cluster_queue/{}", work_group_str);
    // get a cluster search queue lock
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

    // check global concurrency
    #[cfg(feature = "enterprise")]
    super::work_group_checking(&trace_id, start, &req, &work_group, &locker, None).await?;

    // check user concurrency
    #[cfg(feature = "enterprise")]
    if user_id.is_some() {
        super::work_group_checking(&trace_id, start, &req, &work_group, &locker, user_id).await?;
    }

    // 3. process the search in the work group
    #[cfg(feature = "enterprise")]
    if let Err(e) = work_group
        .as_ref()
        .unwrap()
        .process(&trace_id, user_id)
        .await
    {
        metrics::QUERY_PENDING_NUMS
            .with_label_values(&[&req.org_id])
            .dec();
        dist_lock::unlock(&locker).await?;
        return Err(Error::Message(e.to_string()));
    }
    #[cfg(feature = "enterprise")]
    if let Err(e) = dist_lock::unlock(&locker).await {
        metrics::QUERY_PENDING_NUMS
            .with_label_values(&[&req.org_id])
            .dec();
        work_group
            .as_ref()
            .unwrap()
            .done(&trace_id, user_id)
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

    // reset work_group
    req.work_group = work_group_str;

    // 4. construct physical plan
    let ctx = match generate_context(&req, &sql, cfg.limit.cpu_num).await {
        Ok(v) => v,
        Err(e) => {
            // search done, release lock
            #[cfg(not(feature = "enterprise"))]
            dist_lock::unlock(&locker).await?;
            #[cfg(feature = "enterprise")]
            {
                work_group
                    .as_ref()
                    .unwrap()
                    .done(&trace_id, user_id)
                    .await
                    .map_err(|e| Error::Message(e.to_string()))?;
            }
            return Err(e);
        }
    };

    // 5. register table
    if let Err(e) = register_table(&ctx, &sql).await {
        // search done, release lock
        #[cfg(not(feature = "enterprise"))]
        dist_lock::unlock(&locker).await?;
        #[cfg(feature = "enterprise")]
        {
            work_group
                .as_ref()
                .unwrap()
                .done(&trace_id, user_id)
                .await
                .map_err(|e| Error::Message(e.to_string()))?;
        }
        return Err(e);
    }

    #[cfg(feature = "enterprise")]
    {
        // TODO
        let idx_scan_size = 0;
        let mut records = 0;
        let mut original_size = 0;
        let mut compressed_size = 0;
        for file in file_list_vec.iter() {
            let file_meta = &file.meta;
            records += file_meta.records;
            original_size += file_meta.original_size;
            compressed_size += file_meta.compressed_size;
        }
        original_size += idx_scan_size as i64;
        super::super::SEARCH_SERVER
            .add_file_stats(
                &trace_id,
                file_list_vec.len() as i64,
                records,
                original_size,
                compressed_size,
            )
            .await;
    }

    metrics::QUERY_PENDING_NUMS
        .with_label_values(&[&sql.org_id])
        .dec();
    metrics::QUERY_RUNNING_NUMS
        .with_label_values(&[&sql.org_id])
        .inc();

    #[cfg(feature = "enterprise")]
    let (abort_sender, abort_receiver) = tokio::sync::oneshot::channel();
    #[cfg(feature = "enterprise")]
    if super::super::SEARCH_SERVER
        .insert_sender(&trace_id, abort_sender)
        .await
        .is_err()
    {
        log::info!("[trace_id {trace_id}] search->grpc: search canceled before call search->grpc");
        work_group
            .as_ref()
            .unwrap()
            .done(&trace_id, user_id)
            .await
            .map_err(|e| Error::Message(e.to_string()))?;
        return Err(Error::ErrorCode(
            infra::errors::ErrorCodes::SearchCancelQuery(format!(
                "[trace_id {trace_id}] search->grpc: search canceled before call search->grpc"
            )),
        ));
    }

    // 5. create physical plan
    let plan = match ctx.state().create_logical_plan(&sql.sql).await {
        Ok(v) => v,
        Err(e) => {
            // search done, release lock
            #[cfg(not(feature = "enterprise"))]
            dist_lock::unlock(&locker).await?;
            #[cfg(feature = "enterprise")]
            {
                work_group
                    .as_ref()
                    .unwrap()
                    .done(&trace_id, user_id)
                    .await
                    .map_err(|e| Error::Message(e.to_string()))?;
            }
            return Err(e.into());
        }
    };
    let mut physical_plan = match ctx.state().create_physical_plan(&plan).await {
        Ok(v) => v,
        Err(e) => {
            // search done, release lock
            #[cfg(not(feature = "enterprise"))]
            dist_lock::unlock(&locker).await?;
            #[cfg(feature = "enterprise")]
            {
                work_group
                    .as_ref()
                    .unwrap()
                    .done(&trace_id, user_id)
                    .await
                    .map_err(|e| Error::Message(e.to_string()))?;
            }
            return Err(e.into());
        }
    };

    if cfg.common.print_key_sql {
        let plan = displayable(physical_plan.as_ref())
            .set_show_schema(false)
            .indent(true)
            .to_string();
        println!("+---------------------------+----------+");
        println!("leader physical plan before rewrite");
        println!("+---------------------------+----------+");
        println!("{}", plan);
    }

    // 6. rewrite physical plan
    let match_all_keys = sql.match_items.clone().unwrap_or_default();
    let partition_keys = sql
        .equal_items
        .iter()
        .map(|(stream_name, fields)| cluster_rpc::PartitionKeys::new(stream_name, fields.clone()))
        .collect::<Vec<_>>();
    let mut rewrite = RemoteScanRewriter::new(
        req,
        nodes,
        partition_file_lists,
        partition_keys,
        match_all_keys,
    );
    physical_plan = match physical_plan.rewrite(&mut rewrite) {
        Ok(v) => v.data,
        Err(e) => {
            // search done, release lock
            #[cfg(not(feature = "enterprise"))]
            dist_lock::unlock(&locker).await?;
            #[cfg(feature = "enterprise")]
            {
                work_group
                    .as_ref()
                    .unwrap()
                    .done(&trace_id, user_id)
                    .await
                    .map_err(|e| Error::Message(e.to_string()))?;
            }
            return Err(e.into());
        }
    };

    // add remote scan exec to top if physical plan is not changed
    if !rewrite.is_changed {
        let table_name = sql.stream_names.first().unwrap();
        physical_plan = Arc::new(RemoteScanExec::new(
            physical_plan,
            rewrite.file_lists.get(table_name).unwrap().clone(),
            rewrite.partition_keys.clone(),
            rewrite.match_all_keys.clone(),
            rewrite.req,
            rewrite.nodes,
        ));
    }

    if cfg.common.print_key_sql {
        let plan = displayable(physical_plan.as_ref())
            .set_show_schema(false)
            .indent(true)
            .to_string();
        println!("+---------------------------+----------+");
        println!("leader physical plan after rewrite");
        println!("+---------------------------+----------+");
        println!("{}", plan);
    }

    let datafusion_span = info_span!(
        "service:search:flight:datafusion",
        org_id = sql.org_id,
        stream_name = sql.stream_names.first().unwrap(),
        stream_type = sql.stream_type.to_string(),
    );

    let trace_id2 = trace_id.clone();
    let task = tokio::task::spawn(
        async move {
            tokio::select! {
                ret = datafusion::physical_plan::collect(physical_plan, ctx.task_ctx()) => {
                    match ret {
                        Ok(ret) => Ok(ret),
                        Err(err) => {
                            log::error!("[trace_id {trace_id2}] search->flight[leader]: datafusion execute error: {}", err); 
                            Err(err)
                        }
                    }
                },
                _ = tokio::time::sleep(tokio::time::Duration::from_secs(timeout)) => {
                    log::error!("[trace_id {trace_id2}] search->flight[leader]: search timeout");
                    Err(datafusion::error::DataFusionError::ResourcesExhausted(format!("[trace_id {trace_id2}] search->flight[leader]: search timeout")))
                },
                _ = async {
                    #[cfg(feature = "enterprise")]
                    let _ = abort_receiver.await;
                    #[cfg(not(feature = "enterprise"))]
                    futures::future::pending::<()>().await;
                } => {
                    log::info!("[trace_id {trace_id2}] search->flight[leader]: search canceled");
                     Err(datafusion::error::DataFusionError::ResourcesExhausted(format!("[trace_id {trace_id2}] search->flight[leader]: search canceled")))
                }
            }
        }
        .instrument(datafusion_span),
    );

    let data = match task.await {
        Ok(Ok(data)) => Ok(data),
        Ok(Err(err)) => Err(err.into()),
        Err(err) => Err(Error::Message(err.to_string())),
    };
    let data = match data {
        Ok(v) => v,
        Err(e) => {
            // search done, release lock
            #[cfg(not(feature = "enterprise"))]
            dist_lock::unlock(&locker).await?;
            #[cfg(feature = "enterprise")]
            {
                work_group
                    .as_ref()
                    .unwrap()
                    .done(&trace_id, user_id)
                    .await
                    .map_err(|e| Error::Message(e.to_string()))?;
            }
            return Err(e);
        }
    };

    log::info!("[trace_id {trace_id}] search->flight[leader]: search finished");

    Ok((data, ScanStats::new(), 0, false, 0))
}

async fn get_online_querier_nodes(
    trace_id: &str,
    node_group: Option<RoleGroup>,
) -> Result<Vec<Node>> {
    // get nodes from cluster
    let mut nodes = match infra_cluster::get_cached_online_query_nodes(node_group).await {
        Some(nodes) => nodes,
        None => {
            log::error!("[trace_id {trace_id}] service:search:cluster:run: no querier node online");
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

async fn get_file_lists(
    req: &cluster_rpc::SearchRequest,
    meta: Arc<NewSql>,
) -> Result<HashMap<String, Vec<FileKey>>> {
    let _trace_id = req.job.as_ref().unwrap().trace_id.clone();
    let mut file_lists = HashMap::with_capacity(meta.stream_names.len());

    for name in &meta.stream_names {
        // stream settings
        let stream_settings =
            unwrap_stream_settings(meta.schemas.get(name).unwrap().schema()).unwrap_or_default();
        let partition_time_level =
            unwrap_partition_time_level(stream_settings.partition_time_level, meta.stream_type);

        // get file list
        let file_list = get_file_list(
            name,
            &meta,
            meta.stream_type,
            partition_time_level,
            &stream_settings.partition_keys,
        )
        .await;
        file_lists.insert(name.clone(), file_list);
    }
    Ok(file_lists)
}

#[tracing::instrument(skip(sql), fields(org_id = sql.org_id, stream_name = stream_name))]
pub(crate) async fn get_file_list(
    stream_name: &str,
    sql: &NewSql,
    stream_type: StreamType,
    time_level: PartitionTimeLevel,
    partition_keys: &[StreamPartition],
) -> Vec<FileKey> {
    let is_local = get_config().common.meta_store_external
        || infra_cluster::get_cached_online_querier_nodes(Some(RoleGroup::Interactive))
            .await
            .unwrap_or_default()
            .len()
            <= 1;
    let (time_min, time_max) = sql.time_range.unwrap();
    let file_list = crate::service::file_list::query(
        &sql.org_id,
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
        if sql
            .match_source(
                stream_name,
                &file,
                false,
                false,
                stream_type,
                partition_keys,
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
    match partition_strategy {
        QueryPartitionStrategy::FileNum => Ok(partition_file_by_nums(file_list, querier_num)),
        QueryPartitionStrategy::FileSize => Ok(partition_file_by_bytes(file_list, querier_num)),
        QueryPartitionStrategy::FileHash => {
            Ok(partition_file_by_hash(file_list, nodes, group).await)
        }
    }
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
    req: &SearchRequest,
    sql: &Arc<NewSql>,
    target_partitions: usize,
) -> Result<SessionContext> {
    let work_group = if !req.work_group.is_empty() {
        Some(req.work_group.clone())
    } else {
        None
    };
    let optimizer_rules = generate_optimizer_rules(sql, req);
    let ctx = prepare_datafusion_context(
        work_group,
        optimizer_rules,
        sql.sorted_by_time,
        target_partitions,
    )
    .await?;

    // register udf
    register_udf(&ctx, &req.org_id).await;

    Ok(ctx)
}

pub async fn register_table(ctx: &SessionContext, sql: &NewSql) -> Result<()> {
    for (stream_name, schema) in &sql.schemas {
        let schema = schema
            .schema()
            .as_ref()
            .clone()
            .with_metadata(HashMap::new());
        let table = Arc::new(
            NewEmptyTable::new(stream_name, Arc::new(schema))
                .with_partitions(ctx.state().config().target_partitions())
                .with_sorted_by_time(sql.sorted_by_time),
        );
        ctx.register_table(stream_name, table)?;
    }
    Ok(())
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
