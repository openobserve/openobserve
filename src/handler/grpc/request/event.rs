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
use bytes::Bytes;
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{cluster::get_internal_grpc_token, stream::FileKey},
    metrics,
    utils::inverted_index::convert_parquet_idx_file_name_to_tantivy_file,
};
use futures_util::StreamExt;
use infra::cache::file_data::{TRACE_ID_FOR_CACHE_LATEST_FILE, disk};
use opentelemetry::global;
use proto::cluster_rpc::{
    EmptyResponse, FileContent, FileContentResponse, FileList, SimpleFileList,
    event_client::EventClient, event_server::Event,
};
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
    type GetFilesStream =
        tokio_stream::wrappers::ReceiverStream<Result<FileContentResponse, Status>>;

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
            let mut index_files_to_download = Vec::new();

            // Collect files to download
            for item in put_items.iter() {
                // cache parquet
                if cfg.cache_latest_files.cache_parquet {
                    files_to_download.push((item.key.clone(), item.meta.compressed_size));
                }

                // cache index for the parquet
                if cfg.cache_latest_files.cache_index && item.meta.index_size > 0 {
                    if let Some(ttv_file) = convert_parquet_idx_file_name_to_tantivy_file(&item.key)
                    {
                        index_files_to_download.push((ttv_file, item.meta.index_size));
                    }
                }
            }

            // Try batch download first
            if get_config().cache_latest_files.download_from_node {
                let mut failed_files = Vec::new();
                let mut failed_index_files = Vec::new();

                // Try batch download for parquet files
                if !files_to_download.is_empty() {
                    match get_files_from_notifier(&grpc_addr, &files_to_download).await {
                        Ok(failed) => failed_files = failed,
                        Err(e) => {
                            log::error!("Failed to get files from notifier: {}", e);
                            failed_files = files_to_download;
                        }
                    }
                }

                // Try batch download for index files
                if !index_files_to_download.is_empty() {
                    match get_files_from_notifier(&grpc_addr, &index_files_to_download).await {
                        Ok(failed) => failed_index_files = failed,
                        Err(e) => {
                            log::error!("Failed to get index files from notifier: {}", e);
                            failed_index_files = index_files_to_download;
                        }
                    }
                }

                // Fallback to individual downloads for failed files
                for (file, size) in failed_files {
                    if let Err(e) = infra::cache::file_data::download(
                        TRACE_ID_FOR_CACHE_LATEST_FILE,
                        &file,
                        Some(size as usize),
                    )
                    .await
                    {
                        log::error!("Failed to cache file data: {}", e);
                    }
                }

                for (file, size) in failed_index_files {
                    if let Err(e) = infra::cache::file_data::download(
                        TRACE_ID_FOR_CACHE_LATEST_FILE,
                        &file,
                        Some(size as usize),
                    )
                    .await
                    {
                        log::error!("Failed to cache index file data: {}", e);
                    }
                }
            } else {
                // Direct download when download_from_node_enabled is false
                for (file, size) in files_to_download {
                    if let Err(e) = infra::cache::file_data::download(
                        TRACE_ID_FOR_CACHE_LATEST_FILE,
                        &file,
                        Some(size as usize),
                    )
                    .await
                    {
                        log::error!("Failed to cache file data: {}", e);
                    }
                }

                for (file, size) in index_files_to_download {
                    if let Err(e) = infra::cache::file_data::download(
                        TRACE_ID_FOR_CACHE_LATEST_FILE,
                        &file,
                        Some(size as usize),
                    )
                    .await
                    {
                        log::error!("Failed to cache index file data: {}", e);
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
        let (tx, rx) = tokio::sync::mpsc::channel(32);

        // Spawn a task to handle the streaming
        tokio::spawn(async move {
            for path in file_list.paths.iter() {
                log::info!("handle_file_chunked: {}", path);
                if let Err(e) = handle_file_chunked(path, tx.clone()).await {
                    log::error!("Failed to handle file {}: {}", path, e);
                    break;
                }
            }
        });

        Ok(Response::new(tokio_stream::wrappers::ReceiverStream::new(
            rx,
        )))
    }
}

async fn handle_file_chunked(
    path: &str,
    tx: tokio::sync::mpsc::Sender<Result<FileContentResponse, Status>>,
) -> Result<(), Status> {
    let start = std::time::Instant::now();
    let filename = path.to_string();
    let mut offset = 0_u64;
    let total_size = disk::get_size(path).await.unwrap_or(0) as u64;

    while offset < total_size {
        let chunk_size = std::cmp::min(CHUNK_SIZE as u64, total_size - offset);
        log::debug!(
            "handle_file_chunked {} offset: {}, chunk_size: {}",
            filename,
            offset,
            chunk_size
        );

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
                    log::error!("Failed to send error: {}", e);
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
            log::error!("Failed to send file chunk: {}", e);
            return Err(Status::internal("Failed to send file chunk"));
        }

        offset += chunk_size;
    }

    log::info!(
        "handle file:{}, total_size: {}, offset: {} elapsed: {}ms",
        path,
        total_size,
        offset,
        start.elapsed().as_millis()
    );

    Ok(())
}

