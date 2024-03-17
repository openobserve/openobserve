// Copyright 2023 Zinc Labs Inc.
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

use std::{
    cmp::{max, min},
    io::Cursor,
    sync::Arc,
};

use ::datafusion::arrow::{datatypes::Schema, ipc, json as arrow_json, record_batch::RecordBatch};
use async_recursion::async_recursion;
use chrono::Duration;
use config::{
    cluster::{is_ingester, is_querier},
    ider,
    meta::{
        cluster::{Node, Role},
        stream::{FileKey, PartitionTimeLevel, QueryPartitionStrategy, StreamType},
    },
    utils::{flatten, json, str::find},
    CONFIG, INDEX_MIN_CHAR_LEN,
};
use hashbrown::{HashMap, HashSet};
use infra::{
    dist_lock,
    errors::{Error, ErrorCodes},
};
use itertools::Itertools;
use once_cell::sync::Lazy;
use tokio::sync::Mutex;
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};
use tracing::{info_span, Instrument};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use vector_enrichment::TableRegistry;

use crate::{
    common::{
        infra::cluster::{self, get_node_from_consistent_hash},
        meta::{
            functions::VRLResultResolver,
            search,
            stream::{ScanStats, StreamParams, StreamPartition},
        },
    },
    handler::grpc::cluster_rpc,
    service::{file_list, format_partition_key, stream},
};

pub(crate) mod datafusion;
pub(crate) mod grpc;
pub(crate) mod sql;

pub(crate) static QUEUE_LOCKER: Lazy<Arc<Mutex<bool>>> =
    Lazy::new(|| Arc::new(Mutex::const_new(false)));

#[tracing::instrument(name = "service:search:enter", skip(req))]
pub async fn search(
    session_id: &str,
    org_id: &str,
    stream_type: StreamType,
    req: &search::Request,
) -> Result<search::Response, Error> {
    let session_id = if session_id.is_empty() {
        ider::uuid()
    } else {
        session_id.to_string()
    };
    let mut req: cluster_rpc::SearchRequest = req.to_owned().into();
    req.job.as_mut().unwrap().session_id = session_id;
    req.org_id = org_id.to_string();
    req.stype = cluster_rpc::SearchType::User as i32;
    req.stream_type = stream_type.to_string();
    search_in_cluster(req).await
}

#[tracing::instrument(name = "service:search_partition_multi:enter", skip(req))]
pub async fn search_partition_multi(
    session_id: &str,
    org_id: &str,
    stream_type: StreamType,
    req: &search::MultiSearchPartitionRequest,
) -> Result<search::MultiSearchPartitionResponse, Error> {
    let mut res = search::MultiSearchPartitionResponse {
        success: HashMap::new(),
        error: HashMap::new(),
    };

    for query in &req.sql {
        match search_partition(
            session_id,
            org_id,
            stream_type,
            &search::SearchPartitionRequest {
                start_time: req.start_time,
                end_time: req.end_time,
                sql: query.to_string(),
            },
        )
        .await
        {
            Ok(resp) => {
                res.success.insert(query.to_string(), resp);
            }
            Err(err) => {
                res.error.insert(query.to_string(), err.to_string());
            }
        };
    }
    Ok(res)
}

#[tracing::instrument(name = "service:search_partition:enter", skip(req))]
pub async fn search_partition(
    session_id: &str,
    org_id: &str,
    stream_type: StreamType,
    req: &search::SearchPartitionRequest,
) -> Result<search::SearchPartitionResponse, Error> {
    let query = cluster_rpc::SearchQuery {
        start_time: req.start_time,
        end_time: req.end_time,
        sql: req.sql.to_string(),
        ..Default::default()
    };
    let search_req = cluster_rpc::SearchRequest {
        org_id: org_id.to_string(),
        stream_type: stream_type.to_string(),
        query: Some(query),
        ..Default::default()
    };
    let meta = sql::Sql::new(&search_req).await?;

    let stream_settings = stream::stream_settings(&meta.schema).unwrap_or_default();
    let partition_time_level =
        stream::unwrap_partition_time_level(stream_settings.partition_time_level, stream_type);
    let files = get_file_list(
        session_id,
        &meta,
        stream_type,
        partition_time_level,
        &stream_settings.partition_keys,
    )
    .await;

    let nodes = cluster::get_cached_online_querier_nodes()
        .await
        .unwrap_or_default();
    let cpu_cores = nodes.iter().map(|n| n.cpu_num).sum::<u64>() as usize;

    let (records, original_size, compressed_size) =
        files
            .iter()
            .fold((0, 0, 0), |(records, original_size, compressed_size), f| {
                (
                    records + f.meta.records,
                    original_size + f.meta.original_size,
                    compressed_size + f.meta.compressed_size,
                )
            });
    let mut resp = search::SearchPartitionResponse {
        session_id: session_id.to_string(),
        file_num: files.len(),
        records: records as usize,
        original_size: original_size as usize,
        compressed_size: compressed_size as usize,
        partitions: vec![],
    };
    let mut total_secs = resp.original_size / CONFIG.limit.query_group_base_speed / cpu_cores;
    if total_secs * CONFIG.limit.query_group_base_speed * cpu_cores < resp.original_size {
        total_secs += 1;
    }
    let mut part_num = max(1, total_secs / CONFIG.limit.query_partition_by_secs);
    if part_num * CONFIG.limit.query_partition_by_secs < total_secs {
        part_num += 1;
    }
    let mut step = max(
        Duration::seconds(CONFIG.limit.query_partition_min_secs)
            .num_microseconds()
            .unwrap(),
        (req.end_time - req.start_time) / part_num as i64,
    );
    // step must be times of minute
    step = step - step % Duration::minutes(1).num_microseconds().unwrap();

    // generate partitions
    let mut partitions = Vec::with_capacity(part_num);
    let mut end = req.end_time;
    while end > req.start_time {
        let start = max(end - step, req.start_time);
        partitions.push([start, end]);
        end = start;
    }
    resp.partitions = partitions;
    Ok(resp)
}

