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

use infra::errors::{Error, ErrorCodes};
use tracing::{Instrument, info_span};

use crate::service::grpc::make_grpc_search_client;

#[tracing::instrument(name = "service:search:grpc_cuckoo_filter_query", skip_all)]
pub async fn grpc_cuckoo_filter_query(
    node: &config::meta::cluster::Node,
    org_id: &str,
    stream_name: &str,
    trace_id: &str,
    hours: &[String],
) -> Result<Vec<String>, Error> {
    // make cluster request
    let node_addr = node.grpc_addr.clone();
    let grpc_span = info_span!(
        "service:search:cluster:grpc_cuckoo_filter_query",
        node_id = node.id,
        node_addr = node_addr.as_str(),
    );

    let trace_id = trace_id.to_string();
    let org_id = org_id.to_string();
    let stream_name = stream_name.to_string();
    let hours = hours.to_vec();
    let node = node.clone();

    let task = tokio::task::spawn(
        async move {
            let mut request = tonic::Request::new(proto::cluster_rpc::CuckooFilterQueryRequest {
                org_id: org_id.to_string(),
                stream_name: stream_name.to_string(),
                trace_id: trace_id.to_string(),
                hours: hours.clone(),
            });
            let node = Arc::new(node) as _;
            let mut client = make_grpc_search_client(&trace_id, &mut request, &node).await?;
            let response = match client.cuckoo_filter_query(request).await {
                Ok(res) => res.into_inner(),
                Err(err) => {
                    log::error!(
                        "[trace_id: {trace_id}] cuckoo_filter_query->grpc: node: {}, query err: {:?}",
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

    Ok(response.found_hours)
}

/// Query remote ingester node's cuckoo filter via GRPC (ingester-specific, no S3 download)
#[tracing::instrument(name = "service:search:grpc_ingester_cuckoo_filter_query", skip_all)]
pub async fn grpc_ingester_cuckoo_filter_query(
    node: &config::meta::cluster::Node,
    org_id: &str,
    stream_name: &str,
    trace_id: &str,
    hours: &[String],
) -> Result<Vec<String>, Error> {
    // make cluster request
    let node_addr = node.grpc_addr.clone();
    let grpc_span = info_span!(
        "service:search:cluster:grpc_ingester_cuckoo_filter_query",
        node_id = node.id,
        node_addr = node_addr.as_str(),
    );

    let trace_id = trace_id.to_string();
    let org_id = org_id.to_string();
    let stream_name = stream_name.to_string();
    let hours = hours.to_vec();
    let node = node.clone();

    let task = tokio::task::spawn(
        async move {
            let mut request = tonic::Request::new(proto::cluster_rpc::CuckooFilterQueryRequest {
                org_id: org_id.to_string(),
                stream_name: stream_name.to_string(),
                trace_id: trace_id.to_string(),
                hours: hours.clone(),
            });
            // Add metadata to indicate this is an ingester query (no S3 download)
            request.metadata_mut().insert("ingester-cuckoofilter-query", "true".parse().unwrap());

            let node = Arc::new(node) as _;
            let mut client = make_grpc_search_client(&trace_id, &mut request, &node).await?;
            let response = match client.cuckoo_filter_query(request).await {
                Ok(res) => res.into_inner(),
                Err(err) => {
                    log::error!(
                        "[trace_id: {trace_id}] ingester_cuckoo_filter_query->grpc: node: {}, query err: {:?}",
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

    Ok(response.found_hours)
}
