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
#![cfg(feature = "enterprise")]

use anyhow::{anyhow, Context};
use config::meta::stream::StreamType;
use futures_util::future::try_join_all;
use infra::errors::ErrorCodes;
use o2_enterprise::enterprise::super_cluster::{
    kv::cluster::{get_grpc_addr, get_local_grpc_addr, ClusterInfo},
    search::server_internal_error,
};
use proto::cluster_rpc::{
    streams_client::StreamsClient, streams_server::Streams, StreamStatEntry, StreamStatRequest,
    StreamStatResponse, StreamStats,
};
use tonic::{
    codec::CompressionEncoding, metadata::MetadataValue, transport::Channel, Request, Response,
    Status,
};

use crate::service::db;

const BATCH_DELAY_MS: u64 = 100;
const MAX_CONCURRENT_ORGS: usize = 10;

#[derive(Default)]
pub struct StreamServiceImpl;

impl StreamServiceImpl {
    fn convert_to_stream_stats(stats: &config::meta::stream::StreamStats) -> StreamStats {
        StreamStats {
            created_at: stats.created_at,
            doc_time_min: stats.doc_time_min,
            doc_time_max: stats.doc_time_max,
            doc_num: stats.doc_num,
            file_num: stats.file_num,
            storage_size: stats.storage_size,
            compressed_size: stats.compressed_size,
            index_size: stats.index_size,
        }
    }

    async fn process_org_stats(
        org_id: &str,
        stream_type: Option<StreamType>,
        stream_name: Option<&str>,
    ) -> infra::errors::Result<Vec<StreamStatEntry>> {
        let stats = infra::file_list::get_stream_stats(org_id, stream_type, stream_name).await?;

        Ok(stats
            .into_iter()
            .map(|(stream, stats)| StreamStatEntry {
                stream: stream.to_string(),
                stats: Some(Self::convert_to_stream_stats(&stats)),
            })
            .collect())
    }

    async fn process_orgs_batch(
        orgs: &[String],
        stream_type: Option<StreamType>,
        stream_name: Option<&str>,
    ) -> Vec<StreamStatEntry> {
        let mut all_entries = Vec::new();

        for chunk in orgs.chunks(MAX_CONCURRENT_ORGS) {
            let futures = chunk
                .iter()
                .map(|org_id| Self::process_org_stats(org_id, stream_type, stream_name));

            if let Ok(results) = try_join_all(futures).await {
                for entries in results {
                    all_entries.extend(entries);
                }
            }

            tokio::time::sleep(tokio::time::Duration::from_millis(BATCH_DELAY_MS)).await;
        }

        all_entries
    }
}

#[tonic::async_trait]
impl Streams for StreamServiceImpl {
    async fn stream(
        &self,
        request: Request<StreamStatRequest>,
    ) -> Result<Response<StreamStatResponse>, Status> {
        let req = request.into_inner();

        let orgs = match req.org_id {
            Some(org) => vec![org],
            None => db::schema::list_organizations_from_cache().await,
        };

        let stream_type = req.stream_type.map(|s| s.into());
        let stream_name = req.stream_name.as_deref();

        let entries = Self::process_orgs_batch(&orgs, stream_type, stream_name).await;
        log::debug!(
            "orgs:{:?}, stream_type:{:?}, stream_name:{:?}, stream stats: {:?}",
            orgs,
            stream_type,
            stream_name,
            entries
        );
        Ok(Response::new(StreamStatResponse { entries }))
    }
}

pub struct ClusterStreamClient {
    grpc_addr: String,
    auth_token: String,
}

impl ClusterStreamClient {
    pub fn new(cluster: &ClusterInfo) -> Result<Self, anyhow::Error> {
        let grpc_addr = if cluster.grpc_addr == get_grpc_addr() {
            get_local_grpc_addr()
        } else {
            cluster.grpc_addr.clone()
        };

        Ok(Self {
            grpc_addr,
            auth_token: cluster.auth_token.clone(),
        })
    }