#[tracing::instrument(skip(sql), fields(session_id = ?_session_id, org_id = sql.org_id, stream_name = sql.stream_name))]
async fn get_file_list(
    _session_id: &str,
    sql: &sql::Sql,
    stream_type: StreamType,
    time_level: PartitionTimeLevel,
    partition_keys: &[StreamPartition],
) -> Vec<FileKey> {
    let is_local = CONFIG.common.meta_store_external
        || cluster::get_cached_online_querier_nodes()
            .await
            .unwrap_or_default()
            .len()
            <= 1;
    let (time_min, time_max) = sql.meta.time_range.unwrap();
    let file_list = match file_list::query(
        &sql.org_id,
        &sql.stream_name,
        stream_type,
        time_level,
        time_min,
        time_max,
        is_local,
    )
    .await
    {
        Ok(file_list) => file_list,
        Err(_) => vec![],
    };

    let mut files = Vec::with_capacity(file_list.len());
    for file in file_list {
        if sql
            .match_source(&file, false, false, stream_type, partition_keys)
            .await
        {
            files.push(file.to_owned());
        }
    }
    files.sort_by(|a, b| a.key.cmp(&b.key));
    files.dedup_by(|a, b| a.key == b.key);
    files
}

#[async_recursion]
#[tracing::instrument(
    name = "service:search:cluster",
    skip(req),
    fields(session_id = req.job.as_ref().unwrap().session_id, org_id = req.org_id)
)]
async fn search_in_cluster(mut req: cluster_rpc::SearchRequest) -> Result<search::Response, Error> {
    let start = std::time::Instant::now();
    let session_id = req.job.as_ref().unwrap().session_id.clone();

    // handle request time range
    let stream_type = StreamType::from(req.stream_type.as_str());
    let meta = sql::Sql::new(&req).await?;
    if meta.rewrite_sql != req.query.as_ref().unwrap().sql {
        req.query.as_mut().unwrap().sql = meta.rewrite_sql.clone();
    }

    // get nodes from cluster
    let mut nodes = cluster::get_cached_online_query_nodes().await.unwrap();
    // sort nodes by node_id this will improve hit cache ratio
    nodes.sort_by(|a, b| a.grpc_addr.cmp(&b.grpc_addr));
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);
    nodes.sort_by_key(|x| x.id);
    let nodes = nodes;

    let querier_num = nodes.iter().filter(|node| is_querier(&node.role)).count();
    if querier_num == 0 {
        return Err(Error::Message("no querier node online".to_string()));
    }

    // partition request, here plus 1 second, because division is integer, maybe
    // lose some precision
    let job = cluster_rpc::Job {
        session_id: session_id.clone(),
        job: session_id[0..6].to_string(), // take the frist 6 characters as job id
        stage: 0,
        partition: 0,
    };

    let is_inverted_index = !meta.fts_terms.is_empty();

    log::warn!(
        "searching in is_agg_query {:?} is_inverted_index {:?}",
        !req.aggs.is_empty(),
        is_inverted_index
    );

    // stream settings
    let stream_settings = stream::stream_settings(&meta.schema).unwrap_or_default();
    let partition_time_level =
        stream::unwrap_partition_time_level(stream_settings.partition_time_level, stream_type);

    // If the query is of type inverted index and this is not an aggregations request
    let (file_list, inverted_index_count) = if is_inverted_index && req.aggs.is_empty() {
        let mut idx_req = req.clone();

        // Get all the unique terms which the user has searched.
        let terms = meta
            .fts_terms
            .iter()
            .flat_map(|t| {
                let mut tokenized_search_terms = vec![];
                t.split(|c| CONFIG.common.inverted_index_split_chars.contains(c))
                    .for_each(|s| {
                        if !s.is_empty() && s.len() >= INDEX_MIN_CHAR_LEN {
                            tokenized_search_terms.push(s.to_lowercase())
                        }
                    });
                tokenized_search_terms
            })
            .collect::<HashSet<String>>();

        let search_condition = terms
            .iter()
            .map(|x| format!("term LIKE '%{x}%'"))
            .collect::<Vec<String>>()
            .join(" or ");

        let query = format!(
            "SELECT file_name, term, _count, _timestamp, deleted FROM \"{}\" WHERE {}",
            meta.stream_name, search_condition
        );

        let is_first_page = idx_req.query.as_ref().unwrap().from == 0;
        idx_req.stream_type = StreamType::Index.to_string();
        idx_req.query.as_mut().unwrap().sql = query;
        idx_req.query.as_mut().unwrap().sql_mode = "full".to_string();
        idx_req.query.as_mut().unwrap().from = 0; // from 0 to get all the results from index anyway.
        idx_req.query.as_mut().unwrap().size = 99999;
        idx_req.query.as_mut().unwrap().uses_zo_fn = false;
        idx_req.query.as_mut().unwrap().track_total_hits = false;
        idx_req.query.as_mut().unwrap().query_context = "".to_string();
        idx_req.query.as_mut().unwrap().query_fn = "".to_string();
        idx_req.aggs.clear();

        let idx_resp: search::Response = search_in_cluster(idx_req).await?;
        let (unique_files, inverted_index_count) = if is_first_page {
            // should be query size * 2
            let limit_count = std::cmp::max(10, req.query.as_ref().unwrap().size as u64 * 2);
            let mut total_count = 0;
            // get deleted file
            let deleted_files = idx_resp
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
            let sorted_data = idx_resp
                .hits
                .iter()
                .filter_map(|hit| {
                    let term = hit.get("term").unwrap().as_str().unwrap().to_string();
                    let file_name = hit.get("file_name").unwrap().as_str().unwrap().to_string();
                    let timestamp = hit.get("_timestamp").unwrap().as_i64().unwrap();
                    let count = hit.get("_count").unwrap().as_u64().unwrap();
                    if deleted_files.contains(&file_name) {
                        None
                    } else {
                        total_count += count;
                        Some((term, file_name, count, timestamp))
                    }
                })
                .sorted_by(|a, b| Ord::cmp(&b.3, &a.3)); // Descending order of timestamp
            let mut term_map: HashMap<String, Vec<String>> = HashMap::new();
            let mut term_counts: HashMap<String, u64> = HashMap::new();

            println!("index got file_list: {:?}", sorted_data.len());

            for (term, filename, count, _timestamp) in sorted_data {
                let term = term.as_str();
                for search_term in terms.iter() {
                    if term.contains(search_term) {
                        let current_count = term_counts.entry(search_term.to_string()).or_insert(0);
                        if *current_count < limit_count {
                            *current_count += count;
                            term_map
                                .entry(search_term.to_string())
                                .or_insert_with(Vec::new)
                                .push(filename.to_string());
                        }
                    }
                }
            }
            println!("term_map: {:?}", term_map);
            (
                term_map
                    .into_iter()
                    .flat_map(|(_, filenames)| filenames)
                    .collect::<HashSet<_>>(),
                Some(total_count),
            )
        } else {
            (
                idx_resp
                    .hits
                    .iter()
                    .map(|hit| hit.get("file_name").unwrap().as_str().unwrap().to_string())
                    .collect::<HashSet<_>>(),
                None,
            )
        };

        let mut idx_file_list: Vec<FileKey> = vec![];
        for filename in unique_files {
            let prefixed_filename = format!(
                "files/{}/{}/{}/{}",
                meta.org_id, stream_type, meta.stream_name, filename
            );
            if let Ok(file_meta) = file_list::get_file_meta(&prefixed_filename).await {
                idx_file_list.push(FileKey {
                    key: prefixed_filename.to_string(),
                    meta: file_meta,
                    deleted: false,
                });
            }
        }
        // sorted by _timestamp
        idx_file_list.sort_by(|a, b| a.meta.min_ts.cmp(&b.meta.min_ts));
        (idx_file_list, inverted_index_count)
    } else {
        (
            get_file_list(
                &session_id,
                &meta,
                stream_type,
                partition_time_level,
                &stream_settings.partition_keys,
            )
            .await,
            None,
        )
    };

    println!("final file_list: {:?}", file_list.len());

    #[cfg(not(feature = "enterprise"))]
    let work_group: Option<String> = None;
    // 1. get work group
    #[cfg(feature = "enterprise")]
    let work_group: Option<o2_enterprise::enterprise::search::WorkGroup> =
        Some(o2_enterprise::enterprise::search::queue::predict_work_group(&nodes, &file_list));
    // 2. check concurrency
    let work_group_str = if let Some(wg) = &work_group {
        wg.to_string()
    } else {
        "global".to_string()
    };

    let locker_key = "/search/cluster_queue/".to_string() + work_group_str.as_str();
    // get a cluster search queue lock
    let locker = dist_lock::lock(&locker_key, 0).await?;
    #[cfg(feature = "enterprise")]
    loop {
        match work_group.as_ref().unwrap().need_wait().await {
            Ok(true) => {
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            }
            Ok(false) => {
                break;
            }
            Err(e) => {
                dist_lock::unlock(&locker).await?;
                return Err(Error::Message(e.to_string()));
            }
        }
    }
    // 3. process the search in the work group
    #[cfg(feature = "enterprise")]
    if let Err(e) = work_group.as_ref().unwrap().process(&session_id).await {
        dist_lock::unlock(&locker).await?;
        return Err(Error::Message(e.to_string()));
    }
    #[cfg(feature = "enterprise")]
    dist_lock::unlock(&locker).await?;
    let took_wait = start.elapsed().as_millis() as usize;

    // set work_group
    req.work_group = work_group_str;

    let mut partition_files = Vec::new();
    let mut file_num = file_list.len();
    let mut partition_strategy =
        QueryPartitionStrategy::from(&CONFIG.common.feature_query_partition_strategy);
    if CONFIG.memory_cache.cache_latest_files {
        partition_strategy = QueryPartitionStrategy::FileHash;
    }
    let offset = match partition_strategy {
        QueryPartitionStrategy::FileNum => {
            if querier_num >= file_num {
                1
            } else {
                (file_num / querier_num) + 1
            }
        }
        QueryPartitionStrategy::FileSize => {
            let files = partition_file_by_bytes(&file_list, querier_num);
            file_num = files.len();
            partition_files = files;
            1
        }
        QueryPartitionStrategy::FileHash => {
            let files = partition_file_by_hash(&file_list, &nodes).await;
            file_num = files.len();
            partition_files = files;
            1
        }
    };
    log::info!(
        "[session_id {session_id}] search->file_list: time_range: {:?}, num: {file_num}, offset: {offset}",
        meta.meta.time_range
    );

    // set this value to null & use it later on results ,
    // this being to avoid performance impact of query fn being applied during query
    // execution
    let query_fn = req.query.as_ref().unwrap().query_fn.clone();
    req.query.as_mut().unwrap().query_fn = "".to_string();

    // make cluster request
    let mut tasks = Vec::new();
    let mut offset_start: usize = 0;
    for (partition_no, node) in nodes.iter().cloned().enumerate() {
        let session_id = session_id.clone();
        let mut req = req.clone();
        let mut job = job.clone();
        job.partition = partition_no as i32;
        req.job = Some(job);
        req.stype = cluster_rpc::SearchType::WalOnly as i32;
        let is_querier = is_querier(&node.role);
        if is_querier {
            if offset_start < file_num {
                req.stype = cluster_rpc::SearchType::Cluster as i32;
                match partition_strategy {
                    QueryPartitionStrategy::FileNum => {
                        req.file_list = file_list
                            [offset_start..min(offset_start + offset, file_num)]
                            .to_vec()
                            .iter()
                            .map(cluster_rpc::FileKey::from)
                            .collect();
                        offset_start += offset;
                    }
                    QueryPartitionStrategy::FileSize | QueryPartitionStrategy::FileHash => {
                        req.file_list = partition_files
                            .get(offset_start)
                            .unwrap()
                            .iter()
                            .map(|f| cluster_rpc::FileKey::from(*f))
                            .collect();
                        offset_start += offset;
                        if req.file_list.is_empty() {
                            if is_ingester(&node.role) {
                                req.stype = cluster_rpc::SearchType::WalOnly as i32;
                            } else {
                                continue; // no need more querier
                            }
                        }
                    }
                };
            } else if !is_ingester(&node.role) {
                continue; // no need more querier
            }
        }

        let req_files = req.file_list.len();
        let node_addr = node.grpc_addr.clone();
        let grpc_span = info_span!(
            "service:search:cluster:grpc_search",
            session_id,
            org_id = req.org_id,
            node_id = node.id,
            node_addr = node_addr.as_str(),
        );
        let task = tokio::task::spawn(
            async move {
                let org_id: MetadataValue<_> = req
                    .org_id
                    .parse()
                    .map_err(|_| Error::Message("invalid org_id".to_string()))?;
                let mut request = tonic::Request::new(req);
                // request.set_timeout(Duration::from_secs(CONFIG.grpc.timeout));

                opentelemetry::global::get_text_map_propagator(|propagator| {
                    propagator.inject_context(
                        &tracing::Span::current().context(),
                        &mut MetadataMap(request.metadata_mut()),
                    )
                });

                log::info!("[session_id {session_id}] search->grpc: request node: {}, is_querier: {}, files: {req_files}", &node_addr, is_querier);

                let token: MetadataValue<_> = cluster::get_internal_grpc_token()
                    .parse()
                    .map_err(|_| Error::Message("invalid token".to_string()))?;
                let channel = Channel::from_shared(node_addr)
                    .unwrap()
                    .connect()
                    .await
                    .map_err(|err| {
                        log::error!("[session_id {session_id}] search->grpc: node: {}, connect err: {:?}", &node.grpc_addr, err);
                        server_internal_error("connect search node error")
                    })?;
                let mut client = cluster_rpc::search_client::SearchClient::with_interceptor(
                    channel,
                    move |mut req: Request<()>| {
                        req.metadata_mut().insert("authorization", token.clone());
                        req.metadata_mut()
                            .insert(CONFIG.grpc.org_header_key.as_str(), org_id.clone());
                        Ok(req)
                    },
                );
                client = client
                    .send_compressed(CompressionEncoding::Gzip)
                    .accept_compressed(CompressionEncoding::Gzip)
                    .max_decoding_message_size(CONFIG.grpc.max_message_size * 1024 * 1024)
                    .max_encoding_message_size(CONFIG.grpc.max_message_size * 1024 * 1024);
                let response: cluster_rpc::SearchResponse = match client.search(request).await {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!("[session_id {session_id}] search->grpc: node: {}, search err: {:?}", &node.grpc_addr, err);
                        if err.code() == tonic::Code::Internal {
                            let err = ErrorCodes::from_json(err.message())?;
                            return Err(Error::ErrorCode(err));
                        }
                        return Err(server_internal_error("search node error"));
                    }
                };

                log::info!(
                    "[session_id {session_id}] search->grpc: response node: {}, is_querier: {}, total: {}, took: {}, files: {}, scan_size: {}",
                    &node.grpc_addr,
                    is_querier,
                    response.total,
                    response.took,
                    response.scan_stats.as_ref().unwrap().files,
                    response.scan_stats.as_ref().unwrap().original_size,
                );
                Ok((node.clone(),response))
            }
            .instrument(grpc_span),
        );
        tasks.push(task);
    }

    let mut results = Vec::new();
    for task in tasks {
        match task.await {
            Ok(res) => match res {
                Ok(res) => results.push(res),
                Err(err) => {
                    // search done, release lock
                    #[cfg(not(feature = "enterprise"))]
                    dist_lock::unlock(&locker).await?;
                    #[cfg(feature = "enterprise")]
                    work_group
                        .as_ref()
                        .unwrap()
                        .done(&session_id)
                        .await
                        .map_err(|e| Error::Message(e.to_string()))?;
                    return Err(err);
                }
            },
            Err(e) => {
                // search done, release lock
                #[cfg(not(feature = "enterprise"))]
                dist_lock::unlock(&locker).await?;
                #[cfg(feature = "enterprise")]
                work_group
                    .as_ref()
                    .unwrap()
                    .done(&session_id)
                    .await
                    .map_err(|e| Error::Message(e.to_string()))?;
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    e.to_string(),
                )));
            }
        }
    }

    // merge multiple instances data
    let mut scan_stats = ScanStats::new();
    let mut batches: HashMap<String, Vec<RecordBatch>> = HashMap::new();
    let sql = Arc::new(meta);
    for (node, resp) in results {
        scan_stats.add(&resp.scan_stats.as_ref().unwrap().into());
        // handle hits
        let value = batches.entry("query".to_string()).or_default();
        if !resp.hits.is_empty() {
            let buf = Cursor::new(resp.hits);
            let reader = ipc::reader::FileReader::try_new(buf, None).unwrap();
            let batch = reader.into_iter().map(Result::unwrap).collect::<Vec<_>>();
            value.extend(batch);
        }
        // handle aggs
        for agg in resp.aggs {
            // insert count
            if agg.name == "_count" && is_ingester(&node.role) {
                let value = batches.entry("agg_ingester_count".to_string()).or_default();
                if !agg.hits.is_empty() {
                    let buf = Cursor::new(agg.hits.clone());
                    let reader = ipc::reader::FileReader::try_new(buf, None).unwrap();
                    let batch = reader.into_iter().map(Result::unwrap).collect::<Vec<_>>();
                    value.extend(batch);
                }
            }
            let value = batches.entry(format!("agg_{}", agg.name)).or_default();
            if !agg.hits.is_empty() {
                let buf = Cursor::new(agg.hits);
                let reader = ipc::reader::FileReader::try_new(buf, None).unwrap();
                let batch = reader.into_iter().map(Result::unwrap).collect::<Vec<_>>();
                value.extend(batch);
            }
        }
    }

    // convert select field to schema::Field
    let select_fields = sql
        .meta
        .fields
        .iter()
        .filter_map(|f| {
            sql.schema
                .field_with_name(f)
                .ok()
                .map(|f| Arc::new(f.clone()))
        })
        .collect::<Vec<_>>();

    // merge all batches
    let mut merge_batches = HashMap::new();
    for (name, batch) in batches {
        let (merge_sql, select_fields) = if name == "query" {
            (sql.origin_sql.clone(), select_fields.clone())
        } else {
            let mut agg_name = name.strip_prefix("agg_").unwrap();
            if agg_name == "ingester_count" {
                agg_name = "_count";
            }
            (sql.aggs.get(agg_name).unwrap().0.clone(), vec![])
        };
        let batch = match datafusion::exec::merge(
            &sql.org_id,
            sql.meta.offset,
            sql.meta.limit,
            &merge_sql,
            &batch,
            &select_fields,
            true,
        )
        .await
        {
            Ok(res) => res,
            Err(err) => {
                // search done, release lock
                #[cfg(not(feature = "enterprise"))]
                dist_lock::unlock(&locker).await?;
                #[cfg(feature = "enterprise")]
                work_group
                    .as_ref()
                    .unwrap()
                    .done(&session_id)
                    .await
                    .map_err(|e| Error::Message(e.to_string()))?;
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    err.to_string(),
                )));
            }
        };
        merge_batches.insert(name, batch);
    }

    // search done, release lock
    #[cfg(not(feature = "enterprise"))]
    dist_lock::unlock(&locker).await?;
    #[cfg(feature = "enterprise")]
    work_group
        .as_ref()
        .unwrap()
        .done(&session_id)
        .await
        .map_err(|e| Error::Message(e.to_string()))?;

    // final result
    let mut result = search::Response::new(sql.meta.offset, sql.meta.limit);

    // hits
    let query_type = req.query.as_ref().unwrap().query_type.to_lowercase();
    let empty_vec = vec![];
    let batches_query = match merge_batches.get("query") {
        Some(batches) => batches,
        None => &empty_vec,
    };

    if !batches_query.is_empty() {
        let schema = batches_query[0].schema();
        let batches_query_ref: Vec<&RecordBatch> = batches_query.iter().collect();
        let json_rows = match arrow_json::writer::record_batches_to_json_rows(&batches_query_ref) {
            Ok(res) => res,
            Err(err) => {
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    err.to_string(),
                )));
            }
        };
        let mut sources: Vec<json::Value> = if query_fn.is_empty() {
            json_rows
                .into_iter()
                .filter(|v| !v.is_empty())
                .map(json::Value::Object)
                .collect()
        } else {
            // compile vrl function & apply the same before returning the response
            let mut runtime = crate::common::utils::functions::init_vrl_runtime();
            let program =
                match crate::service::ingestion::compile_vrl_function(&query_fn, &sql.org_id) {
                    Ok(program) => {
                        let registry = program.config.get_custom::<TableRegistry>().unwrap();
                        registry.finish_load();
                        Some(program)
                    }
                    Err(err) => {
                        log::error!(
                            "[session_id {session_id}] search->vrl: compile err: {:?}",
                            err
                        );
                        result.function_error = err.to_string();
                        None
                    }
                };
            match program {
                Some(program) => json_rows
                    .into_iter()
                    .filter(|v| !v.is_empty())
                    .filter_map(|hit| {
                        let ret_val = crate::service::ingestion::apply_vrl_fn(
                            &mut runtime,
                            &VRLResultResolver {
                                program: program.program.clone(),
                                fields: program.fields.clone(),
                            },
                            &json::Value::Object(hit.clone()),
                        );
                        (!ret_val.is_null()).then_some(flatten::flatten(ret_val).unwrap())
                    })
                    .collect(),
                None => json_rows
                    .into_iter()
                    .filter(|v| !v.is_empty())
                    .map(json::Value::Object)
                    .collect(),
            }
        };
        // handle query type: json, metrics, table
        if query_type == "table" {
            (result.columns, sources) = handle_table_response(schema, sources);
        } else if query_type == "metrics" {
            sources = handle_metrics_response(sources);
        }

        if sql.uses_zo_fn {
            for source in sources {
                result
                    .add_hit(&flatten::flatten(source).map_err(|e| Error::Message(e.to_string()))?);
            }
        } else {
            for source in sources {
                result.add_hit(&source);
            }
        }
    }

    // aggs
    for (name, batch) in merge_batches {
        if name == "query" || batch.is_empty() {
            continue;
        }
        let name = name.strip_prefix("agg_").unwrap().to_string();
        let batch_ref: Vec<&RecordBatch> = batch.iter().collect();
        let json_rows = match arrow_json::writer::record_batches_to_json_rows(&batch_ref) {
            Ok(res) => res,
            Err(err) => {
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    err.to_string(),
                )));
            }
        };
        let sources: Vec<json::Value> = json_rows.into_iter().map(json::Value::Object).collect();
        for source in sources {
            result.add_agg(&name, &source);
        }
    }

    // total
    let total = match result.aggs.get("_count") {
        Some(v) => v.first().unwrap().get("num").unwrap().as_u64().unwrap() as usize,
        None => result.hits.len(),
    };
    result.aggs.remove("_count");
    // ingester total
    let ingester_total = match result.aggs.get("ingester_count") {
        Some(v) => v.first().unwrap().get("num").unwrap().as_u64().unwrap() as usize,
        None => result.hits.len(),
    };
    result.aggs.remove("ingester_count");

    let inverted_index_count = inverted_index_count.unwrap_or_default() as usize;
    // TODO: ingester mixed with querier will has problem.
    let inverted_index_total = inverted_index_count + ingester_total;
    log::info!("response_total: {}", total);
    log::info!("ingester_total: {}", ingester_total);
    log::info!("inverted_index_count: {}", inverted_index_count);

    // Maybe inverted index count is wrong, we use the max value
    if inverted_index_total > total {
        result.set_total(inverted_index_total);
    } else {
        result.set_total(total);
    }
    result.set_cluster_took(start.elapsed().as_millis() as usize, took_wait);
    result.set_file_count(scan_stats.files as usize);
    result.set_scan_size(scan_stats.original_size as usize);
    result.set_scan_records(scan_stats.records as usize);

    if query_type == "table" {
        result.response_type = "table".to_string();
    } else if query_type == "metrics" {
        result.response_type = "matrix".to_string();
    }

    log::info!(
        "[session_id {session_id}] search->result: total: {}, took: {}, scan_size: {}",
        result.total,
        result.took,
        result.scan_size,
    );

    Ok(result)
}

