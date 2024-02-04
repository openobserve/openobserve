// Copyright 2023 Zinc Labs Inc.
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
// #![deny(
//     unused_import_braces,
//     unused_imports,
//     unused_variables,
//     unused_allocation,
//     unused_extern_crates
// )]

use std::{
    collections::HashMap,
    net::SocketAddr,
    str::FromStr,
    sync::{
        atomic::{AtomicU16, Ordering},
        Arc,
    },
    time::Duration,
};

use actix_web::{http::KeepAlive, middleware, web, App, HttpServer};
use actix_web_opentelemetry::RequestTracing;
use config::{
    cluster::{is_router, LOCAL_NODE_ROLE},
    CONFIG,
};
use log::LevelFilter;
use openobserve::{
    cli::basic::cli,
    common::{
        infra::{self as common_infra, cluster, config::VERSION},
        meta, migration,
        utils::zo_logger,
    },
    handler::{
        grpc::{
            auth::check_auth,
            cluster_rpc::{
                event_server::EventServer, filelist_server::FilelistServer,
                metrics_server::MetricsServer, search_server::SearchServer,
                usage_server::UsageServer,
            },
            request::{
                event::Eventer,
                file_list::Filelister,
                logs::LogsServer,
                metrics::{ingester::Ingester, querier::Querier},
                search::Searcher,
                traces::TraceServer,
                usage::UsageServerImpl,
            },
        },
        http::router::*,
    },
    job, router,
    service::{db, distinct_values},
};
use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_proto::tonic::collector::{
    logs::v1::logs_service_server::LogsServiceServer,
    metrics::v1::metrics_service_server::MetricsServiceServer,
    trace::v1::trace_service_server::TraceServiceServer,
};
use opentelemetry_sdk::{propagation::TraceContextPropagator, trace as sdktrace, Resource};
#[cfg(feature = "profiling")]
use pyroscope::PyroscopeAgent;
#[cfg(feature = "profiling")]
use pyroscope_pprofrs::{pprof_backend, PprofConfig};
use tokio::sync::oneshot;
use tonic::codec::CompressionEncoding;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::Registry;

#[cfg(feature = "mimalloc")]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[cfg(feature = "jemalloc")]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

use tracing_subscriber::{
    self, filter::LevelFilter as TracingLevelFilter, fmt::Layer, prelude::*, EnvFilter,
};

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    #[cfg(feature = "profiling")]
    let agent = PyroscopeAgent::builder(
        &CONFIG.profiling.pyroscope_server_url,
        &CONFIG.profiling.pyroscope_project_name,
    )
    .tags([("Host", "Rust")].to_vec())
    .backend(pprof_backend(PprofConfig::new().sample_rate(100)))
    .build()
    .expect("Failed to setup pyroscope agent");
    #[cfg(feature = "profiling")]
    let agent_running = agent.start().expect("Failed to start pyroscope agent");

    // cli mode
    if cli::cli().await? {
        return Ok(());
    }

    // setup logs
    let _guard: Option<WorkerGuard> = if CONFIG.log.events_enabled {
        let logger = zo_logger::ZoLogger {
            sender: zo_logger::EVENT_SENDER.clone(),
        };
        log::set_boxed_logger(Box::new(logger)).map(|()| {
            log::set_max_level(
                LevelFilter::from_str(&CONFIG.log.level).unwrap_or(LevelFilter::Info),
            )
        })?;
        None
    } else if CONFIG.common.tracing_enabled {
        enable_tracing()?;
        None
    } else {
        Some(setup_logs())
    };

    log::info!("Starting OpenObserve {}", VERSION);
    log::info!(
        "System info: CPU cores {}, MEM total {} MB, Disk total {} GB, free {} GB",
        CONFIG.limit.cpu_num,
        CONFIG.limit.mem_total / 1024 / 1024,
        CONFIG.limit.disk_total / 1024 / 1024 / 1024,
        CONFIG.limit.disk_free / 1024 / 1024 / 1024,
    );

    // it must be initialized before the server starts
    cluster::register_and_keepalive()
        .await
        .expect("cluster init failed");
    // init config
    config::init().await.expect("config init failed");
    // init infra
    infra::init().await.expect("config init failed");
    common_infra::init().await.expect("infra init failed");

    // check version upgrade
    let old_version = db::version::get().await.unwrap_or("v0.0.0".to_string());
    migration::check_upgrade(&old_version, VERSION).await?;
    // migrate dashboards
    migration::dashboards::run().await?;

    // ingester init
    ingester::init().await.expect("ingester init failed");

    // init job
    job::init().await.expect("job init failed");

    // gRPC server
    let (grpc_shutudown_tx, grpc_shutdown_rx) = oneshot::channel();
    let (grpc_stopped_tx, grpc_stopped_rx) = oneshot::channel();
    if is_router(&LOCAL_NODE_ROLE) {
        init_router_grpc_server(grpc_shutdown_rx, grpc_stopped_tx)?;
    } else {
        init_common_grpc_server(grpc_shutdown_rx, grpc_stopped_tx)?;
    }

    // let node online
    let _ = cluster::set_online(false).await;

    // This is specifically for enrichment tables, as caching is happening using
    // search service
    db::schema::cache_enrichment_tables()
        .await
        .expect("EnrichmentTables cache failed");

    tokio::task::spawn(async move { zo_logger::send_logs().await });
    tokio::task::spawn(async move {
        meta::telemetry::Telemetry::new()
            .event("OpenObserve - Starting server", None, false)
            .await;
    });

    // init http server
    init_http_server().await?;
    log::info!("HTTP server stopped");

    // leave the cluster
    _ = cluster::leave().await;
    log::info!("left cluster");

    // stop gRPC server
    grpc_shutudown_tx.send(()).ok();
    grpc_stopped_rx.await.ok();
    log::info!("gRPC server stopped");

    // flush WAL cache to disk
    common_infra::wal::flush_all_to_disk().await;
    // flush compact offset cache to disk disk
    _ = db::compact::files::sync_cache_to_db().await;
    // flush db
    let db = infra::db::get_db().await;
    _ = db.close().await;
    // flush distinct values
    _ = distinct_values::close().await;

    // stop telemetry
    meta::telemetry::Telemetry::new()
        .event("OpenObserve - Server stopped", None, false)
        .await;

    log::info!("server stopped");

    #[cfg(feature = "profiling")]
    let agent_ready = agent_running.stop().unwrap();
    #[cfg(feature = "profiling")]
    agent_ready.shutdown();

    Ok(())
}

