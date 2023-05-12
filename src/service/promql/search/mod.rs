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

use std::{cmp::min, sync::Arc, time::Duration};

use rustc_hash::FxHashMap;
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};
use tracing::{info_span, instrument, Instrument};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use uuid::Uuid;

use crate::handler::grpc::cluster_rpc::{self, SearchType};
use crate::infra::cluster::{self, get_internal_grpc_token};
use crate::infra::config::CONFIG;
use crate::infra::db::etcd;
use crate::infra::errors::{Error, ErrorCodes, Result};
use crate::service::promql::value::*;

pub mod grpc;

pub async fn search(org_id: &str, req: &super::MetricsQueryRequest) -> Result<Value> {
    let root_span = info_span!("service:promql:search:enter");
    let mut req: cluster_rpc::MetricsQueryRequest = req.to_owned().into();
    req.org_id = org_id.to_string();
    req.stype = SearchType::User as _;
    search_in_cluster(req).instrument(root_span).await
}

#[inline(always)]
async fn get_queue_lock() -> Result<etcd::Locker> {
    let mut lock = etcd::Locker::new("search/cluster_queue");
    lock.lock(0).await.map_err(server_internal_error)?;
    Ok(lock)
}

#[instrument(name = "service:promql:search:cluster", skip(req))]
async fn search_in_cluster(req: cluster_rpc::MetricsQueryRequest) -> Result<Value> {
    let op_start = std::time::Instant::now();

    // get a cluster search queue lock
    let locker = if CONFIG.common.local_mode {
        None
    } else {
        Some(get_queue_lock().await?)
    };
    let took_wait = op_start.elapsed().as_millis() as usize;

    // get nodes from cluster
    let mut nodes = cluster::get_cached_online_query_nodes().unwrap();
    // sort nodes by node_id this will improve hit cache ratio
    nodes.sort_by_key(|x| x.id);
    let nodes = nodes;

    let nr_queriers = match nodes
        .iter()
        .filter(|node| cluster::is_querier(&node.role))
        .count()
    {
        0 => 1,
        n => n as i64,
    };

    let &cluster_rpc::MetricsQueryStmt {
        query: _,
        is_range_query,
        start,
        end,
        step,
    } = req.query.as_ref().unwrap();

    // The number of resolution steps; see the diagram at
    // https://promlabs.com/blog/2020/06/18/the-anatomy-of-a-promql-query/#range-queries
    let nr_steps = if !is_range_query || start == end {
        1
    } else {
        (end - start) / step
    };
    // A span of time covered by an individual querier (worker).
    let worker_dt = if nr_steps > nr_queriers {
        step * ((nr_steps / nr_queriers) + 1)
    } else {
        step
    };

    // partition request, here plus 1 second, because division is integer, maybe lose some precision
    // XXX-REFACTORME: move this into a function
    let session_id = Uuid::new_v4().to_string();
    let job_id = session_id[30..].to_string(); // take the last 6 characters as job id
    let job = cluster_rpc::Job {
        session_id,
        job: job_id,
        stage: 0,
        partition: 0,
    };

    // make cluster request
    let mut tasks = Vec::new();
    let mut worker_start = start;
    for (partition_no, node) in nodes.iter().cloned().enumerate() {
        let job = Some(cluster_rpc::Job {
            partition: partition_no as _,
            ..job.clone()
        });
        let mut req = cluster_rpc::MetricsQueryRequest {
            job,
            stype: SearchType::CacheOnly as _,
            ..req.clone()
        };
        let mut req_query = req.query.as_mut().unwrap();
        let is_querier = cluster::is_querier(&node.role);
        if is_querier {
            if worker_start <= end {
                req.stype = SearchType::Cluster as _;
                req_query.start = worker_start;
                req_query.end = min(end, worker_start + worker_dt);
                worker_start += worker_dt;
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
                let org_id: MetadataValue<_> = req.org_id.parse().map_err(|_| {
                    Error::Message(format!("invalid org_id: {}", req.org_id))
                })?;
                let mut request = tonic::Request::new(req);
                request.set_timeout(Duration::from_secs(CONFIG.grpc.timeout));

                opentelemetry::global::get_text_map_propagator(|propagator| {
                    propagator.inject_context(
                        &tracing::Span::current().context(),
                        &mut MetadataMap(request.metadata_mut()),
                    )
                });

                let token: MetadataValue<_> = get_internal_grpc_token().parse().map_err(|_| {
                    Error::Message("invalid token".to_string())
                })?;
                let channel = Channel::from_shared(node_addr).unwrap().connect().await.map_err(|err| {
                    log::error!("[TRACE] promql->search->grpc: node: {}, connect err: {:?}", node.id, err);
                    server_internal_error("connect search node error")
                })?;
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
        // XXX-OPTIMIZE: use [`futures::future::try_join_all`]
        //
        // [`futures::future::try_join_all`]: https://docs.rs/futures/0.3.28/futures/future/fn.try_join_all.html
        let res = match task.await {
            Err(task_err) => Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                task_err.to_string(),
            ))),
            Ok(Err(err)) => Err(err),
            Ok(Ok(res)) => {
                results.push(res);
                Ok(())
            }
        };
        if let Err(err) = res {
            if locker.is_some() {
                if let Err(e) = locker.unwrap().unlock().await {
                    log::error!("search in cluster unlock error: {}", e);
                }
            }
            return Err(err);
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
        op_start.elapsed().as_millis(),
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
    let mut sample: Sample = Default::default();
    series.iter().for_each(|v| {
        if v.scalar.is_some() {
            sample.value = v.scalar.unwrap();
        }
        if v.value.is_some() {
            sample = v.value.as_ref().unwrap().into();
        }
    });
    Value::Sample(sample)
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
