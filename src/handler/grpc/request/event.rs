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

use anyhow::{Context, Result};
use bytes::Bytes;
use config::{
    cluster::LOCAL_NODE,
    get_config,
    meta::{cluster::get_internal_grpc_token, stream::FileKey},
    metrics,
    utils::inverted_index::convert_parquet_idx_file_name_to_tantivy_file,
};
use infra::cache::file_data::TRACE_ID_FOR_CACHE_LATEST_FILE;
use opentelemetry::global;
use proto::{
    cluster_rpc,
    cluster_rpc::{
        EmptyResponse, FileContent, FileContentResponse, FileList, event_client::EventClient,
        event_server::Event,
    },
};
use tonic::{
    Request, Response, Status, codec::CompressionEncoding, metadata::MetadataValue,
    transport::Channel,
};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::handler::grpc::MetadataMap;

pub struct Eventer;

#[tonic::async_trait]
impl Event for Eventer {
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
            for item in put_items.iter() {
                // cache parquet
                if cfg.cache_latest_files.cache_parquet {
                    if let Err(e) = get_files_from_notifier(&grpc_addr, item).await {
                        log::error!("Failed to get files from notifier: {}", e);
                        if let Err(e) = infra::cache::file_data::download(
                            TRACE_ID_FOR_CACHE_LATEST_FILE,
                            &item.key,
                        )
                        .await
                        {
                            log::error!("Failed to cache file data: {}", e);
                        }
                    }
                }
                // cache index for the parquet
                if cfg.cache_latest_files.cache_index && item.meta.index_size > 0 {
                    if let Some(ttv_file) = convert_parquet_idx_file_name_to_tantivy_file(&item.key)
                    {
                        let filekey = FileKey::from_file_name(&ttv_file);
                        if let Err(e) = get_files_from_notifier(&grpc_addr, &filekey).await {
                            log::error!("Failed to get files from notifier: {}", e);
                            if let Err(e) = infra::cache::file_data::download(
                                TRACE_ID_FOR_CACHE_LATEST_FILE,
                                &ttv_file,
                            )
                            .await
                            {
                                log::error!("Failed to cache file data: {}", e);
                            }
                        }
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
        request: Request<FileList>,
    ) -> Result<Response<FileContentResponse>, Status> {
        let file_list = request.into_inner();
        let mut entries = Vec::new();

        for file_key in file_list.items {
            match handle_file(&file_key.key).await {
                Ok(content) => {
                    entries.push(content);
                }
                Err(e) => {
                    log::error!("Failed to retrieve file {}: {}", file_key.key, e);
                    return Err(e);
                }
            }
        }

        Ok(Response::new(FileContentResponse { entries }))
    }
}

async fn handle_file(path: &str) -> Result<FileContent, Status> {
    let start = std::time::Instant::now();

    let file_data = match infra::cache::file_data::disk::get(path, None).await {
        Some(file_data) => file_data,
        None => return Err(Status::not_found(path)),
    };

    // Create the FileContent response
    let content = FileContent {
        content: file_data.to_vec(),
        filename: path.to_string(),
    };

    log::info!(
        "handle file:{path} elasped: {}",
        start.elapsed().as_millis()
    );

    Ok(content)
}
// filekey: files/default/logs/pipeline/2025/04/23/04/7320670336138084366.parquet
async fn get_files_from_notifier(addr: &str, filekey: &FileKey) -> Result<()> {
    let start = std::time::Instant::now();
    let token: MetadataValue<_> = get_internal_grpc_token()
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid token"))?;

    let cfg = config::get_config();
    let channel = Channel::from_shared(addr.to_string())
        .map_err(|e| anyhow::anyhow!("Invalid address format: {}", e))?
        .connect_timeout(std::time::Duration::from_secs(cfg.grpc.connect_timeout))
        .connect()
        .await
        .with_context(|| format!("Failed to connect to cluster: {}", addr))?;

    let client = EventClient::with_interceptor(channel, move |mut req: Request<()>| {
        req.metadata_mut().insert("authorization", token.clone());
        Ok(req)
    });

    let key = filekey.key.clone();
    let mut request = Request::new(FileList {
        items: vec![cluster_rpc::FileKey::from(filekey)],
        node_addr: LOCAL_NODE.grpc_addr.clone(),
    });
    request.set_timeout(std::time::Duration::from_secs(cfg.limit.query_timeout));

    let response = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(250 * 1024 * 1024)
        .max_encoding_message_size(250 * 1024 * 1024)
        .get_files(request)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to get file: {key} from {addr}, {e}"))?;

    let response_data = response.into_inner();
    let file = response_data
        .entries
        .first()
        .ok_or_else(|| anyhow::anyhow!("No file content returned from {}", addr))?;

    let time = start.elapsed().as_millis();
    log::info!(
        "Successfully retrieved file:{} from {} in {}ms",
        file.filename,
        addr,
        time
    );

    // Cache the file content
    let bytes = Bytes::from(file.content.clone());
    match infra::cache::file_data::set(TRACE_ID_FOR_CACHE_LATEST_FILE, &file.filename, bytes).await
    {
        Ok(res) => {
            log::info!("file:{} infra cache set successfully", file.filename);
            Ok(res)
        }
        Err(e) => Err(e),
    }
}
