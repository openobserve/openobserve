// Copyright 2024 Zinc Labs Inc.
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

use std::{cmp::max, collections::HashMap, net::SocketAddr, str::FromStr, time::Duration};

use actix_web::{dev::ServerHandle, http::KeepAlive, middleware, web, App, HttpServer};
use actix_web_opentelemetry::RequestTracing;
use config::get_config;
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
            request::{
                event::Eventer,
                file_list::Filelister,
                ingest::Ingester,
                logs::LogsServer,
                metrics::{ingester::MetricsIngester, querier::MetricsQuerier},
                query_cache::QueryCacheServerImpl,
                traces::TraceServer,
                usage::UsageServerImpl,
            },
        },
        http::router::*,
    },
    job, router,
    service::{db, metadata, search::SEARCH_SERVER, usage},
};
use opentelemetry::KeyValue;
use opentelemetry_otlp::WithExportConfig;
use opentelemetry_proto::tonic::collector::{
    logs::v1::logs_service_server::LogsServiceServer,
    metrics::v1::metrics_service_server::MetricsServiceServer,
    trace::v1::trace_service_server::TraceServiceServer,
};
use opentelemetry_sdk::{propagation::TraceContextPropagator, trace as sdktrace, Resource};
use proto::cluster_rpc::{
    event_server::EventServer, filelist_server::FilelistServer, ingest_server::IngestServer,
    metrics_server::MetricsServer, query_cache_server::QueryCacheServer,
    search_server::SearchServer, usage_server::UsageServer,
};
#[cfg(feature = "profiling")]
use pyroscope::PyroscopeAgent;
#[cfg(feature = "profiling")]
use pyroscope_pprofrs::{pprof_backend, PprofConfig};
use tokio::sync::oneshot;
use tonic::{
    codec::CompressionEncoding,
    metadata::{MetadataKey, MetadataMap, MetadataValue},
};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::Registry;

#[cfg(feature = "mimalloc")]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[cfg(feature = "jemalloc")]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

