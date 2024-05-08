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

use std::cmp::max;

use chrono::Duration;
use config::{
    ider,
    meta::{
        search,
        stream::{FileKey, StreamType},
    },
    utils::str::find,
    CONFIG,
};
use infra::{
    errors::{Error, ErrorCodes},
    schema::{unwrap_partition_time_level, unwrap_stream_settings},
};
use once_cell::sync::Lazy;
use opentelemetry::trace::TraceContextExt;
use proto::cluster_rpc;
use regex::Regex;
use tracing_opentelemetry::OpenTelemetrySpanExt;
#[cfg(feature = "enterprise")]
use {
    hashbrown::HashSet,
    o2_enterprise::enterprise::{common::infra::config::O2_CONFIG, search::TaskStatus},
    tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request},
    tracing::{info_span, Instrument},
};
#[cfg(not(feature = "enterprise"))]
use {std::sync::Arc, tokio::sync::Mutex};

use crate::{
    common::{infra::cluster as infra_cluster, meta::stream::StreamParams},
    handler::grpc::request::search::Searcher,
    service::format_partition_key,
};

pub(crate) mod cluster;
pub(crate) mod datafusion;
pub(crate) mod grpc;
pub(crate) mod sql;

pub static SEARCH_SERVER: Lazy<Searcher> = Lazy::new(Searcher::new);

#[cfg(not(feature = "enterprise"))]
pub(crate) static QUEUE_LOCKER: Lazy<Arc<Mutex<bool>>> =
    Lazy::new(|| Arc::new(Mutex::const_new(false)));

static RE_SELECT_WILDCARD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)select\s+\*\s+from").unwrap());

#[tracing::instrument(name = "service:search:enter", skip(req))]
pub async fn search(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    user_id: Option<String>,
    req: &search::Request,
) -> Result<search::Response, Error> {
    let trace_id = if trace_id.is_empty() {
        if CONFIG.common.tracing_enabled || CONFIG.common.tracing_search_enabled {
            let ctx = tracing::Span::current().context();
            ctx.span().span_context().trace_id().to_string()
        } else {
            ider::uuid()
        }
    } else {
        trace_id.to_string()
    };

    #[cfg(feature = "enterprise")]
    {
        let sql = Some(req.query.sql.clone());
        let start_time = Some(req.query.start_time);
        let end_time = Some(req.query.end_time);
        // set search task
        SEARCH_SERVER
            .insert(
                trace_id.clone(),
                TaskStatus::new(
                    vec![],
                    true,
                    user_id,
                    Some(org_id.to_string()),
                    Some(stream_type.to_string()),
                    sql,
                    start_time,
                    end_time,
                ),
            )
            .await;
    }

    #[cfg(feature = "enterprise")]
    let req_regions = req.regions.clone();
    #[cfg(feature = "enterprise")]
    let req_clusters = req.clusters.clone();
    #[cfg(feature = "enterprise")]
    let local_cluster_search = req_regions == vec!["local"]
        && !req_clusters.is_empty()
        && (req_clusters == vec!["local"] || req_clusters == vec![config::get_cluster_name()]);

    let mut req: cluster_rpc::SearchRequest = req.to_owned().into();
    req.job.as_mut().unwrap().trace_id = trace_id.clone();
    req.org_id = org_id.to_string();
    req.stype = cluster_rpc::SearchType::Cluster as _;
    req.stream_type = stream_type.to_string();

    let res = {
        #[cfg(feature = "enterprise")]
        if O2_CONFIG.super_cluster.enabled && !local_cluster_search {
            cluster::super_cluster::search(req, req_regions, req_clusters).await
        } else {
            cluster::http::search(req).await
        }
        #[cfg(not(feature = "enterprise"))]
        {
            cluster::http::search(req).await
        }
    };

    // remove task because task if finished
    #[cfg(feature = "enterprise")]
    SEARCH_SERVER.remove(&trace_id).await;

    // do this because of clippy warning
    match res {
        Ok(res) => Ok(res),
        Err(e) => Err(e),
    }
}

