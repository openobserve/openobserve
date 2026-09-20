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

use std::sync::{Arc, LazyLock as Lazy};

use config::{
    RwAHashMap, get_config,
    meta::cluster::{Node, NodeInfo},
};
use proto::cluster_rpc::{
    self, cluster_info_service_client::ClusterInfoServiceClient, metrics_client::MetricsClient,
    node_service_client::NodeServiceClient, search_client::SearchClient,
};
use tonic::{
    Request, Status,
    codec::CompressionEncoding,
    metadata::{MetadataKey, MetadataValue},
    service::interceptor::InterceptedService,
    transport::{Certificate, Channel, ClientTlsConfig},
};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::errors::{Error, ErrorCodes};

static CHANNELS: Lazy<RwAHashMap<String, Channel>> = Lazy::new(Default::default);

pub struct MetadataMap<'a>(pub &'a mut tonic::metadata::MetadataMap);

impl opentelemetry::propagation::Injector for MetadataMap<'_> {
    /// Set a key and value in the MetadataMap.  Does nothing if the key or
    /// value are not valid inputs
    fn set(&mut self, key: &str, value: String) {
        if let Ok(key) = tonic::metadata::MetadataKey::from_bytes(key.as_bytes())
            && let Ok(val) = tonic::metadata::MetadataValue::try_from(&value)
        {
            self.0.insert(key, val);
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MetricsResponseCompression {
    verified_loopback_addr: Option<String>,
}

impl MetricsResponseCompression {
    pub fn for_node(node: &Node) -> Self {
        Self::for_identity(
            &node.uuid,
            &node.grpc_addr,
            &config::cluster::LOCAL_NODE.uuid,
            &config::cluster::get_local_grpc_addr(),
        )
    }

    fn for_identity(peer_uuid: &str, peer_addr: &str, local_uuid: &str, local_addr: &str) -> Self {
        let verified = !peer_uuid.is_empty()
            && peer_uuid == local_uuid
            && peer_addr == local_addr
            && url::Url::parse(peer_addr).ok().is_some_and(|url| {
                matches!(url.scheme(), "http" | "https")
                    && match url.host() {
                        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
                        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
                        _ => false,
                    }
            });
        Self {
            verified_loopback_addr: verified.then(|| peer_addr.to_owned()),
        }
    }

    fn accepts_gzip_for(&self, actual_addr: &str) -> bool {
        self.verified_loopback_addr.as_deref() != Some(actual_addr)
    }
}

pub async fn get_cached_channel(grpc_addr: &str) -> Result<Channel, tonic::Status> {
    // if channel cache is disabled, create a new channel for each request
    if get_config().grpc.channel_cache_disabled {
        return create_channel(grpc_addr).await;
    }

    // cache hit
    let r = CHANNELS.read().await;
    if let Some(channel) = r.get(grpc_addr) {
        return Ok(channel.clone());
    }
    drop(r);

    // cache miss, connect to ingester
    let channel = create_channel(grpc_addr).await?;
    let mut w = CHANNELS.write().await;
    w.insert(grpc_addr.to_string(), channel.clone());
    drop(w);

    Ok(channel.clone())
}

/// Whether a gRPC client connection to `grpc_addr` should use TLS.
fn grpc_addr_uses_tls(grpc_addr: &str) -> bool {
    grpc_addr.to_lowercase().starts_with("https://")
}

pub async fn create_channel(grpc_addr: &str) -> Result<Channel, tonic::Status> {
    let cfg = config::get_config();
    let mut channel = Channel::from_shared(grpc_addr.to_string()).map_err(|err| {
        log::error!("gRPC node: {}, parse err: {:?}", grpc_addr, err);
        Status::internal("parse gRPC node error".to_string())
    })?;
    if grpc_addr_uses_tls(grpc_addr) {
        let mut tls = ClientTlsConfig::new();
        // Only override the SNI/domain when explicitly configured; otherwise tonic derives
        // it from the URI host, which matches the load balancer's certificate.
        if !cfg.grpc.tls_cert_domain.is_empty() {
            tls = tls.domain_name(&cfg.grpc.tls_cert_domain);
        }
        match cfg.grpc.tls_root_certificates {
            config::TlsRootCertificates::Native => {
                tls = tls.with_native_roots();
            }
            config::TlsRootCertificates::Webpki => {
                tls = tls.with_webpki_roots();
                if !cfg.grpc.tls_cert_path.is_empty() {
                    let pem = std::fs::read_to_string(&cfg.grpc.tls_cert_path)?;
                    let cert = Certificate::from_pem(pem);
                    tls = tls.ca_certificates([cert]);
                }
            }
        }
        channel = channel.tls_config(tls).map_err(|err| {
            log::error!("gRPC node: {}, tls err: {:?}", grpc_addr, err);
            Status::internal("tls gRPC node error".to_string())
        })?;
    }
    let channel = channel
        .initial_stream_window_size(config::GRPC_HTTP2_STREAM_WINDOW_SIZE)
        .initial_connection_window_size(config::GRPC_HTTP2_CONNECTION_WINDOW_SIZE)
        .http2_adaptive_window(cfg.grpc.http2_adaptive_window)
        .tcp_nodelay(true)
        .connect_timeout(std::time::Duration::from_secs(cfg.grpc.connect_timeout))
        .connect()
        .await
        .map_err(|err| {
            log::error!("gRPC node: {}, connect err: {:?}", grpc_addr, err);
            Status::internal("connect to gRPC node error".to_string())
        })?;
    Ok(channel)
}

#[tracing::instrument(name = "grpc:search::make_client", skip_all)]
pub async fn make_grpc_search_client<T>(
    trace_id: &str,
    request: &mut Request<T>,
    node: &Arc<dyn NodeInfo>,
    timeout: u64,
) -> Result<
    SearchClient<
        InterceptedService<Channel, impl Fn(Request<()>) -> Result<Request<()>, Status> + use<T>>,
    >,
    Error,
> {
    let cfg = get_config();
    let timeout = if timeout > 0 {
        timeout
    } else {
        cfg.limit.query_timeout
    };
    request.set_timeout(std::time::Duration::from_secs(timeout));

    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(
            &tracing::Span::current().context(),
            &mut MetadataMap(request.metadata_mut()),
        )
    });

    let token: MetadataValue<_> = node
        .get_auth_token()
        .parse()
        .map_err(|_| Error::Message("invalid token".to_string()))?;
    let channel = get_cached_channel(&node.get_grpc_addr())
        .await
        .map_err(|err| {
            log::error!(
                "[trace_id {trace_id}] search->grpc: node: {}, connect err: {:?}",
                node.get_grpc_addr(),
                err
            );
            let err = ErrorCodes::from_json(err.message())
                .unwrap_or(ErrorCodes::ServerInternalError(err.to_string()));
            Error::ErrorCode(err)
        })?;
    let client = cluster_rpc::search_client::SearchClient::with_interceptor(
        channel,
        move |mut req: Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            Ok(req)
        },
    );
    Ok(client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024))
}

