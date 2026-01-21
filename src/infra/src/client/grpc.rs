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

use config::{RwAHashMap, get_config, meta::cluster::NodeInfo};
use once_cell::sync::Lazy;
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

pub async fn create_channel(grpc_addr: &str) -> Result<Channel, tonic::Status> {
    let cfg = config::get_config();
    let mut channel = Channel::from_shared(grpc_addr.to_string()).map_err(|err| {
        log::error!("gRPC node: {}, parse err: {:?}", &grpc_addr, err);
        Status::internal("parse gRPC node error".to_string())
    })?;
    if cfg.grpc.tls_enabled {
        let pem = std::fs::read_to_string(&cfg.grpc.tls_cert_path)?;
        let cert = Certificate::from_pem(pem);
        let tls = ClientTlsConfig::new()
            .ca_certificate(cert)
            .domain_name(&cfg.grpc.tls_cert_domain);
        channel = channel.tls_config(tls).map_err(|err| {
            log::error!("gRPC node: {}, tls err: {:?}", &grpc_addr, err);
            Status::internal("tls gRPC node error".to_string())
        })?;
    }
    let channel = channel
        .connect_timeout(std::time::Duration::from_secs(
            config::get_config().grpc.connect_timeout,
        ))
        .connect()
        .await
        .map_err(|err| {
            log::error!("gRPC node: {}, connect err: {:?}", &grpc_addr, err);
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
                &node.get_grpc_addr(),
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
    let channel = get_cached_channel(&node.get_grpc_addr())
        .await
        .map_err(|err| {
            log::error!(
                "[trace_id {trace_id}] promql->search->grpc: node: {}, connect err: {:?}",
                &node.get_grpc_addr(),
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
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
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
                &node.get_grpc_addr(),
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
                &node.get_grpc_addr(),
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
