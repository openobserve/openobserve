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

use async_trait::async_trait;
use datafusion::{arrow::datatypes::Schema, error::DataFusionError, prelude::SessionContext};
use promql_parser::parser;
use std::{
    sync::Arc,
    time::{Duration, UNIX_EPOCH},
};

use crate::handler::grpc::cluster_rpc;
use crate::infra::{cache::tmpfs, errors::Result};
use crate::meta::stream::ScanStats;
use crate::service::{
    promql::{value, Query, TableProvider, DEFAULT_LOOKBACK},
    search,
};

mod storage;
mod wal;

struct StorageProvider {
    session_id: String,
    need_wal: bool,
}

#[async_trait]
impl TableProvider for StorageProvider {
    async fn create_context(
        &self,
        org_id: &str,
        stream_name: &str,
        time_range: (i64, i64),
        filters: &[(&str, &str)],
    ) -> datafusion::error::Result<Vec<(SessionContext, Arc<Schema>, ScanStats)>> {
        let mut resp = Vec::new();
        // register storage table
        let ctx =
            storage::create_context(&self.session_id, org_id, stream_name, time_range, filters)
                .await?;
        resp.push(ctx);
        // register Wal table
        if self.need_wal {
            let ctx =
                wal::create_context(&self.session_id, org_id, stream_name, time_range, filters)
                    .await?;
            resp.push(ctx);
        }
        Ok(resp)
    }
}

#[tracing::instrument(name = "promql:search:grpc:search", skip_all)]
pub async fn search(
    req: &cluster_rpc::MetricsQueryRequest,
) -> Result<cluster_rpc::MetricsQueryResponse> {
    let start = std::time::Instant::now();
    let session_id = req.job.as_ref().unwrap().session_id.to_string();

    let org_id = &req.org_id;
    let query = req.query.as_ref().unwrap();
    let prom_expr = parser::parse(&query.query).map_err(|e| {
        log::error!("promQL parse query error: {e}");
        DataFusionError::Execution(e)
    })?;

    let eval_stmt = parser::EvalStmt {
        expr: prom_expr,
        start: UNIX_EPOCH
            .checked_add(Duration::from_micros(query.start as _))
            .unwrap(),
        end: UNIX_EPOCH
            .checked_add(Duration::from_micros(query.end as _))
            .unwrap(),
        interval: Duration::from_micros(query.step as _),
        lookback_delta: DEFAULT_LOOKBACK,
    };

    let mut engine = Query::new(
        org_id,
        StorageProvider {
            session_id: session_id.to_string(),
            need_wal: req.need_wal,
        },
    );

    let (value, result_type, mut scan_stats) = engine.exec(eval_stmt).await?;
    let result_type = match result_type {
        Some(v) => v,
        None => value.get_type().to_string(),
    };

    // clear session
    search::datafusion::storage::file_list::clear(&session_id);
    // clear tmpfs
    tmpfs::delete(&format!("/{}/", session_id), true).unwrap();

    scan_stats.format_to_mb();
    let mut resp = cluster_rpc::MetricsQueryResponse {
        job: req.job.clone(),
        took: start.elapsed().as_millis() as i32,
        result_type,
        scan_stats: Some(cluster_rpc::ScanStats::from(&scan_stats)),
        ..Default::default()
    };

    match value {
        value::Value::None => {
            return Ok(resp);
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
                sample: Some((&v).into()),
                scalar: None,
            });
        }
        value::Value::Float(v) => {
            resp.result.push(cluster_rpc::Series {
                metric: vec![],
                samples: vec![],
                sample: None,
                scalar: Some(v),
            });
        }
    }

    Ok(resp)
}
