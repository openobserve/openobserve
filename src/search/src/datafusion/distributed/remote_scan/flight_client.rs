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

use std::{sync::Arc, time::Duration};

use arrow_flight::{Action, Ticket, flight_service_client::FlightServiceClient};
use config::{datafusion::request::FlightSearchRequest, meta::cluster::NodeInfo};
use datafusion::common::Result;
use flight::{common::QUERY_PROFILE_ACTION, profile::ProfileNode};
use infra::client::grpc::{GrpcChannel, MetadataMap, get_cached_channel};
use prost::Message;
use proto::cluster_rpc;
use tonic::{
    Request, Status,
    metadata::{AsciiMetadataKey, AsciiMetadataValue},
    service::{Interceptor, interceptor::InterceptedService},
};

pub type FlightClient = FlightServiceClient<InterceptedService<GrpcChannel, CallHeaders>>;

/// Adds the node's token, the org and the timeout to every call of one client.
pub struct CallHeaders {
    token: AsciiMetadataValue,
    org_header_key: AsciiMetadataKey,
    org_id: AsciiMetadataValue,
    timeout: Duration,
}

impl Interceptor for CallHeaders {
    fn call(&mut self, mut req: Request<()>) -> Result<Request<()>, Status> {
        req.metadata_mut()
            .insert("authorization", self.token.clone());
        req.metadata_mut()
            .insert(self.org_header_key.clone(), self.org_id.clone());
        req.set_timeout(self.timeout);
        Ok(req)
    }
}

pub async fn make_flight_client(
    trace_id: String,
    org_id: &str,
    node: Arc<dyn NodeInfo>,
    request: FlightSearchRequest,
    context: &opentelemetry::Context,
    timeout: u64,
) -> Result<(FlightClient, Request<Ticket>), Status> {
    let request: cluster_rpc::FlightSearchRequest = request.into();
    let mut buf: Vec<u8> = Vec::new();
    request
        .encode(&mut buf)
        .map_err(|e| Status::internal(format!("{e:?}")))?;

    let mut request = tonic::Request::new(Ticket { ticket: buf.into() });

    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(context, &mut MetadataMap(request.metadata_mut()))
    });

    let client = flight_client(&trace_id, org_id, node, Duration::from_secs(timeout)).await?;
    Ok((client, request))
}

/// Fetches a node's profile of one run whose stream did not deliver it, waiting up to `timeout`.
pub async fn fetch_node_profile(
    trace_id: &str,
    org_id: &str,
    node: Arc<dyn NodeInfo>,
    job_trace_id: String,
    timeout: Duration,
) -> Result<ProfileNode, Status> {
    // The request timeout only covers the response headers, not connecting or the body.
    let fetch = async {
        let mut client = flight_client(trace_id, org_id, node, timeout).await?;
        let action = Action {
            r#type: QUERY_PROFILE_ACTION.to_string(),
            body: job_trace_id.into(),
        };
        let reply = client
            .do_action(action)
            .await?
            .into_inner()
            .message()
            .await?
            .ok_or_else(|| Status::internal("empty query_profile reply"))?;
        serde_json::from_slice(&reply.body).map_err(|e| Status::internal(e.to_string()))
    };
    tokio::time::timeout(timeout, fetch)
        .await
        .map_err(|_| Status::deadline_exceeded("query_profile timed out"))?
}

async fn flight_client(
    trace_id: &str,
    org_id: &str,
    node: Arc<dyn NodeInfo>,
    timeout: Duration,
) -> Result<FlightClient, Status> {
    let cfg = config::get_config();
    let org_id: AsciiMetadataValue = org_id
        .parse()
        .map_err(|_| Status::internal("invalid org_id".to_string()))?;
    let org_header_key: AsciiMetadataKey = cfg
        .grpc
        .org_header_key
        .parse()
        .map_err(|_| Status::internal("invalid org_header_key".to_string()))?;
    let token: AsciiMetadataValue = node
        .get_auth_token()
        .parse()
        .map_err(|_| Status::internal("invalid token".to_string()))?;
    let channel = match get_cached_channel(&node.get_grpc_addr()).await {
        Ok(channel) => channel,
        Err(e) => {
            log::error!(
                "[trace_id {trace_id}] flight->search: node: {}, connect err: {e:?}",
                node.get_grpc_addr()
            );
            return Err(Status::internal(e.to_string()));
        }
    };

    let headers = CallHeaders {
        token,
        org_header_key,
        org_id,
        timeout,
    };
    let client = FlightServiceClient::with_interceptor(channel, headers);
    // Batches are already ZSTD-compressed (Arrow IPC); dropping accept-gzip here stops the
    // server re-compressing the response stream. Don't re-add compression on the client.
    Ok(client
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024))
}
