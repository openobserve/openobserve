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

use std::io::Write;

use config::{
    cluster::LOCAL_NODE_UUID,
    ider,
    meta::{
        cluster::Node,
        search::ScanStats,
        stream::{FileKey, FileMeta, PartitionTimeLevel, StreamType},
    },
    utils::{file::get_file_meta as util_get_file_meta, json},
    CONFIG,
};
use futures::future::try_join_all;
use infra::{
    errors::{Error, ErrorCodes},
    file_list, storage,
};
use proto::cluster_rpc;
use tonic::{codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{
    common::infra::cluster,
    service::{db, search::MetadataMap},
};

pub async fn query(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_level: PartitionTimeLevel,
    time_min: i64,
    time_max: i64,
    is_local: bool,
) -> Result<Vec<FileKey>, anyhow::Error> {
    if is_local || CONFIG.common.local_mode {
        return query_inner(
            org_id,
            stream_name,
            stream_type,
            time_level,
            time_min,
            time_max,
        )
        .await;
    }

    // cluster mode
    let start: std::time::Instant = std::time::Instant::now();
    let nodes = cluster::get_cached_online_querier_nodes()
        .await
        .unwrap_or_default();
    if nodes.is_empty() {
        return Ok(Vec::new());
    }
    let mut tasks = Vec::with_capacity(3);
    // get first three nodes to check file list max id
    for node in nodes.into_iter().take(3) {
        let org_id = org_id.to_string();
        let task = tokio::task::spawn(async move {
            let req = cluster_rpc::EmptyRequest::default();
            let org_id: MetadataValue<_> = org_id
                .parse()
                .map_err(|_| Error::Message("invalid org_id".to_string()))?;
            let mut request = tonic::Request::new(req);

            opentelemetry::global::get_text_map_propagator(|propagator| {
                propagator.inject_context(
                    &tracing::Span::current().context(),
                    &mut MetadataMap(request.metadata_mut()),
                )
            });

            let token: MetadataValue<_> = cluster::get_internal_grpc_token()
                .parse()
                .map_err(|_| Error::Message("invalid token".to_string()))?;
            let channel = Channel::from_shared(node.grpc_addr.clone())
                .unwrap()
                .connect_timeout(std::time::Duration::from_secs(CONFIG.grpc.connect_timeout))
                .connect()
                .await
                .map_err(|err| {
                    log::error!(
                        "file_list->grpc: node: {}, connect err: {:?}",
                        &node.grpc_addr,
                        err
                    );
                    Error::ErrorCode(ErrorCodes::ServerInternalError(
                        "connect querier error".to_string(),
                    ))
                })?;
            let mut client = cluster_rpc::filelist_client::FilelistClient::with_interceptor(
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
                .accept_compressed(CompressionEncoding::Gzip)
                .max_decoding_message_size(CONFIG.grpc.max_message_size * 1024 * 1024)
                .max_encoding_message_size(CONFIG.grpc.max_message_size * 1024 * 1024);
            let response: cluster_rpc::MaxIdResponse = match client.max_id(request).await {
                Ok(res) => res.into_inner(),
                Err(err) => {
                    log::error!(
                        "file_list->grpc: node: {}, query max_id err: {:?}",
                        &node.grpc_addr,
                        err
                    );
                    if err.code() == tonic::Code::Internal {
                        let err = ErrorCodes::from_json(err.message())?;
                        return Err(Error::ErrorCode(err));
                    }
                    return Err(Error::ErrorCode(ErrorCodes::ServerInternalError(format!(
                        "search node response error: {}",
                        err
                    ))));
                }
            };
            Ok((node, response.max_id))
        });
        tasks.push(task);
    }
    let mut max_id: i64 = 0;
    let mut max_id_node: Option<Node> = None;
    let task_results = try_join_all(tasks).await?;
    for task in task_results {
        let res = task?;
        if res.1 > max_id {
            max_id = res.1;
            max_id_node = Some(res.0);
        }
    }
    if max_id_node.is_none() {
        return Ok(Vec::new());
    }
    let node = max_id_node.unwrap();
    if node.uuid.eq(LOCAL_NODE_UUID.as_str()) {
        // local node, no need grpc call
        let files = query_inner(
            org_id,
            stream_name,
            stream_type,
            time_level,
            time_min,
            time_max,
        )
        .await?;
        log::info!(
            "file_list->local: query list: {}, time: {}ms",
            files.len(),
            start.elapsed().as_millis()
        );
        return Ok(files);
    }
    // use the max_id node to query file_list
    let req = cluster_rpc::FileListQueryRequest {
        org_id: org_id.to_string(),
        stream_name: stream_name.to_string(),
        stream_type: stream_type.to_string(),
        time_level: time_level.to_string(),
        start_time: time_min,
        end_time: time_max,
    };
    let org_id: MetadataValue<_> = org_id
        .parse()
        .map_err(|_| Error::Message("invalid org_id".to_string()))?;
    let mut request = tonic::Request::new(req);

    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(
            &tracing::Span::current().context(),
            &mut MetadataMap(request.metadata_mut()),
        )
    });

    let token: MetadataValue<_> = cluster::get_internal_grpc_token()
        .parse()
        .map_err(|_| Error::Message("invalid token".to_string()))?;
    let channel = Channel::from_shared(node.grpc_addr.clone())
        .unwrap()
        .connect_timeout(std::time::Duration::from_secs(CONFIG.grpc.connect_timeout))
        .connect()
        .await
        .map_err(|err| {
            log::error!(
                "file_list->grpc: node: {}, connect err: {:?}",
                &node.grpc_addr,
                err
            );
            Error::ErrorCode(ErrorCodes::ServerInternalError(format!(
                "connect to search node error: {}",
                err
            )))
        })?;
    let mut client = cluster_rpc::filelist_client::FilelistClient::with_interceptor(
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
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(CONFIG.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(CONFIG.grpc.max_message_size * 1024 * 1024);
    let response: cluster_rpc::FileList = match client.query(request).await {
        Ok(res) => res.into_inner(),
        Err(err) => {
            log::error!(
                "file_list->grpc: node: {}, query list err: {:?}",
                &node.grpc_addr,
                err
            );
            if err.code() == tonic::Code::Internal {
                let err = ErrorCodes::from_json(err.message())?;
                return Err(anyhow::anyhow!(Error::ErrorCode(err).to_string()));
            }
            return Err(anyhow::anyhow!("search node error".to_string()));
        }
    };
    let files = response.items.iter().map(FileKey::from).collect::<Vec<_>>();
    log::info!(
        "file_list->grpc: node: {}, query list: {}, time: {}ms",
        &node.grpc_addr,
        files.len(),
        start.elapsed().as_millis()
    );
    Ok(files)
}

#[inline]
async fn query_inner(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    time_level: PartitionTimeLevel,
    time_min: i64,
    time_max: i64,
) -> Result<Vec<FileKey>, anyhow::Error> {
    let files = file_list::query(
        org_id,
        stream_type,
        stream_name,
        time_level,
        (time_min, time_max),
    )
    .await?;
    let mut file_keys = Vec::with_capacity(files.len());
    for file in files {
        file_keys.push(FileKey {
            key: file.0,
            meta: file.1,
            deleted: false,
        });
    }
    Ok(file_keys)
}

#[inline]
pub async fn get_file_meta(file: &str) -> Result<FileMeta, anyhow::Error> {
    Ok(file_list::get(file).await?)
}

#[inline]
pub async fn calculate_files_size(files: &[FileKey]) -> Result<ScanStats, anyhow::Error> {
    let mut stats = ScanStats::new();
    stats.files = files.len() as i64;
    for file in files {
        stats.records += file.meta.records;
        stats.original_size += file.meta.original_size;
        stats.compressed_size += file.meta.compressed_size;
    }
    Ok(stats)
}

#[inline]
pub fn calculate_local_files_size(files: &[String]) -> Result<u64, anyhow::Error> {
    let mut size = 0;
    for file in files {
        let file_size = match util_get_file_meta(file) {
            Ok(resp) => resp.len(),
            Err(_) => 0,
        };
        size += file_size;
    }
    Ok(size)
}

// Delete one parquet file and update the file list
pub async fn delete_parquet_file(key: &str, file_list_only: bool) -> Result<(), anyhow::Error> {
    if CONFIG.common.meta_store_external {
        delete_parquet_file_db_only(key, file_list_only).await
    } else {
        delete_parquet_file_s3(key, file_list_only).await
    }
}

async fn delete_parquet_file_db_only(key: &str, file_list_only: bool) -> Result<(), anyhow::Error> {
    // delete from file list in metastore
    file_list::batch_remove(&[key.to_string()]).await?;

    // delete the parquet whaterever the file is exists or not
    if !file_list_only {
        _ = storage::del(&[key]).await;
    }
    Ok(())
}

async fn delete_parquet_file_s3(key: &str, file_list_only: bool) -> Result<(), anyhow::Error> {
    let columns = key.split('/').collect::<Vec<&str>>();
    if columns[0] != "files" || columns.len() < 9 {
        return Ok(());
    }
    let new_file_list_key = format!(
        "file_list/{}/{}/{}/{}/{}.json.zst",
        columns[4],
        columns[5],
        columns[6],
        columns[7],
        ider::generate()
    );

    let meta = FileMeta::default();
    let deleted = true;
    let file_data = FileKey {
        key: key.to_string(),
        meta: meta.clone(),
        deleted,
    };

    // generate the new file list
    let mut buf = zstd::Encoder::new(Vec::new(), 3)?;
    let mut write_buf = json::to_vec(&file_data)?;
    write_buf.push(b'\n');
    buf.write_all(&write_buf)?;
    let compressed_bytes = buf.finish().unwrap();
    storage::put(&new_file_list_key, compressed_bytes.into()).await?;
    db::file_list::progress(key, Some(&meta), deleted).await?;
    db::file_list::broadcast::send(&[file_data], None).await?;

    // delete the parquet whaterever the file is exists or not
    if !file_list_only {
        _ = storage::del(&[key]).await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_file_meta() {
        let res = get_file_meta(
            "files/default/logs/olympics/2022/10/03/10/6982652937134804993_1.parquet",
        )
        .await;
        assert!(res.is_err());
    }
}
