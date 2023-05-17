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

use futures::future::try_join_all;
use std::sync::Arc;
use tracing::{info_span, Instrument};

use crate::handler::grpc::cluster_rpc;
use crate::infra::cluster;
use crate::infra::errors::{Error, ErrorCodes, Result};
use crate::service::{promql::value, search};

mod storage;
mod wal;

pub async fn search(
    req: &cluster_rpc::MetricsQueryRequest,
) -> Result<cluster_rpc::MetricsQueryResponse> {
    let start = std::time::Instant::now();
    let session_id = Arc::new(req.job.as_ref().unwrap().session_id.to_string());
    let is_range_query = req.query.as_ref().unwrap().is_range_query;

    let mut results = Vec::new();

    // 1. search in the object storage
    // search storage first because there are old data
    let span1 = info_span!("service:promql:search:grpc:in_storage");
    let req_stype = req.stype;
    let session_id1 = session_id.clone();
    let org_id1 = req.org_id.clone();
    let req1: cluster_rpc::MetricsQueryStmt = req.query.as_ref().unwrap().clone();
    let task1 = tokio::task::spawn(
        async move {
            if req_stype == cluster_rpc::SearchType::WalOnly as i32 {
                Ok(value::Value::None)
            } else {
                storage::search(&session_id1, &org_id1, &req1).await
            }
        }
        .instrument(span1),
    );

    // 2. search in the local WAL
    // search wal second because there are latest data
    let span2 = info_span!("service:promql:search:grpc:in_wal");
    let session_id2 = session_id.clone();
    let org_id2 = req.org_id.clone();
    let req2 = req.query.as_ref().unwrap().clone();
    let task2 = tokio::task::spawn(
        async move {
            if cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
                wal::search(&session_id2, &org_id2, &req2).await
            } else {
                Ok(value::Value::None)
            }
        }
        .instrument(span2),
    );

    // Perform search operations (in storage and WAL) and collect results
    let task_results = try_join_all(vec![task1, task2])
        .await
        .map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))?;
    for value in task_results {
        match value {
            Ok(value) => {
                if !matches!(value, value::Value::None) {
                    results.push(value);
                }
            }
            Err(err) => {
                log::error!("datafusion execute error: {}", err);
                return Err(search::grpc::handle_datafusion_error(err));
            }
        }
    }

    let mut result_type = if is_range_query { "matrix" } else { "vector" };
    let mut resp = cluster_rpc::MetricsQueryResponse {
        job: req.job.clone(),
        took: start.elapsed().as_millis() as i32,
        result_type: result_type.to_string(),
        ..Default::default()
    };

    if results.is_empty() {
        return Ok(resp);
    }

    for result in results.iter() {
        result_type = result.get_type();
        match result {
            value::Value::None => {
                continue;
            }
            value::Value::Instant(v) => {
                resp.result.push(cluster_rpc::Series {
                    metric: v.labels.iter().map(|x| x.as_ref().into()).collect(),
                    samples: vec![],
                    sample: Some((&v.sample).into()),
                    scalar: None,
                });
            }
            value::Value::Range(v) => {
                resp.result.push(cluster_rpc::Series {
                    metric: v.labels.iter().map(|x| x.as_ref().into()).collect(),
                    samples: v.samples.iter().map(|x| x.into()).collect(),
                    sample: None,
                    scalar: None,
                });
            }
            value::Value::Vector(v) => {
                v.iter().for_each(|v| {
                    resp.result.push(cluster_rpc::Series {
                        metric: v.labels.iter().map(|x| x.as_ref().into()).collect(),
                        samples: vec![],
                        sample: Some((&v.sample).into()),
                        scalar: None,
                    });
                });
            }
            value::Value::Matrix(v) => {
                v.iter().for_each(|v| {
                    resp.result.push(cluster_rpc::Series {
                        metric: v.labels.iter().map(|x| x.as_ref().into()).collect(),
                        samples: v.samples.iter().map(|x| x.into()).collect(),
                        sample: None,
                        scalar: None,
                    });
                });
            }
            value::Value::Sample(v) => {
                resp.result.push(cluster_rpc::Series {
                    metric: vec![],
                    samples: vec![],
                    sample: Some(v.into()),
                    scalar: None,
                });
            }
            value::Value::Float(v) => {
                resp.result.push(cluster_rpc::Series {
                    metric: vec![],
                    samples: vec![],
                    sample: None,
                    scalar: Some(*v),
                });
            }
        }
    }

    // reset result type
    resp.result_type = result_type.to_string();

    Ok(resp)
}