fn partition_file_by_bytes(file_keys: &[FileKey], num_nodes: usize) -> Vec<Vec<&FileKey>> {
    let mut partitions: Vec<Vec<&FileKey>> = vec![Vec::new(); num_nodes];
    let sum_original_size = file_keys
        .iter()
        .map(|fk| fk.meta.original_size)
        .sum::<i64>();
    let avg_size = sum_original_size / num_nodes as i64;
    let mut node_size = 0;
    let mut node_k = 0;
    for fk in file_keys {
        node_size += fk.meta.original_size;
        if node_size >= avg_size && node_k != num_nodes - 1 && !partitions[node_k].is_empty() {
            node_size = fk.meta.original_size;
            node_k += 1;
            partitions[node_k].push(fk);
            continue;
        }
        partitions[node_k].push(fk);
    }
    partitions
}

async fn partition_file_by_hash<'a>(
    file_keys: &'a [FileKey],
    nodes: &'a [Node],
) -> Vec<Vec<&'a FileKey>> {
    let mut node_idx = HashMap::with_capacity(nodes.len());
    let mut idx = 0;
    for node in nodes {
        if !is_querier(&node.role) {
            continue;
        }
        node_idx.insert(&node.uuid, idx);
        idx += 1;
    }
    let mut partitions: Vec<Vec<&FileKey>> = vec![Vec::new(); idx];
    for fk in file_keys {
        let node_uuid = get_node_from_consistent_hash(&fk.key, &Role::Querier)
            .await
            .expect("there is no querier node in consistent hash ring");
        let idx = node_idx.get(&node_uuid).unwrap_or(&0);
        partitions[*idx].push(fk);
    }
    partitions
}

