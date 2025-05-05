// Copyright 2025 OpenObserve Inc.
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

use std::ops::Range;

use anyhow::Result;
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{cluster::get_internal_grpc_token, stream::FileKey},
    metrics,
    utils::inverted_index::convert_parquet_idx_file_name_to_tantivy_file,
};
use futures_util::StreamExt;
use hashbrown::{HashMap, HashSet};
use infra::cache::file_data::disk;
use opentelemetry::global;
use proto::cluster_rpc::{
    EmptyResponse, FileContent, FileContentResponse, FileList, SimpleFileList,
    event_client::EventClient, event_server::Event,
};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{
    Request, Response, Status, codec::CompressionEncoding, codegen::tokio_stream,
    metadata::MetadataValue,
};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::handler::grpc::MetadataMap;

pub struct Eventer;

const CHUNK_SIZE: usize = 4 * 1024 * 1024; // 4MB chunks

#[tonic::async_trait]
impl Event for Eventer {
    type GetFilesStream = ReceiverStream<Result<FileContentResponse, Status>>;

    async fn send_file_list(
        &self,
        req: Request<FileList>,
    ) -> Result<Response<EmptyResponse>, Status> {
        let start = std::time::Instant::now();
        let parent_cx =
            global::get_text_map_propagator(|prop| prop.extract(&MetadataMap(req.metadata())));
        tracing::Span::current().set_parent(parent_cx);

        let req = req.get_ref();
        let grpc_addr = req.node_addr.clone();
        let put_items = req
            .items
            .iter()
            .filter(|v| !v.deleted)
            .map(FileKey::from)
            .collect::<Vec<_>>();
        let cfg = get_config();

        // cache latest files for querier
        if cfg.cache_latest_files.enabled && LOCAL_NODE.is_querier() {
            let mut files_to_download = Vec::new();

            // Collect files to download
            for item in put_items.iter() {
                // cache parquet
                if cfg.cache_latest_files.cache_parquet {
                    files_to_download.push((
                        item.account.clone(),
                        item.key.clone(),
                        item.meta.compressed_size as usize,
                    ));
                }

                // cache index for the parquet
                if cfg.cache_latest_files.cache_index && item.meta.index_size > 0 {
                    if let Some(ttv_file) = convert_parquet_idx_file_name_to_tantivy_file(&item.key)
                    {
                        files_to_download.push((
                            item.account.clone(),
                            ttv_file,
                            item.meta.index_size as usize,
                        ));
                    }
                }
            }

            // Try batch download first
            if get_config().cache_latest_files.download_from_node {
                let mut failed_files = Vec::new();

                // Try batch download files
                if !files_to_download.is_empty() {
                    match download_from_node(&grpc_addr, &files_to_download).await {
                        Ok(failed) => failed_files = failed,
                        Err(e) => {
                            log::error!("[gRPC:Event] Failed to get files from notifier: {}", e);
                            failed_files = files_to_download;
                        }
                    }
                }

                // Fallback to individual downloads for failed files
                for (account, file, size) in failed_files {
                    let size = if size > 0 { Some(size) } else { None };
                    if let Err(e) = infra::cache::file_data::download(&account, &file, size).await {
                        log::error!("[gRPC:Event] Failed to cache file data: {}", e);
                    }
                }
            } else {
                // Direct download when download_from_node_enabled is false
                for (account, file, size) in files_to_download {
                    let size = if size > 0 { Some(size) } else { None };
                    if let Err(e) = infra::cache::file_data::download(&account, &file, size).await {
                        log::error!("[gRPC:Event] Failed to cache file data: {}", e);
                    }
                }
            }

            // delete merge files
            if cfg.cache_latest_files.delete_merge_files {
                if cfg.cache_latest_files.cache_parquet {
                    let del_items = req
                        .items
                        .iter()
                        .filter_map(|v| if v.deleted { Some(v.key.clone()) } else { None })
                        .collect::<Vec<_>>();
                    infra::cache::file_data::delete::add(del_items);
                }
                if cfg.cache_latest_files.cache_index {
                    let del_items = req
                        .items
                        .iter()
                        .filter_map(|v| {
                            if v.deleted {
                                match v.meta.as_ref() {
                                    Some(m) if m.index_size > 0 => {
                                        convert_parquet_idx_file_name_to_tantivy_file(&v.key)
                                    }
                                    _ => None,
                                }
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>();
                    infra::cache::file_data::delete::add(del_items);
                }
            }
        }

        // metrics
        let time = start.elapsed().as_secs_f64();
        metrics::GRPC_RESPONSE_TIME
            .with_label_values(&["/event/send_file_list", "200", "", "", "", ""])
            .observe(time);
        metrics::GRPC_INCOMING_REQUESTS
            .with_label_values(&["/event/send_file_list", "200", "", "", "", ""])
            .inc();

        Ok(Response::new(EmptyResponse {}))
    }

    async fn get_files(
        &self,
        request: Request<SimpleFileList>,
    ) -> Result<Response<Self::GetFilesStream>, Status> {
        let file_list = request.into_inner();
        let (tx, rx) = tokio::sync::mpsc::channel(4);

        // Spawn a task to handle the streaming
        tokio::spawn(async move {
            for path in file_list.files.iter() {
                if let Err(e) = handle_file_chunked(path, tx.clone()).await {
                    log::error!("[gRPC:Event] Failed to handle file {}: {}", path, e);
                    break;
                }
            }
        });

        Ok(Response::new(ReceiverStream::new(rx)))
    }
}

async fn handle_file_chunked(
    path: &str,
    tx: tokio::sync::mpsc::Sender<Result<FileContentResponse, Status>>,
) -> Result<(), Status> {
    let start = std::time::Instant::now();
    let filename = path.to_string();
    let mut offset = 0usize;
    let total_size = disk::get_size(path).await.unwrap_or(0);

    while offset < total_size as usize {
        let chunk_size = std::cmp::min(CHUNK_SIZE, total_size - offset);
        let chunk = match infra::cache::file_data::disk::get(
            path,
            Some(Range {
                start: offset,
                end: offset + chunk_size,
            }),
        )
        .await
        {
            Some(file_data) => file_data,
            None => {
                if let Err(e) = tx.send(Err(Status::not_found(path))).await {
                    log::error!("[gRPC:Event] Failed to send error: {}", e);
                }
                return Err(Status::not_found(path));
            }
        };

        let response = FileContentResponse {
            entries: vec![FileContent {
                content: chunk.to_vec(),
                filename: filename.clone(),
            }],
        };

        if let Err(e) = tx.send(Ok(response)).await {
            log::error!("[gRPC:Event] Failed to send file chunk: {}", e);
            return Err(Status::internal("Failed to send file chunk"));
        }

        offset += chunk_size;
    }

    log::info!(
        "[gRPC:Event] Send file: {}, total_size: {}, offset: {} took: {} ms",
        path,
        total_size,
        offset,
        start.elapsed().as_millis()
    );

    Ok(())
}

async fn download_from_node(
    addr: &str,
    files: &[(String, String, usize)],
) -> Result<Vec<(String, String, usize)>> {
    let start = std::time::Instant::now();
    let cfg = get_config();
    log::debug!(
        "[gRPC:Event] Download files from node start, files: {:?}",
        files.len()
    );

    let token: MetadataValue<_> = get_internal_grpc_token()
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid token"))?;

    let channel = crate::service::grpc::get_cached_channel(addr).await?;
    let client = EventClient::with_interceptor(channel, move |mut req: Request<()>| {
        req.metadata_mut().insert("authorization", token.clone());
        Ok(req)
    });

    let file_size_map = files
        .iter()
        .map(|(_, f, s)| (f, *s))
        .collect::<HashMap<_, _>>();
    let request = Request::new(SimpleFileList {
        files: files.iter().map(|(_, f, _)| f.to_string()).collect(),
    });

    let resp = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .get_files(request)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to get files from {addr}, {e}"))?;

    let mut file_contents = HashMap::new();
    let mut downloaded_files = HashSet::new();
    let mut resp_stream = resp.into_inner();
    while let Some(resp) = resp_stream.next().await {
        let resp = match resp {
            Ok(resp) => resp,
            Err(err) => {
                if err.code() == tonic::Code::NotFound {
                    log::debug!(
                        "[gRPC:Event] Failed to download file {} from {}: file not found",
                        err.message(),
                        addr
                    );
                    continue;
                }
                return Err(anyhow::anyhow!(
                    "Failed to download file from {addr}, {err}"
                ));
            }
        };
        for content in resp.entries {
            let entry = file_contents
                .entry(content.filename.clone())
                .or_insert(bytes::BytesMut::new());
            entry.extend_from_slice(&content.content);
            downloaded_files.insert(content.filename);
        }
    }

    log::debug!(
        "[gRPC:Event] Successfully retrieved {} files from {} in {} ms",
        downloaded_files.len(),
        addr,
        start.elapsed().as_millis()
    );

    // Cache the file contents
    for (file, content) in file_contents {
        let data = content.freeze();
        if let Some(size) = file_size_map.get(&file) {
            if *size != data.len() {
                log::warn!(
                    "[gRPC:Event] Failed to download file {} from {}: size mismatch, expected {} but got {}",
                    file,
                    addr,
                    size,
                    data.len()
                );
                downloaded_files.remove(&file);
                continue;
            }
        }
        if let Err(e) = infra::cache::file_data::set(&file, data).await {
            log::error!("[gRPC:Event] Failed to cache file {}: {}", file, e);
            downloaded_files.remove(&file);
        }
    }

    // Return list of failed files
    let failed_files: Vec<_> = files
        .iter()
        .filter(|(_, f, _)| !downloaded_files.contains(f))
        .cloned()
        .collect();

    log::debug!(
        "[gRPC:Event] Failed to retrieve {} files from {} in {} ms",
        failed_files.len(),
        addr,
        start.elapsed().as_millis()
    );

    Ok(failed_files)
}
