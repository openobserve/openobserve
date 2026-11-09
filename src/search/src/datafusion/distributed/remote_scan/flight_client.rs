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
use flight::{common::QUERY_PROFILE_ACTION, profile::NodeReport};
use infra::client::grpc::{GrpcChannel, MetadataMap, get_cached_channel};
use prost::Message;
use proto::cluster_rpc;
use tonic::{
    Request, Status,
    metadata::{MetadataKey, MetadataValue},
    service::interceptor::InterceptedService,
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
            InterceptedService<GrpcChannel, impl Fn(Request<()>) -> Result<Request<()>, Status>>,
        >,
        tonic::Request<Ticket>,
    ),
    tonic::Status,
> {
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

/// Fetches a node's report on one run whose stream did not deliver it, waiting up to `timeout`.
pub async fn fetch_node_report(
    trace_id: &str,
    org_id: &str,
    node: Arc<dyn NodeInfo>,
    job_trace_id: String,
    timeout: Duration,
) -> Result<NodeReport, Status> {
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
) -> Result<
    FlightServiceClient<
        InterceptedService<
            GrpcChannel,
            impl Fn(Request<()>) -> Result<Request<()>, Status> + use<>,
        >,
    >,
    Status,
> {
    let cfg = config::get_config();
    let org_id: MetadataValue<_> = org_id
        .parse()
        .map_err(|_| Status::internal("invalid org_id".to_string()))?;
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
            req.set_timeout(timeout);
            Ok(req)
        });
    // Batches are already ZSTD-compressed (Arrow IPC); dropping accept-gzip here stops the
    // server re-compressing the response stream. Don't re-add compression on the client.
    Ok(client
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024))
}

#[cfg(test)]
pub(super) mod tests {
    use std::time::Instant;

    use arrow_flight::{
        ActionType, Criteria, Empty, FlightData, FlightDescriptor, FlightInfo, HandshakeRequest,
        HandshakeResponse, PollInfo, PutResult, SchemaResult,
        flight_service_server::{FlightService, FlightServiceServer},
    };
    use futures::{StreamExt, stream::BoxStream};
    use tonic::{Response, Streaming, transport::server::TcpIncoming};

    use super::*;

    #[derive(Debug)]
    pub(crate) struct StubNode(String);

    impl NodeInfo for StubNode {
        fn get_grpc_addr(&self) -> String {
            self.0.clone()
        }
        fn get_auth_token(&self) -> String {
            "token".to_string()
        }
        fn get_name(&self) -> String {
            "stub".to_string()
        }
        fn is_local(&self) -> bool {
            false
        }
    }

    /// `do_get` fails after its headers; `do_action` replies with `report`, or hangs on `None`.
    pub(crate) struct StubFlight {
        pub(crate) report: Option<NodeReport>,
    }

    #[tonic::async_trait]
    impl FlightService for StubFlight {
        type HandshakeStream = BoxStream<'static, Result<HandshakeResponse, Status>>;
        type ListFlightsStream = BoxStream<'static, Result<FlightInfo, Status>>;
        type DoGetStream = BoxStream<'static, Result<FlightData, Status>>;
        type DoPutStream = BoxStream<'static, Result<PutResult, Status>>;
        type DoActionStream = BoxStream<'static, Result<arrow_flight::Result, Status>>;
        type ListActionsStream = BoxStream<'static, Result<ActionType, Status>>;
        type DoExchangeStream = BoxStream<'static, Result<FlightData, Status>>;

        async fn do_get(
            &self,
            _request: Request<Ticket>,
        ) -> Result<Response<Self::DoGetStream>, Status> {
            let failure = futures::stream::once(async { Err(Status::internal("node lost")) });
            Ok(Response::new(failure.boxed()))
        }

        async fn do_action(
            &self,
            _request: Request<Action>,
        ) -> Result<Response<Self::DoActionStream>, Status> {
            let Some(report) = &self.report else {
                return Ok(Response::new(futures::stream::pending().boxed()));
            };
            let body = serde_json::to_vec(report).unwrap().into();
            let reply = futures::stream::once(async { Ok(arrow_flight::Result { body }) });
            Ok(Response::new(reply.boxed()))
        }

        async fn handshake(
            &self,
            _request: Request<Streaming<HandshakeRequest>>,
        ) -> Result<Response<Self::HandshakeStream>, Status> {
            Err(Status::unimplemented("handshake"))
        }

        async fn list_flights(
            &self,
            _request: Request<Criteria>,
        ) -> Result<Response<Self::ListFlightsStream>, Status> {
            Err(Status::unimplemented("list_flights"))
        }

        async fn get_flight_info(
            &self,
            _request: Request<FlightDescriptor>,
        ) -> Result<Response<FlightInfo>, Status> {
            Err(Status::unimplemented("get_flight_info"))
        }

        async fn poll_flight_info(
            &self,
            _request: Request<FlightDescriptor>,
        ) -> Result<Response<PollInfo>, Status> {
            Err(Status::unimplemented("poll_flight_info"))
        }

        async fn get_schema(
            &self,
            _request: Request<FlightDescriptor>,
        ) -> Result<Response<SchemaResult>, Status> {
            Err(Status::unimplemented("get_schema"))
        }

        async fn do_put(
            &self,
            _request: Request<Streaming<FlightData>>,
        ) -> Result<Response<Self::DoPutStream>, Status> {
            Err(Status::unimplemented("do_put"))
        }

        async fn list_actions(
            &self,
            _request: Request<Empty>,
        ) -> Result<Response<Self::ListActionsStream>, Status> {
            Err(Status::unimplemented("list_actions"))
        }

        async fn do_exchange(
            &self,
            _request: Request<Streaming<FlightData>>,
        ) -> Result<Response<Self::DoExchangeStream>, Status> {
            Err(Status::unimplemented("do_exchange"))
        }
    }

    /// Serves `stub` on a loopback port until the test's runtime shuts down.
    pub(crate) async fn serve(stub: StubFlight) -> Arc<dyn NodeInfo> {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let grpc_addr = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(
            tonic::transport::Server::builder()
                .add_service(FlightServiceServer::new(stub))
                .serve_with_incoming(TcpIncoming::from(listener)),
        );
        Arc::new(StubNode(grpc_addr))
    }

    #[tokio::test]
    async fn test_fetch_node_report_gives_up_when_the_reply_body_never_comes() {
        let node = serve(StubFlight { report: None }).await;
        let start = Instant::now();
        let fetch = fetch_node_report("t", "default", node, "j".into(), Duration::from_millis(300));
        let result = tokio::time::timeout(Duration::from_secs(5), fetch)
            .await
            .expect("fetch must end within its own timeout");
        assert_eq!(result.unwrap_err().code(), tonic::Code::DeadlineExceeded);
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}
