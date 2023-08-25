// Copyright 2023 Zinc Labs Inc.
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

use opentelemetry::global;
use std::time::UNIX_EPOCH;
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::common::infra::{config::CONFIG, errors, metrics, wal};
use crate::common::meta;
use crate::common::utils::file::{get_file_contents, get_file_meta, scan_files};
use crate::handler::grpc::cluster_rpc::{
    metrics_server::Metrics, MetricsQueryRequest, MetricsQueryResponse, MetricsWalFile,
    MetricsWalFileRequest, MetricsWalFileResponse,
};
use crate::handler::grpc::request::MetadataMap;
use crate::service::promql::search as SearchService;

pub struct Querier;

#[tonic::async_trait]
impl Metrics for Querier {
    #[tracing::instrument(name = "grpc:metrics:enter", skip_all, fields(org_id = req.get_ref().org_id))]
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
        let stream_type = meta::StreamType::Metrics.to_string();
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
        let start = std::time::Instant::now();
        let start_time = req.get_ref().start_time;
        let end_time = req.get_ref().end_time;
        let org_id = &req.get_ref().org_id;
        let stream_name = &req.get_ref().stream_name;
        let pattern = format!(
            "{}files/{org_id}/metrics/{stream_name}/",
            &CONFIG.common.data_wal_dir
        );

        let mut resp = MetricsWalFileResponse::default();
        let files = scan_files(&pattern);
        for file in files {
            if start_time > 0 || end_time > 0 {
                // check wal file created time, we can skip files which created time > end_time
                let file_meta = match get_file_meta(&file) {
                    Ok(meta) => meta,
                    Err(err) => {
                        log::error!("failed to get file meta: {}, {}", file, err);
                        continue;
                    }
                };
                let file_modified = file_meta
                    .modified()
                    .unwrap_or(UNIX_EPOCH)
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_micros();
                let file_created = file_meta
                    .created()
                    .unwrap_or(UNIX_EPOCH)
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_micros();
                let file_created = (file_created as i64)
                    - chrono::Duration::hours(CONFIG.limit.ingest_allowed_upto)
                        .num_microseconds()
                        .unwrap_or_default();

                if (start_time > 0 && (file_modified as i64) < start_time)
                    || (end_time > 0 && file_created > end_time)
                {
                    log::info!(
                        "skip wal file: {} time_range: [{},{}]",
                        file,
                        file_created,
                        file_modified
                    );
                    continue;
                }
            }
            if let Ok(body) = get_file_contents(&file) {
                let name = file.replace('\\', "/");
                let name = name.split('/').last().unwrap_or_default();
                resp.files.push(MetricsWalFile {
                    name: name.to_string(),
                    body,
                });
            }
        }

        // check wal memory mode
        if CONFIG.common.wal_memory_mode_enabled {
            let mem_files =
                wal::get_search_in_memory_files(org_id, stream_name, meta::StreamType::Metrics)
                    .unwrap_or_default();
            for (name, body) in mem_files {
                resp.files.push(MetricsWalFile { name, body });
            }
        }

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
