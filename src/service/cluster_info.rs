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
use proto::cluster_rpc::{
    CompactionInfo, EmptyRequest, GetClusterInfoResponse, GetDeleteJobStatusRequest,
    GetDeleteJobStatusResponse,
};
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
                log::error!("Failed to get pending jobs count: {e}");
                return Err(Status::internal(format!(
                    "Failed to get pending jobs count: {e}"
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

    async fn get_delete_job_status(
        &self,
        request: Request<GetDeleteJobStatusRequest>,
    ) -> Result<Response<GetDeleteJobStatusResponse>, Status> {
        let req = request.into_inner();

        // Get the key from the database
        match crate::service::db::compact::compactor_manual_jobs::get_job(&req.ksuid).await {
            Ok(job) => {
                // Job still exists, return pending status
                Ok(Response::new(GetDeleteJobStatusResponse {
                    id: job.id,
                    key: job.key,
                    created_at: job.created_at,
                    ended_at: job.ended_at,
                    status: job.status as i64,
                }))
            }
            Err(e) => {
                log::error!("get_delete_job_status {} error: {e}", req.ksuid);
                Err(Status::internal(format!("Database error: {e}")))
            }
        }
    }
}

pub async fn get_super_cluster_info(
    trace_id: &str,
    node: Arc<dyn NodeInfo>,
) -> Result<ClusterInfo, anyhow::Error> {
    let empty_request = EmptyRequest {};
    let mut request = Request::new(empty_request);
    let mut client =
        infra::client::grpc::make_grpc_cluster_info_client(trace_id, &mut request, &node).await?;
    let response = match client.get_cluster_info(Request::new(empty_request)).await {
        Ok(r) => convert_response_to_cluster_info(r.into_inner()),
        Err(e) => {
            log::error!(
                "Failed to get cluster info from cluster node {}: {:?}",
                node.get_grpc_addr(),
                e
            );
            return Err(anyhow::anyhow!(
                "Error getting cluster info from cluster node: {e}"
            ));
        }
    };

    Ok(response)
}

pub async fn get_super_cluster_delete_job_status(
    trace_id: &str,
    node: Arc<dyn NodeInfo>,
    ksuid: &str,
) -> Result<GetDeleteJobStatusResponse, anyhow::Error> {
    let request = GetDeleteJobStatusRequest {
        ksuid: ksuid.to_string(),
    };
    let mut grpc_request = Request::new(request.clone());
    let mut client =
        infra::client::grpc::make_grpc_cluster_info_client(trace_id, &mut grpc_request, &node)
            .await?;
    let response = match client.get_delete_job_status(Request::new(request)).await {
        Ok(response) => response.into_inner(),
        Err(err) => {
            log::error!(
                "Failed to get delete job status from cluster node {}: {:?}",
                node.get_grpc_addr(),
                err
            );
            return Err(anyhow::anyhow!(
                "Error getting delete job status from cluster node: {:?}",
                err
            ));
        }
    };

    Ok(response)
}

#[cfg(test)]
mod tests {
    use proto::cluster_rpc::CompactionInfo;

    use super::*;

    #[test]
    fn test_convert_response_to_cluster_info() {
        let response = GetClusterInfoResponse {
            compaction_info: Some(CompactionInfo {
                pending_jobs: 5,
                completed_jobs: 10,
                in_progress_jobs: 2,
            }),
        };

        let cluster_info = convert_response_to_cluster_info(response);
        assert_eq!(cluster_info.pending_jobs, 5);
    }

    #[test]
    fn test_convert_response_to_cluster_info_no_compaction_info() {
        let response = GetClusterInfoResponse {
            compaction_info: None,
        };

        let cluster_info = convert_response_to_cluster_info(response);
        assert_eq!(cluster_info.pending_jobs, 0);
    }
}
