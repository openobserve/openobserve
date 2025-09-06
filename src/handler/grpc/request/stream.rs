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

use config::meta::stream::StreamType;
use futures_util::future::try_join_all;
use proto::cluster_rpc::{
    StreamStats, StreamStatsEntry, StreamStatsRequest, StreamStatsResponse, streams_server::Streams,
};
use tonic::{Request, Response, Status};

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
    ) -> infra::errors::Result<Vec<StreamStatsEntry>> {
        let stats = infra::file_list::get_stream_stats(org_id, stream_type, stream_name).await?;

        Ok(stats
            .into_iter()
            .map(|(stream, stats)| StreamStatsEntry {
                stream: stream.to_string(),
                stats: Some(Self::convert_to_stream_stats(&stats)),
            })
            .collect())
    }

    async fn process_orgs_batch(
        orgs: &[String],
        stream_type: Option<StreamType>,
        stream_name: Option<&str>,
    ) -> Vec<StreamStatsEntry> {
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
    async fn stream_stats(
        &self,
        request: Request<StreamStatsRequest>,
    ) -> Result<Response<StreamStatsResponse>, Status> {
        let req = request.into_inner();

        let orgs = match req.org_id {
            Some(org) => vec![org],
            None => db::schema::list_organizations_from_cache().await,
        };

        let stream_type = req.stream_type.map(|s| s.into());
        let stream_name = req.stream_name.as_deref();

        let entries = Self::process_orgs_batch(&orgs, stream_type, stream_name).await;
        log::debug!(
            "[grpc:stream_stats] orgs: {orgs:?}, stream_type: {stream_type:?}, stream_name: {stream_name:?}",
        );
        Ok(Response::new(StreamStatsResponse { entries }))
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