fn handle_table_response(
    schema: Arc<Schema>,
    sources: Vec<json::Value>,
) -> (Vec<String>, Vec<json::Value>) {
    let columns = schema
        .fields()
        .iter()
        .map(|f| f.name().to_string())
        .collect::<Vec<_>>();
    let mut table = Vec::with_capacity(sources.len());
    for row in &sources {
        let mut new_row = Vec::with_capacity(columns.len());
        let row = row.as_object().unwrap();
        for column in &columns {
            let value = match row.get(column) {
                Some(v) => v.to_owned(),
                None => json::Value::Null,
            };
            new_row.push(value);
        }
        table.push(json::Value::Array(new_row));
    }
    (columns, table)
}

fn handle_metrics_response(sources: Vec<json::Value>) -> Vec<json::Value> {
    // handle metrics response
    let mut results_metrics: HashMap<String, json::Value> = HashMap::with_capacity(16);
    let mut results_values: HashMap<String, Vec<[json::Value; 2]>> = HashMap::with_capacity(16);
    for source in sources {
        let fields = source.as_object().unwrap();
        let mut key = Vec::with_capacity(fields.len());
        fields.iter().for_each(|(k, v)| {
            if *k != CONFIG.common.column_timestamp && k != "value" {
                key.push(format!("{k}_{v}"));
            }
        });
        let key = key.join("_");
        if !results_metrics.contains_key(&key) {
            let mut fields = fields.clone();
            fields.remove(&CONFIG.common.column_timestamp);
            fields.remove("value");
            results_metrics.insert(key.clone(), json::Value::Object(fields));
        }
        let entry = results_values.entry(key).or_default();
        let value = [
            fields
                .get(&CONFIG.common.column_timestamp)
                .unwrap()
                .to_owned(),
            json::Value::String(fields.get("value").unwrap().to_string()),
        ];
        entry.push(value);
    }

    let mut new_sources = Vec::with_capacity(results_metrics.len());
    for (key, metrics) in results_metrics {
        new_sources.push(json::json!({
            "metrics": metrics,
            "values": results_values.get(&key).unwrap(),
        }));
    }

    new_sources
}

