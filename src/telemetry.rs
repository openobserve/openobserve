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

//! Logging and OpenTelemetry tracing setup.
//!
//! This lives in the library rather than in `main.rs` on purpose. Composing the
//! `tracing_subscriber` layer stack and the OTLP exporter / span-processor chain
//! instantiates very large generic types, and everything `main.rs` monomorphizes
//! is emitted into the binary's own codegen units -- the last unit on the
//! build's critical path, which no other unit can overlap with. The library unit
//! compiles in parallel with the API crates instead, so the same work costs less
//! wall clock.

use std::{collections::HashMap, str::FromStr, time::Duration};

use config::{META_ORG_ID, cluster::LOCAL_NODE, get_config};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::ai;
use opentelemetry::{KeyValue, global, trace::TracerProvider};
use opentelemetry_otlp::{WithExportConfig, WithHttpConfig, WithTonicConfig};
use opentelemetry_sdk::{Resource, propagation::TraceContextPropagator};
use tonic::{
    codec::CompressionEncoding,
    metadata::{MetadataKey, MetadataMap, MetadataValue},
};
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::{
    EnvFilter, Registry, filter::LevelFilter as TracingLevelFilter, fmt::Layer, prelude::*,
};

/// Setup the tracing related components
pub fn setup_logs() -> tracing_appender::non_blocking::WorkerGuard {
    use tracing_subscriber::fmt::writer::BoxMakeWriter;

    let cfg = get_config();
    let (writer, guard) = if cfg.log.file_dir.is_empty() {
        let (non_blocking, _guard) = tracing_appender::non_blocking(std::io::stdout());
        (BoxMakeWriter::new(non_blocking), _guard)
    } else {
        let file_name_prefix = if cfg.log.file_name_prefix.is_empty() {
            format!("o2.{}.log", cfg.common.instance_name.as_str())
        } else {
            cfg.log.file_name_prefix.to_string()
        };
        let file_appender = tracing_appender::rolling::daily(&cfg.log.file_dir, file_name_prefix);
        let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
        (BoxMakeWriter::new(non_blocking), _guard)
    };
    let layer = if cfg.log.json_format {
        Layer::default()
            .with_writer(writer)
            .with_timer(config::meta::logger::CustomTimeFormat)
            .with_ansi(false)
            .json()
            .with_current_span(false)
            .with_span_list(false)
            .boxed()
    } else {
        Layer::default()
            .with_writer(writer)
            .with_ansi(false)
            .with_target(true)
            .event_format(config::meta::logger::O2Formatter::default())
            .boxed()
    };

    tracing_subscriber::registry()
        .with(
            EnvFilter::builder()
                .with_default_directive(TracingLevelFilter::INFO.into())
                .from_env_lossy(),
        )
        .with(layer)
        .init();
    guard
}

/// Custom span processor that filters spans based on their name prefix
#[cfg(feature = "enterprise")]
#[derive(Debug)]
struct FilteringSpanProcessor<P> {
    inner: P,
    prefix_filter: Option<String>,
}

#[cfg(feature = "enterprise")]
impl<P> FilteringSpanProcessor<P> {
    fn new(inner: P, prefix_filter: Option<String>) -> Self {
        Self {
            inner,
            prefix_filter,
        }
    }
}

#[cfg(feature = "enterprise")]
impl<P: opentelemetry_sdk::trace::SpanProcessor> opentelemetry_sdk::trace::SpanProcessor
    for FilteringSpanProcessor<P>
{
    fn on_start(&self, span: &mut opentelemetry_sdk::trace::Span, cx: &opentelemetry::Context) {
        // Always call inner on_start - we can only filter on_end when we have the full span data
        self.inner.on_start(span, cx);
    }

    fn on_end(&self, span: opentelemetry_sdk::trace::SpanData) {
        // If no filter is set, pass through all spans
        if let Some(prefix) = &self.prefix_filter {
            let span_name = span.name.as_ref();
            // Only process spans that match the prefix
            if !span_name.starts_with(prefix) {
                return;
            }
        }
        self.inner.on_end(span);
    }

    fn force_flush(&self) -> Result<(), opentelemetry_sdk::error::OTelSdkError> {
        self.inner.force_flush()
    }

    fn shutdown(&self) -> Result<(), opentelemetry_sdk::error::OTelSdkError> {
        self.inner.shutdown()
    }

    fn shutdown_with_timeout(
        &self,
        timeout: std::time::Duration,
    ) -> Result<(), opentelemetry_sdk::error::OTelSdkError> {
        self.inner.shutdown_with_timeout(timeout)
    }
}