#[tracing::instrument(name = "promql:search:grpc:metrics:make_client", skip_all)]
pub async fn make_grpc_metrics_client<T>(
    trace_id: &str,
    org_id: &str,
    request: &mut Request<T>,
    node: &Arc<dyn NodeInfo>,
    timeout: u64,
) -> Result<
    MetricsClient<
        InterceptedService<Channel, impl Fn(Request<()>) -> Result<Request<()>, Status> + use<T>>,
    >,
    Error,
> {
    make_grpc_metrics_client_with_response_compression(
        trace_id,
        org_id,
        request,
        node,
        timeout,
        MetricsResponseCompression::default(),
    )
    .await
}

#[tracing::instrument(name = "promql:search:grpc:metrics:make_client_with_policy", skip_all)]
pub async fn make_grpc_metrics_client_with_response_compression<T>(
    trace_id: &str,
    org_id: &str,
    request: &mut Request<T>,
    node: &Arc<dyn NodeInfo>,
    timeout: u64,
    response_compression: MetricsResponseCompression,
) -> Result<
    MetricsClient<
        InterceptedService<Channel, impl Fn(Request<()>) -> Result<Request<()>, Status> + use<T>>,
    >,
    Error,
> {
    let cfg = get_config();
    let org_id: MetadataValue<_> = org_id
        .parse()
        .map_err(|_| Error::Message(format!("invalid org_id: {org_id}")))?;
    let timeout = if timeout > 0 {
        timeout
    } else {
        cfg.limit.query_timeout
    };
    request.set_timeout(std::time::Duration::from_secs(timeout));

    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(
            &tracing::Span::current().context(),
            &mut MetadataMap(request.metadata_mut()),
        )
    });

    let org_header_key: MetadataKey<_> = cfg
        .grpc
        .org_header_key
        .parse()
        .map_err(|_| Error::Message("invalid org_header_key".to_string()))?;
    let token: MetadataValue<_> = node
        .get_auth_token()
        .parse()
        .map_err(|_| Error::Message("invalid token".to_string()))?;
    let grpc_addr = node.get_grpc_addr();
    let accept_response_gzip = response_compression.accepts_gzip_for(&grpc_addr);
    let channel = get_cached_channel(&grpc_addr).await.map_err(|err| {
        log::error!(
            "[trace_id {trace_id}] promql->search->grpc: node: {}, connect err: {:?}",
            grpc_addr,
            err
        );
        let err = ErrorCodes::from_json(err.message())
            .unwrap_or(ErrorCodes::ServerInternalError(err.to_string()));
        Error::ErrorCode(err)
    })?;
    let mut client = cluster_rpc::metrics_client::MetricsClient::with_interceptor(
        channel,
        move |mut req: Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            req.metadata_mut()
                .insert(org_header_key.clone(), org_id.clone());
            Ok(req)
        },
    );
    client = client
        .send_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    log::info!(
        "[trace_id {trace_id}] promql->search->grpc: metrics response compression gzip={accept_response_gzip}"
    );
    if accept_response_gzip {
        client = client.accept_compressed(CompressionEncoding::Gzip);
    }
    Ok(client)
}