use tracing_subscriber::{
    filter::LevelFilter as TracingLevelFilter, fmt::Layer, prelude::*, EnvFilter,
};

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    #[cfg(feature = "tokio-console")]
    console_subscriber::ConsoleLayer::builder()
        .retention(Duration::from_secs(
            cfg.tokio_console.tokio_console_retention,
        ))
        .server_addr(
            format!(
                "{}:{}",
                cfg.tokio_console.tokio_console_server_addr,
                cfg.tokio_console.tokio_console_server_port
            )
            .as_str()
            .parse::<SocketAddr>()?,
        )
        .init();

    // setup profiling
    #[cfg(feature = "profiling")]
    let agent = if !cfg.profiling.enabled {
        None
    } else {
        let agent = PyroscopeAgent::builder(&cfg.profiling.server_url, &cfg.profiling.project_name)
            .tags(
                [
                    ("role", cfg.common.node_role.as_str()),
                    ("instance", cfg.common.instance_name.as_str()),
                    ("version", VERSION),
                ]
                .to_vec(),
            )
            .backend(pprof_backend(PprofConfig::new().sample_rate(100)))
            .build()
            .expect("Failed to setup pyroscope agent");
        #[cfg(feature = "profiling")]
        let agent_running = agent.start().expect("Failed to start pyroscope agent");
        Some(agent_running)
    };

    // cli mode
    if cli::cli().await? {
        return Ok(());
    }

    // setup logs
    #[cfg(feature = "tokio-console")]
    let enable_tokio_console = true;
    #[cfg(not(feature = "tokio-console"))]
    let enable_tokio_console = false;
    let _guard: Option<WorkerGuard> = if enable_tokio_console {
        None
    } else if cfg.log.events_enabled {
        let logger = zo_logger::ZoLogger {
            sender: zo_logger::EVENT_SENDER.clone(),
        };
        log::set_boxed_logger(Box::new(logger)).map(|()| {
            log::set_max_level(LevelFilter::from_str(&cfg.log.level).unwrap_or(LevelFilter::Info))
        })?;
        None
    } else if cfg.common.tracing_enabled || cfg.common.tracing_search_enabled {
        enable_tracing()?;
        None
    } else {
        Some(setup_logs())
    };

    log::info!("Starting OpenObserve {}", VERSION);
    log::info!(
        "System info: CPU cores {}, MEM total {} MB, Disk total {} GB, free {} GB",
        cfg.limit.real_cpu_num,
        cfg.limit.mem_total / 1024 / 1024,
        cfg.limit.disk_total / 1024 / 1024 / 1024,
        cfg.limit.disk_free / 1024 / 1024 / 1024,
    );

    // init backend jobs
    let (job_init_tx, job_init_rx) = oneshot::channel();
    let (job_shutudown_tx, job_shutdown_rx) = oneshot::channel();
    let (job_stopped_tx, job_stopped_rx) = oneshot::channel();
    let job_rt_handle = std::thread::spawn(move || {
        let cfg = get_config();
        let Ok(rt) = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(cfg.limit.job_runtime_worker_num)
            .enable_all()
            .thread_name("job_runtime")
            .max_blocking_threads(cfg.limit.job_runtime_blocking_worker_num)
            .build()
        else {
            job_init_tx.send(false).ok();
            panic!("job runtime init failed")
        };
        let _guard = rt.enter();
        rt.block_on(async move {
            // it must be initialized before the server starts
            if let Err(e) = cluster::register_and_keepalive().await {
                job_init_tx.send(false).ok();
                panic!("cluster init failed: {}", e);
            }
            // init config
            if let Err(e) = config::init().await {
                job_init_tx.send(false).ok();
                panic!("config init failed: {}", e);
            }
            // init infra
            if let Err(e) = infra::init().await {
                job_init_tx.send(false).ok();
                panic!("infra init failed: {}", e);
            }
            if let Err(e) = common_infra::init().await {
                job_init_tx.send(false).ok();
                panic!("common infra init failed: {}", e);
            }

            // init enterprise
            #[cfg(feature = "enterprise")]
            if let Err(e) = o2_enterprise::enterprise::init().await {
                job_init_tx.send(false).ok();
                panic!("enerprise init failed: {}", e);
            }

            // check version upgrade
            let old_version = db::version::get().await.unwrap_or("v0.0.0".to_string());
            if let Err(e) = migration::check_upgrade(&old_version, VERSION).await {
                job_init_tx.send(false).ok();
                panic!("check upgrade failed: {}", e);
            }
            // migrate dashboards
            if let Err(e) = migration::dashboards::run().await {
                job_init_tx.send(false).ok();
                panic!("migrate dashboards failed: {}", e);
            }

            migration::upgrade_resource_names()
                .await
                .expect("migrate resource names into supported ofga format failed");

            // ingester init
            if let Err(e) = ingester::init().await {
                job_init_tx.send(false).ok();
                panic!("ingester init failed: {}", e);
            }

            // init job
            if let Err(e) = job::init().await {
                job_init_tx.send(false).ok();
                panic!("job init failed: {}", e);
            }

            // init meter provider
            let Ok(meter_provider) = job::metrics::init_meter_provider().await else {
                job_init_tx.send(false).ok();
                panic!("meter provider init failed");
            };

            job_init_tx.send(true).ok();
            job_shutdown_rx.await.ok();
            job_stopped_tx.send(()).ok();

            // shutdown meter provider
            let _ = meter_provider.shutdown();

            // flush distinct values
            _ = metadata::close().await;
            // flush WAL cache to disk
            common_infra::wal::flush_all_to_disk().await;
            // flush compact offset cache to disk disk
            _ = db::compact::files::sync_cache_to_db().await;
            // flush db
            let db = infra::db::get_db().await;
            _ = db.close().await;
        });
    });

    // wait for job init
    match job_init_rx.await {
        Ok(true) => log::info!("backend job init success"),
        Ok(false) => {
            return Err(anyhow::anyhow!("backend job init failed, exiting"));
        }
        Err(e) => {
            return Err(anyhow::anyhow!("backend job init failed: {}", e));
        }
    }

    // init gRPC server
    let (grpc_init_tx, grpc_init_rx) = oneshot::channel();
    let (grpc_shutudown_tx, grpc_shutdown_rx) = oneshot::channel();
    let (grpc_stopped_tx, grpc_stopped_rx) = oneshot::channel();
    let grpc_rt_handle = std::thread::spawn(move || {
        let cfg = get_config();
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(cfg.limit.grpc_runtime_worker_num)
            .enable_all()
            .thread_name("grpc_runtime")
            .max_blocking_threads(cfg.limit.grpc_runtime_blocking_worker_num)
            .build()
            .expect("grpc runtime init failed");
        let _guard = rt.enter();
        rt.block_on(async move {
            if config::cluster::LOCAL_NODE.is_router() {
                init_router_grpc_server(grpc_init_tx, grpc_shutdown_rx, grpc_stopped_tx)
                    .await
                    .expect("router gRPC server init failed");
            } else {
                init_common_grpc_server(grpc_init_tx, grpc_shutdown_rx, grpc_stopped_tx)
                    .await
                    .expect("router gRPC server init failed");
            }
        });
    });

    // wait for gRPC init
    grpc_init_rx.await.ok();

    // let node online
    let _ = cluster::set_online(false).await;

    // This is specifically for enrichment tables, as caching is happening using
    // search service
    db::schema::cache_enrichment_tables()
        .await
        .expect("EnrichmentTables cache failed");

    if cfg.log.events_enabled {
        tokio::task::spawn(async move { zo_logger::send_logs().await });
    }
    if cfg.common.telemetry_enabled {
        tokio::task::spawn(async move {
            meta::telemetry::Telemetry::new()
                .event("OpenObserve - Starting server", None, false)
                .await;
        });
    }

    // init http server
    if !cfg.common.tracing_enabled && cfg.common.tracing_search_enabled {
        if let Err(e) = init_http_server_without_tracing().await {
            log::error!("HTTP server runs failed: {}", e);
        }
    } else if let Err(e) = init_http_server().await {
        log::error!("HTTP server runs failed: {}", e);
    }
    log::info!("HTTP server stopped");

    // flush useage report
    usage::flush().await;

    // leave the cluster
    _ = cluster::leave().await;
    log::info!("Node left cluster");

    // stop gRPC server
    grpc_shutudown_tx.send(()).ok();
    grpc_stopped_rx.await.ok();
    grpc_rt_handle.join().ok();
    log::info!("gRPC server stopped");

    // stop backend jobs
    job_shutudown_tx.send(()).ok();
    job_stopped_rx.await.ok();
    job_rt_handle.join().ok();
    log::info!("backend job stopped");

    // stop telemetry
    if cfg.common.telemetry_enabled {
        meta::telemetry::Telemetry::new()
            .event("OpenObserve - Server stopped", None, false)
            .await;
    }

    #[cfg(feature = "profiling")]
    if let Some(agent) = agent {
        let agent_ready = agent.stop().unwrap();
        agent_ready.shutdown();
    }

    log::info!("server stopped");

    Ok(())
}

