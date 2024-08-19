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
use async_recursion::async_recursion;
use config::{
    get_config,
    meta::{
        cluster::{Node, Role, RoleGroup},
        search::{ScanStats, SearchEventType},
        stream::{
            FileKey, PartitionTimeLevel, QueryPartitionStrategy, StreamPartition, StreamType,
        },
    },
};
use datafusion::{
    common::tree_node::TreeNode,
    execution::{runtime_env::RuntimeEnv, session_state::SessionStateBuilder},
    physical_plan::displayable,
    prelude::SessionContext,
};
use infra::{
    errors::{Error, Result},
    schema::{unwrap_partition_time_level, unwrap_stream_settings},
};
use proto::cluster_rpc::{self, SearchRequest};

use crate::{
    common::infra::cluster as infra_cluster,
    service::search::{
        datafusion::{
            distributed_plan::rewrite::RemoteScanRewriter, exec::register_udf,
            optimizer::generate_optimizer_rules, table_provider::empty_table::NewEmptyTable,
        },
        new_sql::NewSql,
    },
};

#[async_recursion]
pub async fn search(
    trace_id: &str,
    meta: Arc<NewSql>,
    req: cluster_rpc::SearchRequest,
) -> Result<(Vec<RecordBatch>, ScanStats, usize, bool, usize)> {
    log::info!("[trace_id {trace_id}] start flight search");
    log::info!("[trace_id {trace_id}] sql: {}", meta);

    let _start = std::time::Instant::now();
    let group = req
        .search_event_type
        .as_ref()
        .map(|v| SearchEventType::from_str(v).ok().map(RoleGroup::from))
        .unwrap_or(None);
    let cfg = get_config();

    // 1. get nodes
    let nodes = get_online_querier_nodes(&req).await?;
    let querier_num = nodes.iter().filter(|node| node.is_querier()).count();
    if querier_num == 0 {
        log::error!("no querier node online");
        return Err(Error::Message("no querier node online".to_string()));
    }

    // 2. get file list
    let file_lists = get_file_lists(&req, meta.clone()).await?;

    // 3. partition file list
    let partition_file_lists = partition_filt_lists(file_lists, &nodes, group).await?;

    // 4. construct physical plan
    let ctx = generate_context(&req, &meta, cfg.limit.cpu_num).await?;

    // 5. register table
    register_table(&ctx, &meta).await?;

    // 5. create physical plan
    let plan = ctx.state().create_logical_plan(&meta.sql).await?;

    // println!("\n\nlogical plan: {:?}\n\n", plan);
    let mut physical_plan = ctx.state().create_physical_plan(&plan).await?;

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

    let mut rewrite = RemoteScanRewriter::new(req, partition_file_lists, nodes.clone());
    physical_plan = physical_plan.rewrite(&mut rewrite)?.data;

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

    let data = datafusion::physical_plan::collect(physical_plan, ctx.task_ctx()).await?;

    Ok((data, ScanStats::new(), 0, false, 0))
}

async fn get_online_querier_nodes(req: &cluster_rpc::SearchRequest) -> Result<Vec<Node>> {
    let trace_id = req.job.as_ref().unwrap().trace_id.clone();
    // get nodes from cluster
    let req_node_group = req
        .search_event_type
        .as_ref()
        .map(|v| SearchEventType::from_str(v).ok().map(RoleGroup::from))
        .unwrap_or(None);
    let mut nodes = match infra_cluster::get_cached_online_query_nodes(req_node_group).await {
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

pub async fn partition_filt_lists(
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
    meta: &Arc<NewSql>,
    target_partitions: usize,
) -> Result<SessionContext> {
    let mut session_config =
        datafusion::prelude::SessionConfig::new().with_target_partitions(target_partitions);
    session_config
        .options_mut()
        .execution
        .listing_table_ignore_subdirectory = false;
    session_config.options_mut().sql_parser.dialect = "PostgreSQL".to_string();

    let runtime = Arc::new(RuntimeEnv::default());
    let state = SessionStateBuilder::new()
        .with_config(session_config)
        .with_runtime_env(runtime)
        .with_default_features()
        .with_optimizer_rules(generate_optimizer_rules(meta, req))
        .build();
    let ctx = SessionContext::new_with_state(state);

    register_udf(&ctx, &req.org_id).await;

    Ok(ctx)
}

pub async fn register_table(ctx: &SessionContext, sql: &NewSql) -> Result<()> {
    // TODO replace schema to Arc<schema>
    let cfg = get_config();
    for (stream_name, schema) in &sql.schemas {
        let schema = schema.schema().clone();
        let table = Arc::new(
            NewEmptyTable::new(stream_name, Arc::new(schema)).with_partitions(cfg.limit.cpu_num),
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