#[tracing::instrument(name = "grpc:node:make_client", skip_all)]
pub async fn make_grpc_node_client<T>(
    trace_id: &str,
    request: &mut Request<T>,
    node: &Arc<dyn NodeInfo>,
) -> Result<
    NodeServiceClient<
        InterceptedService<Channel, impl Fn(Request<()>) -> Result<Request<()>, Status>>,
    >,
    Error,
> {
    let cfg = get_config();
    request.set_timeout(std::time::Duration::from_secs(cfg.limit.query_timeout));

    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(
            &tracing::Span::current().context(),
            &mut MetadataMap(request.metadata_mut()),
        )
    });

    let token: MetadataValue<_> = node
        .get_auth_token()
        .parse()
        .map_err(|_| Error::Message("invalid token".to_string()))?;
    let channel = get_cached_channel(&node.get_grpc_addr())
        .await
        .map_err(|err| {
            log::error!(
                "[trace_id {trace_id}] node->grpc: node: {}, connect err: {:?}",
                node.get_grpc_addr(),
                err
            );
            let err = ErrorCodes::from_json(err.message())
                .unwrap_or(ErrorCodes::ServerInternalError(err.to_string()));
            Error::ErrorCode(err)
        })?;
    let client = cluster_rpc::node_service_client::NodeServiceClient::with_interceptor(
        channel,
        move |mut req: Request<()>| {
            req.metadata_mut().insert("authorization", token.clone());
            Ok(req)
        },
    );
    Ok(client
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024))
}

#[tracing::instrument(name = "grpc:cluster_info:make_client", skip_all)]
pub async fn make_grpc_cluster_info_client<T>(
    trace_id: &str,
    request: &mut Request<T>,
    node: &Arc<dyn NodeInfo>,
) -> Result<
    ClusterInfoServiceClient<
        InterceptedService<Channel, impl Fn(Request<()>) -> Result<Request<()>, Status>>,
    >,
    Error,
> {
    let cfg = get_config();
    request.set_timeout(std::time::Duration::from_secs(cfg.limit.query_timeout));

    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(
            &tracing::Span::current().context(),
            &mut MetadataMap(request.metadata_mut()),
        )
    });

    let token: MetadataValue<_> = node
        .get_auth_token()
        .parse()
        .map_err(|_| Error::Message("invalid token".to_string()))?;
    let channel = get_cached_channel(&node.get_grpc_addr())
        .await
        .map_err(|err| {
            log::error!(
                "[trace_id {trace_id}] cluster_info->grpc: node: {}, connect err: {:?}",
                node.get_grpc_addr(),
                err
            );
            let err = ErrorCodes::from_json(err.message())
                .unwrap_or(ErrorCodes::ServerInternalError(err.to_string()));
            Error::ErrorCode(err)
        })?;
    let client =
        cluster_rpc::cluster_info_service_client::ClusterInfoServiceClient::with_interceptor(
            channel,
            move |mut req: Request<()>| {
                req.metadata_mut().insert("authorization", token.clone());
                Ok(req)
            },
        );
    Ok(client)
}

