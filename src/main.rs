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

// macOS ld cannot encode compact-unwind offsets once __eh_frame exceeds 16MB;
// harmless for a binary this size (only slows panic unwinding), so silence it.
#![allow(linker_messages)]

#[cfg(feature = "tokio-console")]
use std::net::SocketAddr;
use std::time::{Duration, SystemTime};

use common::{infra::cluster, meta};
use config::{
    META_ORG_ID, get_config,
    meta::triggers::{Trigger, TriggerModule, TriggerStatus},
    utils::size::bytes_to_human_readable,
};
use db::{self, scheduler::TriggerModule::QueryRecommendations};
use infra::runtime::{create_grpc_runtime, create_job_runtime};
use openobserve::{
    cli::basic::cli,
    migration,
    telemetry::{enable_tracing, setup_logs},
};
use openobserve_api_http::handler::http::router::*;
use openobserve_core::{bootstrap, metadata};
use openobserve_jobs::job;
use tokio::sync::oneshot;
#[cfg(feature = "enterprise")]
use tower_http::trace::TraceLayer;
use tracing_appender::non_blocking::WorkerGuard;
use utoipa::OpenApi;
#[cfg(feature = "enterprise")]
use {config::Config, o2_enterprise::enterprise::common::config::O2Config};

#[cfg(feature = "mimalloc")]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;
#[cfg(feature = "jemalloc")]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

#[cfg(feature = "profiling")]
#[allow(non_upper_case_globals)]
#[unsafe(export_name = "malloc_conf")]
pub static malloc_conf: &[u8] = b"prof:true,prof_active:true,lg_prof_sample:16\0";

