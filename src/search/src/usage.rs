// Copyright 2026 OpenObserve Inc.

use anyhow::{Result, anyhow};
use config::{
    meta::{
        cluster::NodeInfo,
        search::{
            Query, Request as SearchRequest, RequestEncoding, Response, SearchEventType,
            default_use_cache,
        },
    },
    utils::json,
};
use infra::{client::grpc::make_grpc_search_client, cluster::get_node_by_uuid, errors::ErrorCodes};
use proto::cluster_rpc::GetLicenseUsageResponse;

pub fn request(sql: String, start_time: i64, end_time: i64, local: bool) -> SearchRequest {
    let (clusters, regions) = if local {
        (vec!["local".into()], vec!["local".into()])
    } else {
        (vec![], vec![])
    };
    SearchRequest {
        query: Query {
            sql,
            from: 0,
            size: -1,
            start_time,
            end_time,
            quick_mode: false,
            query_type: String::new(),
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
            timezone: None,
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
    }
}

pub fn into_hits(response: Response) -> Result<Vec<json::Value>> {
    if response.is_partial {
        return Err(anyhow!(
            "Partial response: {}",
            response.function_error.join(", ")
        ));
    }
    Ok(response.hits)
}

pub async fn get_license_usage_data_from_node(node_id: String) -> Result<GetLicenseUsageResponse> {
    let node = get_node_by_uuid(&node_id)
        .await
        .ok_or(anyhow!("node {node_id} not found"))?;
    let node = std::sync::Arc::new(node) as std::sync::Arc<dyn NodeInfo>;

    tokio::task::spawn(async move {
        let mut request = tonic::Request::new(proto::cluster_rpc::GetLicenseUsageRequest {});
        let mut client =
            make_grpc_search_client("license-usage-grpc-request", &mut request, &node, 0).await?;
        match client.get_license_usage_info(request).await {
            Ok(response) => Ok(response.into_inner()),
            Err(error) => {
                log::error!(
                    "[trace_id: license-usage-grpc-request] error getting license usage info node {} : {error:?}",
                    node.get_grpc_addr(),
                );
                let error = ErrorCodes::from_json(error.message())?;
                Err(anyhow!("error getting license usage info : {error}"))
            }
        }
    })
    .await
    .map_err(|error| anyhow!("internal error : {error}"))?
}
