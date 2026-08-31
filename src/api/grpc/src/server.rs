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

use std::net::SocketAddr;

use arrow_flight::flight_service_server::FlightServiceServer;
use config::get_config;
use openobserve_node::{cluster_info::ClusterInfoService, node::NodeService};
use opentelemetry_proto::tonic::collector::{
    logs::v1::logs_service_server::LogsServiceServer,
    metrics::v1::metrics_service_server::MetricsServiceServer,
    trace::v1::trace_service_server::TraceServiceServer,
};
use proto::cluster_rpc::{
    cluster_info_service_server::ClusterInfoServiceServer, event_server::EventServer,
    ingest_server::IngestServer, metrics_server::MetricsServer,
    node_service_server::NodeServiceServer, query_cache_server::QueryCacheServer,
    search_server::SearchServer, streams_server::StreamsServer,
};
use search_service::SEARCH_SERVER;
use tokio::{net::TcpListener, sync::oneshot};
use tokio_stream::wrappers::TcpListenerStream;
use tonic::{
    codec::CompressionEncoding,
    service::interceptor::InterceptedService,
    transport::{Identity, ServerTlsConfig},
};

use crate::{
    handler::grpc::{
        auth::{check_auth, check_otlp_auth},
        flight::FlightServiceImpl,
        request::{
            event::Eventer,
            ingest::Ingester,
            logs::LogsServer,
            metrics::{ingester::MetricsIngester, querier::MetricsQuerier},
            query_cache::QueryCacheServerImpl,
            stream::StreamServiceImpl,
            traces::TraceServer,
        },
    },
    router,
};

/// Run the gRPC frontend appropriate for the local node role.
pub async fn run(
    init_tx: oneshot::Sender<()>,
    shutdown_rx: oneshot::Receiver<()>,
    stopped_tx: oneshot::Sender<()>,
) -> Result<(), anyhow::Error> {
    if config::cluster::LOCAL_NODE.is_router() {
        run_router(init_tx, shutdown_rx, stopped_tx).await
    } else {
        run_common(init_tx, shutdown_rx, stopped_tx).await
    }
}

async fn run_common(
    init_tx: oneshot::Sender<()>,
    shutdown_rx: oneshot::Receiver<()>,
    stopped_tx: oneshot::Sender<()>,
) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let ip = if !cfg.grpc.addr.is_empty() {
        cfg.grpc.addr.clone()
    } else {
        "0.0.0.0".to_string()
    };
    let gaddr: SocketAddr = format!("{}:{}", ip, cfg.grpc.port).parse()?;
    let event_svc = EventServer::new(Eventer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let search_svc = SearchServer::new(SEARCH_SERVER.clone())
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let metrics_svc = MetricsServer::new(MetricsQuerier)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let metrics_ingest_svc = MetricsServiceServer::new(MetricsIngester)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Zstd)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let logs_svc = LogsServiceServer::new(LogsServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Zstd)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let trace_svc = TraceServiceServer::new(TraceServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Zstd)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let query_cache_svc = QueryCacheServer::new(QueryCacheServerImpl)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let ingest_svc = IngestServer::new(Ingester)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let streams_svc = StreamsServer::new(StreamServiceImpl)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    // Batches are already ZSTD-compressed (Arrow IPC); gzip is dropped client-side only.
    // Server keeps compression so old clients still work during a rolling upgrade.
    let flight_svc = FlightServiceServer::new(FlightServiceImpl)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let node_svc = NodeServiceServer::new(NodeService)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let cluster_info_svc = ClusterInfoServiceServer::new(ClusterInfoService)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);

    let event_svc = authenticated(event_svc);
    let search_svc = authenticated(search_svc);
    let metrics_svc = authenticated(metrics_svc);
    let metrics_ingest_svc = otlp_authenticated(metrics_ingest_svc);
    let trace_svc = otlp_authenticated(trace_svc);
    let logs_svc = otlp_authenticated(logs_svc);
    let query_cache_svc = authenticated(query_cache_svc);
    let ingest_svc = authenticated(ingest_svc);
    let streams_svc = authenticated(streams_svc);
    let flight_svc = authenticated(flight_svc);
    let node_svc = authenticated(node_svc);
    let cluster_info_svc = authenticated(cluster_info_svc);

    log::info!(
        "starting gRPC server {} at {}",
        if cfg.grpc.tls_enabled { "with TLS" } else { "" },
        gaddr
    );
    let listener = bind_listener(gaddr, init_tx).await?;

    let mut builder = server_builder()?;
    let ret = builder
        .add_service(event_svc)
        .add_service(search_svc)
        .add_service(metrics_svc)
        .add_service(metrics_ingest_svc)
        .add_service(trace_svc)
        .add_service(logs_svc)
        .add_service(query_cache_svc)
        .add_service(ingest_svc)
        .add_service(streams_svc)
        .add_service(flight_svc)
        .add_service(node_svc)
        .add_service(cluster_info_svc)
        .serve_with_incoming_shutdown(TcpListenerStream::new(listener), async {
            shutdown_rx.await.ok();
            log::info!("gRPC server starts shutting down");
        })
        .await;
    if let Err(e) = ret {
        return Err(anyhow::anyhow!("{e}"));
    }

    stopped_tx.send(()).ok();
    Ok(())
}