async fn init_common_grpc_server(
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
        .accept_compressed(CompressionEncoding::Gzip);
    let search_svc = SearchServer::new(SEARCH_SERVER.clone())
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let filelist_svc = FilelistServer::new(Filelister)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let metrics_svc = MetricsServer::new(MetricsQuerier)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let metrics_ingest_svc = MetricsServiceServer::new(MetricsIngester)
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
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let query_cache_svc = QueryCacheServer::new(QueryCacheServerImpl)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);
    let ingest_svc = IngestServer::new(Ingester)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip);

    log::info!("starting gRPC server at {}", gaddr);
    init_tx.send(()).ok();
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
        .add_service(query_cache_svc)
        .add_service(ingest_svc)
        .serve_with_shutdown(gaddr, async {
            shutdown_rx.await.ok();
            log::info!("gRPC server starts shutting down");
        })
        .await
        .expect("gRPC server init failed");
    stopped_tx.send(()).ok();
    Ok(())
}

async fn init_router_grpc_server(
    init_tx: oneshot::Sender<()>,
    shutdown_rx: oneshot::Receiver<()>,
    stopped_tx: oneshot::Sender<()>,
) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let gaddr: SocketAddr = format!("0.0.0.0:{}", cfg.grpc.port).parse()?;
    let logs_svc = LogsServiceServer::new(router::grpc::ingest::logs::LogsServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let metrics_svc = MetricsServiceServer::new(router::grpc::ingest::metrics::MetricsServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let traces_svc = TraceServiceServer::new(router::grpc::ingest::traces::TraceServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);

    log::info!("starting gRPC server at {}", gaddr);
    init_tx.send(()).ok();
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
    Ok(())
}

async fn init_http_server() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    // metrics
    let prometheus = config::metrics::create_prometheus_handler();

    let haddr: SocketAddr = if cfg.http.ipv6_enabled {
        format!("[::]:{}", cfg.http.port).parse()?
    } else {
        let ip = if !cfg.http.addr.is_empty() {
            cfg.http.addr.clone()
        } else {
            "0.0.0.0".to_string()
        };
        format!("{}:{}", ip, cfg.http.port).parse()?
    };

    let server = HttpServer::new(move || {
        let cfg = get_config();
        log::info!("starting HTTP server at: {}", haddr);
        let mut app = App::new().wrap(prometheus.clone());
        if config::cluster::LOCAL_NODE.is_router() {
            let client = awc::Client::builder()
                .connector(awc::Connector::new().limit(cfg.route.max_connections))
                .timeout(Duration::from_secs(cfg.route.timeout))
                .disable_redirects()
                .finish();
            app = app
                .service(
                    // if `cfg.common.base_uri` is empty, scope("") still works as expected.
                    web::scope(&cfg.common.base_uri)
                        .service(router::http::config)
                        .service(router::http::config_paths)
                        .service(router::http::api)
                        .service(router::http::aws)
                        .service(router::http::gcp)
                        .service(router::http::rum)
                        .configure(get_basic_routes)
                        .configure(get_proxy_routes),
                )
                .app_data(web::Data::new(client))
        } else {
            app = app.service(
                web::scope(&cfg.common.base_uri)
                    .configure(get_config_routes)
                    .configure(get_service_routes)
                    .configure(get_other_service_routes)
                    .configure(get_basic_routes)
                    .configure(get_proxy_routes),
            )
        }
        app.app_data(web::JsonConfig::default().limit(cfg.limit.req_json_limit))
            .app_data(web::PayloadConfig::new(cfg.limit.req_payload_limit)) // size is in bytes
            .wrap(middleware::Compress::default())
            .wrap(middleware::Logger::new(
                r#"%a "%r" %s %b "%{Content-Length}i" "%{Referer}i" "%{User-Agent}i" %T"#,
            ))
            .wrap(RequestTracing::new())
    })
    .keep_alive(KeepAlive::Timeout(Duration::from_secs(max(
        15,
        cfg.limit.keep_alive,
    ))))
    .client_request_timeout(Duration::from_secs(max(5, cfg.limit.request_timeout)))
    .shutdown_timeout(max(1, cfg.limit.http_shutdown_timeout))
    .bind(haddr)?;

    let server = server
        .workers(cfg.limit.http_worker_num)
        .worker_max_blocking_threads(cfg.limit.http_worker_num * cfg.limit.http_worker_max_blocking)
        .disable_signals()
        .run();
    let handle = server.handle();
    tokio::task::spawn(async move {
        graceful_shutdown(handle).await;
    });
    server.await?;
    Ok(())
}

