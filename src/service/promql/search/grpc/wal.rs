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
use datafusion::{
    datasource::file_format::file_type::FileType,
    error::{DataFusionError, Result},
    prelude::SessionContext,
};
use promql_parser::parser;
use std::path::Path;
use std::sync::{atomic::Ordering, Arc};
use std::time::{Duration, UNIX_EPOCH};

use crate::common::file::scan_files;
use crate::handler::grpc::cluster_rpc;
use crate::infra::config::{self, CONFIG};
use crate::meta::prom::Metadata;
use crate::meta::search::Session as SearchSession;
use crate::meta::{stream::StreamParams, StreamType};
use crate::service::db;
use crate::service::metrics::get_prom_metadata_from_schema;
use crate::service::promql::{value, QueryEngine, TableProvider};
use crate::service::search::datafusion::{exec::register_table, storage::file_list::SessionType};
use crate::service::search::match_source;

struct WalProvider {
    session_id: String,
}

#[async_trait]
impl TableProvider for WalProvider {
    async fn create_context(
        &self,
        org_id: &str,
        stream_name: &str,
        time_range: (i64, i64),
        filters: &[(&str, &str)],
    ) -> Result<(SessionContext, Option<Metadata>)> {
        // get file list
        let files = get_file_list(org_id, stream_name, time_range, filters).await?;
        if files.is_empty() {
            return Ok((SessionContext::new(), None));
        }

        // fetch all schema versions, get latest schema
        let stream_type = StreamType::Metrics;
        let schema = db::schema::get(org_id, stream_name, Some(stream_type))
            .await
            .map_err(|err| {
                log::error!("get schema error: {}", err);
                DataFusionError::Execution(err.to_string())
            })?;
        let metadata = get_prom_metadata_from_schema(&schema);
        let schema = Arc::new(
            schema
                .to_owned()
                .with_metadata(std::collections::HashMap::new()),
        );
        let session = SearchSession {
            id: self.session_id.clone(),
            data_type: SessionType::Wal,
        };

        let (ctx, _) = register_table(
            &session,
            StreamParams {
                org_id,
                stream_name,
                stream_type,
            },
            Some(schema),
            stream_name,
            &files,
            FileType::JSON,
        )
        .await?;
        Ok((ctx, metadata))
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

    let mut engine = QueryEngine::new(
        org_id,
        WalProvider {
            session_id: session_id.to_string(),
        },
    );
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
    filters: &[(&str, &str)],
) -> Result<Vec<String>> {
    let pattern = format!(
        "{}/files/{}/{}/{}/*.json",
        &CONFIG.common.data_wal_dir,
        org_id,
        StreamType::Metrics,
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
        if match_source(
            StreamParams {
                org_id,
                stream_name,
                stream_type: StreamType::Metrics,
            },
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