/// match a source is a valid file or not
pub async fn match_source(
    stream: StreamParams,
    time_range: Option<(i64, i64)>,
    filters: &[(&str, Vec<String>)],
    source: &FileKey,
    is_wal: bool,
    match_min_ts_only: bool,
) -> bool {
    if stream.stream_type.eq(&StreamType::Metrics)
        && source.key.starts_with(
            format!(
                "files/{}/{}/{}/",
                stream.org_id, stream.stream_type, stream.org_id
            )
            .as_str(),
        )
    {
        return true;
    }

    // match org_id & table
    if !source.key.starts_with(
        format!(
            "files/{}/{}/{}/",
            stream.org_id, stream.stream_type, stream.stream_name
        )
        .as_str(),
    ) {
        return false;
    }

    // check partition key
    if !filter_source_by_partition_key(&source.key, filters) {
        return false;
    }

    if is_wal {
        return true;
    }

    // check time range
    if source.meta.min_ts == 0 || source.meta.max_ts == 0 {
        return true;
    }
    log::trace!(
        "time range: {:?}, file time: {}-{}, {}",
        time_range,
        source.meta.min_ts,
        source.meta.max_ts,
        source.key
    );

    // match partition clause
    if let Some((time_min, time_max)) = time_range {
        if match_min_ts_only && time_min > 0 {
            return source.meta.min_ts >= time_min && source.meta.min_ts < time_max;
        }
        if time_min > 0 && time_min > source.meta.max_ts {
            return false;
        }
        if time_max > 0 && time_max < source.meta.min_ts {
            return false;
        }
    }
    true
}

