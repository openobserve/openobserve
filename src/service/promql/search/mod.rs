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

use ahash::AHashMap as HashMap;
use futures::future::try_join_all;
use std::{
    cmp::{max, min},
    sync::Arc,
    time::Duration,
};
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};
use tracing::{info_span, Instrument};
use tracing_opentelemetry::OpenTelemetrySpanExt;
use uuid::Uuid;

use crate::{
    handler::grpc::cluster_rpc,
    meta::{stream::ScanStats, usage::RequestStats},
    service::usage::report_usage_stats,
};
use crate::{
    infra::{
        cluster,
        config::CONFIG,
        errors::{Error, ErrorCodes, Result},
    },
    meta::StreamType,
};
use crate::{
    meta::usage::UsageType,
    service::{
        promql::{micros, value::*, MetricsQueryRequest, DEFAULT_LOOKBACK},
        search::{server_internal_error, MetadataMap},
    },
};

pub mod grpc;

#[tracing::instrument(skip_all)]
pub async fn search(org_id: &str, req: &MetricsQueryRequest) -> Result<Value> {
    let mut req: cluster_rpc::MetricsQueryRequest = req.to_owned().into();
    req.org_id = org_id.to_string();
    req.stype = cluster_rpc::SearchType::User as _;
    search_in_cluster(req).await
}

#[tracing::instrument(name = "promql:search:cluster", skip_all)]
async fn search_in_cluster(req: cluster_rpc::MetricsQueryRequest) -> Result<Value> {
    let op_start = std::time::Instant::now();

    // get querier nodes from cluster
    let mut nodes = cluster::get_cached_online_querier_nodes().unwrap();
    // sort nodes by node_id this will improve hit cache ratio
    nodes.sort_by_key(|x| x.id);
    let nodes = nodes;
    if nodes.is_empty() {
        return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
            "no querier node found".to_string(),
        )));
    }
    let nr_queriers = nodes.len() as i64;

    let &cluster_rpc::MetricsQueryStmt {
        query: _,
        start,
        end,
        step,
    } = req.query.as_ref().unwrap();

    // The number of resolution steps; see the diagram at
    // https://promlabs.com/blog/2020/06/18/the-anatomy-of-a-promql-query/#range-queries
    let step = max(micros(DEFAULT_LOOKBACK), step);
    let nr_steps = match (end - start) / step {
        0 => 1,
        n => n,
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
    for node in nodes.iter() {
        let node = node.clone();
        if worker_start > end {
            break;
        }
        let job = Some(cluster_rpc::Job {
            partition: node.id as _,
            ..job.clone()
        });
        let mut req = cluster_rpc::MetricsQueryRequest {
            job,
            stype: cluster_rpc::SearchType::Cluster as _,
            ..req.clone()
        };
        let req_query = req.query.as_mut().unwrap();
        req_query.start = worker_start;
        req_query.end = min(end, worker_start + worker_dt);
        if req_query.end == end {
            req.need_wal = true;
        }
        let req_need_wal = req.need_wal;
        worker_start += worker_dt;

        log::info!(
            "promql->search->partition: node: {}, need_wal: {}, start: {}, end: {}",
            node.id,
            req_need_wal,
            req_query.start,
            req_query.end,
        );

        let node_addr = node.grpc_addr.clone();
        let grpc_span = info_span!("promql:search:cluster:grpc_search");
        let task = tokio::task::spawn(
            async move {
                let org_id: MetadataValue<_> = req
                    .org_id
                    .parse()
                    .map_err(|_| Error::Message(format!("invalid org_id: {}", req.org_id)))?;
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
                        log::error!(
                            "promql->search->grpc: node: {}, connect err: {:?}",
                            node.id,
                            err
                        );
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
                let response: cluster_rpc::MetricsQueryResponse = match client.query(request).await
                {
                    Ok(res) => res.into_inner(),
                    Err(err) => {
                        log::error!(
                            "promql->search->grpc: node: {}, search err: {:?}",
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
                let scan_stats = response.scan_stats.as_ref().unwrap();

                log::info!(
                    "promql->search->grpc: result node: {}, need_wal: {}, took: {}, files: {}, scan_size: {}",
                    node.id,
                    req_need_wal,
                    response.took,
                    scan_stats.files,
                    scan_stats.original_size,
                );
                Ok(response)
            }
            .instrument(grpc_span),
        );
        tasks.push(task);
    }

    let mut results = Vec::new();
    let task_results = match try_join_all(tasks).await {
        Ok(res) => res,
        Err(err) => {
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                err.to_string(),
            )));
        }
    };
    for res in task_results {
        results.push(res?);
    }

    // merge multiple instances data
    let mut scan_stats = ScanStats::new();
    let mut result_type = String::new();
    let mut series_data: Vec<cluster_rpc::Series> = Vec::new();
    for resp in results {
        scan_stats.add(&resp.scan_stats.as_ref().unwrap().into());
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
        "promql->search->result: took: {}, file_count: {}, scan_size: {}",
        op_start.elapsed().as_millis(),
        scan_stats.files,
        scan_stats.original_size,
    );

    let req_stats = RequestStats {
        records: scan_stats.records,
        size: scan_stats.original_size as f64,
        response_time: op_start.elapsed().as_secs_f64(),
        request_body: Some(req.query.unwrap().query),
    };

    report_usage_stats(
        req_stats,
        &req.org_id,
        StreamType::Metrics,
        UsageType::MetricSearch,
        0,
    )
    .await;
    Ok(values)
}