    pub async fn get_stream_stats(&self) -> Result<StreamStatResponse, anyhow::Error> {
        let cfg = config::get_config();
        let request = self.build_request()?;
        let token: MetadataValue<_> = self.auth_token.parse().context("Invalid auth token")?;

        let channel = Channel::from_shared(self.grpc_addr.clone())
            .unwrap()
            .connect_timeout(std::time::Duration::from_secs(cfg.grpc.connect_timeout))
            .connect()
            .await
            .with_context(|| format!("Failed to connect to cluster: {}", self.grpc_addr))?;
        let client = StreamsClient::with_interceptor(channel, move |mut req: Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            Ok(req)
        });

        let mut client = client
            .send_compressed(CompressionEncoding::Gzip)
            .accept_compressed(CompressionEncoding::Gzip)
            .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
            .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);

        client
            .stream(request)
            .await
            .map(|res| res.into_inner())
            .map_err(|err| self.handle_stream_error(err))
    }

    fn build_request(&self) -> Result<Request<StreamStatRequest>, anyhow::Error> {
        let req = StreamStatRequest {
            org_id: None,
            stream_type: None,
            stream_name: None,
        };
        let mut request = Request::new(req);
        request.set_timeout(std::time::Duration::from_secs(
            config::get_config().limit.query_timeout,
        ));
        Ok(request)
    }

    fn handle_stream_error(&self, err: tonic::Status) -> anyhow::Error {
        log::error!(
            "grpc_stream: cluster: {}, search err: {:?}",
            self.grpc_addr,
            err
        );

        if err.code() == tonic::Code::Internal {
            if let Ok(err_code) = ErrorCodes::from_json(err.message()) {
                return infra::errors::Error::ErrorCode(err_code).into();
            }
        }
        server_internal_error("search node error").into()
    }
}

pub struct StreamStatsEntry {
    pub org_id: String,
    pub stream_type: String,
    pub stream_name: String,
    pub stats: config::meta::stream::StreamStats,
}

#[derive(Hash, Eq, PartialEq, Debug, Clone)]
pub struct StreamStatKey {
    pub org_id: String,
    pub stream_name: String,
    pub stream_type: String,
}

impl StreamStatKey {
    pub fn new(org_id: String, stream_name: String, stream_type: String) -> Self {
        Self {
            org_id,
            stream_name,
            stream_type,
        }
    }
}

impl TryFrom<proto::cluster_rpc::StreamStatEntry> for StreamStatsEntry {
    type Error = anyhow::Error;

    fn try_from(entry: proto::cluster_rpc::StreamStatEntry) -> Result<Self, Self::Error> {
        let stream_path_parts: usize = 3; // org_id/stream_type/stream_name
        let parts: Vec<&str> = entry.stream.split('/').collect();
        if parts.len() != stream_path_parts {
            return Err(anyhow!("Invalid stream path format: {}", entry.stream));
        }

        let stats = entry
            .stats
            .ok_or_else(|| anyhow!("Missing stats for stream: {}", entry.stream))?;

        Ok(Self {
            org_id: parts[0].to_string(),
            stream_type: parts[1].to_string(),
            stream_name: parts[2].to_string(),
            stats: config::meta::stream::StreamStats {
                created_at: stats.created_at,
                doc_time_min: stats.doc_time_min,
                doc_time_max: stats.doc_time_max,
                doc_num: stats.doc_num,
                file_num: stats.file_num,
                storage_size: stats.storage_size,
                compressed_size: stats.compressed_size,
                index_size: stats.index_size,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_convert_stream_stats() {
        let mock_stats = config::meta::stream::StreamStats {
            created_at: 1000,
            doc_time_min: 500,
            doc_time_max: 1500,
            doc_num: 100,
            file_num: 10,
            storage_size: 1024.0,
            compressed_size: 512.0,
            index_size: 256.0,
        };

        let proto_stats = StreamServiceImpl::convert_to_stream_stats(&mock_stats);

        assert_eq!(proto_stats.created_at, mock_stats.created_at);
        assert_eq!(proto_stats.doc_time_min, mock_stats.doc_time_min);
        assert_eq!(proto_stats.doc_time_max, mock_stats.doc_time_max);
    }
}
