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

use std::{cmp::min, io::Cursor, sync::Arc};

use ::datafusion::arrow::{datatypes::Schema, ipc, json as arrow_json, record_batch::RecordBatch};
use ahash::AHashMap as HashMap;
use config::{
    meta::stream::{FileKey, NodeQueryAllocationStrategy, StreamType},
    CONFIG,
};
use once_cell::sync::Lazy;
use tokio::sync::Mutex;
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};
use tracing::{info_span, Instrument};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use vector_enrichment::TableRegistry;

use crate::{
    common::{
        infra::{
            cluster, dist_lock,
            errors::{Error, ErrorCodes},
        },
        meta::{
            functions::VRLResultResolver,
            search,
            stream::{PartitionTimeLevel, ScanStats, StreamParams},
        },
        utils::{flatten, json, str::find},
    },
    handler::grpc::cluster_rpc,
    service::{db, file_list, format_partition_key, stream},
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
        uuid::Uuid::new_v4().to_string()
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

#[tracing::instrument(skip(sql), fields(session_id = ?_session_id, org_id = sql.org_id, stream_name = sql.stream_name))]
async fn get_file_list(
    _session_id: &str,
    sql: &sql::Sql,
    stream_type: StreamType,
    time_level: PartitionTimeLevel,
) -> Vec<FileKey> {
    let is_local = CONFIG.common.meta_store_external
        || cluster::get_cached_online_querier_nodes()
            .unwrap_or_default()
            .len()
            <= 1;
    let (time_min, time_max) = get_times(sql, stream_type).await;
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
        if sql.match_source(&file, false, false, stream_type).await {
            files.push(file.to_owned());
        }
    }
    files.sort_by(|a, b| a.key.cmp(&b.key));
    files
}

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

    // get a cluster search queue lock
    let locker = dist_lock::lock("search/cluster_queue", 0).await?;
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

    // partition request, here plus 1 second, because division is integer, maybe
    // lose some precision
    let job = cluster_rpc::Job {
        session_id: session_id.clone(),
        job: session_id[0..6].to_string(), // take the frist 6 characters as job id
        stage: 0,
        partition: 0,
    };

    let stream_settings = stream::stream_settings(&meta.schema).unwrap_or_default();
    let partition_time_level =
        stream::unwrap_partition_time_level(stream_settings.partition_time_level, stream_type);

    let file_list = get_file_list(&session_id, &meta, stream_type, partition_time_level).await;
    let mut avg_files = None;
    let mut file_num = file_list.len();
    let offset =
        match NodeQueryAllocationStrategy::from(&CONFIG.common.node_query_allocation_strategy) {
            NodeQueryAllocationStrategy::FileSize => {
                if querier_num >= file_num {
                    1
                } else {
                    (file_num / querier_num) + 1
                }
            }
            NodeQueryAllocationStrategy::ByteSize => {
                avg_files = Some(avg_file_by_byte(&file_list[..], querier_num));
                file_num = avg_files.as_ref().unwrap().len();
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
        let is_querier = cluster::is_querier(&node.role);
        if is_querier {
            if offset_start < file_num {
                req.stype = cluster_rpc::SearchType::Cluster as i32;
                match NodeQueryAllocationStrategy::from(
                    &CONFIG.common.node_query_allocation_strategy,
                ) {
                    NodeQueryAllocationStrategy::FileSize => {
                        req.file_list = file_list
                            [offset_start..min(offset_start + offset, file_num)]
                            .to_vec()
                            .iter()
                            .map(cluster_rpc::FileKey::from)
                            .collect();
                        offset_start += offset;
                    }
                    NodeQueryAllocationStrategy::ByteSize => {
                        if let Some(ref temp_files) = avg_files {
                            req.file_list = temp_files
                                .get(offset_start)
                                .unwrap()
                                .iter()
                                .map(cluster_rpc::FileKey::from)
                                .collect();
                            offset_start += 1;
                        }
                    }
                };
            } else if !cluster::is_ingester(&node.role) {
                continue; // no need more querier
            }
        }

        let node_addr = node.grpc_addr.clone();
        let grpc_span = info_span!(
            "service:search:cluster:grpc_search",
            session_id,
            org_id = req.org_id
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
                    .accept_compressed(CompressionEncoding::Gzip);
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
                    "[session_id {session_id}] search->grpc: result node: {}, is_querier: {}, total: {}, took: {}, files: {}, scan_size: {}",
                    &node.grpc_addr,
                    is_querier,
                    response.total,
                    response.took,
                    response.scan_stats.as_ref().unwrap().files,
                    response.scan_stats.as_ref().unwrap().original_size,
                );
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
                    // search done, release lock
                    dist_lock::unlock(&locker).await?;
                    return Err(err);
                }
            },
            Err(e) => {
                // search done, release lock
                dist_lock::unlock(&locker).await?;
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    e.to_string(),
                )));
            }
        }
    }

    // search done, release lock
    dist_lock::unlock(&locker).await?;

    // merge multiple instances data
    let mut scan_stats = ScanStats::new();
    let mut batches: HashMap<String, Vec<RecordBatch>> = HashMap::new();
    let sql = Arc::new(meta);
    for resp in results {
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
            let value = batches.entry(format!("agg_{}", agg.name)).or_default();
            if !agg.hits.is_empty() {
                let buf = Cursor::new(agg.hits);
                let reader = ipc::reader::FileReader::try_new(buf, None).unwrap();
                let batch = reader.into_iter().map(Result::unwrap).collect::<Vec<_>>();
                value.extend(batch);
            }
        }
    }

    // merge all batches
    let mut merge_batches = HashMap::new();
    for (name, batch) in batches {
        let merge_sql = if name == "query" {
            sql.origin_sql.clone()
        } else {
            sql.aggs
                .get(name.strip_prefix("agg_").unwrap())
                .unwrap()
                .0
                .clone()
        };
        let batch = match datafusion::exec::merge(
            &sql.org_id,
            sql.meta.offset,
            sql.meta.limit,
            &merge_sql,
            &batch,
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
        merge_batches.insert(name, batch);
    }

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
                    Err(_) => None,
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

    result.set_total(total);
    result.set_cluster_took(start.elapsed().as_millis() as usize, took_wait);
    result.set_file_count(scan_stats.files as usize);
    result.set_scan_size(scan_stats.original_size as usize);

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

fn avg_file_by_byte(file_keys: &[FileKey], num_nodes: usize) -> Vec<Vec<FileKey>> {
    let mut partitions: Vec<Vec<FileKey>> = vec![Vec::new(); num_nodes];
    let mut file_keys = file_keys.to_owned();
    file_keys.sort_by_key(|x| x.meta.original_size);
    while let Some(fk) = file_keys.pop() {
        let current_node = partitions
            .iter_mut()
            .enumerate()
            .min_by_key(|(_, node)| node.iter().map(|k| k.meta.original_size).sum::<i64>())
            .unwrap()
            .0;
        partitions[current_node].push(fk.clone());
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
    filters: &[(&str, Vec<&str>)],
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
fn filter_source_by_partition_key(source: &str, filters: &[(&str, Vec<&str>)]) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_matches_by_partition_key_with_str() {
        let path = "files/default/logs/gke-fluentbit/2023/04/14/08/kuberneteshost=gke-dev1/kubernetesnamespacename=ziox-dev/7052558621820981249.parquet";
        let filters = vec![
            (vec![], true),
            (vec![("kuberneteshost", vec!["gke-dev1"])], true),
            (vec![("kuberneteshost", vec!["gke-dev2"])], false),
            (vec![("kuberneteshost", vec!["gke-dev1", "gke-dev2"])], true),
            (vec![("some_other_key", vec!["no-matter"])], true),
            (
                vec![
                    ("kuberneteshost", vec!["gke-dev1"]),
                    ("kubernetesnamespacename", vec!["ziox-dev"]),
                ],
                true,
            ),
            (
                vec![
                    ("kuberneteshost", vec!["gke-dev1"]),
                    ("kubernetesnamespacename", vec!["abcdefg"]),
                ],
                false,
            ),
            (
                vec![
                    ("kuberneteshost", vec!["gke-dev2"]),
                    ("kubernetesnamespacename", vec!["ziox-dev"]),
                ],
                false,
            ),
            (
                vec![
                    ("kuberneteshost", vec!["gke-dev2"]),
                    ("kubernetesnamespacename", vec!["abcdefg"]),
                ],
                false,
            ),
            (
                vec![
                    ("kuberneteshost", vec!["gke-dev1", "gke-dev2"]),
                    ("kubernetesnamespacename", vec!["ziox-dev"]),
                ],
                true,
            ),
            (
                vec![
                    ("kuberneteshost", vec!["gke-dev1", "gke-dev2"]),
                    ("kubernetesnamespacename", vec!["abcdefg"]),
                ],
                false,
            ),
            (
                vec![
                    ("kuberneteshost", vec!["gke-dev1", "gke-dev2"]),
                    ("some_other_key", vec!["no-matter"]),
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
    fn test_avg_file_by_byte() {
        use config::meta::stream::FileMeta;

        let mut vec = Vec::new();
        vec.push(FileKey::new(
            "",
            FileMeta {
                min_ts: -1,
                max_ts: -1,
                records: -1,
                original_size: 10,
                compressed_size: -1,
            },
            false,
        ));
        vec.push(FileKey::new(
            "",
            FileMeta {
                min_ts: -1,
                max_ts: -1,
                records: -1,
                original_size: 100,
                compressed_size: -1,
            },
            false,
        ));
        vec.push(FileKey::new(
            "",
            FileMeta {
                min_ts: -1,
                max_ts: -1,
                records: -1,
                original_size: 30,
                compressed_size: -1,
            },
            false,
        ));
        vec.push(FileKey::new(
            "",
            FileMeta {
                min_ts: -1,
                max_ts: -1,
                records: -1,
                original_size: 5,
                compressed_size: -1,
            },
            false,
        ));
        vec.push(FileKey::new(
            "",
            FileMeta {
                min_ts: -1,
                max_ts: -1,
                records: -1,
                original_size: 1,
                compressed_size: -1,
            },
            false,
        ));
        vec.push(FileKey::new(
            "",
            FileMeta {
                min_ts: -1,
                max_ts: -1,
                records: -1,
                original_size: 3,
                compressed_size: -1,
            },
            false,
        ));
        vec.push(FileKey::new(
            "",
            FileMeta {
                min_ts: -1,
                max_ts: -1,
                records: -1,
                original_size: 40,
                compressed_size: -1,
            },
            false,
        ));
        vec.push(FileKey::new(
            "",
            FileMeta {
                min_ts: -1,
                max_ts: -1,
                records: -1,
                original_size: 30,
                compressed_size: -1,
            },
            false,
        ));
        vec.push(FileKey::new(
            "",
            FileMeta {
                min_ts: -1,
                max_ts: -1,
                records: -1,
                original_size: 90,
                compressed_size: -1,
            },
            false,
        ));
        vec.push(FileKey::new(
            "",
            FileMeta {
                min_ts: -1,
                max_ts: -1,
                records: -1,
                original_size: 300,
                compressed_size: -1,
            },
            false,
        ));
        vec.push(FileKey::new(
            "",
            FileMeta {
                min_ts: -1,
                max_ts: -1,
                records: -1,
                original_size: 5,
                compressed_size: -1,
            },
            false,
        ));
        vec.push(FileKey::new(
            "",
            FileMeta {
                min_ts: -1,
                max_ts: -1,
                records: -1,
                original_size: 6,
                compressed_size: -1,
            },
            false,
        ));
        let expected: Vec<Vec<i64>> = vec![
            vec![300],
            vec![100, 30, 30],
            vec![90, 40, 10, 6, 5, 5, 3, 1],
        ];
        let byte = avg_file_by_byte(&vec[..], 3);
        for value in byte
            .iter()
            .map(|x| x.iter().map(|v| v.meta.original_size).collect::<Vec<i64>>())
            .enumerate()
        {
            assert_eq!(value.1, expected.get(value.0).unwrap().clone());
        }
    }
}