async fn get_files_from_notifier(
    addr: &str,
    files_meta: &[(String, i64)],
) -> Result<Vec<(String, i64)>> {
    let start = std::time::Instant::now();
    log::debug!("get_files_from_notifier start, files: {:?}", files_meta);
    let token: MetadataValue<_> = get_internal_grpc_token()
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid token"))?;

    let channel = crate::service::grpc::get_cached_channel(addr).await?;
    let client = EventClient::with_interceptor(channel, move |mut req: Request<()>| {
        req.metadata_mut().insert("authorization", token.clone());
        Ok(req)
    });

    let filekeys = files_meta
        .iter()
        .map(|(path, _)| path.clone())
        .collect::<Vec<String>>();
    let mut request = Request::new(SimpleFileList {
        paths: filekeys.to_vec(),
    });
    request.set_timeout(std::time::Duration::from_secs(
        get_config().limit.query_timeout,
    ));

    let response = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(
            get_config().cache_latest_files.download_from_node_max_size * 1024 * 1024,
        )
        .max_encoding_message_size(
            get_config().cache_latest_files.download_from_node_max_size * 1024 * 1024,
        )
        .get_files(request)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to get files from {addr}, {e}"))?;

    let mut response_stream = response.into_inner();
    let mut file_contents = std::collections::HashMap::new();
    let mut downloaded_files = std::collections::HashSet::new();

    while let Some(response) = response_stream.next().await {
        let response =
            response.map_err(|e| anyhow::anyhow!("Failed to receive file chunk: {}", e))?;
        for content in response.entries {
            file_contents.insert(content.filename.clone(), content.content);
            downloaded_files.insert(content.filename);
        }
    }

    let time = start.elapsed().as_millis();
    log::debug!(
        "Successfully retrieved {} files from {} in {}ms",
        downloaded_files.len(),
        addr,
        time
    );

    // Cache the file contents
    for (filekey, content) in file_contents {
        let bytes = Bytes::from(content);
        if let Err(e) =
            infra::cache::file_data::set(TRACE_ID_FOR_CACHE_LATEST_FILE, &filekey, bytes).await
        {
            log::error!("Failed to cache file {}: {}", filekey, e);
            downloaded_files.remove(&filekey);
        } else {
            log::info!("file:{} infra cache set successfully", filekey);
        }
    }

    // Return list of failed files
    let failed_files: Vec<_> = files_meta
        .iter()
        .filter(|(f, _)| !downloaded_files.contains(f))
        .cloned()
        .collect();
    log::debug!(
        "Failed retrieved {} files from {} in {}ms",
        failed_files.len(),
        addr,
        time
    );

    Ok(failed_files)
}