async fn init_http_server_without_tracing() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    // metrics
    let prometheus = config::metrics::create_prometheus_handler();

    let haddr: SocketAddr = if cfg.http.ipv6_enabled {
        format!("[::]:{}", cfg.http.port).parse()?
    } else {
        let ip = if !cfg.http.addr.is_empty() {
            cfg.http.addr.clone()
        } else {
            "0.0.0.0".to_string()
        };
        format!("{}:{}", ip, cfg.http.port).parse()?
    };

    let server = HttpServer::new(move || {
        let cfg = get_config();
        log::info!("starting HTTP server at: {}", haddr);
        let mut app = App::new().wrap(prometheus.clone());
        if config::cluster::LOCAL_NODE.is_router() {
            let client = awc::Client::builder()
                .connector(awc::Connector::new().limit(cfg.route.max_connections))
                .timeout(Duration::from_secs(cfg.route.timeout))
                .disable_redirects()
                .finish();
            app = app
                .service(
                    // if `cfg.common.base_uri` is empty, scope("") still works as expected.
                    web::scope(&cfg.common.base_uri)
                        .service(router::http::config)
                        .service(router::http::config_paths)
                        .service(router::http::api)
                        .service(router::http::aws)
                        .service(router::http::gcp)
                        .service(router::http::rum)
                        .configure(get_basic_routes)
                        .configure(get_proxy_routes),
                )
                .app_data(web::Data::new(client))
        } else {
            app = app.service(
                web::scope(&cfg.common.base_uri)
                    .configure(get_config_routes)
                    .configure(get_service_routes)
                    .configure(get_other_service_routes)
                    .configure(get_basic_routes)
                    .configure(get_proxy_routes),
            )
        }
        app.app_data(web::JsonConfig::default().limit(cfg.limit.req_json_limit))
            .app_data(web::PayloadConfig::new(cfg.limit.req_payload_limit)) // size is in bytes
            .wrap(middleware::Compress::default())
            .wrap(middleware::Logger::new(
                r#"%a "%r" %s %b "%{Content-Length}i" "%{Referer}i" "%{User-Agent}i" %T"#,
            ))
    })
    .keep_alive(KeepAlive::Timeout(Duration::from_secs(max(
        15,
        cfg.limit.keep_alive,
    ))))
    .client_request_timeout(Duration::from_secs(max(5, cfg.limit.request_timeout)))
    .shutdown_timeout(max(1, cfg.limit.http_shutdown_timeout))
    .bind(haddr)?;

    let server = server
        .workers(cfg.limit.http_worker_num)
        .worker_max_blocking_threads(cfg.limit.http_worker_num * cfg.limit.http_worker_max_blocking)
        .disable_signals()
        .run();
    let handle = server.handle();
    tokio::task::spawn(async move {
        graceful_shutdown(handle).await;
    });
    server.await?;
    Ok(())
}