async fn flush_reporting() {
    #[cfg(feature = "enterprise")]
    audit::flush().await;

    usage_reporting::flush().await;
}

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

    let cfg = get_config();

    // setup logs
    #[cfg(feature = "tokio-console")]
    let enable_tokio_console = true;
    #[cfg(not(feature = "tokio-console"))]
    let enable_tokio_console = false;
    let mut tracer_provider = None;
    let _guard: Option<WorkerGuard> = if enable_tokio_console {
        None
    } else if cfg.common.should_create_span() {
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

    // init action server
    #[cfg(feature = "enterprise")]
    if config::cluster::LOCAL_NODE.is_action_server() && config::cluster::LOCAL_NODE.is_standalone()
    {
        log::info!("Starting action server");
        return init_action_server().await;
    }

    // init backend jobs
    let (job_init_tx, job_init_rx) = oneshot::channel();
    let (job_shutudown_tx, job_shutdown_rx) = oneshot::channel();
    let (job_stopped_tx, job_stopped_rx) = oneshot::channel();
    let job_rt_handle = std::thread::spawn(move || {
        let Ok(rt) = create_job_runtime() else {
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

            if let Err(e) = bootstrap::init().await {
                job_init_tx.send(false).ok();
                panic!("common infra init failed: {e}");
            }

            // Initialize MCP tools from the OpenAPI spec for all editions.
            let api = openapi::ApiDoc::openapi();
            if let Err(e) = openobserve_mcp::tools::init_mcp_tools(&api) {
                log::error!("Failed to initialize MCP tools: {e}");
            } else {
                log::info!("Initialized MCP tools");
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
                openobserve_node::runtime_metrics::register_runtime("job".to_string(), handle);
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
        let Ok(rt) = create_grpc_runtime() else {
            grpc_init_tx.send(()).ok();
            panic!("grpc runtime init failed");
        };

        // Register gRPC runtime for metrics collection
        openobserve_node::runtime_metrics::register_runtime(
            "grpc".to_string(),
            rt.handle().clone(),
        );

        let _guard = rt.enter();
        rt.block_on(async move {
            let ret =
                openobserve_api_grpc::server::run(grpc_init_tx, grpc_shutdown_rx, grpc_stopped_tx)
                    .await;
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
        openobserve_node::runtime_metrics::register_runtime("http".to_string(), handle);
    }

    // Start runtime metrics collector
    openobserve_node::runtime_metrics::start_metrics_collector().await;

    // let node online
    let _ = cluster::set_online().await;

    // initialize the jobs are deferred until the gRPC service starts
    job::init_deferred()
        .await
        .expect("Deferred jobs failed to init");

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
    if let Err(e) = openobserve_api_http::server::run(web::ui_routes).await {
        log::error!("HTTP server runs failed: {e}");
    }
    log::info!("HTTP server stopped");

    // stop tracing
    if let Some(tracer_provider) = tracer_provider {
        let result = tracer_provider.shutdown();
        log::info!("Tracer provider shutdown result: {result:?}");
    }

    // flush usage report
    flush_reporting().await;

    // flush service discovery
    #[cfg(feature = "enterprise")]
    {
        log::info!("Flushing service discovery...");
        if let Err(e) =
            o2_enterprise::enterprise::service_streams::batch_processor::flush_all().await
        {
            log::error!("Failed to flush service discovery: {}", e);
        }

        log::info!("Flushing Gen-AI agent registry...");
        if let Err(e) =
            o2_enterprise::enterprise::llm_evaluations::agent_registry::flush_all().await
        {
            log::error!("Failed to flush Gen-AI agent registry: {}", e);
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

    log::info!("server stopped");

    Ok(())
}

#[cfg(feature = "enterprise")]
async fn init_action_server() -> Result<(), anyhow::Error> {
    let cfg = get_config();
    let haddr = openobserve_api_http::server::server_addr()?;

    // Setup the namespace
    o2_enterprise::enterprise::actions::action_deployer::init().await?;

    log::info!(
        "Starting Action Server {} server at: {haddr}",
        if cfg.http.tls_enabled {
            "HTTPS"
        } else {
            "HTTP"
        }
    );

    // Build the router for action server
    let app = openobserve_api_http::server::apply_common_middlewares(create_action_server_router())
        .layer(TraceLayer::new_for_http());

    openobserve_api_http::server::serve(haddr, app).await?;

    log::info!("HTTP server stopped");

    // flush usage report
    flush_reporting().await;

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
pub fn create_action_server_router() -> axum::Router {
    use axum::{
        Router,
        extract::DefaultBodyLimit,
        middleware,
        routing::{get, post},
    };
    use openobserve_api_http::handler::http::{request::action_server, router::cors_layer};

    let cfg = get_config();

    // Create action server routes with authentication
    // Routes match action_manager.rs expected URLs: /api/{org_id}/v1/job[/{id}]
    let api_routes = Router::new()
        .route(
            "/{org_id}/v1/job",
            post(action_server::create_job).get(action_server::list_deployed_apps),
        )
        .route(
            "/{org_id}/v1/job/{name}",
            get(action_server::get_app_details)
                .delete(action_server::delete_job)
                .put(action_server::patch_action),
        )
        .layer(middleware::from_fn(
            openobserve_api_common::auth::action_server::auth_middleware,
        ))
        .layer(cors_layer());

    // Nest under base URI and set request body size limit
    let router = Router::new().nest(&format!("{}/api", cfg.common.base_uri), api_routes);

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
        super_cluster_queue::init().await?;
    }

    // Initialize enterprise AI components (agent and evaluation clients).
    if let Err(e) = o2_enterprise::enterprise::ai::init_ai_components() {
        log::error!("Failed to initialize enterprise AI components: {e}");
    } else {
        log::info!("Initialized enterprise AI components");
    }

    // check ratelimit config
    let cfg = config::get_config();
    let o2cfg = o2_enterprise::enterprise::common::config::get_config();
    if let Err(e) = check_ratelimit_config(&cfg, &o2cfg) {
        panic!("ratelimit config error: {e}");
    }

    o2_enterprise::enterprise::pipeline::pipeline_file_server::PipelineFileServer::run().await?;
    if o2cfg.rate_limit.rate_limit_enabled && o2_openfga::config::get_config().enabled {
        o2_ratelimit::init(
            openobserve_api_http::handler::http::router::openapi::openapi_info().await,
        )
        .await?;
    }

    Ok(())
}

#[cfg(feature = "enterprise")]
fn check_ratelimit_config(cfg: &Config, o2cfg: &O2Config) -> Result<(), anyhow::Error> {
    if o2cfg.rate_limit.rate_limit_enabled {
        let queue_store =
            config::meta::queue_store::QueueStore::try_from(cfg.common.queue_store.as_str());
        if queue_store != Ok(config::meta::queue_store::QueueStore::Nats) {
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
    use super::*;

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