#[tracing::instrument(name = "service:search_partition:enter", skip(req))]
pub async fn search_partition(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    req: &search::SearchPartitionRequest,
) -> Result<search::SearchPartitionResponse, Error> {
    let query = cluster_rpc::SearchQuery {
        start_time: req.start_time,
        end_time: req.end_time,
        sql: req.sql.to_string(),
        sql_mode: req.sql_mode.to_string(),
        ..Default::default()
    };
    let search_req = cluster_rpc::SearchRequest {
        org_id: org_id.to_string(),
        stream_type: stream_type.to_string(),
        query: Some(query),
        ..Default::default()
    };
    let meta = sql::Sql::new(&search_req).await?;

    let stream_settings = unwrap_stream_settings(&meta.schema).unwrap_or_default();
    let partition_time_level =
        unwrap_partition_time_level(stream_settings.partition_time_level, stream_type);
    let files = cluster::get_file_list(
        trace_id,
        &meta,
        stream_type,
        partition_time_level,
        &stream_settings.partition_keys,
    )
    .await;

    let nodes = infra_cluster::get_cached_online_querier_nodes()
        .await
        .unwrap_or_default();
    if nodes.is_empty() {
        log::error!("no querier node online");
        return Err(Error::Message("no querier node online".to_string()));
    }
    let cpu_cores = nodes.iter().map(|n| n.cpu_num).sum::<u64>() as usize;
    if nodes.is_empty() {
        return Err(Error::Message("no querier node online".to_string()));
    }

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
        trace_id: trace_id.to_string(),
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
        Duration::try_seconds(CONFIG.limit.query_partition_min_secs)
            .unwrap()
            .num_microseconds()
            .unwrap(),
        (req.end_time - req.start_time) / part_num as i64,
    );
    // step must be times of minute
    step = step
        - step
            % Duration::try_minutes(1)
                .unwrap()
                .num_microseconds()
                .unwrap();

    // generate partitions
    let mut partitions = Vec::with_capacity(part_num);
    let mut end = req.end_time;
    while end > req.start_time {
        let start = max(end - step, req.start_time);
        partitions.push([start, end]);
        end = start;
    }
    if partitions.is_empty() {
        partitions.push([req.start_time, req.end_time]);
    }
    resp.partitions = partitions;
    Ok(resp)
}

#[cfg(feature = "enterprise")]
pub async fn query_status() -> Result<search::QueryStatusResponse, Error> {
    // get nodes from cluster
    let mut nodes = infra_cluster::get_cached_online_query_nodes()
        .await
        .unwrap();
    // sort nodes by node_id this will improve hit cache ratio
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);
    let nodes = nodes;

    // make cluster request
    let mut tasks = Vec::new();
    for node in nodes.iter().cloned() {
        let node_addr = node.grpc_addr.clone();
        let grpc_span = info_span!(
            "service:search:cluster:grpc_query_status",
            node_id = node.id,
            node_addr = node_addr.as_str(),
        );

        let task = tokio::task::spawn(
            async move {
                let mut request = tonic::Request::new(proto::cluster_rpc::QueryStatusRequest {});

                opentelemetry::global::get_text_map_propagator(|propagator| {
                    propagator.inject_context(
                        &tracing::Span::current().context(),
                        &mut MetadataMap(request.metadata_mut()),
                    )
                });

                let token: MetadataValue<_> = infra_cluster::get_internal_grpc_token()
                    .parse()
                    .map_err(|_| Error::Message("invalid token".to_string()))?;
                let channel = Channel::from_shared(node_addr)
                    .unwrap()
                    .connect_timeout(std::time::Duration::from_secs(CONFIG.grpc.connect_timeout))
                    .connect()
                    .await
                    .map_err(|err| {
                        log::error!(
                            "search->grpc: node: {}, connect err: {:?}",
                            &node.grpc_addr,
                            err
                        );
                        server_internal_error("connect search node error")
                    })?;
                let mut client = cluster_rpc::search_client::SearchClient::with_interceptor(
                    channel,
                    move |mut req: Request<()>| {
                        req.metadata_mut().insert("authorization", token.clone());
                        //  req.metadata_mut()
                        //      .insert(CONFIG.grpc.org_header_key.as_str(), org_id.clone());
                        Ok(req)
                    },
                );
                client = client
                    .send_compressed(CompressionEncoding::Gzip)
                    .accept_compressed(CompressionEncoding::Gzip)
                    .max_decoding_message_size(CONFIG.grpc.max_message_size * 1024 * 1024)
                    .max_encoding_message_size(CONFIG.grpc.max_message_size * 1024 * 1024);
                let response = match client.query_status(request).await {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!(
                            "search->grpc: node: {}, search err: {:?}",
                            &node.grpc_addr,
                            err
                        );
                        if err.code() == tonic::Code::Internal {
                            let err = ErrorCodes::from_json(err.message())?;
                            return Err(Error::ErrorCode(err));
                        }
                        return Err(server_internal_error("search node error"));
                    }
                };
                Ok(response)
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
                    return Err(err);
                }
            },
            Err(e) => {
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    e.to_string(),
                )));
            }
        }
    }

    let mut status = vec![];
    let mut set = HashSet::new();
    for result in results.into_iter().flat_map(|v| v.status.into_iter()) {
        if set.contains(&result.trace_id) {
            continue;
        } else {
            set.insert(result.trace_id.clone());
        }
        let query = result.query.as_ref().map(|query| search::QueryInfo {
            sql: query.sql.clone(),
            start_time: query.start_time,
            end_time: query.end_time,
        });
        let scan_stats = result
            .scan_stats
            .as_ref()
            .map(|scan_stats| search::ScanStats {
                files: scan_stats.files,
                records: scan_stats.records,
                original_size: scan_stats.original_size / 1024 / 1024, // change to MB
                compressed_size: scan_stats.compressed_size / 1024 / 1024, // change to MB
                querier_files: scan_stats.querier_files,
                querier_memory_cached_files: scan_stats.querier_memory_cached_files,
                querier_disk_cached_files: scan_stats.querier_disk_cached_files,
            });
        let query_status = if result.is_queue {
            "waiting"
        } else {
            "processing"
        };
        status.push(search::QueryStatus {
            trace_id: result.trace_id,
            created_at: result.created_at,
            started_at: result.started_at,
            status: query_status.to_string(),
            user_id: result.user_id,
            org_id: result.org_id,
            stream_type: result.stream_type,
            query,
            scan_stats,
        });
    }

    Ok(search::QueryStatusResponse { status })
}

