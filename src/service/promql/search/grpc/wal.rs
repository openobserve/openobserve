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
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use crate::common::file::scan_files;
use crate::handler::grpc::cluster_rpc;
use crate::infra::config::{self, CONFIG};
use crate::meta;
use crate::service::db;
use crate::service::promql;
use crate::service::promql::engine;
use crate::service::promql::value;
use crate::service::search::datafusion::storage::file_list::SessionType;

struct WalProvider {
    org_id: String,
    session_id: String,
}

#[async_trait]
impl engine::TableProvider for WalProvider {
    async fn create_context(
        &self,
        stream_name: &str,
        time_range: (i64, i64),
        filters: &[(String, String)],
    ) -> Result<SessionContext> {
        // get file list
        let files = get_file_list(&self.org_id, stream_name, time_range, filters).await?;

        // fetch all schema versions, get latest schema
        let stream_type = meta::StreamType::Metrics;
        let schema = db::schema::get(&self.org_id, stream_name, Some(stream_type))
            .await
            .map_err(|err| {
                log::error!("get schema error: {}", err);
                DataFusionError::Execution(err.to_string())
            })?;
        let schema = Arc::new(
            schema
                .to_owned()
                .with_metadata(std::collections::HashMap::new()),
        );
        let session = meta::search::Session {
            id: self.session_id.clone(),
            data_type: SessionType::Wal,
        };

        super::register_table(
            &session,
            &self.org_id,
            stream_name,
            stream_type,
            Some(schema),
            &files,
            FileType::JSON,
        )
        .await
    }
}

/// Search in the local WAL, which hasn't been persisted to the object storage yet
pub async fn search(
    session_id: &str,
    org_id: &str,
    query: &cluster_rpc::MetricsQueryStmt,
) -> Result<value::Value> {
    // mark searching in wal
    let searching = Searching::new();

    let prom_expr = parser::parse(&query.query).map_err(DataFusionError::Execution)?;

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

    let mut engine = promql::QueryEngine::new(WalProvider {
        org_id: org_id.to_string(),
        session_id: session_id.to_string(),
    });
    let data = engine.exec(eval_stmt).await?;

    // searching done.
    drop(searching);

    Ok(data)
}

/// get file list from local cache, no need match_source, each file will be searched
#[inline]
async fn get_file_list(
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
    filters: &[(String, String)],
) -> Result<Vec<String>> {
    let pattern = format!(
        "{}/files/{}/{}/{}/*.json",
        &CONFIG.common.data_wal_dir,
        org_id,
        meta::StreamType::Metrics,
        stream_name
    );
    let files = scan_files(&pattern);

    let mut result = Vec::new();
    let data_dir = match Path::new(&CONFIG.common.data_wal_dir).canonicalize() {
        Ok(path) => path,
        Err(_) => {
            return Ok(result);
        }
    };
    for file in files {
        let file = Path::new(&file).canonicalize().unwrap();
        let file = file.strip_prefix(&data_dir).unwrap();
        let local_file = file.to_str().unwrap();
        let file_path = file.parent().unwrap().to_str().unwrap().replace('\\', "/");
        let file_name = file.file_name().unwrap().to_str().unwrap();
        let file_name = file_name.replace('_', "/");
        let source_file = format!("{file_path}/{file_name}");
        if super::match_source(
            org_id,
            stream_name,
            Some(time_range),
            filters,
            &source_file,
            false,
            true,
        )
        .await
        {
            result.push(format!("{}{local_file}", &CONFIG.common.data_wal_dir));
        }
    }
    Ok(result)
}

/// Searching for marking searching in wal
struct Searching;

impl Searching {
    pub fn new() -> Self {
        config::SEARCHING_IN_WAL.store(1, Ordering::Relaxed);
        Searching
    }
}

impl Drop for Searching {
    fn drop(&mut self) {
        config::SEARCHING_IN_WAL.store(0, Ordering::Relaxed);
    }
}
