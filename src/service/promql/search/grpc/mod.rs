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

use datafusion::arrow::datatypes::Schema;
use datafusion::datasource::file_format::file_type::{FileType, GetExt};
use datafusion::datasource::file_format::json::JsonFormat;
use datafusion::datasource::file_format::parquet::ParquetFormat;
use datafusion::datasource::listing::{ListingOptions, ListingTable};
use datafusion::datasource::listing::{ListingTableConfig, ListingTableUrl};
use datafusion::datasource::TableProvider;
use datafusion::prelude::{SessionConfig, SessionContext};
use datafusion_common::DataFusionError;
use std::sync::Arc;
use tracing::{info_span, Instrument};

use crate::common::str::find;
use crate::handler::grpc::cluster_rpc;
use crate::infra::cluster;
use crate::infra::config::CONFIG;
use crate::infra::errors::{Error, ErrorCodes, Result};
use crate::meta::{self, StreamType};
use crate::service::promql::value;
use crate::service::search;
use crate::service::{file_list, get_partition_key_query};

mod storage;
mod wal;

pub async fn search(
    req: &cluster_rpc::MetricsQueryRequest,
) -> Result<cluster_rpc::MetricsQueryResponse> {
    let start = std::time::Instant::now();
    let session_id = req.job.as_ref().unwrap().session_id.to_string();
    let session_id = Arc::new(session_id);
    let is_range_query = req.query.as_ref().unwrap().is_range_query;

    // result
    let mut results = Vec::new();

    let span1 = info_span!("service:promql:search:grpc:in_cache");

    // search in cache
    let session_id1 = session_id.clone();
    let org_id1 = req.org_id.clone();
    let req1: cluster_rpc::MetricsQueryStmt = req.query.as_ref().unwrap().clone();
    let task1 = tokio::task::spawn(
        async move {
            if cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
                wal::search(&session_id1, &org_id1, &req1).await
            } else {
                Ok(value::Value::None)
            }
        }
        .instrument(span1),
    );

    let span2 = info_span!("service:promql:search:grpc:in_storage");

    // search in object storage
    let req_stype = req.stype;
    let session_id2 = session_id.clone();
    let org_id2 = req.org_id.clone();
    let req2 = req.query.as_ref().unwrap().clone();
    let task2 = tokio::task::spawn(
        async move {
            if req_stype == cluster_rpc::SearchType::CacheOnly as i32 {
                Ok(value::Value::None)
            } else {
                storage::search(&session_id2, &org_id2, &req2).await
            }
        }
        .instrument(span2),
    );

    // merge local wal
    let value1 = match task1.await {
        Ok(result) => match result {
            Ok(val) => val,
            Err(err) => {
                log::error!("datafusion execute error: {}", err);
                return Err(handle_datafusion_error(err));
            }
        },
        Err(err) => {
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                err.to_string(),
            )))
        }
    };

    match value1 {
        value::Value::None => {}
        _ => {
            results.push(value1);
        }
    }

    // merge object storage search
    let value2 = match task2.await {
        Ok(result) => match result {
            Ok(val) => val,
            Err(err) => {
                log::error!("datafusion execute error: {}", err);
                return Err(handle_datafusion_error(err));
            }
        },
        Err(err) => {
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                err.to_string(),
            )))
        }
    };

    match value2 {
        value::Value::None => {}
        _ => {
            results.push(value2);
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
                    metric: v.labels.iter().map(|l| l.as_ref().into()).collect(),
                    values: vec![],
                    value: Some((&v.value).into()),
                    scalar: None,
                });
            }
            value::Value::Range(v) => {
                resp.result.push(cluster_rpc::Series {
                    metric: v.labels.iter().map(|l| l.as_ref().into()).collect(),
                    values: v.values.iter().map(|l| l.into()).collect(),
                    value: None,
                    scalar: None,
                });
            }
            value::Value::Vector(v) => {
                v.iter().for_each(|v| {
                    resp.result.push(cluster_rpc::Series {
                        metric: v.labels.iter().map(|l| l.as_ref().into()).collect(),
                        values: vec![],
                        value: Some((&v.value).into()),
                        scalar: None,
                    });
                });
            }
            value::Value::Matrix(v) => {
                v.iter().for_each(|v| {
                    resp.result.push(cluster_rpc::Series {
                        metric: v.labels.iter().map(|l| l.as_ref().into()).collect(),
                        values: v.values.iter().map(|l| l.into()).collect(),
                        value: None,
                        scalar: None,
                    });
                });
            }
            value::Value::Sample(v) => {
                resp.result.push(cluster_rpc::Series {
                    metric: vec![],
                    values: vec![],
                    value: Some(v.into()),
                    scalar: None,
                });
            }
            value::Value::Float(v) => {
                resp.result.push(cluster_rpc::Series {
                    metric: vec![],
                    values: vec![],
                    value: None,
                    scalar: Some(*v),
                });
            }
        }
    }

    // reset result type
    resp.result_type = result_type.to_string();

    Ok(resp)
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

