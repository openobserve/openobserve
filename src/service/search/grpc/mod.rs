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

use std::sync::Arc;

use ::datafusion::arrow::{ipc, record_batch::RecordBatch};
use config::{
    cluster,
    meta::stream::{FileKey, StreamType},
    CONFIG,
};
use futures::future::try_join_all;
use hashbrown::HashMap;
use infra::errors::{Error, ErrorCodes};
use tracing::{info_span, Instrument};

use super::datafusion;
use crate::{common::meta::stream::ScanStats, handler::grpc::cluster_rpc, service::db};

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
    let work_group = req.work_group.clone();

    let session_id = Arc::new(req.job.as_ref().unwrap().session_id.to_string());
    let timeout = if req.timeout > 0 {
        req.timeout as u64
    } else {
        CONFIG.limit.query_timeout
    };

    // check if we are allowed to search
    if db::compact::retention::is_deleting_stream(&sql.org_id, stream_type, &sql.stream_name, None)
    {
        return Err(Error::ErrorCode(ErrorCodes::SearchStreamNotFound(format!(
            "stream [{}] is being deleted",
            &sql.stream_name
        ))));
    }

    log::info!(
        "[session_id {session_id}] grpc->search in: part_id: {}, stream: {}/{}/{}, time range: {:?}",
        req.job.as_ref().unwrap().partition,
        sql.org_id,
        stream_type,
        sql.stream_name,
        sql.meta.time_range
    );

    // search in WAL parquet
    let work_group1 = work_group.clone();
    let session_id1 = session_id.clone();
    let sql1 = sql.clone();
    let wal_parquet_span = info_span!(
        "service:search:grpc:in_wal_parquet",
        session_id = session_id1.as_ref().clone(),
        org_id = sql.org_id,
        stream_name = sql.stream_name,
        stream_type = stream_type.to_string(),
    );
    let task1 = tokio::task::spawn(
        async move {
            if cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
                wal::search_parquet(&session_id1, sql1, stream_type, &work_group1, timeout).await
            } else {
                Ok((HashMap::new(), ScanStats::default()))
            }
        }
        .instrument(wal_parquet_span),
    );

    // search in WAL memory
    let work_group2 = work_group.clone();
    let session_id2 = session_id.clone();
    let sql2 = sql.clone();
    let wal_mem_span = info_span!(
        "service:search:grpc:in_wal_memory",
        session_id = session_id2.as_ref().clone(),
        org_id = sql.org_id,
        stream_name = sql.stream_name,
        stream_type = stream_type.to_string(),
    );
    let task2 = tokio::task::spawn(
        async move {
            if cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
                wal::search_memtable(&session_id2, sql2, stream_type, &work_group2, timeout).await
            } else {
                Ok((HashMap::new(), ScanStats::default()))
            }
        }
        .instrument(wal_mem_span),
    );

    // search in object storage
    let req_stype = req.stype;
    let work_group3 = work_group.clone();
    let session_id3 = session_id.clone();
    let sql3 = sql.clone();
    let file_list: Vec<FileKey> = req.file_list.iter().map(FileKey::from).collect();
    let storage_span = info_span!(
        "service:search:grpc:in_storage",
        session_id = session_id3.as_ref().clone(),
        org_id = sql.org_id,
        stream_name = sql.stream_name,
        stream_type = stream_type.to_string(),
    );
    let task3 = tokio::task::spawn(
        async move {
            if req_stype == cluster_rpc::SearchType::WalOnly as i32 {
                Ok((HashMap::new(), ScanStats::default()))
            } else {
                storage::search(
                    &session_id3,
                    sql3,
                    &file_list,
                    stream_type,
                    &work_group3,
                    timeout,
                )
                .await
            }
        }
        .instrument(storage_span),
    );

    // search in arrow idx
    let work_group4 = work_group.clone();
    let session_id4 = session_id.clone();
    let sql4 = sql.clone();
    let wal_mem_span = info_span!(
        "service:search:grpc:in_idx_arrow",
        session_id = session_id4.as_ref().clone(),
        org_id = sql.org_id,
        stream_name = sql.stream_name,
        stream_type = stream_type.to_string(),
    );
    let task4 = tokio::task::spawn(
        async move {
            if cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
                wal::search_arrow(&session_id4, sql4, stream_type, &work_group4, timeout).await
            } else {
                Ok((HashMap::new(), ScanStats::default()))
            }
        }
        .instrument(wal_mem_span),
    );

    // merge result
    let mut results = HashMap::new();
    let mut scan_stats = ScanStats::new();
    let tasks = try_join_all(vec![task1, task2, task3, task4])
        .await
        .map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))?;
    for task in tasks {
        let (batches, stats) =
            task.map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))?;
        scan_stats.add(&stats);
        for (key, batch) in batches {
            if !batch.is_empty() {
                let value = results.entry(key).or_insert_with(Vec::new);
                value.extend(batch);
            }
        }
    }

    // merge all batches
    let (offset, limit) = (0, sql.meta.offset + sql.meta.limit);
    let mut merge_results = HashMap::new();
    for (name, batches) in results {
        let merge_sql = if name == "query" {
            sql.origin_sql.clone()
        } else {
            sql.aggs
                .get(name.strip_prefix("agg_").unwrap())
                .unwrap()
                .0
                .clone()
        };
        let batches = match super::datafusion::exec::merge(
            &sql.org_id,
            offset,
            limit,
            &merge_sql,
            &batches,
            false,
        )
        .await
        {
            Ok(res) => res,
            Err(err) => {
                log::error!("[session_id {session_id}] datafusion merge error: {}", err);
                return Err(err.into());
            }
        };
        merge_results.insert(name.to_string(), batches);
    }

    // clear session data
    datafusion::storage::file_list::clear(&session_id);

    // final result
    let mut hits_buf = Vec::new();
    let mut hits_total = 0;
    let result_query = merge_results.get("query").cloned().unwrap_or_default();
    if !result_query.is_empty() {
        let schema = result_query[0].schema();
        let ipc_options = ipc::writer::IpcWriteOptions::default();
        let ipc_options = ipc_options
            .try_with_compression(Some(ipc::CompressionType::ZSTD))
            .unwrap();
        let mut writer =
            ipc::writer::FileWriter::try_new_with_options(hits_buf, &schema, ipc_options).unwrap();
        for batch in result_query {
            if batch.num_rows() > 0 {
                hits_total += batch.num_rows();
                writer.write(&batch).unwrap();
            }
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
        total: hits_total as i64,
        hits: hits_buf,
        aggs: aggs_buf,
        scan_stats: Some(cluster_rpc::ScanStats::from(&scan_stats)),
    };

    Ok(result)
}

