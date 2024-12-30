// Copyright 2024 OpenObserve Inc.
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

use arrow::ipc;
use arrow_schema::Schema;
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        search::ScanStats,
        stream::{StreamPartition, StreamType},
    },
    metrics,
};
use datafusion::{catalog::TableProvider, error::DataFusionError, prelude::SessionContext};
use hashbrown::HashMap;
use infra::errors;
use opentelemetry::global;
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{
    handler::grpc::{
        cluster_rpc::{
            metrics_server::Metrics, MetricsQueryRequest, MetricsQueryResponse,
            MetricsWalFileRequest, MetricsWalFileResponse,
        },
        MetadataMap,
    },
    service::{
        promql::search as SearchService,
        search::{
            datafusion::{
                exec::{prepare_datafusion_context, register_udf},
                storage as datafusion_storage,
                table_provider::uniontable::NewUnionTable,
            },
            grpc::{wal, QueryParams},
        },
    },
};

pub struct MetricsQuerier;

#[tonic::async_trait]
impl Metrics for MetricsQuerier {
    #[tracing::instrument(name = "grpc:metrics:query", skip_all, fields(org_id = req.get_ref().org_id))]
    async fn query(
        &self,
        req: Request<MetricsQueryRequest>,
    ) -> Result<Response<MetricsQueryResponse>, Status> {
        let start = std::time::Instant::now();
        let parent_cx =
            global::get_text_map_propagator(|prop| prop.extract(&MetadataMap(req.metadata())));
        tracing::Span::current().set_parent(parent_cx);

        let req: &MetricsQueryRequest = req.get_ref();
        let org_id = &req.org_id;
        let stream_type = StreamType::Metrics.to_string();
        let result = SearchService::grpc::search(req).await.map_err(|err| {
            let time = start.elapsed().as_secs_f64();
            metrics::GRPC_RESPONSE_TIME
                .with_label_values(&["/metrics/query", "500", org_id, "", &stream_type])
                .observe(time);
            metrics::GRPC_INCOMING_REQUESTS
                .with_label_values(&["/metrics/query", "500", org_id, "", &stream_type])
                .inc();
            let message = if let errors::Error::ErrorCode(code) = err {
                code.to_json()
            } else {
                err.to_string()
            };
            Status::internal(message)
        })?;

        let time = start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/metrics/query", "200", org_id, "", &stream_type])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/metrics/query", "200", org_id, "", &stream_type])
            .inc();

        Ok(Response::new(result))
    }

    #[tracing::instrument(name = "grpc:metrics:wal_file", skip_all, fields(org_id = req.get_ref().org_id, stream_name = req.get_ref().stream_name))]
    async fn wal_file(
        &self,
        req: Request<MetricsWalFileRequest>,
    ) -> Result<Response<MetricsWalFileResponse>, Status> {
        let cfg = get_config();
        let start = std::time::Instant::now();

        let trace_id = &req.get_ref().trace_id;
        let org_id = &req.get_ref().org_id;
        let stream_type = StreamType::Metrics;
        let stream_name = &req.get_ref().stream_name;
        let start_time = req.get_ref().start_time;
        let end_time = req.get_ref().end_time;
        let mut filters = req
            .get_ref()
            .filters
            .iter()
            .map(|f| (f.field.to_string(), f.value.clone()))
            .collect::<Vec<_>>();
        let mut resp = MetricsWalFileResponse::default();

        // get latest schema
        let schema_latest = infra::schema::get(org_id, stream_name, stream_type)
            .await
            .unwrap_or(Schema::empty());
        let schema_latest = Arc::new(schema_latest);

        // format partition keys
        let stream_settings = infra::schema::get_settings(org_id, stream_name, StreamType::Metrics)
            .await
            .unwrap_or_default();
        let partition_keys = &stream_settings.partition_keys;
        let partition_keys: HashMap<&String, &StreamPartition> =
            partition_keys.iter().map(|v| (&v.field, v)).collect();
        for (key, value) in filters.iter_mut() {
            if let Some(partition_key) = partition_keys.get(key) {
                for val in value.iter_mut() {
                    *val = partition_key.get_partition_value(val);
                }
            }
        }
        let search_partition_keys = filters
            .iter()
            .map(|(k, vs)| {
                vs.iter()
                    .map(|v| (k.clone(), v.clone()))
                    .collect::<Vec<_>>()
            })
            .collect::<Vec<_>>()
            .concat();

        // create datafusion context, just used for decode plan, the params can use default
        let work_group = None;
        let mut ctx =
            prepare_datafusion_context(work_group.clone(), vec![], false, cfg.limit.cpu_num)
                .await
                .map_err(|e| Status::internal(e.to_string()))?;

        // register UDF
        register_udf(&ctx, org_id).map_err(|e| Status::internal(e.to_string()))?;
        datafusion_functions_json::register_all(&mut ctx)
            .map_err(|e| Status::internal(e.to_string()))?;

        let query_params = Arc::new(QueryParams {
            trace_id: trace_id.to_string(),
            org_id: org_id.clone(),
            job_id: "".to_string(),
            stream_type,
            stream_name: stream_name.to_string(),
            time_range: Some((start_time, end_time)),
            work_group: work_group.clone(),
            use_inverted_index: false,
        });

        // get all tables
        let mut tables = Vec::new();
        let mut scan_stats = ScanStats::new();
        let file_stats_cache = ctx.runtime_env().cache_manager.get_file_statistic_cache();

        // search in WAL parquet
        if LOCAL_NODE.is_ingester() {
            let (tbls, stats) = match wal::search_parquet(
                query_params.clone(),
                schema_latest.clone(),
                &search_partition_keys,
                false,
                file_stats_cache.clone(),
                None,
                vec![],
            )
            .await
            {
                Ok(v) => v,
                Err(e) => {
                    // clear session data
                    datafusion_storage::file_list::clear(trace_id);
                    // release wal lock files
                    crate::common::infra::wal::release_request(trace_id);
                    log::error!(
                        "[trace_id {trace_id}] grpc->metrics->wal_file->search: search wal parquet error: {}",
                        e
                    );
                    return Err(Status::internal(e.to_string()));
                }
            };
            tables.extend(tbls);
            scan_stats.add(&stats);
        }

        // search in WAL memory
        if LOCAL_NODE.is_ingester() {
            let (tbls, stats) = match wal::search_memtable(
                query_params.clone(),
                schema_latest.clone(),
                &search_partition_keys,
                false,
                None,
                vec![],
            )
            .await
            {
                Ok(v) => v,
                Err(e) => {
                    // clear session data
                    datafusion_storage::file_list::clear(trace_id);
                    // release wal lock files
                    crate::common::infra::wal::release_request(trace_id);
                    log::error!(
                        "[trace_id {trace_id}] grpc->metrics->wal_file->search: search wal memtable error: {}",
                        e
                    );
                    return Err(Status::internal(e.to_string()));
                }
            };
            tables.extend(tbls);
            scan_stats.add(&stats);
        }

        // query data
        let mut sql = format!(
            "SELECT * FROM tbl WHERE {} >= {} AND {} <= {}",
            cfg.common.column_timestamp, start_time, cfg.common.column_timestamp, end_time
        );
        for (key, value) in search_partition_keys.iter() {
            sql = format!("{} AND {} = '{}'", sql, key, value);
        }

        let (hits_total, data) =
            match query_sql(trace_id, &mut ctx, tables, schema_latest, &sql).await {
                Ok(v) => v,
                Err(e) => {
                    // clear session data
                    datafusion_storage::file_list::clear(trace_id);
                    // release wal lock files
                    crate::common::infra::wal::release_request(trace_id);
                    return Err(Status::internal(e.to_string()));
                }
            };
        resp.data = data;

        // clear session data
        datafusion_storage::file_list::clear(trace_id);
        // release wal lock files
        crate::common::infra::wal::release_request(trace_id);

        log::info!("[trace_id {trace_id}] grpc->metrics->wal_file->search: search wal parquet success, files: {}, scan_size {}, compressed_size {}, hits_total: {}",
            scan_stats.files,
            scan_stats.original_size,
            scan_stats.compressed_size,
            hits_total,
        );

        let time = start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/metrics/wal_file", "200", org_id, stream_name, "metrics"])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/metrics/wal_file", "200", org_id, stream_name, "metrics"])
            .inc();

        Ok(Response::new(resp))
    }
}

