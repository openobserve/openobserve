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

use ::datafusion::{
    arrow::{ipc, record_batch::RecordBatch},
    error::DataFusionError,
};
use ahash::AHashMap as HashMap;
use std::sync::Arc;
use tracing::{info_span, Instrument};

use super::datafusion;
use crate::handler::grpc::cluster_rpc;
use crate::infra::{
    cluster,
    errors::{Error, ErrorCodes},
};
use crate::meta::{stream::ScanStats, StreamType};
use crate::service::db;

mod storage;
mod wal;

pub type SearchResult = Result<(HashMap<String, Vec<RecordBatch>>, ScanStats), Error>;

#[tracing::instrument(name = "service:search:grpc:search", skip_all)]
pub async fn search(
    req: &cluster_rpc::SearchRequest,
) -> Result<cluster_rpc::SearchResponse, Error> {
    let start = std::time::Instant::now();
    let sql = Arc::new(super::sql::Sql::new(req).await?);
    let stream_type = StreamType::from(req.stream_type.as_str());
    let session_id = Arc::new(req.job.as_ref().unwrap().session_id.to_string());

    // check if we are allowed to search
    if db::compact::retention::is_deleting_stream(&sql.org_id, &sql.stream_name, stream_type, None)
    {
        return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(format!(
            "stream [{}] is being deleted",
            &sql.stream_name
        ))));
    }

    let mut results = HashMap::new();
    let mut scan_stats = ScanStats::new();

    // search in WAL
    let session_id1 = session_id.clone();
    let sql1 = sql.clone();
    let wal_span = info_span!("service:search:grpc:in_wal");
    let task1 = tokio::task::spawn(
        async move {
            if cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
                wal::search(&session_id1, sql1, stream_type).await
            } else {
                Ok((HashMap::new(), ScanStats::default()))
            }
        }
        .instrument(wal_span),
    );

    // search in object storage
    let req_stype = req.stype;
    let session_id2 = session_id.clone();
    let sql2 = sql.clone();
    let file_list = req.file_list.to_owned();
    let storage_span = info_span!("service:search:grpc:in_storage");
    let task2 = tokio::task::spawn(
        async move {
            if req_stype == cluster_rpc::SearchType::WalOnly as i32 {
                Ok((HashMap::new(), ScanStats::default()))
            } else {
                storage::search(&session_id2, sql2, file_list.as_slice(), stream_type).await
            }
        }
        .instrument(storage_span),
    );

    // merge data from local WAL
    let (batches1, scan_stats1) = match task1.await {
        Ok(result) => result?,
        Err(err) => {
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                err.to_string(),
            )))
        }
    };

    if !batches1.is_empty() {
        for (key, batch) in batches1 {
            if !batch.is_empty() {
                let value = results.entry(key).or_insert_with(Vec::new);
                value.push(batch);
            }
        }
    }
    scan_stats.add(&scan_stats1);

    // merge data from object storage search
    let (batches2, scan_stats2) = match task2.await {
        Ok(result) => result?,
        Err(err) => {
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                err.to_string(),
            )))
        }
    };

    if !batches2.is_empty() {
        for (key, batch) in batches2 {
            if !batch.is_empty() {
                let value = results.entry(key).or_insert_with(Vec::new);
                value.push(batch);
            }
        }
    }
    scan_stats.add(&scan_stats2);

    // merge all batches
    let (offset, limit) = (0, sql.meta.offset + sql.meta.limit);
    for (name, batches) in results.iter_mut() {
        let merge_sql = if name == "query" {
            sql.origin_sql.clone()
        } else {
            sql.aggs
                .get(name.strip_prefix("agg_").unwrap())
                .unwrap()
                .0
                .clone()
        };
        *batches =
            match super::datafusion::exec::merge(&sql.org_id, offset, limit, &merge_sql, batches)
                .await
            {
                Ok(res) => res,
                Err(err) => {
                    log::error!("datafusion merge error: {}", err);
                    return Err(handle_datafusion_error(err));
                }
            };
    }

    // clear session data
    datafusion::storage::file_list::clear(&session_id);

    // final result
    let mut hits_buf = Vec::new();
    let result_query = results.get("query").cloned().unwrap_or_default();
    if !result_query.is_empty() && !result_query[0].is_empty() {
        let schema = result_query[0][0].schema();
        let ipc_options = ipc::writer::IpcWriteOptions::default();
        let ipc_options = ipc_options
            .try_with_compression(Some(ipc::CompressionType::ZSTD))
            .unwrap();
        let mut writer =
            ipc::writer::FileWriter::try_new_with_options(hits_buf, &schema, ipc_options).unwrap();
        for batch in result_query {
            for item in batch {
                writer.write(&item).unwrap();
            }
        }
        writer.finish().unwrap();
        hits_buf = writer.into_inner().unwrap();
    }

    // finally aggs result
    let mut aggs_buf = Vec::new();
    for (key, batches) in results {
        if key == "query" || batches.is_empty() {
            continue;
        }
        let mut buf = Vec::new();
        let schema = batches[0][0].schema();
        let ipc_options = ipc::writer::IpcWriteOptions::default();
        let ipc_options = ipc_options
            .try_with_compression(Some(ipc::CompressionType::ZSTD))
            .unwrap();
        let mut writer =
            ipc::writer::FileWriter::try_new_with_options(buf, &schema, ipc_options).unwrap();
        for batch in batches {
            for item in batch {
                writer.write(&item).unwrap();
            }
        }
        writer.finish().unwrap();
        buf = writer.into_inner().unwrap();
        aggs_buf.push(cluster_rpc::SearchAggResponse {
            name: key.strip_prefix("agg_").unwrap().to_string(),
            hits: buf,
        });
    }

    scan_stats.format_to_mb();
    let result = cluster_rpc::SearchResponse {
        job: req.job.clone(),
        took: start.elapsed().as_millis() as i32,
        from: sql.meta.offset as i32,
        size: sql.meta.limit as i32,
        total: 0,
        hits: hits_buf,
        aggs: aggs_buf,
        scan_stats: Some(cluster_rpc::ScanStats::from(&scan_stats)),
    };

    Ok(result)
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
    for punctuation in ['\'', '"'] {
        let pos_start = err[pos..].find(punctuation);
        if pos_start.is_none() {
            continue;
        }
        let pos_start = pos_start.unwrap();
        let pos_end = err[pos + pos_start + 1..].find(punctuation);
        if pos_end.is_none() {
            continue;
        }
        let pos_end = pos_end.unwrap();
        return Some(err[pos + pos_start + 1..pos + pos_start + 1 + pos_end].to_string());
    }
    None
}