/// match a source is a valid file or not
pub async fn match_source(
    org_id: &str,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
    filters: &[(String, String)],
    source: &str,
    is_wal: bool,
    match_min_ts_only: bool,
) -> bool {
    let stream_type = StreamType::Metrics;
    // match org_id & table
    if !source.starts_with(format!("files/{}/{}/{}/", org_id, stream_type, stream_name).as_str()) {
        return false;
    }

    // check partition key
    if !filter_source_by_partition_key(source, filters) {
        return false;
    }

    if is_wal {
        return true;
    }

    // check time range
    let file_meta = file_list::get_file_meta(source).await.unwrap_or_default();
    if file_meta.min_ts == 0 || file_meta.max_ts == 0 {
        return true;
    }
    log::trace!(
        "time range: {:?}, file time: {}-{}, {}",
        time_range,
        file_meta.min_ts,
        file_meta.max_ts,
        source
    );

    // match partation clause
    if time_range.is_some() {
        let (time_min, time_max) = time_range.unwrap();
        if match_min_ts_only && time_min > 0 {
            return file_meta.min_ts >= time_min && file_meta.min_ts < time_max;
        }
        if time_min > 0 && time_min > file_meta.max_ts {
            return false;
        }
        if time_max > 0 && time_max < file_meta.min_ts {
            return false;
        }
    }
    true
}

fn filter_source_by_partition_key(source: &str, filters: &[(String, String)]) -> bool {
    !filters.iter().any(|(k, v)| {
        let field = get_partition_key_query(&format!("{k}="));
        let value = get_partition_key_query(&format!("{k}={v}"));
        find(source, &format!("/{field}")) && !find(source, &format!("/{value}/"))
    })
}

pub async fn register_table(
    session: &meta::search::Session,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    schema: Option<Arc<Schema>>,
    files: &Vec<String>,
    file_type: FileType,
) -> datafusion::error::Result<SessionContext> {
    if files.is_empty() {
        return Ok(SessionContext::new());
    }

    let start = std::time::Instant::now();
    let runtime_env = search::datafusion::exec::create_runtime_env()?;
    let session_config = SessionConfig::new()
        .with_information_schema(schema.is_none())
        .with_batch_size(8192);
    let ctx = SessionContext::with_config_rt(session_config.clone(), Arc::new(runtime_env));

    // Configure listing options
    let listing_options = match file_type {
        FileType::PARQUET => {
            let file_format = ParquetFormat::default().with_enable_pruning(Some(false));
            ListingOptions::new(Arc::new(file_format))
                .with_file_extension(FileType::PARQUET.get_ext())
                .with_target_partitions(CONFIG.limit.cpu_num)
        }
        FileType::JSON => {
            let file_format = JsonFormat::default();
            ListingOptions::new(Arc::new(file_format))
                .with_file_extension(FileType::JSON.get_ext())
                .with_target_partitions(CONFIG.limit.cpu_num)
        }
        _ => {
            return Err(DataFusionError::Execution(format!(
                "Unsupported file type scheme {file_type:?}",
            )));
        }
    };

    let prefix = if session
        .data_type
        .eq(&search::datafusion::storage::file_list::SessionType::Wal)
    {
        format!(
            "{}files/{}/{stream_type}/{}/",
            &CONFIG.common.data_wal_dir, org_id, stream_name
        )
    } else {
        search::datafusion::storage::file_list::set(&session.id, files)
            .await
            .unwrap();
        format!("mem:///{}/", session.id)
    };
    let prefix = match ListingTableUrl::parse(prefix) {
        Ok(url) => url,
        Err(e) => {
            return Err(datafusion::error::DataFusionError::Execution(format!(
                "ListingTableUrl error: {e}",
            )));
        }
    };
    let prefixes = vec![prefix];
    log::info!(
        "Prepare table took {:.3} seconds.",
        start.elapsed().as_secs_f64()
    );

    let mut config =
        ListingTableConfig::new_with_multi_paths(prefixes).with_listing_options(listing_options);
    let schema = if schema.is_none()
        || session
            .data_type
            .eq(&search::datafusion::storage::file_list::SessionType::Wal)
    {
        config = config.infer_schema(&ctx.state()).await.unwrap();
        let table = ListingTable::try_new(config.clone())?;
        let infered_schema = table.schema();
        if schema.is_none() {
            infered_schema
        } else {
            match Schema::try_merge(vec![
                schema.unwrap().as_ref().to_owned(),
                infered_schema.as_ref().to_owned(),
            ]) {
                Ok(schema) => Arc::new(schema),
                Err(e) => {
                    return Err(datafusion::error::DataFusionError::Execution(format!(
                        "ListingTable Merge schema error: {e}"
                    )));
                }
            }
        }
    } else {
        schema.as_ref().unwrap().clone()
    };
    config = config.with_schema(schema);
    log::info!(
        "infer schema took {:.3} seconds.",
        start.elapsed().as_secs_f64()
    );

    let table = ListingTable::try_new(config)?;
    ctx.register_table(stream_name, Arc::new(table))?;

    log::info!(
        "Register table took {:.3} seconds.",
        start.elapsed().as_secs_f64()
    );

    Ok(ctx)
}