async fn query_sql(
    trace_id: &str,
    ctx: &mut SessionContext,
    tables: Vec<Arc<dyn TableProvider>>,
    schema: Arc<Schema>,
    sql: &str,
) -> Result<(usize, Vec<u8>), DataFusionError> {
    let union_table = NewUnionTable::try_new(schema.clone(), tables)?;
    ctx.register_table("tbl", Arc::new(union_table))?;

    let df = ctx.sql(sql).await?;
    let schema = df.schema().into();
    let batches = df.collect().await?;

    // convert batches to arrow ipc
    let ipc_options = ipc::writer::IpcWriteOptions::default();
    let ipc_options = ipc_options.try_with_compression(Some(ipc::CompressionType::ZSTD))?;
    let buf = Vec::new();
    let mut writer = ipc::writer::FileWriter::try_new_with_options(buf, &schema, ipc_options)?;
    let mut hits_total = 0;
    for batch in batches {
        if batch.num_rows() == 0 {
            continue;
        }
        hits_total += batch.num_rows();
        if let Err(e) = writer.write(&batch) {
            log::error!(
                "[trace_id {trace_id}] grpc->metrics->wal_file->search: write record batch to ipc error: {}",
                e
            );
        }
    }
    if let Err(e) = writer.finish() {
        log::error!(
            "[trace_id {trace_id}] grpc->metrics->wal_file->search: convert record batch to ipc error: {}",
            e
        );
    }

    let data = writer.into_inner()?;
    Ok((hits_total, data))
}