fn check_memory_circuit_breaker(session_id: &str, scan_stats: &ScanStats) -> Result<(), Error> {
    let scan_size = if scan_stats.compressed_size > 0 {
        scan_stats.compressed_size
    } else {
        scan_stats.original_size
    };
    if let Some(cur_memory) = memory_stats::memory_stats() {
        // left memory < datafusion * breaker_ratio and scan_size >=  left memory
        let left_mem = CONFIG.limit.mem_total - cur_memory.physical_mem;
        if (left_mem
            < (CONFIG.memory_cache.datafusion_max_size
                * CONFIG.common.memory_circuit_breaker_ratio
                / 100))
            && (scan_size >= left_mem as i64)
        {
            let err = format!(
                "fire memory_circuit_breaker, try to alloc {} bytes, now current memory usage is {} bytes, left memory {} bytes, left memory more than limit of [{} bytes] or scan_size more than left memory , please submit a new query with a short time range",
                scan_size,
                cur_memory.physical_mem,
                left_mem,
                CONFIG.memory_cache.datafusion_max_size
                    * CONFIG.common.memory_circuit_breaker_ratio
                    / 100
            );
            log::warn!("[{session_id}] {}", err);
            return Err(Error::Message(err.to_string()));
        }
    }
    Ok(())
}