/// match a source is a needed file or not, return true if needed
fn filter_source_by_partition_key(source: &str, filters: &[(&str, Vec<String>)]) -> bool {
    !filters.iter().any(|(k, v)| {
        let field = format_partition_key(&format!("{k}="));
        find(source, &format!("/{field}"))
            && !v.iter().any(|v| {
                let value = format_partition_key(&format!("{k}={v}"));
                find(source, &format!("/{value}/"))
            })
    })
}

pub struct MetadataMap<'a>(pub &'a mut tonic::metadata::MetadataMap);

impl<'a> opentelemetry::propagation::Injector for MetadataMap<'a> {
    /// Set a key and value in the MetadataMap.  Does nothing if the key or
    /// value are not valid inputs
    fn set(&mut self, key: &str, value: String) {
        if let Ok(key) = tonic::metadata::MetadataKey::from_bytes(key.as_bytes()) {
            if let Ok(val) = tonic::metadata::MetadataValue::try_from(&value) {
                self.0.insert(key, val);
            }
        }
    }
}

pub fn server_internal_error(error: impl ToString) -> Error {
    Error::ErrorCode(ErrorCodes::ServerInternalError(error.to_string()))
}

#[tracing::instrument(name = "service:search_partition_multi:enter", skip(req))]
pub async fn search_partition_multi(
    session_id: &str,
    org_id: &str,
    stream_type: StreamType,
    req: &search::MultiSearchPartitionRequest,
) -> Result<search::SearchPartitionResponse, Error> {
    let mut res = search::SearchPartitionResponse::default();
    let mut total_rec = 0;
    for query in &req.sql {
        match search_partition(
            session_id,
            org_id,
            stream_type,
            &search::SearchPartitionRequest {
                start_time: req.start_time,
                end_time: req.end_time,
                sql: query.to_string(),
            },
        )
        .await
        {
            Ok(resp) => {
                if resp.partitions.len() > res.partitions.len() {
                    total_rec += resp.records;
                    res = resp;
                }
            }
            Err(err) => {
                log::error!("search_partition_multi error: {:?}", err);
            }
        };
    }
    res.records = total_rec;
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matches_by_partition_key_with_str() {
        let path = "files/default/logs/gke-fluentbit/2023/04/14/08/kuberneteshost=gke-dev1/kubernetesnamespacename=ziox-dev/7052558621820981249.parquet";
        let filters = vec![
            (vec![], true),
            (vec![("kuberneteshost", vec!["gke-dev1".to_string()])], true),
            (
                vec![("kuberneteshost", vec!["gke-dev2".to_string()])],
                false,
            ),
            (
                vec![(
                    "kuberneteshost",
                    vec!["gke-dev1".to_string(), "gke-dev2".to_string()],
                )],
                true,
            ),
            (
                vec![("some_other_key", vec!["no-matter".to_string()])],
                true,
            ),
            (
                vec![
                    ("kuberneteshost", vec!["gke-dev1".to_string()]),
                    ("kubernetesnamespacename", vec!["ziox-dev".to_string()]),
                ],
                true,
            ),
            (
                vec![
                    ("kuberneteshost", vec!["gke-dev1".to_string()]),
                    ("kubernetesnamespacename", vec!["abcdefg".to_string()]),
                ],
                false,
            ),
            (
                vec![
                    ("kuberneteshost", vec!["gke-dev2".to_string()]),
                    ("kubernetesnamespacename", vec!["ziox-dev".to_string()]),
                ],
                false,
            ),
            (
                vec![
                    ("kuberneteshost", vec!["gke-dev2".to_string()]),
                    ("kubernetesnamespacename", vec!["abcdefg".to_string()]),
                ],
                false,
            ),
            (
                vec![
                    (
                        "kuberneteshost",
                        vec!["gke-dev1".to_string(), "gke-dev2".to_string()],
                    ),
                    ("kubernetesnamespacename", vec!["ziox-dev".to_string()]),
                ],
                true,
            ),
            (
                vec![
                    (
                        "kuberneteshost",
                        vec!["gke-dev1".to_string(), "gke-dev2".to_string()],
                    ),
                    ("kubernetesnamespacename", vec!["abcdefg".to_string()]),
                ],
                false,
            ),
            (
                vec![
                    (
                        "kuberneteshost",
                        vec!["gke-dev1".to_string(), "gke-dev2".to_string()],
                    ),
                    ("some_other_key", vec!["no-matter".to_string()]),
                ],
                true,
            ),
        ];
        for (filter, expected) in filters {
            assert_eq!(filter_source_by_partition_key(path, &filter), expected);
        }
    }

    #[test]
    fn test_matches_by_partition_key_with_sql() {
        use crate::common::meta::sql;

        let path = "files/default/logs/gke-fluentbit/2023/04/14/08/kuberneteshost=gke-dev1/kubernetesnamespacename=ziox-dev/7052558621820981249.parquet";
        let sqls = vec![
            ("SELECT * FROM tbl", true),
            ("SELECT * FROM tbl WHERE kuberneteshost='gke-dev1'", true),
            ("SELECT * FROM tbl WHERE kuberneteshost='gke-dev2'", false),
            ("SELECT * FROM tbl WHERE some_other_key = 'no-matter'", true),
            (
                "SELECT * FROM tbl WHERE kuberneteshost='gke-dev1' AND kubernetesnamespacename='ziox-dev'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost='gke-dev1' AND kubernetesnamespacename='abcdefg'",
                false,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost='gke-dev2' AND kubernetesnamespacename='ziox-dev'",
                false,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost='gke-dev2' AND kubernetesnamespacename='abcdefg'",
                false,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost='gke-dev1' OR kubernetesnamespacename='ziox-dev'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost='gke-dev1' OR kubernetesnamespacename='abcdefg'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost='gke-dev2' OR kubernetesnamespacename='ziox-dev'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost='gke-dev2' OR kubernetesnamespacename='abcdefg'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost='gke-dev1' OR kuberneteshost='gke-dev2'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost IN ('gke-dev1')",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost IN ('gke-dev2')",
                false,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost IN ('gke-dev1', 'gke-dev2')",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost IN ('gke-dev1', 'gke-dev2') AND kubernetesnamespacename='ziox-dev'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost IN ('gke-dev1', 'gke-dev2') AND kubernetesnamespacename='abcdefg'",
                false,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost IN ('gke-dev1', 'gke-dev2') OR kubernetesnamespacename='ziox-dev'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost IN ('gke-dev1', 'gke-dev2') OR kubernetesnamespacename='abcdefg'",
                true,
            ),
            (
                "SELECT * FROM tbl WHERE kuberneteshost IN ('gke-dev1', 'gke-dev2') OR some_other_key='abcdefg'",
                true,
            ),
        ];
        for (tsql, expected) in sqls {
            let meta = sql::Sql::new(tsql).unwrap();
            let filter = super::sql::generate_filter_from_quick_text(&meta.quick_text);
            assert_eq!(filter_source_by_partition_key(path, &filter), expected);
        }
    }

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
                },
                false,
            ),
        ];
        let expected: Vec<Vec<i64>> = vec![
            vec![256, 256, 100],
            vec![256, 1, 256],
            vec![200, 30, 90, 256, 5, 150],
        ];
        let byte = partition_file_by_bytes(&vec, 3);
        for value in byte
            .iter()
            .map(|x| x.iter().map(|v| v.meta.original_size).collect::<Vec<i64>>())
            .enumerate()
        {
            assert_eq!(value.1, expected.get(value.0).unwrap().clone());
        }
    }
}