#[cfg(test)]
mod tests {
    use opentelemetry::propagation::Injector;
    use tonic::metadata::MetadataMap as TonicMap;

    use super::MetadataMap;

    #[test]
    fn test_set_valid_key_and_value_inserts_into_map() {
        let mut inner = TonicMap::new();
        let mut map = MetadataMap(&mut inner);
        map.set("x-trace-id", "abc123".to_string());
        assert!(inner.contains_key("x-trace-id"));
    }

    #[test]
    fn test_set_invalid_key_does_nothing() {
        let mut inner = TonicMap::new();
        let original_len = inner.len();
        let mut map = MetadataMap(&mut inner);
        // Keys with spaces are invalid for gRPC metadata
        map.set("invalid key with spaces", "some-value".to_string());
        assert_eq!(inner.len(), original_len);
    }

    #[test]
    fn test_set_multiple_keys() {
        let mut inner = TonicMap::new();
        let mut map = MetadataMap(&mut inner);
        map.set("traceparent", "00-abc-def-01".to_string());
        map.set("tracestate", "vendor=trace".to_string());
        assert!(inner.contains_key("traceparent"));
        assert!(inner.contains_key("tracestate"));
    }

    #[test]
    fn test_set_empty_value_inserts_key() {
        let mut inner = TonicMap::new();
        let mut map = MetadataMap(&mut inner);
        map.set("x-empty", String::new());
        assert!(inner.contains_key("x-empty"));
    }

    #[test]
    fn test_metrics_compression_requires_matching_identity_and_numeric_loopback() {
        use super::MetricsResponseCompression as Policy;

        for addr in [
            "http://127.0.0.1:5081",
            "https://127.1.2.3:5081",
            "http://[::1]:5081",
        ] {
            assert!(
                !Policy::for_identity("local-id", addr, "local-id", addr).accepts_gzip_for(addr)
            );
        }
        for (peer, addr, local, local_addr) in [
            (
                "other-id",
                "http://127.0.0.1:5081",
                "local-id",
                "http://127.0.0.1:5081",
            ),
            ("", "http://127.0.0.1:5081", "", "http://127.0.0.1:5081"),
            (
                "local-id",
                "http://127.0.0.1:5082",
                "local-id",
                "http://127.0.0.1:5081",
            ),
            (
                "local-id",
                "https://127.0.0.1:5081",
                "local-id",
                "http://127.0.0.1:5081",
            ),
            (
                "local-id",
                "http://127.0.0.1:5081/",
                "local-id",
                "http://127.0.0.1:5081",
            ),
            (
                "local-id",
                "http://localhost:5081",
                "local-id",
                "http://localhost:5081",
            ),
            (
                "local-id",
                "http://127.0.0.1.example.com:5081",
                "local-id",
                "http://127.0.0.1.example.com:5081",
            ),
            (
                "local-id",
                "http://10.0.0.1:5081",
                "local-id",
                "http://10.0.0.1:5081",
            ),
            (
                "local-id",
                "http://[2001:db8::1]:5081",
                "local-id",
                "http://[2001:db8::1]:5081",
            ),
            (
                "local-id",
                "grpc://127.0.0.1:5081",
                "local-id",
                "grpc://127.0.0.1:5081",
            ),
            ("local-id", "not-a-url", "local-id", "not-a-url"),
        ] {
            assert!(
                Policy::for_identity(peer, addr, local, local_addr).accepts_gzip_for(addr),
                "{peer} {addr}"
            );
        }
        assert!(Policy::default().accepts_gzip_for("http://127.0.0.1:5081"));
        let local_proof = Policy::for_identity(
            "local-id",
            "http://127.0.0.1:5081",
            "local-id",
            "http://127.0.0.1:5081",
        );
        assert!(local_proof.accepts_gzip_for("http://127.0.0.1:5082"));
        let node = &config::cluster::LOCAL_NODE;
        assert_eq!(
            Policy::for_node(node),
            Policy::for_identity(
                &node.uuid,
                &node.grpc_addr,
                &node.uuid,
                &config::cluster::get_local_grpc_addr(),
            )
        );
    }

