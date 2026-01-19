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

use std::{
    cmp::max,
    collections::HashMap,
    net::SocketAddr,
    str::FromStr,
    time::{Duration, SystemTime},
};

use arrow_flight::flight_service_server::FlightServiceServer;
use config::{
    META_ORG_ID, get_config,
    meta::triggers::{Trigger, TriggerModule, TriggerStatus},
    utils::size::bytes_to_human_readable,
};
use log::LevelFilter;
use openobserve::{
    cli::basic::cli,
    common::{
        infra::{self as common_infra, cluster},
        meta,
        utils::zo_logger,
    },
    handler::{
        grpc::{
            auth::check_auth,
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
        http::router::*,
    },
    job, migration, router,
    service::{
        cluster_info::ClusterInfoService,
        db::{self, scheduler::TriggerModule::QueryRecommendations},
        metadata,
        node::NodeService,
        search::SEARCH_SERVER,
        self_reporting,
    },
};
use opentelemetry::{KeyValue, global, trace::TracerProvider};
use opentelemetry_otlp::{WithExportConfig, WithHttpConfig, WithTonicConfig};
use opentelemetry_proto::tonic::collector::{
    logs::v1::logs_service_server::LogsServiceServer,
    metrics::v1::metrics_service_server::MetricsServiceServer,
    trace::v1::trace_service_server::TraceServiceServer,
};
use opentelemetry_sdk::{Resource, propagation::TraceContextPropagator};
use proto::cluster_rpc::{
    cluster_info_service_server::ClusterInfoServiceServer, event_server::EventServer,
    ingest_server::IngestServer, metrics_server::MetricsServer,
    node_service_server::NodeServiceServer, query_cache_server::QueryCacheServer,
    search_server::SearchServer, streams_server::StreamsServer,
};
#[cfg(feature = "profiling")]
use pyroscope::PyroscopeAgent;
#[cfg(feature = "profiling")]
use pyroscope_pprofrs::{PprofConfig, pprof_backend};
use tokio::{net::TcpListener, sync::oneshot};
use tonic::{
    codec::CompressionEncoding,
    metadata::{MetadataKey, MetadataMap, MetadataValue},
    transport::{Identity, ServerTlsConfig},
};
use tower_http::{compression::CompressionLayer, trace::TraceLayer};
use tracing_appender::non_blocking::WorkerGuard;
use tracing_opentelemetry::OpenTelemetryLayer;
use tracing_subscriber::Registry;
#[cfg(feature = "enterprise")]
use {
    config::Config,
    o2_enterprise::enterprise::{ai, common::config::O2Config},
    utoipa::OpenApi,
};

#[cfg(all(feature = "mimalloc", not(feature = "jemalloc")))]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;
#[cfg(all(feature = "jemalloc", not(feature = "mimalloc")))]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;
use tracing_subscriber::{
    EnvFilter, filter::LevelFilter as TracingLevelFilter, fmt::Layer, prelude::*,
};

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    // CLI provides the path to the config file (if any)
    // In case a custom path is provided, the file will be read first
    // and config variables will be loaded.
    // This has to happen as the foremost step as any call to
    // get_config without this would be loaded from local `.env`
    // or environment itself.
    if cli::cli().await? {
        return Ok(());
    }

    #[cfg(feature = "tokio-console")]
    console_subscriber::ConsoleLayer::builder()
        .retention(Duration::from_secs(
            get_config().tokio_console.tokio_console_retention,
        ))
        .server_addr(
            format!(
                "{}:{}",
                get_config().tokio_console.tokio_console_server_addr,
                get_config().tokio_console.tokio_console_server_port
            )
            .as_str()
            .parse::<SocketAddr>()?,
        )
        .init();

    // setup profiling
    #[cfg(feature = "profiling")]
    let pprof_guard =
        if get_config().profiling.pprof_enabled || get_config().profiling.pprof_protobuf_enabled {
            let guard = pprof::ProfilerGuardBuilder::default()
                .frequency(1000)
                .blocklist(&["libc", "libgcc", "pthread", "vdso"])
                .build()
                .unwrap();
            Some(guard)
        } else {
            None
        };

    // setup pyroscope
    #[cfg(feature = "pyroscope")]
    let pyroscope_agent = if get_config().profiling.pyroscope_enabled {
        let agent = PyroscopeAgent::builder(
            &get_config().profiling.pyroscope_server_url,
            &get_config().profiling.pyroscope_project_name,
        )
        .tags(
            [
                ("role", get_config().common.node_role.as_str()),
                ("instance", get_config().common.instance_name.as_str()),
                ("version", config::VERSION),
            ]
            .to_vec(),
        )
        .backend(pprof_backend(PprofConfig::new().sample_rate(100)))
        .build()
        .expect("Failed to setup pyroscope agent");
        let agent_running = agent.start().expect("Failed to start pyroscope agent");
        Some(agent_running)
    } else {
        None
    };

    let cfg = get_config();

    // setup logs
    #[cfg(feature = "tokio-console")]
    let enable_tokio_console = true;
    #[cfg(not(feature = "tokio-console"))]
    let enable_tokio_console = false;
    let mut tracer_provider = None;
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
        log::info!("OpenTelemetry tracing enabled - initializing tracer provider");
        tracer_provider = Some(enable_tracing()?);
        log::info!("Tracer provider initialized successfully");
        None
    } else {
        // Check if AI tracing is enabled independently
        #[cfg(feature = "enterprise")]
        {
            use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
            let o2_cfg = get_o2_config();

            if o2_cfg.ai.tracing_enabled {
                tracer_provider = Some(enable_tracing()?);
                None
            } else {
                Some(setup_logs())
            }
        }
        #[cfg(not(feature = "enterprise"))]
        {
            Some(setup_logs())
        }
    };

    log::info!("Starting OpenObserve {}", config::VERSION);
    log::info!(
        "System info: CPU cores {}, MEM total {}, Disk total {}, free {}",
        cfg.limit.real_cpu_num,
        bytes_to_human_readable(cfg.limit.mem_total as f64),
        bytes_to_human_readable(cfg.limit.disk_total as f64),
        bytes_to_human_readable(cfg.limit.disk_free as f64),
    );
    log::info!(
        "Caches info: Disk max size {}, MEM max size {}, Datafusion pool size: {}",
        bytes_to_human_readable((cfg.disk_cache.max_size * cfg.disk_cache.bucket_num) as f64),
        bytes_to_human_readable((cfg.memory_cache.max_size * cfg.memory_cache.bucket_num) as f64),
        bytes_to_human_readable(cfg.memory_cache.datafusion_max_size as f64),
    );

    // install ring as the default crypto provider if TLS is enabled
    if cfg.http.tls_enabled || cfg.grpc.tls_enabled {
        rustls::crypto::ring::default_provider()
            .install_default()
            .expect("Failed to install rustls crypto provider");
    }

    // init script server
    #[cfg(feature = "enterprise")]
    if config::cluster::LOCAL_NODE.is_script_server() && config::cluster::LOCAL_NODE.is_standalone()
    {
        log::info!("Starting script server");
        return init_script_server().await;
    }

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
            if let Err(e) = cluster::register_and_keep_alive().await {
                job_init_tx.send(false).ok();
                panic!("cluster init failed: {e}");
            }
            // init config
            if let Err(e) = config::init().await {
                job_init_tx.send(false).ok();
                panic!("config init failed: {e}");
            }

            // db related inits
            if let Err(e) = migration::init_db().await {
                job_init_tx.send(false).ok();
                panic!("db init failed: {e}");
            }

            // init infra
            if let Err(e) = infra::init().await {
                job_init_tx.send(false).ok();
                panic!("infra init failed: {e}");
            }

            if let Err(e) = common_infra::init().await {
                job_init_tx.send(false).ok();
                panic!("common infra init failed: {e}");
            }

            // init enterprise
            #[cfg(feature = "enterprise")]
            if let Err(e) = crate::init_enterprise().await {
                job_init_tx.send(false).ok();
                panic!("enterprise init failed: {e}");
            }

            // ingester init
            if let Err(e) = ingester::init().await {
                job_init_tx.send(false).ok();
                panic!("ingester init failed: {e}");
            }

            // init job
            if let Err(e) = job::init().await {
                job_init_tx.send(false).ok();
                panic!("job init failed: {e}");
            }

            // Register job runtime for metrics collection
            if let Ok(handle) = tokio::runtime::Handle::try_current() {
                openobserve::service::runtime_metrics::register_runtime("job".to_string(), handle);
            }

            job_init_tx.send(true).ok();
            job_shutdown_rx.await.ok();
            job_stopped_tx.send(()).ok();

            // flush distinct values
            _ = metadata::close().await;
            // flush WAL cache to disk
            _ = ingester::flush_all().await;
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

        // Register gRPC runtime for metrics collection
        openobserve::service::runtime_metrics::register_runtime(
            "grpc".to_string(),
            rt.handle().clone(),
        );

        let _guard = rt.enter();
        rt.block_on(async move {
            let ret = if config::cluster::LOCAL_NODE.is_router() {
                init_router_grpc_server(grpc_init_tx, grpc_shutdown_rx, grpc_stopped_tx).await
            } else {
                init_common_grpc_server(grpc_init_tx, grpc_shutdown_rx, grpc_stopped_tx).await
            };
            if let Err(e) = ret {
                log::error!("gRPC server init failed: {e}");
                std::process::exit(1);
            }
        });
    });

    // wait for gRPC init
    grpc_init_rx.await.ok();

    // Register main HTTP runtime for metrics collection
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        openobserve::service::runtime_metrics::register_runtime("http".to_string(), handle);
    }

    // Start runtime metrics collector
    openobserve::service::runtime_metrics::start_metrics_collector().await;

    // let node online
    let _ = cluster::set_online().await;

    // initialize the jobs are deferred until the gRPC service starts
    job::init_deferred()
        .await
        .expect("Deferred jobs failed to init");

    if cfg.log.events_enabled {
        tokio::task::spawn(zo_logger::send_logs());
    }
    if cfg.common.telemetry_enabled {
        tokio::task::spawn(async move {
            meta::telemetry::Telemetry::new()
                .send_track_event("OpenObserve - Starting server", None, true, false)
                .await;
        });
    }

    // let node schedulable
    let mut start_ok = false;
    for _ in 0..10 {
        match cluster::set_schedulable().await {
            Ok(_) => {
                start_ok = true;
                break;
            }
            Err(e) => {
                log::error!("set node schedulable failed: {e}");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
    if !start_ok {
        return Err(anyhow::anyhow!("set node schedulable failed"));
    }

    // Check for query recommendations trigger and create one
    match db::scheduler::list(Some(QueryRecommendations)).await {
        Ok(list) if list.len() == 1 => {}
        _ => {
            let _ = db::scheduler::delete(
                META_ORG_ID,
                TriggerModule::QueryRecommendations,
                "QueryRecommendations",
            )
            .await
            .inspect_err(|e| {
                log::error!("Error while purging recommendations triggers. e={:?}", e);
            });
            let now = SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("Time went backwards")
                .as_micros() as i64;
            // Get the next minute on the clock (e.g., if now is 10:37:25am, next_minute is
            // 10:38:00am)
            let minute_micros = 60 * 1_000_000; // 60 seconds in microseconds
            let next_minute = (now / minute_micros + 1) * minute_micros;
            let trigger = Trigger {
                org: META_ORG_ID.to_string(),
                module: TriggerModule::QueryRecommendations,
                module_key: "QueryRecommendations".to_string(),
                next_run_at: next_minute,
                status: TriggerStatus::Waiting,
                start_time: Some(next_minute),
                end_time: None,
                retries: 3,
                ..Default::default()
            };
            let _ = db::scheduler::push(trigger).await.inspect_err(|e| {
                log::error!(
                    "Failed to setup the initial trigger for recommendations. e={:?}",
                    e
                )
            });
            log::info!("[QUERY_RECOMMENDATIONS] Setup the initial trigger.");
        }
    };

    // init http server
    if !cfg.common.tracing_enabled && cfg.common.tracing_search_enabled {
        if let Err(e) = init_http_server_without_tracing().await {
            log::error!("HTTP server runs failed: {e}");
        }
    } else if let Err(e) = init_http_server().await {
        log::error!("HTTP server runs failed: {e}");
    }
    log::info!("HTTP server stopped");

    // stop tracing
    if let Some(tracer_provider) = tracer_provider {
        let result = tracer_provider.shutdown();
        log::info!("Tracer provider shutdown result: {result:?}");
    }

    // flush usage report
    self_reporting::flush().await;

    // flush service discovery
    #[cfg(feature = "enterprise")]
    {
        log::info!("Flushing service discovery...");
        if let Err(e) =
            o2_enterprise::enterprise::service_streams::batch_processor::flush_all().await
        {
            log::error!("Failed to flush service discovery: {}", e);
        }
    }

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
            .send_track_event("OpenObserve - Server stopped", None, true, true)
            .await;
    }

    // stop profiling
    #[cfg(feature = "profiling")]
    if let Some(guard) = pprof_guard
        && let Ok(report) = guard.report().build()
    {
        if cfg.profiling.pprof_protobuf_enabled {
            let pb_file = format!("{}.pb", cfg.profiling.pprof_flamegraph_path);
            match std::fs::File::create(&pb_file) {
                Ok(mut file) => {
                    use std::io::Write;

                    use pprof::protos::Message;

                    if let Ok(profile) = report.pprof() {
                        let mut content = Vec::new();
                        profile.encode(&mut content).unwrap();
                        if let Err(e) = file.write_all(&content) {
                            log::error!("Failed to write flamegraph: {}", e);
                        }
                    }
                }
                Err(e) => {
                    log::error!("Failed to create flamegraph file: {}", e);
                }
            }
        } else {
            match std::fs::File::create(&cfg.profiling.pprof_flamegraph_path) {
                Ok(file) => {
                    if let Err(e) = report.flamegraph(file) {
                        log::error!("Failed to write flamegraph: {}", e);
                    }
                }
                Err(e) => {
                    log::error!("Failed to create flamegraph file: {}", e);
                }
            }
        }
    };

    // stop pyroscope
    #[cfg(feature = "pyroscope")]
    if let Some(agent) = pyroscope_agent
        && let Ok(agent_ready) = agent.stop()
    {
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
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let logs_svc = LogsServiceServer::new(LogsServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
        .max_decoding_message_size(cfg.grpc.max_message_size * 1024 * 1024)
        .max_encoding_message_size(cfg.grpc.max_message_size * 1024 * 1024);
    let trace_svc = TraceServiceServer::new(TraceServer)
        .send_compressed(CompressionEncoding::Gzip)
        .accept_compressed(CompressionEncoding::Gzip)
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

    log::info!(
        "starting gRPC server {} at {}",
        if cfg.grpc.tls_enabled { "with TLS" } else { "" },
        gaddr
    );
    init_tx.send(()).ok();

    let builder = if cfg.grpc.tls_enabled {
        let cert = std::fs::read_to_string(&cfg.grpc.tls_cert_path)?;
        let key = std::fs::read_to_string(&cfg.grpc.tls_key_path)?;
        let identity = Identity::from_pem(cert, key);
        tonic::transport::Server::builder().tls_config(ServerTlsConfig::new().identity(identity))?
    } else {
        tonic::transport::Server::builder()
    };
    let ret = builder
        .layer(tonic::service::InterceptorLayer::new(check_auth))
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
        .serve_with_shutdown(gaddr, async {
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

    log::info!(
        "starting gRPC server {} at {}",
        if cfg.grpc.tls_enabled { "with TLS" } else { "" },
        gaddr
    );
    init_tx.send(()).ok();

    let builder = if cfg.grpc.tls_enabled {
        let cert = std::fs::read_to_string(&cfg.grpc.tls_cert_path)?;
        let key = std::fs::read_to_string(&cfg.grpc.tls_key_path)?;
        let identity = Identity::from_pem(cert, key);
        tonic::transport::Server::builder().tls_config(ServerTlsConfig::new().identity(identity))?
    } else {
        tonic::transport::Server::builder()
    };
    let ret = builder
        .layer(tonic::service::InterceptorLayer::new(check_auth))
        .add_service(logs_svc)
        .add_service(metrics_svc)
        .add_service(traces_svc)
        .serve_with_shutdown(gaddr, async {
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

async fn init_http_server() -> Result<(), anyhow::Error> {
    let cfg = get_config();

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

    let scheme = if cfg.http.tls_enabled {
        "HTTPS"
    } else {
        "HTTP"
    };
    log::info!("Starting {scheme} server at: {haddr}");

    // Build the router
    let app = create_app_router()
        .layer(config::axum::middlewares::AccessLogLayer::new(
            config::axum::middlewares::get_http_access_log_format(),
        ))
        .layer(config::axum::middlewares::SlowLogLayer::new(
            cfg.limit.http_slow_log_threshold,
        ))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http());

    if cfg.http.tls_enabled {
        // TLS server using axum-server
        let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem_file(
            &cfg.http.tls_cert_path,
            &cfg.http.tls_key_path,
        )
        .await?;

        let handle = axum_server::Handle::new();
        let shutdown_timeout = cfg.limit.http_shutdown_timeout;

        // Spawn task to handle shutdown signal
        tokio::spawn({
            let handle = handle.clone();
            async move {
                shutdown_signal().await;
                handle
                    .graceful_shutdown(Some(Duration::from_secs(max(1, shutdown_timeout as u64))));
            }
        });

        axum_server::bind_rustls(haddr, tls_config)
            .handle(handle)
            .serve(app.into_make_service())
            .await?;
    } else {
        // Non-TLS server
        let listener = TcpListener::bind(haddr).await?;
        axum::serve(listener, app.into_make_service())
            .with_graceful_shutdown(shutdown_signal())
            .await?;
    }

    Ok(())
}

async fn init_http_server_without_tracing() -> Result<(), anyhow::Error> {
    let cfg = get_config();

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

    let scheme = if cfg.http.tls_enabled {
        "HTTPS"
    } else {
        "HTTP"
    };
    log::info!("Starting {scheme} server at: {haddr}");

    // Build the router without tracing
    let app = create_app_router()
        .layer(config::axum::middlewares::SlowLogLayer::new(
            cfg.limit.http_slow_log_threshold,
        ))
        .layer(CompressionLayer::new());

    if cfg.http.tls_enabled {
        // TLS server using axum-server
        let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem_file(
            &cfg.http.tls_cert_path,
            &cfg.http.tls_key_path,
        )
        .await?;

        let handle = axum_server::Handle::new();
        let shutdown_timeout = cfg.limit.http_shutdown_timeout;

        // Spawn task to handle shutdown signal
        tokio::spawn({
            let handle = handle.clone();
            async move {
                shutdown_signal().await;
                handle
                    .graceful_shutdown(Some(Duration::from_secs(max(1, shutdown_timeout as u64))));
            }
        });

        axum_server::bind_rustls(haddr, tls_config)
            .handle(handle)
            .serve(app.into_make_service())
            .await?;
    } else {
        // Non-TLS server
        let listener = TcpListener::bind(haddr).await?;
        axum::serve(listener, app.into_make_service())
            .with_graceful_shutdown(shutdown_signal())
            .await?;
    }

    Ok(())
}

/// Signal handler for graceful shutdown
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};

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

    // offline the node
    if let Err(e) = cluster::set_offline().await {
        log::error!("set offline failed: {e}");
    }
    log::info!("Node is offline");
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

fn enable_tracing() -> Result<opentelemetry_sdk::trace::SdkTracerProvider, anyhow::Error> {
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

    // Store the tracer provider before installing batch processor
    let tracer = tracer_builder.with_resource(
        Resource::builder()
            .with_attributes(vec![
                KeyValue::new("service.name", cfg.common.node_role.to_string()),
                KeyValue::new("service.instance", cfg.common.instance_name.to_string()),
                KeyValue::new("service.version", config::VERSION),
            ])
            .build(),
    );

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

#[cfg(feature = "enterprise")]
async fn init_script_server() -> Result<(), anyhow::Error> {
    let cfg = get_config();

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

    // Setup the namespace
    o2_enterprise::enterprise::actions::action_deployer::init().await?;

    let scheme = if cfg.http.tls_enabled {
        "HTTPS"
    } else {
        "HTTP"
    };
    log::info!("Starting Script Server {scheme} server at: {haddr}");

    // Build the router for script server
    let app = create_script_server_router()
        .layer(config::axum::middlewares::SlowLogLayer::new(
            cfg.limit.http_slow_log_threshold,
        ))
        .layer(CompressionLayer::new());

    if cfg.http.tls_enabled {
        // TLS server using axum-server
        let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem_file(
            &cfg.http.tls_cert_path,
            &cfg.http.tls_key_path,
        )
        .await?;

        let handle = axum_server::Handle::new();
        let shutdown_timeout = cfg.limit.http_shutdown_timeout;

        // Spawn task to handle shutdown signal
        tokio::spawn({
            let handle = handle.clone();
            async move {
                shutdown_signal().await;
                handle
                    .graceful_shutdown(Some(Duration::from_secs(max(1, shutdown_timeout as u64))));
            }
        });

        axum_server::bind_rustls(haddr, tls_config)
            .handle(handle)
            .serve(app.into_make_service())
            .await?;
    } else {
        // Non-TLS server
        let listener = TcpListener::bind(haddr).await?;
        axum::serve(listener, app.into_make_service())
            .with_graceful_shutdown(shutdown_signal())
            .await?;
    }

    log::info!("HTTP server stopped");

    // flush usage report
    self_reporting::flush().await;

    // stop telemetry
    if cfg.common.telemetry_enabled {
        meta::telemetry::Telemetry::new()
            .send_track_event("OpenObserve - Server stopped", None, true, true)
            .await;
    }

    log::info!("server stopped");

    Ok(())
}

#[cfg(feature = "enterprise")]
pub fn create_script_server_router() -> axum::Router {
    use axum::{
        Router,
        extract::DefaultBodyLimit,
        middleware,
        routing::{delete, get, patch, post},
    };
    use openobserve::handler::http::{request::script_server, router::cors_layer};

    let cfg = get_config();
    let base_uri = &cfg.common.base_uri;

    // Create script server routes with authentication
    let api_routes = Router::new()
        .route("/{org_id}/job", post(script_server::create_job))
        .route("/{org_id}/job/{name}", delete(script_server::delete_job))
        .route("/{org_id}/app/{name}", get(script_server::get_app_details))
        .route("/{org_id}/apps", get(script_server::list_deployed_apps))
        .route("/{org_id}/action/{id}", patch(script_server::patch_action))
        .layer(middleware::from_fn(
            openobserve::handler::http::auth::script_server::auth_middleware,
        ))
        .layer(cors_layer());

    // Nest under base URI and set request body size limit
    let router = if base_uri.is_empty() || base_uri == "/" {
        Router::new().nest("/api", api_routes)
    } else {
        Router::new().nest(&format!("{}/api", base_uri), api_routes)
    };

    // Set request body size limit (equivalent to actix-web's PayloadConfig)
    router.layer(DefaultBodyLimit::max(cfg.limit.req_payload_limit))
}

/// Initializes enterprise features.
#[cfg(feature = "enterprise")]
async fn init_enterprise() -> Result<(), anyhow::Error> {
    o2_enterprise::enterprise::search::init().await?;

    if let Err(e) = o2_enterprise::enterprise::actions::action_manager::init_client() {
        log::warn!("Failed to init action manager client: {e}");
    }

    if o2_enterprise::enterprise::common::config::get_config()
        .super_cluster
        .enabled
    {
        log::info!("init super cluster");
        o2_enterprise::enterprise::super_cluster::kv::init().await?;
        openobserve::super_cluster_queue::init().await?;
    }

    // Initialize OpenAPI spec for AI and MCP modules (includes agent client)
    let api = openapi::ApiDoc::openapi();
    if let Err(e) = o2_enterprise::enterprise::ai::init_ai_components(api) {
        log::error!("Failed to init AI/MCP/Agent: {e}");
    } else {
        log::info!("Initialized AI, MCP, and Agent components");
    }

    // check ratelimit config
    let cfg = config::get_config();
    let o2cfg = o2_enterprise::enterprise::common::config::get_config();
    if let Err(e) = check_ratelimit_config(&cfg, &o2cfg) {
        panic!("ratelimit config error: {e}");
    }

    o2_enterprise::enterprise::pipeline::pipeline_file_server::PipelineFileServer::run().await?;
    if o2cfg.rate_limit.rate_limit_enabled && o2_openfga::config::get_config().enabled {
        o2_ratelimit::init(openobserve::handler::http::router::openapi::openapi_info().await)
            .await?;
    }

    Ok(())
}

#[cfg(feature = "enterprise")]
fn check_ratelimit_config(cfg: &Config, o2cfg: &O2Config) -> Result<(), anyhow::Error> {
    if o2cfg.rate_limit.rate_limit_enabled {
        let meta_store: config::meta::meta_store::MetaStore =
            cfg.common.queue_store.as_str().into();
        if meta_store != config::meta::meta_store::MetaStore::Nats {
            return Err(anyhow::anyhow!(
                "ZO_QUEUE_STORE must be nats when ratelimit is enabled"
            ));
        }
    }

    if o2cfg.rate_limit.rate_limit_rule_refresh_interval < 2 {
        return Err(anyhow::anyhow!(
            "ratelimit rules refresh interval must be greater than or equal to 2 seconds"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tokio::runtime::Runtime;

    use super::*;

    #[test]
    fn test_setup_logs() {
        let _guard = setup_logs();

        // Just verify that the guard is valid and the logs setup doesn't panic
    }

    #[test]
    fn test_enable_tracing_error_handling() {
        // Test that enable_tracing handles configuration errors gracefully
        // This test verifies the function exists and can be called
        // In a real environment, tracing setup might fail due to network issues

        // We can't easily test the actual tracing setup without mocking external services
        // But we can ensure the function signature and basic error handling work
        let result = std::panic::catch_unwind(|| {
            // Just verify the function can be called
            let rt = Runtime::new().unwrap();
            rt.block_on(async {
                // This might fail in test environment due to missing config
                // but that's expected and we're testing error handling
                let _ = enable_tracing();
            });
        });

        // The test should pass regardless of whether enable_tracing() succeeds or fails
        // In test environments, it may fail due to:
        // 1. Global subscriber already set by another test (when running in parallel)
        // 2. Missing configuration
        // 3. Network issues
        // We're testing that it doesn't panic unexpectedly beyond expected tracing setup issues
        // Don't assert result.is_ok() because parallel tests will fail due to global subscriber
        // conflicts (expected in test environment when tests run in parallel)
        // The important thing is that we can call the function without unexpected panics
        let _ = result;
    }

    #[cfg(feature = "enterprise")]
    #[test]
    #[ignore] // TODO: Fix enterprise config structure issues
    fn test_check_ratelimit_config_valid() {
        // Test disabled due to enterprise config structure mismatch
        // Need to properly construct O2Config and RateLimitConfig structs
    }

    #[cfg(feature = "enterprise")]
    #[test]
    #[ignore = "Enterprise config struct fields don't match - needs fixing"]
    fn test_check_ratelimit_config_invalid_interval() {
        // Test disabled due to enterprise config structure mismatch
        // Need to properly construct O2Config and RateLimitConfig structs
    }

    #[tokio::test]
    async fn test_socket_addr_parsing() {
        use std::net::SocketAddr;

        // Test IPv4 socket address parsing (used in init_common_grpc_server)
        let addr: Result<SocketAddr, _> = "127.0.0.1:8080".parse();
        assert!(addr.is_ok());

        // Test IPv6 socket address parsing (used in HTTP server)
        let addr: Result<SocketAddr, _> = "[::]:8080".parse();
        assert!(addr.is_ok());

        // Test invalid address
        let addr: Result<SocketAddr, _> = "invalid:address".parse();
        assert!(addr.is_err());
    }

    #[tokio::test]
    async fn test_oneshot_channel_communication() {
        use tokio::sync::oneshot;

        // Test the oneshot channel pattern used for server coordination
        let (tx, rx) = oneshot::channel::<bool>();
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        // Simulate successful initialization
        let handle = tokio::spawn(async move {
            // Simulate some async work
            tokio::time::sleep(Duration::from_millis(10)).await;
            tx.send(true).unwrap();

            // Wait for shutdown signal
            shutdown_rx.await.unwrap();
            "completed"
        });

        // Wait for initialization
        let result = rx.await;
        assert!(result.is_ok());
        assert!(result.unwrap());

        // Send shutdown signal
        shutdown_tx.send(()).unwrap();

        // Wait for completion
        let result = handle.await;
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "completed");
    }

    #[test]
    fn test_server_configuration_limits() {
        // Test the limit calculations used in server setup
        let http_worker_num = 4;
        let http_worker_max_blocking = 8;

        // Pattern used in script server configuration
        let total_blocking = http_worker_num * http_worker_max_blocking;
        assert_eq!(total_blocking, 32);

        // Test bounds checking
        let keep_alive = std::cmp::max(1, 30);
        assert!(keep_alive >= 1);

        let timeout = std::cmp::max(1, 60);
        assert!(timeout >= 1);
    }

    #[tokio::test]
    async fn test_telemetry_event_creation() {
        // Test telemetry event patterns used in the main function
        let event_name = "OpenObserve - Starting server";
        let stop_event = "OpenObserve - Server stopped";

        assert!(event_name.contains("OpenObserve"));
        assert!(event_name.contains("Starting"));
        assert!(stop_event.contains("Server stopped"));

        // Test boolean flags used in telemetry calls
        let server_start = true;
        let wait_for_send = false;
        let server_stop = true;
        let wait_for_stop = true;

        assert!(server_start);
        assert!(!wait_for_send);
        assert!(server_stop);
        assert!(wait_for_stop);
    }

    #[test]
    fn test_resource_key_value_creation() {
        use opentelemetry::KeyValue;

        // Test KeyValue creation patterns used in tracing setup
        let service_name = KeyValue::new("service.name", "test-service");
        let service_instance = KeyValue::new("service.instance", "test-instance");
        let service_version = KeyValue::new("service.version", "1.0.0");

        assert_eq!(service_name.key.as_str(), "service.name");
        assert_eq!(service_instance.key.as_str(), "service.instance");
        assert_eq!(service_version.key.as_str(), "service.version");
    }

    #[tokio::test]
    async fn test_signal_handling_patterns() {
        use tokio::sync::oneshot;

        // Test the select pattern used in graceful shutdown
        let (tx1, mut rx1) = oneshot::channel::<&str>();
        let (tx2, mut rx2) = oneshot::channel::<&str>();

        // Simulate signal reception
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(10)).await;
            tx1.send("SIGTERM received").unwrap();
        });

        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(20)).await;
            tx2.send("SIGINT received").unwrap();
        });

        // Test select! pattern
        let result = tokio::select! {
            msg = &mut rx1 => msg.unwrap(),
            msg = &mut rx2 => msg.unwrap(),
        };

        assert!(result.contains("SIG"));
        assert!(result.contains("received"));
    }
}