/// Custom SpanExporter that ingests traces directly into the _meta org.
/// This is used by the search inspector feature to ensure search profiling
/// traces are always available in the _meta org, regardless of where the user's
/// OTLP endpoint points.
///
/// Handles both single-node and multi-node deployments:
/// - Ingester nodes: calls `handle_otlp_request` directly
/// - Non-ingester nodes (e.g. queriers): forwards via gRPC to an ingester
#[derive(Debug)]
struct MetaOrgTraceExporter {
    resource: opentelemetry_proto::transform::common::tonic::ResourceAttributesWithSchema,
}

impl MetaOrgTraceExporter {
    fn new(
        resource: opentelemetry_proto::transform::common::tonic::ResourceAttributesWithSchema,
    ) -> Self {
        Self { resource }
    }
}

impl opentelemetry_sdk::trace::SpanExporter for MetaOrgTraceExporter {
    fn export(
        &self,
        batch: Vec<opentelemetry_sdk::trace::SpanData>,
    ) -> impl std::future::Future<Output = opentelemetry_sdk::error::OTelSdkResult> + Send {
        // Convert SpanData to ExportTraceServiceRequest synchronously
        // so we don't hold a borrow on &self across await points
        let resource_spans =
            opentelemetry_proto::transform::trace::tonic::group_spans_by_resource_and_scope(
                batch,
                &self.resource,
            );
        let request = opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest {
            resource_spans,
        };

        async move {
            if LOCAL_NODE.is_ingester() {
                // Ingest directly on ingester nodes
                match openobserve_core::traces::handle_otlp_request(
                    META_ORG_ID,
                    request,
                    config::meta::otlp::OtlpRequestType::HttpJson,
                    None,
                    ingestion_common::IngestUser::SystemJob(
                        ingestion_common::SystemJobType::SelfReporting,
                    ),
                )
                .await
                {
                    Ok(resp) if resp.status().is_success() => {
                        log::debug!("[SEARCH-INSPECTOR] Successfully ingested traces to _meta org");
                        Ok(())
                    }
                    Ok(resp) => {
                        log::error!(
                            "[SEARCH-INSPECTOR] Error ingesting traces to _meta org: status={}",
                            resp.status()
                        );
                        Err(opentelemetry_sdk::error::OTelSdkError::InternalFailure(
                            format!("Failed to ingest traces: status={}", resp.status()),
                        ))
                    }
                    Err(e) => {
                        log::error!("[SEARCH-INSPECTOR] Error ingesting traces to _meta org: {e}");
                        Err(opentelemetry_sdk::error::OTelSdkError::InternalFailure(
                            format!("Failed to ingest traces: {e}"),
                        ))
                    }
                }
            } else {
                // Forward to an ingester node via gRPC
                let cfg = get_config();
                let token = match config::meta::cluster::get_internal_grpc_token()
                    .parse::<tonic::metadata::MetadataValue<_>>()
                {
                    Ok(token) => token,
                    Err(e) => {
                        log::error!("[SEARCH-INSPECTOR] Failed to parse internal gRPC token: {e}");
                        return Err(opentelemetry_sdk::error::OTelSdkError::InternalFailure(
                            format!("Failed to parse gRPC token: {e}"),
                        ));
                    }
                };

                let (_addr, channel) = match openobserve_node::grpc::get_ingester_channel().await {
                    Ok(v) => v,
                    Err(e) => {
                        log::error!("[SEARCH-INSPECTOR] Failed to get ingester channel: {e}");
                        return Err(opentelemetry_sdk::error::OTelSdkError::InternalFailure(
                            format!("No ingester available: {e}"),
                        ));
                    }
                };

                let client = opentelemetry_proto::tonic::collector::trace::v1::trace_service_client::TraceServiceClient::with_interceptor(
                    channel,
                    move |mut req: tonic::Request<()>| {
                        req.metadata_mut().insert("authorization", token.clone());
                        Ok(req)
                    },
                );

                let org_header_key: MetadataKey<_> = cfg.grpc.org_header_key.parse().unwrap();
                let mut grpc_request = tonic::Request::new(request);
                grpc_request.metadata_mut().insert(
                    org_header_key,
                    META_ORG_ID
                        .parse::<tonic::metadata::MetadataValue<_>>()
                        .unwrap(),
                );

                match client
                    .send_compressed(CompressionEncoding::Gzip)
                    .accept_compressed(CompressionEncoding::Gzip)
                    .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
                    .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
                    .export(grpc_request)
                    .await
                {
                    Ok(_) => {
                        log::debug!(
                            "[SEARCH-INSPECTOR] Successfully forwarded traces to ingester for _meta org"
                        );
                        Ok(())
                    }
                    Err(e) => {
                        log::error!("[SEARCH-INSPECTOR] Error forwarding traces to ingester: {e}");
                        Err(opentelemetry_sdk::error::OTelSdkError::InternalFailure(
                            format!("Failed to forward traces to ingester: {e}"),
                        ))
                    }
                }
            }
        }
    }
}