fn init_common_grpc_server(
    shutdown_rx: oneshot::Receiver<()>,
    stopped_tx: oneshot::Sender<()>,
) -> Result<(), anyhow::Error> {
    let ip = if !CONFIG.grpc.addr.is_empty() {
        CONFIG.grpc.addr.clone()
    } else {
        "0.0.0.0".to_string()
    };
    let gaddr: SocketAddr = format!("{}:{}", ip, CONFIG.grpc.port).parse()?;
    let event_svc = EventServer::new(Eventer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let search_svc = SearchServer::new(Searcher)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let filelist_svc = FilelistServer::new(Filelister)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let metrics_svc = MetricsServer::new(Querier)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let metrics_ingest_svc = MetricsServiceServer::new(Ingester)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let usage_svc = UsageServer::new(UsageServerImpl)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let logs_svc = LogsServiceServer::new(LogsServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let tracer = TraceServer::default();
    let trace_svc = TraceServiceServer::new(tracer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);

    tokio::task::spawn(async move {
        log::info!("starting gRPC server at {}", gaddr);
        tonic::transport::Server::builder()
            .layer(tonic::service::interceptor(check_auth))
            .add_service(event_svc)
            .add_service(search_svc)
            .add_service(filelist_svc)
            .add_service(metrics_svc)
            .add_service(metrics_ingest_svc)
            .add_service(trace_svc)
            .add_service(usage_svc)
            .add_service(logs_svc)
            .serve_with_shutdown(gaddr, async {
                shutdown_rx.await.ok();
                log::info!("gRPC server starts shutting down");
            })
            .await
            .expect("gRPC server init failed");
        stopped_tx.send(()).ok();
    });
    Ok(())
}

fn init_router_grpc_server(
    shutdown_rx: oneshot::Receiver<()>,
    stopped_tx: oneshot::Sender<()>,
) -> Result<(), anyhow::Error> {
    let gaddr: SocketAddr = format!("0.0.0.0:{}", CONFIG.grpc.port).parse()?;
    let logs_svc = LogsServiceServer::new(router::grpc::ingest::logs::LogsServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let metrics_svc = MetricsServiceServer::new(router::grpc::ingest::metrics::MetricsServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let traces_svc = TraceServiceServer::new(router::grpc::ingest::traces::TraceServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);

    tokio::task::spawn(async move {
        log::info!("starting gRPC server at {}", gaddr);
        tonic::transport::Server::builder()
            .layer(tonic::service::interceptor(check_auth))
            .add_service(logs_svc)
            .add_service(metrics_svc)
            .add_service(traces_svc)
            .serve_with_shutdown(gaddr, async {
                shutdown_rx.await.ok();
                log::info!("gRPC server starts shutting down");
            })
            .await
            .expect("gRPC server init failed");
        stopped_tx.send(()).ok();
    });
    Ok(())
}

async fn init_http_server() -> Result<(), anyhow::Error> {
    // metrics
    let prometheus = config::metrics::create_prometheus_handler();

    let thread_id = Arc::new(AtomicU16::new(0));
    let haddr: SocketAddr = if CONFIG.http.ipv6_enabled {
        format!("[::]:{}", CONFIG.http.port).parse()?
    } else {
        let ip = if !CONFIG.http.addr.is_empty() {
            CONFIG.http.addr.clone()
        } else {
            "0.0.0.0".to_string()
        };
        format!("{}:{}", ip, CONFIG.http.port).parse()?
    };

    let server = HttpServer::new(move || {
        let local_id = thread_id.load(Ordering::SeqCst) as usize;
        if CONFIG.common.feature_per_thread_lock {
            thread_id.fetch_add(1, Ordering::SeqCst);
        }
        log::info!(
            "starting HTTP server at: {}, thread_id: {}",
            haddr,
            local_id
        );
        let mut app = App::new().wrap(prometheus.clone());
        if is_router(&LOCAL_NODE_ROLE) {
            app = app.service(
                // if `CONFIG.common.base_uri` is empty, scope("") still works as expected.
                web::scope(&CONFIG.common.base_uri)
                    .service(router::http::config)
                    .service(router::http::config_paths)
                    .service(router::http::api)
                    .service(router::http::aws)
                    .service(router::http::gcp)
                    .service(router::http::rum)
                    .configure(get_basic_routes)
                    .configure(get_proxy_routes),
            )
        } else {
            app = app.service(
                web::scope(&CONFIG.common.base_uri)
                    .configure(get_config_routes)
                    .configure(get_service_routes)
                    .configure(get_other_service_routes)
                    .configure(get_basic_routes)
                    .configure(get_proxy_routes),
            )
        }
        app.app_data(web::JsonConfig::default().limit(CONFIG.limit.req_json_limit))
            .app_data(web::PayloadConfig::new(CONFIG.limit.req_payload_limit)) // size is in bytes
            .app_data(web::Data::new(local_id%10))
            .wrap(middleware::Compress::default())
            .wrap(middleware::Logger::new(
                r#"%a "%r" %s %b "%{Content-Length}i" "%{Referer}i" "%{User-Agent}i" %T"#,
            ))
            .wrap(RequestTracing::new())
    })
    .keep_alive(KeepAlive::Timeout(Duration::from_secs(
        CONFIG.limit.keep_alive,
    )))
    .client_request_timeout(Duration::from_secs(CONFIG.limit.request_timeout))
    .bind(haddr)?;

    server
        .workers(CONFIG.limit.http_worker_num)
        .worker_max_blocking_threads(
            CONFIG.limit.http_worker_num * CONFIG.limit.http_worker_max_blocking,
        )
        .run()
        .await?;
    Ok(())
}

/// Setup the tracing related components
pub(crate) fn setup_logs() -> tracing_appender::non_blocking::WorkerGuard {
    use tracing_subscriber::fmt::writer::BoxMakeWriter;

    let (writer, guard) = if CONFIG.log.file_dir.is_empty() {
        let (non_blocking, _guard) = tracing_appender::non_blocking(std::io::stdout());
        (BoxMakeWriter::new(non_blocking), _guard)
    } else {
        let file_name_prefix = if CONFIG.log.file_name_prefix.is_empty() {
            format!("o2.{}.log", CONFIG.common.instance_name.as_str())
        } else {
            CONFIG.log.file_name_prefix.to_string()
        };
        let file_appender =
            tracing_appender::rolling::daily(&CONFIG.log.file_dir, file_name_prefix);
        let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
        (BoxMakeWriter::new(non_blocking), _guard)
    };
    let layer = if CONFIG.log.json_format {
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

fn enable_tracing() -> Result<(), anyhow::Error> {
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    let mut headers = HashMap::new();
    headers.insert(
        CONFIG.common.tracing_header_key.clone(),
        CONFIG.common.tracing_header_value.clone(),
    );
    let tracer = opentelemetry_otlp::new_pipeline()
        .tracing()
        .with_exporter(
            opentelemetry_otlp::new_exporter()
                .http()
                .with_endpoint(&CONFIG.common.otel_otlp_url)
                .with_headers(headers),
        )
        .with_trace_config(sdktrace::config().with_resource(Resource::new(vec![
            KeyValue::new("service.name", CONFIG.common.node_role.as_str()),
            KeyValue::new("service.instance", CONFIG.common.instance_name.as_str()),
            KeyValue::new("service.version", VERSION),
        ])))
        .install_batch(opentelemetry_sdk::runtime::Tokio)?;

    let layer = if CONFIG.log.json_format {
        tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .json()
            .boxed()
    } else {
        tracing_subscriber::fmt::layer().with_ansi(false).boxed()
    };

    Registry::default()
        .with(tracing_subscriber::EnvFilter::new(&CONFIG.log.level))
        .with(layer)
        .with(tracing_opentelemetry::layer().with_tracer(tracer))
        .init();
    Ok(())
}