#[cfg(feature = "enterprise")]
pub async fn cancel_query(trace_id: &str) -> Result<search::CancelQueryResponse, Error> {
    // get nodes from cluster
    let mut nodes = infra_cluster::get_cached_online_query_nodes()
        .await
        .unwrap();
    // sort nodes by node_id this will improve hit cache ratio
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);
    let nodes = nodes;

    // make cluster request
    let mut tasks = Vec::new();
    for node in nodes.iter().cloned() {
        let node_addr = node.grpc_addr.clone();
        let grpc_span = info_span!(
            "service:search:cluster:grpc_cancel_query",
            node_id = node.id,
            node_addr = node_addr.as_str(),
        );

        let trace_id = trace_id.to_string();
        let task = tokio::task::spawn(
            async move {
                let mut request =
                    tonic::Request::new(proto::cluster_rpc::CancelQueryRequest { trace_id });
                // request.set_timeout(Duration::from_secs(CONFIG.grpc.timeout));

                opentelemetry::global::get_text_map_propagator(|propagator| {
                    propagator.inject_context(
                        &tracing::Span::current().context(),
                        &mut MetadataMap(request.metadata_mut()),
                    )
                });

                let token: MetadataValue<_> = infra_cluster::get_internal_grpc_token()
                    .parse()
                    .map_err(|_| Error::Message("invalid token".to_string()))?;
                let channel = Channel::from_shared(node_addr)
                    .unwrap()
                    .connect_timeout(std::time::Duration::from_secs(CONFIG.grpc.connect_timeout))
                    .connect()
                    .await
                    .map_err(|err| {
                        log::error!(
                            "search->grpc: node: {}, connect err: {:?}",
                            &node.grpc_addr,
                            err
                        );
                        server_internal_error("connect search node error")
                    })?;
                let mut client = cluster_rpc::search_client::SearchClient::with_interceptor(
                    channel,
                    move |mut req: Request<()>| {
                        req.metadata_mut().insert("authorization", token.clone());
                        //  req.metadata_mut()
                        //      .insert(CONFIG.grpc.org_header_key.as_str(), org_id.clone());
                        Ok(req)
                    },
                );
                client = client
                    .send_compressed(CompressionEncoding::Gzip)
                    .accept_compressed(CompressionEncoding::Gzip)
                    .max_decoding_message_size(CONFIG.grpc.max_message_size * 1024 * 1024)
                    .max_encoding_message_size(CONFIG.grpc.max_message_size * 1024 * 1024);
                let response = match client.cancel_query(request).await {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!(
                            "search->grpc: node: {}, search err: {:?}",
                            &node.grpc_addr,
                            err
                        );
                        if err.code() == tonic::Code::Internal {
                            let err = ErrorCodes::from_json(err.message())?;
                            return Err(Error::ErrorCode(err));
                        }
                        return Err(server_internal_error("search node error"));
                    }
                };
                Ok(response)
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
                    return Err(err);
                }
            },
            Err(e) => {
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    e.to_string(),
                )));
            }
        }
    }

    let mut is_success = false;
    for res in results {
        if res.is_success {
            is_success = true;
            break;
        }
    }

    Ok(search::CancelQueryResponse {
        trace_id: trace_id.to_string(),
        is_success,
    })
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

pub fn server_internal_error(error: impl ToString) -> Error {
    Error::ErrorCode(ErrorCodes::ServerInternalError(error.to_string()))
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
        use config::meta::sql;
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
}
