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

use datafusion::{
    arrow::datatypes::Schema,
    datasource::file_format::file_type::FileType,
    error::{DataFusionError, Result},
    prelude::SessionContext,
};
use futures::future::try_join_all;
use std::{sync::Arc, time::Duration};
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};
use tracing::{info_span, Instrument};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::handler::grpc::cluster_rpc;
use crate::infra::{
    cache::tmpfs,
    cluster::{get_cached_online_ingester_nodes, get_internal_grpc_token},
    config::CONFIG,
};
use crate::meta::{search::Session as SearchSession, stream::ScanStats, StreamType};
use crate::service::{
    db,
    search::{
        datafusion::{exec::register_table, storage::StorageType},
        MetadataMap,
    },
};

#[tracing::instrument(name = "promql:search:grpc:wal:create_context", skip_all)]
pub(crate) async fn create_context(
    session_id: &str,
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
    _filters: &[(&str, &str)],
) -> Result<(SessionContext, Arc<Schema>, ScanStats)> {
    // get file list
    let files = get_file_list(org_id, stream_name, time_range).await?;
    if files.is_empty() {
        return Ok((
            SessionContext::new(),
            Arc::new(Schema::empty()),
            ScanStats::default(),
        ));
    }

    let work_dir = session_id.to_string();
    let mut scan_stats = ScanStats::new();
    scan_stats.files = files.len() as u64;
    for file in files {
        scan_stats.original_size += file.body.len() as u64;
        let file_name = format!("/{work_dir}/{}", file.name);
        tmpfs::set(&file_name, file.body.into()).expect("tmpfs set success");
    }

    log::info!(
        "promql->wal->search: load files {}, scan_size {}",
        scan_stats.files,
        scan_stats.original_size
    );

    // fetch all schema versions, get latest schema
    let stream_type = StreamType::Metrics;
    let schema = db::schema::get(org_id, stream_name, stream_type)
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
    let session = SearchSession {
        id: session_id.to_string(),
        storage_type: StorageType::Tmpfs,
    };

    let ctx = register_table(&session, schema.clone(), stream_name, &[], FileType::JSON).await?;
    Ok((ctx, schema, scan_stats))
}

/// get file list from local cache, no need match_source, each file will be searched
#[tracing::instrument(name = "promql:search:grpc:wal:get_file_list")]
async fn get_file_list(
    org_id: &str,
    stream_name: &str,
    time_range: (i64, i64),
) -> Result<Vec<cluster_rpc::MetricsWalFile>> {
    let nodes = get_cached_online_ingester_nodes();
    if nodes.is_none() && nodes.as_deref().unwrap().is_empty() {
        return Ok(vec![]);
    }
    let nodes = nodes.unwrap();

    let mut tasks = Vec::new();
    for node in nodes {
        let node_addr = node.grpc_addr.clone();
        let org_id = org_id.to_string();
        let req = cluster_rpc::MetricsWalFileRequest {
            org_id: org_id.clone(),
            stream_name: stream_name.to_string(),
            start_time: time_range.0,
            end_time: time_range.1,
        };
        let grpc_span = info_span!("promql:search:grpc:wal:grpc_wal_file");
        let task: tokio::task::JoinHandle<
            std::result::Result<cluster_rpc::MetricsWalFileResponse, DataFusionError>,
        > = tokio::task::spawn(
            async move {
                let org_id: MetadataValue<_> = org_id
                    .parse()
                    .map_err(|_| DataFusionError::Execution("invalid org_id".to_string()))?;
                let mut request = tonic::Request::new(req);
                request.set_timeout(Duration::from_secs(CONFIG.grpc.timeout));

                opentelemetry::global::get_text_map_propagator(|propagator| {
                    propagator.inject_context(
                        &tracing::Span::current().context(),
                        &mut MetadataMap(request.metadata_mut()),
                    )
                });

                let token: MetadataValue<_> = get_internal_grpc_token()
                    .parse()
                    .map_err(|_| DataFusionError::Execution("invalid token".to_string()))?;
                let channel = Channel::from_shared(node_addr)
                    .unwrap()
                    .connect()
                    .await
                    .map_err(|_| {
                        DataFusionError::Execution("connect search node error".to_string())
                    })?;
                let mut client = cluster_rpc::metrics_client::MetricsClient::with_interceptor(
                    channel,
                    move |mut req: Request<()>| {
                        req.metadata_mut().insert("authorization", token.clone());
                        req.metadata_mut()
                            .insert(CONFIG.grpc.org_header_key.as_str(), org_id.clone());
                        Ok(req)
                    },
                );
                client = client
                    .send_compressed(CompressionEncoding::Gzip)
                    .accept_compressed(CompressionEncoding::Gzip);
                let response: cluster_rpc::MetricsWalFileResponse =
                    match client.wal_file(request).await {
                        Ok(response) => response.into_inner(),
                        Err(err) => {
                            log::error!("get wal file list from search node error: {}", err);
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

    let mut results: Vec<cluster_rpc::MetricsWalFile> = Vec::new();
    let task_results = match try_join_all(tasks).await {
        Ok(res) => res,
        Err(err) => {
            return Err(DataFusionError::Execution(format!(
                "get wal file list from search node error: {}",
                err
            )));
        }
    };
    for task_result in task_results {
        results.extend(task_result?.files);
    }

    Ok(results)
}
