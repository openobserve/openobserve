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
    cluster::LOCAL_NODE, get_config, meta::stream::FileKey, metrics,
    utils::inverted_index::convert_parquet_file_name_to_tantivy_file,
};
use infra::cache::file_data::{CacheType, TRACE_ID_FOR_CACHE_LATEST_FILE, disk};
use opentelemetry::global;
use proto::cluster_rpc::{
    EmptyResponse, FileContent, FileContentResponse, FileList, SimpleFileList, event_server::Event,
};
use tokio_stream::wrappers::ReceiverStream;
use tonic::{Request, Response, Status, codegen::tokio_stream};
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
        let _ = tracing::Span::current().set_parent(parent_cx);

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
                        item.id,
                        item.account.clone(),
                        item.key.clone(),
                        item.meta.compressed_size,
                        item.meta.max_ts,
                    ));
                }

                // cache index for the parquet
                if cfg.cache_latest_files.cache_index
                    && item.meta.index_size > 0
                    && let Some(ttv_file) = convert_parquet_file_name_to_tantivy_file(&item.key)
                {
                    files_to_download.push((
                        item.id,
                        item.account.clone(),
                        ttv_file,
                        item.meta.index_size,
                        item.meta.max_ts,
                    ));
                }
            }

            // Try batch download first
            if get_config().cache_latest_files.download_from_node {
                let mut failed_files = Vec::new();

                // Try batch download files
                if !files_to_download.is_empty() {
                    match crate::job::download_from_node(&grpc_addr, &files_to_download).await {
                        Ok(failed) => failed_files = failed,
                        Err(e) => {
                            log::error!("[gRPC:Event] Failed to get files from notifier: {e}");
                            failed_files = files_to_download;
                        }
                    }
                }

                // Fallback to individual downloads for failed files
                for (id, account, file, size, ts) in failed_files {
                    if let Err(e) = crate::job::queue_download(
                        TRACE_ID_FOR_CACHE_LATEST_FILE.to_string(),
                        id,
                        account,
                        file,
                        size,
                        ts,
                        CacheType::Disk,
                    )
                    .await
                    {
                        log::error!("[gRPC:Event] Failed to cache file data: {e}");
                    }
                }
            } else {
                // Direct download when download_from_node_enabled is false
                for (id, account, file, size, ts) in files_to_download {
                    if let Err(e) = crate::job::queue_download(
                        TRACE_ID_FOR_CACHE_LATEST_FILE.to_string(),
                        id,
                        account,
                        file,
                        size,
                        ts,
                        CacheType::Disk,
                    )
                    .await
                    {
                        log::error!("[gRPC:Event] Failed to cache file data: {e}");
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
                                        convert_parquet_file_name_to_tantivy_file(&v.key)
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
                    log::error!("[gRPC:Event] Failed to handle file {path}: {e}");
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
    let mut offset = 0u64;
    let total_size = disk::get_size(path).await.unwrap_or(0) as u64;

    while offset < total_size {
        let chunk_size = std::cmp::min(CHUNK_SIZE as u64, total_size - offset);
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
                    log::error!("[gRPC:Event] Failed to send error: {e}");
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
            log::error!("[gRPC:Event] Failed to send file chunk: {e}");
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

#[cfg(test)]
mod tests {
    use proto::cluster_rpc::{FileKey, FileList, FileMeta};

    use super::*;

    #[test]
    fn test_file_content_response_creation() {
        // Test creating a FileContentResponse
        let file_content = FileContent {
            content: b"test content".to_vec(),
            filename: "test.txt".to_string(),
        };

        let response = FileContentResponse {
            entries: vec![file_content.clone()],
        };

        assert_eq!(response.entries.len(), 1);
        assert_eq!(response.entries[0].content, b"test content");
        assert_eq!(response.entries[0].filename, "test.txt");
    }

    #[test]
    fn test_file_key_creation() {
        // Test creating FileKey directly
        let file_key = FileKey {
            id: 123,
            key: "test/file.parquet".to_string(),
            account: "test_account".to_string(),
            deleted: false,
            meta: Some(FileMeta {
                compressed_size: 1024,
                index_size: 512,
                max_ts: 1234567890,
                ..Default::default()
            }),
            segment_ids: None,
        };

        assert_eq!(file_key.id, 123);
        assert_eq!(file_key.key, "test/file.parquet");
        assert_eq!(file_key.account, "test_account");
    }

    #[test]
    fn test_filter_deleted_items() {
        // Test filtering deleted items from FileList
        let items = [
            FileKey {
                id: 1,
                key: "test/file1.parquet".to_string(),
                account: "test_account".to_string(),
                deleted: false,
                meta: Some(FileMeta {
                    compressed_size: 1024,
                    index_size: 512,
                    max_ts: 1234567890,
                    ..Default::default()
                }),
                segment_ids: None,
            },
            FileKey {
                id: 2,
                key: "test/file2.parquet".to_string(),
                account: "test_account".to_string(),
                deleted: true,
                meta: Some(FileMeta {
                    compressed_size: 2048,
                    index_size: 1024,
                    max_ts: 1234567891,
                    ..Default::default()
                }),
                segment_ids: None,
            },
            FileKey {
                id: 3,
                key: "test/file3.parquet".to_string(),
                account: "test_account".to_string(),
                deleted: false,
                meta: Some(FileMeta {
                    compressed_size: 3072,
                    index_size: 1536,
                    max_ts: 1234567892,
                    ..Default::default()
                }),
                segment_ids: None,
            },
        ];

        let non_deleted_items: Vec<&FileKey> = items.iter().filter(|v| !v.deleted).collect();

        assert_eq!(non_deleted_items.len(), 2);
        assert_eq!(non_deleted_items[0].id, 1);
        assert_eq!(non_deleted_items[1].id, 3);
    }

    #[test]
    fn test_chunk_size_calculation() {
        // Test chunk size calculation logic
        let total_size = 10000u64;
        let mut offset = 0u64;
        let chunk_size = 4096u64;

        let mut chunks = Vec::new();
        while offset < total_size {
            let current_chunk_size = std::cmp::min(chunk_size, total_size - offset);
            chunks.push(current_chunk_size);
            offset += current_chunk_size;
        }

        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0], 4096);
        assert_eq!(chunks[1], 4096);
        assert_eq!(chunks[2], 1808); // 10000 - 8192
        assert_eq!(offset, total_size);
    }

    #[test]
    fn test_range_creation() {
        // Test creating ranges for file reading
        let offset = 1024u64;
        let chunk_size = 512u64;
        let range = Range {
            start: offset,
            end: offset + chunk_size,
        };

        assert_eq!(range.start, 1024);
        assert_eq!(range.end, 1536);
        assert_eq!(range.end - range.start, 512);
    }

    #[test]
    fn test_file_meta_validation() {
        // Test FileMeta validation
        let valid_meta = FileMeta {
            compressed_size: 1024,
            index_size: 512,
            max_ts: 1234567890,
            ..Default::default()
        };

        assert!(valid_meta.compressed_size > 0);
        assert!(valid_meta.index_size > 0);
        assert!(valid_meta.max_ts > 0);

        // Test with zero values
        let zero_meta = FileMeta {
            compressed_size: 0,
            index_size: 0,
            max_ts: 0,
            ..Default::default()
        };

        assert_eq!(zero_meta.compressed_size, 0);
        assert_eq!(zero_meta.index_size, 0);
        assert_eq!(zero_meta.max_ts, 0);
    }

    #[test]
    fn test_cache_type_enum() {
        // Test CacheType enum values
        assert_eq!(CacheType::Disk as u32, 0);
        assert_eq!(CacheType::Memory as u32, 1);
    }

    #[test]
    fn test_metadata_map_creation() {
        // Test MetadataMap creation from tonic Request
        let mut metadata = tonic::metadata::MetadataMap::new();
        metadata.insert("test_key", "test_value".parse().unwrap());

        let request = Request::new(FileList {
            node_addr: "test_node".to_string(),
            items: vec![],
        });
        // Note: We can't easily test MetadataMap extraction without a real gRPC context
        // This test just ensures the type exists and can be referenced
        let _metadata_map = MetadataMap(&request.metadata().clone());
    }

    #[test]
    fn test_empty_response_creation() {
        // Test EmptyResponse creation
        let empty_response = EmptyResponse {};
        // EmptyResponse is a unit struct, so its size is 0
        assert_eq!(std::mem::size_of_val(&empty_response), 0);
    }

    #[test]
    fn test_convert_parquet_to_tantivy_filename() {
        // Test parquet to tantivy filename conversion
        let parquet_file =
            "files/default/logs/quickstart1/2024/02/16/16/7164299619311026293.parquet";
        let tantivy_file = convert_parquet_file_name_to_tantivy_file(parquet_file);

        // The conversion should return Some for valid parquet files
        assert!(tantivy_file.is_some());
        assert_eq!(
            tantivy_file.unwrap(),
            "files/default/index/quickstart1_logs/2024/02/16/16/7164299619311026293.ttv"
        );

        // Test with non-parquet file
        let non_parquet_file = "test/file.txt";
        let tantivy_result = convert_parquet_file_name_to_tantivy_file(non_parquet_file);
        assert!(tantivy_result.is_none());

        // Test with invalid path format
        let invalid_path = "test/file.parquet";
        let invalid_result = convert_parquet_file_name_to_tantivy_file(invalid_path);
        assert!(invalid_result.is_none());
    }

    #[test]
    fn test_file_download_batch_creation() {
        // Test creating file download batch
        let files_to_download = [
            (
                "file1".to_string(),
                "account1".to_string(),
                "key1".to_string(),
                1024,
                1234567890,
            ),
            (
                "file2".to_string(),
                "account2".to_string(),
                "key2".to_string(),
                2048,
                1234567891,
            ),
        ];

        assert_eq!(files_to_download.len(), 2);
        assert_eq!(files_to_download[0].0, "file1");
        assert_eq!(files_to_download[0].1, "account1");
        assert_eq!(files_to_download[0].2, "key1");
        assert_eq!(files_to_download[0].3, 1024);
        assert_eq!(files_to_download[0].4, 1234567890);
    }

    #[test]
    fn test_error_handling_patterns() {
        // Test common error handling patterns used in the code
        let result: Result<(), anyhow::Error> = Err(anyhow::anyhow!("test error"));

        match result {
            Ok(_) => panic!("Expected error"),
            Err(e) => {
                assert_eq!(e.to_string(), "test error");
            }
        }
    }

    #[test]
    fn test_logging_patterns() {
        // Test that logging patterns are consistent
        let path = "test/file.parquet";
        let total_size = 1024u64;
        let offset = 512u64;
        let elapsed_ms = 100u128;

        // This test just ensures the logging format is valid
        let log_message = format!(
            "[gRPC:Event] Send file: {path}, total_size: {total_size}, offset: {offset} took: {elapsed_ms} ms"
        );

        assert!(log_message.contains(path));
        assert!(log_message.contains(&total_size.to_string()));
        assert!(log_message.contains(&offset.to_string()));
        assert!(log_message.contains(&elapsed_ms.to_string()));
    }
}