pub fn enable_tracing() -> Result<opentelemetry_sdk::trace::SdkTracerProvider, anyhow::Error> {
    let cfg = get_config();
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());

    let mut tracer_builder = opentelemetry_sdk::trace::SdkTracerProvider::builder();

    // Add main OpenObserve OTLP exporter (if general tracing is enabled)
    if cfg.common.tracing_enabled || cfg.common.tracing_search_enabled {
        tracer_builder = if cfg.common.otel_otlp_grpc_url.is_empty() {
            tracer_builder.with_span_processor(
            opentelemetry_sdk::trace::span_processor_with_async_runtime::BatchSpanProcessor::builder(
                {
                    let mut headers = HashMap::new();
                    headers.insert(
                        cfg.common.tracing_header_key.clone(),
                        cfg.common.tracing_header_value.clone(),
                    );
                    opentelemetry_otlp::SpanExporter::builder()
                        .with_http()
                        .with_http_client(
                            reqwest::Client::builder()
                        .danger_accept_invalid_certs(true)
                        .timeout(Duration::from_secs(10))           // Overall request timeout
                        .connect_timeout(Duration::from_secs(5))    // Connection establishment timeout
                        .pool_idle_timeout(Duration::from_secs(60)) // How long to keep idle connections
                        .pool_max_idle_per_host(10) // How many idle connections to keep per host
                        .build()?,
                        )
                        .with_endpoint(&cfg.common.otel_otlp_url)
                        .with_headers(headers)
                        .build()?
                },
                opentelemetry_sdk::runtime::Tokio,
            )
            .build(),
        )
        } else {
            tracer_builder.with_span_processor(
            opentelemetry_sdk::trace::span_processor_with_async_runtime::BatchSpanProcessor::builder(
                {
                    let mut metadata = MetadataMap::new();
                    metadata.insert(
                        MetadataKey::from_str(&cfg.common.tracing_header_key).unwrap(),
                        MetadataValue::from_str(&cfg.common.tracing_header_value).unwrap(),
                    );
                    metadata.insert(
                        MetadataKey::from_str(&cfg.grpc.org_header_key).unwrap(),
                        MetadataValue::from_str(&cfg.common.tracing_grpc_header_org).unwrap(),
                    );
                    metadata.insert(
                        MetadataKey::from_str(&cfg.grpc.stream_header_key).unwrap(),
                        MetadataValue::from_str(&cfg.common.tracing_grpc_header_stream_name)
                            .unwrap(),
                    );
                    opentelemetry_otlp::SpanExporter::builder()
                        .with_tonic()
                        .with_endpoint(&cfg.common.otel_otlp_grpc_url)
                        .with_metadata(metadata)
                        .with_protocol(opentelemetry_otlp::Protocol::Grpc)
                        .build()?
                },
                opentelemetry_sdk::runtime::Tokio,
            )
            .build(),
        )
        };
        log::info!("Main OpenObserve OTLP exporter configured");
    }

    // Handle AI tracing (enterprise feature)
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
        let o2_cfg = get_o2_config();

        // If AI tracing is enabled but general tracing is NOT enabled,
        // we need to add OpenObserve OTLP exporter for AI traces
        if o2_cfg.ai.tracing_enabled
            && !cfg.common.tracing_enabled
            && !cfg.common.tracing_search_enabled
        {
            log::info!("AI tracing enabled independently - configuring OpenObserve OTLP exporter");

            // Add OpenObserve exporter for AI traces
            if !cfg.common.otel_otlp_url.is_empty() {
                let mut headers = HashMap::new();
                headers.insert(
                    cfg.common.tracing_header_key.clone(),
                    cfg.common.tracing_header_value.clone(),
                );

                let oo_exporter = opentelemetry_otlp::SpanExporter::builder()
                    .with_http()
                    .with_http_client(
                        reqwest::Client::builder()
                            .danger_accept_invalid_certs(true)
                            .timeout(Duration::from_secs(10))
                            .connect_timeout(Duration::from_secs(5))
                            .pool_idle_timeout(Duration::from_secs(60))
                            .pool_max_idle_per_host(10)
                            .build()?,
                    )
                    .with_endpoint(&cfg.common.otel_otlp_url)
                    .with_headers(headers)
                    .build()?;

                let oo_processor = opentelemetry_sdk::trace::span_processor_with_async_runtime::BatchSpanProcessor::builder(
                    oo_exporter,
                    opentelemetry_sdk::runtime::Tokio,
                )
                .build();

                // Wrap with filtering processor to only send AI traces
                let filtered_processor = FilteringSpanProcessor::new(
                    oo_processor,
                    Some("ai.".to_string()), // Only send spans starting with "ai."
                );

                tracer_builder = tracer_builder.with_span_processor(filtered_processor);
                log::info!(
                    "AI traces (ai.* spans only) will be sent to OpenObserve: {}",
                    cfg.common.otel_otlp_url
                );
            } else if !cfg.common.otel_otlp_grpc_url.is_empty() {
                let mut metadata = MetadataMap::new();
                metadata.insert(
                    MetadataKey::from_str(&cfg.common.tracing_header_key).unwrap(),
                    MetadataValue::from_str(&cfg.common.tracing_header_value).unwrap(),
                );

                let oo_exporter = opentelemetry_otlp::SpanExporter::builder()
                    .with_tonic()
                    .with_endpoint(&cfg.common.otel_otlp_grpc_url)
                    .with_metadata(metadata)
                    .with_protocol(opentelemetry_otlp::Protocol::Grpc)
                    .build()?;

                let oo_processor = opentelemetry_sdk::trace::span_processor_with_async_runtime::BatchSpanProcessor::builder(
                    oo_exporter,
                    opentelemetry_sdk::runtime::Tokio,
                )
                .build();

                // Wrap with filtering processor to only send AI traces
                let filtered_processor = FilteringSpanProcessor::new(
                    oo_processor,
                    Some("ai.".to_string()), // Only send spans starting with "ai."
                );

                tracer_builder = tracer_builder.with_span_processor(filtered_processor);
                log::info!(
                    "AI traces (ai.* spans only) will be sent to OpenObserve (gRPC): {}",
                    cfg.common.otel_otlp_grpc_url
                );
            } else {
                log::warn!(
                    "AI tracing enabled but ZO_OTEL_OTLP_URL not configured - AI traces will not be exported"
                );
            }
        }

        // Additionally, if O2_AI_EVAL_OTLP_ENDPOINT is set, send AI traces to evaluation platform
        // too
        let eval_endpoint = std::env::var("O2_AI_EVAL_OTLP_ENDPOINT")
            .ok()
            .or_else(|| o2_cfg.ai.eval_otlp_endpoint.clone())
            .filter(|s| !s.is_empty());

        if let Some(endpoint) = eval_endpoint {
            log::info!(
                "Configuring additional AI evaluation OTLP exporter to: {}",
                endpoint
            );

            let eval_exporter = opentelemetry_otlp::SpanExporter::builder()
                .with_tonic()
                .with_endpoint(endpoint)
                .with_timeout(std::time::Duration::from_secs(10))
                .build()?;

            let eval_processor = opentelemetry_sdk::trace::span_processor_with_async_runtime::BatchSpanProcessor::builder(
                eval_exporter,
                opentelemetry_sdk::runtime::Tokio,
            )
            .build();

            // Wrap with filtering processor to only send AI traces
            let filtered_eval_processor =
                FilteringSpanProcessor::new(eval_processor, Some("ai.".to_string()));

            tracer_builder = tracer_builder.with_span_processor(filtered_eval_processor);
            log::info!(
                "AI evaluation OTLP exporter configured - AI traces (ai.* spans only) will be sent to evaluation platform"
            );
        }
    }

    // Build resource attributes (base + extra envs)
    let mut resource_attrs = vec![
        KeyValue::new("service.name", cfg.common.node_role.to_string()),
        KeyValue::new("service.instance", cfg.common.instance_name.to_string()),
        KeyValue::new("service.version", config::VERSION),
    ];
    for env_name in cfg
        .common
        .tracing_extra_envs
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Ok(val) = std::env::var(env_name)
            && !val.is_empty()
        {
            resource_attrs.push(KeyValue::new(env_name.to_lowercase(), val));
        }
    }

    // If search inspector is enabled, add a span processor that ingests traces
    // directly into the _meta org. This ensures search profiling data is always
    // available in _meta regardless of where the user's OTLP endpoint points.
    if cfg.common.search_inspector_enabled {
        let resource = Resource::builder()
            .with_attributes(resource_attrs.clone())
            .build();
        let resource_attrs =
            opentelemetry_proto::transform::common::tonic::ResourceAttributesWithSchema::from(
                &resource,
            );
        let meta_exporter = MetaOrgTraceExporter::new(resource_attrs);
        let meta_processor =
            opentelemetry_sdk::trace::span_processor_with_async_runtime::BatchSpanProcessor::builder(
                meta_exporter,
                opentelemetry_sdk::runtime::Tokio,
            )
            .build();
        tracer_builder = tracer_builder.with_span_processor(meta_processor);
        log::info!(
            "Search inspector OTLP exporter configured - traces will be ingested to _meta org"
        );
    }

    // Add UUID v7 ID generator and resource attributes
    tracer_builder = tracer_builder.with_id_generator({
        #[cfg(feature = "enterprise")]
        {
            ai::agent::tracing::UuidV7IdGenerator
        }
        #[cfg(not(feature = "enterprise"))]
        {
            opentelemetry_sdk::trace::RandomIdGenerator::default()
        }
    });

    let tracer =
        tracer_builder.with_resource(Resource::builder().with_attributes(resource_attrs).build());

    // build
    let tracer = tracer.build();

    let layer = if cfg.log.json_format {
        tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .json()
            .boxed()
    } else {
        tracing_subscriber::fmt::layer().with_ansi(false).boxed()
    };

    global::set_tracer_provider(tracer.clone());
    Registry::default()
        .with(tracing_subscriber::EnvFilter::new(&cfg.log.level))
        .with(layer)
        .with(OpenTelemetryLayer::new(
            tracer.tracer("tracing-otel-subscriber"),
        ))
        .init();

    // Return the tracer provider
    Ok(tracer)
}
