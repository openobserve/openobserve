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
use datafusion_common::DataFusionError;
use http_auth_basic::Credentials;
use std::io::Cursor;
use std::sync::Arc;
use std::{cmp::min, time::Duration};
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};
use tracing::{info_span, Instrument};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use uuid::Uuid;

use crate::common::json;
use crate::handler::grpc::cluster_rpc;
use crate::infra::cluster;
use crate::infra::config::{CONFIG, ROOT_USER};
use crate::infra::db::etcd;
use crate::infra::errors::{Error, ErrorCodes};
use crate::meta;
use crate::meta::search::Response;
use crate::meta::StreamType;
use crate::service::{db, file_list};

mod cache;
pub mod datafusion;
pub mod exec;
pub mod sql;
mod storage;

pub type SearchResult = Result<(HashMap<String, Vec<RecordBatch>>, usize, usize), Error>;

pub async fn search(
    org_id: &str,
    stream_type: StreamType,
    req: &meta::search::Request,
) -> Result<Response, Error> {
    let root_span = info_span!("service:search:enter");

    let mut req: cluster_rpc::SearchRequest = req.to_owned().into();
    req.org_id = org_id.to_string();
    req.stype = cluster_rpc::SearchType::User as i32;
    req.stream_type = stream_type.to_string();

    let result = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .thread_name("zinc-search")
            .thread_stack_size(3 * 1024 * 1024)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async move { search_exec(req).instrument(root_span).await })
    })
    .join();
    result.map_err(|err| Error::ErrorCode(ErrorCodes::ServerInternalError(format!("{err:?}"))))?
}

