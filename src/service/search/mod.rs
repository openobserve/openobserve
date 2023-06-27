// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ::datafusion::arrow::{datatypes::Schema, ipc, json as arrow_json, record_batch::RecordBatch};
use ahash::AHashMap as HashMap;
use once_cell::sync::Lazy;
use std::{cmp::min, io::Cursor, sync::Arc, time::Duration};
use tokio::sync::Mutex;
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};
use tracing::{info_span, Instrument};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use uuid::Uuid;

use crate::common::{flatten, json, str::find};
use crate::handler::grpc::cluster_rpc;
use crate::infra::{
    cluster,
    config::CONFIG,
    db::etcd,
    errors::{Error, ErrorCodes},
};
use crate::meta::{search, stream::StreamParams, StreamType};
use crate::service::{db, file_list};

use super::get_partition_key_query;

pub(crate) mod datafusion;
pub(crate) mod grpc;
pub(crate) mod sql;

pub(crate) static QUEUE_LOCKER: Lazy<Arc<Mutex<bool>>> =
    Lazy::new(|| Arc::new(Mutex::const_new(false)));

#[tracing::instrument(name = "service:search:enter", skip_all)]
pub async fn search(
    org_id: &str,
    stream_type: StreamType,
    req: &search::Request,
) -> Result<search::Response, Error> {
    let mut req: cluster_rpc::SearchRequest = req.to_owned().into();
    req.org_id = org_id.to_string();
    req.stype = cluster_rpc::SearchType::User as i32;
    req.stream_type = stream_type.to_string();
    tokio::task::spawn(async move { search_in_cluster(req).await })
        .await
        .map_err(server_internal_error)?
}

#[inline(always)]
async fn get_queue_lock() -> Result<etcd::Locker, Error> {
    let mut lock = etcd::Locker::new("search/cluster_queue");
    lock.lock(0).await.map_err(server_internal_error)?;
    Ok(lock)
}

async fn get_times(sql: &sql::Sql, stream_type: StreamType) -> (i64, i64) {
    let (mut time_min, mut time_max) = sql.meta.time_range.unwrap();
    if time_min == 0 {
        // get created_at from schema
        let schema = db::schema::get(&sql.org_id, &sql.stream_name, stream_type)
            .await
            .unwrap_or_else(|_| Schema::empty());
        if schema != Schema::empty() {
            time_min = schema
                .metadata
                .get("created_at")
                .map_or(0, |v| v.parse::<i64>().unwrap_or(0));
        }
    }
    if time_max == 0 {
        time_max = chrono::Utc::now().timestamp_micros();
    }
    (time_min, time_max)
}

#[tracing::instrument(skip_all)]
async fn get_file_list(sql: &sql::Sql, stream_type: StreamType) -> Vec<String> {
    let (time_min, time_max) = get_times(sql, stream_type).await;
    match file_list::get_file_list(
        &sql.org_id,
        &sql.stream_name,
        stream_type,
        time_min,
        time_max,
    ) {
        Err(_) => vec![],
        Ok(file_list) => {
            let mut files = Vec::with_capacity(file_list.len());
            for file in file_list {
                if sql.match_source(&file, false, false, stream_type).await {
                    files.push(file.clone());
                }
            }
            files.sort();
            files
        }
    }
}

