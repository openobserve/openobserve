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

use std::sync::Arc;

use config::{
    meta::{cluster::RoleGroup, search, stream::StreamType},
    utils::json,
};
use infra::{
    client::grpc::make_grpc_search_client,
    cluster,
    errors::{Error, ErrorCodes},
};
use rand::{SeedableRng, rngs::StdRng, seq::IndexedRandom};
use tracing::{Instrument, info_span};

use crate::service::search::server_internal_error;

#[tracing::instrument(name = "service:search:grpc_search", skip_all)]
pub async fn grpc_search(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    user_id: Option<String>,
    in_req: &search::Request,
    role_group: Option<RoleGroup>,
) -> Result<search::Response, Error> {
    let mut nodes = cluster::get_cached_online_querier_nodes(role_group)
        .await
        .unwrap_or_default();
    // sort nodes by node_id this will improve hit cache ratio
    nodes.sort_by(|a, b| a.grpc_addr.cmp(&b.grpc_addr));
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);
    if nodes.is_empty() {
        log::error!("[trace_id: {trace_id}] search->grpc: no querier node online");
        return Err(server_internal_error("no querier node online"));
    }

    let mut rng = StdRng::seed_from_u64(rand::random());
    let node = nodes.choose(&mut rng).unwrap().clone();

    // make cluster request
    let node_addr = node.grpc_addr.clone();
    let grpc_span = info_span!(
        "service:search:cluster:grpc_search",
        node_id = node.id,
        node_addr = node_addr.as_str(),
    );

    let trace_id = trace_id.to_string();
    let org_id = org_id.to_string();
    let stream_type = stream_type.as_str();
    let in_req = in_req.clone();
    let timeout = in_req.timeout as u64;
    let task = tokio::task::spawn(
        async move {
            let req = bytes::Bytes::from(json::to_string(&in_req)?).to_vec();
            let mut request = tonic::Request::new(proto::cluster_rpc::SearchRequest {
                trace_id: trace_id.to_string(),
                org_id: org_id.to_string(),
                stream_type: stream_type.to_string(),
                user_id: user_id.clone(),
                request: req,
            });
            let node = Arc::new(node) as _;
            let mut client =
                make_grpc_search_client(&trace_id, &mut request, &node, timeout).await?;
            let response = match client.search(request).await {
                Ok(res) => res.into_inner(),
                Err(err) => {
                    log::error!(
                        "[trace_id: {trace_id}] search->grpc: node: {}, search err: {:?}",
                        node.get_grpc_addr(),
                        err
                    );
                    let err = ErrorCodes::from_json(err.message())?;
                    return Err(Error::ErrorCode(err));
                }
            };
            Ok(response)
        }
        .instrument(grpc_span),
    );

    let response = task
        .await
        .map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))??;
    let response = json::from_slice::<search::Response>(&response.response)?;

    Ok(response)
}

