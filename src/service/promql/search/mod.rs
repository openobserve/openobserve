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

use rustc_hash::FxHashMap;
use std::sync::Arc;
use std::{cmp::min, time::Duration};
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};
use tracing::{info_span, instrument, Instrument};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use uuid::Uuid;

use super::value::{InstantValue, Labels, Value};
use crate::handler::grpc::cluster_rpc;
use crate::infra::cluster::{self, get_internal_grpc_token};
use crate::infra::config::CONFIG;
use crate::infra::db::etcd;
use crate::infra::errors::{Error, ErrorCodes};
use crate::service::promql::value::*;

pub mod grpc;

pub async fn search(org_id: &str, req: &super::MetricsQueryRequest) -> Result<Value, Error> {
    let root_span = info_span!("service:promql:search:enter");
    let mut req: cluster_rpc::MetricsQueryRequest = req.to_owned().into();
    req.org_id = org_id.to_string();
    req.stype = cluster_rpc::SearchType::User as i32;
    search_in_cluster(req).instrument(root_span).await
}

#[inline(always)]
async fn get_queue_lock() -> Result<etcd::Locker, Error> {
    let mut lock = etcd::Locker::new("search/cluster_queue");
    lock.lock(0).await.map_err(server_internal_error)?;
    Ok(lock)
}

#[instrument(name = "service:promql:search:cluster", skip(req))]
async fn search_in_cluster(req: cluster_rpc::MetricsQueryRequest) -> Result<Value, Error> {
    let start = std::time::Instant::now();

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
        n => n as i64,
    };

    let is_range_query = req.query.as_ref().unwrap().is_range_query;
    let req_start: i64 = req.query.as_ref().unwrap().start;
    let req_end: i64 = req.query.as_ref().unwrap().end;
    let req_step: i64 = req.query.as_ref().unwrap().step;
    let point_num = if !is_range_query || req_start == req_end {
        1
    } else {
        (req_end - req_start) / req_step
    };
    let offset = if querier_num >= point_num {
        req_step
    } else {
        ((point_num / querier_num) + 1) * req_step
    };

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
    let mut offset_start = req_start;
    for (partition_no, node) in nodes.iter().cloned().enumerate() {
        let mut req = req.clone();
        let mut req_query = req.query.as_mut().unwrap();
        let mut job = job.clone();
        job.partition = partition_no as i32;
        req.job = Some(job);
        req.stype = cluster_rpc::SearchType::CacheOnly as i32;
        let is_querier = cluster::is_querier(&node.role);
        if is_querier {
            if offset_start <= req_end {
                req.stype = cluster_rpc::SearchType::Cluster as i32;
                req_query.start = offset_start;
                req_query.end = min(req_end, offset_start + offset);
                offset_start += offset;
            } else if !cluster::is_ingester(&node.role) {
                continue; // no need more querier
            }
        }
        log::info!(
            "[TRACE] promql->search->partition: node: {}, is_querier: {}, start: {}, end: {}",
            node.id,
            is_querier,
            req_query.start,
            req_query.end,
        );

        let grpc_span = info_span!("service:promql:search:cluster:grpc_search");

        let node_addr = node.grpc_addr.clone();
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

                let token: MetadataValue<_> = match  get_internal_grpc_token().parse() {
                    Ok(token) => token,
                    Err(_) => return Err(Error::Message("invalid token".to_string())),
                };
                let channel = match Channel::from_shared(node_addr).unwrap().connect().await {
                    Ok(channel) => channel,
                    Err(err) => {
                        log::error!(
                            "[TRACE] promql->search->grpc: node: {}, connect err: {:?}",
                            node.id,
                            err
                        );
                        return Err(server_internal_error("connect search node error"));
                    }
                };
                let mut client = cluster_rpc::metrics_client::MetricsClient::with_interceptor(
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
                let response: cluster_rpc::MetricsQueryResponse = match client.query(request).await {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!(
                            "[TRACE] promql->search->grpc: node: {}, search err: {:?}",
                            node.id,
                            err
                        );
                        if err.code() == tonic::Code::Internal {
                            let err = ErrorCodes::from_json(err.message())?;
                            return Err(Error::ErrorCode(err));
                        }
                        return Err(server_internal_error("search node error"));
                    }
                };

                log::info!(
                "[TRACE] promql->search->grpc: result node: {}, is_querier: {}, took: {}, files: {}",
                node.id,
                is_querier,
                response.took,
                response.file_count
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
    let mut result_type = String::new();
    let mut series_data: Vec<cluster_rpc::Series> = Vec::new();
    for resp in results {
        file_count += resp.file_count;
        scan_size += resp.scan_size;
        if result_type.is_empty() {
            result_type = resp.result_type.clone();
        }
        resp.result.into_iter().for_each(|series| {
            series_data.push(series);
        });
    }

    // merge result
    let values = if result_type == "matrix" {
        merge_matrix_query(&series_data)
    } else if result_type == "vector" {
        merge_vector_query(&series_data)
    } else if result_type == "scalar" {
        merge_scalar_query(&series_data)
    } else {
        return Err(server_internal_error("invalid result type"));
    };
    log::info!(
        "[TRACE] promql->search->result: took: {},  took_wait: {}, file_count: {}, scan_size: {}",
        start.elapsed().as_millis(),
        took_wait,
        file_count,
        scan_size,
    );

    Ok(values)
}

fn merge_matrix_query(series: &[cluster_rpc::Series]) -> Value {
    let mut merged_data = FxHashMap::default();
    let mut merged_metrics = FxHashMap::default();
    series.iter().for_each(|v| {
        let labels: Labels = v.metric.iter().map(|v| Arc::new(Label::from(v))).collect();
        let values: Vec<Sample> = v.values.iter().map(Sample::from).collect();
        merged_data
            .entry(signature(&labels))
            .or_insert_with(Vec::new)
            .extend(values);
        merged_metrics.insert(signature(&labels), labels);
    });
    let merged_data = merged_data
        .into_iter()
        .map(|(sig, values)| RangeValue {
            labels: merged_metrics.get(&sig).unwrap().to_owned(),
            values,
            time_range: None,
        })
        .collect::<Vec<_>>();

    // sort data
    let mut value = Value::Matrix(merged_data);
    value.sort();
    value
}

fn merge_vector_query(series: &[cluster_rpc::Series]) -> Value {
    let mut merged_data = FxHashMap::default();
    let mut merged_metrics: std::collections::HashMap<
        Signature,
        Vec<Arc<Label>>,
        std::hash::BuildHasherDefault<rustc_hash::FxHasher>,
    > = FxHashMap::default();
    series.iter().for_each(|v| {
        let labels: Labels = v.metric.iter().map(|v| Arc::new(Label::from(v))).collect();
        let value: Sample = v.value.as_ref().unwrap().into();
        merged_data.insert(signature(&labels), value);
        merged_metrics.insert(signature(&labels), labels);
    });
    let merged_data = merged_data
        .into_iter()
        .map(|(sig, value)| InstantValue {
            labels: merged_metrics.get(&sig).unwrap().to_owned(),
            value,
        })
        .collect::<Vec<_>>();

    // sort data
    let mut value = Value::Vector(merged_data);
    value.sort();
    value
}

fn merge_scalar_query(series: &[cluster_rpc::Series]) -> Value {
    let mut value: f64 = 0.0;
    series.iter().for_each(|v| {
        value = v.scalar.unwrap();
    });
    Value::Float(value)
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

fn server_internal_error(error: impl ToString) -> Error {
    Error::ErrorCode(ErrorCodes::ServerInternalError(error.to_string()))
}