#[tracing::instrument(name = "service:search:cluster", skip_all)]
async fn search_in_cluster(req: cluster_rpc::SearchRequest) -> Result<search::Response, Error> {
    let start = std::time::Instant::now();

    // handle request time range
    let stream_type = StreamType::from(req.stream_type.as_str());
    let meta = sql::Sql::new(&req).await?;

    // get a cluster search queue lock
    let locker = if CONFIG.common.local_mode {
        None
    } else {
        Some(get_queue_lock().await?)
    };
    let took_wait = start.elapsed().as_millis() as usize;

    // get nodes from cluster
    let mut nodes = cluster::get_cached_online_query_nodes().unwrap();
    // sort nodes by node_id this will improve hit cache ratio
    nodes.sort_by_key(|x| x.id);
    let nodes = nodes;

    let querier_num = match nodes
        .iter()
        .filter(|node| cluster::is_querier(&node.role))
        .count()
    {
        0 => 1,
        n => n,
    };

    let file_list = get_file_list(&meta, stream_type).await;
    let file_num = file_list.len();
    let offset = if querier_num >= file_num {
        1
    } else {
        (file_num / querier_num) + 1
    };
    log::info!("search->file_list: num: {file_num}, offset: {offset}");

    // partition request, here plus 1 second, because division is integer, maybe lose some precision
    let mut session_id = Uuid::new_v4().to_string();
    let job = cluster_rpc::Job {
        session_id: session_id.clone(),
        job: session_id.split_off(30), // take the last 6 characters as job id
        stage: 0,
        partition: 0,
    };

    // make cluster request
    let mut tasks = Vec::new();
    let mut offset_start: usize = 0;
    for (partition_no, node) in nodes.iter().cloned().enumerate() {
        let mut req = req.clone();
        let mut job = job.clone();
        job.partition = partition_no as i32;
        req.job = Some(job);
        req.stype = cluster_rpc::SearchType::WalOnly as i32;
        let is_querier = cluster::is_querier(&node.role);
        if is_querier {
            if offset_start < file_num {
                req.stype = cluster_rpc::SearchType::Cluster as i32;
                req.file_list =
                    file_list[offset_start..min(offset_start + offset, file_num)].to_vec();
                offset_start += offset;
            } else if !cluster::is_ingester(&node.role) {
                continue; // no need more querier
            }
        }

        let node_addr = node.grpc_addr.clone();
        let grpc_span = info_span!("service:search:cluster:grpc_search");
        let task = tokio::task::spawn(
            async move {
                let org_id: MetadataValue<_> = req
                    .org_id
                    .parse()
                    .map_err(|_| Error::Message("invalid org_id".to_string()))?;
                let mut request = tonic::Request::new(req);
                request.set_timeout(Duration::from_secs(CONFIG.grpc.timeout));

                opentelemetry::global::get_text_map_propagator(|propagator| {
                    propagator.inject_context(
                        &tracing::Span::current().context(),
                        &mut MetadataMap(request.metadata_mut()),
                    )
                });

                let token: MetadataValue<_> = cluster::get_internal_grpc_token()
                    .parse()
                    .map_err(|_| Error::Message("invalid token".to_string()))?;
                let channel = Channel::from_shared(node_addr)
                    .unwrap()
                    .connect()
                    .await
                    .map_err(|err| {
                        log::error!("search->grpc: node: {}, connect err: {:?}", node.id, err);
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
                    .accept_compressed(CompressionEncoding::Gzip);
                let response: cluster_rpc::SearchResponse = match client.search(request).await {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!("search->grpc: node: {}, search err: {:?}", node.id, err);
                        if err.code() == tonic::Code::Internal {
                            let err = ErrorCodes::from_json(err.message())?;
                            return Err(Error::ErrorCode(err));
                        }
                        return Err(server_internal_error("search node error"));
                    }
                };

                log::info!(
                    "search->grpc: result node: {}, is_querier: {}, total: {}, took: {}, files: {}, scan_size: {}",
                    node.id,
                    is_querier,
                    response.total,
                    response.took,
                    response.file_count,
                    response.scan_size
                );
                Ok(response)
            }
            .instrument(grpc_span),
        );
        tasks.push(task);
    }

    let mut results = Vec::new();
    for task in tasks {
        let result = task
            .await
            .map_err(|err| Error::ErrorCode(ErrorCodes::ServerInternalError(err.to_string())))?;
        match result {
            Ok(res) => results.push(res),
            Err(err) => {
                // search done, release lock
                if locker.is_some() {
                    if let Err(e) = locker.unwrap().unlock().await {
                        log::error!("search in cluster unlock error: {}", e);
                    }
                }
                return Err(err);
            }
        }
    }
    // search done, release lock
    if locker.is_some() {
        if let Err(e) = locker.unwrap().unlock().await {
            log::error!("search in cluster unlock error: {}", e);
        }
    }
    // merge multiple instances data
    let mut file_count = 0;
    let mut scan_size = 0;
    let mut batches: HashMap<String, Vec<Vec<RecordBatch>>> = HashMap::new();
    let sql = Arc::new(meta);
    for resp in results {
        file_count += resp.file_count;
        scan_size += resp.scan_size;
        // handle hits
        let value = batches.entry("query".to_string()).or_default();
        if !resp.hits.is_empty() {
            let buf = Cursor::new(resp.hits);
            let reader = ipc::reader::FileReader::try_new(buf, None).unwrap();
            log::info!(
                "search_in_cluster: query num_batches: {:?}",
                reader.num_batches()
            );
            let batch = reader.into_iter().map(Result::unwrap).collect::<Vec<_>>();
            value.push(batch);
        }
        // handle aggs
        for agg in resp.aggs {
            let value = batches.entry(format!("agg_{}", agg.name)).or_default();
            if !agg.hits.is_empty() {
                let buf = Cursor::new(agg.hits);
                let reader = ipc::reader::FileReader::try_new(buf, None).unwrap();
                log::info!(
                    "search_in_cluster: agg:{} num_batches: {:?}",
                    agg.name,
                    reader.num_batches()
                );
                let batch = reader.into_iter().map(Result::unwrap).collect::<Vec<_>>();
                value.push(batch);
            }
        }

        // merge all batches
        for (name, batch) in batches.iter_mut() {
            let merge_sql = if name == "query" {
                sql.origin_sql.clone()
            } else {
                sql.aggs
                    .get(name.strip_prefix("agg_").unwrap())
                    .unwrap()
                    .0
                    .clone()
            };
            *batch = match datafusion::exec::merge(
                &sql.org_id,
                sql.meta.offset,
                sql.meta.limit,
                &merge_sql,
                batch,
            )
            .await
            {
                Ok(res) => res,
                Err(err) => {
                    return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                        err.to_string(),
                    )));
                }
            };
        }
    }

    // final result
    let mut result = search::Response::new(sql.meta.offset, sql.meta.limit);

    // hits
    let query_type = req.query.as_ref().unwrap().query_type.to_lowercase();
    let batches_query = match batches.get("query") {
        Some(batches) => batches.to_owned(),
        None => Vec::new(),
    };
    if !batches_query.is_empty() {
        let json_rows = match arrow_json::writer::record_batches_to_json_rows(&batches_query[0][..])
        {
            Ok(res) => res,
            Err(err) => {
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    err.to_string(),
                )))
            }
        };
        let mut sources: Vec<json::Value> =
            json_rows.into_iter().map(json::Value::Object).collect();

        // handle metrics response
        if query_type == "metrics" {
            sources = handle_metrics_response(sources);
        }

        if sql.uses_zo_fn {
            for source in sources {
                result.add_hit(&flatten::flatten(&source).unwrap());
            }
        } else {
            for source in sources {
                result.add_hit(&source);
            }
        }
    }

    // aggs
    for (name, batch) in batches {
        if name == "query" || batch.is_empty() {
            continue;
        }
        let name = name.strip_prefix("agg_").unwrap().to_string();
        let json_rows = match arrow_json::writer::record_batches_to_json_rows(&batch[0][..]) {
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
        Some(v) => v.get(0).unwrap().get("num").unwrap().as_u64().unwrap() as usize,
        None => result.hits.len(),
    };
    result.aggs.remove("_count");

    result.set_total(total);
    result.set_cluster_took(start.elapsed().as_millis() as usize, took_wait);
    result.set_file_count(file_count as usize);
    result.set_scan_size(scan_size as usize);

    if query_type == "metrics" {
        result.response_type = "matrix".to_string();
    }

    log::info!(
        "search->result: total: {}, took: {}, scan_size: {}",
        result.total,
        result.took,
        result.scan_size,
    );

    Ok(result)
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
pub fn match_source(
    stream: StreamParams<'_>,
    time_range: Option<(i64, i64)>,
    filters: &[(&str, &str)],
    source: &str,
    is_wal: bool,
    match_min_ts_only: bool,
) -> bool {
    let StreamParams {
        org_id,
        stream_name,
        stream_type,
    } = stream;

    // match org_id & table
    if !source.starts_with(format!("files/{}/{}/{}/", org_id, stream_type, stream_name).as_str()) {
        return false;
    }

    // check partition key
    if !filter_source_by_partition_key(source, filters) {
        return false;
    }

    if is_wal {
        return true;
    }

    // check time range
    let file_meta = file_list::get_file_meta(source).unwrap_or_default();
    if file_meta.min_ts == 0 || file_meta.max_ts == 0 {
        return true;
    }
    log::trace!(
        "time range: {:?}, file time: {}-{}, {}",
        time_range,
        file_meta.min_ts,
        file_meta.max_ts,
        source
    );

    // match partition clause
    if let Some((time_min, time_max)) = time_range {
        if match_min_ts_only && time_min > 0 {
            return file_meta.min_ts >= time_min && file_meta.min_ts < time_max;
        }
        if time_min > 0 && time_min > file_meta.max_ts {
            return false;
        }
        if time_max > 0 && time_max < file_meta.min_ts {
            return false;
        }
    }
    true
}

fn filter_source_by_partition_key(source: &str, filters: &[(&str, &str)]) -> bool {
    !filters.iter().any(|(k, v)| {
        let field = get_partition_key_query(&format!("{k}="));
        let value = get_partition_key_query(&format!("{k}={v}"));
        find(source, &format!("/{field}")) && !find(source, &format!("/{value}/"))
    })
}

pub struct MetadataMap<'a>(pub &'a mut tonic::metadata::MetadataMap);

