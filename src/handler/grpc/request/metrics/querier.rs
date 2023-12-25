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

use std::time::UNIX_EPOCH;

use arrow_schema::Schema;
use chrono::DateTime;
use config::{meta::stream::StreamType, CONFIG, FILE_EXT_JSON};
use opentelemetry::global;
use tonic::{Request, Response, Status};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{
    common::{
        infra::{errors, metrics, wal},
        meta::{self, stream::PartitionTimeLevel},
        utils::file::{get_file_contents, get_file_meta, scan_files},
    },
    handler::grpc::{
        cluster_rpc::{
            metrics_server::Metrics, MetricsQueryRequest, MetricsQueryResponse, MetricsWalFile,
            MetricsWalFileRequest, MetricsWalFileResponse,
        },
        request::MetadataMap,
    },
    service::{
        db,
        promql::search as SearchService,
        stream::{stream_settings, unwrap_partition_time_level},
    },
};

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
        let start = std::time::Instant::now();
        let start_time = req.get_ref().start_time;
        let end_time = req.get_ref().end_time;
        let org_id = &req.get_ref().org_id;
        let stream_name = &req.get_ref().stream_name;
        let mut resp = MetricsWalFileResponse::default();

        let wal_dir = match std::path::Path::new(&CONFIG.common.data_wal_dir).canonicalize() {
            Ok(path) => {
                let mut path = path.to_str().unwrap().to_string();
                // Hack for windows
                if path.starts_with("\\\\?\\") {
                    path = path[4..].to_string();
                    path = path.replace('\\', "/");
                }
                path
            }
            Err(_) => {
                return Ok(Response::new(resp));
            }
        };

        let pattern = format!("{wal_dir}/files/{org_id}/metrics/{stream_name}/");
        let files = scan_files(&pattern, "parquet");

        if files.is_empty() {
            return Ok(Response::new(resp));
        }

        // get schema settings
        let schema_latest = db::schema::get(org_id, stream_name, StreamType::Metrics)
            .await
            .unwrap_or(Schema::empty());
        let schema_settings = stream_settings(&schema_latest).unwrap_or_default();
        let partition_time_level =
            unwrap_partition_time_level(schema_settings.partition_time_level, StreamType::Metrics);

        // lock theses files
        let files = files
            .iter()
            .map(|f| {
                f.strip_prefix(&wal_dir)
                    .unwrap()
                    .to_string()
                    .replace('\\', "/")
                    .trim_start_matches('/')
                    .to_string()
            })
            .collect::<Vec<_>>();
        wal::lock_files(&files).await;

        for file in files.iter() {
            // check wal file created time, we can skip files which created time > end_time
            let file_columns = file.split('/').collect::<Vec<&str>>();
            let file_time_start = format!(
                "{}-{}-{}T{}:00:00Z",
                file_columns[5], file_columns[6], file_columns[7], file_columns[8]
            );
            let mut file_time_start = match DateTime::parse_from_rfc3339(&file_time_start) {
                Ok(v) => v.timestamp_micros(),
                Err(_) => 0,
            };
            let mut file_time_end = format!(
                "{}-{}-{}T{}:59:59Z",
                file_columns[5], file_columns[6], file_columns[7], file_columns[8]
            );
            if file_columns[8] == "00" && partition_time_level.eq(&PartitionTimeLevel::Daily) {
                file_time_end = format!(
                    "{}-{}-{}T23:59:59Z",
                    file_columns[5], file_columns[6], file_columns[7]
                );
            }
            let mut file_time_end = match DateTime::parse_from_rfc3339(&file_time_end) {
                Ok(v) => v.timestamp_micros(),
                Err(_) => 0,
            };

            let source_file = wal_dir.to_string() + "/" + file;
            if start_time > 0 || end_time > 0 {
                // check wal file created time, we can skip files which created time > end_time
                let file_meta = match get_file_meta(&source_file) {
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
                    .as_micros() as i64;
                let file_created = file_meta
                    .created()
                    .unwrap_or(UNIX_EPOCH)
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_micros() as i64;
                let file_created = (file_created as i64)
                    - chrono::Duration::hours(CONFIG.limit.ingest_allowed_upto)
                        .num_microseconds()
                        .unwrap_or_default();
                if file_created > 0 && file_time_start == 0 {
                    file_time_start = file_created;
                }
                if file_modified < file_time_end || file_time_end == 0 {
                    file_time_end = file_modified;
                }
                if (start_time > 0 && file_time_end < start_time)
                    || (end_time > 0 && file_time_start > end_time)
                {
                    log::debug!(
                        "skip wal file: {} time_range: [{},{}]",
                        file,
                        file_created,
                        file_modified
                    );
                    continue;
                }
            }
            if let Ok(body) = get_file_contents(&source_file) {
                let data = if file.ends_with(FILE_EXT_JSON) {
                    let mut file_data = body;
                    // check json file is complete
                    if !file_data.ends_with(b"\n") {
                        if let Ok(s) = String::from_utf8(file_data.clone()) {
                            if let Some(last_line) = s.lines().last() {
                                if serde_json::from_str::<serde_json::Value>(last_line).is_err() {
                                    // remove last line
                                    // filter by stream name if data is for metrics
                                    file_data =
                                        file_data[..file_data.len() - last_line.len()].to_vec();
                                }
                            }
                        }
                    }

                    let metric_key = format!("\"{}\":\"{}\"", meta::prom::NAME_LABEL, &stream_name);
                    if let Ok(s) = String::from_utf8(file_data) {
                        let filtered_lines: Vec<&str> = s
                            .lines()
                            .filter(|line| line.contains(&metric_key))
                            .collect();

                        // Convert the filtered lines back to a single String
                        let filtered_content = filtered_lines.join("\n");

                        // Convert the String back to a Vec<u8>
                        filtered_content.into_bytes()
                    } else {
                        continue;
                    }
                } else {
                    body
                };

                let columns = file.split('/').collect::<Vec<&str>>();

                let len = columns.len();

                let name = columns[len - 1];
                let schema = columns[len - 2];

                resp.files.push(MetricsWalFile {
                    name: name.to_string(),
                    body: data,
                    schema: schema.to_string(),
                });
            }
        }

        // release all files
        wal::release_files(&files).await;

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
