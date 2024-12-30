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

use std::{collections::HashMap, io::Cursor, sync::Arc};

use arrow::{ipc, record_batch::RecordBatch};
use config::{
    get_config,
    meta::{
        cluster::get_internal_grpc_token,
        search::{ScanStats, Session as SearchSession, StorageType},
        stream::StreamType,
    },
    utils::record_batch_ext::RecordBatchExt,
};
use datafusion::{
    arrow::datatypes::Schema,
    datasource::MemTable,
    error::{DataFusionError, Result},
    prelude::SessionContext,
};
use futures::future::try_join_all;
use proto::cluster_rpc;
use tonic::{
    codec::CompressionEncoding,
    metadata::{MetadataKey, MetadataValue},
    Request,
};
use tracing::{info_span, Instrument};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{
    common::infra::cluster::get_cached_online_ingester_nodes,
    service::{
        grpc::get_cached_channel,
        search::{
            datafusion::exec::{prepare_datafusion_context, register_table},
            MetadataMap,
        },
    },
};

#[tracing::instrument(name = "promql:search:grpc:wal:create_context", skip(trace_id))]
pub(crate) async fn create_context(
    trace_id: &str,
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
    filters: &mut [(String, Vec<String>)],
) -> Result<Vec<(SessionContext, Arc<Schema>, ScanStats)>> {
    let mut resp = vec![];
    // get file list
    let (mut arrow_schema, batches) =
        get_file_list(trace_id, org_id, stream_name, time_range, filters).await?;
    if batches.is_empty() {
        return Ok(vec![(
            SessionContext::new(),
            Arc::new(Schema::empty()),
            ScanStats::default(),
        )]);
    }

    let mut arrow_scan_stats = ScanStats::new();
    arrow_scan_stats.files = batches.len() as i64;
    for batch in batches.iter() {
        arrow_scan_stats.original_size += batch.size() as i64;
    }

    log::info!(
        "promql->wal->search: load wal files: batches {}, scan_size {}",
        arrow_scan_stats.files,
        arrow_scan_stats.original_size,
    );

    // fetch all schema versions, get latest schema
    let stream_type = StreamType::Metrics;
    let schema = infra::schema::get(org_id, stream_name, stream_type)
        .await
        .map_err(|err| {
            log::error!("get schema error: {}", err);
            DataFusionError::Execution(err.to_string())
        })?;
    if !batches.is_empty() {
        let ctx = prepare_datafusion_context(None, vec![], false, 0).await?;
        // calculate schema diff
        let mut diff_fields = HashMap::new();
        let group_fields = arrow_schema.fields();
        for field in group_fields {
            if let Ok(v) = schema.field_with_name(field.name()) {
                if v.data_type() != field.data_type() {
                    diff_fields.insert(v.name().clone(), v.data_type().clone());
                }
            }
        }
        // add not exists field for wal inferred schema
        let mut new_fields = Vec::new();
        for field in schema.fields() {
            if arrow_schema.field_with_name(field.name()).is_err() {
                new_fields.push(field.clone());
            }
        }
        if !new_fields.is_empty() {
            let new_schema = Schema::new(new_fields);
            arrow_schema = Schema::try_merge(vec![arrow_schema, new_schema])?;
        }
        let arrow_schema = Arc::new(arrow_schema);
        let mem_table = Arc::new(MemTable::try_new(arrow_schema.clone(), vec![batches])?);
        ctx.register_table(stream_name, mem_table)?;
        resp.push((ctx, arrow_schema, arrow_scan_stats));
    }

    let schema = Arc::new(
        schema
            .to_owned()
            .with_metadata(std::collections::HashMap::new()),
    );
    let session = SearchSession {
        id: trace_id.to_string(),
        storage_type: StorageType::Tmpfs,
        work_group: None,
        target_partitions: 0,
    };

    let ctx = register_table(
        &session,
        schema.clone(),
        stream_name,
        &[],
        hashbrown::HashMap::default(),
        &[],
    )
    .await?;
    resp.push((ctx, schema, arrow_scan_stats));
    Ok(resp)
}