impl<'a> opentelemetry::propagation::Injector for MetadataMap<'a> {
    /// Set a key and value in the MetadataMap.  Does nothing if the key or value are not valid inputs
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matches_by_partition_key() {
        let path = "files/default/logs/gke-fluentbit/2023/04/14/08/kubernetes_host=gke-dev1/kubernetes_namespace_name=ziox-qqx/7052558621820981249.parquet";
        assert!(filter_source_by_partition_key(path, &[]));
        assert!(!filter_source_by_partition_key(
            path,
            &vec![("kubernetes_host", "")]
        ));
        assert!(filter_source_by_partition_key(
            path,
            &vec![("kubernetes_host", "gke-dev1")]
        ));
        assert!(!filter_source_by_partition_key(
            &path,
            &vec![("kubernetes_host", "gke-dev2")]
        ));
        assert!(
            filter_source_by_partition_key(path, &vec![("some_other_key", "no-matter")]),
            "Partition key was not found ==> the Parquet file has to be searched"
        );
        assert!(filter_source_by_partition_key(
            path,
            &vec![
                ("kubernetes_host", "gke-dev1"),
                ("kubernetes_namespace_name", "ziox-qqx")
            ],
        ));
        assert!(!filter_source_by_partition_key(
            path,
            &vec![
                ("kubernetes_host", "gke-dev1"),
                ("kubernetes_namespace_name", "abcdefg")
            ],
        ));
        assert!(!filter_source_by_partition_key(
            path,
            &vec![
                ("kubernetes_host", "gke-dev2"),
                ("kubernetes_namespace_name", "ziox-qqx")
            ],
        ));
        assert!(!filter_source_by_partition_key(
            path,
            &vec![
                ("kubernetes_host", "gke-dev2"),
                ("kubernetes_namespace_name", "abcdefg")
            ],
        ));
        assert!(filter_source_by_partition_key(
            path,
            &vec![
                ("kubernetes_host", "gke-dev1"),
                ("some_other_key", "no-matter")
            ],
        ));
        assert!(!filter_source_by_partition_key(
            path,
            &vec![
                ("kubernetes_host", "gke-dev2"),
                ("some_other_key", "no-matter")
            ],
        ));
    }
}