#[tracing::instrument(name = "service:search:exec", skip(req))]
async fn search_exec(req: cluster_rpc::SearchRequest) -> Result<Response, Error> {
    let start = std::time::Instant::now();
    let span1 = info_span!("service:search:exec:get_queue_lock").entered();

    // get a cluster search queue lock
    let mut locker = None;
    if !CONFIG.common.local_mode {
        let mut lock = etcd::Locker::new("search/cluster_queue");
        match lock.lock(0).await {
            Ok(res) => res,
            Err(err) => {
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    err.to_string(),
                )));
            }
        };
        locker = Some(lock);
    }

    span1.exit(); // drop span1
    let span2 = info_span!("service:search:exec:prepare_base").entered();

    // get nodes from cluster
    let mut querier = Vec::new();
    let mut nodes = cluster::get_cached_online_query_nodes().unwrap();
    // sort nodes by node_id this will improve hit cache ratio
    nodes.sort_by(|a, b| a.id.cmp(&b.id));
    for node in nodes.iter() {
        let role = node.role.clone();
        if cluster::is_querier(&role.to_vec()) {
            querier.push(node.clone());
            continue;
        }
    }

    // handle request time range
    let stream_type: StreamType = StreamType::from(req.stream_type.as_str());
    let sub_req = req.clone();
    let meta = sql::Sql::new(&sub_req).await;
    if meta.is_err() {
        // search done, release lock
        if locker.is_some() {
            if let Err(e) = locker.unwrap().unlock().await {
                log::error!("search in cluster unlock error: {}", e);
            }
        }
        return Err(meta.err().unwrap());
    }
    let meta = meta.unwrap();

    let now = chrono::Utc::now().timestamp_micros();
    let (mut time_min, mut time_max) = meta.meta.time_range.unwrap();
    if time_min == 0 {
        // get created_at from schema
        let schema = match db::schema::get(&meta.org_id, &meta.stream_name, Some(stream_type)).await
        {
            Ok(schema) => schema,
            Err(_) => Schema::empty(),
        };
        if schema != Schema::empty() {
            let def_val = String::from("0");
            time_min = schema
                .metadata
                .get("created_at")
                .unwrap_or(&def_val)
                .parse::<i64>()
                .unwrap();
        }
    }
    if time_max == 0 {
        time_max = now;
    }
    let querier_num = match querier.len() {
        0 => 1,
        _ => querier.len(),
    };

    span2.exit(); // drop span2
    let span3 = info_span!("service:search:exec:prepare_filelist").entered();

    // partition by file_list
    let mut file_list = match file_list::get_file_list(
        &req.org_id,
        &meta.stream_name,
        Some(stream_type),
        time_min,
        time_max,
    )
    .await
    {
        Ok(file_list) => match (time_max - time_min) >= 3600_1000_1000 {
            true => {
                // over than 1 hour, just filter by partition key
                let mut files = Vec::with_capacity(file_list.len());
                for file in file_list {
                    if meta.filter_source_by_partition_key(&file).await {
                        files.push(file.clone());
                    }
                }
                files
            }
            false => {
                // less than 1 hour, use file meta reduce file list
                let mut files = Vec::with_capacity(file_list.len());
                for file in file_list {
                    if meta.match_source(&file, false, stream_type).await {
                        files.push(file.clone());
                    }
                }
                files
            }
        },
        Err(_) => Vec::new(),
    };
    file_list.sort();
    let file_num = file_list.len();
    let offset = match querier_num >= file_num {
        true => 1,
        false => (file_num / querier_num) + 1,
    };
    log::info!(
        "[TRACE] cluster->file_list: num: {}, offset: {}",
        file_num,
        offset
    );

    // partition request, here plus 1 second, because division is integer, maybe lose some precision
    let mut session_id = Uuid::new_v4().to_string();
    let job = cluster_rpc::Job {
        session_id: session_id.clone(),
        job: session_id.split_off(30), // take the last 6 characters as job id
        stage: 0,
        partition: 0,
    };

    span3.exit(); // drop span3
    let span4 = info_span!("service:search:exec:do_search").entered();

    // make grpc auth token
    let user = ROOT_USER.get("root").unwrap();
    let credentials = Credentials::new(&user.email, &user.token);
    let credentials = credentials.as_http_header();

    // make cluster request
    let mut results = Vec::new();
    let mut tasks = Vec::new();
    let mut offset_start: usize = 0;
    for (partition_no, node) in nodes.clone().into_iter().enumerate() {
        let mut req = req.clone();
        let mut job = job.clone();
        job.partition = partition_no as i32;
        req.job = Some(job);
        req.stype = cluster_rpc::SearchType::CacheOnly as i32;
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
        let mut req_file_list_start = 0;
        let mut req_file_list_end = 0;
        if !req.file_list.is_empty() {
            req_file_list_start = offset_start - offset;
            req_file_list_end = offset_start - offset + req.file_list.len();
        }
        log::info!(
            "[TRACE] cluster->partition: node: {}, is_querier: {}, file_range: {}-{}",
            node.id,
            is_querier,
            req_file_list_start,
            req_file_list_end,
        );

        let grpc_span = info_span!("service:search:exec:grpc_search");

        let node_addr = node.grpc_addr.clone();
        let credentials_str = credentials.clone();
        let task = tokio::task::spawn(
            async move {
                let org_id: MetadataValue<_> = match req.org_id.parse() {
                    Ok(org_id) => org_id,
                    Err(_) => return Err(Error::Message("invalid org_id".to_string())),
                };
                let mut request = tonic::Request::new(req);
                request.set_timeout(Duration::from_secs(CONFIG.grpc.timeout));

                opentelemetry::global::get_text_map_propagator(|propagator| {
                    propagator.inject_context(
                        &tracing::Span::current().context(),
                        &mut MetadataMap(request.metadata_mut()),
                    )
                });

                let token: MetadataValue<_> = match credentials_str.parse() {
                    Ok(token) => token,
                    Err(_) => return Err(Error::Message("invalid token".to_string())),
                };
                let channel = match Channel::from_shared(node_addr).unwrap().connect().await {
                    Ok(channel) => channel,
                    Err(err) => {
                        log::error!(
                            "[TRACE] cluster->search: node: {}, connect grpc err: {:?}",
                            node.id,
                            err
                        );
                        return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                            "connect search node error".to_string(),
                        )));
                    }
                };
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
                        log::error!(
                            "[TRACE] cluster->search: node: {}, search grpc err: {:?}",
                            node.id,
                            err
                        );
                        if err.code().eq(&tonic::Code::Internal) {
                            let err = ErrorCodes::from_json(err.message())?;
                            return Err(Error::ErrorCode(err));
                        }
                        return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                            "search node error".to_string(),
                        )));
                    }
                };

                log::info!(
                "[TRACE] cluster->search: node: {}, is_querier: {}, total: {}, took: {}, files: {}",
                node.id,
                is_querier,
                response.total,
                response.took,
                response.file_count
            );

                Ok(response)
            }
            .instrument(grpc_span),
        );
        tasks.push(task);
    }

    for task in tasks {
        let result = match task.await {
            Ok(res) => res,
            Err(err) => {
                return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                    err.to_string(),
                )));
            }
        };
        match result {
            Ok(res) => {
                results.push(res);
            }
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

    span4.exit(); // drop span4
    let span6 = info_span!("service:search:exec:release_queue_lock").entered();

    // search done, release lock
    if locker.is_some() {
        if let Err(e) = locker.unwrap().unlock().await {
            log::error!("search in cluster unlock error: {}", e);
        }
    }

    span6.exit(); // drop span6
    let span7 = info_span!("service:search:exec:merge_result").entered();

    // merge multiple instances data
    let mut file_count = 0;
    let mut scan_size = 0;
    let mut batches: HashMap<String, Vec<Vec<RecordBatch>>> = HashMap::new();
    let sql = Arc::new(meta);
    if !results.is_empty() {
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
        }

        // merge all batches
        for (name, batch) in batches.iter_mut() {
            let merge_sql = if name.eq("query") {
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

    span7.exit(); // drop span7
    let _span8 = info_span!("service:search:exec:response").entered();

    // final result
    let mut result = Response::new(sql.meta.offset, sql.meta.limit);

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
        if query_type.eq("metrics") {
            sources = handle_metrics_response(sources);
        }

        for source in sources {
            result.add_hit(&source);
        }
    }

    // aggs
    for (name, batch) in batches {
        if name.eq("query") || batch.is_empty() {
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
    result.set_took(start.elapsed().as_millis() as usize);
    result.set_file_count(file_count as usize);
    result.set_scan_size(scan_size as usize);

    if query_type.eq("metrics") {
        result.response_type = "matrix".to_string();
    }

    log::info!(
        "[TRACE] cluster->search: total: {}, took: {}, scan_size: {}",
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
            if !k.eq(&CONFIG.common.time_stamp_col) && !k.eq("value") {
                key.push(format!("{k}_{v}"));
            }
        });
        let key = key.join("_");
        if !results_metrics.contains_key(&key) {
            let mut fields = fields.clone();
            fields.remove(&CONFIG.common.time_stamp_col);
            fields.remove("value");
            results_metrics.insert(key.clone(), json::Value::Object(fields));
        }
        let entry = results_values.entry(key).or_default();
        let value = [
            fields
                .get(&CONFIG.common.time_stamp_col)
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

pub fn handle_datafusion_error(err: DataFusionError) -> Error {
    let err = err.to_string();
    if err.contains("Schema error: No field named") {
        let pos = err.find("Schema error: No field named").unwrap();
        return match get_key_from_error(&err, pos) {
            Some(key) => Error::ErrorCode(ErrorCodes::SearchFieldNotFound(key)),
            None => Error::ErrorCode(ErrorCodes::SearchSQLExecuteError(err)),
        };
    }
    if err.contains("parquet not found") {
        return Error::ErrorCode(ErrorCodes::SearchParquetFileNotFound);
    }
    if err.contains("Invalid function ") {
        let pos = err.find("Invalid function ").unwrap();
        return match get_key_from_error(&err, pos) {
            Some(key) => Error::ErrorCode(ErrorCodes::SearchFunctionNotDefined(key)),
            None => Error::ErrorCode(ErrorCodes::SearchSQLExecuteError(err)),
        };
    }
    if err.contains("Incompatible data types") {
        let pos = err.find("for field").unwrap();
        let pos_start = err[pos..].find(' ').unwrap();
        let pos_end = err[pos + pos_start + 1..].find('.').unwrap();
        let field = err[pos + pos_start + 1..pos + pos_start + 1 + pos_end].to_string();
        return Error::ErrorCode(ErrorCodes::SearchFieldHasNoCompatibleDataType(field));
    }
    Error::ErrorCode(ErrorCodes::SearchSQLExecuteError(err))
}

fn get_key_from_error(err: &str, pos: usize) -> Option<String> {
    for ponct in ['\'', '"'] {
        let pos_start = err[pos..].find(ponct);
        if pos_start.is_none() {
            continue;
        }
        let pos_start = pos_start.unwrap();
        let pos_end = err[pos + pos_start + 1..].find(ponct);
        if pos_end.is_none() {
            continue;
        }
        let pos_end = pos_end.unwrap();
        return Some(err[pos + pos_start + 1..pos + pos_start + 1 + pos_end].to_string());
    }
    None
}

struct MetadataMap<'a>(&'a mut tonic::metadata::MetadataMap);

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