fn merge_matrix_query(series: &[cluster_rpc::Series]) -> Value {
    let mut merged_data = HashMap::default();
    let mut merged_metrics = HashMap::default();
    for ser in series {
        let labels: Labels = ser
            .metric
            .iter()
            .map(|v| Arc::new(Label::from(v)))
            .collect();
        let entry = merged_data
            .entry(signature(&labels))
            .or_insert_with(HashMap::default);
        ser.samples.iter().for_each(|v| {
            entry.insert(v.time, v.value);
        });
        merged_metrics.insert(signature(&labels), labels);
    }
    let merged_data = merged_data
        .into_iter()
        .map(|(sig, samples)| {
            let mut samples = samples
                .into_iter()
                .map(|(ts, v)| Sample {
                    timestamp: ts,
                    value: v,
                })
                .collect::<Vec<_>>();
            samples.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
            RangeValue::new(merged_metrics.get(&sig).unwrap().to_owned(), samples)
        })
        .collect();

    let mut value = Value::Matrix(merged_data);
    value.sort();
    value
}

fn merge_vector_query(series: &[cluster_rpc::Series]) -> Value {
    let mut merged_data = HashMap::default();
    let mut merged_metrics: HashMap<Signature, Vec<Arc<Label>>> = HashMap::default();
    for ser in series {
        let labels: Labels = ser
            .metric
            .iter()
            .map(|l| Arc::new(Label::from(l)))
            .collect();
        let sample: Sample = ser.sample.as_ref().unwrap().into();
        merged_data.insert(signature(&labels), sample);
        merged_metrics.insert(signature(&labels), labels);
    }
    let merged_data = merged_data
        .into_iter()
        .map(|(sig, sample)| InstantValue {
            labels: merged_metrics.get(&sig).unwrap().to_owned(),
            sample,
        })
        .collect::<Vec<_>>();

    let mut value = Value::Vector(merged_data);
    value.sort();
    value
}

fn merge_scalar_query(series: &[cluster_rpc::Series]) -> Value {
    let mut sample: Sample = Default::default();
    for ser in series {
        if let Some(x) = ser.sample.as_ref() {
            sample = x.into();
        } else if let Some(x) = ser.scalar {
            sample.value = x;
        }
    }
    Value::Sample(sample)
}