/// get file list from local cache, no need match_source, each file will be
/// searched
#[tracing::instrument(name = "promql:search:grpc:wal:get_file_list", skip(trace_id))]
async fn get_file_list(
    trace_id: &str,
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
    filters: &[(String, Vec<String>)],
) -> Result<(Schema, Vec<RecordBatch>)> {
    let nodes = get_cached_online_ingester_nodes().await;
    if nodes.is_none() && nodes.as_deref().unwrap().is_empty() {
        return Ok((Schema::empty(), vec![]));
    }
    let nodes = nodes.unwrap();

    let mut req_filters = Vec::with_capacity(filters.len());
    for (k, v) in filters {
        req_filters.push(cluster_rpc::MetricsWalFileFilter {
            field: k.to_string(),
            value: v.clone(),
        });
    }

    let mut tasks = Vec::new();
    for node in nodes {
        let trace_id = trace_id.to_string();
        let node_addr = node.grpc_addr.clone();
        let org_id = org_id.to_string();
        let req = cluster_rpc::MetricsWalFileRequest {
            trace_id: trace_id.to_string(),
            org_id: org_id.clone(),
            stream_name: stream_name.to_string(),
            start_time: time_range.0,
            end_time: time_range.1,
            filters: req_filters.clone(),
        };
        let grpc_span = info_span!("promql:search:grpc:wal:grpc_wal_file");
        let task: tokio::task::JoinHandle<
            std::result::Result<cluster_rpc::MetricsWalFileResponse, DataFusionError>,
        > = tokio::task::spawn(
            async move {
                let cfg = get_config();
                let org_id: MetadataValue<_> = org_id
                    .parse()
                    .map_err(|_| DataFusionError::Execution("invalid org_id".to_string()))?;
                let mut request = tonic::Request::new(req);
                request.set_timeout(std::time::Duration::from_secs(cfg.limit.query_timeout));

                opentelemetry::global::get_text_map_propagator(|propagator| {
                    propagator.inject_context(
                        &tracing::Span::current().context(),
                        &mut MetadataMap(request.metadata_mut()),
                    )
                });

                let org_header_key: MetadataKey<_> =
                    cfg.grpc.org_header_key.parse().map_err(|_| {
                        DataFusionError::Execution("invalid org_header_key".to_string())
                    })?;
                let token: MetadataValue<_> = get_internal_grpc_token()
                    .parse()
                    .map_err(|_| DataFusionError::Execution("invalid token".to_string()))?;
                let channel = get_cached_channel(&node_addr).await.map_err(|err| {
                    log::error!(
                        "promql->search->grpc: node: {}, connect err: {:?}",
                        &node.grpc_addr,
                        err
                    );
                    DataFusionError::Execution("connect search node error".to_string())
                })?;
                let mut client = cluster_rpc::metrics_client::MetricsClient::with_interceptor(
                    channel,
                    move |mut req: Request<()>| {
                        req.metadata_mut().insert("authorization", token.clone());
                        req.metadata_mut()
                            .insert(org_header_key.clone(), org_id.clone());
                        Ok(req)
                    },
                );
                let cfg = get_config();
                client = client
                    .send_compressed(CompressionEncoding::Gzip)
                    .accept_compressed(CompressionEncoding::Gzip)
                    .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
                    .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
                let response: cluster_rpc::MetricsWalFileResponse =
                    match client.wal_file(request).await {
                        Ok(response) => response.into_inner(),
                        Err(err) => {
                            log::error!(
                            "[trace_id {trace_id}] promql->search->grpc:get wal file list from search node error: {}",
                            err
                        );
                            return Err(DataFusionError::Execution(
                                "get wal file list from search node error".to_string(),
                            ));
                        }
                    };
                Ok(response)
            }
            .instrument(grpc_span),
        );
        tasks.push(task);
    }

    let mut batches: Vec<RecordBatch> = Vec::new();
    let task_results = match try_join_all(tasks).await {
        Ok(res) => res,
        Err(err) => {
            return Err(DataFusionError::Execution(format!(
                "[trace_id {trace_id}] promql->search->grpc: get wal file list from search node error: {}",
                err
            )));
        }
    };
    for resp in task_results {
        let buf = Cursor::new(resp?.data);
        let reader = ipc::reader::FileReader::try_new(buf, None).unwrap();
        let batch = reader
            .into_iter()
            .map(|v| match v {
                Ok(v) => v,
                Err(e) => {
                    panic!("[trace_id {trace_id}] promql->search->grpc: read ipc error: {e}");
                }
            })
            .collect::<Vec<_>>();
        batches.extend(batch);
    }

    if batches.is_empty() {
        return Ok((Schema::empty(), vec![]));
    }

    let schema = batches.first().unwrap().schema().clone();
    Ok((schema.as_ref().clone(), batches))
}