#[tracing::instrument(name = "service:search:grpc_search_multi", skip_all)]
pub async fn grpc_search_multi(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    user_id: Option<String>,
    in_req: &search::MultiStreamRequest,
    role_group: Option<RoleGroup>,
) -> Result<search::Response, Error> {
    let mut nodes = cluster::get_cached_online_querier_nodes(role_group)
        .await
        .unwrap_or_default();
    // sort nodes by node_id this will improve hit cache ratio
    nodes.sort_by(|a, b| a.grpc_addr.cmp(&b.grpc_addr));
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);
    if nodes.is_empty() {
        log::error!("[trace_id: {trace_id}] search->grpc: no querier node online");
        return Err(server_internal_error("no querier node online"));
    }

    let mut rng = StdRng::seed_from_u64(rand::random());
    let node = nodes.choose(&mut rng).unwrap().clone();

    // make cluster request
    let node_addr = node.grpc_addr.clone();
    let grpc_span = info_span!(
        "service:search:cluster:grpc_search_multi",
        node_id = node.id,
        node_addr = node_addr.as_str(),
    );

    let trace_id = trace_id.to_string();
    let org_id = org_id.to_string();
    let stream_type = stream_type.as_str();
    let in_req = in_req.clone();
    let task = tokio::task::spawn(
        async move {
            let req = bytes::Bytes::from(json::to_string(&in_req)?).to_vec();
            let mut request = tonic::Request::new(proto::cluster_rpc::SearchRequest {
                trace_id: trace_id.to_string(),
                org_id: org_id.to_string(),
                stream_type: stream_type.to_string(),
                user_id: user_id.clone(),
                request: req,
            });
            let node = Arc::new(node) as _;
            let timeout = in_req.timeout as u64;
            let mut client =
                make_grpc_search_client(&trace_id, &mut request, &node, timeout).await?;
            let response = match client.search_multi(request).await {
                Ok(res) => res.into_inner(),
                Err(err) => {
                    log::error!(
                        "[trace_id: {trace_id}] search->grpc: node: {}, search err: {:?}",
                        node.get_grpc_addr(),
                        err,
                    );
                    let err = ErrorCodes::from_json(err.message())?;
                    return Err(Error::ErrorCode(err));
                }
            };
            Ok(response)
        }
        .instrument(grpc_span),
    );

    let response = task
        .await
        .map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))??;
    let response = json::from_slice::<search::Response>(&response.response)?;

    Ok(response)
}

#[tracing::instrument(name = "service:search:grpc_search_partition", skip_all)]
pub async fn grpc_search_partition(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    in_req: &search::SearchPartitionRequest,
    role_group: Option<RoleGroup>,
    skip_max_query_range: bool,
) -> Result<search::SearchPartitionResponse, Error> {
    let mut nodes = cluster::get_cached_online_querier_nodes(role_group)
        .await
        .unwrap_or_default();
    // sort nodes by node_id this will improve hit cache ratio
    nodes.sort_by(|a, b| a.grpc_addr.cmp(&b.grpc_addr));
    nodes.dedup_by(|a, b| a.grpc_addr == b.grpc_addr);
    if nodes.is_empty() {
        log::error!("[trace_id: {trace_id}] search->grpc: no querier node online");
        return Err(server_internal_error("no querier node online"));
    }

    let mut rng = StdRng::seed_from_u64(rand::random());
    let node = nodes.choose(&mut rng).unwrap().clone();

    // make cluster request
    let node_addr = node.grpc_addr.clone();
    let grpc_span = info_span!(
        "service:search:cluster:grpc_search_partition",
        node_id = node.id,
        node_addr = node_addr.as_str(),
    );

    let trace_id = trace_id.to_string();
    let org_id = org_id.to_string();
    let in_req = in_req.clone();
    let task = tokio::task::spawn(
        async move {
            let req = bytes::Bytes::from(json::to_string(&in_req)?).to_vec();
            let mut request = tonic::Request::new(proto::cluster_rpc::SearchPartitionRequest {
                trace_id: trace_id.to_string(),
                org_id: org_id.to_string(),
                stream_type: stream_type.to_string(),
                request: req,
                skip_max_query_range,
            });
            let node = Arc::new(node) as _;
            let mut client = make_grpc_search_client(&trace_id, &mut request, &node, 0).await?;
            let response = match client.search_partition(request).await {
                Ok(res) => res.into_inner(),
                Err(err) => {
                    log::error!(
                        "[trace_id: {trace_id}] search->grpc: node: {}, search err: {:?}",
                        node.get_grpc_addr(),
                        err,
                    );
                    let err = ErrorCodes::from_json(err.message())?;
                    return Err(Error::ErrorCode(err));
                }
            };
            Ok(response)
        }
        .instrument(grpc_span),
    );

    let response = task
        .await
        .map_err(|e| Error::ErrorCode(ErrorCodes::ServerInternalError(e.to_string())))??;
    let response = json::from_slice::<search::SearchPartitionResponse>(&response.response)?;

    Ok(response)
}
