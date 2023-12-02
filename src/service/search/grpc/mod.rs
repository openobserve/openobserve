// Copyright 2023 Zinc Labs Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use ::datafusion::{
    arrow::{ipc, record_batch::RecordBatch},
    common::SchemaError,
    error::DataFusionError,
};
use ahash::AHashMap as HashMap;
use std::sync::Arc;
use tracing::{info_span, Instrument};

use crate::common::{
    infra::{
        cluster,
        config::CONFIG,
        errors::{Error, ErrorCodes},
    },
    meta::{common::FileKey, stream::ScanStats, StreamType},
};
use crate::handler::grpc::cluster_rpc;
use crate::service::db;

use super::datafusion;

mod storage;
mod wal;

pub type SearchResult = Result<(HashMap<String, Vec<RecordBatch>>, ScanStats), Error>;

#[tracing::instrument(name = "service:search:grpc:search", skip_all, fields(session_id = req.job.as_ref().unwrap().session_id, org_id = req.org_id))]
pub async fn search(
    req: &cluster_rpc::SearchRequest,
) -> Result<cluster_rpc::SearchResponse, Error> {
    let start = std::time::Instant::now();
    let sql = Arc::new(super::sql::Sql::new(req).await?);
    let stream_type = StreamType::from(req.stream_type.as_str());

    let session_id = Arc::new(req.job.as_ref().unwrap().session_id.to_string());
    let timeout = if req.timeout > 0 {
        req.timeout as u64
    } else {
        CONFIG.limit.query_timeout
    };

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

    // search in WAL json
    let session_id1 = session_id.clone();
    let sql1 = sql.clone();
    let wal_span = info_span!("service:search:grpc:in_wal", session_id = ?session_id1, org_id = sql.org_id,stream_name = sql.stream_name, stream_type = ?stream_type);
    let task1 = tokio::task::spawn(
        async move {
            if cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
                wal::search(&session_id1, sql1, stream_type, timeout).await
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
    let file_list: Vec<FileKey> = req.file_list.iter().map(FileKey::from).collect();
    let storage_span = info_span!("service:search:grpc:in_storage", session_id = ?session_id2, org_id = sql.org_id,stream_name = sql.stream_name, stream_type = ?stream_type);
    let task2 = tokio::task::spawn(
        async move {
            if req_stype == cluster_rpc::SearchType::WalOnly as i32 {
                Ok((HashMap::new(), ScanStats::default()))
            } else {
                storage::search(&session_id2, sql2, &file_list, stream_type, timeout).await
            }
        }
        .instrument(storage_span),
    );

    // search in WAL arrow
    let session_id3 = session_id.clone();
    let sql3 = sql.clone();
    let wal_span = info_span!("service:search:grpc:in_wal", org_id = sql.org_id,stream_name = sql.stream_name, stream_type = ?stream_type);
    let task3 = tokio::task::spawn(
        async move {
            if cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
                wal::search_arrow(&session_id3, sql3, stream_type, timeout).await
            } else {
                Ok((HashMap::new(), ScanStats::default()))
            }
        }
        .instrument(wal_span),
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

    // merge data from local WAL arrow
    let (batches3, scan_stats3) = match task3.await {
        Ok(result) => result?,
        Err(err) => {
            return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(
                err.to_string(),
            )))
        }
    };

    if !batches3.is_empty() {
        for (key, batch) in batches3 {
            if !batch.is_empty() {
                let value = results.entry(key).or_insert_with(Vec::new);
                value.push(batch);
            }
        }
    }

    scan_stats.add(&scan_stats3);

    // merge all batches
    let (offset, limit) = (0, sql.meta.offset + sql.meta.limit);
    let mut merge_results = HashMap::new();
    for (name, batches) in results.iter() {
        let merge_sql = if name == "query" {
            sql.origin_sql.clone()
        } else {
            sql.aggs
                .get(name.strip_prefix("agg_").unwrap())
                .unwrap()
                .0
                .clone()
        };
        let batches =
            match super::datafusion::exec::merge(&sql.org_id, offset, limit, &merge_sql, batches)
                .await
            {
                Ok(res) => res,
                Err(err) => {
                    log::error!("[session_id {session_id}] datafusion merge error: {}", err);
                    return Err(handle_datafusion_error(err));
                }
            };
        merge_results.insert(name.to_string(), batches);
    }
    drop(results);

    // clear session data
    datafusion::storage::file_list::clear(&session_id);

    // final result
    let mut hits_buf = Vec::new();
    let result_query = merge_results.get("query").cloned().unwrap_or_default();
    if !result_query.is_empty() && !result_query.is_empty() {
        let schema = result_query[0].schema();
        let ipc_options = ipc::writer::IpcWriteOptions::default();
        let ipc_options = ipc_options
            .try_with_compression(Some(ipc::CompressionType::ZSTD))
            .unwrap();
        let mut writer =
            ipc::writer::FileWriter::try_new_with_options(hits_buf, &schema, ipc_options).unwrap();
        for batch in result_query {
            writer.write(&batch).unwrap();
        }
        writer.finish().unwrap();
        hits_buf = writer.into_inner().unwrap();
    }

    // finally aggs result
    let mut aggs_buf = Vec::new();
    for (key, batches) in merge_results {
        if key == "query" || batches.is_empty() {
            continue;
        }
        let mut buf = Vec::new();
        let schema = batches[0].schema();
        let ipc_options = ipc::writer::IpcWriteOptions::default();
        let ipc_options = ipc_options
            .try_with_compression(Some(ipc::CompressionType::ZSTD))
            .unwrap();
        let mut writer =
            ipc::writer::FileWriter::try_new_with_options(buf, &schema, ipc_options).unwrap();
        for batch in batches {
            writer.write(&batch).unwrap();
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
    if let DataFusionError::SchemaError(SchemaError::FieldNotFound {
        field,
        valid_fields: _,
    }) = err
    {
        return Error::ErrorCode(ErrorCodes::SearchFieldNotFound(field.name));
    }

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

fn check_memory_circuit_breaker(scan_stats: &ScanStats) -> Result<(), Error> {
    let scan_size = if scan_stats.compressed_size > 0 {
        scan_stats.compressed_size
    } else {
        scan_stats.original_size
    };
    if let Some(cur_memory) = memory_stats::memory_stats() {
        if cur_memory.physical_mem as i64 + scan_size
            > (CONFIG.limit.mem_total * CONFIG.common.memory_circuit_breaker_ratio / 100) as i64
        {
            let err = format!("fire memory_circuit_breaker, try to alloc {} bytes, now current memory usage is {} bytes, larger than limit of [{} bytes] ",
                              scan_size,
                              cur_memory.physical_mem,
                              CONFIG.limit.mem_total * CONFIG.common.memory_circuit_breaker_ratio / 100);
            log::warn!("{}", err);
            return Err(Error::Message(err.to_string()));
        }
    }
    Ok(())
}
