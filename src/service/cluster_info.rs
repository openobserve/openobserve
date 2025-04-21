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

use std::sync::Arc;

use config::meta::cluster::NodeInfo;
use infra::file_list as infra_file_list;
use proto::cluster_rpc::{CompactionInfo, EmptyRequest, GetClusterInfoResponse};
use tonic::{Request, Response, Status};

use crate::common::meta::organization::ClusterInfo;

pub struct ClusterInfoService;

pub fn convert_response_to_cluster_info(response: GetClusterInfoResponse) -> ClusterInfo {
    ClusterInfo {
        pending_jobs: response
            .compaction_info
            .as_ref()
            .map(|info| info.pending_jobs)
            .unwrap_or_default(),
    }
}

#[tonic::async_trait]
impl proto::cluster_rpc::cluster_info_service_server::ClusterInfoService for ClusterInfoService {
    async fn get_cluster_info(
        &self,
        _request: Request<EmptyRequest>,
    ) -> Result<Response<GetClusterInfoResponse>, Status> {
        // Fetch the jobs information from the database
        let jobs = match infra_file_list::get_pending_jobs_count().await {
            Ok(jobs) => jobs,
            Err(e) => {
                log::error!("Failed to get pending jobs count: {:?}", e);
                return Err(Status::internal(format!(
                    "Failed to get pending jobs count: {:?}",
                    e
                )));
            }
        };

        Ok(Response::new(GetClusterInfoResponse {
            compaction_info: Some(CompactionInfo {
                pending_jobs: jobs.len() as u64,
                completed_jobs: 0,
                in_progress_jobs: 0,
            }),
        }))
    }
}

pub async fn get_super_cluster_info(
    trace_id: &str,
    node: Arc<dyn NodeInfo>,
) -> Result<ClusterInfo, anyhow::Error> {
    let empty_request = EmptyRequest {};
    let mut request = Request::new(empty_request.clone());
    let mut client =
        super::grpc::make_grpc_cluster_info_client(trace_id, &mut request, &node).await?;
    let response = match client.get_cluster_info(Request::new(empty_request)).await {
        Ok(response) => convert_response_to_cluster_info(response.into_inner()),
        Err(err) => {
            log::error!(
                "Failed to get cluster info from cluster node {}: {:?}",
                node.get_grpc_addr(),
                err
            );
            return Err(anyhow::anyhow!(
                "Error getting cluster info from cluster node: {:?}",
                err
            ));
        }
    };

    Ok(response)
}