    #[tokio::test]
    async fn test_metrics_response_compression_negotiation_preserves_headers_and_roundtrip() {
        use std::sync::{Arc, Mutex};

        use config::meta::cluster::NodeInfo;
        use proto::cluster_rpc::{
            self,
            metrics_server::{Metrics, MetricsServer},
        };
        use tonic::{Request, Response, Status, codec::CompressionEncoding, transport::Server};

        use super::{
            MetricsResponseCompression, make_grpc_metrics_client,
            make_grpc_metrics_client_with_response_compression,
        };

        type HeaderSnapshot = (
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        );
        #[derive(Clone)]
        struct Echo {
            observed: Arc<Mutex<Vec<HeaderSnapshot>>>,
        }
        #[tonic::async_trait]
        impl Metrics for Echo {
            async fn query(
                &self,
                request: Request<cluster_rpc::MetricsQueryRequest>,
            ) -> Result<Response<cluster_rpc::MetricsQueryResponse>, Status> {
                let metadata = request.metadata();
                let get = |key: &str| {
                    metadata
                        .get(key)
                        .and_then(|value| value.to_str().ok())
                        .map(str::to_owned)
                };
                self.observed.lock().unwrap().push((
                    get("authorization"),
                    get(&config::get_config().grpc.org_header_key),
                    get("grpc-encoding"),
                    get("grpc-accept-encoding"),
                    get("traceparent"),
                ));
                if get("authorization").as_deref() != Some("fixture-internal-token")
                    || request.get_ref().org_id != "fixture-org"
                {
                    return Err(Status::unauthenticated("fixture metadata mismatch"));
                }
                Ok(Response::new(cluster_rpc::MetricsQueryResponse {
                    job: request.get_ref().job.clone(),
                    result_type: "matrix".into(),
                    series: vec![cluster_rpc::Series {
                        metric: vec![cluster_rpc::Label {
                            name: "path".into(),
                            value: "/generic".into(),
                        }],
                        samples: samples(),
                        ..Default::default()
                    }],
                    ..Default::default()
                }))
            }
            type DataStream =
                futures::stream::Empty<Result<cluster_rpc::MetricsQueryResponse, Status>>;
            async fn data(
                &self,
                _: Request<cluster_rpc::MetricsQueryRequest>,
            ) -> Result<Response<Self::DataStream>, Status> {
                Ok(Response::new(futures::stream::empty()))
            }
        }
        #[derive(Debug)]
        struct Peer(String);
        impl NodeInfo for Peer {
            fn get_grpc_addr(&self) -> String {
                self.0.clone()
            }
            fn get_auth_token(&self) -> String {
                "fixture-internal-token".into()
            }
            fn get_name(&self) -> String {
                "fixture-node".into()
            }
            fn is_local(&self) -> bool {
                true
            }
        }
        struct AbortServer(tokio::task::AbortHandle);
        impl Drop for AbortServer {
            fn drop(&mut self) {
                self.0.abort();
            }
        }

        fn samples() -> Vec<cluster_rpc::Sample> {
            [
                0,
                (-0.0f64).to_bits(),
                1.25f64.to_bits(),
                (-2.5f64).to_bits(),
                f64::MAX.to_bits(),
                f64::MIN_POSITIVE.to_bits(),
                1,
                0x7ff8_0000_0000_0042,
                f64::INFINITY.to_bits(),
                f64::NEG_INFINITY.to_bits(),
            ]
            .into_iter()
            .enumerate()
            .map(|(i, bits)| cluster_rpc::Sample {
                time: i as i64 * 15_000_000,
                value: f64::from_bits(bits),
            })
            .collect()
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = format!("http://{}", listener.local_addr().unwrap());
        let incoming = futures::stream::unfold(listener, |listener| async {
            Some((listener.accept().await.map(|(stream, _)| stream), listener))
        });
        let observed = Arc::new(Mutex::new(Vec::new()));
        let service = MetricsServer::new(Echo {
            observed: Arc::clone(&observed),
        })
        .accept_compressed(CompressionEncoding::Gzip)
        .send_compressed(CompressionEncoding::Gzip);
        let server = tokio::spawn(
            Server::builder()
                .add_service(service)
                .serve_with_incoming(incoming),
        );
        let _server_guard = AbortServer(server.abort_handle());
        let peer: Arc<dyn NodeInfo> = Arc::new(Peer(addr.clone()));
        let local =
            MetricsResponseCompression::for_identity("verified-id", &addr, "verified-id", &addr);
        let remote =
            MetricsResponseCompression::for_identity("different-id", &addr, "verified-id", &addr);
        let traceparent = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
        let mut received = Vec::new();
        let different_endpoint = "http://127.0.0.1:1";
        let mismatched = MetricsResponseCompression::for_identity(
            "verified-id",
            different_endpoint,
            "verified-id",
            different_endpoint,
        );
        assert!(!mismatched.accepts_gzip_for(different_endpoint));
        assert!(mismatched.accepts_gzip_for(&addr));
        for policy in [None, Some(local), Some(remote), Some(mismatched)] {
            let expect_gzip = policy
                .as_ref()
                .is_none_or(|policy| policy.accepts_gzip_for(&addr));
            let mut request = Request::new(cluster_rpc::MetricsQueryRequest {
                org_id: "fixture-org".into(),
                ..Default::default()
            });
            request
                .metadata_mut()
                .insert("traceparent", traceparent.parse().unwrap());
            let response = if let Some(policy) = policy {
                let mut client = make_grpc_metrics_client_with_response_compression(
                    "fixture-trace",
                    "fixture-org",
                    &mut request,
                    &peer,
                    17,
                    policy,
                )
                .await
                .unwrap();
                assert!(request.metadata().contains_key("grpc-timeout"));
                client.query(request).await.unwrap()
            } else {
                let mut client = make_grpc_metrics_client(
                    "fixture-trace",
                    "fixture-org",
                    &mut request,
                    &peer,
                    17,
                )
                .await
                .unwrap();
                assert!(request.metadata().contains_key("grpc-timeout"));
                client.query(request).await.unwrap()
            };
            let encoding = response
                .metadata()
                .get("grpc-encoding")
                .and_then(|value| value.to_str().ok());
            if !expect_gzip {
                assert_ne!(encoding, Some("gzip"));
            } else {
                assert_eq!(encoding, Some("gzip"));
            }
            let response = response.into_inner();
            assert_eq!(response.result_type, "matrix");
            assert_eq!(response.series[0].metric[0].value, "/generic");
            received.push(
                response.series[0]
                    .samples
                    .iter()
                    .map(|sample| (sample.time, sample.value.to_bits()))
                    .collect::<Vec<_>>(),
            );
        }
        assert_eq!(received[0], received[1]);
        assert_eq!(received[0], received[2]);
        assert_eq!(received[0], received[3]);
        assert_eq!(received[0].len(), samples().len());
        let headers = observed.lock().unwrap().clone();
        assert_eq!(headers.len(), 4);
        for (index, (auth, org, request_encoding, accepted, trace)) in headers.iter().enumerate() {
            assert_eq!(auth.as_deref(), Some("fixture-internal-token"));
            assert_eq!(org.as_deref(), Some("fixture-org"));
            assert_eq!(request_encoding.as_deref(), Some("gzip"));
            assert_eq!(trace.as_deref(), Some(traceparent));
            let accepts_gzip = accepted
                .as_ref()
                .is_some_and(|value| value.split(',').any(|encoding| encoding.trim() == "gzip"));
            assert_eq!(accepts_gzip, index != 1);
        }
        drop(headers);
        super::CHANNELS.write().await.remove(&addr);
        server.abort();
        assert!(server.await.unwrap_err().is_cancelled());
    }

    #[test]
    fn test_grpc_addr_uses_tls_https() {
        // https:// addresses (e.g. a TLS-terminating load balancer) must use client TLS.
        assert!(super::grpc_addr_uses_tls("https://lb.example.com:443"));
        assert!(super::grpc_addr_uses_tls("https://10.0.0.1:5081"));
        // The scheme match is case-insensitive.
        assert!(super::grpc_addr_uses_tls("HTTPS://10.0.0.1:5081"));
        assert!(super::grpc_addr_uses_tls("Https://lb.example.com:443"));
    }

    #[test]
    fn test_grpc_addr_uses_tls_http() {
        // http:// addresses (intra-cluster pod-to-pod) stay on h2c, no client TLS.
        assert!(!super::grpc_addr_uses_tls("http://10.0.0.1:5081"));
        assert!(!super::grpc_addr_uses_tls("http://node-1.example.com:5081"));
    }

    #[test]
    fn test_grpc_addr_uses_tls_other_schemes() {
        // Only the https scheme enables TLS; anything else is treated as cleartext.
        assert!(!super::grpc_addr_uses_tls("grpc://10.0.0.1:5081"));
        assert!(!super::grpc_addr_uses_tls("10.0.0.1:5081"));
        assert!(!super::grpc_addr_uses_tls(""));
        // A host that merely contains "https" without it being the scheme is not TLS.
        assert!(!super::grpc_addr_uses_tls("http://https.example.com:5081"));
    }
}