async fn run_router(
    init_tx: oneshot::Sender<()>,
    shutdown_rx: oneshot::Receiver<()>,
    stopped_tx: oneshot::Sender<()>,
) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let gaddr: SocketAddr = format!("0.0.0.0:{}", cfg.grpc.port).parse()?;
    let logs_svc = LogsServiceServer::new(router::grpc::ingest::logs::LogsServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Zstd)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let metrics_svc = MetricsServiceServer::new(router::grpc::ingest::metrics::MetricsServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Zstd)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let traces_svc = TraceServiceServer::new(router::grpc::ingest::traces::TraceServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Zstd)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);

    let logs_svc = otlp_authenticated(logs_svc);
    let metrics_svc = otlp_authenticated(metrics_svc);
    let traces_svc = otlp_authenticated(traces_svc);

    log::info!(
        "starting gRPC server {} at {}",
        if cfg.grpc.tls_enabled { "with TLS" } else { "" },
        gaddr
    );
    let listener = bind_listener(gaddr, init_tx).await?;

    let mut builder = server_builder()?;
    let ret = builder
        .add_service(logs_svc)
        .add_service(metrics_svc)
        .add_service(traces_svc)
        .serve_with_incoming_shutdown(TcpListenerStream::new(listener), async {
            shutdown_rx.await.ok();
            log::info!("gRPC server starts shutting down");
        })
        .await;
    if let Err(e) = ret {
        return Err(anyhow::anyhow!("{e}"));
    }

    stopped_tx.send(()).ok();
    Ok(())
}

type AuthInterceptor = fn(tonic::Request<()>) -> Result<tonic::Request<()>, tonic::Status>;

fn authenticated<S>(service: S) -> InterceptedService<S, AuthInterceptor> {
    InterceptedService::new(service, check_auth)
}

fn otlp_authenticated<S>(service: S) -> InterceptedService<S, AuthInterceptor> {
    InterceptedService::new(service, check_otlp_auth)
}

async fn bind_listener(
    gaddr: SocketAddr,
    init_tx: oneshot::Sender<()>,
) -> Result<TcpListener, anyhow::Error> {
    let listener = TcpListener::bind(gaddr).await?;
    init_tx
        .send(())
        .map_err(|_| anyhow::anyhow!("gRPC initialization receiver dropped"))?;
    Ok(listener)
}

fn server_builder() -> Result<tonic::transport::Server, anyhow::Error> {
    let cfg = get_config();
    let builder = if cfg.grpc.tls_enabled {
        let cert = std::fs::read_to_string(&cfg.grpc.tls_cert_path)?;
        let key = std::fs::read_to_string(&cfg.grpc.tls_key_path)?;
        let identity = Identity::from_pem(cert, key);
        tonic::transport::Server::builder().tls_config(ServerTlsConfig::new().identity(identity))?
    } else {
        tonic::transport::Server::builder()
    };
    Ok(builder
        .initial_stream_window_size(config::GRPC_HTTP2_STREAM_WINDOW_SIZE)
        .initial_connection_window_size(config::GRPC_HTTP2_CONNECTION_WINDOW_SIZE)
        .http2_adaptive_window(Some(cfg.grpc.http2_adaptive_window))
        .tcp_nodelay(true))
}

#[cfg(test)]
mod tests {
    use tokio::net::TcpStream;

    use super::*;

    #[tokio::test]
    async fn init_is_signaled_after_grpc_socket_listens() {
        let gaddr = "127.0.0.1:0".parse().unwrap();
        let (init_tx, init_rx) = oneshot::channel();

        let listener = bind_listener(gaddr, init_tx).await.unwrap();
        init_rx.await.unwrap();

        assert!(
            TcpStream::connect(listener.local_addr().unwrap())
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn failed_bind_does_not_signal_init() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let (init_tx, init_rx) = oneshot::channel();

        assert!(
            bind_listener(listener.local_addr().unwrap(), init_tx)
                .await
                .is_err()
        );
        assert!(init_rx.await.is_err());
    }
}
