// Copyright 2026 OpenObserve Inc.
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

use anyhow::{Result, anyhow};
use config::{
    META_ORG_ID, ider,
    meta::{
        cluster::{NodeInfo, RoleGroup},
        search::{
            Query, Request as SearchRequest, RequestEncoding, SearchEventType, default_use_cache,
        },
        stream::StreamType,
    },
    utils::json,
};
use infra::{client::grpc::make_grpc_search_client, cluster::get_node_by_uuid, errors::ErrorCodes};
use proto::cluster_rpc::GetLicenseUsageResponse;

use crate::service::search as SearchService;

pub async fn get_usage(
    sql: String,
    start_time: i64,
    end_time: i64,
    local: bool,
) -> Result<Vec<json::Value>> {
    let (clusters, regions) = if local {
        (vec!["local".into()], vec!["local".into()])
    } else {
        (vec![], vec![])
    };

    let req = SearchRequest {
        query: Query {
            sql,
            from: 0,
            size: -1,
            start_time,
            end_time,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            action_id: None,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            sampling_config: None,
            sampling_ratio: None,
            streaming_output: false,
            streaming_id: None,
            histogram_interval: 0,
        },
        encoding: RequestEncoding::Empty,
        regions,
        clusters,
        timeout: 0,
        search_type: Some(SearchEventType::Other),
        search_event_context: None,
        use_cache: default_use_cache(),
        clear_cache: false,
        local_mode: None,
    };

    let trace_id = ider::uuid();
    let resp = SearchService::grpc_search::grpc_search(
        &trace_id,
        META_ORG_ID,
        StreamType::Logs,
        None,
        &req,
        Some(RoleGroup::Interactive),
    )
    .await?;

    if resp.is_partial {
        return Err(anyhow!(
            "Partial response: {}",
            resp.function_error.join(", ")
        ));
    }

    Ok(resp.hits)
}

pub async fn get_license_usage_data_from_node(node_id: String) -> Result<GetLicenseUsageResponse> {
    let node = get_node_by_uuid(&node_id)
        .await
        .ok_or(anyhow::anyhow!("node {node_id} not found"))?;
    let node = std::sync::Arc::new(node) as std::sync::Arc<dyn NodeInfo>;

    let task = tokio::task::spawn(async move {
        let mut request = tonic::Request::new(proto::cluster_rpc::GetLicenseUsageRequest {});
        let mut client =
            make_grpc_search_client("license-usage-grpc-request", &mut request, &node, 0).await?;
        match client.get_license_usage_info(request).await {
            Ok(res) => {
                let response = res.into_inner();
                Ok(response)
            }
            Err(err) => {
                log::error!(
                    "[trace_id: license-usage-grpc-request] error getting license usage info node {} : {err:?}",
                    &node.get_grpc_addr(),
                );
                let err = ErrorCodes::from_json(err.message())?;
                Err(anyhow::anyhow!("error getting license usage info : {err}"))
            }
        }
    });
    task.await
        .map_err(|e| anyhow::anyhow!("internal error : {e}"))?
}
