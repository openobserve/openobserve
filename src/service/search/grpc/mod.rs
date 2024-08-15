// Copyright 2024 Zinc Labs Inc.
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

use ::datafusion::{arrow::ipc, datasource::TableProvider, error::DataFusionError};
use arrow_schema::Schema;
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        search::{ScanStats, SearchType, StorageType},
        stream::{FileKey, StreamType},
    },
    utils::record_batch_ext::format_recordbatch_by_schema,
};
use hashbrown::{HashMap, HashSet};
use infra::{
    errors::{Error, ErrorCodes},
    schema::unwrap_stream_settings,
};
use proto::cluster_rpc;
use tokio::time::Duration;

use super::datafusion;
use crate::service::{
    db,
    search::{
        datafusion::exec, generate_search_schema, generate_select_start_search_schema,
        sql::RE_SELECT_WILDCARD,
    },
};

pub mod flight;
mod storage;
mod wal;

pub type SearchTable = Result<(Vec<Arc<dyn TableProvider>>, Vec<String>, ScanStats), Error>;

pub struct QueryParams {
    pub trace_id: String,
    pub org_id: String,
    pub stream_type: StreamType,
    pub stream_name: String,
    pub time_range: Option<(i64, i64)>,
    pub work_group: String,
}

#[tracing::instrument(name = "service:search:grpc:search", skip_all, fields(org_id = req.org_id))]
pub async fn search(
    req: &cluster_rpc::SearchRequest,
) -> Result<cluster_rpc::SearchResponse, Error> {
    let cfg = get_config();
    let start = std::time::Instant::now();
    let sql = Arc::new(super::sql::Sql::new(req).await?);
    let stream_type = StreamType::from(req.stream_type.as_str());
    let work_group = req.work_group.clone();

    let trace_id = Arc::new(req.job.as_ref().unwrap().trace_id.to_string());
    let timeout = if req.timeout > 0 {
        req.timeout as u64
    } else {
        cfg.limit.query_timeout
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
        "[trace_id {trace_id}] grpc->search in: part_id: {}, stream: {}/{}/{}, time range: {:?}",
        req.job.as_ref().unwrap().partition,
        sql.org_id,
        stream_type,
        sql.stream_name,
        sql.meta.time_range
    );

    // set target partitions based on cache type

    // construct latest schema map
    let schema_latest = sql.schema.clone();
    let mut schema_latest_map = HashMap::with_capacity(schema_latest.fields().len());
    for field in schema_latest.fields() {
        schema_latest_map.insert(field.name(), field);
    }
    let stream_settings = unwrap_stream_settings(&schema_latest).unwrap_or_default();
    let defined_schema_fields = stream_settings.defined_schema_fields.unwrap_or_default();

    let select_wildcard = RE_SELECT_WILDCARD.is_match(sql.origin_sql.as_str());
    let (schema_latest, _) = if select_wildcard {
        generate_select_start_search_schema(
            &sql,
            schema_latest.clone(),
            &schema_latest_map,
            &defined_schema_fields,
        )?
    } else {
        generate_search_schema(&sql, schema_latest.clone(), &schema_latest_map)?
    };

    // TODO the leader need check is_wildcard and defined_schema_fields to reduce the schema
    let query_params = Arc::new(QueryParams {
        trace_id: trace_id.to_string(),
        org_id: sql.org_id.to_string(),
        stream_type,
        stream_name: sql.stream_name.to_string(),
        time_range: sql.meta.time_range,
        work_group: work_group.to_string(),
    });

    // get all tables
    let mut tables = Vec::new();
    let mut scan_stats = ScanStats::new();

    // search in object storage
    let req_stype = req.stype;
    if req_stype != cluster_rpc::SearchType::WalOnly as i32 {
        let file_list: Vec<FileKey> = req.file_list.iter().map(FileKey::from).collect();
        let (tbls, _, stats) =
            match storage::search(query_params.clone(), schema_latest.clone(), &file_list).await {
                Ok(v) => v,
                Err(e) => {
                    // clear session data
                    datafusion::storage::file_list::clear(&trace_id);
                    log::error!(
                        "[trace_id {}] search->storage: search storage parquet error: {}",
                        trace_id,
                        e
                    );
                    return Err(e);
                }
            };
        tables.extend(tbls);
        scan_stats.add(&stats);
    }

    // search in WAL parquet
    let skip_wal = req.query.as_ref().unwrap().skip_wal;
    let mut wal_lock_files = Vec::new();
    if LOCAL_NODE.is_ingester() && !skip_wal {
        let (tbls, lock_files, stats) =
            match wal::search_parquet(query_params.clone(), schema_latest.clone()).await {
                Ok(v) => v,
                Err(e) => {
                    // clear session data
                    datafusion::storage::file_list::clear(&trace_id);
                    log::error!(
                        "[trace_id {}] search->storage: search wal parquet error: {}",
                        trace_id,
                        e
                    );
                    return Err(e);
                }
            };
        tables.extend(tbls);
        scan_stats.add(&stats);
        wal_lock_files = lock_files;
    }

    // search in WAL memory
    if LOCAL_NODE.is_ingester() && !skip_wal {
        let (tbls, _, stats) =
            match wal::search_memtable(query_params.clone(), schema_latest.clone()).await {
                Ok(v) => v,
                Err(e) => {
                    // clear session data
                    datafusion::storage::file_list::clear(&trace_id);
                    // release wal lock files
                    crate::common::infra::wal::release_files(&wal_lock_files).await;
                    log::error!(
                        "[trace_id {}] search->storage: search wal memtable error: {}",
                        trace_id,
                        e
                    );
                    return Err(e);
                }
            };
        tables.extend(tbls);
        scan_stats.add(&stats);
    }

    // create a Union Plan to merge all tables
    let session = config::meta::search::Session {
        id: trace_id.to_string(),
        storage_type: StorageType::Memory,
        search_type: if !sql.meta.group_by.is_empty() {
            SearchType::Aggregation
        } else {
            SearchType::Normal
        },
        work_group: Some(work_group.to_string()),
        target_partitions: cfg.limit.cpu_num,
    };

    // run and get the RecordBatch
    #[cfg(feature = "enterprise")]
    let (abort_sender, abort_receiver) = tokio::sync::oneshot::channel();
    #[cfg(feature = "enterprise")]
    if crate::service::search::SEARCH_SERVER
        .insert_sender(trace_id, abort_sender)
        .await
        .is_err()
    {
        // clear session data
        datafusion::storage::file_list::clear(&trace_id);
        // release wal lock files
        crate::common::infra::wal::release_files(&wal_lock_files).await;
        log::info!(
            "[trace_id {}] search->storage: search canceled before call search->storage",
            session.id
        );
        return Err(Error::Message(format!(
            "[trace_id {}] search->storage: search canceled before call search->storage",
            session.id
        )));
    }

    let ret = tokio::select! {
        ret = exec::query_tables(&session, &sql,schema_latest, tables) => {
            match ret {
                Ok(ret) => Ok(ret),
                Err(err) => {
                    log::error!("[trace_id {}] search->storage: datafusion execute error: {}", session.id, err);
                    Err(err)
                }
            }
        },
        _ = tokio::time::sleep(Duration::from_secs(timeout)) => {
            log::error!("[trace_id {}] search->storage: search timeout", session.id);
            Err(DataFusionError::ResourcesExhausted(format!(
                "[trace_id {}] search->storage: task timeout", session.id
            )))
        },
        _ = async {
            #[cfg(feature = "enterprise")]
            let _ = abort_receiver.await;
            #[cfg(not(feature = "enterprise"))]
            futures::future::pending::<()>().await;
        } => {
            log::info!("[trace_id {}] search->storage: search canceled", session.id);
            Err( DataFusionError::Execution(format!(
                "[trace_id {}] search->storage: task is cancel", session.id
            )))
        }
    };

    // clear session data
    datafusion::storage::file_list::clear(&trace_id);
    // release wal lock files
    crate::common::infra::wal::release_files(&wal_lock_files).await;

    let results = match ret {
        Ok(v) => v,
        Err(err) => match err {
            DataFusionError::ResourcesExhausted(e) => {
                return Err(Error::ErrorCode(ErrorCodes::SearchTimeout(e)));
            }
            _ => return Err(err.into()),
        },
    };

    let mut results = results
        .into_iter()
        .flatten()
        .filter(|v| v.num_rows() > 0)
        .collect::<Vec<_>>();

    // format recordbatch with same schema
    if !results.is_empty() {
        let mut schema = results[0].schema();
        let schema_fields = schema
            .fields()
            .iter()
            .map(|f| f.name())
            .collect::<HashSet<_>>();
        let mut new_fields = HashSet::new();
        let mut need_format = false;
        for batch in results.iter() {
            if batch.num_rows() == 0 {
                continue;
            }
            if batch.schema().fields() != schema.fields() {
                need_format = true;
            }
            for field in batch.schema().fields() {
                if !schema_fields.contains(field.name()) {
                    new_fields.insert(field.clone());
                }
            }
        }
        drop(schema_fields);
        if !new_fields.is_empty() {
            need_format = true;
            let new_schema = Schema::new(new_fields.into_iter().collect::<Vec<_>>());
            schema =
                Arc::new(Schema::try_merge(vec![schema.as_ref().clone(), new_schema]).unwrap());
        }
        if need_format {
            let mut new_batches = Vec::new();
            for batch in results {
                if batch.num_rows() == 0 {
                    continue;
                }
                new_batches.push(format_recordbatch_by_schema(schema.clone(), batch));
            }
            results = new_batches;
        }
    }
    log::info!("[trace_id {trace_id}] in node merge task finish");

    // final result
    let mut hits_total = 0;
    let mut hits_buf = vec![];
    let results = results.into_iter().collect::<Vec<_>>();
    if !results.is_empty() {
        let schema = results[0].schema();
        let ipc_options = ipc::writer::IpcWriteOptions::default();
        let ipc_options = ipc_options
            .try_with_compression(Some(ipc::CompressionType::ZSTD))
            .unwrap();
        let buf = Vec::new();
        let mut writer =
            ipc::writer::FileWriter::try_new_with_options(buf, &schema, ipc_options).unwrap();
        for batch in results {
            hits_total += batch.num_rows();
            if let Err(e) = writer.write(&batch) {
                log::error!(
                    "[trace_id {trace_id}] write record batch to ipc error: {}",
                    e
                );
            }
        }
        if let Err(e) = writer.finish() {
            log::error!(
                "[trace_id {trace_id}] convert record batch to ipc error: {}",
                e
            );
        }
        if let Ok(v) = writer.into_inner() {
            hits_buf = v;
        }
    }

    scan_stats.format_to_mb();
    let result = cluster_rpc::SearchResponse {
        job: req.job.clone(),
        took: start.elapsed().as_millis() as i32,
        idx_took: 0,
        from: sql.meta.offset as i32,
        size: sql.meta.limit as i32,
        total: hits_total as i64,
        hits: hits_buf,
        scan_stats: Some(cluster_rpc::ScanStats::from(&scan_stats)),
        is_partial: false,
    };

    Ok(result)
}

fn check_memory_circuit_breaker(trace_id: &str, scan_stats: &ScanStats) -> Result<(), Error> {
    let cfg = get_config();
    let scan_size = if scan_stats.compressed_size > 0 {
        scan_stats.compressed_size
    } else {
        scan_stats.original_size
    };
    if let Some(cur_memory) = memory_stats::memory_stats() {
        // left memory < datafusion * breaker_ratio and scan_size >=  left memory
        let left_mem = cfg.limit.mem_total - cur_memory.physical_mem;
        if (left_mem
            < (cfg.memory_cache.datafusion_max_size * cfg.common.memory_circuit_breaker_ratio
                / 100))
            && (scan_size >= left_mem as i64)
        {
            let err = format!(
                "fire memory_circuit_breaker, try to alloc {} bytes, now current memory usage is {} bytes, left memory {} bytes, left memory more than limit of [{} bytes] or scan_size more than left memory , please submit a new query with a short time range",
                scan_size,
                cur_memory.physical_mem,
                left_mem,
                cfg.memory_cache.datafusion_max_size * cfg.common.memory_circuit_breaker_ratio
                    / 100
            );
            log::warn!("[{trace_id}] {}", err);
            return Err(Error::Message(err.to_string()));
        }
    }
    Ok(())
}
