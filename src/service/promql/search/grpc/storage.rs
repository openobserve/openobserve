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
use datafusion::datasource::file_format::file_type::FileType;
use datafusion::error::{DataFusionError, Result};
use datafusion::prelude::SessionContext;
use promql_parser::parser;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};
use tokio::sync::Semaphore;

use crate::handler::grpc::cluster_rpc;
use crate::infra::cache::file_data;
use crate::infra::config::CONFIG;
use crate::meta;
use crate::service::metrics::get_prom_metrics_type;
use crate::service::promql::{engine, value};
use crate::service::search::datafusion::storage::file_list::SessionType;
use crate::service::{db, file_list, promql, search};

struct StorageProvider {
    org_id: String,
    session_id: String,
}

#[async_trait]
impl engine::TableProvider for StorageProvider {
    async fn create_context(
        &self,
        stream_name: &str,
        time_range: (i64, i64),
        filters: &[(String, String)],
    ) -> Result<SessionContext> {
        // get file list
        let files = get_file_list(&self.org_id, stream_name, time_range, filters).await?;
        let file_count = files.len();

        // load files to local cache
        let mut tasks = Vec::new();
        let semaphore = std::sync::Arc::new(Semaphore::new(CONFIG.limit.query_thread_num));
        for file in files.iter() {
            let file = file.clone();
            let permit = semaphore.clone().acquire_owned().await.unwrap();
            let task: tokio::task::JoinHandle<Result<(), anyhow::Error>> =
                tokio::task::spawn(async move {
                    if !file_data::exist(&file).unwrap_or_default() {
                        if let Err(e) = file_data::download(&file).await {
                            log::error!("storage->search: load file {}, err: {}", &file, e);
                        }
                    };
                    drop(permit);
                    Ok(())
                });
            tasks.push(task);
        }

        for task in tasks {
            match task.await {
                Ok(ret) => {
                    if let Err(err) = ret {
                        return Err(DataFusionError::Execution(err.to_string()));
                    }
                }
                Err(err) => {
                    return Err(DataFusionError::Execution(err.to_string()));
                }
            };
        }
        log::info!(
            "[TRACE] promql->search->storage: load files {} done",
            file_count
        );

        // fetch all schema versions, get latest schema
        let stream_type = meta::StreamType::Metrics;
        let schema = match db::schema::get(&self.org_id, stream_name, Some(stream_type)).await {
            Ok(schema) => schema,
            Err(err) => {
                log::error!("get schema error: {}", err);
                return Err(datafusion::error::DataFusionError::Execution(
                    err.to_string(),
                ));
            }
        };
        let schema = Arc::new(
            schema
                .to_owned()
                .with_metadata(std::collections::HashMap::new()),
        );
        let session = meta::search::Session {
            id: self.session_id.clone(),
            data_type: SessionType::Storage,
        };

        super::register_table(
            &session,
            &self.org_id,
            stream_name,
            stream_type,
            Some(schema),
            &files,
            FileType::PARQUET,
        )
        .await
    }

    async fn get_metrics_type(&self, stream_name: &str) -> Result<meta::prom::MetricType> {
        if let Some(v) = get_prom_metrics_type(&self.org_id, stream_name).await {
            Ok(v)
        } else {
            Err(DataFusionError::Execution(format!(
                "stream {} not found",
                stream_name
            )))
        }
    }
}

/// search in remote object storage
pub async fn search(
    session_id: &str,
    org_id: &str,
    query: &cluster_rpc::MetricsQueryStmt,
) -> Result<value::Value> {
    let prom_expr = parser::parse(&query.query).map_err(|e| {
        log::error!("parse query error: {e}");
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
        lookback_delta: Duration::from_secs(300), // 5m
    };

    let mut engine = promql::QueryEngine::new(StorageProvider {
        org_id: org_id.to_string(),
        session_id: session_id.to_string(),
    });
    let data = engine.exec(eval_stmt).await?;

    // clear session
    search::datafusion::storage::file_list::clear(session_id)
        .await
        .unwrap();

    Ok(data)
}

#[inline]
async fn get_file_list(
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
    filters: &[(String, String)],
) -> Result<Vec<String>> {
    let (time_min, time_max) = time_range;
    let results = match file_list::get_file_list(
        org_id,
        stream_name,
        Some(meta::StreamType::Metrics),
        time_min,
        time_max,
    )
    .await
    {
        Ok(results) => results,
        Err(err) => {
            log::error!("get file list error: {}", err);
            return Err(DataFusionError::Execution(
                "get file list error".to_string(),
            ));
        }
    };

    let mut files = Vec::new();
    for file in results {
        if super::match_source(
            org_id,
            stream_name,
            Some(time_range),
            filters,
            &file,
            false,
            false,
        )
        .await
        {
            files.push(file.clone());
        }
    }
    Ok(files)
}
