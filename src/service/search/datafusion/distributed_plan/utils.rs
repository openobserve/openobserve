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

use arrow_flight::{Ticket, flight_service_client::FlightServiceClient};
use config::{datafusion::request::FlightSearchRequest, meta::cluster::NodeInfo};
use datafusion::common::Result;
use infra::client::grpc::{MetadataMap, get_cached_channel};
use prost::Message;
use proto::cluster_rpc;
use tonic::{
    Request, Status,
    codec::CompressionEncoding,
    metadata::{MetadataKey, MetadataValue},
    service::interceptor::InterceptedService,
    transport::Channel,
};

pub async fn make_flight_client(
    trace_id: String,
    org_id: &str,
    node: Arc<dyn NodeInfo>,
    request: FlightSearchRequest,
    context: &opentelemetry::Context,
    timeout: u64,
) -> Result<
    (
        FlightServiceClient<
            InterceptedService<Channel, impl Fn(Request<()>) -> Result<Request<()>, Status>>,
        >,
        tonic::Request<Ticket>,
    ),
    tonic::Status,
> {
    let cfg = config::get_config();
    let request: cluster_rpc::FlightSearchRequest = request.into();
    let mut buf: Vec<u8> = Vec::new();
    request
        .encode(&mut buf)
        .map_err(|e| Status::internal(format!("{e:?}")))?;

    let mut request = tonic::Request::new(Ticket { ticket: buf.into() });

    let org_id: MetadataValue<_> = org_id
        .parse()
        .map_err(|_| Status::internal("invalid org_id".to_string()))?;

    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(context, &mut MetadataMap(request.metadata_mut()))
    });

    let org_header_key: MetadataKey<_> = cfg
        .grpc
        .org_header_key
        .parse()
        .map_err(|_| Status::internal("invalid org_header_key".to_string()))?;
    let token: MetadataValue<_> = node
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

    let client =
        FlightServiceClient::with_interceptor(channel, move |mut req: tonic::Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            req.metadata_mut()
                .insert(org_header_key.clone(), org_id.clone());
            req.set_timeout(std::time::Duration::from_secs(timeout));
            Ok(req)
        });
    let client = client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);

    Ok((client, request))
}