async fn graceful_shutdown(handle: ServerHandle) {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};

        let mut sigquit = signal(SignalKind::quit()).unwrap();
        let mut sigterm = signal(SignalKind::terminate()).unwrap();
        let mut sigint = signal(SignalKind::interrupt()).unwrap();

        tokio::select! {
            _ = sigquit.recv() =>  log::info!("SIGQUIT received"),
            _ = sigterm.recv() =>  log::info!("SIGTERM received"),
            _ = sigint.recv() =>   log::info!("SIGINT received"),
        }
    }

    #[cfg(not(unix))]
    {
        use tokio::signal::windows::*;

        let mut sigbreak = ctrl_break().unwrap();
        let mut sigint = ctrl_c().unwrap();
        let mut sigquit = ctrl_close().unwrap();
        let mut sigterm = ctrl_shutdown().unwrap();

        tokio::select! {
            _ = sigbreak.recv() =>  log::info!("ctrl-break received"),
            _ = sigquit.recv() =>  log::info!("ctrl-c received"),
            _ = sigterm.recv() =>  log::info!("ctrl-close received"),
            _ = sigint.recv() =>   log::info!("ctrl-shutdown received"),
        }
    }
    // tokio::signal::ctrl_c().await.unwrap();
    // println!("ctrl-c received!");

    // offline the node
    if let Err(e) = cluster::set_offline(true).await {
        log::error!("set offline failed: {}", e);
    }
    log::info!("Node is offline");

    handle.stop(true).await;
}

/// Setup the tracing related components
pub(crate) fn setup_logs() -> tracing_appender::non_blocking::WorkerGuard {
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

fn enable_tracing() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    opentelemetry::global::set_text_map_propagator(TraceContextPropagator::new());
    let tracer = opentelemetry_otlp::new_pipeline().tracing();
    let tracer = if cfg.common.otel_otlp_grpc_url.is_empty() {
        tracer.with_exporter({
            let mut headers = HashMap::new();
            headers.insert(
                cfg.common.tracing_header_key.clone(),
                cfg.common.tracing_header_value.clone(),
            );
            opentelemetry_otlp::new_exporter()
                .http()
                .with_http_client(
                    reqwest::Client::builder()
                        .danger_accept_invalid_certs(true)
                        .build()?,
                )
                .with_endpoint(&cfg.common.otel_otlp_url)
                .with_headers(headers)
        })
    } else {
        tracer.with_exporter({
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
                MetadataValue::from_str(&cfg.common.tracing_grpc_header_stream_name).unwrap(),
            );
            opentelemetry_otlp::new_exporter()
                .tonic()
                .with_endpoint(&cfg.common.otel_otlp_grpc_url)
                .with_metadata(metadata)
                .with_protocol(opentelemetry_otlp::Protocol::Grpc)
        })
    };
    let tracer = tracer
        .with_trace_config(sdktrace::config().with_resource(Resource::new(vec![
            KeyValue::new("service.name", cfg.common.node_role.to_string()),
            KeyValue::new("service.instance", cfg.common.instance_name.to_string()),
            KeyValue::new("service.version", VERSION),
        ])))
        .install_batch(opentelemetry_sdk::runtime::Tokio)?;

    let layer = if cfg.log.json_format {
        tracing_subscriber::fmt::layer()
            .with_ansi(false)
            .json()
            .boxed()
    } else {
        tracing_subscriber::fmt::layer().with_ansi(false).boxed()
    };

    Registry::default()
        .with(tracing_subscriber::EnvFilter::new(&cfg.log.level))
        .with(layer)
        .with(tracing_opentelemetry::layer().with_tracer(tracer))
        .init();
    Ok(())
}
